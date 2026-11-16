import * as v from 'valibot';
import { ha } from './ha';
import { settings } from './config';
import { WEATHER } from './home-data';
import { attributes } from './ha-data';
import { PHASES, type Phase, type Variants } from './variants';

/**
 * The living sky: the background follows the time of day and the weather.
 *
 *  - Time of day comes from the sun (sun.sun's elevation), so dawn and dusk arrive gradually with
 *    the real sunrise and sunset, not on the hour. Any photo or video gets a code-only look: warmer
 *    at dawn and dusk, darker and bluer at night, with stars in the sky when it's clear.
 *  - The weather draws on top: rain, heavier rain, snow, fog, drifting cloud shadows and lightning.
 *
 * It's all a few layers between the background and the screens, so it works over every background
 * (yours too), and the frosted bars blur it like anything else behind them. Off unless calm-tv.json
 * has "sky" (always on in demo mode).
 */

export { PHASES, type Phase };

type Weights = Record<Phase, number>;

/** What the weather layer draws. */
export interface Weather {
  rain: number; // 0 none … 1 pouring
  snow: number; // 0 … 1
  fog: number; // 0 … 1
  clouds: number; // 0 clear … 1 overcast
  lightning: boolean;
  wind: number; // 0 still … 1 windy: slants rain and snow, hurries clouds
}

const CALM: Weather = { rain: 0, snow: 0, fog: 0, clouds: 0, lightning: false, wind: 0 };

/** Home Assistant's weather conditions, as what to draw. */
const CONDITIONS: Record<string, Partial<Weather>> = {
  'clear-night': {},
  sunny: {},
  partlycloudy: { clouds: 0.35 },
  cloudy: { clouds: 0.8 },
  fog: { fog: 0.8, clouds: 0.5 },
  rainy: { rain: 0.45, clouds: 0.75 },
  pouring: { rain: 1, clouds: 1 },
  'lightning-rainy': { rain: 0.8, clouds: 1, lightning: true },
  lightning: { clouds: 0.9, lightning: true },
  hail: { rain: 0.7, clouds: 0.9 },
  snowy: { snow: 0.6, clouds: 0.7 },
  'snowy-rainy': { snow: 0.35, rain: 0.3, clouds: 0.8 },
  windy: { wind: 1, clouds: 0.3 },
  'windy-variant': { wind: 1, clouds: 0.6 },
  exceptional: { clouds: 0.6 },
};

export function weatherFor(condition: string): Weather {
  return { ...CALM, ...(CONDITIONS[condition] ?? {}) };
}

/**
 * How much of each time of day, from the sun's height in degrees. Full daylight above 12°, golden
 * light from 12° down to just below the horizon, then blue hour into night by -10°. Golden light is
 * dawn while the sun is rising and dusk while it's setting.
 */
export function phaseWeights(elevation: number, rising: boolean): Weights {
  const w: Weights = { dawn: 0, day: 0, dusk: 0, night: 0 };
  const golden = rising ? 'dawn' : 'dusk';
  const clamp = (x: number) => Math.min(1, Math.max(0, x));

  if (elevation >= 4) {
    const g = clamp((12 - elevation) / 8);
    w[golden] = g;
    w.day = 1 - g;
  } else if (elevation >= -4) {
    w[golden] = 1;
  } else {
    const n = clamp((-4 - elevation) / 6);
    w.night = n;
    w[golden] = 1 - n;
  }

  return w;
}

/** Without a sun entity: a rough day from the clock (dawn 6–8, dusk 17–19:30). */
function clockWeights(d = new Date()): Weights {
  const h = d.getHours() + d.getMinutes() / 60;
  // A pretend sun height that peaks at 1 pm, enough to drive phaseWeights.
  const elevation = 50 * Math.sin(((h - 7) / 24) * 2 * Math.PI) + (h > 4 && h < 13 ? 2 : -2);

  return phaseWeights(elevation, h < 13);
}

const SunAttributes = v.object({
  elevation: v.fallback(v.optional(v.number()), undefined),
  rising: v.fallback(v.optional(v.boolean()), undefined),
});

/** The time of day a background was made for, from its name ("…Sunset" is dusk); otherwise day. */
export function nativePhase(name: string): Phase {
  const n = name.toLowerCase();

  if (/sunset|dusk|evening|golden/.test(n)) return 'dusk';

  if (/sunrise|dawn|morning/.test(n)) return 'dawn';

  if (/night|stars|moon/.test(n)) return 'night';

  return 'day';
}

/**
 * The colour the scene is multiplied by at each time of day, when it was made in daylight. Gentle
 * on purpose: the screens' text has to stay readable, and night still shows the scene.
 */
