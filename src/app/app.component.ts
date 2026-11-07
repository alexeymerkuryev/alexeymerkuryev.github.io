import { Component } from '@angular/core';
import { ActivityListComponent } from './activities/activity-list.component';
import { CalendarComponent } from './calendar/calendar.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ActivityListComponent, CalendarComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  view: 'activities' | 'calendar' = 'activities';
}
