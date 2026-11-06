import {
  ChangeDetectionStrategy,
  Component,
  inject,
  model, ModelSignal,
  OnInit,
  signal,
  ViewChild,
  ViewEncapsulation
} from '@angular/core';
import {MatCardModule} from '@angular/material/card';
import {MatOption, provideNativeDateAdapter} from '@angular/material/core';
import {
  MatCalendar,
  MatCalendarCellClassFunction,
  MatDatepickerInputEvent,
  MatDatepickerModule, MatMonthView, MatYearView
} from '@angular/material/datepicker';
import {MatFormField} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MAT_DATE_LOCALE} from '@angular/material/core';
import {MatButton} from '@angular/material/button';
import {MatTooltip} from '@angular/material/tooltip';
import {MatIconModule} from '@angular/material/icon';
import {MatToolbar} from '@angular/material/toolbar';
import {debounce, debounceTime, distinctUntilChanged, fromEvent, ObservableInput, Subject, takeUntil} from 'rxjs';
import {MatSelect} from '@angular/material/select';
import {NgForOf} from '@angular/common';
import {MatProgressBar} from '@angular/material/progress-bar';
import {MatDialog} from '@angular/material/dialog';
import {DialogComponent} from '../dialog/dialog.component';

//import 'moment/locale/ja';
@Component({
  selector: 'app-calendar',
  providers: [provideNativeDateAdapter(),  {provide: MAT_DATE_LOCALE, useValue: 'ru-RU'},],
  imports: [
    MatCardModule, MatDatepickerModule, MatFormField, MatInputModule, MatButton, MatTooltip, MatIconModule, MatToolbar, MatSelect, MatOption, NgForOf, MatProgressBar
  ],
  templateUrl: './calendar.component.html',
  standalone: true,
  styleUrl: './calendar.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarComponent implements OnInit {
  today = new Date();
  selectedDate: any;
  selectedMonth: any = this.today.getMonth() ; // Инициализация текущим месяцем
  numbers?: number[];
  events = signal<string[]>([]);
  private readonly _locale = signal(inject<unknown>(MAT_DATE_LOCALE));
  selected = model<Date | null>(null);
  private readonly  updateDate: Subject<Date> = new Subject<Date>();
  private destroy$!: ObservableInput<any>;
  shot_day!:number;
  shot_mnt!: number;
  shot_total!: number;
  count_shot!: number;

  @ViewChild(MatMonthView) monthView!: MatCalendar<Date>;
  constructor(public dialog: MatDialog) {}

  dateClass: MatCalendarCellClassFunction<Date> = (cellDate: any, view) => {
    this.updateDate.next(cellDate);
    if (view === 'month') {
      const date = cellDate.getDate();
      const month = cellDate.getMonth();
      return this.numbers?.includes(date) && month === this.selectedMonth ? 'example-custom-date-class' : '';
    }
    return '';
  }

/*  dateClass2: MatCalendarCellClassFunction<Date | null> = (cellDate: any, view) => {
    this.updateDate.next(cellDate);
    if (view === 'month') {
      const date = cellDate.getDate();
      const month = cellDate.getMonth();
      return this.numbers?.includes(date) && month === this.selectedMonth ? 'example-custom-date-class' : '';
    }
    return '';
  }*/
  //* Запись */
  addDate() {
    const today:any = this.selectedDate;
    const month: any = this.selectedMonth;
    const dateObj = {
      date: this.selectedDate,
      month: month,
      count: this.count_shot,
    };
    const storedDates = JSON.parse(localStorage.getItem('dates') || '[]') ?? []; // Берем данные из Storage
    /* Проверка на наличие в массиве записи с такой же датой */
    const dateExists = storedDates.some((item: any) => item.date == today && item.month == month);
    if (dateExists) {
      /* Если уже есть такая дата, удалить и добавить новую */
      const newDates = storedDates.filter((item: any) => item.date !== today || item.month !== month);
      newDates.push(dateObj);
      localStorage.setItem('dates', JSON.stringify(newDates));
    } else {
      storedDates.push(dateObj);
      localStorage.setItem('dates', JSON.stringify(storedDates));
    }
    this.loadDates();
  }

  ngOnInit() {
    this.loadDates();

    this.updateDate.pipe(
      takeUntil(this.destroy$),
      debounceTime(100),
      distinctUntilChanged()
    ).subscribe(()=>{console.log('update')})
  }

  ngAfterViewInit() {
    //console.log(this.monthView)
    fromEvent(document.querySelectorAll('.mat-calendar-previous-button, .mat-calendar-next-button'), 'click')
      .pipe(debounceTime(100)).subscribe(()=>{console.log('click')}/*this.loadDates()*/);

    /*this.monthView.monthSelected?.subscribe((event: Date) => {
      this.monthSelected(event);
    });*/

  }

  loadDates() {
    const storedDates = JSON.parse(localStorage.getItem('dates') || '[]');
    this.numbers = storedDates.filter((dateObj: any) => dateObj.month === this.selectedMonth).map((dateObj: any) => dateObj.date);
    this.shot_day = storedDates.filter((dateObj: any) => dateObj.month === this.selectedMonth && dateObj.date === this.selectedDate).map((dateObj: any) => dateObj.count);

    // За месяц
    let m = 0
      storedDates.filter((dateObj: any) => dateObj.month === this.selectedMonth).map((day: any)=>m+=Number(day.count))
    this.shot_mnt = m

    // За год
    let t = 0
      storedDates.map((day: any)=>t+=Number(day.count))
    this.shot_total = t
  }

  addEvent(type: string, event: MatDatepickerInputEvent<Date>) {
    this.selectedDate = event.value?.getDate();
    this.selectedMonth = event.value?.getMonth();
    this.events.update(events => [...events, `${type}: ${event.value}`]);
    this.loadDates();
  }

  monthSelected(event: Date) {
    this.selectedMonth = event.getMonth();
    this.loadDates();
  }

  nextMonth(event: any) {
    //console.log(event)
  }

  datepickerOpened() {
    //console.log('datepickerOpened');
  }

  openDialog() {
    const dialogRef = this.dialog.open(DialogComponent);

    dialogRef.afterClosed().subscribe(result => {
      console.log(`Dialog result: ${result}`);
    });
  }
}


