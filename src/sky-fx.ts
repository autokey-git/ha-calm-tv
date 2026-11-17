// The living sky's moving weather, drawn on one half-resolution canvas between the background and
// the screens (see sky.ts). Everything is drawn here, not with CSS layers: a wide, masked, drifting
// CSS layer made the TV's graphics flash.
//
// A background can come with a scene map (see SceneMap): where its sky, water and foreground ground
// are, as outlines. Clouds and lightning stay in the sky, raindrops ring on the water, fog lies at the
// water line and snow settles on the ground. Without a map, only the sky above `horizon` is known.

export const W = 960;
export const H = 540;

type Pt = [number, number];

/** Where things are in a background, as outlines in fractions of the picture (0–1, left/top = 0). */
export interface SceneMap {
  sky?: Pt[];
  water?: Pt[];
  ground?: Pt[];
  /** Where fog lies thickest, as a fraction of the height (default: just below the sky). */
  fog?: number;
}

export type Rgb = [number, number, number];

/** What the weather layer is asked to draw, already worked out by sky.ts. */
export interface FxState {
  rain: number; // 0 … 1 pouring
  snow: number;
  fog: number;
  clouds: number; // cover, 0 clear … 1 overcast
  lightning: boolean;
  wind: number;
  /** How much starlight to add (0 when the picture has its own stars, or it's cloudy). */
  stars: number;
  night: number; // 0 … 1
  /** The colour of light right now (white by day, warm at dawn and dusk, dim blue at night). */
  light: Rgb;
  /** Cloud colour for the time of day. */
  cloud: Rgb;
}

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));

  return t * t * (3 - 2 * t);
};
const css = (c: Rgb, a = 1) => `rgba(${c.map(Math.round).join(',')},${a.toFixed(3)})`;

function canvas(w = W, h = H): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  if (!ctx) throw new Error('No 2D canvas');

  return [c, ctx];
}

/**
 * Smooth value noise, w × h, wrapping left to right so it can drift forever. `cx`/`cy` are the
 * coarsest cells across and down; each octave doubles them. Values 0–1.
 */
function noise(w: number, h: number, cx: number, cy: number, octaves: number): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1;
  let total = 0;

  for (let o = 0; o < octaves; o++) {
    const nx = cx << o;
    const ny = cy << o;
    const grid = new Float32Array((nx + 1) * (ny + 1)).map(() => Math.random());
    const at = (i: number, j: number) => grid[(j % (ny + 1)) * (nx + 1) + (i % nx)];

    for (let y = 0; y < h; y++) {
      const fy = (y / h) * ny;
      const j = Math.floor(fy);
      let ty = fy - j;
      ty = ty * ty * (3 - 2 * ty);

      for (let x = 0; x < w; x++) {
        const fx = (x / w) * nx;
        const i = Math.floor(fx);
        let tx = fx - i;
        tx = tx * tx * (3 - 2 * tx);
        const a = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
        const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
        out[y * w + x] += (a + (b - a) * ty) * amp;
      }
    }

    total += amp;
    amp *= 0.5;
  }

  // Stretched to the full 0–1 range, so thresholds mean the same for every texture.
  let lo = Infinity;
  let hi = -Infinity;

  for (const v of out) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }

  for (let k = 0; k < out.length; k++) out[k] = (out[k] - lo) / (hi - lo || total);

  return out;
}

/**
 * A grey picture from values 0–1: `f` gives each pixel's opacity, `lum` (optional) its brightness,
 * so clouds and snow keep some texture once they're coloured.
 */
function alphaImage(values: Float32Array, w: number, h: number, f: (v: number, x: number, y: number) => number, lum?: (k: number) => number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  const img = ctx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const p = k * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = lum ? Math.round(clamp(lum(k)) * 255) : 255;
      img.data[p + 3] = Math.round(clamp(f(values[k], x, y)) * 255);
    }
  }

  ctx.putImageData(img, 0, 0);

  return c;
}

/** A soft round dot, for snowflakes. */
function softDot(): HTMLCanvasElement {
  const [c, ctx] = canvas(32, 32);
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);

  return c;
}

function inside(pt: Pt, poly: Pt[]): boolean {
  let hit = false;

  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];

    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }

  return hit;
}

