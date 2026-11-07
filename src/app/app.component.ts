import { Component } from '@angular/core';
import { ActivityListComponent } from './activities/activity-list.component';
import { CalendarComponent } from './calendar/calendar.component';
import { ActivityHistoryComponent } from './activities/activity-history.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ActivityListComponent, CalendarComponent, ActivityHistoryComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  view: 'activities' | 'calendar' | 'history' = 'activities';
}
