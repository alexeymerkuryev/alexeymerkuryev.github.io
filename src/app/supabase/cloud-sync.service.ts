import { Injectable } from '@angular/core';
import { BehaviorSubject, debounceTime } from 'rxjs';
import { createClient, Session, User } from '@supabase/supabase-js';
import { Activity, ActivityEntry } from '../activities/activity.model';
import { ActivityDatabaseService } from '../activities/activity-database.service';
import { supabaseConfig } from './supabase.config';

@Injectable({ providedIn: 'root' })
export class CloudSyncService {
  private readonly client = createClient(supabaseConfig.url, supabaseConfig.publishableKey);
  private readonly userSubject = new BehaviorSubject<User | null>(null);
  private readonly syncStateSubject = new BehaviorSubject<string>('Ожидание входа');
  private readonly lastSyncSubject = new BehaviorSubject<Date | null>(null);
  private syncPromise: Promise<void> | null = null;
  private syncAgain = false;

  readonly user$ = this.userSubject.asObservable();
  readonly syncState$ = this.syncStateSubject.asObservable();
  readonly lastSync$ = this.lastSyncSubject.asObservable();

  constructor(private readonly database: ActivityDatabaseService) {
    void this.client.auth.getSession().then(({ data, error }) => {
      if (error) {
        this.syncStateSubject.next(error.message);
        return;
      }
      this.userSubject.next(data.session?.user ?? null);
      if (data.session?.user) void this.syncNow();
    });

    this.client.auth.onAuthStateChange((_event, session: Session | null) => {
      this.userSubject.next(session?.user ?? null);
      if (session?.user) {
        void this.syncNow();
      } else {
        this.syncStateSubject.next('Ожидание входа');
      }
    });

    this.database.changes$.pipe(debounceTime(900)).subscribe(() => {
      if (this.userSubject.value) void this.syncNow();
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (this.userSubject.value) void this.syncNow();
      });
    }
  }

  async signUp(email: string, password: string): Promise<boolean> {
    const { data, error } = await this.client.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) throw error;
    if (data.session?.user) {
      this.userSubject.next(data.session.user);
      await this.syncNow();
      return true;
    }
    return false;
  }

  async signIn(email: string, password: string): Promise<void> {
    const { data, error } = await this.client.auth.signInWithPassword({
      email: email.trim(),
      password
    });
    if (error) throw error;
    this.userSubject.next(data.user);
    await this.syncNow();
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
    this.userSubject.next(null);
    this.syncStateSubject.next('Ожидание входа');
  }

  async syncNow(): Promise<void> {
    const user = this.userSubject.value;
    if (!user) return;
    if (this.syncPromise) {
      this.syncAgain = true;
      return this.syncPromise;
    }

    this.syncStateSubject.next('Синхронизация…');
    this.syncPromise = this.performSync(user.id)
      .then(() => {
        this.lastSyncSubject.next(new Date());
        this.syncStateSubject.next('Синхронизировано');
      })
      .catch(error => {
        this.syncStateSubject.next(
          error instanceof Error ? error.message : 'Ошибка синхронизации'
        );
      })
      .finally(() => {
        this.syncPromise = null;
        if (this.syncAgain) {
          this.syncAgain = false;
          void this.syncNow();
        }
      });

    return this.syncPromise;
  }

  private async performSync(userId: string): Promise<void> {
    // A local database is bound to its first cloud account to prevent
    // accidentally uploading one person's local data into another account.
    await this.database.claimCloudOwner(userId);

    const tombstones = await this.database.getSyncTombstones();
    if (tombstones.length) {
      const deletionRows = tombstones.map(item => ({
        user_id: userId,
        entity: item.entity,
        entity_id: item.entityId,
        deleted_at: item.deletedAt
      }));
      const { error } = await this.client.from('sync_deletions')
        .upsert(deletionRows, { onConflict: 'user_id,entity,entity_id' });
      if (error) throw error;
    }

    // Deletion markers live in the cloud so removals propagate to every device.
    const { data: remoteDeletions, error: deletionsError } = await this.client
      .from('sync_deletions')
      .select('entity, entity_id')
      .eq('user_id', userId);
    if (deletionsError) throw deletionsError;

    const deletedEntries = new Set<string>();
    const deletedActivities = new Set<string>();
    for (const deletion of (remoteDeletions ?? []) as any[]) {
      if (deletion.entity === 'entry') deletedEntries.add(deletion.entity_id);
      if (deletion.entity === 'activity') deletedActivities.add(deletion.entity_id);
    }

    for (const id of deletedEntries) {
      await this.database.removeEntryFromCloud(id);
    }
    for (const id of deletedActivities) {
      await this.database.removeActivityFromCloud(id);
    }

    if (deletedEntries.size) {
      const { error } = await this.client.from('activity_entries')
        .delete().eq('user_id', userId).in('id', [...deletedEntries]);
      if (error) throw error;
    }
    if (deletedActivities.size) {
      const { error } = await this.client.from('activities')
        .delete().eq('user_id', userId).in('id', [...deletedActivities]);
      if (error) throw error;
    }

    const [localActivities, localEntries, remoteActivitiesResult, remoteEntriesResult] =
      await Promise.all([
        this.database.getActivities(),
        this.database.getAllEntries(),
        this.client.from('activities').select('*').eq('user_id', userId),
        this.client.from('activity_entries').select('*').eq('user_id', userId)
      ]);

    if (remoteActivitiesResult.error) throw remoteActivitiesResult.error;
    if (remoteEntriesResult.error) throw remoteEntriesResult.error;

    const activityMap = new Map<string, Activity>(
      localActivities.map(activity => [activity.id, activity])
    );
    for (const row of (remoteActivitiesResult.data ?? []) as any[]) {
      const remote = this.fromRemoteActivity(row);
      const local = activityMap.get(remote.id);
      if (!local || this.timestamp(remote.updatedAt) > this.timestamp(local.updatedAt)) {
        await this.database.putActivityFromCloud(remote);
        activityMap.set(remote.id, remote);
      }
    }

    const entryMap = new Map<string, ActivityEntry>(
      localEntries.map(entry => [entry.id, entry])
    );
    for (const row of (remoteEntriesResult.data ?? []) as any[]) {
      const remote = this.fromRemoteEntry(row);
      const local = entryMap.get(remote.id);
      if (!local || this.timestamp(remote.updatedAt) > this.timestamp(local.updatedAt)) {
        await this.database.putEntryFromCloud(remote);
        entryMap.set(remote.id, remote);
      }
    }

    const activitiesToUpload = [...activityMap.values()].map(activity => ({
      id: activity.id,
      user_id: userId,
      name: activity.name,
      description: activity.description ?? null,
      type: activity.type,
      unit: activity.unit ?? null,
      color: activity.color ?? null,
      icon: activity.icon ?? null,
      input_mode: activity.inputMode,
      settings: activity.settings ?? {},
      created_at: activity.createdAt,
      updated_at: activity.updatedAt
    }));

    if (activitiesToUpload.length) {
      const { error } = await this.client.from('activities')
        .upsert(activitiesToUpload, { onConflict: 'id' });
      if (error) throw error;
    }

    const entriesToUpload = [...entryMap.values()].map(entry => ({
      id: entry.id,
      user_id: userId,
      activity_id: entry.activityId,
      entry_date: entry.date,
      value: entry.value ?? null,
      status: entry.status ?? null,
      note: entry.note ?? null,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt
    }));

    if (entriesToUpload.length) {
      const { error } = await this.client.from('activity_entries')
        .upsert(entriesToUpload, { onConflict: 'id' });
      if (error) throw error;
    }

    await this.database.clearSyncTombstones(
      tombstones.map(item => item.id).filter((id): id is number => typeof id === 'number')
    );
  }

  private fromRemoteActivity(row: any): Activity {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      type: row.type,
      unit: row.unit ?? undefined,
      color: row.color ?? undefined,
      icon: row.icon ?? undefined,
      inputMode: row.input_mode ?? 'both',
      settings: row.settings ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private fromRemoteEntry(row: any): ActivityEntry {
    return {
      id: row.id,
      activityId: row.activity_id,
      date: row.entry_date,
      value: row.value === null ? undefined : Number(row.value),
      status: row.status ?? undefined,
      note: row.note ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private timestamp(value: string): number {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