interface Drop { x: number; y: number; len: number; speed: number; a: number; near: boolean }
interface Ripple { x: number; y: number; age: number; life: number; r: number }
interface Flake { x: number; y: number; size: number; speed: number; sway: number; phase: number; a: number }
interface Star { x: number; y: number; r: number; tw: number; a: number }

export class SkyFx {
  private readonly ctx: CanvasRenderingContext2D;
  private map: Required<Pick<SceneMap, 'sky'>> & SceneMap = { sky: [[0, 0], [1, 0], [1, 0.45], [0, 0.45]] };
  private s!: FxState;

  // Masks for the scene (white where the area is, soft-edged).
  private skyMask: HTMLCanvasElement | null = null;
  private groundMask: HTMLCanvasElement | null = null;
  private fogBand: HTMLCanvasElement | null = null;
  private waterMask: HTMLCanvasElement | null = null;
  private waterSpots: Pt[] = [];
  private waterTop = 0;
  private waterBottom = 1;

  // Textures, made once.
  private readonly cloudNoise = noise(480, 270, 4, 3, 5);
  private readonly cloudDetail = noise(480, 270, 10, 6, 4);
  /** The cloud noise's values in order, so a cover of 35% can pick the top 35% of it. */
  private readonly cloudSorted = Float32Array.from(this.cloudNoise).sort();
  private readonly fogNoise = noise(480, 135, 3, 2, 4);
  private readonly patchNoise = noise(480, 270, 16, 9, 4);
  private readonly dot = softDot();
  private cloudTex: HTMLCanvasElement | null = null;
  private cloudCover = -1;
  private fogTex: HTMLCanvasElement | null = null;

  // The sky and fog, drifted and masked a few times a second (they move slowly), then reused each frame.
  private readonly air: HTMLCanvasElement;
  private readonly airCtx: CanvasRenderingContext2D;
  private readonly scratch: HTMLCanvasElement;
  private readonly scratchCtx: CanvasRenderingContext2D;
  private readonly refl: HTMLCanvasElement;
  private readonly reflCtx: CanvasRenderingContext2D;
  private airAt = -1;
  private cloudX = 0;
  private fogX = 0;
  private fogX2 = 0;

  // Snow lying on the ground: 0 … 1, grows while it snows and melts after.
  private snowCover = 0;
  private snowTex: HTMLCanvasElement | null = null;
  private snowTexFor = -1;

  private drops: Drop[] = [];
  private ripples: Ripple[] = [];
  private rippleDebt = 0;
  private flakes: Flake[] = [];
  private stars: Star[] = [];
  private flash = 0;
  private nextFlash = 0;
  private bolt: Pt[][] = [];

  constructor(private readonly canvasEl: HTMLCanvasElement) {
    const ctx = canvasEl.getContext('2d');

    if (!ctx) throw new Error('No 2D canvas');
    this.ctx = ctx;
    [this.air, this.airCtx] = canvas();
    [this.scratch, this.scratchCtx] = canvas();
    [this.refl, this.reflCtx] = canvas();
  }

  /** Testing: start with this much snow already lying (0–1). */
  presetSnow(cover: number): void {
    this.snowCover = clamp(cover);
  }

  setMap(map: SceneMap | undefined, horizon: number): void {
    const h = horizon || 0.45;
    this.map = { ...map, sky: map?.sky ?? (horizon ? [[0, 0], [1, 0], [1, h], [0, h]] : []) };
    // Sharp-ish edges: a wide blur lets the original sky glow around the mountains.
    this.skyMask = this.mask(this.map.sky, 1.5, 2);
    this.groundMask = map?.ground ? this.mask(map.ground, 3) : null;
    this.waterMask = map?.water ? this.mask(map.water, 2) : null;
    this.snowTexFor = -1;
    this.airAt = -1;

    // Fog lies thickest at the water line (or just under the sky) and thins above and below it.
    const fy = (map?.fog ?? (map?.water ? Math.min(...map.water.map((p) => p[1])) : h + 0.06)) * H;
    const [band, bctx] = canvas();
    const g = bctx.createLinearGradient(0, 0, 0, H);
    const stop = (y: number, a: number) => g.addColorStop(clamp(y / H), `rgba(255,255,255,${a})`);
    stop(fy - 200, 0);
    stop(fy - 70, 0.55);
    stop(fy, 1);
    stop(fy + 60, 0.7);
    stop(fy + 240, 0.25);
    stop(H, 0.15);
    bctx.fillStyle = g;
    bctx.fillRect(0, 0, W, H);
    this.fogBand = band;

    // Where raindrops can land: points spread over the water.
    this.waterSpots = [];
    const water = map?.water;

    if (water) {
      this.waterTop = Math.min(...water.map((p) => p[1]));
      this.waterBottom = Math.max(...water.map((p) => p[1]));
      const xs = water.map((p) => p[0]);
      const [x0, x1] = [Math.min(...xs), Math.max(...xs)];

      for (let tries = 0; tries < 6000 && this.waterSpots.length < 600; tries++) {
        const p: Pt = [x0 + Math.random() * (x1 - x0), this.waterTop + Math.random() * (this.waterBottom - this.waterTop)];

        if (inside(p, water)) this.waterSpots.push(p);
      }
    }

    this.makeStars();
  }

