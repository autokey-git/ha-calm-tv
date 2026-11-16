import type { Variants } from './variants';

export interface App {
  /** Display name, shown as the tile label. */
  name: string;
  /** Inline SVG string for the monochrome mark. */
  mark: string;
  /** Android TV package name the tile opens, e.g. com.netflix.ninja. */
  pkg?: string;
  /** 'settings' and 'music' mark Calm TV's own tiles (they open its panels, not an app). */
  kind?: 'settings' | 'music';
}

export interface Wallpaper {
  name: string;
  url: string;
  /** Versions for the times of day, if it has them (see variants.ts). */
  variants?: Variants;
}

/** light, switch: on/off. cover: curtains/blinds. lock, sensor: status only. scene: a scene picker (an HA select entity, e.g. from Hue). */
export const DEVICE_TYPES = ['light', 'switch', 'lock', 'camera', 'climate', 'cover', 'sensor', 'scene'] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number];

export interface Device {
  name: string;
  type: DeviceType;
  /** The Home Assistant entity this row shows and controls. */
  entity: string;
  /** Battery sensors for the status line (the lowest is shown). */
  batteries?: string[];
  /** Lock: the sensor that says how it was last locked ("Manual Lock"). */
  operator?: string;
  /** Lock: the keypad's battery sensor. */
  keypad?: string;

  // Live values, filled in from Home Assistant.
  on?: boolean; // light / switch / camera (streaming) / cover (open) / sensor (open)
  locked?: boolean; // lock
  dimmable?: boolean;
  brightness?: number; // 0–100
  setpoint?: number; // climate; undefined when it holds a range
  current?: number; // climate: indoor temperature
  mode?: string; // climate: heat, cool, heat_cool, off...
  minTemp?: number;
  maxTemp?: number;
  /** Scene: the choices HA offers, and the last one picked (Hue doesn't report the active scene). */
  options?: string[];
  /** Sensor: an occupancy sensor (Someone there / Clear) rather than a door. */
  occupancy?: boolean;
  picked?: string;
  unavailable?: boolean;
  /** Status line under the name. */
  status?: string;
  /** Camera: picture path on HA, including its access token. */
  picture?: string;
  /** Until this time (ms), keep what you just changed instead of HA's older value. */
  holdUntil?: number;
}

export interface SubGroup {
  title: string;
  devices: Device[];
}

export interface Zone {
  name: string;
  /** Inline SVG line icon. */
  icon: string;
  /** Summary when nothing is on (e.g. "All off · curtains closed"). */
  idle?: string;
  /** Locks that turn the room amber when left unlocked. */
  locks?: Device[];
  /** Room maintenance sensor (low battery, vacuum part due); shown when nothing urgent is. */
  maint?: string;
  /** Roborock in this room: status line in the panel footer, problems on the bar. */
  vacuum?: { label: string; vac: string; dock: string };
  /** Binary sensor that is the room's urgent status while on (e.g. a garage door). */
  openAlert?: { entity: string; text: string };

  // Live values, filled in from Home Assistant.
  footer?: string;
  urgent?: string;
  maintText?: string;
  groups: SubGroup[];
}

export type ZoneState = 'idle' | 'active' | 'warn';
