import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import type { Device, Zone, ZoneState } from './types';
import { settings, type DeviceConfig, type RoomConfig, type RoomIcon } from './config';
import { attributes, CameraAttributes, ClimateAttributes, LightAttributes, SelectAttributes, SensorAttributes } from './ha-data';

/** A room card's summary: its color state and status line. */
export interface ZoneSummary {
  state: ZoneState;
  status: string;
}

// Zone icons (hand-drawn line icons, recolored via currentColor).
const zi = {
  couch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/><path d="M2 12a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2z"/><path d="M6 19v1.5M18 19v1.5"/></svg>`,
  cutlery: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v6M8.5 3v4a2.5 2.5 0 0 1-2.5 2.5h0A2.5 2.5 0 0 1 3.5 7V3M6 9.5V21"/><path d="M17.5 3c-1.4 0-2.4 2.2-2.4 5s1 3.8 2.4 3.8M17.5 3v18"/></svg>`,
  desk: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="9" rx="1"/><path d="M12 14v4M8.5 18h7M3 21h18"/></svg>`,
  bed: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 14.5h18M7 10V8a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v2"/><path d="M3 18v2M21 18v2"/></svg>`,
  stairs: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4v-4h4v-4h4V8h4"/></svg>`,
  house: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-6 8 6"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/></svg>`,
};

// ---------- rooms and devices, from calm-tv.json (see config.ts) ----------
const ICONS: Record<RoomIcon, string> = zi;

function device(d: DeviceConfig): Device {
  return {
    type: d.type,
    entity: d.entity,
    name: d.name ?? d.entity,
    batteries: d.batteries,
    operator: d.operator,
    keypad: d.keypad,
    control: d.control,
  };
}

function room(r: RoomConfig): Zone {
  const groups = r.groups.map((g) => ({ title: g.title, devices: g.devices.map(device) }));
  const all = groups.flatMap((g) => g.devices);
  // A room's locks are the same rows as in its groups when listed there (so they share live state).
  const locks = (r.locks ?? []).map((id) => all.find((d) => d.entity === id) ?? device({ type: 'lock', entity: id }));

  return {
    name: r.name,
    icon: ICONS[r.icon ?? 'house'] ?? zi.house,
    idle: r.whenIdle,
    locks,
    maint: r.maintenance,
    vacuum: r.vacuum ? { label: r.vacuum.label, vac: r.vacuum.vacuum, dock: r.vacuum.dock } : undefined,
    openAlert: r.alert,
    groups,
  };
}

/** The rooms in the Smart Home bar (empty until calm-tv.json lists some). */
export let zones: Zone[] = [];

/** Weather entity (Open-Meteo recommended: ~7 days of hourly forecast). */
export let WEATHER = 'weather.home';

/** Builds the rooms from the loaded configuration. Call after loadConfig(). */
export function loadHome(): void {
  zones = (settings.config.rooms ?? []).map(room);
  WEATHER = settings.config.weather ?? 'weather.home';
}

// ---------- live state ----------
const UNLOCKED_MINUTES = 10; // a door counts as "left unlocked" after this long
const EMPTY = ['none', 'unknown', 'unavailable', ''];