  /** A soft-edged white shape on a full-size canvas. */
  private mask(poly: Pt[], blur: number, grow = 0): HTMLCanvasElement | null {
    if (poly.length < 3) return null;
    const [c, ctx] = canvas();
    ctx.filter = `blur(${blur}px)`;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
    ctx.closePath();
    ctx.fill();

    // Grown a little past its outline, so its soft edge doesn't leave a bright rim of the picture's own sky.
    if (grow) {
      ctx.lineWidth = grow * 2;
      ctx.stroke();
    }

    return c;
  }

  private makeStars(): void {
    this.stars = [];

    if (!this.skyMask) return;
    const sky = this.map.sky;

    for (let tries = 0; tries < 2000 && this.stars.length < 160; tries++) {
      const p: Pt = [Math.random(), Math.random() * 0.6];

      if (inside(p, sky)) {
        this.stars.push({ x: p[0] * W, y: p[1] * H, r: Math.random() < 0.12 ? 1.1 : 0.6, tw: Math.random() * 6.28, a: 0.35 + Math.random() * 0.65 });
      }
    }
  }

  set(state: FxState): void {
    const before = this.s;
    this.s = state;

    // Rain: far drops are short and faint, near ones long and brighter. Pouring is about three
    // times the drops of ordinary rain, plus a few heavy near streaks.
    const farCount = Math.round(state.rain * state.rain * 900 + state.rain * 120);
    const nearCount = Math.round(Math.max(0, state.rain - 0.5) * 2 * 90);
    const far = this.drops.filter((d) => !d.near).slice(0, farCount);
    const near = this.drops.filter((d) => d.near).slice(0, nearCount);

    while (far.length < farCount) far.push(this.newDrop(false, true));

    while (near.length < nearCount) near.push(this.newDrop(true, true));
    this.drops = [...far, ...near];

    // Snow: many tiny far flakes, fewer middle ones, a handful of big soft ones close by.
    const counts = [Math.round(state.snow * 380), Math.round(state.snow * 110), Math.round(state.snow * 16)];
    const layers = [0, 1, 2].map((l) => this.flakes.filter((f) => layerOf(f) === l).slice(0, counts[l]));
    layers.forEach((list, l) => {
      while (list.length < counts[l]) list.push(this.newFlake(l, true));
    });
    this.flakes = layers.flat();

    if (!before || before.clouds !== state.clouds || before.cloud.join() !== state.cloud.join() || before.fog !== state.fog) this.airAt = -1;
  }

  /** Whether anything moves (the canvas stops when nothing does). */
  get moving(): boolean {
    const s = this.s;

    return !!s && (s.rain > 0 || s.snow > 0 || s.lightning || s.clouds > 0.02 || s.fog > 0.02 || s.stars > 0.02 || this.snowCover > 0.001 || this.ripples.length > 0);
  }

