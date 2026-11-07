import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {CalendarComponent} from './calendar/calendar.component';

@Component({
  selector: 'app-root',
  imports: [/*RouterOutlet,*/ CalendarComponent,],
  templateUrl: './app.component.html',
  standalone: true,
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'shot-days';
}
