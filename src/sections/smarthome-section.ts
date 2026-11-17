import type { Section } from './section';
import type { Zone } from '../types';
import { zones, summarize, primaryClimate, roomsFrom, areasProblem } from '../home-data';
import { ha } from '../ha';
import { child } from '../dom';
import { hint } from '../hints';
import { slideRow } from '../row-scroll';

const ZW = 340;
const ZPITCH = 364;
const GAP = ZPITCH - ZW;
const ZSHELF = 1472;

const KEY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg>`;

export interface Outside {
  temp?: number;
  condition?: string;
}

/**
 * Section 1: the indoor temperature, large and centered (the Kitchen thermostat), over a frosted
 * glass bar of rooms. Everything is live from Home Assistant. Until the TV is signed in, the bar
 * holds a single "Sign in to Home Assistant" card instead.
 */
export class SmartHomeSection implements Section {
  readonly el: HTMLElement;
  private cards: HTMLElement[] = [];
  private statusEls: HTMLElement[] = [];
  private track!: HTMLElement;
  private shelf!: HTMLElement;
  private curEl!: HTMLElement;
  /** The big temperature, hidden while there's no reading. */
  private tempEl!: HTMLElement;
  private subEl!: HTMLElement;
  private outEl!: HTMLElement;
  private first = 0;
  private signedOut = false;
  private outside: Outside = {};

  constructor(private secIndex: number, private onOpenZone: (z: Zone) => void, private onSignIn: () => void) {
    this.el = this.build();
  }

  private build(): HTMLElement {
    const s = document.createElement('section');
    s.className = 'section';
    s.id = 'secHome';
    s.innerHTML = `
      <div class="therm">
        <div class="therm-temp"><span class="t-cur">--</span><span class="deg"></span></div>
        <p class="therm-sub"></p>
        <p class="therm-out"></p>
      </div>
      <div class="gb" id="zbar">
        <div class="gb-mat"><div class="gb-img"></div><div class="gb-veil"></div></div>
        <div class="gb-edge"></div>
        <div class="gb-shelf"><div class="gb-track"></div></div>
      </div>`;
    this.shelf = child(s, '.gb-shelf');
    this.track = child(s, '.gb-track');
    this.curEl = child(s, '.t-cur');
    this.tempEl = child(s, '.therm-temp');
    this.subEl = child(s, '.therm-sub');
    this.outEl = child(s, '.therm-out');
    this.buildCards();

    return s;
  }

  private card(i: number, icon: string, name: string): HTMLElement {
    const c = document.createElement('div');
    c.className = 'zone z-idle';
    c.dataset.sec = String(this.secIndex);
    c.dataset.item = String(i);
    c.style.left = `${i * ZPITCH}px`;
    c.innerHTML = `<div class="zplate"></div><div class="zbody"><div class="zicon">${icon}</div><div class="zmeta"><div class="zname">${name}</div><div class="zstatus"></div></div></div>`;
    this.track.appendChild(c);
    this.cards.push(c);
    this.statusEls.push(child(c, '.zstatus'));

    return c;
  }

  private buildCards(): void {
    this.track.innerHTML = '';
    this.cards = [];
    this.statusEls = [];
    this.signedOut = ha.status === 'signed-out';

    if (this.signedOut) this.card(0, KEY_ICON, 'Home Assistant');
    else if (!zones.length) this.card(0, KEY_ICON, 'No rooms set up');
    else zones.forEach((z, i) => this.card(i, z.icon, z.name));
  }

  /** The rooms changed (rooms from Areas arrived, or were rebuilt): new cards, same focus place. */
  roomsChanged(): void {
    const focused = this.cards.findIndex((c) => c.classList.contains('is-focus'));
    this.buildCards();
    this.refresh();

    if (focused >= 0) this.focus(Math.min(focused, this.cards.length - 1));
  }

  /** Weather line under the thermostat, from the weather entity (Open-Meteo). */
  setOutside(o: Outside): void {
    this.outside = o;
    this.refresh();
  }

  /** Re-read the thermostat, room summaries, and connection state. */
  refresh(): void {
    if ((ha.status === 'signed-out') !== this.signedOut) {
      const focused = this.cards.some((c) => c.classList.contains('is-focus'));
      this.buildCards();

      if (focused) this.focus(0);
    }

    const c = primaryClimate();
    const live = ha.status === 'connected' && c && !c.unavailable;
    this.curEl.textContent = live && c.current !== undefined ? String(c.current) : '';
    this.tempEl.style.visibility = this.curEl.textContent ? '' : 'hidden';
    this.subEl.textContent = live ? (c.setpoint !== undefined ? `Set to ${c.setpoint}°` : c.status ?? '') : '';
    const o = this.outside;
    this.outEl.textContent =
      ha.status === 'signed-out' ? 'Not connected to Home Assistant'
      : ha.status === 'connecting' ? 'Connecting to Home Assistant…'
      : ha.status === 'offline' ? 'Can’t reach Home Assistant · trying again'
      : o.temp !== undefined ? `Outside ${Math.round(o.temp)}° · ${o.condition ?? ''}`
      : '';

    if (this.signedOut) {
      this.cards[0].className = 'zone z-active' + (this.cards[0].classList.contains('is-focus') ? ' is-focus' : '');
      this.statusEls[0].textContent = hint('signIn');

      return;
    }

    if (!zones.length) {
      // Without "rooms" in calm-tv.json the rooms are Home Assistant's Areas: say why there are none.
      this.statusEls[0].textContent = roomsFrom === 'config' ? 'Add rooms to calm-tv.json · see Settings'
        : areasProblem || (ha.status === 'connected' ? 'Put devices in Areas in Home Assistant' : 'Rooms come from Home Assistant’s areas');

      return;
    }

    zones.forEach((z, i) => {
      const card = this.cards[i];
      const { state, status } = ha.status === 'connected' ? summarize(z) : { state: 'idle' as const, status: '…' };
      card.classList.remove('z-idle', 'z-active', 'z-warn');
      card.classList.add(`z-${state}`);
      this.statusEls[i].textContent = status;
    });
  }

  count(): number {
    return this.cards.length;
  }

  focus(i: number): void {
    this.cards.forEach((c) => c.classList.remove('is-focus'));
    const n = this.cards.length;
    const visible = Math.floor((ZSHELF + GAP) / ZPITCH);
    let tx: number;

    if (n <= visible) {
      const content = n * ZPITCH - GAP;
      tx = (ZSHELF - content) / 2;
      this.first = 0;
      this.shelf.classList.remove('fade-r', 'fade-lr');
    } else {
      if (i < this.first) this.first = i;

      if (i > this.first + visible - 1) this.first = i - visible + 1;
      this.first = Math.max(0, Math.min(this.first, n - visible));
      tx = -this.first * ZPITCH;
      const canLeft = this.first > 0;
      const canRight = this.first + visible < n;
      this.shelf.classList.remove('fade-r', 'fade-lr');

      if (canLeft && canRight) this.shelf.classList.add('fade-lr');
      else if (canRight) this.shelf.classList.add('fade-r');
    }

    slideRow(this.shelf, this.track, tx, this.cards[i]);
    this.cards[i]?.classList.add('is-focus');
  }

  blur(): void {
    this.cards.forEach((c) => c.classList.remove('is-focus'));
  }

  activate(i: number): void {
    if (this.signedOut) {
      this.onSignIn();

      return;
    }

    const z = zones[i];

    if (z) this.onOpenZone(z);
  }
}

