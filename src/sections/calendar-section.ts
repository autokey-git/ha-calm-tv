import type { Section } from './section';
import { ha, type HaLink } from '../ha';
import { settings } from '../config';
import { calendarEvents, type CalendarEvent, type CalendarResponse } from '../ha-data';

/** The calendar entities to read: events for the bar, meals for "Dinner · …". */
interface CalendarIds {
  events?: string;
  meals?: string;
}

declare global {
  interface Window {
    /** Dev on the Mac only: show sample events without the HA calendars. */
    ctCalendar?: (events: CalendarEvent[], dinner?: string) => void;
  }
}

import { child } from '../dom';
import { slideRow } from '../row-scroll';

// The bar: one column per day that has events, two events per column (a busy day takes more columns).
const COL_W = 300;
const COL_GAP = 16;
const PER_COL = 2;
const SHELF_W = 1472;
const EDGE = 60; // keep the focused event this far from the bar's right edge

// Which calendars to read comes from calm-tv.json ("calendar": { "events", "meals" }). Without
// it, any calendar with "meal" in its id counts as meals and any other with "event" in it as events.

const DAYS_AHEAD = 14;
const MAX_EVENTS = 24;
const REFRESH_MS = 5 * 60 * 1000;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface Ev {
  start: Date;
  end: Date;
  allDay: boolean;
  /** Some feeds send an event with only a start time as end == start. */
  startOnly: boolean;
  title: string;
}

/** An event placed in the bar. */
interface Item {
  el: HTMLElement;
  ev: Ev;
  /** The day column it sits under (today for events that started earlier). */
  day: Date;
  x: number;
}

/** A calendar time: "2026-11-14" is local midnight of an all-day date; full timestamps are kept. */
interface When {
  d: Date;
  allDay: boolean;
}

/** "2026-11-14" as local midnight; full timestamps as they are. */
function parseWhen(s: string): When {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);

  if (m) return { d: new Date(+m[1], +m[2] - 1, +m[3]), allDay: true };

  return { d: new Date(s), allDay: false };
}

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function daysFrom(from: Date, d: Date): number {
  return Math.round((midnight(d).getTime() - midnight(from).getTime()) / 86400000);
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

  return `${n}${s}`;
}