const TINT: Record<Phase, [number, number, number]> = {
  day: [255, 255, 255],
  dawn: [255, 222, 206],
  dusk: [255, 206, 170],
  night: [92, 112, 168],
};

/** A warm glow low in the sky at dawn and dusk (screened over the scene). */
const GLOW: Record<Phase, [number, number, number, number]> = {
  day: [255, 255, 255, 0],
  dawn: [255, 176, 150, 0.22],
  dusk: [255, 150, 90, 0.26],
  night: [40, 60, 120, 0],
};

/** Where the sky ends, as a share of the screen's height, for the bundled scenes; 0 means no open sky. */
const HORIZONS: Record<string, number> = {
  'Mountain Lake Sunset': 0.42,
  'Stylized Forest Brook': 0,
};

const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);

// ---------- the sky ----------

export interface SkyState {
  weights: Weights;
  weather: Weather;
  condition: string;
}

class Sky {
  enabled = false;
  private stage: HTMLElement | null = null;
  private tint!: HTMLElement;
  private glow!: HTMLElement;
  private clouds!: HTMLElement;
  private fog!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private scene = { name: '', native: 'day' as Phase, horizon: 0.5 };
  private state: SkyState = { weights: { dawn: 0, day: 1, dusk: 0, night: 0 }, weather: CALM, condition: 'sunny' };
  private preview: { phase?: Phase; condition?: string } = {};
  private raf = 0;
  private paused = false;
  private last = 0;
  private drops: { x: number; y: number; len: number; speed: number; a: number }[] = [];
  private flakes: { x: number; y: number; r: number; speed: number; phase: number }[] = [];
  private stars: { x: number; y: number; r: number; tw: number; a: number }[] = [];
  private flash = 0;
  private nextFlash = 0;

  /** Adds the sky's layers just above the background, under the film grain and the screens. */
  mount(stage: HTMLElement): void {
    this.enabled = settings.config.sky !== undefined;

    if (!this.enabled || this.stage) return;
    this.stage = stage;
    const before = stage.querySelector('#grain');
    const layer = (id: string, tag = 'div') => {
      const el = document.createElement(tag);
      el.className = 'layer sky-layer';
      el.id = id;
      stage.insertBefore(el, before);

      return el;
    };
    this.clouds = layer('skyClouds');
    this.tint = layer('skyTint');
    this.glow = layer('skyGlow');
    this.fog = layer('skyFog');
    // Clouds and fog drift: a strip twice the screen's width slides along, on the compositor only.
    for (const el of [this.clouds, this.fog]) el.innerHTML = '<div class="sky-drift"></div>';
    const canvas = document.createElement('canvas');
    canvas.className = 'layer sky-layer';
    canvas.id = 'skyFx';
    // Half resolution, scaled up: rain and snow are soft anyway, and it's a quarter of the pixels.
    canvas.width = 960;
    canvas.height = 540;
    stage.insertBefore(canvas, before);
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;
    this.ctx = ctx;
    const texture = cloudTexture();
    for (const el of stage.querySelectorAll<HTMLElement>('.sky-drift')) el.style.backgroundImage = `url("${texture}")`;
    document.documentElement.classList.add('sky-on');

    const params = new URLSearchParams(location.search);
    const p = params.get('sky');
    this.preview = {
      phase: PHASES.find((x) => x === p),
      condition: params.get('wx') ?? undefined,
    };

    ha.onEntities(() => this.update());
    window.setInterval(() => this.update(), 60000);
    window.addEventListener('ct-pause', () => this.pause(true));
    window.addEventListener('ct-resume', () => this.pause(false));
    document.addEventListener('visibilitychange', () => this.pause(document.hidden));
    this.update();
  }

  /** The background now showing: its name decides which time of day it already is. */
  setScene(name: string, native: Phase = nativePhase(name)): void {
    this.scene = { name, native, horizon: HORIZONS[name] ?? 0.5 };
    this.stars = [];
    this.update();
  }

  /** Demo mode and testing: hold a time of day and/or a weather condition (undefined follows the real one). */
  setPreview(phase?: Phase, condition?: string): void {
    this.preview = { phase, condition };
    this.update();
  }

  get now(): SkyState {
    return this.state;
  }

  /** The time of day there's most of right now (day while the sky is off). */
  get phase(): Phase {
    const w = this.state.weights;

    return this.enabled ? PHASES.reduce((a, b) => (w[b] > w[a] ? b : a)) : 'day';
  }

  /**
   * Which version of a background to show now, and the time of day it was made for: the version for
   * this time of day if it has one, otherwise its main picture (graded in code).
   */
  pick(name: string, url: string, variants?: Variants): { url: string; native: Phase } {
    const p = this.phase;
    const own = variants?.[p];

    if (own) return { url: own, native: p };

    const main = variants ? PHASES.find((x) => variants[x] === url) : undefined;

    return { url, native: main ?? nativePhase(name) };
  }

