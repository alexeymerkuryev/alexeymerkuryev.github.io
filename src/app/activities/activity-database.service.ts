import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import {
  Activity,
  ActivityEntry,
  ActivityInputMode,
  ActivityType,
  HabitEntryStatus,
  AppSetting
} from './activity.model';

class ShotDaysDatabase extends Dexie {
  activities!: Table<Activity, string>;
  entries!: Table<ActivityEntry, string>;
  settings!: Table<AppSetting, string>;

  constructor() {
    super('ShotDaysDatabase');
    this.version(1).stores({
      activities: 'id, name, type, createdAt',
      entries: 'id, activityId, date, [activityId+date]',
      settings: 'key'
    });
  }
}

interface LegacyShot {
  date?: unknown;
  month?: unknown;
  count?: unknown;
}

@Injectable({ providedIn: 'root' })
export class ActivityDatabaseService {
  private readonly db = new ShotDaysDatabase();
  private readonly migrationKey = 'migration.legacy-shots.v1';
  private readonly legacyActivityId = 'legacy-photography';

  async initialize(): Promise<void> {
    await this.db.open();
    await this.migrateLegacyShots();
  }

  async getActivities(): Promise<Activity[]> {
    return this.db.activities.orderBy('createdAt').toArray();
  }

  async getActivity(id: string): Promise<Activity | undefined> {
    return this.db.activities.get(id);
  }

  async createActivity(input: {
    name: string;
    type: ActivityType;
    inputMode?: ActivityInputMode;
    description?: string;
    unit?: string;
    color?: string;
    icon?: string;
    settings?: Activity['settings'];
  }): Promise<string> {
    const name = input.name.trim();
    if (!name) throw new Error('Название активности не может быть пустым.');

    const now = new Date().toISOString();
    const id = this.createId();
    const activity: Activity = {
      id,
      name,
      type: input.type,
      inputMode: input.inputMode ?? 'both',
      description: input.description,
      unit: input.unit,
      color: input.color,
      icon: input.icon,
      settings: input.settings ?? {},
      createdAt: now,
      updatedAt: now
    };
    await this.db.activities.add(activity);
    return id;
  }

  async updateActivity(id: string, changes: Partial<Omit<Activity, 'id' | 'createdAt'>>): Promise<void> {
    const existing = await this.db.activities.get(id);
    if (!existing) throw new Error('Активность не найдена.');
    const name = changes.name === undefined ? existing.name : changes.name.trim();
    if (!name) throw new Error('Название активности не может быть пустым.');

    await this.db.activities.update(id, {
      ...changes,
      name,
      updatedAt: new Date().toISOString()
    });
  }

