import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Activity,
  ActivityInputMode,
  ActivityType,
  HabitMode,
  HabitSchedule
} from './activity.model';
import { ActivityDatabaseService } from './activity-database.service';

@Component({
  selector: 'app-activity-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './activity-list.component.html',
  styleUrl: './activity-list.component.scss'
})
export class ActivityListComponent implements OnInit {
  @Input() openActivityId: string | null = null;
  activities: Activity[] = [];
  loading = true;
  saving = false;
  error = '';
  editorOpen = false;
  editingId: string | null = null;

  name = '';
  description = '';
  type: ActivityType = 'counter';
  inputMode: ActivityInputMode = 'both';
  unit = '';
  target: number | null = null;
  targetPeriod: 'day' | 'week' | 'month' = 'day';
  habitMode: HabitMode = 'build';
  scheduleType: 'daily' | 'weekly' = 'daily';
  daysPerWeek = 3;
  icon = '';
  color = '#a55aff';
  eventDate = '';

  constructor(private readonly database: ActivityDatabaseService) {}

  async ngOnInit(): Promise<void> {
    await this.refresh();
    if (this.openActivityId) {
      const activity = this.activities.find(item => item.id === this.openActivityId);
      if (activity) this.openEdit(activity);
    }
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.activities = await this.database.getActivities();
    } catch (error) {
      this.error = this.message(error, 'Не удалось загрузить активности.');
    } finally {
      this.loading = false;
    }
  }

  openCreate(): void {
    this.resetEditor();
    this.editorOpen = true;
  }

  openEdit(activity: Activity): void {
    this.editingId = activity.id;
    this.name = activity.name;
    this.description = activity.description ?? '';
    this.type = activity.type;
    this.inputMode = activity.inputMode;
    this.unit = activity.unit ?? '';
    this.target = activity.settings.target ?? null;
    this.targetPeriod = activity.settings.targetPeriod ?? 'day';
    this.habitMode = activity.settings.habit?.mode ?? 'build';
    this.scheduleType = activity.settings.habit?.schedule.type ?? 'daily';
    this.daysPerWeek = activity.settings.habit?.schedule.type === 'weekly'
      ? activity.settings.habit.schedule.daysPerWeek
      : 3;
    this.icon = activity.icon ?? '';
    this.color = activity.color ?? '#a55aff';
    this.eventDate = activity.settings.eventDate ?? '';
    this.error = '';
    this.editorOpen = true;
  }

  closeEditor(): void {
    if (this.saving) return;
    this.editorOpen = false;
    this.error = '';
  }

  async save(): Promise<void> {
    const cleanName = this.name.trim();
    if (!cleanName) {
      this.error = 'Укажи название активности.';
      return;
    }
    if (this.type === 'counter' && !this.unit.trim()) {
      this.error = 'Укажи единицу измерения, например «км» или «кадров».';
      return;
    }
    if (this.type === 'habit' && this.scheduleType === 'weekly' &&
        (!Number.isInteger(this.daysPerWeek) || this.daysPerWeek < 1 || this.daysPerWeek > 7)) {
      this.error = 'Частота должна быть от 1 до 7 дней в неделю.';
      return;
    }
    if (this.target !== null && (!Number.isFinite(this.target) || this.target < 0)) {
      this.error = 'Цель должна быть неотрицательным числом.';
      return;
    }
    if (this.type === 'event' && this.eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(this.eventDate)) {
      this.error = 'Проверь дату события.';
      return;
    }

    const settings: Activity['settings'] = {};
    if (this.type === 'event' && this.eventDate) settings.eventDate = this.eventDate;
    if (this.target !== null) {
      settings.target = this.target;
      settings.targetPeriod = this.targetPeriod;
    }
    if (this.type === 'habit') {
      const schedule: HabitSchedule = this.scheduleType === 'daily'
        ? { type: 'daily' }
        : { type: 'weekly', daysPerWeek: this.daysPerWeek };
      settings.habit = { mode: this.habitMode, schedule };
    }

    this.saving = true;
    this.error = '';
    try {
      const input = {
        name: cleanName,
        description: this.description.trim() || undefined,
        type: this.type,
        inputMode: this.inputMode,
        unit: this.type === 'counter' ? this.unit.trim() : undefined,
        icon: this.icon.trim() || undefined,
        color: this.color,
        settings
      };
      if (this.editingId) {
        await this.database.updateActivity(this.editingId, input);
      } else {
        await this.database.createActivity(input);
      }
      this.editorOpen = false;
      this.resetEditor();
      await this.refresh();
    } catch (error) {
      this.error = this.message(error, 'Не удалось сохранить активность.');
    } finally {
      this.saving = false;
    }
  }

  async remove(activity: Activity): Promise<void> {
    const confirmed = window.confirm(
      'Удалить активность «' + activity.name + '» и все её записи? Это действие нельзя отменить.'
    );
    if (!confirmed) return;
    try {
      await this.database.deleteActivity(activity.id);
      await this.refresh();
    } catch (error) {
      this.error = this.message(error, 'Не удалось удалить активность.');
    }
  }

  typeLabel(type: ActivityType): string {
    return type === 'counter' ? 'Счётчик' : type === 'habit' ? 'Привычка' : 'Событие';
  }

  inputModeLabel(mode: ActivityInputMode): string {
    return mode === 'manual' ? 'Ручной ввод' : mode === 'quick' ? 'Быстрая отметка' : 'Ручной ввод и отметка';
  }

  habitSummary(activity: Activity): string {
    const habit = activity.settings.habit;
    if (!habit) return '';
    const mode = habit.mode === 'build' ? 'Формирование' : 'Отказ от привычки';
    const schedule = habit.schedule.type === 'daily'
      ? 'каждый день'
      : habit.schedule.daysPerWeek + ' дн. в неделю';
    return mode + ' · ' + schedule;
  }

  trackById(_index: number, activity: Activity): string {
    return activity.id;
  }

  countdown(date: string): string {
    const target = new Date(date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (days === 0) return 'Сегодня';
    if (days < 0) return 'Прошло ' + Math.abs(days) + ' дн.';
    return 'Осталось ' + days + ' дн.';
  }

  private resetEditor(): void {
    this.editingId = null;
    this.name = '';
    this.description = '';
    this.type = 'counter';
    this.inputMode = 'both';
    this.unit = '';
    this.target = null;
    this.targetPeriod = 'day';
    this.habitMode = 'build';
    this.scheduleType = 'daily';
    this.daysPerWeek = 3;
    this.icon = '';
    this.color = '#a55aff';
    this.eventDate = '';
  }

  private message(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }
}
