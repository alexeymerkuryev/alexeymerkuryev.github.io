import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { Activity, ActivityEntry, HabitEntryStatus } from './activity.model';
import { ActivityDatabaseService } from './activity-database.service';

interface CounterSummary {
  activity: Activity;
  total: number;
  target: number;
  progress: number;
  periodLabel: string;
  unit: string;
}

interface HabitSummary {
  activity: Activity;
  status?: HabitEntryStatus;
  streak: number;
  statusLabel: string;
}

interface UpcomingEvent {
  activity: Activity;
  date: string;
  daysLeft: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit, OnDestroy {
  activities: Activity[] = [];
  entries: ActivityEntry[] = [];
  loading = true;
  error = '';
  counterInputs: Record<string, number> = {};
  readonly busyActivityIds = new Set<string>();
  today = new Date();
  private changesSubscription?: Subscription;

  constructor(private readonly database: ActivityDatabaseService) {}

  async ngOnInit(): Promise<void> {
    this.changesSubscription = this.database.changes$.subscribe(() => void this.refresh());
    await this.refresh();
  }

  ngOnDestroy(): void {
    this.changesSubscription?.unsubscribe();
  }

  async refresh(): Promise<void> {
    try {
      const [activities, entries] = await Promise.all([
        this.database.getActivities(),
        this.database.getAllEntries()
      ]);
      this.activities = activities;
      this.entries = entries;
      for (const activity of activities) {
        if (activity.type === 'counter' && this.counterInputs[activity.id] === undefined) {
          this.counterInputs[activity.id] = 1;
        }
      }
      this.today = new Date();
      this.error = '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Не удалось загрузить обзор.';
    } finally {
      this.loading = false;
    }
  }

  get todayLabel(): string {
    return this.today.toLocaleDateString('ru-RU', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  get todayEntries(): ActivityEntry[] {
    const date = this.formatDate(this.today);
    return this.entries.filter(entry => entry.date === date);
  }

  get counterSummaries(): CounterSummary[] {
    return this.activities
      .filter(activity => activity.type === 'counter' && activity.settings.target !== undefined)
      .map(activity => {
        const period = activity.settings.targetPeriod ?? 'day';
        const [from, to] = this.periodRange(period);
        const total = this.entries
          .filter(entry => entry.activityId === activity.id && entry.date >= from && entry.date <= to)
          .reduce((sum, entry) => sum + (entry.value ?? 0), 0);
        const target = activity.settings.target ?? 0;
        return {
          activity, total, target,
          progress: target > 0 ? Math.min(100, Math.round(total / target * 100)) : 0,
          periodLabel: period === 'week' ? 'за эту неделю' : period === 'month' ? 'за этот месяц' : 'сегодня',
          unit: activity.unit ?? ''
        };
      });
  }

  get habitSummaries(): HabitSummary[] {
    const today = this.formatDate(this.today);
    return this.activities
      .filter(activity => activity.type === 'habit')
      .map(activity => {
        const status = this.entries.find(entry => entry.activityId === activity.id && entry.date === today)?.status;
        const successStatus = activity.settings.habit?.mode === 'avoid' ? 'success' : 'completed';
        const streak = this.streakFor(activity, successStatus);
        return {
          activity,
          status,
          streak,
          statusLabel: this.habitStatusLabel(activity, status)
        };
      });
  }

  get upcomingEvents(): UpcomingEvent[] {
    const today = this.formatDate(this.today);
    return this.activities
      .filter(activity => activity.type === 'event' && !!activity.settings.eventDate)
      .map(activity => {
        const date = activity.settings.eventDate!;
        return { activity, date, daysLeft: this.daysBetween(today, date) };
      })
      .filter(item => item.daysLeft >= 0)
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 4);
  }


  get quickCounters(): Activity[] {
    return this.activities.filter(activity => activity.type === 'counter');
  }

  get quickHabits(): HabitSummary[] {
    return this.habitSummaries;
  }

  async addCounter(activity: Activity, value: number): Promise<void> {
    if (!Number.isFinite(value) || value <= 0 || this.busyActivityIds.has(activity.id)) return;
    this.busyActivityIds.add(activity.id);
    this.error = '';
    try {
      await this.database.addCounterEntry({
        activityId: activity.id,
        date: this.formatDate(this.today),
        value
      });
      this.counterInputs[activity.id] = 1;
      await this.refresh();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Не удалось сохранить значение счётчика.';
    } finally {
      this.busyActivityIds.delete(activity.id);
    }
  }

  async setHabit(activity: Activity, status: HabitEntryStatus): Promise<void> {
    if (this.busyActivityIds.has(activity.id)) return;
    this.busyActivityIds.add(activity.id);
    this.error = '';
    try {
      await this.database.setHabitStatus({
        activityId: activity.id,
        date: this.formatDate(this.today),
        status
      });
      await this.refresh();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Не удалось отметить привычку.';
    } finally {
      this.busyActivityIds.delete(activity.id);
    }
  }

  get recordedTodayCount(): number {
    return new Set(this.todayEntries.map(entry => entry.activityId)).size;
  }

  get totalEntries(): number {
    return this.entries.length;
  }

  get todayHabitsCompleted(): number {
    return this.habitSummaries.filter(item => {
      const success = item.activity.settings.habit?.mode === 'avoid' ? 'success' : 'completed';
      return item.status === success;
    }).length;
  }

  get todayHabitsTotal(): number {
    return this.habitSummaries.length;
  }

  habitStatusLabel(activity: Activity, status?: HabitEntryStatus): string {
    if (!status) return 'Ещё не отмечено';
    if (activity.settings.habit?.mode === 'avoid') {
      return status === 'success' ? 'Удержался' : status === 'slipped' ? 'Был срыв' : 'Отмечено';
    }
    return status === 'completed' ? 'Выполнено' : status === 'missed' ? 'Не выполнено' : 'Отмечено';
  }

  private streakFor(activity: Activity, successStatus: HabitEntryStatus): number {
    const dates = new Set(this.entries
      .filter(entry => entry.activityId === activity.id && entry.status === successStatus)
      .map(entry => entry.date));
    let cursor = new Date(this.today);
    if (!dates.has(this.formatDate(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (dates.has(this.formatDate(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  private periodRange(period: 'day' | 'week' | 'month'): [string, string] {
    const start = new Date(this.today.getFullYear(), this.today.getMonth(), this.today.getDate());
    if (period === 'week') {
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    } else if (period === 'month') {
      start.setDate(1);
    }
    return [this.formatDate(start), this.formatDate(this.today)];
  }

  countdownLabel(days: number): string {
    if (days === 0) return 'Сегодня';
    if (days === 1) return 'Завтра';
    return 'Через ' + days + ' дн.';
  }

  private daysBetween(from: string, to: string): number {
    const parse = (value: string) => {
      const [year, month, day] = value.split('-').map(Number);
      return Date.UTC(year, month - 1, day);
    };
    return Math.round((parse(to) - parse(from)) / 86400000);
  }

  private formatDate(date: Date): string {
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }
}
