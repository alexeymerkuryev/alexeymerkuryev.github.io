import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Activity, ActivityEntry } from './activity.model';
import { ActivityDatabaseService } from './activity-database.service';

interface ChartDay {
  date: string;
  label: string;
  value: number;
}

@Component({
  selector: 'app-activity-history',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './activity-history.component.html',
  styleUrl: './activity-history.component.scss'
})
export class ActivityHistoryComponent implements OnInit {
  activities: Activity[] = [];
  selectedActivityId = '';
  entries: ActivityEntry[] = [];
  loading = true;
  error = '';
  fromDate = '';
  toDate = '';

  constructor(private readonly database: ActivityDatabaseService) {}

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  get selectedActivity(): Activity | undefined {
    return this.activities.find(activity => activity.id === this.selectedActivityId);
  }

  get filteredEntries(): ActivityEntry[] {
    return this.entries
      .filter(entry => (!this.fromDate || entry.date >= this.fromDate) &&
        (!this.toDate || entry.date <= this.toDate))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  get chartDays(): ChartDay[] {
    const activity = this.selectedActivity;
    if (!activity) return [];

    const end = this.toDate ? this.parseDate(this.toDate) : new Date();
    const start = this.fromDate ? this.parseDate(this.fromDate) : new Date(end);
    if (!this.fromDate) start.setDate(start.getDate() - 13);

    const days: ChartDay[] = [];
    const cursor = new Date(start);
    while (cursor <= end && days.length < 366) {
      const date = this.formatDate(cursor);
      const dayEntries = this.filteredEntries.filter(entry => entry.date === date);
      let value = 0;

      if (activity.type === 'counter') {
        value = dayEntries.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
      } else if (activity.type === 'habit') {
        const successful = activity.settings.habit?.mode === 'avoid' ? 'success' : 'completed';
        value = dayEntries.some(entry => entry.status === successful) ? 1 : 0;
      } else {
        value = dayEntries.length;
      }

      days.push({
        date,
        label: cursor.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
        value
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  get chartMax(): number {
    return Math.max(1, ...this.chartDays.map(day => day.value));
  }


  get averagePerActiveDay(): number {
    const values = this.dailyValues;
    const active = values.filter(value => value > 0);
    return active.length ? active.reduce((sum, value) => sum + value, 0) / active.length : 0;
  }

  get bestDay(): number {
    return Math.max(0, ...this.dailyValues);
  }

  get weeklySummary(): Array<{ label: string; value: number }> {
    return this.groupedSummary('week');
  }

  get monthlySummary(): Array<{ label: string; value: number }> {
    return this.groupedSummary('month');
  }

  get dailyValues(): number[] {
    const activity = this.selectedActivity;
    if (!activity) return [];
    const grouped = new Map<string, number>();
    for (const entry of this.filteredEntries) {
      let value = 1;
      if (activity.type === 'counter') value = entry.value ?? 0;
      if (activity.type === 'habit') {
        const success = activity.settings.habit?.mode === 'avoid' ? 'success' : 'completed';
        value = entry.status === success ? 1 : 0;
      }
      grouped.set(entry.date, (grouped.get(entry.date) ?? 0) + value);
    }
    return [...grouped.values()];
  }

  private groupedSummary(period: 'week' | 'month'): Array<{ label: string; value: number }> {
    const activity = this.selectedActivity;
    if (!activity) return [];
    const groups = new Map<string, { label: string; value: number; sort: string }>();
    for (const entry of this.filteredEntries) {
      const date = this.parseDate(entry.date);
      let key: string;
      let label: string;
      if (period === 'month') {
        key = entry.date.slice(0, 7);
        label = date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
      } else {
        const monday = new Date(date);
        const weekday = (monday.getDay() + 6) % 7;
        monday.setDate(monday.getDate() - weekday);
        key = this.formatDate(monday);
        const sunday = new Date(monday);
        sunday.setDate(sunday.getDate() + 6);
        label = monday.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) +
          ' — ' + sunday.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      }
      let amount = 1;
      if (activity.type === 'counter') amount = entry.value ?? 0;
      if (activity.type === 'habit') {
        const success = activity.settings.habit?.mode === 'avoid' ? 'success' : 'completed';
        amount = entry.status === success ? 1 : 0;
      }
      const group = groups.get(key) ?? { label, value: 0, sort: key };
      group.value += amount;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.sort.localeCompare(a.sort)).slice(0, 12);
  }

  get counterTotal(): number {
    return this.filteredEntries.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
  }

  get activeDays(): number {
    return new Set(this.filteredEntries.map(entry => entry.date)).size;
  }

  get successfulHabitDays(): number {
    const activity = this.selectedActivity;
    if (!activity || activity.type !== 'habit') return 0;
    const successful = activity.settings.habit?.mode === 'avoid' ? 'success' : 'completed';
    return this.filteredEntries.filter(entry => entry.status === successful).length;
  }

  get currentStreak(): number {
    const activity = this.selectedActivity;
    if (!activity || activity.type !== 'habit') return 0;
    const successful = activity.settings.habit?.mode === 'avoid' ? 'success' : 'completed';
    const dates = new Set(this.entries
      .filter(entry => entry.status === successful)
      .map(entry => entry.date));
    let cursor = new Date();
    if (!dates.has(this.formatDate(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (dates.has(this.formatDate(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.activities = await this.database.getActivities();
      if (!this.selectedActivityId || !this.activities.some(a => a.id === this.selectedActivityId)) {
        this.selectedActivityId = this.activities[0]?.id ?? '';
      }
      await this.loadEntries();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Не удалось загрузить историю.';
    } finally {
      this.loading = false;
    }
  }

  async onActivityChange(): Promise<void> {
    await this.loadEntries();
  }

  async loadEntries(): Promise<void> {
    if (!this.selectedActivityId) {
      this.entries = [];
      return;
    }
    try {
      this.entries = await this.database.getEntriesForActivity(this.selectedActivityId);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Не удалось загрузить записи.';
    }
  }

  clearDates(): void {
    this.fromDate = '';
    this.toDate = '';
  }

  async deleteEntry(entry: ActivityEntry): Promise<void> {
    if (!window.confirm('Удалить запись из истории?')) return;
    try {
      await this.database.deleteEntry(entry.id);
      await this.loadEntries();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Не удалось удалить запись.';
    }
  }

  entryDescription(entry: ActivityEntry): string {
    const activity = this.selectedActivity;
    if (!activity) return '';
    if (activity.type === 'counter') return (entry.value ?? 0) + ' ' + (activity.unit ?? '');
    if (activity.type === 'event') return entry.note || 'Событие отмечено';
    if (entry.status === 'completed') return 'Выполнено';
    if (entry.status === 'missed') return 'Не выполнено';
    if (entry.status === 'success') return 'Удержался';
    if (entry.status === 'slipped') return 'Срыв';
    return 'Нет статуса';
  }

  private parseDate(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private formatDate(date: Date): string {
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }
}
