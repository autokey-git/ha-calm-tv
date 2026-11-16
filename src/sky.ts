import * as v from 'valibot';
import { ha } from './ha';
import { settings } from './config';
import { WEATHER } from './home-data';
import { attributes } from './ha-data';
import { PHASES, type Phase, type Variants } from './variants';
import { SkyFx, W, H, type SceneMap, type Rgb } from './sky-fx';

/**
 * The living sky: the background follows the time of day and the weather.
 *
 *  - Time of day comes from the sun (sun.sun's elevation), so dawn and dusk arrive gradually with
 *    the real sunrise and sunset, not on the hour. Any photo or video gets a code-only look: warmer
 *    at dawn and dusk, darker and bluer at night, with stars in the sky when it's clear.
 *  - The weather draws on top (sky-fx.ts): rain, pouring rain, snow, fog, clouds and lightning. With a
 *    scene map, raindrops ring on the water, snow settles on the ground and clouds stay in the sky.
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
  rainy: { rain: 0.45, clouds: 0.92 },
  pouring: { rain: 1, clouds: 1 },
  'lightning-rainy': { rain: 0.8, clouds: 1, lightning: true },
  lightning: { clouds: 0.9, lightning: true },
  hail: { rain: 0.7, clouds: 0.9 },
  snowy: { snow: 0.6, clouds: 0.85 },
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

/** Cloud colour at each time of day (lit from above by day, dark blue-grey at night). */
const CLOUD: Record<Phase, Rgb> = {
  day: [214, 219, 228],
  dawn: [184, 158, 166],
  dusk: [176, 134, 122],
  night: [48, 56, 76],
};

/** Where the sky ends, as a share of the screen's height, for the bundled scenes; 0 means no open sky. */
const HORIZONS: Record<string, number> = {
  'Mountain Lake Sunset': 0.42,
  'Stylized Forest Brook': 0,
};

/** Scene maps for the bundled backgrounds (sky-fx.ts). Others can bring theirs in calm-tv.json. */
const MAPS: Record<string, SceneMap> = {
  'Mountain Lake Sunset': {
    sky: [[0, 0], [1, 0], [1, 0.3], [0.86, 0.3], [0.72, 0.24], [0.63, 0.22], [0.52, 0.33], [0.42, 0.4], [0.3, 0.39], [0.2, 0.34], [0.1, 0.24], [0, 0.21]],
    water: [[0.08, 0.57], [0.24, 0.535], [1, 0.545], [1, 0.95], [0.62, 0.97], [0.44, 0.9], [0.34, 0.8], [0.3, 0.71], [0.2, 0.66], [0.1, 0.61]],
    ground: [[0, 0.6], [0.1, 0.61], [0.2, 0.66], [0.3, 0.71], [0.34, 0.8], [0.44, 0.9], [0.62, 0.97], [0.62, 1], [0, 1]],
  },
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
  private fx: SkyFx | null = null;
  private scene: { name: string; native: Phase; horizon: number; map?: SceneMap } = { name: '', native: 'day', horizon: 0.5 };
  private state: SkyState = { weights: { dawn: 0, day: 1, dusk: 0, night: 0 }, weather: CALM, condition: 'sunny' };
  private preview: { phase?: Phase; condition?: string } = {};
  private raf = 0;
  private paused = false;
  private last = 0;

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
    this.tint = layer('skyTint');
    this.glow = layer('skyGlow');
    const canvas = document.createElement('canvas');
    canvas.className = 'layer sky-layer';
    canvas.id = 'skyFx';
    // Half resolution, scaled up: weather is soft anyway, and it's a quarter of the pixels.
    canvas.width = W;
    canvas.height = H;
    stage.insertBefore(canvas, before);
    this.fx = new SkyFx(canvas);
    this.fx.setMap(this.scene.map, this.scene.horizon);
    document.documentElement.classList.add('sky-on');

    const params = new URLSearchParams(location.search);
    const p = params.get('sky');
    this.preview = {
      phase: PHASES.find((x) => x === p),
      condition: params.get('wx') ?? undefined,
    };
    // ?snowcover=0.8 starts with snow already on the ground (it otherwise takes minutes to settle).
    const cover = Number(params.get('snowcover'));

    if (cover) this.fx.presetSnow(cover);

    ha.onEntities(() => this.update());
    window.setInterval(() => this.update(), 60000);
    window.addEventListener('ct-pause', () => this.pause(true));
    window.addEventListener('ct-resume', () => this.pause(false));
    document.addEventListener('visibilitychange', () => this.pause(document.hidden));
    this.update();
  }

  /** The background now showing: its name decides which time of day it already is. */
  setScene(name: string, native: Phase = nativePhase(name), map?: SceneMap): void {
    const m = map ?? MAPS[name];
    const changed = name !== this.scene.name || m !== this.scene.map;
    this.scene = { name, native, horizon: HORIZONS[name] ?? 0.5, map: m };

    if (changed) this.fx?.setMap(m, this.scene.horizon);
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
    if (!this.enabled || !this.fx) return;
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

    // Clouds and heavy rain take some colour and light out of the whole scene.
    const grey = [176, 182, 192];
    const dim = Math.min(1, weather.clouds * 0.55 + Math.max(0, weather.rain - 0.5) * 0.7);
    tint = mix(tint, tint.map((x, i) => (x * grey[i]) / 255), dim);
    glow[3] *= 1 - weather.clouds * 0.8;

    const rgb = (c: number[]) => `rgb(${c.slice(0, 3).map(Math.round).join(',')})`;
    const root = document.documentElement.style;
    root.setProperty('--sky-tint', rgb(tint));
    this.tint.style.backgroundColor = rgb(tint);
    this.glow.style.background = `linear-gradient(to bottom, rgba(0,0,0,0) 8%, rgba(${glow.slice(0, 3).map(Math.round).join(',')},${glow[3].toFixed(3)}) ${Math.round(this.horizonAt() * 100)}%, rgba(0,0,0,0) 85%)`;

    // The light and cloud colour for the real time of day, whatever the picture was made for:
    // they colour the weather (snow is blue-grey at night even on a night picture).
    let light: Rgb = [0, 0, 0];
    let cloud: Rgb = [0, 0, 0];

    for (const p of PHASES) {
      light = light.map((x, i) => x + TINT[p][i] * weights[p]) as Rgb;
      cloud = cloud.map((x, i) => x + CLOUD[p][i] * weights[p]) as Rgb;
    }

    // Heavier cloud is darker underneath.
    cloud = cloud.map((c) => c * (1 - weather.clouds * 0.25)) as Rgb;
    this.fx?.set({ ...weather, stars: this.starsShowing, night: weights.night, light, cloud });
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

  private pause(p: boolean): void {
    this.paused = p;
    document.documentElement.classList.toggle('sky-paused', p);
    this.run();
  }

  private run(): void {
    const fx = this.fx;

    if (!fx) return;

    if (this.paused || !fx.moving) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      fx.clear();

      return;
    }

    if (this.raf) return;
    this.last = performance.now();
    const tick = (t: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = t - this.last;

      // About 30 frames a second while things fall, 10 for slow drift: leaves the TV room for the rest.
      if (dt < fx.frameMs - 3) return;
      this.last = t;
      fx.draw(Math.min(dt, 120) / 1000, t / 1000);

      // Stop once everything has settled (e.g. snow on the ground has melted).
      if (!fx.moving) this.run();
    };
    this.raf = requestAnimationFrame(tick);
  }
}

export const sky = new Sky();
