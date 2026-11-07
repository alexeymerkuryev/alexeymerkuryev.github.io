
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewEncapsulation
} from '@angular/core';
import {NgForOf} from '@angular/common';
import {MatOption} from '@angular/material/core';
import {
  MatCalendar,
  MatCalendarCellClassFunction,
  MatDatepickerModule
} from '@angular/material/datepicker';
import {MAT_DATE_LOCALE} from '@angular/material/core';
import {MatButton} from '@angular/material/button';
import {MatTooltip} from '@angular/material/tooltip';
import {MatIconModule} from '@angular/material/icon';
import {MatToolbar} from '@angular/material/toolbar';
import {MatFormField} from '@angular/material/form-field';
import {MatSelect} from '@angular/material/select';
import {MatProgressBar} from '@angular/material/progress-bar';
import {MatDialog} from '@angular/material/dialog';
import {Subscription} from 'rxjs';
import {DialogComponent} from '../dialog/dialog.component';

interface ShotEntry {
  date: string;
  count: number;
}

@Component({
  selector: 'app-calendar',
  providers: [
    {provide: MAT_DATE_LOCALE, useValue: 'ru-RU'}
  ],
  imports: [
    MatDatepickerModule,
    MatButton,
    MatTooltip,
    MatIconModule,
    MatToolbar,
    MatFormField,
    MatSelect,
    MatOption,
    NgForOf,
    MatProgressBar
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

  count_shot = 1;

  shot_day = 0;
  shot_mnt = 0;
  shot_total = 0;

  private recordedDates = new Set<string>();
  private calendarStateSubscription?: Subscription;

  @ViewChild(MatCalendar) calendar!: MatCalendar<Date>;

  constructor(public dialog: MatDialog) {}

  dateClass: MatCalendarCellClassFunction<Date> = (cellDate, view) => {
    if (view !== 'month') {
      return '';
    }

    return this.recordedDates.has(this.formatDate(cellDate))
      ? 'example-custom-date-class'
      : '';
  };

  ngOnInit(): void {
    this.loadDates();
  }

  ngAfterViewInit(): void {
    // Отслеживаем переключение месяцев стрелками календаря.
    this.calendarStateSubscription =
      this.calendar.stateChanges.subscribe(() => {
        const activeDate = this.calendar.activeDate;

        this.visibleMonth = new Date(
          activeDate.getFullYear(),
          activeDate.getMonth(),
          1
        );

        this.loadDates();
      });
  }

  ngOnDestroy(): void {
    this.calendarStateSubscription?.unsubscribe();
  }

  onDateSelected(date: Date | null): void {
    if (!date) {
      return;
    }

    this.selectedDate = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );

    this.visibleMonth = new Date(
      date.getFullYear(),
      date.getMonth(),
      1
    );

    this.loadDates();
  }

  addDate(): void {
    if (!this.selectedDate) {
      return;
    }

    const count = Number(this.count_shot);

    if (!Number.isFinite(count) || count < 0) {
      return;
    }

    const dateKey = this.formatDate(this.selectedDate);
    const entries = this.readStoredDates();

    const existingIndex = entries.findIndex(
      entry => entry.date === dateKey
    );

    if (existingIndex >= 0) {
      entries[existingIndex] = {
        date: dateKey,
        count
      };
    } else {
      entries.push({
        date: dateKey,
        count
      });
    }

    localStorage.setItem('dates', JSON.stringify(entries));
    this.loadDates();
  }

  loadDates(): void {
    const entries = this.readStoredDates();

    this.recordedDates = new Set(
      entries.map(entry => entry.date)
    );

    const year = this.visibleMonth.getFullYear();

    const monthPrefix =
      `${year}-${String(this.visibleMonth.getMonth() + 1).padStart(2, '0')}-`;

    this.shot_day = this.selectedDate
      ? entries.find(
          entry => entry.date === this.formatDate(this.selectedDate!)
        )?.count ?? 0
      : 0;

    // Сумма за отображаемый месяц.
    this.shot_mnt = entries
      .filter(entry => entry.date.startsWith(monthPrefix))
      .reduce((total, entry) => total + entry.count, 0);

    // Сумма только за год отображаемого месяца.
    this.shot_total = entries
      .filter(entry => Number(entry.date.slice(0, 4)) === year)
      .reduce((total, entry) => total + entry.count, 0);
  }

  private readStoredDates(): ShotEntry[] {
    let stored: unknown;

    try {
      stored = JSON.parse(localStorage.getItem('dates') || '[]');
    } catch {
      stored = [];
    }

    if (!Array.isArray(stored)) {
      return [];
    }

    const currentYear = new Date().getFullYear();
    const normalized = new Map<string, number>();

    for (const item of stored) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      let dateKey: string | null = null;

      // Новый формат: YYYY-MM-DD.
      if (
        typeof item.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(item.date)
      ) {
        dateKey = item.date;
      }

      // Старый формат: день + месяц, без года.
      else if (
        Number.isInteger(item.date) &&
        Number.isInteger(item.month) &&
        item.date >= 1 &&
        item.date <= 31 &&
        item.month >= 0 &&
        item.month <= 11
      ) {
        const legacyDate = new Date(
          currentYear,
          item.month,
          item.date
        );

        // Не допускаем автоматического переноса 31 февраля на март.
        if (
          legacyDate.getMonth() === item.month &&
          legacyDate.getDate() === item.date
        ) {
          dateKey = this.formatDate(legacyDate);
        }
      }

      const count = Number(item.count);

      if (dateKey && Number.isFinite(count) && count >= 0) {
        normalized.set(dateKey, count);
      }
    }

    const entries = Array.from(
      normalized,
      ([date, count]) => ({date, count})
    );

    localStorage.setItem('dates', JSON.stringify(entries));

    return entries;
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  openDialog(): void {
    this.dialog.open(DialogComponent);
  }
}
