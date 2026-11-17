import { ha } from '../ha';
import { haPath, dashboardMode } from '../config';
import { musicBackground, musicWave, onLookChange } from '../look';
import { child } from '../dom';
import { artTint, ICON, speaker, type Control, type MusicPanel } from './music-panel';
import type { Section } from './section';

// The Music screen: a calm view of what's playing, like the Weather and Calendar screens. The album
// art, with the song, the artist and the time beneath it, sits above the frosted bar of controls.
// When the screens rest (app.ts, "Fade when idle"), the bar fades and the art and its caption settle
// to the middle. Everything else (speakers, grouping, the queue, the library) is one press away
// under More, in the Music panel (music-panel.ts), which also does the work behind the buttons here.

const MORE = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

/** The bar's buttons, left to right. */
const BUTTONS = ['prev', 'playpause', 'next', 'volDown', 'volUp', 'more'] as const;
type Button = (typeof BUTTONS)[number];

/**
 * A thin wave under the time, with the part already played lit: it drifts while music plays and lies
 * flat when it's paused. It doesn't hear the music (that goes straight to the speakers, never through
 * the TV): it shows how far into the song, and that the screen is alive, not the sound itself.
 * Settings → Appearance → Music wave, or "wave" under "music", turns it off.
 */
/** The wave's path: a gentle sine, wider than its box by two wavelengths so it can drift and loop. */
const WAVE_PATH = `M0 12 Q10 6 20 12${' T'.concat(Array.from({ length: 19 }, (_, i) => `${40 + i * 20} 12`).join(' T'))}`;
const waveSvg = `<svg viewBox="0 0 400 24" preserveAspectRatio="none"><path d="${WAVE_PATH}"/></svg>`;