  async deleteActivity(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.activities, this.db.entries, async () => {
      await this.db.entries.where('activityId').equals(id).delete();
      await this.db.activities.delete(id);
    });
  }

  async addCounterEntry(input: {
    activityId: string;
    date: string;
    value: number;
    note?: string;
  }): Promise<string> {
    this.assertDate(input.date);
    if (!Number.isFinite(input.value) || input.value < 0) {
      throw new Error('Значение счётчика должно быть неотрицательным числом.');
    }
    const activity = await this.requireActivity(input.activityId, 'counter');
    void activity;
    const now = new Date().toISOString();
    const id = this.createId();
    await this.db.entries.add({
      id,
      activityId: input.activityId,
      date: input.date,
      value: input.value,
      note: input.note,
      createdAt: now,
      updatedAt: now
    });
    return id;
  }

  async updateEntry(id: string, changes: Partial<Pick<ActivityEntry, 'date' | 'value' | 'status' | 'note'>>): Promise<void> {
    const entry = await this.db.entries.get(id);
    if (!entry) throw new Error('Запись не найдена.');
    if (changes.date !== undefined) this.assertDate(changes.date);
    if (changes.value !== undefined && (!Number.isFinite(changes.value) || changes.value < 0)) {
      throw new Error('Значение должно быть неотрицательным числом.');
    }
    await this.db.entries.update(id, { ...changes, updatedAt: new Date().toISOString() });
  }

  async deleteEntry(id: string): Promise<void> {
    await this.db.entries.delete(id);
  }

  async getEntriesForDate(date: string, activityId?: string): Promise<ActivityEntry[]> {
    this.assertDate(date);
    if (activityId) {
      return this.db.entries.where('[activityId+date]').equals([activityId, date]).toArray();
    }
    return this.db.entries.where('date').equals(date).toArray();
  }

  async getEntriesForActivity(activityId: string): Promise<ActivityEntry[]> {
    return this.db.entries.where('activityId').equals(activityId).sortBy('date');
  }

  async getCounterTotal(activityId: string, from?: string, to?: string): Promise<number> {
    let entries = await this.db.entries.where('activityId').equals(activityId).toArray();
    if (from) entries = entries.filter(entry => entry.date >= from);
    if (to) entries = entries.filter(entry => entry.date <= to);
    return entries.reduce((total, entry) => total + (entry.value ?? 0), 0);
  }

  async setHabitStatus(input: {
    activityId: string;
    date: string;
    status: HabitEntryStatus;
    note?: string;
  }): Promise<void> {
    this.assertDate(input.date);
    await this.requireActivity(input.activityId, 'habit');
    await this.db.transaction('rw', this.db.entries, async () => {
      const matches = await this.db.entries
        .where('[activityId+date]')
        .equals([input.activityId, input.date])
        .toArray();
      const now = new Date().toISOString();
      if (matches.length) {
        const [first, ...duplicates] = matches;
        await this.db.entries.update(first.id, {
          status: input.status,
          note: input.note,
          updatedAt: now
        });
        if (duplicates.length) {
          await this.db.entries.bulkDelete(duplicates.map(entry => entry.id));
        }
      } else {
        await this.db.entries.add({
          id: this.createId(),
          activityId: input.activityId,
          date: input.date,
          status: input.status,
          note: input.note,
          createdAt: now,
          updatedAt: now
        });
      }
    });
  }

  private async migrateLegacyShots(): Promise<void> {
    const alreadyMigrated = await this.db.settings.get(this.migrationKey);
    if (alreadyMigrated) return;

    const raw = this.readLegacyStorage();
    const shots = this.normalizeLegacyShots(raw);
    if (shots.length) {
      await this.db.transaction('rw', this.db.activities, this.db.entries, this.db.settings, async () => {
        const now = new Date().toISOString();
        const existing = await this.db.activities.get(this.legacyActivityId);
        if (!existing) {
          await this.db.activities.add({
            id: this.legacyActivityId,
            name: 'Фотография',
            description: 'Количество отснятых кадров',
            type: 'counter',
            unit: 'кадров',
            inputMode: 'both',
            settings: {},
            createdAt: now,
            updatedAt: now
          });
        }

        for (const shot of shots) {
          const id = 'legacy-shot-' + shot.date;
          const exists = await this.db.entries.get(id);
          if (!exists) {
            await this.db.entries.add({
              id,
              activityId: this.legacyActivityId,
              date: shot.date,
              value: shot.count,
              createdAt: now,
              updatedAt: now
            });
          }
        }
        await this.db.settings.put({ key: this.migrationKey, value: now });
      });
    } else {
      await this.db.settings.put({
        key: this.migrationKey,
        value: new Date().toISOString()
      });
    }
  }

  private readLegacyStorage(): unknown {
    try {
      if (typeof localStorage === 'undefined') return [];
      return JSON.parse(localStorage.getItem('dates') ?? '[]') as unknown;
    } catch {
      return [];
    }
  }

  private normalizeLegacyShots(raw: unknown): Array<{ date: string; count: number }> {
    if (!Array.isArray(raw)) return [];
    const currentYear = new Date().getFullYear();
    const normalized = new Map<string, number>();

    for (const value of raw) {
      if (!value || typeof value !== 'object') continue;
      const item = value as LegacyShot;
      let date: string | null = null;

      if (typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
        date = item.date;
      } else if (
        Number.isInteger(item.date) && Number.isInteger(item.month) &&
        Number(item.date) >= 1 && Number(item.date) <= 31 &&
        Number(item.month) >= 0 && Number(item.month) <= 11
      ) {
        const parsed = new Date(currentYear, Number(item.month), Number(item.date));
        if (parsed.getFullYear() === currentYear &&
            parsed.getMonth() === Number(item.month) &&
            parsed.getDate() === Number(item.date)) {
          date = this.formatDate(parsed);
        }
      }

      const count = Number(item.count);
      if (date && Number.isFinite(count) && count >= 0) normalized.set(date, count);
    }

    return Array.from(normalized, ([date, count]) => ({ date, count }));
  }

  private async requireActivity(id: string, type: ActivityType): Promise<Activity> {
    const activity = await this.db.activities.get(id);
    if (!activity || activity.type !== type) {
      throw new Error('Активность не найдена или имеет другой тип.');
    }
    return activity;
  }

  private assertDate(value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Дата должна быть в формате YYYY-MM-DD.');
    const parsed = new Date(value + 'T00:00:00');
    if (Number.isNaN(parsed.getTime()) || this.formatDate(parsed) !== value) {
      throw new Error('Указана некорректная дата.');
    }
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  private createId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return 'activity-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
}
