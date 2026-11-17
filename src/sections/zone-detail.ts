import type { Device, Zone } from '../types';
import { cap } from '../home-data';
import { ha } from '../ha';
import { playCamera, type CameraStream } from '../camera-stream';
import { child, find } from '../dom';
import { FocusGroup } from '../focus';
import { hint } from '../hints';

const wrap = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const BULB = `<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.9 1 1 1.7l.1.5h5l.1-.5c.1-.7.5-1.3 1-1.7A6 6 0 0 0 12 3z"/>`;
const POWER = `<path d="M12 3v8"/><path d="M7.5 7a7 7 0 1 0 9 0"/>`;
const SLASH = `<path d="M4.5 4.5l15 15"/>`;
const CAM = `<rect x="3" y="7.5" width="12" height="9" rx="2"/><path d="M15 10.5l6-3v9l-6-3z"/>`;
const THERMO = `<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 8.5v5"/>`;
const lockClosed = `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`;
const lockOpen = `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7-1.6"/>`;
const curtainClosed = `<path d="M3 4h18"/><path d="M5 4v16M19 4v16"/><path d="M5 4c2 4 2 12 0 16M19 4c-2 4-2 12 0 16"/><path d="M12 4v16M9 4c1.5 4 1.5 12 0 16M15 4c-1.5 4-1.5 12 0 16"/>`;
const curtainOpen = `<path d="M3 4h18"/><path d="M5 4v16M19 4v16"/><path d="M5 4c3 4 3 12 0 16M19 4c-3 4-3 12 0 16"/>`;
const PALETTE = `<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.2-.3-.4-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.4-9-7.4z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/><circle cx="17" cy="11" r="1"/>`;
const PERSON = `<circle cx="12" cy="7" r="3.5"/><path d="M5 20.5c.6-3.9 3.4-6.5 7-6.5s6.4 2.6 7 6.5"/>`;
const garage = `<path d="M3 10l9-6 9 6v10H3z"/><path d="M7 20v-8h10v8M7 15h10"/>`;

function deviceIcon(d: Device): string {
  switch (d.type) {
    case 'light': return wrap(BULB + (d.on ? '' : SLASH));
    case 'switch': return wrap(POWER + (d.on ? '' : SLASH));
    case 'lock': return wrap(d.locked === false ? lockOpen : lockClosed);
    case 'camera': return wrap(CAM);
    case 'climate': return wrap(THERMO);
    case 'scene': return wrap(PALETTE);
    case 'cover': return wrap(d.on ? curtainOpen : curtainClosed);
    case 'sensor': return wrap(d.occupancy ? PERSON : d.entity.startsWith('binary_sensor.') ? garage : THERMO);
    default: return wrap(BULB);
  }
}

function rowClass(d: Device): string {
  if (d.unavailable) return 'd-off';

  switch (d.type) {
    case 'light':
    case 'switch':
    case 'cover': return d.on ? 'd-on' : 'd-off';
    case 'camera': return 'd-camera'; // Nest cameras always report "streaming": not worth highlighting
    case 'lock': return d.locked === false ? 'd-unlock' : 'd-lock';
    case 'sensor': return d.occupancy ? (d.on ? 'd-on' : 'd-off') : d.on ? 'd-unlock' : 'd-lock';
    case 'climate': return 'd-climate';
    case 'scene': return 'd-scene';
    default: return 'd-off';
  }
}

function hasControl(d: Device): boolean {
  if (d.unavailable) return false;

  return (d.type === 'scene' && !!d.options?.length) || (d.type === 'climate' && d.setpoint !== undefined) || d.type === 'camera' || (d.type === 'light' && !!d.dimmable);
}

const domainOf = (d: Device) => d.entity.split('.')[0];

/** Keep the value you just set on screen for this long, while HA catches up. */
const HOLD_MS = 4000;

/** The room panel: a 2D device grid, with richer controls for dimmers, the thermostat, and cameras. */
export class ZoneDetail {
  private el: HTMLElement;
  private colsEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private footEl!: HTMLElement;
  private closeEl!: HTMLElement;
  private controlEl!: HTMLElement;