/** Short time for the bar: "5:30p", "9a". */
function shortTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();

  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'a' : 'p'}`;
}

/** The last day an event covers (all-day ends are exclusive). */
function lastDay(e: Ev): Date {
  if (e.allDay) return addDays(e.end, -1);

  if (e.startOnly || e.end <= e.start) return midnight(e.start);

  return midnight(new Date(e.end.getTime() - 1));
}

/** The small time beside an event in its day column: "5:30p", "All day", "to Wed", "now". */
function rowTime(e: Ev, day: Date, now: Date): string {
  const last = lastDay(e);

  if (daysFrom(day, last) > 0) return `to ${daysFrom(now, last) < 7 ? DOW[last.getDay()] : `${MON[last.getMonth()].slice(0, 3)} ${last.getDate()}`}`;

  if (e.allDay) return 'All day';

  if (!e.startOnly && e.start <= now && e.end > now) return 'now';

  return shortTime(e.start);
}

function toEv(h: CalendarEvent): Ev {
  const s = parseWhen(h.start);
  const e = parseWhen(h.end);

  return {
    start: s.d,
    end: e.d,
    allDay: s.allDay,
    startOnly: !s.allDay && e.d.getTime() <= s.d.getTime(),
    title: (h.summary || 'Untitled').trim(),
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Section 2: today's date, the next event and tonight's dinner beside a small month calendar,
 * over the coming events grouped by day (from Home Assistant's calendar entities). The focused event's day is
 * ringed in the month calendar; a trip over several days is shaded across them.
 */
export class CalendarSection implements Section {
  readonly el: HTMLElement;
  private items: Item[] = [];
  private track!: HTMLElement;
  private shelf!: HTMLElement;
  private dowEl!: HTMLElement;
  private dateEl!: HTMLElement;
  private nextEl!: HTMLElement;
  private dinnerEl!: HTMLElement;
  private emptyEl!: HTMLElement;
  private monthName!: HTMLElement;
  private gridEl!: HTMLElement;
  private offset = 0;
  private trackW = 0;
  private focused = -1;
  private events: Ev[] = [];
  private dinner = '';
  private loaded = false;
  private loading = false;
  /** The month the grid shows, as "year-month", and its day cells by date. */
  private gridMonth = '';
  private cells = new Map<number, HTMLElement>();

  /** onChange: the events changed, so the app can keep focus valid. */
  constructor(private secIndex: number, private onChange: () => void = () => {}) {
    this.el = this.build();
    ha.onConnected(() => void this.load());
    ha.onEntities(() => { if (!this.loaded) void this.load(); });
    ha.onStatus(() => this.paint());
    window.setInterval(() => void this.load(), REFRESH_MS);
    // Keep the date and the "Today/Tomorrow" wording right as time passes.
    window.setInterval(() => this.paint(), 60000);

    // Dev on the Mac only: show sample events without the HA calendars, e.g. ctCalendar([...], 'Tacos').
    if (import.meta.env.DEV) {
      window.ctCalendar = (evs: CalendarEvent[], dinner = '') => {
        this.events = evs.map(toEv).sort((a, b) => a.start.getTime() - b.start.getTime());
        this.dinner = dinner;
        this.loaded = true;
        this.paint();
      };
    }
  }

  private build(): HTMLElement {
    const s = document.createElement('section');
    s.className = 'section';
    s.id = 'secCalendar';
    s.innerHTML = `
      <div class="cal-top">
        <div class="cal-today">
          <p class="cal-dow"></p>
          <p class="cal-date"></p>
          <p class="cal-line cal-next"></p>
          <p class="cal-line cal-dinner"></p>
        </div>
        <div class="cal-divider"></div>
        <div class="cal-month">
          <p class="cal-mname"></p>
          <div class="cal-grid"></div>
        </div>
      </div>
      <div class="gb" id="calbar">
        <div class="gb-mat"><div class="gb-img"></div><div class="gb-veil"></div></div>
        <div class="gb-edge"></div>
        <div class="gb-shelf"><div class="gb-track"></div><div class="cal-empty"></div></div>
      </div>`;
    this.shelf = child(s, '.gb-shelf');
    this.track = child(s, '.gb-track');
    this.dowEl = child(s, '.cal-dow');
    this.dateEl = child(s, '.cal-date');
    this.nextEl = child(s, '.cal-next');
    this.dinnerEl = child(s, '.cal-dinner');
    this.emptyEl = child(s, '.cal-empty');
    this.monthName = child(s, '.cal-mname');
    this.gridEl = child(s, '.cal-grid');
    this.paint();

    return s;
  }

  /** Which calendar entities hold the events and the meals. */
  private calendars(): CalendarIds {
    const ids = Object.keys(ha.entities).filter((id) => id.startsWith('calendar.'));
    const set = settings.config.calendar;

    if (set) return { events: set.events, meals: set.meals };
    const events = ids.find((id) => id.includes('event') && !id.includes('meal'));
    const meals = ids.find((id) => id.includes('meal'));

    return { events, meals };
  }

  private async load(): Promise<void> {
    const conn = ha.connection;

    if (!conn || this.loading) return;

    if (!Object.keys(ha.entities).length) return; // states not in yet; onEntities tries again
    const { events, meals } = this.calendars();

    if (!events && !meals) {
      this.loaded = true;
      this.paint();

      return;
    }

    this.loading = true;

    try {
      const now = new Date();
      const today = midnight(now);

      const [ev, ml] = await Promise.all([
        events ? this.fetch(conn, events, today, addDays(today, DAYS_AHEAD)) : Promise.resolve([]),
        meals ? this.fetch(conn, meals, today, addDays(today, 1)) : Promise.resolve([]),
      ]);

      this.events = ev
        .map(toEv)
        .filter((e) => (e.startOnly ? midnight(e.start) >= today : e.end > now))
        .sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay))
        .slice(0, MAX_EVENTS);
      const tonight = ml.map(toEv).find((m) => m.allDay && daysFrom(today, m.start) <= 0 && m.end > today);
      this.dinner = tonight ? tonight.title.replace(/^dinner\s*[:·-]\s*/i, '') : '';
      this.loaded = true;
    } catch (e) {
      console.warn('Calendar fetch failed', e);
    } finally {
      this.loading = false;
    }

    this.paint();
  }

  private async fetch(conn: HaLink, entity: string, from: Date, to: Date): Promise<CalendarEvent[]> {
    const r = await conn.sendMessagePromise<CalendarResponse>({
      type: 'call_service',
      domain: 'calendar',
      service: 'get_events',
      service_data: { start_date_time: from.toISOString(), end_date_time: to.toISOString() },
      target: { entity_id: entity },
      return_response: true,
    });

    return calendarEvents(r, entity);
  }

  /** Draws the top, the month and the day columns from what was last loaded. */
  private paint(): void {
    const now = new Date();
    const today = midnight(now);
    // The date is the big line; the weekday sits small above it.
    this.dowEl.textContent = DAYS[now.getDay()];
    this.dateEl.textContent = `${MON[now.getMonth()]} ${ordinal(now.getDate())}`;

    const connected = ha.status === 'connected';
    const shown = connected ? this.events.filter((e) => (e.startOnly ? midnight(e.start) >= today : e.end > now)) : [];
    // Only a status line here now (the events themselves are in the bar); otherwise dinner, if planned.
    this.nextEl.textContent = !connected ? 'Your calendar appears once Home Assistant is connected' : '';
    this.dinnerEl.textContent = connected && this.dinner ? `Dinner · ${this.dinner}` : '';

    // Day columns. An event that started before today sits under Today.
    this.track.textContent = '';
    this.items = [];
    const byDay = new Map<number, Ev[]>();

    for (const e of shown) {
      const d = midnight(e.start) < today ? today : midnight(e.start);
      const list = byDay.get(d.getTime()) ?? [];
      list.push(e);
      byDay.set(d.getTime(), list);
    }

    let x = 0;
    let firstGroup = true;

    for (const [t, evs] of byDay) {
      const day = new Date(t);
      const cols = Math.ceil(evs.length / PER_COL);
      const w = cols * COL_W + (cols - 1) * COL_GAP;

      if (!firstGroup) this.track.insertAdjacentHTML('beforeend', `<div class="cal-sep" style="left:${x - COL_GAP / 2}px"></div>`);
      firstGroup = false;
      const n = daysFrom(today, day);
      const head = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${DOW[day.getDay()]} ${day.getDate()}`;
      this.track.insertAdjacentHTML('beforeend', `<div class="cal-head${n === 0 ? ' is-today' : ''}" style="left:${x}px;width:${w}px">${head}</div>`);
      evs.forEach((e, k) => {
        const el = document.createElement('div');
        el.className = 'cal-ev';
        el.dataset.sec = String(this.secIndex);
        el.dataset.item = String(this.items.length);
        const ex = x + Math.floor(k / PER_COL) * (COL_W + COL_GAP);
        el.style.left = `${ex}px`;
        el.style.top = `${54 + (k % PER_COL) * 60}px`;
        el.innerHTML = `<div class="cal-plate"></div><div class="cal-row"><span class="cal-tm">${esc(rowTime(e, day, now))}</span><span class="cal-tt">${esc(e.title)}</span></div>`;
        this.track.appendChild(el);
        this.items.push({ el, ev: e, day, x: ex });
      });
      x += w + COL_GAP;
    }

    this.trackW = Math.max(0, x - COL_GAP);
    this.emptyEl.textContent = connected && this.loaded && !shown.length ? 'Nothing in the next two weeks' : '';

    this.paintMonth(today, shown);
    this.focused = Math.min(this.focused, this.items.length - 1);
    this.layout();
    this.onChange();
  }

  /** The month grid: today filled, dots on days with events, the focused event ringed or shaded. */
  private paintMonth(today: Date, shown: Ev[]): void {
    const it = this.items[this.focused];
    // Show the focused event's month (it may be next month), otherwise this one.
    const ref = it ? it.day : today;
    const key = `${ref.getFullYear()}-${ref.getMonth()}`;

    if (key !== this.gridMonth) {
      this.gridMonth = key;
      this.monthName.textContent = MON[ref.getMonth()];
      this.gridEl.innerHTML = 'SMTWTFS'.split('').map((c) => `<div class="cal-wk">${c}</div>`).join('');
      this.cells.clear();
      const first = new Date(ref.getFullYear(), ref.getMonth(), 1);

      for (let i = 0; i < first.getDay(); i++) this.gridEl.insertAdjacentHTML('beforeend', '<div class="cal-d"></div>');
      const len = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();

      for (let d = 1; d <= len; d++) {
        const c = document.createElement('div');
        c.className = 'cal-d';
        c.innerHTML = `<span class="cal-n">${d}</span>`;
        this.gridEl.appendChild(c);
        this.cells.set(new Date(ref.getFullYear(), ref.getMonth(), d).getTime(), c);
      }
    }

    const busy = new Set<number>();

    for (const e of shown) {
      for (let d = midnight(e.start) < today ? today : midnight(e.start); d <= lastDay(e); d = addDays(d, 1)) busy.add(d.getTime());
    }

    const span = new Set<number>();
    let single = -1;

    if (it) {
      const from = midnight(it.ev.start);
      const to = lastDay(it.ev);

      if (to > from) for (let d = from; d <= to; d = addDays(d, 1)) span.add(d.getTime());
      else single = from.getTime();
    }

    for (const [t, c] of this.cells) {
      const d = new Date(t);
      const inSpan = span.has(t);
      c.className = 'cal-d';

      if (t < today.getTime()) c.classList.add('past');

      if (t === today.getTime()) c.classList.add('is-today');

      if (busy.has(t)) c.classList.add('has');

      if (t === single) c.classList.add('hit');

      if (inSpan) {
        c.classList.add('span');

        if (!span.has(addDays(d, -1).getTime()) || d.getDay() === 0) c.classList.add('s0');

        if (!span.has(addDays(d, 1).getTime()) || d.getDay() === 6) c.classList.add('s1');
      }
    }
  }

  count(): number {
    return this.items.length;
  }

  /** Slides the bar so the focused event is in view and marks it. */
  private layout(): void {
    this.items.forEach((it, i) => it.el.classList.toggle('is-focus', i === this.focused));
    const it = this.items[this.focused];

    if (this.trackW <= SHELF_W) {
      this.offset = -(SHELF_W - this.trackW) / 2; // centered when it all fits
    } else {
      if (this.offset < 0) this.offset = 0;

      if (it) {
        if (it.x - this.offset < 0) this.offset = it.x;

        if (it.x + COL_W - this.offset > SHELF_W - EDGE) this.offset = it.x + COL_W - SHELF_W + EDGE;
      }

      this.offset = Math.max(0, Math.min(this.offset, this.trackW - SHELF_W + EDGE));
    }

    slideRow(this.shelf, this.track, -this.offset, it?.el);
    this.shelf.classList.remove('fade-r', 'fade-lr');

    if (this.trackW > SHELF_W) {
      const canLeft = this.offset > 0;
      const canRight = this.offset + SHELF_W < this.trackW;

      if (canLeft && canRight) this.shelf.classList.add('fade-lr');
      else if (canRight) this.shelf.classList.add('fade-r');
    }
  }

  focus(i: number): void {
    this.focused = i;
    this.layout();
    this.paintMonth(midnight(new Date()), this.items.map((x) => x.ev));
  }

  blur(): void {
    this.focused = -1;
    this.layout();
    this.paintMonth(midnight(new Date()), this.items.map((x) => x.ev));
  }

  activate(): void {
    // Informational — no action.
  }
}
