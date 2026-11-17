import { ha } from './ha';
import { attributes, MediaPlayerAttributes } from './ha-data';
import { settings, type ScreenName } from './config';
import { musicPlayers } from './sections/music-panel';
import { child } from './dom';

// Dashboard mode's bar under the screens (see dashboardMode in config.ts): the time on the left, a tab per
// screen in the middle (Music among them), and on the right what's playing and Settings. It sits below the
// 1920×1080 stage, in the room a 16:10 screen has left over, so the screens themselves don't change.

/** The bar's height in CSS pixels; app.ts fits the stage into the space above it. */
export const DASHBOARD_BAR_H = 76;

const line = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const ICONS: Record<ScreenName | 'settings', string> = {
  apps: line('<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>'),
  smarthome: line('<path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z"/>'),
  calendar: line('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
  weather: line('<path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 9.5a3.5 3.5 0 0 1 0 7H7z"/>'),
  music: line('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
  settings: line('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
};

const LABELS: Record<ScreenName, string> = { apps: 'Apps', smarthome: 'Home', music: 'Music', calendar: 'Calendar', weather: 'Weather' };

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface DashboardBarActions {
  /** A screen's tab: show screen `i` (its place in the screens' order). */
  onScreen(i: number): void;
  /** What's playing: show the Music screen. */
  onMusic(): void;
  onSettings(): void;
}

export class DashboardBar {
  private el: HTMLElement;
  private tabs: HTMLElement[] = [];
  private clockEl: HTMLElement;
  private dateEl: HTMLElement;
  private nowEl: HTMLElement;

  constructor(mount: HTMLElement, screens: ScreenName[], actions: DashboardBarActions) {
    this.el = document.createElement('nav');
    this.el.id = 'dashboardBar';

    const music = settings.config.music ? '<button class="tb-now" hidden></button>' : '';

    this.el.innerHTML = `
      <div class="tb-time"><span class="tb-clock"></span><span class="tb-date"></span></div>
      <div class="tb-tabs">${screens.map((s) => `<button class="tb-btn tb-tab">${ICONS[s]}<span>${LABELS[s]}</span></button>`).join('')}</div>
      <div class="tb-end">${music}<button class="tb-btn tb-icon" aria-label="Settings">${ICONS.settings}</button></div>`;
    mount.appendChild(this.el);

    this.clockEl = child(this.el, '.tb-clock');
    this.dateEl = child(this.el, '.tb-date');
    this.nowEl = this.el.querySelector<HTMLElement>('.tb-now') ?? document.createElement('button');
    this.tabs = [...this.el.querySelectorAll<HTMLElement>('.tb-tab')];
    this.tabs.forEach((t, i) => t.addEventListener('click', () => actions.onScreen(i)));
    this.nowEl.addEventListener('click', () => actions.onMusic());
    child(this.el, '.tb-icon').addEventListener('click', () => actions.onSettings());

    this.tick();
    window.setInterval(() => this.tick(), 1000);

    if (settings.config.music) {
      ha.onEntities(() => this.paintNowPlaying());
      this.paintNowPlaying();
    }
  }

  /** Lights the tab of the screen on show. */
  setActive(i: number): void {
    this.tabs.forEach((t, n) => t.classList.toggle('on', n === i));
  }

  private tick(): void {
    const d = new Date();
    const m = d.getMinutes();
    this.clockEl.textContent = `${d.getHours() % 12 || 12}:${m < 10 ? '0' : ''}${m}`;
    this.dateEl.textContent = `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }

  /** What the first playing speaker plays, as a small button to the Music screen; hidden when nothing plays. */
  private paintNowPlaying(): void {
    const playing = musicPlayers().find((p) => ha.entities[p.entity]?.state === 'playing');
    const e = playing ? ha.entities[playing.entity] : undefined;

    if (!playing || !e) {
      this.nowEl.hidden = true;

      return;
    }

    const a = attributes(e, MediaPlayerAttributes);
    this.nowEl.hidden = false;
    this.nowEl.innerHTML = `<span class="tb-eq"><i></i><i></i><i></i></span><span class="tb-now-text"><b>${esc(a.media_title ?? 'Playing')}</b><em>${esc(playing.name)}</em></span>`;
  }
}