  /** Called when the time of day there's most of changes, to swap in that version of the background. */
  onPhase(fn: () => void): void {
    this.phaseListeners.push(fn);
  }

  private phaseListeners: (() => void)[] = [];
  private lastPhase: Phase | null = null;

  private update(): void {
    if (!this.enabled || !this.ctx) return;
    const sky = settings.config.sky ?? {};
    const sun = ha.entities[sky.sun ?? 'sun.sun'];
    let weights: Weights;

    if (this.preview.phase) {
      weights = { dawn: 0, day: 0, dusk: 0, night: 0 };
      weights[this.preview.phase] = 1;
    } else if (sun) {
      const a = attributes(sun, SunAttributes);
      weights = a.elevation === undefined ? clockWeights() : phaseWeights(a.elevation, a.rising ?? new Date().getHours() < 12);
    } else {
      weights = clockWeights();
    }

    const condition = this.preview.condition ?? ha.entities[sky.weather ?? WEATHER]?.state ?? 'sunny';
    const weather = sky.effects === false ? CALM : weatherFor(condition);
    this.state = { weights, weather, condition };

    if (this.phase !== this.lastPhase) {
      const first = this.lastPhase === null;
      this.lastPhase = this.phase;

      if (!first) this.phaseListeners.forEach((fn) => fn());
    }

    this.paint();
  }

  /** Sets the colour layers and starts or stops the moving ones. */
  private paint(): void {
    const { weights, weather } = this.state;
    const native = this.scene.native;
    // A background already made for a time of day isn't graded toward it again. One made at dawn or
    // dusk can still darken into night, but no tint turns a sunset into midday, so it stays as it is.
    const grade = (p: Phase): Phase => (native === 'day' ? p : native !== 'night' && p === 'night' ? 'night' : 'day');
    let tint = [0, 0, 0];
    let glow = [0, 0, 0, 0];

    for (const p of PHASES) {
      const g = grade(p);
      tint = tint.map((x, i) => x + TINT[g][i] * weights[p]);
      glow = glow.map((x, i) => x + GLOW[g][i] * weights[p]);
    }

    // Clouds take the colour and some of the light out of the scene.
    const grey = [176, 182, 192];
    tint = mix(tint, tint.map((x, i) => (x * grey[i]) / 255), weather.clouds * 0.75);
    glow[3] *= 1 - weather.clouds * 0.8;

    const rgb = (c: number[]) => `rgb(${c.slice(0, 3).map(Math.round).join(',')})`;
    const root = document.documentElement.style;
    root.setProperty('--sky-tint', rgb(tint));
    this.tint.style.backgroundColor = rgb(tint);
    this.glow.style.background = `linear-gradient(to bottom, rgba(0,0,0,0) 8%, rgba(${glow.slice(0, 3).map(Math.round).join(',')},${glow[3].toFixed(3)}) ${Math.round(this.horizonAt() * 100)}%, rgba(0,0,0,0) 85%)`;

    const night = weights.night;
    this.clouds.style.opacity = (weather.clouds * 0.45).toFixed(3);
    this.clouds.style.setProperty('--drift', `${Math.round(240 - weather.wind * 150)}s`);
    this.fog.style.opacity = (weather.fog * (0.75 - night * 0.35)).toFixed(3);

    // Particles: as many as the weather asks for (rain on its own count, snow on its own).
    resize(this.drops, Math.round(weather.rain * 420), () => this.newDrop(true));
    resize(this.flakes, Math.round(weather.snow * 320), () => this.newFlake(true));

    if (!this.stars.length) this.makeStars();
    this.run();
  }

  private horizonAt(): number {
    return this.scene.horizon || 0.45;
  }

  /** Whether anything moves, so the canvas only runs when it's needed. */
  private get starsShowing(): number {
    const { weights, weather } = this.state;

    // A night picture has its own stars; only add them over a scene with open sky that doesn't.
    return this.scene.horizon > 0 && this.scene.native !== 'night' ? weights.night * Math.max(0, 1 - weather.clouds * 1.4 - weather.fog) : 0;
  }

  private get moving(): boolean {
    const w = this.state.weather;

    return w.rain > 0 || w.snow > 0 || w.lightning || this.starsShowing > 0.02;
  }

  private pause(p: boolean): void {
    this.paused = p;
    document.documentElement.classList.toggle('sky-paused', p);
    this.run();
  }

  private run(): void {
    if (this.paused || !this.moving) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.ctx.clearRect(0, 0, 960, 540);

      return;
    }

