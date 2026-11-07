export type ActivityType = 'counter' | 'habit' | 'event';

export type ActivityInputMode = 'manual' | 'quick' | 'both';

export type HabitMode = 'build' | 'avoid';

export type HabitSchedule =
  | { type: 'daily' }
  | { type: 'weekly'; daysPerWeek: number };

export interface HabitSettings {
  mode: HabitMode;
  schedule: HabitSchedule;
}

export interface ActivitySettings {
  target?: number;
  targetPeriod?: 'day' | 'week' | 'month';
  habit?: HabitSettings;
}

export interface Activity {
  id: string;
  name: string;
  description?: string;
  type: ActivityType;
  unit?: string;
  color?: string;
  icon?: string;
  inputMode: ActivityInputMode;
  settings: ActivitySettings;
  createdAt: string;
  updatedAt: string;
}

export type HabitEntryStatus = 'completed' | 'missed' | 'success' | 'slipped';

export interface ActivityEntry {
  id: string;
  activityId: string;
  date: string;
  value?: number;
  status?: HabitEntryStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSetting {
  key: string;
  value: unknown;
}
