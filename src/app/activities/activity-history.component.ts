import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Activity, ActivityEntry } from './activity.model';
import { ActivityDatabaseService } from './activity-database.service';

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
    // If today has not been marked yet, keep showing the streak through yesterday.
    // An unmarked day is never interpreted as a failure.
    if (!dates.has(this.formatDate(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
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

  private formatDate(date: Date): string {
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }
}