  private open = false;
  private zone: Zone | null = null;
  private columns: Device[][] = [];
  private colEls: HTMLElement[][] = [];

  private controlDevice: Device | null = null;
  /** Where the open control's device sits in the grid (to repaint its row when it closes). */
  private controlAt = { col: 0, row: 0 };
  private sendTimer = 0;
  private camTimer = 0;
  private camera: CameraStream | null = null;
  /** Remote, touch and mouse (see focus.ts): the device grid and the close button. */
  private nav: FocusGroup;
  /** The same for an open control (its scenes, or − and +). */
  private ctlNav: FocusGroup;

  constructor(mount: HTMLElement, private onClosed: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'detail';
    this.el.innerHTML = `
      <div class="detail-scrim"></div>
      <div class="detail-panel">
        <div class="detail-head">
          <div class="detail-title"></div>
          <button class="detail-close" data-focus="close" aria-label="Close">${wrap('<path d="M6 6l12 12M18 6L6 18"/>')}</button>
        </div>
        <div class="detail-cols"></div>
        <div class="detail-foot"></div>
      </div>
      <div class="detail-control" hidden></div>`;
    mount.appendChild(this.el);
    this.colsEl = child(this.el, '.detail-cols');
    this.titleEl = child(this.el, '.detail-title');
    this.footEl = child(this.el, '.detail-foot');
    this.closeEl = child(this.el, '.detail-close');
    this.controlEl = child(this.el, '.detail-control');

    this.closeEl.addEventListener('click', () => this.close());
    this.el.querySelector('.detail-scrim')!.addEventListener('click', () => this.close());
    this.controlEl.addEventListener('click', (e) => {
      if (e.target === this.controlEl) this.closeControl();
    });

    this.nav = new FocusGroup(child(this.el, '.detail-panel'), { onBack: () => this.close() });
    this.ctlNav = new FocusGroup(this.controlEl, {
      onBack: () => this.closeControl(),
      onKey: (e) => this.controlKey(e),
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  openZone(zone: Zone): void {
    this.zone = zone;
    this.titleEl.textContent = zone.name;
    this.columns = zone.groups.map((g) => g.devices);
    this.colEls = [];
    this.colsEl.innerHTML = '';

    zone.groups.forEach((g, ci) => {
      const col = document.createElement('div');
      col.className = 'dcol';
      const list = document.createElement('div');
      list.className = 'dcol-list';
      const els: HTMLElement[] = [];
      g.devices.forEach((d, ri) => {
        const row = document.createElement('button');
        row.dataset.focus = `device-${ci}-${ri}`;
        this.paintRow(row, d);
        row.addEventListener('click', () => this.activate(ci, ri));
        list.appendChild(row);
        els.push(row);
      });
      col.innerHTML = `<div class="dcol-title">${g.title}</div>`;
      col.appendChild(list);
      this.colsEl.appendChild(col);
      this.colEls.push(els);
    });
    this.paintFooter();

    this.open = true;
    this.el.classList.add('open');
    this.nav.focus('device-0-0');
  }

  close(): void {
    this.closeControl();
    this.open = false;
    this.el.classList.remove('open');
    this.zone = null;
    this.onClosed();
  }

  /** New states from Home Assistant: repaint the rows (and any open control). */
  refresh(): void {
    if (!this.open) return;
    this.columns.forEach((col, ci) => col.forEach((d, ri) => this.paintRow(this.colEls[ci][ri], d)));
    this.paintFooter();
    this.render();
    const d = this.controlDevice;

    if (d?.type === 'light') this.updateLightControl();

    if (d?.type === 'climate') this.updateClimateControl();
  }

  private paintFooter(): void {
    const f = this.zone?.footer;
    this.footEl.textContent = f ?? '';
    this.footEl.style.display = f ? '' : 'none';
  }

  private paintRow(row: HTMLElement, d: Device): void {
    row.className = `drow ${rowClass(d)}`;
    const status = d.status ?? '';
    row.innerHTML =
      `<div class="dicon">${deviceIcon(d)}</div>` +
      `<div class="dmeta"><div class="dname">${d.name}</div>` +
      (status ? `<div class="dstatus">${status}</div>` : '') +
      `</div>` +
      (hasControl(d) ? `<div class="dchev">${wrap('<path d="M9 6l6 6-6 6"/>')}</div>` : '');
  }

  /** Repainting a row resets its classes; this puts the focus back. */
  private render(): void {
    this.nav.paint();
  }

  // ---------- input ----------
  handleKey(e: KeyboardEvent): void {
    if (this.controlDevice) this.ctlNav.handleKey(e);
    else this.nav.handleKey(e);
  }

  /** A device's row was chosen (OK, a tap or a click): switch it, or open its control. */
  private activate(ci: number, ri: number): void {
    const d = this.columns[ci]?.[ri];

    if (!d || d.unavailable) return;

    if (hasControl(d)) {
      this.controlAt = { col: ci, row: ri };
      this.openControl(d);

      return;
    }

    // Locks and sensors are status only.
    if (d.type === 'light' || d.type === 'switch') {
      d.on = !d.on;
      d.holdUntil = Date.now() + HOLD_MS;
      ha.call(domainOf(d), d.on ? 'turn_on' : 'turn_off', { entity_id: d.entity });
    } else if (d.type === 'cover') {
      d.on = !d.on;
      d.holdUntil = Date.now() + HOLD_MS;
      ha.call('cover', d.on ? 'open_cover' : 'close_cover', { entity_id: d.entity });
    } else {
      return;
    }

    if (d.type !== 'cover') d.status = d.on ? 'On' : '';
    this.paintRow(this.colEls[ci][ri], d);
    this.render();
  }

  // ---------- richer controls ----------
  private openControl(d: Device): void {
    this.controlDevice = d;
    this.controlEl.hidden = false;
    this.controlEl.classList.add('open');
    this.renderControl();
  }
  private closeControl(): void {
    if (!this.controlDevice) return;
    this.flushSend();
    clearTimeout(this.camTimer);
    this.camera?.stop();
    this.camera = null;
    const d = this.controlDevice;
    this.controlDevice = null;
    this.controlEl.classList.remove('open');
    this.controlEl.hidden = true;
    this.controlEl.innerHTML = '';
    const { col, row } = this.controlAt;

    if (this.columns[col]?.[row] === d) this.paintRow(this.colEls[col][row], d);
    this.render();
  }

  private renderControl(): void {
    const d = this.controlDevice;

    if (!d) return;

    if (d.type === 'climate') {
      this.controlEl.innerHTML = `
        <div class="ctl-card ctl-climate">
          <div class="ctl-name">${d.name}</div>
          <div class="ctl-temp"><button class="ctl-step" data-step="-1" aria-label="Cooler">−</button><span class="ctl-set"></span><span class="deg"></span><button class="ctl-step" data-step="1" aria-label="Warmer">+</button></div>
          <div class="ctl-sub"></div>
          <div class="ctl-hint">${hint('thermostat')}</div>
        </div>`;
      this.controlEl.querySelectorAll<HTMLElement>('.ctl-step').forEach((b) =>
        b.addEventListener('click', () => this.stepClimate(Number(b.dataset.step))),
      );
      this.updateClimateControl();
    } else if (d.type === 'scene') {
      const opts = d.options ?? [];
      this.controlEl.innerHTML = `
        <div class="ctl-card ctl-scene">
          <div class="ctl-name">${this.zone?.name ?? ''} scene</div>
          <div class="scene-list">${opts.map((o, i) => `<div class="scene-opt${o === d.picked ? ' picked' : ''}" data-focus="scene-${i}">${o}</div>`).join('')}</div>
          <div class="ctl-hint">${hint('scenes')}</div>
        </div>`;
      this.controlEl.querySelectorAll('.scene-opt').forEach((el, i) => el.addEventListener('click', () => this.pickScene(i)));
      this.ctlNav.focus(`scene-${Math.max(0, opts.indexOf(d.picked ?? ''))}`);
    } else if (d.type === 'camera') {
      this.controlEl.innerHTML = `
        <div class="ctl-card ctl-camera">
          <div class="cam-feed"><video class="cam-img" muted autoplay playsinline></video><div class="cam-msg">Connecting…</div><div class="cam-live"><span class="dot"></span>LIVE</div><div class="cam-name">${d.name}</div></div>
          <div class="ctl-hint">${hint('closeControl')}</div>
        </div>`;
      this.startCamera(d);
    } else {
      // dimmable light
      this.controlEl.innerHTML = `
        <div class="ctl-card ctl-light">
          <div class="ctl-name">${d.name}</div>
          <div class="ctl-state"></div>
          <div class="ctl-bar"><div class="ctl-fill"></div></div>
          <div class="ctl-sub">${hint('dimmer')}</div>
          <div class="ctl-hint">${hint('closeControl')}</div>
        </div>`;
      this.wireLightTouch(d);
      this.updateLightControl();
    }
  }

  /** Live camera video (WebRTC through HA). Stops when the view closes. */
  private startCamera(d: Device): void {
    const video = find(this.controlEl, '.cam-img', HTMLVideoElement);
    const msg = child(this.controlEl, '.cam-msg');
    const fail = (m: string) => { if (this.controlDevice === d) msg.textContent = m; };

    video.addEventListener('playing', () => msg.remove(), { once: true });
    const conn = ha.connection;

    if (!conn) {
      fail('Not connected to Home Assistant');

      return;
    }

    playCamera(conn, d.entity, video, (m) => fail(`Camera error: ${m}`))
      .then((s) => {
        if (this.controlDevice === d) this.camera = s;
        else s.stop(); // closed while connecting
      })
      .catch((e) => fail(`Couldn’t start the camera${e?.message ? `: ${e.message}` : ''}`));
    // Nest streams can take several seconds; say so if nothing shows.
    this.camTimer = window.setTimeout(() => fail('Still connecting… cameras can take a few seconds'), 8000);
  }

  private pickScene(i: number): void {
    const d = this.controlDevice;
    const option = d?.options?.[i];

    if (!d || !option) return;
    d.picked = option;
    d.status = option;

    // A room built from an Area: its scenes are scene entities, turned on directly.
    if (d.scenes?.[i]) {
      d.holdUntil = Date.now() + HOLD_MS;
      ha.call('scene', 'turn_on', { entity_id: d.scenes[i] });
    } else ha.call('select', 'select_option', { entity_id: d.entity, option });
    this.closeControl();
  }

  private updateClimateControl(): void {
    const d = this.controlDevice;

    if (!d) return;
    const set = this.controlEl.querySelector('.ctl-set');
    const sub = this.controlEl.querySelector('.ctl-sub');

    if (set) set.textContent = String(d.setpoint ?? '--');

    if (sub) sub.textContent = [cap(d.mode), d.current !== undefined ? `${d.current}° inside now` : ''].filter(Boolean).join(' · ');
  }

  private updateLightControl(): void {
    const d = this.controlDevice;

    if (!d) return;
    const state = this.controlEl.querySelector('.ctl-state');
    const fill = this.controlEl.querySelector('.ctl-fill');
    const card = this.controlEl.querySelector('.ctl-card');

    if (state) state.textContent = d.on ? `On · ${d.brightness ?? 100}%` : 'Off';

    if (fill instanceof HTMLElement) fill.style.width = `${d.on ? d.brightness ?? 100 : 0}%`;

    if (card) card.classList.toggle('is-on', !!d.on);
  }

  /** Send the latest value once the arrows stop for a moment, instead of on every press. */
  private queueSend(delay: number): void {
    const d = this.controlDevice;

    if (!d) return;
    d.holdUntil = Date.now() + delay + HOLD_MS;
    clearTimeout(this.sendTimer);
    this.sendTimer = window.setTimeout(() => this.flushSend(), delay);
  }
  private pending: (() => void) | null = null;
  private flushSend(): void {
    clearTimeout(this.sendTimer);
    const p = this.pending;
    this.pending = null;
    p?.();
  }

  /**
   * Keys an open control handles itself: on the thermostat and a dimmer the arrows change the value
   * instead of moving the focus, and OK sets or switches. Returns false for the rest (Back, and
   * everything in the scene list), which the shared layer handles.
   */
  private controlKey(e: KeyboardEvent): boolean {
    const d = this.controlDevice;
    const k = e.key;

    if (!d || d.type === 'scene' || k === 'Escape' || k === 'Backspace') return false;

    if (d.type === 'climate') {
      if (k === 'ArrowUp' || k === 'ArrowRight') this.stepClimate(1);
      else if (k === 'ArrowDown' || k === 'ArrowLeft') this.stepClimate(-1);
      else if (k === 'Enter') this.closeControl();
      else return false;
    } else if (d.type === 'camera') {
      if (k !== 'Enter') return false;
      this.closeControl();
    } else {
      // dimmable light
      let toggle = false;

      if (k === 'ArrowRight') {
        e.preventDefault();
        d.brightness = Math.min(100, (d.on ? d.brightness ?? 0 : 0) + 10);
        d.on = true;
      }
      else if (k === 'ArrowLeft') {
        e.preventDefault();
        // A light that's on but hasn't reported its brightness yet counts as 100%, as the control shows.
        d.brightness = Math.max(0, (d.brightness ?? (d.on ? 100 : 0)) - 10);
        d.on = d.brightness > 0;

        if (!d.on) d.brightness = 10;
      }
      else if (k === 'ArrowUp') {
        e.preventDefault();
        d.on = true;
        d.brightness = Math.max(d.brightness ?? 0, 10);
      }
      else if (k === 'ArrowDown') {
        e.preventDefault();
        d.on = false;
      }
      else if (k === 'Enter') {
        e.preventDefault();
        d.on = !d.on;
        toggle = true;
      }
      else return false;
      this.sendLight(d, toggle);
    }

    e.preventDefault();

    return true;
  }

  /** The thermostat's set point up or down a degree, sent once the presses stop. */
  private stepClimate(delta: number): void {
    const d = this.controlDevice;

    if (d?.type !== 'climate') return;
    const lo = d.minTemp ?? 50, hi = d.maxTemp ?? 90;
    d.setpoint = Math.max(lo, Math.min(hi, (d.setpoint ?? 68) + delta));
    const temperature = d.setpoint;
    this.pending = () => ha.call('climate', 'set_temperature', { entity_id: d.entity, temperature });
    this.queueSend(900);
    d.status = `${d.setpoint}° · ${cap(d.mode)}`;
    this.updateClimateControl();
  }

  /** Sends the light's new state (`d.on`, `d.brightness`); a plain toggle keeps HA's own brightness. */
  private sendLight(d: Device, toggle: boolean): void {
    const on = d.on, pct = d.brightness ?? 100;
    this.pending = () =>
      on
        ? ha.call('light', 'turn_on', toggle ? { entity_id: d.entity } : { entity_id: d.entity, brightness_pct: pct })
        : ha.call('light', 'turn_off', { entity_id: d.entity });
    this.queueSend(toggle ? 0 : 350);
    d.status = d.on ? `On · ${pct}%` : '';
    this.updateLightControl();
  }

  /** Touch and mouse on the dimmer: drag along the bar to set the brightness; tap the name to switch. */
  private wireLightTouch(d: Device): void {
    const bar = child(this.controlEl, '.ctl-bar');

    const setFrom = (e: PointerEvent) => {
      const r = bar.getBoundingClientRect();
      const pct = Math.round((Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100) / 5) * 5;
      d.on = pct > 0;
      d.brightness = Math.max(pct, 5);
      this.sendLight(d, false);
    };

    bar.addEventListener('pointerdown', (e) => {
      bar.setPointerCapture(e.pointerId);
      setFrom(e);
    });
    bar.addEventListener('pointermove', (e) => { if (bar.hasPointerCapture(e.pointerId)) setFrom(e); });
    child(this.controlEl, '.ctl-name').addEventListener('click', () => {
      d.on = !d.on;
      this.sendLight(d, true);
    });
  }
}