    if (this.raf) return;
    this.last = performance.now();
    const tick = (t: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = t - this.last;

      // About 30 frames a second is plenty for rain and snow, and leaves the TV room for the rest.
      if (dt < 30) return;
      this.last = t;
      this.draw(Math.min(dt, 100) / 1000, t / 1000);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private newDrop(anywhere: boolean) {
    const fast = 0.6 + Math.random() * 0.4;

    return { x: Math.random() * 1100 - 70, y: anywhere ? Math.random() * 540 : -30 - Math.random() * 60, len: 9 + fast * 12, speed: 520 + fast * 420, a: 0.12 + Math.random() * 0.2 };
  }

  private newFlake(anywhere: boolean) {
    const r = 0.6 + Math.random() * 1.7;

    return { x: Math.random() * 1000 - 20, y: anywhere ? Math.random() * 540 : -6, r, speed: 14 + r * 14, phase: Math.random() * 6.28 };
  }

  private makeStars(): void {
    const h = this.horizonAt() * 540;
    this.stars = Array.from({ length: 140 }, () => {
      const y = Math.pow(Math.random(), 1.4) * h * 0.95;

      return { x: Math.random() * 960, y, r: Math.random() < 0.12 ? 1.1 : 0.6, tw: Math.random() * 6.28, a: (0.35 + Math.random() * 0.65) * (1 - y / h) };
    });
  }

  private draw(dt: number, t: number): void {
    const ctx = this.ctx;
    const w = this.state.weather;
    ctx.clearRect(0, 0, 960, 540);

    const stars = this.starsShowing;

    if (stars > 0.02) {
      ctx.fillStyle = '#fff';

      for (const s of this.stars) {
        ctx.globalAlpha = stars * s.a * (0.7 + 0.3 * Math.sin(t * 1.3 + s.tw));
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
    }

    // Rain: thin slanted streaks, one stroke per brightness so it's a handful of draw calls.
    if (this.drops.length) {
      const slant = 0.12 + w.wind * 0.35;
      ctx.strokeStyle = this.state.weights.night > 0.5 ? '#9fb3cc' : '#dfe8f2';
      ctx.lineWidth = 0.8;

      for (const band of [0.14, 0.22, 0.3]) {
        ctx.globalAlpha = band;
        ctx.beginPath();

        for (const d of this.drops) {
          if (Math.abs(d.a - band) > 0.04) continue;
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.len * slant, d.y + d.len);
        }

        ctx.stroke();
      }

      for (let i = 0; i < this.drops.length; i++) {
        const d = this.drops[i];
        d.y += d.speed * dt;
        d.x -= d.speed * dt * slant;

        if (d.y > 560) this.drops[i] = this.newDrop(false);
      }
    }

    // Snow: soft dots drifting down and swaying.
    if (this.flakes.length) {
      ctx.fillStyle = '#fff';
      const drift = w.wind * 40;

      for (let i = 0; i < this.flakes.length; i++) {
        const f = this.flakes[i];
        f.y += f.speed * dt;
        f.x += (Math.sin(t * 0.8 + f.phase) * 12 - drift) * dt;
        ctx.globalAlpha = 0.35 + f.r * 0.2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, 6.283);
        ctx.fill();

        if (f.y > 546) this.flakes[i] = this.newFlake(false);
      }
    }

    // Lightning: now and then, a soft double flash of the whole sky.
    if (w.lightning) {
      if (!this.nextFlash) this.nextFlash = t + 4 + Math.random() * 10;

      if (t > this.nextFlash) {
        this.flash = 1;
        this.nextFlash = t + 7 + Math.random() * 16;
      }

      if (this.flash > 0) {
        const f = this.flash;
        const flicker = f > 0.75 || (f < 0.55 && f > 0.35) ? 1 : 0.3;
        const g = ctx.createLinearGradient(0, 0, 0, 540);
        g.addColorStop(0, `rgba(225,232,255,${0.42 * f * flicker})`);
        g.addColorStop(1, 'rgba(225,232,255,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 960, 540);
        this.flash = Math.max(0, f - dt * 2.2);
      }
    }

    ctx.globalAlpha = 1;
  }
}

function resize<T>(list: T[], n: number, make: () => T): void {
  if (list.length > n) list.length = n;

  while (list.length < n) list.push(make());
}

/** A soft cloudy texture, made once: soft round blobs, seamless left to right so it can drift forever. */
function cloudTexture(): string {
  const c = document.createElement('canvas');
  c.width = 960;
  c.height = 540;
  const ctx = c.getContext('2d');

  if (!ctx) return '';

  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 960;
    const y = Math.random() * 540;
    const r = 40 + Math.random() * 110;
    const a = 0.25 + Math.random() * 0.35;

    // Drawn three times, a width apart, so the left and right edges meet.
    for (const dx of [-960, 0, 960]) {
      const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y - r, r * 2, r * 2);
    }
  }

  return c.toDataURL('image/png');
}

export const sky = new Sky();
