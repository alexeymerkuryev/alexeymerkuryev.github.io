import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CloudSyncService } from './cloud-sync.service';

@Component({
  selector: 'app-cloud-account',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="cloud-panel">
      <header class="cloud-summary">
        <div class="summary-copy">
          <strong>☁ Облачная синхронизация</strong>
          @if (sync.user$ | async; as summaryUser) {
            <span>{{ summaryUser.email }} · {{ sync.syncState$ | async }}</span>
          } @else {
            <span>Данные хранятся локально и доступны офлайн</span>
          }
        </div>
        <button type="button" class="collapse-button" (click)="toggleExpanded()" [attr.aria-expanded]="expanded">
          {{ expanded ? 'Свернуть' : 'Настроить' }}
        </button>
      </header>
      @if (expanded) {
      @if (sync.user$ | async; as user) {
        <div class="account-row">
          <div class="account-info">
            <strong>Облачная синхронизация</strong>
            <span>{{ user.email }}</span>
            <small>{{ sync.syncState$ | async }}</small>
            @if (sync.lastSync$ | async; as lastSync) {
              <small>Последняя синхронизация: {{ lastSync | date:'dd.MM.yyyy HH:mm' }}</small>
            }
          </div>
          <div class="account-actions">
            <button type="button" (click)="sync.syncNow()" [disabled]="busy">Синхронизировать</button>
            <button type="button" class="secondary" (click)="logout()" [disabled]="busy">Выйти</button>
          </div>
        </div>
      } @else {
        <div class="auth-heading">
          <strong>Синхронизация между устройствами</strong>
          <span>Войдите или создайте аккаунт. Данные останутся доступны офлайн.</span>
        </div>
        <form (ngSubmit)="submit()">
          <input type="email" name="email" [(ngModel)]="email" placeholder="Электронная почта" autocomplete="email" required>
          <input type="password" name="password" [(ngModel)]="password" placeholder="Пароль (не менее 6 символов)" autocomplete="current-password" minlength="6" required>
          <button type="submit" [disabled]="busy || !email.trim() || password.length < 6">
            {{ busy ? 'Подождите…' : (mode === 'signin' ? 'Войти' : 'Создать аккаунт') }}
          </button>
        </form>
        <button type="button" class="text-button" (click)="toggleMode()" [disabled]="busy">
          {{ mode === 'signin' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти' }}
        </button>
      }
      @if (message) { <p class="message">{{ message }}</p> }
      @if (error) { <p class="error">{{ error }}</p> }
      }
    </section>
  `,
  styles: [`
    .cloud-panel { margin: 8px auto; padding: 10px 14px; max-width: 980px; color: #eee6f1; background: #211b28; border: 1px solid #44364d; border-radius: 14px; }
    .cloud-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .summary-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .summary-copy span { color: #b7aaba; font-size: 11px; overflow-wrap: anywhere; }
    .collapse-button { flex: 0 0 auto; }
    .auth-heading, .account-info { display: flex; flex-direction: column; gap: 4px; }
    .auth-heading span, .account-info span, .account-info small { color: #b7aaba; font-size: 12px; }
    form { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    input { flex: 1 1 190px; min-width: 0; padding: 10px 12px; border: 1px solid #51445a; border-radius: 9px; color: #f4edf7; background: #17131d; font: inherit; }
    button { min-height: 38px; padding: 0 14px; border: 1px solid #806091; border-radius: 9px; color: #fff; background: #60476f; font: inherit; font-size: 13px; cursor: pointer; }
    button:disabled { opacity: .55; cursor: default; }
    button.secondary, .text-button { color: #d5c4df; background: transparent; border-color: #55465e; }
    .text-button { margin-top: 8px; border: 0; padding: 4px 0; }
    .account-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .account-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .message { color: #a9d7b2; font-size: 13px; }
    .error { color: #ffb6b6; font-size: 13px; overflow-wrap: anywhere; }
    @media (max-width: 560px) { .account-row { align-items: flex-start; flex-direction: column; } }
  `]
})
export class CloudAccountComponent {
  email = '';
  password = '';
  mode: 'signin' | 'signup' = 'signin';
  busy = false;
  error = '';
  message = '';
  expanded = false;

  constructor(public readonly sync: CloudSyncService) {
    try { this.expanded = localStorage.getItem('shotdays.cloud-panel-expanded') === 'true'; } catch { this.expanded = false; }
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
    try { localStorage.setItem('shotdays.cloud-panel-expanded', String(this.expanded)); } catch { /* storage may be unavailable */ }
  }

  toggleMode(): void {
    this.mode = this.mode === 'signin' ? 'signup' : 'signin';
    this.error = '';
    this.message = '';
  }

  async submit(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.message = '';
    try {
      if (this.mode === 'signin') {
        await this.sync.signIn(this.email, this.password);
      } else {
        const signedIn = await this.sync.signUp(this.email, this.password);
        this.message = signedIn
          ? 'Аккаунт создан, синхронизация запущена.'
          : 'Проверьте почту и подтвердите регистрацию, затем войдите в приложение.';
      }
      this.password = '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Не удалось выполнить запрос.';
    } finally {
      this.busy = false;
    }
  }

  async logout(): Promise<void> {
    this.busy = true;
    this.error = '';
    try {
      await this.sync.signOut();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Не удалось выйти из аккаунта.';
    } finally {
      this.busy = false;
    }
  }
}
