import { Component } from '@angular/core';
import { DashboardComponent } from './activities/dashboard.component';
import { ActivityListComponent } from './activities/activity-list.component';
import { CalendarComponent } from './calendar/calendar.component';
import { ActivityHistoryComponent } from './activities/activity-history.component';
import { CloudAccountComponent } from './supabase/cloud-account.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DashboardComponent, ActivityListComponent, CalendarComponent, ActivityHistoryComponent, CloudAccountComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  view: 'dashboard' | 'activities' | 'calendar' | 'history' = 'dashboard';
}
