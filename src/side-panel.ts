import { ha } from './ha';
import { haPath, settings } from './config';
import { zones, applyStates, WEATHER, cap } from './home-data';
import { attributes, ClimateAttributes, MediaPlayerAttributes, WeatherAttributes } from './ha-data';
import { conditionIcon } from './sections/weather-section';
import { DOOR_ICON } from './doors';
import type { Device } from './types';

// The ★ side panel (index.html?panel): the TV app shows this page in a window on the right, over
// whatever is playing, when the remote's ★ button is pressed (see SidePanelOverlay.kt). It never
// takes focus from the show: the TV app passes the arrows, OK and Back in as key presses.
// Everything comes from calm-tv.json: the thermostats, sensors and cameras in "rooms", the doors
// in "doors" and the speakers in "music".

/** The page is laid out 684 wide (a 620-wide panel and its margins) and scaled to the window. */
const DESIGN_W = 684;

const wrap = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const DOOR_SHUT = wrap('<path d="M6 21V3h12v18M3 21h18"/><circle cx="15" cy="12" r="1" fill="currentColor"/>');
const GARAGE = wrap('<path d="M3 10l9-6 9 6v10H3z"/><path d="M7 20v-8h10v8M7 15h10"/>');
const SENSOR = wrap('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/>');
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.6v14.8a.6.6 0 0 0 .92.5l11.2-7.4a.6.6 0 0 0 0-1L7.92 4.1A.6.6 0 0 0 7 4.6z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const NOTE = wrap('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>');

type Kind = 'climate' | 'door' | 'sensor' | 'music' | 'camera';

interface Item {
  kind: Kind;
  el: HTMLElement;
  device?: Device;
  door?: { name: string; entity: string };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Player names in calm-tv.json's "music", by entity. */
const playerName = (entity: string) => settings.config.music?.players?.find((p) => p.entity === entity)?.name ?? entity;

class SidePanel {
  private root: HTMLElement;
  private list: HTMLElement;
  private big: HTMLElement;
  private hint: HTMLElement;
  private rows: Item[][] = [];
  private row = 0;
  private col = 0;
  /** OK on a thermostat: ←/→ (or ↑/↓) change its set point until OK or Back. */
  private adjusting = false;
  private sendTimer = 0;
  /**
   * A thermostat holding a range (heat/cool): both set points, which one ↑ ↓ change, and until
   * when to show them instead of HA's older values.
   */
  private range: { entity: string; lo: number; hi: number; which: 'lo' | 'hi'; until: number; editing?: boolean } | null = null;
  /** A garage door asks for OK a second time before it moves: which one, and until when. */
  private confirm: { entity: string; until: number } | null = null;
  /** The camera opened big, if any. */
  private camera: Device | null = null;

