import type { Section } from './section';
import type { ForecastEntry } from '../ha-data';
import { child } from '../dom';

const WW = 180;
const WPITCH = 192;
const WGAP = WPITCH - WW;
const WSHELF = 1472;

const wi = {
  clear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4.4"/><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7"/></svg>`,
  cloud: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 6.6 9.5 3.5 3.5 0 0 0 7 18z"/></svg>`,
  partly: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="2.8"/><path d="M9 3.2v1.3M4.5 8H3.2M5.7 4.7l.9.9M12.3 4.7l-.9.9"/><path d="M8 19h9a3.5 3.5 0 0 0 .3-6.98A4.5 4.5 0 0 0 9 13 3 3 0 0 0 8 19z"/></svg>`,
  rain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15h10a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 6.6 6.5 3.5 3.5 0 0 0 7 15z"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/></svg>`,
  snow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15h10a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 6.6 6.5 3.5 3.5 0 0 0 7 15z"/><path d="M8 19h.01M12 18h.01M16 19h.01M10 21.5h.01M14 21.5h.01"/></svg>`,
};

const moon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>`;

type Icon = keyof typeof wi;

// Home Assistant weather conditions: icon and wording.
const CONDITIONS = new Map<string, readonly [Icon, string]>([
  ['sunny', ['clear', 'Sunny']],
  ['clear-night', ['clear', 'Clear']],
  ['partlycloudy', ['partly', 'Partly cloudy']],
  ['cloudy', ['cloud', 'Cloudy']],
  ['fog', ['cloud', 'Fog']],
  ['windy', ['cloud', 'Windy']],
  ['windy-variant', ['cloud', 'Windy']],
  ['exceptional', ['cloud', 'Unusual weather']],
  ['rainy', ['rain', 'Rain']],
  ['pouring', ['rain', 'Heavy rain']],
  ['lightning', ['rain', 'Thunderstorms']],
  ['lightning-rainy', ['rain', 'Thunderstorms']],
  ['hail', ['rain', 'Hail']],
  ['snowy', ['snow', 'Snow']],
  ['snowy-rainy', ['snow', 'Sleet']],
]);

const iconOf = (c?: string): Icon => CONDITIONS.get(c ?? '')?.[0] ?? 'cloud';
export const conditionLabel = (c?: string): string => CONDITIONS.get(c ?? '')?.[1] ?? (c ? c[0].toUpperCase() + c.slice(1) : '');

/** A condition's icon (the moon for a clear night), for the weather next to the clock. */
export const conditionIcon = (c?: string): string => (c === 'clear-night' ? moon : wi[iconOf(c)]);

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (hour: number) => `${hour % 12 || 12}${hour < 12 ? 'AM' : 'PM'}`;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** A daily entry's calendar day. Open-Meteo stamps days at midnight UTC (4 PM the day before here), so read the date as written. */
const dayOf = (f: ForecastEntry): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f.datetime);

  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(f.datetime);
};

const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const HOURS_AHEAD = 8;

/** The weather entity's state right now. */
export interface CurrentWeather {
  condition: string;
  temperature: number;
}

/** Rain inside a bar: the chance if the forecast has one, otherwise the amount (inches). */
function rainText(f: ForecastEntry): string {
  if (f.precipitation_probability !== undefined) return f.precipitation_probability >= 10 ? `${Math.round(f.precipitation_probability)}%` : '';

  if (f.precipitation !== undefined && f.precipitation >= 0.01) return `${f.precipitation.toFixed(2).replace(/^0/, '')}″`;

  return '';
}

function rainShare(f: ForecastEntry): number {
  if (f.precipitation_probability !== undefined) return f.precipitation_probability / 100;

  return Math.min(1, (f.precipitation ?? 0) / 0.15); // 0.15″ in an hour is heavy rain
}

/**
 * Section 3: a bar of days (Home Assistant's daily forecast, from Open-Meteo). On top, the hours
 * as temperature bars: for Today, now and the next 8 hours; for a later day, 6 AM to 10 PM every 2 hours.
 */
export class WeatherSection implements Section {
  readonly el: HTMLElement;
  private cards: HTMLElement[] = [];
  private track!: HTMLElement;
  private shelf!: HTMLElement;
  private heroEl!: HTMLElement;
  private first = 0;
  private focused = 0;
  private hasFocus = false;
  private daily: ForecastEntry[] = [];
  private hourly: ForecastEntry[] = [];
  private rawDaily: ForecastEntry[] = [];
  /** Current conditions, from the weather entity's state. */
  private current: ForecastEntry | null = null;
  private lastHero = '';

  constructor(private secIndex: number) {
    this.el = this.build();
    // Slide the hours window along as time passes; start a fresh Today after midnight.
    let day = new Date().getDate();
    window.setInterval(() => {
      if (new Date().getDate() !== day) {
        day = new Date().getDate();
        this.buildCards();
      }
      else this.renderHero();
    }, 60000);
  }

  private build(): HTMLElement {
    const s = document.createElement('section');
    s.className = 'section';
    s.id = 'secWeather';
    s.innerHTML = `
      <div class="wx-hero"></div>
      <div class="gb" id="wxbar">
        <div class="gb-mat"><div class="gb-img"></div><div class="gb-veil"></div></div>
        <div class="gb-edge"></div>
        <div class="gb-shelf"><div class="gb-track"></div></div>
      </div>`;
    this.heroEl = child(s, '.wx-hero');
    this.shelf = child(s, '.gb-shelf');
    this.track = child(s, '.gb-track');
    this.renderHero();

    return s;
  }

  setDaily(f: ForecastEntry[]): void {
    this.rawDaily = f;
    this.buildCards();
  }

  setHourly(f: ForecastEntry[]): void {
    this.hourly = f;
    this.buildCards();
  }

  /** The weather entity's current condition and temperature (null when unknown). */
  setCurrent(c: CurrentWeather | null): void {
    const next = c ? { datetime: new Date().toISOString(), condition: c.condition, temperature: c.temperature } : null;

    if (next?.condition === this.current?.condition && next?.temperature === this.current?.temperature) return;
    this.current = next;
    this.buildCards();
  }

  /** Today onward. Late in the day Open-Meteo has no entry for today, so it's made from now plus today's remaining hours. */
  private days(): ForecastEntry[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = this.rawDaily.filter((d) => dayOf(d) >= today).slice(0, 7);

    if ((!days[0] || !sameDay(dayOf(days[0]), today)) && this.current) {
      const temps = [this.current.temperature ?? 0, ...this.hourly.filter((h) => sameDay(new Date(h.datetime), now) && new Date(h.datetime) > now).map((h) => h.temperature ?? 0)];
      days.unshift({ datetime: localIso(today), condition: this.current.condition, temperature: Math.max(...temps), templow: Math.min(...temps) });
    }

    return days.slice(0, 7);
  }

  private buildCards(): void {
    this.track.innerHTML = '';
    this.cards = [];
    const now = new Date();
    this.daily = this.days();
    this.daily.forEach((d, i) => {
      const date = dayOf(d);
      const name = sameDay(date, now) ? 'Today' : SHORT[date.getDay()];
      const c = document.createElement('div');
      c.className = 'wday';
      c.dataset.sec = String(this.secIndex);
      c.dataset.item = String(i);
      c.style.left = `${i * WPITCH}px`;
      const lo = d.templow !== undefined ? `<span class="wd-lo">${Math.round(d.templow)}°</span>` : '';
      c.innerHTML = `<div class="wplate"></div><div class="wbody"><div class="wd-name">${name}</div><div class="wd-ico">${wi[iconOf(d.condition)]}</div><div class="wd-temps"><span class="wd-hi">${Math.round(d.temperature ?? 0)}°</span>${lo}</div></div>`;
      this.track.appendChild(c);
      this.cards.push(c);
    });
    this.focused = Math.min(this.focused, Math.max(0, this.cards.length - 1));

    if (this.hasFocus) this.focus(this.focused);
    else { this.layout(this.focused); this.renderHero(); }
  }

  private renderHero(): void {
    const html = this.heroHtml();

    if (html === this.lastHero) return;
    this.lastHero = html;
    this.heroEl.innerHTML = html;
  }

  private heroHtml(): string {
    const d = this.daily[this.focused];

    if (!d) return `<div class="wx-head">The forecast appears once Home Assistant is connected.</div>`;
    const date = dayOf(d);
    const now = new Date();
    const isToday = sameDay(date, now);
    // Title: Today / Tomorrow / the weekday. Subtitle: the condition, high and low (the date is on the calendar).
    const isTomorrow = sameDay(date, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const title = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : DAYS[date.getDay()];
    const cond = isToday && this.current ? this.current.condition : d.condition;
    const temps = `High ${Math.round(d.temperature ?? 0)}° &nbsp;Low ${d.templow !== undefined ? `${Math.round(d.templow)}°` : '–'}`;
    const sep = '<span class="wx-sep">·</span>';
    const head = `<div class="wx-head"><div class="wx-title">${title}</div><div class="wx-sub">${conditionLabel(cond)}${sep}${temps}</div></div>`;

    // Today: now, then each of the next 8 hours (past midnight if need be).
    // Another day: 6 AM to 10 PM, every 2 hours.
    let hours: { f: ForecastEntry; now?: boolean }[];

    if (isToday) {
      const ahead = this.hourly.filter((h) => new Date(h.datetime).getTime() > now.getTime());
      const first = this.current ?? this.hourly.find((h) => new Date(h.datetime).getTime() > now.getTime() - 3600000);
      hours = [
        ...(first ? [{ f: first, now: true }] : []),
        ...ahead.filter((h) => h !== first).slice(0, HOURS_AHEAD).map((f) => ({ f })),
      ];
    } else {
      hours = this.hourly
        .filter((h) => {
          const t = new Date(h.datetime);

          return sameDay(t, date) && t.getHours() >= 6 && t.getHours() <= 22 && t.getHours() % 2 === 0;
        })
        .map((f) => ({ f }));
    }

    if (hours.length < 3) return head + `<div class="wx-none">No hourly forecast for this day yet</div>`;

    const cols = hours
      .map(({ f: h, now: isNow }) => {
        const hour = new Date(h.datetime).getHours();
        const temp = Math.round(h.temperature ?? 0);
        const night = hour < 6 || hour >= 19;
        const icon = night && (h.condition === 'clear-night' || h.condition === 'sunny' || h.condition === 'partlycloudy') ? moon : wi[iconOf(h.condition)];
        const norm = (Math.max(30, Math.min(95, temp)) - 30) / 65;
        const barH = Math.round(96 + norm * 132);
        const rain = isNow ? '' : rainText(h);
        const rainH = rain ? Math.round(Math.max(26, Math.min(barH * 0.5, rainShare(h) * barH))) : 0;
        const label = isNow ? 'NOW' : hourLabel(hour);

        return `<div class="wx-col${isNow ? ' now' : ''}"><div class="wx-col-top"><div class="wx-col-ico">${icon}</div><div class="wx-col-bar" style="height:${barH}px">${rainH ? `<div class="wx-col-rain" style="height:${rainH}px">${rain}</div>` : ''}<div class="wx-col-temp">${temp}°</div></div></div><div class="wx-col-label">${label}</div></div>`;
      })
      .join('');

    return head + `<div class="wx-chart">${cols}</div>`;
  }

  count(): number {
    return this.cards.length;
  }

  private layout(i: number): void {
    const n = this.cards.length;
    const visible = Math.floor((WSHELF + WGAP) / WPITCH);
    let tx: number;
    this.shelf.classList.remove('fade-r', 'fade-lr');

    if (n <= visible) {
      tx = (WSHELF - (n * WPITCH - WGAP)) / 2;
      this.first = 0;
    } else {
      if (i < this.first) this.first = i;

      if (i > this.first + visible - 1) this.first = i - visible + 1;
      this.first = Math.max(0, Math.min(this.first, n - visible));
      tx = -this.first * WPITCH;
      const canLeft = this.first > 0;
      const canRight = this.first + visible < n;

      if (canLeft && canRight) this.shelf.classList.add('fade-lr');
      else if (canRight) this.shelf.classList.add('fade-r');
    }

    this.track.style.transform = `translateX(${tx}px)`;
  }

  focus(i: number): void {
    this.cards.forEach((c) => c.classList.remove('is-focus'));
    this.hasFocus = true;
    this.focused = i;
    this.layout(i);
    this.cards[i]?.classList.add('is-focus');
    this.renderHero();
  }

  blur(): void {
    this.hasFocus = false;
    this.cards.forEach((c) => c.classList.remove('is-focus'));
  }

  activate(): void {
    // The focused day is already detailed on top — nothing more to do.
  }
}