const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class MusicSection implements Section {
  readonly el: HTMLElement;
  /** Play/pause, so arriving on the screen and pressing OK pauses or plays. */
  readonly defaultItem = 1;
  private buttons: HTMLElement[] = [];
  private focused = 1;
  private active = false;
  private tick = 0;
  private artUrl: string | null = null;

  constructor(private secIndex: number, private panel: MusicPanel) {
    this.el = document.createElement('section');
    this.el.className = 'section';
    this.el.id = 'secMusic';
    // How the album's colour shows behind it (Settings, or "background" under "music"; see style.css).
    this.el.dataset.glow = musicBackground();
    this.el.dataset.wave = musicWave() ? 'on' : 'off';
    onLookChange(() => {
      this.el.dataset.glow = musicBackground();
      this.el.dataset.wave = musicWave() ? 'on' : 'off';
    });
    this.el.innerHTML = `
      <div class="mx-glow"></div>
      <div class="gb mx-frost" id="mxfrost"><div class="gb-mat"><div class="gb-img"></div><div class="gb-veil"></div></div><div class="gb-edge"></div></div>
      <div class="mx-art"></div>
      <div class="mx-caption"><div class="mx-title"></div><div class="mx-artist"></div><div class="mx-time"></div>
        <div class="mx-wave"><div class="w-amp">${waveSvg}<div class="w-done">${waveSvg}</div></div></div></div>
      <div class="gb" id="mxbar">
        <div class="gb-mat"><div class="gb-img"></div><div class="gb-veil"></div></div>
        <div class="gb-edge"></div>
        <div class="mx-row">
          <div class="mx-speaker"></div>
          <div class="mx-mid"></div>
          <div class="mx-end"><span class="mx-vol"></span></div>
        </div>
      </div>`;

    const mid = child(this.el, '.mx-mid');
    const end = child(this.el, '.mx-end');
    this.buttons = BUTTONS.map((b, i) => {
      const btn = document.createElement('button');
      btn.className = `mxb${b === 'playpause' ? ' big' : ''}${b === 'more' ? ' more' : ''}`;
      btn.dataset.sec = String(this.secIndex);
      btn.dataset.item = String(i);
      btn.setAttribute('aria-label', LABELS[b]);

      if (b === 'volDown') end.prepend(btn);
      else if (b === 'volUp' || b === 'more') end.appendChild(btn);
      else mid.appendChild(btn);

      return btn;
    });

    ha.onEntities(() => { if (this.active) this.render(); });
    this.render();
  }

  // ---------- Section ----------

  count(): number {
    return this.buttons.length;
  }

  focus(i: number): void {
    this.focused = i;
    this.buttons.forEach((b, j) => b.classList.toggle('is-focus', j === i));
  }

  blur(): void {
    this.buttons.forEach((b) => b.classList.remove('is-focus'));
  }

  activate(i: number): void {
    const b = BUTTONS[i];

    if (b === 'more') this.panel.show();
    else if (b) this.panel.control(b satisfies Control);
    this.render();
  }

  onEnter(): void {
    this.active = true;
    this.render();
    clearInterval(this.tick);
    this.tick = window.setInterval(() => {
      if (!this.el.classList.contains('is-active')) {
        this.leave();

        return;
      }

      this.render();
    }, 1000);
  }

  private leave(): void {
    this.active = false;
    clearInterval(this.tick);
  }

  private render(): void {
    const p = this.panel.current();
    const s = p ? speaker(p.entity) : undefined;
    const on = s?.state === 'playing' || s?.state === 'paused';
    const a = s?.a;

    // Nothing playing: a placeholder cover (below) and no words (and the bar, until it fades).
    this.el.classList.toggle('idle', !on);
    this.el.classList.toggle('playing', s?.state === 'playing');
    const pic = on && a?.entity_picture ? haPath(a.entity_picture) : '';

    if (pic !== this.artUrl) {
      this.artUrl = pic;
      // Until a cover has loaded (or when there's none: nothing playing, a stream without one, or a
      // picture the TV can't reach), a note on frosted glass like the bars' (#mxfrost) stands in, so
      // the screen still reads as Music. The cover fades in over it once it's there.
      const art = child(this.el, '.mx-art');
      art.innerHTML = `<div class="mx-art-empty">${ICON.note}</div>`;
      this.el.classList.add('no-cover');

      if (pic) {
        const img = new Image();
        img.alt = '';
        img.addEventListener('load', () => {
          if (this.artUrl !== pic) return;
          img.classList.add('loaded');
          this.el.classList.remove('no-cover');
        });
        img.addEventListener('error', () => img.remove());
        img.src = pic;
        art.appendChild(img);
      }
      this.el.classList.remove('tinted');

      void artTint(pic).then((rgb) => {
        if (this.artUrl !== pic || !rgb) return;
        this.el.style.setProperty('--art-tint', rgb);
        this.el.classList.add('tinted');
      });
    }

    child(this.el, '.mx-title').textContent = on ? a?.media_title ?? '' : '';
    child(this.el, '.mx-artist').textContent = on ? a?.media_artist ?? '' : '';
    child(this.el, '.mx-speaker').innerHTML = p ? `${ICON.volUp}<span>${esc(p.name)}</span>` : '';

    this.buttons.forEach((btn, i) => {
      const b = BUTTONS[i];
      btn.innerHTML = b === 'more' ? `${MORE}<span>More</span>` : b === 'playpause' ? (s?.state === 'playing' ? ICON.pause : ICON.play) : ICON[b];
      btn.setAttribute('aria-label', b === 'playpause' && s?.state === 'playing' ? 'Pause' : LABELS[b]);
    });

    const vol = this.panel.level();
    child(this.el, '.mx-vol').textContent = vol === undefined ? '' : `${Math.round(vol * 100)}%`;

    // How far into the song, under the artist ("1:04 / 4:07"); a stream with no length shows nothing.
    const dur = on ? a?.media_duration ?? 0 : 0;
    let pos = a?.media_position ?? 0;

    if (s?.state === 'playing' && a?.media_position_updated_at) pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
    child(this.el, '.mx-time').textContent = dur ? `${mmss(Math.min(pos, dur))} / ${mmss(dur)}` : '';
    // The lit part of the wave is how far into the song (a stream with no length: all of it).
    child(this.el, '.w-done').style.width = `${dur ? Math.min(100, (pos / dur) * 100) : 100}%`;
  }
}

const LABELS: Record<Button, string> = {
  prev: 'Previous', playpause: 'Play', next: 'Next', volDown: 'Volume down', volUp: 'Volume up', more: dashboardMode ? 'Speakers, queue and library' : 'More',
};
