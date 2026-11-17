import * as v from 'valibot';
import { demoMode, settings, MUSIC_BACKGROUNDS, type MusicBackground } from './config';

/**
 * The look-and-performance choices: video backgrounds, frosted glass and screen transitions (one
 * "Visual effects" row in Settings switches both), and the Music screen's background and wave.
 *
 * Each comes from, in order: this TV's own choice (Settings, kept in localStorage), else
 * calm-tv.json ("display", or "music" for the Music screen's background and wave), else the
 * built-in default.
 * So calm-tv.json sets a default for every TV, and each TV can still be tuned on the spot.
 */

// Demo mode keeps its own copy, so trying it never changes this TV's real choices.
const KEY = demoMode ? 'calmtv.demo.look' : 'calmtv.look';

export type Glass = 'blur' | 'tint';

export type Transitions = 'fade' | 'instant';


export type Source = 'set on this TV' | 'from calm-tv.json' | 'default';

/** This TV's own choices; null means "not set here, use calm-tv.json or the default". */
const OverridesSchema = v.object({
  videos: v.fallback(v.nullable(v.boolean()), null),
  glass: v.fallback(v.nullable(v.picklist(['blur', 'tint'])), null),
  transitions: v.fallback(v.nullable(v.picklist(['fade', 'instant'])), null),
  musicBackground: v.fallback(v.nullable(v.picklist(MUSIC_BACKGROUNDS)), null),
  musicWave: v.fallback(v.nullable(v.boolean()), null),
  fade: v.fallback(v.nullable(v.boolean()), null),
  /** A small frame-rate counter in the corner, for comparing settings on the TV. */
  showFps: v.fallback(v.boolean(), false),
});

type Overrides = v.InferOutput<typeof OverridesSchema>;

function loadOverrides(): Overrides {
  let saved = null;

  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    /* unreadable: nothing set on this TV */
  }

  return v.parse(OverridesSchema, saved ?? {});
}

const overrides = loadOverrides();
const listeners: (() => void)[] = [];

function changed(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {
    /* storage off: the choice lasts until the app restarts */
  }

  listeners.forEach((fn) => fn());
}

/** Runs whenever any of these choices changes. */
export function onLookChange(fn: () => void): void {
  listeners.push(fn);
}

const display = () => settings.config.display;

export function videosOn(): boolean {
  return overrides.videos ?? display()?.videos ?? true;
}

export function glass(): Glass {
  return overrides.glass ?? display()?.glass ?? 'blur';
}

export function transitions(): Transitions {
  return overrides.transitions ?? display()?.transitions ?? 'fade';
}

export function musicBackground(): MusicBackground {
  return overrides.musicBackground ?? settings.config.music?.background ?? 'none';
}

/** Whether the screens rest after a while without input: their bars fade (app.ts). */
export function fadeWhenIdle(): boolean {
  return overrides.fade ?? display()?.fade ?? true;
}

export function fadeSource(): Source {
  return overrides.fade !== null ? 'set on this TV' : display()?.fade !== undefined ? 'from calm-tv.json' : 'default';
}

export function setFadeWhenIdle(on: boolean): void {
  overrides.fade = on;
  changed();
}

export function musicWave(): boolean {
  return overrides.musicWave ?? settings.config.music?.wave ?? true;
}

export function showFps(): boolean {
  return overrides.showFps;
}

/** Where a choice's current value comes from. */
export function videosSource(): Source {
  return overrides.videos !== null ? 'set on this TV' : display()?.videos !== undefined ? 'from calm-tv.json' : 'default';
}

export function glassSource(): Source {
  return overrides.glass !== null ? 'set on this TV' : display()?.glass !== undefined ? 'from calm-tv.json' : 'default';
}

export function transitionsSource(): Source {
  return overrides.transitions !== null ? 'set on this TV' : display()?.transitions !== undefined ? 'from calm-tv.json' : 'default';
}

export function musicBackgroundSource(): Source {
  return overrides.musicBackground !== null ? 'set on this TV' : settings.config.music?.background !== undefined ? 'from calm-tv.json' : 'default';
}

export function musicWaveSource(): Source {
  return overrides.musicWave !== null ? 'set on this TV' : settings.config.music?.wave !== undefined ? 'from calm-tv.json' : 'default';
}

export function setMusicWave(on: boolean): void {
  overrides.musicWave = on;
  changed();
}

export function setMusicBackground(value: MusicBackground): void {
  overrides.musicBackground = value;
  changed();
}

export function setVideos(on: boolean): void {
  overrides.videos = on;
  changed();
}

export function setGlass(value: Glass): void {
  overrides.glass = value;
  changed();
}

export function setTransitions(value: Transitions): void {
  overrides.transitions = value;
  changed();
}

export function setShowFps(on: boolean): void {
  overrides.showFps = on;
  changed();
}

/** True if this TV overrides any of calm-tv.json's choices. */
export function hasOverrides(): boolean {
  return overrides.videos !== null || overrides.glass !== null || overrides.transitions !== null || overrides.musicBackground !== null || overrides.musicWave !== null || overrides.fade !== null;
}

/** Back to calm-tv.json's choices (or the defaults). The frame-rate counter is left as it is. */
export function resetToConfig(): void {
  overrides.videos = null;
  overrides.glass = null;
  overrides.transitions = null;
  overrides.musicBackground = null;
  overrides.musicWave = null;
  overrides.fade = null;
  changed();
}