export const cap = (s?: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ') : '');
const num = (s?: HassEntity) => (s && !isNaN(parseFloat(s.state)) ? Math.round(parseFloat(s.state)) : undefined);

function minBattery(ents: HassEntities, ids: string[] = []): number | undefined {
  const levels = ids.flatMap((id) => {
    const level = num(ents[id]);

    return level === undefined ? [] : [level];
  });

  return levels.length ? Math.min(...levels) : undefined;
}

function applyDevice(d: Device, ents: HassEntities): void {
  const s = ents[d.entity];
  d.unavailable = !s || s.state === 'unavailable';

  if (!s || d.unavailable) {
    d.status = 'Unavailable';

    return;
  }

  const held = (d.holdUntil ?? 0) > Date.now();
  const battery = minBattery(ents, d.batteries);
  const batteryText = battery !== undefined ? ` · ${battery}% battery` : '';

  switch (d.type) {
    case 'light': {
      const a = attributes(s, LightAttributes);
      const modes = a.supported_color_modes;
      d.dimmable = !!modes && !(modes.length === 1 && modes[0] === 'onoff');

      if (!held) d.on = s.state === 'on';

      // While a change is held, keep the brightness just set, but take HA's if none is known yet
      // (a light just switched on: off lights report no brightness).
      if (a.brightness !== undefined && (!held || d.brightness === undefined)) {
        d.brightness = Math.max(1, Math.round((a.brightness / 255) * 100));
      }

      d.status = d.on ? (d.dimmable && d.brightness ? `On · ${d.brightness}%` : 'On') : '';
      break;
    }

    case 'switch':
      if (!held) d.on = s.state === 'on';
      d.status = '';
      break;
    case 'cover':
      if (!held) d.on = s.state === 'open' || s.state === 'opening';
      d.status = `${cap(s.state)}${batteryText}`;
      break;
    case 'lock': {
      d.locked = s.state === 'locked';
      const keypad = d.keypad ? num(ents[d.keypad]) : undefined;
      const op = d.operator ? ents[d.operator]?.state : undefined;
      // "Locked (One-Touch) · 93% battery · keypad 81%": how it was locked, without repeating "Lock".
      const how = op && !EMPTY.includes(op) ? ` (${op.replace(/\s*lock$/i, '')})` : '';
      d.status = cap(s.state) + how + batteryText + (keypad !== undefined ? ` · keypad ${keypad}%` : '');
      break;
    }

    case 'camera':
      d.on = s.state === 'streaming';
      d.picture = attributes(s, CameraAttributes).entity_picture;
      d.status = 'Live view';
      break;
    case 'climate': {
      const a = attributes(s, ClimateAttributes);
      d.current = a.current_temperature === undefined ? undefined : Math.round(a.current_temperature);
      d.minTemp = a.min_temp;
      d.maxTemp = a.max_temp;

      if (!held) {
        d.mode = s.state;
        d.setpoint = a.temperature === undefined ? undefined : Math.round(a.temperature);
      }

      const lo = a.target_temp_low, hi = a.target_temp_high;

      const target =
        d.setpoint !== undefined ? `${d.setpoint}°` : lo !== undefined && hi !== undefined ? `${Math.round(lo)}–${Math.round(hi)}°` : '';

      d.status = [target, cap(d.mode === 'heat_cool' ? 'heat/cool' : d.mode)].filter(Boolean).join(' · ');
      break;
    }

    case 'scene':
      d.options = attributes(s, SelectAttributes).options ?? [];

      if (!EMPTY.includes(s.state.toLowerCase())) d.picked = s.state;
      d.status = d.picked ?? 'Choose a scene';
      break;
    case 'sensor':
      if (d.entity.startsWith('binary_sensor.')) {
        d.on = s.state === 'on';
        d.occupancy = attributes(s, SensorAttributes).device_class === 'occupancy';
        d.status = d.occupancy ? (d.on ? 'Someone there' : 'Clear') : d.on ? 'Open' : 'Closed';
      } else {
        const unit = attributes(s, SensorAttributes).unit_of_measurement ?? '';
        d.status = `${num(s) ?? s.state}${unit.startsWith('°') ? '°' : unit ? ` ${unit}` : ''}`;
      }

      break;
  }
}

/** Vacuum problems: "needs water", "empty dirty water"... (Roborock integration entity names). */
function vacuumProblems(ents: HassEntities, v: NonNullable<Zone['vacuum']>): string[] {
  const on = (id: string) => ents[id]?.state === 'on';
  const out: string[] = [];

  if (on(`binary_sensor.${v.vac}_water_shortage`) || on(`binary_sensor.${v.dock}_clean_water_box`)) out.push('needs water');

  if (on(`binary_sensor.${v.dock}_dirty_water_box`)) out.push('empty dirty water');

  if (on(`binary_sensor.${v.dock}_cleaning_fluid`)) out.push('needs cleaning fluid');
  const vErr = ents[`sensor.${v.vac}_vacuum_error`]?.state;

  if (vErr && !EMPTY.includes(vErr)) out.push(vErr.replace(/_/g, ' '));
  const dErr = ents[`sensor.${v.dock}_dock_error`]?.state;

  if (dErr && !['ok', 'unknown', 'unavailable'].includes(dErr)) out.push(`dock: ${dErr.replace(/_/g, ' ')}`);

  return out;
}

/** Copy Home Assistant's latest states into every room and device. */
export function applyStates(ents: HassEntities): void {
  const now = Date.now();

  for (const z of zones) {
    z.groups.forEach((g) => g.devices.forEach((d) => applyDevice(d, ents)));

    const urgent: string[] = [];

    for (const l of z.locks ?? []) {
      const s = ents[l.entity];

      if (s?.state === 'unlocked' && now - Date.parse(s.last_changed) > UNLOCKED_MINUTES * 60000) urgent.push(`${l.name} unlocked`);
    }

    if (z.openAlert && ents[z.openAlert.entity]?.state === 'on') urgent.unshift(z.openAlert.text);
    z.footer = undefined;

    if (z.vacuum) {
      const v = z.vacuum;
      const problems = vacuumProblems(ents, v);
      problems.forEach((p) => urgent.push(`${v.label} ${p}`));
      const status = ents[`sensor.${v.vac}_status`]?.state;
      const battery = num(ents[`sensor.${v.vac}_battery`]);
      z.footer = [v.label, cap(status), battery !== undefined ? `${battery}% battery` : '', problems.join(' · ') || 'all good']
        .filter(Boolean)
        .join(' · ');
    }

    z.urgent = urgent.length ? urgent.join(' · ') : undefined;
    const mt = z.maint ? ents[z.maint]?.state : undefined;
    z.maintText = mt && !EMPTY.includes(mt) ? mt : undefined;
  }
}

/** The bar's summary line and color: urgent first, then maintenance, then what's on. */
export function summarize(zone: Zone): ZoneSummary {
  if (zone.urgent) return { state: 'warn', status: zone.urgent };

  if (zone.maintText) return { state: 'warn', status: zone.maintText };
  const devices = zone.groups.flatMap((g) => g.devices);
  const lights = devices.filter((d) => (d.type === 'light' || d.type === 'switch') && d.on).length;
  const windows = devices.filter((d) => d.type === 'cover' && d.on).length;
  const bits: string[] = [];

  if (lights) bits.push(`${lights} light${lights > 1 ? 's' : ''} on`);

  if (windows) bits.push(`${windows} window${windows > 1 ? 's' : ''} open`);

  if (bits.length) return { state: 'active', status: bits.join(' · ') };

  return { state: 'idle', status: zone.idle ?? 'All off' };
}

/** The thermostat shown large on the Smart Home screen: the first climate device in the rooms. */
export function primaryClimate(): Device | undefined {
  for (const z of zones) {
    for (const g of z.groups) {
      const c = g.devices.find((d) => d.type === 'climate');

      if (c) return c;
    }
  }

  return undefined;
}