  constructor() {
    document.documentElement.classList.add('sp-only');
    this.root = document.createElement('div');
    this.root.className = 'sp';
    this.root.innerHTML = `
      <div class="sp-top"><b>Home</b><span class="sp-now"></span></div>
      <div class="sp-list"></div>
      <div class="sp-big" hidden><img alt=""><div class="sp-big-name"></div></div>
      <div class="sp-hint"></div>`;
    document.body.appendChild(this.root);
    this.list = this.part('.sp-list');
    this.big = this.part('.sp-big');
    this.hint = this.part('.sp-hint');
    const fit = () => {
      const z = window.innerWidth / DESIGN_W;
      this.root.style.zoom = String(z);
      this.root.style.height = `${window.innerHeight / z - 64}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    document.addEventListener('keydown', (e) => this.key(e));
  }

  private part(sel: string): HTMLElement {
    const el = this.root.querySelector<HTMLElement>(sel);

    if (!el) throw new Error(`side panel: missing ${sel}`);

    return el;
  }

  /** Builds the sections from calm-tv.json (once the states are known, for the music and doors). */
  build(): void {
    const rows: Item[][] = [];
    let html = '';
    const section = (title: string, cls: string, items: Item[], per: number) => {
      if (!items.length) return;
      html += `<div class="sp-h">${esc(title)}</div><div class="sp-grid ${cls}" style="--per:${per}">${items.map((_, i) => `<div data-i="${rows.flat().length + i}"></div>`).join('')}</div>`;

      for (let i = 0; i < items.length; i += per) rows.push(items.slice(i, i + per));
    };
    const devices = zones.flatMap((z) => z.groups.flatMap((g) => g.devices.map((d) => ({ zone: z.name, d }))));
    const placeholder = () => document.createElement('div');

    section('Climate', 'sp-therm', devices.filter((x) => x.d.type === 'climate').map((x) => ({ kind: 'climate', el: placeholder(), device: x.d })), 2);
    const doors = settings.config.doors?.entities ?? [];
    section('Doors', 'sp-chips', doors.map((door) => ({ kind: 'door', el: placeholder(), door })), 3);
    // Other open/closed sensors, under their room's name (e.g. the garage doors).
    const doorIds = new Set(doors.map((d) => d.entity));
    const rooms = [...new Set(devices.filter((x) => x.d.type === 'sensor' && x.d.entity.startsWith('binary_sensor.') && !doorIds.has(x.d.entity)).map((x) => x.zone))];

    for (const name of rooms) {
      section(name, 'sp-chips', devices.filter((x) => x.zone === name && x.d.type === 'sensor' && x.d.entity.startsWith('binary_sensor.') && !doorIds.has(x.d.entity)).map((x) => ({ kind: 'sensor', el: placeholder(), device: x.d })), 2);
    }

    if (settings.config.music?.players?.length) section('Music', 'sp-one', [{ kind: 'music', el: placeholder() }], 1);
    section('Cameras', 'sp-cams', devices.filter((x) => x.d.type === 'camera').map((x) => ({ kind: 'camera', el: placeholder(), device: x.d })), 2);

    this.list.innerHTML = html || '<div class="sp-empty">Nothing to show yet: add rooms, doors or music to calm-tv.json</div>';
    const flat = rows.flat();
    this.list.querySelectorAll<HTMLElement>('[data-i]').forEach((slot) => {
      const it = flat[Number(slot.dataset.i)];

      if (it) {
        it.el = slot;
        slot.className = `sp-item sp-${it.kind}`;
      }
    });
    this.rows = rows;
    this.render();
  }

  private get focused(): Item | undefined {
    return this.rows[this.row]?.[this.col];
  }

  render(): void {
    applyStates(ha.entities);
    const w = ha.entities[WEATHER];
    const t = w ? attributes(w, WeatherAttributes).temperature : undefined;
    const d = new Date();
    const time = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
    this.part('.sp-now').innerHTML = `${w && t !== undefined ? `<span class="sp-wx">${conditionIcon(w.state)}${Math.round(t)}°</span> · ` : ''}${time}`;

    for (const row of this.rows) for (const it of row) this.draw(it);
    const f = this.focused;
    this.rows.flat().forEach((it) => it.el.classList.toggle('focus', it === f && !this.camera));
    f?.el.classList.toggle('adjusting', this.adjusting);
    f?.el.scrollIntoView({ block: 'nearest' });
    this.hint.textContent = this.camera ? 'Back to close the camera'
      : this.adjusting && this.range?.editing ? '← → to change · OK when done'
      : this.adjusting && this.range ? '← → heat or cool · OK to change it · Back when done'
      : this.adjusting ? '← → to change · OK when done'
      : f?.kind === 'sensor' && f.device?.control ? `OK to ${f.device.on ? 'close' : 'open'} · Back or ★ to close`
      : f?.kind === 'climate' ? 'OK to change the temperature · Back or ★ to close'
      : f?.kind === 'music' ? 'OK to play or pause · Back or ★ to close'
      : f?.kind === 'camera' ? 'OK for a bigger picture · Back or ★ to close'
      : 'Back or ★ to close';
  }

  private draw(it: Item): void {
    const d = it.device;

    if (it.kind === 'climate' && d) {
      const action = ha.entities[d.entity]?.attributes.hvac_action;
      const doing = typeof action === 'string' && action !== 'off' ? cap(action) : d.mode === 'heat_cool' ? 'Auto' : cap(d.mode);
      const warm = d.mode === 'heat' || action === 'heating';
      it.el.classList.toggle('cool', d.mode === 'cool' || action === 'cooling');
      it.el.classList.toggle('warm', warm);
      const r = this.rangeOf(d);
      const adjusting = this.adjusting && this.focused === it;
      const point = (v: number, which: 'lo' | 'hi', label: string) => {
        const picked = adjusting && r?.which === which;
        const editing = picked && this.range?.editing;

        return `<span class="pt ${which}${picked ? ' pick' : ''}${editing ? ' edit' : ''}"><small>${label}</small>${editing ? '<i>−</i>' : ''}${v}°${editing ? '<i>+</i>' : ''}</span>`;
      };
      it.el.innerHTML = `<div class="n">${esc(d.name)}</div><div class="t">${d.current ?? '--'}°</div><div class="s">${esc(doing || '')}</div>`
        + (d.setpoint !== undefined ? `<div class="adj"><i>−</i><b>${d.setpoint}°</b><i>+</i></div>`
          // While one set point is open for changing, the other steps aside to make room.
          : r && adjusting && this.range?.editing ? `<div class="adj rng">${r.which === 'lo' ? point(r.lo, 'lo', 'Heat') : point(r.hi, 'hi', 'Cool')}</div>`
          : r ? `<div class="adj rng">${point(r.lo, 'lo', 'Heat')}${point(r.hi, 'hi', 'Cool')}</div>`
          : `<div class="adj"><b class="off">${esc(cap(d.mode ?? '') || 'Off')}</b></div>`);
    } else if (it.kind === 'door' && it.door) {
      const open = ha.entities[it.door.entity]?.state === 'on';
      it.el.classList.toggle('open', open);
      it.el.innerHTML = `${open ? DOOR_ICON : DOOR_SHUT}<div><div class="n">${esc(it.door.name.replace(/\s+door$/i, ''))}</div><div class="s">${open ? 'Open' : 'Closed'}</div></div>`;
    } else if (it.kind === 'sensor' && d) {
      it.el.classList.toggle('open', !!d.on && !d.occupancy);
      const asking = this.confirm?.entity === d.control && Date.now() < (this.confirm?.until ?? 0);
      const moving = d.control ? ha.entities[d.control]?.state : undefined;
      const status = asking ? `OK again to ${d.on ? 'close' : 'open'}` : moving === 'opening' || moving === 'closing' ? cap(moving) : d.status ?? '';
      it.el.classList.toggle('asking', asking);
      it.el.innerHTML = `${d.occupancy ? SENSOR : /garage/i.test(d.entity + d.name) ? GARAGE : d.on ? DOOR_ICON : DOOR_SHUT}<div><div class="n">${esc(d.name)}</div><div class="s">${esc(status)}</div></div>`;
    } else if (it.kind === 'music') {
      const p = this.player();
      const s = p ? ha.entities[p] : undefined;
      const a = s ? attributes(s, MediaPlayerAttributes) : undefined;
      const where = p ? [p, ...(a?.group_members ?? []).filter((m) => m !== p)].map(playerName).filter((n, i, all) => all.indexOf(n) === i).join(' + ') : '';
      it.el.innerHTML = `${a?.entity_picture ? `<img src="${esc(haPath(a.entity_picture))}" alt="">` : `<span class="art">${NOTE}</span>`}`
        + `<div class="txt"><div class="n">${esc(a?.media_title ?? 'Nothing playing')}</div><div class="s">${esc(where || 'Music')}</div></div>`
        + `<span class="pp">${s?.state === 'playing' ? PAUSE : PLAY}</span>`;
    } else if (it.kind === 'camera' && d) {
      // A picture every few seconds is plenty for a tile; OK opens the live stream big.
      const pic = d.picture ? haPath(d.picture) : '';
      const img = it.el.querySelector('img');
      const due = !img || Date.now() - Number(img.dataset.at ?? 0) > 8000;

      if (!img) it.el.innerHTML = `<img alt=""><span>${esc(d.name)}</span>`;
      const im = it.el.querySelector('img');

      if (im && pic && due) {
        im.src = `${pic}${pic.includes('?') ? '&' : '?'}t=${Date.now()}`;
        im.dataset.at = String(Date.now());
      }
    }
  }

  /** A thermostat's heat and cool set points, while it holds a range (the one being changed wins). */
  private rangeOf(d: Device): { lo: number; hi: number; which: 'lo' | 'hi' } | undefined {
    const r = this.range;

    if (r && r.entity === d.entity && (this.adjusting || Date.now() < r.until)) return r;
    const s = ha.entities[d.entity];
    const a = s ? attributes(s, ClimateAttributes) : undefined;

    if (a?.target_temp_low === undefined || a.target_temp_high === undefined) return undefined;

    return { lo: Math.round(a.target_temp_low), hi: Math.round(a.target_temp_high), which: 'lo' };
  }

  /** OK on a garage door: the first press asks, a second within 4 s opens or closes it. */
  private garage(d: Device): void {
    const cover = d.control;

    if (!cover) return;

    if (this.confirm?.entity === cover && Date.now() < this.confirm.until) {
      this.confirm = null;
      const state = ha.entities[cover]?.state;
      const service = state === 'open' || state === 'opening' ? 'close_cover' : state === 'closed' || state === 'closing' ? 'open_cover' : 'toggle';
      void ha.call('cover', service, { entity_id: cover });

      return;
    }

    this.confirm = { entity: cover, until: Date.now() + 4000 };
    window.setTimeout(() => this.render(), 4100);
  }

  /** The speaker the Music row shows: one that's playing, else paused, else the first. */
  private player(): string | undefined {
    const players = settings.config.music?.players ?? [];
    const by = (st: string) => players.find((p) => ha.entities[p.entity]?.state === st)?.entity;

    return by('playing') ?? by('paused') ?? players[0]?.entity;
  }

  private key(e: KeyboardEvent): void {
    const k = e.key;
    const f = this.focused;

    if (k === 'Escape' || k === 'Backspace') {
      e.preventDefault();

      if (this.camera) this.closeCamera();
      else if (this.adjusting && this.range?.editing) this.range.editing = false;
      else if (this.adjusting) this.adjusting = false;
      else window.CalmTvPanel?.close();
      this.render();

      return;
    }

    if (this.camera) return;

    if (this.adjusting && f?.device && this.range && f.device.setpoint === undefined) {
      const r = this.range;
      const d = f.device;
      // First ← → pick Heat or Cool and OK opens it; then any arrow changes it and OK is done.
      const step = !r.editing ? 0 : k === 'ArrowUp' || k === 'ArrowRight' ? 1 : k === 'ArrowDown' || k === 'ArrowLeft' ? -1 : 0;

      if (k === 'Enter' && r.editing) {
        r.editing = false;
        this.adjusting = false;
      } else if (k === 'Enter') r.editing = true;
      else if (!r.editing && k === 'ArrowLeft') r.which = 'lo';
      else if (!r.editing && k === 'ArrowRight') r.which = 'hi';
      else if (step) {
        // Heat stays at least 3° below cool, as most thermostats insist.
        const min = d.minTemp ?? 45, max = d.maxTemp ?? 90;

        if (r.which === 'lo') r.lo = Math.min(r.hi - 3, Math.max(min, r.lo + step));
        else r.hi = Math.min(max, Math.max(r.lo + 3, r.hi + step));
        r.until = Date.now() + 8000;
        d.holdUntil = r.until;
        const lo = r.lo, hi = r.hi;
        clearTimeout(this.sendTimer);
        this.sendTimer = window.setTimeout(() => void ha.call('climate', 'set_temperature', { entity_id: d.entity, target_temp_low: lo, target_temp_high: hi }), 900);
      }
      e.preventDefault();
      this.render();

      return;
    }

    if (this.adjusting && f?.device) {
      const d = f.device;
      const step = k === 'ArrowRight' || k === 'ArrowUp' ? 1 : k === 'ArrowLeft' || k === 'ArrowDown' ? -1 : 0;

      if (k === 'Enter') this.adjusting = false;
      else if (step && d.setpoint !== undefined) {
        d.setpoint = Math.min(d.maxTemp ?? 90, Math.max(d.minTemp ?? 45, d.setpoint + step));
        d.holdUntil = Date.now() + 5000;
        const temperature = d.setpoint;
        clearTimeout(this.sendTimer);
        this.sendTimer = window.setTimeout(() => void ha.call('climate', 'set_temperature', { entity_id: d.entity, temperature }), 900);
      }
      e.preventDefault();
      this.render();

      return;
    }

    const rows = this.rows;

    if (k === 'ArrowDown' && this.row < rows.length - 1) this.row++;
    else if (k === 'ArrowUp' && this.row > 0) this.row--;
    else if (k === 'ArrowRight' && this.col < (rows[this.row]?.length ?? 1) - 1) this.col++;
    else if (k === 'ArrowLeft' && this.col > 0) this.col--;
    else if (k === 'Enter' && f) this.activate(f);
    else return;
    e.preventDefault();
    this.col = Math.min(this.col, (rows[this.row]?.length ?? 1) - 1);
    this.render();
  }

  private activate(it: Item): void {
    if (it.kind === 'climate' && it.device) {
      const d = it.device;

      if (d.setpoint !== undefined) this.adjusting = true;
      else {
        const r = this.rangeOf(d);

        if (r) {
          const cooling = ha.entities[d.entity]?.attributes.hvac_action === 'cooling';
          this.range = { entity: d.entity, lo: r.lo, hi: r.hi, which: cooling ? 'hi' : 'lo', until: Date.now() + 8000, editing: false };
          this.adjusting = true;
        }
      }
    } else if (it.kind === 'sensor' && it.device?.control) this.garage(it.device);
    else if (it.kind === 'music') {
      const p = this.player();

      if (p) void ha.call('media_player', 'media_play_pause', { entity_id: p });
    } else if (it.kind === 'camera' && it.device) this.openCamera(it.device);
  }

  /** The camera big, on top of the list: Home Assistant's live MJPEG stream (or snapshots). */
  private openCamera(d: Device): void {
    const token = ha.entities[d.entity]?.attributes.access_token;

    if (typeof token !== 'string') return;
    this.camera = d;
    const img = this.big.querySelector('img');

    if (img) img.src = haPath(`/api/camera_proxy_stream/${d.entity}?token=${encodeURIComponent(token)}`);
    this.part('.sp-big-name').textContent = d.name;
    this.big.hidden = false;
    this.root.classList.add('cam-open');
  }

  private closeCamera(): void {
    this.camera = null;
    this.big.querySelector('img')?.removeAttribute('src');
    this.big.hidden = true;
    this.root.classList.remove('cam-open');
  }
}

/** Panel mode (index.html?panel): connect with the saved sign-in and show the panel. */
export function startSidePanel(): void {
  const panel = new SidePanel();
  let built = false;
  ha.onEntities(() => {
    if (!built && ha.status === 'connected') {
      built = true;
      panel.build();
    } else if (built) panel.render();
  });
  window.setInterval(() => { if (built) panel.render(); }, 10000);
  ha.start();
}

declare global {
  interface Window {
    /** Only in the TV's ★ side panel window. */
    CalmTvPanel?: { close(): void; getHaUrl?(): string; loadConfig?(): string };
  }
}