  /** How often to draw: about 30 a second for falling things, 10 for slow drift. */
  get frameMs(): number {
    const s = this.s;

    return s && (s.rain > 0 || s.snow > 0 || s.lightning || this.flash > 0) ? 33 : 100;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, W, H);
  }

  // ---------- particles ----------

  private newDrop(near: boolean, anywhere: boolean): Drop {
    const f = Math.random();

    return near
      ? { x: Math.random() * 1100 - 70, y: anywhere ? Math.random() * H : -60, len: 34 + f * 30, speed: 1100 + f * 500, a: 0.1 + f * 0.1, near }
      : { x: Math.random() * 1100 - 70, y: anywhere ? Math.random() * H : -30 - Math.random() * 60, len: 7 + f * 12, speed: 520 + f * 420, a: 0.1 + f * 0.18, near };
  }

  private newFlake(layer: number, anywhere: boolean): Flake {
    const f = Math.random();
    const [size, speed, a] = [
      [0.9 + f * 0.9, 9 + f * 9, 0.45 + f * 0.25],
      [2.2 + f * 1.8, 20 + f * 14, 0.6 + f * 0.25],
      [7 + f * 6, 46 + f * 26, 0.28 + f * 0.2],
    ][layer];

    return { x: Math.random() * (W + 80) - 40, y: anywhere ? Math.random() * H : -size * 2, size, speed, sway: 4 + layer * 8 + f * 6, phase: Math.random() * 6.28, a };
  }

  // ---------- drawing ----------

  draw(dt: number, t: number): void {
    const ctx = this.ctx;
    const s = this.s;
    ctx.clearRect(0, 0, W, H);

    if (!s) return;
    this.drawStars(t);
    this.drawAir(dt, t);
    this.drawSnowCover(dt);
    this.drawRipples(dt);
    this.drawRain(dt);
    this.drawSnow(dt, t);
    this.drawLightning(dt, t);
    ctx.globalAlpha = 1;
  }

  private drawStars(t: number): void {
    const s = this.s;

    if (s.stars < 0.02) return;
    const ctx = this.ctx;
    ctx.fillStyle = '#fff';

    for (const st of this.stars) {
      ctx.globalAlpha = s.stars * st.a * (0.7 + 0.3 * Math.sin(t * 1.3 + st.tw));
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
  }

  /** Clouds over the sky and fog at the water line: drifted and masked a few times a second. */
  private drawAir(dt: number, t: number): void {
    const s = this.s;
    const wind = 1 + s.wind * 2.5;
    this.cloudX = (this.cloudX + dt * 4.5 * wind) % W;
    this.fogX = (this.fogX + dt * 7 * wind) % W;
    this.fogX2 = (this.fogX2 + dt * 3 * wind) % W;

    if (s.clouds < 0.02 && s.fog < 0.02) return;

    if (this.airAt < 0 || t - this.airAt > 0.12) {
      this.airAt = t;
      this.composeAir();
    }

    this.ctx.globalAlpha = 1;
    this.ctx.drawImage(this.air, 0, 0);
  }

  private composeAir(): void {
    const s = this.s;
    const a = this.airCtx;
    a.clearRect(0, 0, W, H);

    // Clouds: cover thresholds the noise, so partly cloudy is scattered puffs and cloudy fills the sky.
    if (s.clouds > 0.02 && this.skyMask) {
      if (!this.cloudTex || Math.abs(this.cloudCover - s.clouds) > 0.01) {
        const edge = this.cloudSorted[Math.floor(clamp(1 - s.clouds, 0, 0.999) * this.cloudSorted.length)];
        this.cloudCover = s.clouds;
        const base = this.cloudNoise;
        const detail = this.cloudDetail;
        // Overcast still has texture: the base noise is lifted so even thin parts are mostly opaque.
        this.cloudTex = alphaImage(
          base,
          480,
          270,
          // Scattered clouds get crisper edges; overcast is lifted so even its thin parts are mostly opaque.
          (v) => smooth(edge - 0.02 - s.clouds * 0.08, edge + 0.1 + s.clouds * 0.12, v) * (0.8 + 0.19 * s.clouds),
          (k) => 0.5 + 0.32 * detail[k] + 0.18 * base[k],
        );
      }

      // The drifted clouds, once, so they can be both coloured and used as their own shape.
      const tc = this.reflCtx;
      tc.globalCompositeOperation = 'source-over';
      tc.clearRect(0, 0, W, H);
      tileX(tc, this.cloudTex, this.cloudX, 0, H);
      const sc = this.scratchCtx;
      sc.globalCompositeOperation = 'source-over';
      sc.clearRect(0, 0, W, H);
      sc.drawImage(this.refl, 0, 0);
      // Colour them (keeping their light and dark), then keep only their own shape, inside the sky.
      sc.globalCompositeOperation = 'multiply';
      const g = sc.createLinearGradient(0, 0, 0, H * 0.5);
      g.addColorStop(0, css(s.cloud.map((c) => Math.min(255, c * 1.25)) as Rgb));
      g.addColorStop(1, css(s.cloud.map((c) => c * 0.95) as Rgb));
      sc.fillStyle = g;
      sc.fillRect(0, 0, W, H);
      sc.globalCompositeOperation = 'destination-in';
      sc.drawImage(this.refl, 0, 0);
      sc.globalCompositeOperation = 'destination-in';
      sc.drawImage(this.skyMask, 0, 0);
      sc.globalCompositeOperation = 'source-over';
      a.drawImage(this.scratch, 0, 0);

      // The lake mirrors them: flipped at the water line, fainter, only on the water.
      if (this.waterMask) {
        const r = this.reflCtx;
        r.globalCompositeOperation = 'source-over';
        r.clearRect(0, 0, W, H);
        r.save();
        r.translate(0, 2 * this.waterTop * H);
        r.scale(1, -1);
        r.drawImage(this.scratch, 0, 0);
        r.restore();
        r.globalCompositeOperation = 'destination-in';
        r.drawImage(this.waterMask, 0, 0);
        r.globalCompositeOperation = 'source-over';
        a.globalAlpha = 0.55;
        a.drawImage(this.refl, 0, 0);
        a.globalAlpha = 1;
      }
    }

    // Fog: two layers of stretched noise drifting at different speeds, thickest at the water line.
    if (s.fog > 0.02 && this.fogBand) {
      this.fogTex ??= alphaImage(this.fogNoise, 480, 135, (v) => smooth(0.3, 0.8, v));
      const sc = this.scratchCtx;
      sc.globalCompositeOperation = 'source-over';
      sc.clearRect(0, 0, W, H);
      sc.globalAlpha = 0.9;
      tileX(sc, this.fogTex, this.fogX, 0, H);
      sc.globalAlpha = 0.6;
      tileX(sc, this.fogTex, W - this.fogX2, H * 0.25, H * 0.75, true);
      sc.globalAlpha = 1;
      sc.globalCompositeOperation = 'source-in';
      // Fog is lit by the sky: pale by day, a soft blue-grey at night (lighter than the dark scene, so it shows).
      const light = s.light.map((c, i) => c * 0.55 + [225, 230, 236][i] * 0.45 * (1 - s.night * 0.45)) as Rgb;
      sc.fillStyle = css(light, Math.min(1, s.fog * 0.95));
      sc.fillRect(0, 0, W, H);
      sc.globalCompositeOperation = 'destination-in';
      sc.drawImage(this.fogBand, 0, 0);
      sc.globalCompositeOperation = 'source-over';
      a.drawImage(this.scratch, 0, 0);
      // An even haze too, so the far shore softens.
      a.fillStyle = css(light, s.fog * 0.16);
      a.fillRect(0, 0, W, H);
    }
  }

  /** Snow settling on the ground in front, patchy at first, then covering it. */
  private drawSnowCover(dt: number): void {
    const s = this.s;

    if (!this.groundMask) return;
    // About five minutes of snow to cover the ground, about ten to melt.
    this.snowCover = clamp(this.snowCover + (s.snow > 0 ? (dt / 300) * (0.4 + s.snow) : -dt / 600));

    if (this.snowCover < 0.005) return;

    if (!this.snowTex || Math.abs(this.snowTexFor - this.snowCover) > 0.02) {
      this.snowTexFor = this.snowCover;
      const edge = 1 - this.snowCover;
      const detail = this.cloudDetail;
      // Patchy and uneven: thicker toward the front, with the grass and stones showing through at first.
      const patches = alphaImage(
        this.patchNoise,
        480,
        270,
        (v, x, y) => smooth(edge - 0.08, edge + 0.08, v * 0.7 + 0.15 * detail[y * 480 + x] + 0.25 * (y / 270)) * (0.7 + 0.3 * detail[y * 480 + x]),
        (k) => 0.78 + 0.22 * detail[k],
      );
      const [c, ctx] = canvas();
      ctx.drawImage(patches, 0, 0, W, H);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(this.groundMask, 0, 0);
      this.snowTex = c;
    }

    // Lit like everything else: white by day, blue-grey at night.
    const sc = this.scratchCtx;
    sc.globalCompositeOperation = 'source-over';
    sc.clearRect(0, 0, W, H);
    sc.drawImage(this.snowTex, 0, 0);
    sc.globalCompositeOperation = 'multiply';
    // Snow catches what light there is: near white by day, a pale blue-grey at night, brighter than the dark scene.
    sc.fillStyle = css(s.light.map((c, i) => Math.min(255, c * 0.35 + [250, 252, 255][i] * (0.65 - s.night * 0.12))) as Rgb);
    sc.fillRect(0, 0, W, H);
    sc.globalCompositeOperation = 'destination-in';
    sc.drawImage(this.snowTex, 0, 0);
    sc.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1;
    this.ctx.drawImage(this.scratch, 0, 0);
  }

  /** Rings spreading where drops land on the water, flatter toward the far shore. */
  private drawRipples(dt: number): void {
    const s = this.s;
    const ctx = this.ctx;

    if (this.waterSpots.length && s.rain > 0) {
      this.rippleDebt += dt * (s.rain * s.rain * 110 + s.rain * 25);

      while (this.rippleDebt >= 1) {
        this.rippleDebt -= 1;
        const [x, y] = this.waterSpots[Math.floor(Math.random() * this.waterSpots.length)];
        const depth = (y - this.waterTop) / Math.max(0.01, this.waterBottom - this.waterTop);
        this.ripples.push({ x: x * W + (Math.random() - 0.5) * 6, y: y * H, age: 0, life: 0.8 + Math.random() * 0.6, r: 3 + depth * 15 });
      }
    }

    if (!this.ripples.length) return;
    ctx.strokeStyle = css(s.light.map((c) => c * 0.8 + 45) as Rgb);
    ctx.lineWidth = 0.9;

    for (const r of this.ripples) {
      r.age += dt;
      const p = r.age / r.life;

      if (p >= 1) continue;
      const rx = r.r * (0.25 + p);
      ctx.globalAlpha = (1 - p) * 0.75;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, rx, rx * 0.3, 0, 0, 6.283);
      ctx.stroke();

      if (p > 0.25) {
        const rx2 = r.r * (p - 0.2);
        ctx.globalAlpha = (1 - p) * 0.5;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, rx2, rx2 * 0.3, 0, 0, 6.283);
        ctx.stroke();
      }

      // The splash: a tiny upward flick in the first moment.
      if (r.age < 0.09) {
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(r.x, r.y);
        ctx.lineTo(r.x, r.y - 1.5 - r.r * 0.25);
        ctx.stroke();
      }
    }

    this.ripples = this.ripples.filter((r) => r.age < r.life);
  }

  private drawRain(dt: number): void {
    if (!this.drops.length) return;
    const s = this.s;
    const ctx = this.ctx;
    const slant = 0.1 + s.wind * 0.35 + s.rain * 0.06;
    const color = s.light.map((c) => c * 0.7 + 70) as Rgb;

    // A grey veil of rain when it pours: the far hills soften.
    if (s.rain > 0.6) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = css(color, (s.rain - 0.6) * 0.22);
      ctx.fillRect(0, 0, W, H);
    }

    ctx.strokeStyle = css(color);

    for (const [near, width] of [[false, 0.7], [true, 1.3]] as const) {
      for (const band of [0.12, 0.2, 0.28]) {
        ctx.globalAlpha = band;
        ctx.lineWidth = width;
        ctx.beginPath();

        for (const d of this.drops) {
          if (d.near !== near || Math.abs(d.a - band) > 0.04) continue;
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.len * slant, d.y + d.len);
        }

        ctx.stroke();
      }
    }

    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      d.y += d.speed * dt;
      d.x -= d.speed * dt * slant;

      if (d.y > H + 20) this.drops[i] = this.newDrop(d.near, false);
    }
  }

  private drawSnow(dt: number, t: number): void {
    if (!this.flakes.length) return;
    const s = this.s;
    const ctx = this.ctx;
    const drift = s.wind * 50;

    for (let i = 0; i < this.flakes.length; i++) {
      const f = this.flakes[i];
      f.y += f.speed * dt;
      f.x += (Math.sin(t * 0.7 + f.phase) * f.sway - drift) * dt;
      ctx.globalAlpha = f.a * (1 - s.night * 0.25);
      ctx.drawImage(this.dot, f.x - f.size, f.y - f.size, f.size * 2, f.size * 2);

      if (f.y > H + f.size * 2) this.flakes[i] = this.newFlake(layerOf(f), false);
    }
  }

  /** Now and then: a soft double flash of the sky, sometimes with a quick forked bolt. */
  private drawLightning(dt: number, t: number): void {
    const s = this.s;
    const ctx = this.ctx;

    if (s.lightning) {
      if (!this.nextFlash) this.nextFlash = t + 3 + Math.random() * 8;

      if (t > this.nextFlash) {
        this.flash = 1;
        this.nextFlash = t + 7 + Math.random() * 16;
        this.bolt = this.skyMask && Math.random() < 0.75 ? this.makeBolt() : [];
      }
    }

    if (this.flash <= 0) return;
    const f = this.flash;
    const flicker = f > 0.75 || (f < 0.55 && f > 0.35) ? 1 : 0.3;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgba(225,232,255,${0.42 * f * flicker})`);
    g.addColorStop(1, 'rgba(225,232,255,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // The bolt shows for the first quarter second, flickering with the flash.
    if (this.bolt.length && f > 0.45) {
      const strokes: [number, string][] = [[7, 'rgba(170,185,255,0.12)'], [3, 'rgba(200,210,255,0.35)'], [1.1, 'rgba(255,255,255,0.95)']];

      for (const [wdt, col] of strokes) {
        ctx.lineWidth = wdt;
        ctx.strokeStyle = col;
        ctx.lineJoin = 'round';

        this.bolt.forEach((path, k) => {
          ctx.globalAlpha = flicker * (k === 0 ? 1 : 0.6);
          ctx.beginPath();
          path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
        });
      }
    }

    this.flash = Math.max(0, f - dt * 2.2);
  }

  /** A jagged bolt from the top of the sky down to its lower edge, with a branch or two. */
  private makeBolt(): Pt[][] {
    const sky = this.map.sky;
    // Somewhere with plenty of open sky under it, so the bolt has room (not just a peak's tip).
    const depth = (x: number) => {
      let y = 0.05;

      while (y < 0.9 && inside([x, y + 0.02], sky)) y += 0.02;

      return y;
    };
    let x0 = 0;
    let yEnd = 0;

    for (let tries = 0; tries < 12 && yEnd < 0.2; tries++) {
      x0 = 0.12 + Math.random() * 0.76;
      yEnd = depth(x0);
    }

    x0 *= W;
    yEnd *= H;

    if (yEnd < 60) return [];
    const x1 = x0 + (Math.random() - 0.5) * 80;
    const main = jagged([x0, -10], [x1, yEnd], 7, 46);
    const paths = [main];

    for (let b = 0; b < 1 + Math.floor(Math.random() * 2); b++) {
      const from = main[Math.floor(main.length * (0.25 + Math.random() * 0.4))];
      const len = 50 + Math.random() * 90;
      const dir = Math.random() < 0.5 ? -1 : 1;
      paths.push(jagged(from, [from[0] + dir * len * 0.8, Math.min(yEnd, from[1] + len)], 5, 18));
    }

    return paths;
  }
}

/** Midpoint displacement: a line that zig-zags like lightning. */
function jagged(a: Pt, b: Pt, depth: number, spread: number): Pt[] {
  if (depth === 0) return [a, b];
  const mid: Pt = [(a[0] + b[0]) / 2 + (Math.random() - 0.5) * spread, (a[1] + b[1]) / 2 + (Math.random() - 0.5) * spread * 0.25];

  return [...jagged(a, mid, depth - 1, spread / 2), ...jagged(mid, b, depth - 1, spread / 2).slice(1)];
}

/** Draws a texture that wraps left to right, shifted by `x`, stretched to the given band. */
function tileX(ctx: CanvasRenderingContext2D, tex: HTMLCanvasElement, x: number, top: number, height: number, flip = false): void {
  const dx = -(((x % W) + W) % W);

  for (const off of [dx, dx + W]) {
    if (flip) {
      ctx.save();
      ctx.translate(off + W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(tex, 0, top, W, height);
      ctx.restore();
    } else {
      ctx.drawImage(tex, off, top, W, height);
    }
  }
}

function layerOf(f: Flake): number {
  return f.size < 2 ? 0 : f.size < 5 ? 1 : 2;
}
