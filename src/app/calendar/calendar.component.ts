import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewEncapsulation
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  MatCalendar,
  MatCalendarCellClassFunction,
  MatDatepickerModule
} from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbar } from '@angular/material/toolbar';
import { MatDialog } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { DialogComponent } from '../dialog/dialog.component';
import { ActivityDatabaseService } from '../activities/activity-database.service';
import { Activity, ActivityEntry, HabitEntryStatus } from '../activities/activity.model';

@Component({
  selector: 'app-calendar',
  imports: [
    CommonModule,
    FormsModule,
    MatDatepickerModule,
    MatIconModule,
    MatToolbar
  ],
  templateUrl: './calendar.component.html',
  standalone: true,
  styleUrl: './calendar.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly today = new Date();

  selectedDate: Date | null = new Date(
    this.today.getFullYear(),
    this.today.getMonth(),
    this.today.getDate()
  );

  visibleMonth = new Date(
    this.today.getFullYear(),
    this.today.getMonth(),
    1
  );

  activities: Activity[] = [];
  entries: ActivityEntry[] = [];
  private recordedDates = new Set<string>();
  private dateColors = new Map<string, string[]>();
  private calendarStateSubscription?: Subscription;
  private refreshToken = 0;

  counterValues: Record<string, number> = {};
  eventNotes: Record<string, string> = {};
  busyActivityIds = new Set<string>();
  errorMessage = '';

  @ViewChild(MatCalendar) calendar!: MatCalendar<Date>;

  constructor(
    private readonly database: ActivityDatabaseService,
    private readonly changeDetector: ChangeDetectorRef,
    public dialog: MatDialog
  ) {}

  dateClass: MatCalendarCellClassFunction<Date> = this.createDateClass();

  private createDateClass(): MatCalendarCellClassFunction<Date> {
    return (cellDate, view) => {
      if (view !== 'month') return '';
      const date = this.formatDate(cellDate);
      return this.recordedDates.has(date)
        ? 'activity-date-marked activity-date-' + date.replace(/-/g, '')
        : '';
    };
  }

  async ngOnInit(): Promise<void> {
    await this.loadCalendarData();
  }

  ngAfterViewInit(): void {
    this.calendarStateSubscription = this.calendar.stateChanges.subscribe(() => {
      const activeDate = this.calendar.activeDate;
      this.visibleMonth = new Date(
        activeDate.getFullYear(),
        activeDate.getMonth(),
        1
      );
      void this.loadCalendarData();
    });
    // Data may have arrived before MatCalendar finished its first render.
    void this.refreshCalendarView();
  }

  ngOnDestroy(): void {
    this.calendarStateSubscription?.unsubscribe();
  }

  async onDateSelected(date: Date | null): Promise<void> {
    if (!date) return;
    this.selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    this.visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    this.errorMessage = '';
    await this.loadCalendarData();
  }

  async addCounter(activity: Activity, value: number): Promise<void> {
    if (!this.selectedDate || !Number.isFinite(value) || value <= 0) return;
    await this.runForActivity(activity.id, async () => {
      await this.database.addCounterEntry({
        activityId: activity.id,
        date: this.formatDate(this.selectedDate!),
        value
      });
      this.counterValues[activity.id] = 1;
      await this.loadCalendarData();
    });
  }

  async setHabit(activity: Activity, status: HabitEntryStatus): Promise<void> {
    if (!this.selectedDate) return;
    await this.runForActivity(activity.id, async () => {
      await this.database.setHabitStatus({
        activityId: activity.id,
        date: this.formatDate(this.selectedDate!),
        status
      });
      await this.loadCalendarData();
    });
  }

  async addEvent(activity: Activity): Promise<void> {
    if (!this.selectedDate) return;
    await this.runForActivity(activity.id, async () => {
      await this.database.addEventEntry({
        activityId: activity.id,
        date: this.formatDate(this.selectedDate!),
        note: this.eventNotes[activity.id]?.trim() || undefined
      });
      this.eventNotes[activity.id] = '';
      await this.loadCalendarData();
    });
  }

  async deleteEntry(entry: ActivityEntry): Promise<void> {
    if (!window.confirm('Удалить эту запись?')) return;
    try {
      await this.database.deleteEntry(entry.id);
      await this.loadCalendarData();
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
      this.changeDetector.markForCheck();
    }
  }

  entriesFor(activityId: string): ActivityEntry[] {
    return this.entries.filter(entry => entry.activityId === activityId);
  }

  counterTotal(activityId: string): number {
    return this.entriesFor(activityId).reduce((total, entry) => total + (entry.value ?? 0), 0);
  }

  habitStatus(activityId: string): HabitEntryStatus | undefined {
    return this.entriesFor(activityId).find(entry => entry.status)?.status;
  }

  async loadCalendarData(): Promise<void> {
    const token = ++this.refreshToken;
    try {
      const activities = await this.database.getActivities();
      // Fetching by date is sufficient for the selected-day view; month markers
      // are built from the activity histories below.
      const histories = await Promise.all(
        activities.map(activity => this.database.getEntriesForActivity(activity.id))
      );
      if (token !== this.refreshToken) return;

      this.activities = activities;
      const history = histories.flat();
      this.recordedDates = new Set(history.map(entry => entry.date));
      this.dateColors = new Map<string, string[]>();
      for (const entry of history) {
        const activity = activities.find(item => item.id === entry.activityId);
        this.addDateColor(entry.date, activity?.color ?? '#a55aff');
      }
      for (const activity of activities) {
        if (activity.type === 'event' && activity.settings.eventDate) {
          this.addDateColor(activity.settings.eventDate, activity.color ?? '#a55aff');
          this.recordedDates.add(activity.settings.eventDate);
        }
      }
      this.dateClass = this.createDateClass();
      this.updateDateStyleRules();
      this.entries = this.selectedDate
        ? history.filter(entry => entry.date === this.formatDate(this.selectedDate!))
        : [];
      this.changeDetector.markForCheck();
      await this.refreshCalendarView();
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
      this.changeDetector.markForCheck();
    }
  }

  private addDateColor(date: string, color: string): void {
    const colors = this.dateColors.get(date) ?? [];
    if (!colors.includes(color)) colors.push(color);
    this.dateColors.set(date, colors);
    this.recordedDates.add(date);
  }

  private updateDateStyleRules(): void {
    if (typeof document === 'undefined') return;
    const rules: string[] = [];
    for (const [date, colors] of this.dateColors) {
      const safeColors = colors.slice(0, 5).map(color => /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#a55aff');
      const positions = safeColors.length === 1
        ? ['50%']
        : safeColors.map((_color, index) => `${((index + 1) * 100) / (safeColors.length + 1)}%`);
      const dots = safeColors.map((color, index) => `radial-gradient(circle at ${positions[index]} 88%, ${color} 0 2px, transparent 2.5px)`).join(', ');
      rules.push(`button.activity-date-${date.replace(/-/g, '')} { background-image: ${dots} !important; background-repeat: no-repeat !important; }`);
    }
    let style = document.getElementById('shotdays-calendar-date-colors') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'shotdays-calendar-date-colors';
      document.head.appendChild(style);
    }
    style.textContent = rules.join('\n');
  }

  private async refreshCalendarView(): Promise<void> {
    await Promise.resolve();
    if (!this.calendar) return;
    this.dateClass = this.createDateClass();
    this.calendar.activeDate = new Date(this.calendar.activeDate);
    this.calendar.updateTodaysDate();
    this.changeDetector.detectChanges();
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

  private async runForActivity(activityId: string, action: () => Promise<void>): Promise<void> {
    if (this.busyActivityIds.has(activityId)) return;
    this.busyActivityIds.add(activityId);
    this.errorMessage = '';
    try {
      await action();
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.busyActivityIds.delete(activityId);
      this.changeDetector.markForCheck();
    }
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Не удалось сохранить запись.';
  }

  formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  openDialog(): void {
    this.dialog.open(DialogComponent);
  }
}
