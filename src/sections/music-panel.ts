import * as v from 'valibot';
import type { MessageBase } from 'home-assistant-js-websocket';
import { ha, type ServiceData } from '../ha';
import { haPath, settings } from '../config';
import { child } from '../dom';
import { icon } from '../icons';
import {
  attributes, BrowseNodeSchema, MediaPlayerAttributes, MusicQueueReplySchema,
  type BrowseChild, type BrowseNode, type MusicQueue, type QueueEntry,
} from '../ha-data';
import { ma, maConfigured, type MaQueueItem } from '../music-assistant';
import { native } from '../native';
import { FocusGroup } from '../focus';
import { hint } from '../hints';

// The Music panel: Music Assistant (or any media players) through Home Assistant. Opened from the
// dock's Music tile. Left: what the chosen speaker is playing, with its controls. Right: the
// speakers, and below them playlists (or other folders) from the player's media library, played on
// the chosen speaker. Everything goes through HA's media_player services and media browser, so
// the TV's own HA user is all it needs.

const wrap = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">${inner}</svg>`;

export const ICON = {
  prev: wrap('<path d="M6 5h2v14H6zM20 5.5v13a.5.5 0 0 1-.78.42L9.5 12.4a.5.5 0 0 1 0-.8l9.72-6.52a.5.5 0 0 1 .78.42z"/>'),
  next: wrap('<path d="M16 5h2v14h-2zM4 5.5v13a.5.5 0 0 0 .78.42l9.72-6.52a.5.5 0 0 0 0-.8L4.78 5.08A.5.5 0 0 0 4 5.5z"/>'),
  play: wrap('<path d="M7 4.6v14.8a.6.6 0 0 0 .92.5l11.2-7.4a.6.6 0 0 0 0-1L7.92 4.1A.6.6 0 0 0 7 4.6z"/>'),
  pause: wrap('<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>'),
  volDown: wrap('<path d="M4 9h3.5L12 5v14l-4.5-4H4zM15 11h6v2h-6z"/>'),
  volUp: wrap('<path d="M4 9h3.5L12 5v14l-4.5-4H4zM17 8h2v3h3v2h-3v3h-2v-3h-3v-2h3z"/>'),
  group: wrap('<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h4A2.5 2.5 0 0 1 12 8.5v9A2.5 2.5 0 0 1 9.5 20h-4A2.5 2.5 0 0 1 3 17.5zm4.5 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm0 3.5a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4zM14 4.5A2.5 2.5 0 0 1 16.5 2h2A2.5 2.5 0 0 1 21 4.5v11a2.5 2.5 0 0 1-2.5 2.5H14zm3.5 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm0 4a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z"/>'),
  shuffle: wrap('<path d="M16.5 4.5 20 8l-3.5 3.5V9.2h-1.3c-1.2 0-2 .5-2.8 1.6l-4.3 6.1c-1.1 1.6-2.5 2.6-4.6 2.6H3v-2h.5c1.3 0 2.1-.5 2.9-1.7l4.3-6.1c1.1-1.5 2.5-2.5 4.5-2.5h1.3zM3 6.5h.5c2 0 3.4.9 4.4 2.3l.6.8-1.2 1.7-.9-1.3C5.6 8.9 4.8 8.5 3.5 8.5H3zm10.7 8.2 1.2-1.7c.7.9 1.4 1.3 2.3 1.4h.3v-2.3L21 15.5 17.5 19v-2.3h-.4c-1.5-.1-2.5-.8-3.4-2z"/>'),
  queue: wrap('<path d="M3 5.5h13v2H3zM3 10.5h13v2H3zM3 15.5h8v2H3zM14 14.6v5.8a.5.5 0 0 0 .76.43l4.6-2.9a.5.5 0 0 0 0-.86l-4.6-2.9a.5.5 0 0 0-.76.43z"/>'),
  everywhere: wrap('<path d="M2 9.5A1.5 1.5 0 0 1 3.5 8h3A1.5 1.5 0 0 1 8 9.5v9A1.5 1.5 0 0 1 6.5 20h-3A1.5 1.5 0 0 1 2 18.5zm3 1.3a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zm0 3.2a1.8 1.8 0 1 0 0 3.6A1.8 1.8 0 0 0 5 14zM9 5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 18.5zm3 1.3a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zm0 4.2a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4zM16 9.5A1.5 1.5 0 0 1 17.5 8h3A1.5 1.5 0 0 1 22 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5zm3 1.3a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zm0 3.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z"/>'),
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>',
  check: wrap('<path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/>'),
  playAll: wrap('<path d="M8 5.6v12.8a.6.6 0 0 0 .92.5l9.7-6.4a.6.6 0 0 0 0-1L8.92 5.1A.6.6 0 0 0 8 5.6z"/>'),
  note: wrap('<path d="M19 3.2v11.3a3.3 3.3 0 1 1-1.8-2.9V7.9L9.8 9.6v7.1a3.3 3.3 0 1 1-1.8-2.9V6.3a1 1 0 0 1 .78-.98l9-2.08A1 1 0 0 1 19 3.2z"/>'),
};

const lineIcon = (d: string, box = '0 0 24 24', width = 2) =>
  `<svg viewBox="${box}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
/**
 * Icons for the media browser's folders, matched by name: the ones Music Assistant's own sidebar
 * uses (Lucide, ISC; Artists and Genres are Music Assistant's own, Apache 2.0).
 */
const FOLDER_ICONS: [RegExp, string][] = [
  [/artist/i, lineIcon('<path d="M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 0c2.12 0 4.16.84 5.66 2.34M12 13c-2.12 0-4.16.84-5.66 2.34A8 8 0 0 0 4 21"/><path d="M21 21a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm0 0v-8l3.5 2"/>', '0 0 26 24')],
  [/album/i, lineIcon('<circle cx="12" cy="12" r="10"/><path d="M6 12c0-1.7.7-3.2 1.8-4.2"/><circle cx="12" cy="12" r="2"/><path d="M18 12c0 1.7-.7 3.2-1.8 4.2"/>')],
  [/track|song/i, lineIcon('<circle cx="8" cy="18" r="4"/><path d="M12 18V2l7 4"/>')],
  [/playlist/i, lineIcon('<path d="M16 5H3"/><path d="M11 12H3"/><path d="M11 19H3"/><path d="M21 16V5"/><circle cx="18" cy="16" r="3"/>')],
  [/audiobook|book/i, lineIcon('<path d="M12 6v7"/><path d="M16 8v3"/><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><path d="M8 8v3"/>')],
  [/podcast/i, lineIcon('<path d="M16.85 18.58a9 9 0 1 0-9.7 0"/><path d="M8 14a5 5 0 1 1 8 0"/><circle cx="12" cy="11" r="1"/><path d="M13 17a1 1 0 1 0-2 0l.5 4.5a.5.5 0 1 0 1 0Z"/>')],
  [/radio/i, lineIcon('<path d="M16.247 7.761a6 6 0 0 1 0 8.478"/><path d="M19.075 4.933a10 10 0 0 1 0 14.134"/><path d="M4.925 19.067a10 10 0 0 1 0-14.134"/><path d="M7.753 16.239a6 6 0 0 1 0-8.478"/><circle cx="12" cy="12" r="2"/>')],
  [/genre/i, lineIcon('<path d="M49.83 33.63a2 2 0 0 1-1.23 1.92l-17.87 8.12a4.2 4.2 0 0 1-3.44 0L12 36.72m-3.83 7.33a2 2 0 0 0 1.2 1.9l17.92 8.14a4.2 4.2 0 0 0 3.44 0l17.87-8.12a2 2 0 0 0 1.23-1.92M19 29.48l8.29 3.78a4.2 4.2 0 0 0 3.46 0l17.87-8.13a2 2 0 0 0 0-3.81l-17.9-8.15a4.2 4.2 0 0 0-3.46 0L22 15.63"/><path d="M13.2 24.1a5.6 5.53 0 1 1-11.2 0 5.6 5.53 0 0 1 11.2 0Zm0 0V2l9.8 5.53"/>', '0 0 52 57', 4)],
  [/favou?rite/i, lineIcon('<path d="M2 9.5a5.5 5.5 0 0 1 9.59-3.68.56.56 0 0 0 .82 0A5.5 5.5 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.49 5.31a2 2 0 0 1-3 .02L5 15c-1.5-1.5-3-3.2-3-5.5"/>')],
];
const folderIcon = (title: string) =>
  FOLDER_ICONS.find(([re]) => re.test(title))?.[1] ?? lineIcon('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>');

/**
 * The album art's most prominent colour, as "r, g, b" (null when it can't be read): the
 * background is tinted with it. The art is shrunk to 24×24; each pixel votes for its hue (one of
 * 24), weighted by how colourful it is, and the winning hue's pixels are averaged. Greys barely
 * vote, so a red cover on a white background still comes out red.
 */
/**
 * The cover's colour made bright and colourful enough to show as a glow on a TV: the same hue,
 * at a fixed lightness and at least moderate saturation, so a dark or muted cover still tints
 * visibly (greys stay grey). Returns "r, g, b".
 */
function vivid(r: number, g: number, b: number): string {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;

  if (d) {
    if (max === R) h = ((G - B) / d + 6) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
  }
  const l0 = (max + min) / 2;
  const s0 = d ? d / (1 - Math.abs(2 * l0 - 1)) : 0;
  const s = s0 < 0.08 ? s0 : Math.max(s0, 0.7);
  const l = 0.48;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];

  return [r1, g1, b1].map((v) => Math.round((v + m) * 255)).join(', ');
}

export function artTint(url: string): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  // On the TV, Home Assistant's picture comes through the app, so its pixels can be read.
  const readable = native && new URL(url, location.href).origin !== location.origin ? `/calmtv-art?u=${encodeURIComponent(url)}` : url;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => {
      // Only the host: Home Assistant's picture addresses carry an access token.
      console.warn('Album art colour: the picture could not be read, from', new URL(url, location.href).host);
      resolve(null);
    };
    img.onload = () => {
      try {
        const n = 24;
        const cv = document.createElement('canvas');
        cv.width = n;
        cv.height = n;
        const cx = cv.getContext('2d');

        if (!cx) return resolve(null);
        cx.drawImage(img, 0, 0, n, n);
        const px = cx.getImageData(0, 0, n, n).data;
        const votes = new Array<number>(24).fill(0);
        const sums = Array.from({ length: 24 }, () => [0, 0, 0, 0]);

        for (let i = 0; i < px.length; i += 4) {
          const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const chroma = max - min;

          if (max < 30) continue;
          let h = 0;

          if (chroma) {
            if (max === r) h = ((g - b) / chroma + 6) % 6;
            else if (max === g) h = (b - r) / chroma + 2;
            else h = (r - g) / chroma + 4;
          }
          const bin = Math.floor(h * 4) % 24;
          const w = (chroma / 255) ** 2 + 0.01;
          votes[bin] += w;
          sums[bin][0] += r * w;
          sums[bin][1] += g * w;
          sums[bin][2] += b * w;
          sums[bin][3] += w;
        }
        const best = votes.indexOf(Math.max(...votes));
        const [r, g, b, w] = sums[best];

        resolve(w ? vivid(r / w, g / w, b / w) : null);
      } catch {
        resolve(null); // a picture from another address that doesn't allow reading its pixels
      }
    };
    img.src = readable;
  });
}

interface Player {
  name: string;
  entity: string;
}

interface LibraryItem {
  title: string;
  id: string;
  type: string;
  thumb: string;
  canPlay: boolean;
  canExpand: boolean;
  /** The "Play all" card at the start of a folder that can be played as a whole. */
  playAll?: boolean;
}

/** One level of the library browser: a folder and where the remote is in it. */
interface Level {
  title: string;
  id: string;
  type: string;
  items: LibraryItem[] | null;
  msg: string;
  /** What was focused before this folder opened, to go back to. */
  cameFrom: string | null;
}

/** Queue items asked of Music Assistant at a time, and at most in all. */
const QUEUE_PAGE = 100;
const QUEUE_MAX = 500;
/** The two rows of controls under the art: playback, then volume and grouping. */
const CONTROL_ROWS = [['shuffle', 'prev', 'playpause', 'next', 'queue'], ['volDown', 'volUp']] as const;
export type Control = (typeof CONTROL_ROWS)[number][number];
const ALL_CONTROLS: readonly Control[] = CONTROL_ROWS.flat();
/** A folder's items drawn at most (Music Assistant can list thousands of tracks). */
const MAX_ITEMS = 500;

/** The library buttons, in order, when calm-tv.json's "library" doesn't name its own: Music Assistant's folders. */
const DEFAULT_LIBRARY = ['Artists', 'Albums', 'Tracks', 'Playlists', 'Radio', 'Podcasts', 'Audiobooks'];
const VOLUME_STEP = 0.05;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The speakers from calm-tv.json's "music", or every media player that Music Assistant made. */
export function musicPlayers(): Player[] {
  const listed = settings.config.music?.players;

  if (listed?.length) return listed;

  return Object.values(ha.entities)
    .filter((e) => e.entity_id.startsWith('media_player.') && 'mass_player_type' in e.attributes)
    .map((e) => ({ name: attributes(e, MediaPlayerAttributes).friendly_name ?? e.entity_id, entity: e.entity_id }));
}

/** Nothing known about a speaker (it isn't in HA's states). */
const NO_ATTRIBUTES = v.parse(MediaPlayerAttributes, {});

/** A speaker's state and attributes, decoded; undefined when HA doesn't list it. */
export function speaker(entity: string): { state: string; a: MediaPlayerAttributes } | undefined {
  const e = ha.entities[entity];

  return e ? { state: e.state, a: attributes(e, MediaPlayerAttributes) } : undefined;
}

export class MusicPanel {
  private el: HTMLElement;
  private open = false;
  /**
   * Remote, touch and mouse (see focus.ts). Ids: "control-playpause", "speaker-2", "speaker-group"
   * (Group speakers, or Done while grouping), "speaker-everywhere", "library-1", "card-4" (in the
   * open folder) and "queue-3". OK and a tap both click the item; onClick says what that does.
   */
  private nav: FocusGroup;
  /** The queue (what's playing and what's next) shows in place of the speakers and library. */
  private queueOpen = false;
  private queue: MusicQueue | null = null;
  private queueMsg = '';
  private queueFor = '';
  private queueTitle = '';
  /** The whole queue, straight from Music Assistant when it's set up on this TV (see music-assistant.ts). */
  private maQueueId = '';
  private maItems: MaQueueItem[] = [];
  /** The queue position of maItems[0]. */
  private maStart = 0;
  private maLoading = false;
  /** The browser's folders, outermost first; empty when the speakers and categories show. */
  private levels: Level[] = [];
  private active = 0;
  private players: Player[] = [];
  private cats: LibraryItem[] = [];
  private catsFor = '';
  private catsMsg = '';
  private tick = 0;
  /** Volume just set, shown until HA catches up. */
  private heldVolume = new Map<string, { value: number; until: number }>();
  /** OK on a speaker turns its card into a volume slider: ←/→ change it, OK or Back when done. */
  private slider = false;
  /** The speaker the slider is on (its index). */
  private sliderAt = -1;
  /** The speakers' states as last drawn (see the constructor). */
  private lastSig = '';
  /** The album art now shown, so a redraw only swaps the picture when it really changes. */
  private artUrl: string | null = null;
  /** Choosing which speakers play along with the chosen one. */
  private grouping = false;
  /** Speakers just added (true) or taken out (false), shown until HA catches up. */
  private heldGroup = new Map<string, { joined: boolean; until: number }>();

  constructor(mount: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'music';
    this.el.innerHTML = `
      <div class="music-bg"></div>
      <div class="music-scrim"></div>
      <div class="music-logo" aria-hidden="true">${icon('musicassistant')}</div>
      <div class="music-body">
        <div class="music-now">
          <div class="music-art"></div>
          <div class="music-title"></div>
          <div class="music-artist"></div>
          <div class="music-group"></div>
          <div class="music-progress"><i></i></div>
          <div class="music-times"><span class="t-pos"></span><span class="t-dur"></span></div>
          <div class="music-controls">
            ${CONTROL_ROWS[0].map((c) => `<button class="mbtn" data-c="${c}" data-focus="control-${c}"></button>`).join('')}
          </div>
          <div class="music-controls music-controls-2">
            <button class="mbtn" data-c="volDown" data-focus="control-volDown"></button>
            <div class="music-volbar"><i></i></div>
            <span class="music-vol"></span>
            <button class="mbtn" data-c="volUp" data-focus="control-volUp"></button>
          </div>
        </div>
        <div class="music-side">
          <div class="music-home">
            <div class="music-spk-top">
              <div class="music-h music-spk-h">Speakers</div>
              <div class="music-note"></div>
            </div>
            <div class="music-spk-wrap" data-nowrap><div class="music-speakers"></div><div class="music-spk-track"><i></i></div></div>
            <div class="music-h music-lib-h">Library</div>
            <div class="music-cats"></div>
          </div>
          <div class="music-queue"></div>
          <div class="music-browse">
            <div class="music-crumbs"></div>
            <div class="music-grid"></div>
          </div>
        </div>
      </div>
      <button class="music-hint">${hint('musicClose')}</button>`;
    mount.appendChild(this.el);
    this.nav = new FocusGroup(this.el, {
      onBack: () => this.back(),
      // ← and → go round between the library and the controls level with it (the speakers don't).
      wrap: 'sideways',
      onKey: (e) => this.sliderKey(e),
      onFocus: (id) => {
        // The focused speaker's group lights up, and a long name scrolls (see render).
        if (id.startsWith('speaker-')) this.render();
        // Near the end of what's loaded of the queue: load more.
        if (id.startsWith('queue-') && Number(id.slice(6)) > this.maItems.length - 10) void this.moreQueue();
      },
    });
    this.el.addEventListener('click', (e) => this.onClick(e));
    // Every state change in the house arrives here; redraw only when one of the speakers changed.
    ha.onStatus(() => this.render());
    ha.onEntities(() => {
      if (!this.open) return;
      const sig = this.playersSignature();

      if (sig === this.lastSig) return;
      this.lastSig = sig;
      // A new song: what's next changed too.
      const title = this.player ? speaker(this.player.entity)?.a.media_title ?? '' : '';

      if (this.queueOpen && title !== this.queueTitle) void this.loadQueue();
      this.render();
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
    // Start on the speaker the Music screen shows (the one playing, if any).
    this.current();
    this.open = true;
    this.grouping = false;
    this.slider = false;
    this.queueOpen = false;
    this.levels = [];
    this.lastSig = this.playersSignature();
    this.el.classList.add('open');
    this.render();
    this.nav.focus(`speaker-${this.active}`);
    void this.loadCats();
    this.tick = window.setInterval(() => this.renderProgress(), 1000);
  }

  close(): void {
    this.open = false;
    this.grouping = false;
    this.slider = false;
    clearInterval(this.tick);
    this.el.classList.remove('open');
  }

  private playersSignature(): string {
    return JSON.stringify(this.players.map((p) => {
      const e = ha.entities[p.entity];

      return e ? [e.state, e.attributes] : null;
    }));
  }

  private get player(): Player | undefined {
    return this.players[this.active];
  }

  /**
   * The speaker the Music screen shows and controls: the one chosen here, unless (while the panel
   * is closed) it's quiet and another speaker is playing, which then becomes the chosen one.
   */
  current(): Player | undefined {
    if (!this.open) {
      this.players = musicPlayers();
      const busy = (p?: Player) => ['playing', 'paused'].includes(p ? ha.entities[p.entity]?.state ?? '' : '');

      if (!busy(this.player)) {
        const playing = this.players.findIndex((p) => ha.entities[p.entity]?.state === 'playing');

        if (playing >= 0) this.active = playing;
      }

      this.active = Math.min(this.active, Math.max(0, this.players.length - 1));
    }

    return this.player;
  }

  /** The Music screen's buttons: the same as the panel's own. */
  control(c: Control): void {
    this.current();
    this.press(c);
  }

  /** The volume the volume buttons set (the group's average), 0–1. */
  level(): number | undefined {
    this.current();

    return this.volume();
  }

  // ---------- Home Assistant ----------

  /** One folder of the speaker's media browser: the top level without `id`. */
  private async browse(entity: string, id?: string, type?: string): Promise<BrowseNode> {
    const conn = ha.connection;

    if (!conn) throw new Error('Not connected');
    const message: MessageBase = { type: 'media_player/browse_media', entity_id: entity };

    if (id) {
      message.media_content_id = id;
      message.media_content_type = type ?? '';
    }

    return v.parse(BrowseNodeSchema, await conn.sendMessagePromise<unknown>(message));
  }

  /** The library's categories (Artists, Albums, Playlists…): the folders at the top of the chosen speaker's media browser. */
  private async loadCats(): Promise<void> {
    const p = this.player;

    if (!p || !ha.connection || this.catsFor === p.entity) return;
    this.catsFor = p.entity;
    this.catsMsg = 'Loading…';
    this.renderCats();
    // Matched by exact name, so other media sources (Radio Browser, Camera, Text-to-speech…) stay out.
    const wanted = (settings.config.music?.library?.length ? settings.config.music.library : DEFAULT_LIBRARY).map(norm);

    try {
      const root = await this.browse(p.entity);
      const folders = (root.children ?? []).filter((c) => c.can_expand && c.media_content_id);
      this.cats = wanted.flatMap((w) => {
        const f = folders.find((c) => norm(c.title ?? '') === w);

        return f ? [toItem(f)] : [];
      });
      this.catsMsg = this.cats.length ? '' : 'Nothing in the library';
    } catch (e) {
      console.warn('Music library', e);
      this.cats = [];
      this.catsMsg = 'Couldn’t load the library';
    }

    this.renderCats();
    this.nav.paint();
  }

  /** Opens a folder in the browser (a category, an artist, an album…). */
  private async openFolder(item: LibraryItem): Promise<void> {
    const p = this.player;

    if (!p) return;
    const level: Level = { title: item.title, id: item.id, type: item.type, items: null, msg: 'Loading…', cameFrom: this.nav.id };
    this.levels.push(level);
    this.renderBrowse();

    try {
      const node = await this.browse(p.entity, item.id, item.type);
      const children = (node.children ?? []).filter((c) => c.media_content_id && (c.can_play || c.can_expand));
      const items = children.slice(0, MAX_ITEMS).map(toItem);

      if (node.can_play && items.length) items.unshift({ title: 'Play all', id: item.id, type: item.type, thumb: '', canPlay: true, canExpand: false, playAll: true });
      level.items = items;
      level.msg = !items.length ? 'Nothing here' : children.length > MAX_ITEMS ? `Showing the first ${MAX_ITEMS} of ${children.length}` : '';
    } catch (e) {
      console.warn('Music browse', e);
      level.items = [];
      level.msg = 'Couldn’t load this';
    }

    if (this.levels.at(-1) !== level) return;
    this.renderBrowse();
    this.nav.focus('card-0');
  }

  private closeFolder(): void {
    const level = this.levels.pop();
    this.render();
    this.nav.focus(level?.cameFrom ?? null);
  }

  private act(service: string, data: ServiceData = {}): void {
    const p = this.player;

    if (p) void ha.call('media_player', service, { entity_id: p.entity, ...data });
  }

  /** One speaker's volume (0–1), or the one just set until HA catches up. */
  private volumeOf(entity: string): number | undefined {
    const held = this.heldVolume.get(entity);

    if (held && held.until > Date.now()) return held.value;
    return speaker(entity)?.a.volume_level;
  }

  /** The speakers the volume buttons turn: every speaker in the group, not only the chosen one. */
  private volumeTargets(): string[] {
    return [...this.group()].filter((e) => ha.entities[e]?.state !== 'unavailable' && this.volumeOf(e) !== undefined);
  }

  /** The volume bar under the controls: the chosen speaker's, or the group's average. */
  private volume(): number | undefined {
    const vols = this.volumeTargets().map((e) => this.volumeOf(e)!);

    return vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : undefined;
  }

  /** Turns one speaker up or down a step. */
  private stepVolume(entity: string, up: boolean): void {
    const now = this.volumeOf(entity);

    if (now === undefined) return;
    const value = Math.round(Math.min(1, Math.max(0, now + (up ? VOLUME_STEP : -VOLUME_STEP))) * 100) / 100;
    this.heldVolume.set(entity, { value, until: Date.now() + 4000 });
    void ha.call('media_player', 'volume_set', { entity_id: entity, volume_level: value });
  }

  /** The speakers playing together with the chosen one (the chosen one included). */
  /**
   * The speaker this one plays along with, or none if it leads or plays alone. Home Assistant
   * lists a group's members with the leader first; the chosen speaker's own changes show at once.
   */
  private leaderOf(entity: string): string | undefined {
    const p = this.player;

    if (p && entity !== p.entity && this.group().has(entity)) return p.entity;
    const lead = speaker(entity)?.a.group_members?.[0];

    return lead && lead !== entity && this.players.some((pl) => pl.entity === lead) ? lead : undefined;
  }

  /**
   * A speaker's cover as a small square with moving bars, or, for a speaker playing along, its
   * leader's cover with a link. A group whose leader isn't playing shows plain squares instead:
   * the leader with the group icon, the others with the link. An idle speaker can still hold its
   * last cover, so only a playing or paused leader's cover is shown.
   */
  private cover(entity: string, linked: boolean): string {
    const e = speaker(entity);
    const on = e?.state === 'playing' || e?.state === 'paused';
    const pic = on && e.a.entity_picture ? haPath(e.a.entity_picture) : '';

    const mark = linked ? ICON.link : on ? '<span class="mspk-bars"><i></i><i></i><i></i></span>' : ICON.group;

    return `<span class="mspk-cover${e?.state === 'playing' ? ' moving' : ''}${on ? '' : ' still'}">${pic ? `<img src="${esc(pic)}" alt="">` : ''}<span class="mspk-over">${mark}</span></span>`;
  }

  private group(): Set<string> {
    const p = this.player;

    if (!p) return new Set();
    const set = new Set<string>([p.entity, ...(speaker(p.entity)?.a.group_members ?? [])]);

    for (const [entity, held] of this.heldGroup) {
      if (held.until < Date.now()) this.heldGroup.delete(entity);
      else if (held.joined) set.add(entity);
      else set.delete(entity);
    }

    set.add(p.entity);

    return set;
  }

  /** Adds a speaker to the chosen one's group, or takes it out. */
  private toggleGroup(entity: string): void {
    const p = this.player;

    if (!p || entity === p.entity) return;
    const joined = !this.group().has(entity);
    this.heldGroup.set(entity, { joined, until: Date.now() + 5000 });

    if (joined) void ha.call('media_player', 'join', { entity_id: p.entity, group_members: [entity] });
    else void ha.call('media_player', 'unjoin', { entity_id: entity });
  }

  private startGrouping(): void {
    if (this.players.length < 2) return;
    this.grouping = true;
    this.queueOpen = false;
    this.render();
    this.nav.focus(`speaker-${this.active === 0 ? 1 : 0}`);
  }

  private stopGrouping(): void {
    this.grouping = false;
    this.render();
    this.nav.focus('speaker-group');
  }

  /** The grid's last tile while grouping: every speaker at once, or back to just the chosen one. */
  private everywhere(): void {
    const p = this.player;

    if (!p) return;
    const group = this.group();
    const others = this.players.filter((pl) => pl.entity !== p.entity && ha.entities[pl.entity]?.state !== 'unavailable');
    const all = others.every((pl) => group.has(pl.entity));

    for (const pl of others) this.heldGroup.set(pl.entity, { joined: !all, until: Date.now() + 5000 });

    if (all) others.forEach((pl) => void ha.call('media_player', 'unjoin', { entity_id: pl.entity }));
    else void ha.call('media_player', 'join', { entity_id: p.entity, group_members: others.map((pl) => pl.entity) });
  }

  private allGrouped(): boolean {
    const p = this.player;
    const group = this.group();

    return !!p && this.players.every((pl) => pl.entity === p.entity || ha.entities[pl.entity]?.state === 'unavailable' || group.has(pl.entity));
  }

  /**
   * Music Assistant's queue for the chosen speaker (music_assistant.get_queue). Home Assistant
   * gives what's playing, what's next and how many are queued, not the whole list.
   */
  private async loadQueue(): Promise<void> {
    const p = this.player;
    const conn = ha.connection;

    if (!p || !conn) return;
    this.queueFor = p.entity;
    this.queueTitle = speaker(p.entity)?.a.media_title ?? '';
    this.queueMsg = this.queue ? '' : 'Loading…';
    this.renderQueue();

    try {
      const reply = v.parse(MusicQueueReplySchema, await conn.sendMessagePromise<unknown>({
        type: 'call_service', domain: 'music_assistant', service: 'get_queue',
        target: { entity_id: p.entity }, return_response: true,
      }));

      // The queue may have closed, or another speaker's opened, while this was on its way.
      if (!this.queueOpen || this.queueFor !== p.entity) return;
      this.queue = reply.response?.[p.entity] ?? null;
      this.queueMsg = this.queue ? '' : 'No queue';

      if (this.queue && maConfigured()) void this.loadFullQueue(p, this.queue);
    } catch (e) {
      console.warn('Music queue', e);
      this.queue = null;
      this.queueMsg = 'Nothing queued on this speaker';
    }

    this.renderQueue();
  }

  /** The rest of the queue after the current song, from Music Assistant itself. */
  private async loadFullQueue(p: Player, q: MusicQueue): Promise<void> {
    const start = (q.current_index ?? -1) + 1;

    try {
      let id = q.queue_id ?? '';

      // Older Home Assistant doesn't say which queue it is: find it by the speaker's name.
      if (!id) {
        const name = (speaker(p.entity)?.a.friendly_name ?? p.name).toLowerCase();
        const all = await ma.queues();
        id = (all.find((x) => x.display_name?.toLowerCase() === name) ?? all.find((x) => x.display_name?.toLowerCase() === p.name.toLowerCase()))?.queue_id ?? '';
      }

      if (!id) return;
      const items = await ma.items(id, start, QUEUE_PAGE);

      if (this.queueFor !== p.entity) return;
      this.maQueueId = id;
      this.maStart = start;
      this.maItems = items;
    } catch (e) {
      console.warn('Music Assistant queue', e);
      this.maItems = [];
    }

    this.renderQueue();
  }

  /** The next page, when the remote gets near the end of what's loaded. */
  private async moreQueue(): Promise<void> {
    const q = this.queue;

    if (this.maLoading || !this.maQueueId || !q?.items || this.maItems.length >= QUEUE_MAX) return;

    if (this.maStart + this.maItems.length >= q.items) return;
    this.maLoading = true;
    const id = this.maQueueId;

    try {
      const more = await ma.items(id, this.maStart + this.maItems.length, QUEUE_PAGE);

      // The queue may have closed, or another speaker's opened, while this page was on its way.
      if (this.queueOpen && this.maQueueId === id) this.maItems = [...this.maItems, ...more];
    } catch (e) {
      console.warn('Music Assistant queue', e);
    }

    this.maLoading = false;
    this.renderQueue();
  }

  private toggleQueue(): void {
    this.queueOpen = !this.queueOpen;

    if (this.queueOpen) {
      this.queue = null;
      this.maItems = [];
      this.maQueueId = '';
      void this.loadQueue();
    }
  }

  private press(c: Control): void {
    const state = this.player ? ha.entities[this.player.entity]?.state : undefined;

    switch (c) {
      case 'prev': this.act('media_previous_track'); break;
      case 'next': this.act('media_next_track'); break;
      case 'playpause': this.act(state === 'playing' ? 'media_pause' : 'media_play'); break;
      case 'volDown':
      case 'volUp': {
        // Each speaker in the group moves a step from its own level (Music Assistant's
        // volume_set on the chosen speaker alone leaves the others where they were).
        for (const e of this.volumeTargets()) this.stepVolume(e, c === 'volUp');
        break;
      }
      case 'shuffle': {
        const on = this.player ? speaker(this.player.entity)?.a.shuffle === true : false;
        this.act('shuffle_set', { shuffle: !on });
        break;
      }
      case 'queue': this.toggleQueue(); break;
    }

    this.render();
  }

  private playItem(item: LibraryItem): void {
    this.act('play_media', { media_content_id: item.id, media_content_type: item.type });
    const grid = child(this.el, '.music-grid');
    grid.querySelector('.mcard.started')?.classList.remove('started');
    grid.querySelector(`[data-focus="${this.nav.id}"]`)?.classList.add('started');
  }

  // ---------- drawing ----------

  private render(): void {
    if (!this.open) return;
    const p = this.player;
    const s = p ? speaker(p.entity) : undefined;
    const a = s?.a ?? NO_ATTRIBUTES;
    const pic = a.entity_picture ? haPath(a.entity_picture) : '';

    if (pic !== this.artUrl) {
      this.artUrl = pic;
      const box = child(this.el, '.music-art');
      box.innerHTML = pic ? `<img src="${esc(pic)}" alt="">` : `<div class="music-art-empty">${ICON.note}</div>`;
      // A cover the TV can't load shows the note too, not an empty frame.
      box.querySelector('img')?.addEventListener('error', () => { if (this.artUrl === pic) box.innerHTML = `<div class="music-art-empty">${ICON.note}</div>`; });
      void artTint(pic).then((rgb) => {
        if (this.artUrl === pic) this.el.style.setProperty('--art-tint', rgb ?? '40, 46, 52');
      });
    }

    // Without Home Assistant there's nothing to show: say so, not "Unavailable" on every speaker.
    const offline = ha.status === 'signed-out' ? 'Not connected to Home Assistant' : ha.status === 'connected' ? '' : 'Connecting to Home Assistant…';
    child(this.el, '.music-title').textContent = offline || a.media_title || (s ? (s.state === 'unavailable' ? 'Unavailable' : 'Nothing playing') : 'No speakers');
    child(this.el, '.music-artist').textContent = [a.media_artist, a.media_album_name].filter(Boolean).join(' · ') || (p?.name ?? '');

    const group = this.group();
    const others = this.players.filter((pl) => pl.entity !== p?.entity && group.has(pl.entity)).map((pl) => pl.name);
    child(this.el, '.music-group').innerHTML = others.length ? `${ICON.group}<span>Also on ${esc(others.join(', '))}</span>` : '';
    child(this.el, '.music-spk-h').textContent = this.grouping ? `Play on ${p?.name ?? ''} and…` : 'Speakers';
    child(this.el, '.music-note').textContent = hint(this.grouping ? 'groupSpeakers' : 'musicSpeakers');
    this.el.classList.toggle('grouping', this.grouping);
    this.el.classList.toggle('sliding', this.slider);

    this.el.querySelectorAll<HTMLElement>('.mbtn').forEach((b) => {
      const c = ALL_CONTROLS.find((x) => x === b.dataset.c);

      if (!c) return;
      b.innerHTML = c === 'playpause' ? (s?.state === 'playing' ? ICON.pause : ICON.play) : ICON[c];
      b.classList.toggle('big', c === 'playpause');
      b.classList.toggle('on', (c === 'shuffle' && a.shuffle === true) || (c === 'queue' && this.queueOpen));
      // While grouping, only the speakers can be chosen.
      b.setAttribute('aria-disabled', String(this.grouping));
    });
    const vol = this.volume();
    child(this.el, '.music-vol').textContent = vol === undefined ? '' : `${Math.round(vol * 100)}%`;
    child(this.el, '.music-volbar i').style.width = `${Math.round((vol ?? 0) * 100)}%`;

    const groupTile = this.players.length < 2 ? '' : this.grouping
      ? `<div class="mspk top" data-focus="speaker-group"><span class="mspk-ico">${ICON.check}</span><div class="mspk-text"><div class="mspk-name"><span>Done grouping</span></div><div class="mspk-status"><span>${others.length ? `${others.length + 1} speakers together` : 'Just one speaker'}</span></div></div></div>`
        + `<div class="mspk top" data-focus="speaker-everywhere"><span class="mspk-ico">${ICON.everywhere}</span><div class="mspk-text"><div class="mspk-name"><span>${this.allGrouped() ? 'Just this speaker' : 'Play everywhere'}</span></div><div class="mspk-status"><span>${this.allGrouped() ? 'Take the others out' : 'Every speaker plays along'}</span></div></div></div>`
      : `<div class="mspk wide" data-focus="speaker-group"><span class="mspk-ico">${ICON.group}</span><div class="mspk-text"><div class="mspk-name"><span>Group speakers</span></div><div class="mspk-status"><span>${others.length ? `${esc(p?.name ?? '')} with ${esc(others.join(', '))}` : `Play what ${esc(p?.name ?? 'this speaker')} is playing in more rooms`}</span></div></div></div>`;
    const spk = this.nav.id?.startsWith('speaker-') ? Number(this.nav.id.slice(8)) : NaN;
    const focusPl = !this.grouping && !offline ? this.players[spk] : undefined;
    const focusHost = focusPl ? this.leaderOf(focusPl.entity) ?? focusPl.entity : undefined;
    child(this.el, '.music-speakers').innerHTML = groupTile + this.players
      .map((pl, i) => {
        const e = speaker(pl.entity);
        const inGroup = i !== this.active && group.has(pl.entity);

        const status = offline ? (ha.status === 'signed-out' ? 'Not connected' : 'Connecting…')
          : !e || e.state === 'unavailable' ? 'Unavailable'
          : inGroup ? `With ${p?.name ?? ''}`
          : this.leaderOf(pl.entity) ? `With ${this.players.find((x) => x.entity === this.leaderOf(pl.entity))?.name ?? ''}`
          : this.grouping && i === this.active ? 'Chosen speaker · OK when done'
          : e.state === 'playing' ? `Playing · ${e.a.media_title ?? ''}` : e.state === 'paused' ? 'Paused' : 'Idle';

        // Playing (or paused) speakers show their cover; ones playing along show their leader's.
        const lead = offline || !e || e.state === 'unavailable' ? undefined : this.leaderOf(pl.entity);
        const host = lead ?? pl.entity;
        const playing = (x: string) => ['playing', 'paused'].includes(speaker(x)?.state ?? '');
        // Speakers grouped around one that isn't playing get plain squares and stay grey.
        const leads = !offline && !lead && !!e && e.state !== 'unavailable' && this.players.some((x) => x.entity !== pl.entity && this.leaderOf(x.entity) === pl.entity);
        const live = !offline && !!e && playing(host);
        const marked = live || !!lead || leads;
        // The focused speaker's group lights up softly, so it's clear which speakers play together.
        const mate = !!focusHost && i !== spk && host === focusHost && (marked || leads);
        const cls = ['mspk', i === this.active ? 'active' : '', inGroup ? 'grouped' : '', live ? 'live' : '', mate ? 'mate' : ''].join(' ');
        if (this.slider && this.sliderAt === i) {
          const v = this.volumeOf(pl.entity) ?? 0;

          return `<div class="${cls} sliding" data-focus="speaker-${i}"><span class="mspk-ico">${ICON.volUp}</span><div class="mspk-text"><div class="mspk-name"><span>${esc(pl.name)}</span></div>`
            + `<div class="mspk-slider"><div class="mspk-bar"><i style="width:${Math.round(v * 100)}%"></i></div><span class="mspk-pct">${Math.round(v * 100)}%</span></div></div></div>`;
        }
        // While grouping: the chosen speaker's square, a link on the ones playing along, an empty square on the rest.
        const chosen = this.player?.entity ?? pl.entity;
        const mark = this.grouping ? (i === this.active ? this.cover(chosen, false) : inGroup ? this.cover(chosen, true) : '<span class="mspk-cover still"></span>')
          : marked ? this.cover(host, !!lead) : '<span class="mspk-dot"></span>';

        return `<div class="${cls}" data-focus="speaker-${i}">${mark}<div class="mspk-text"><div class="mspk-name"><span>${esc(pl.name)}</span></div><div class="mspk-status"><span>${esc(status)}</span></div></div></div>`;
      })
      .join('');
    this.renderProgress();
    this.renderCats();
    this.renderBrowse();
    this.renderQueue();
    this.nav.paint();
    this.speakerTrack();
    this.marquee();
  }

  /** The thin track beside the speakers, shown only when there are more than fit. */
  private speakerTrack(): void {
    const box = child(this.el, '.music-speakers');
    const track = child(this.el, '.music-spk-track');
    const more = box.scrollHeight - box.clientHeight;

    track.classList.toggle('on', more > 2);
    track.parentElement?.classList.toggle('more', more > 2);
    if (more <= 2) return;
    const share = box.clientHeight / box.scrollHeight;
    const thumb = child(track, 'i');
    thumb.style.height = `${share * 100}%`;
    thumb.style.top = `${(box.scrollTop / more) * (1 - share) * 100}%`;
  }

  /** Speaker cards keep their size; a name or status too long for the focused card scrolls. */
  private marquee(): void {
    this.el.querySelectorAll<HTMLElement>('.mspk.focus .mspk-name, .mspk.focus .mspk-status').forEach((box) => {
      const span = box.querySelector('span');
      const extra = span ? span.scrollWidth - box.clientWidth : 0;

      if (span && extra > 4) {
        span.style.setProperty('--scroll', `-${extra + 8}px`);
        span.style.animationDuration = `${Math.max(4, extra / 30 + 3)}s`;
        span.classList.add('scroll');
      }
    });
  }

  private renderQueue(): void {
    this.el.classList.toggle('queue-open', this.queueOpen && !this.levels.length);

    if (!this.queueOpen) return;
    const q = this.queue;
    const box = child(this.el, '.music-queue');
    const row = (label: string, it: QueueEntry | null | undefined) => {
      if (!it) return '';
      const m = it.media_item;
      const img = m?.image ? haPath(m.image) : '';
      const artists = (m?.artists ?? []).map((x) => x.name).filter(Boolean).join(', ');
      const sub = [artists, m?.album?.name].filter(Boolean).join(' · ');

      return `<div class="mq-h">${esc(label)}</div>
        <div class="mq-row"><div class="mq-art">${img ? `<img src="${esc(img)}" alt="">` : ICON.note}</div>
        <div class="mq-text"><div class="mq-name">${esc(m?.name ?? it.name ?? '')}</div><div class="mq-sub">${esc(sub)}</div></div>
        <div class="mq-time">${it.duration ? mmss(it.duration) : ''}</div></div>`;
    };
    const left = q?.items && q.current_index != null ? q.items - q.current_index - 1 : null;
    const facts = q ? [
      left != null ? `${left} more after this` : '',
      q.shuffle_enabled ? 'Shuffle on' : '',
      q.repeat_mode && q.repeat_mode !== 'off' ? `Repeat ${q.repeat_mode}` : '',
    ].filter(Boolean).join(' · ') : '';

    if (q && this.maItems.length) {
      // The whole queue from Music Assistant: a list to scroll through and jump into.
      const list = this.maItems.map((it, i) => {
        const m = it.media_item;
        const img = ma.image(it);
        const artists = (m?.artists ?? []).map((x) => x.name).filter(Boolean).join(', ');

        return `<div class="mql" data-focus="queue-${i}">`
          + `<div class="mql-art">${img ? `<img loading="lazy" src="${esc(img)}" alt="" onerror="this.remove()">` : ''}${ICON.note}</div>`
          + `<div class="mql-text"><div class="mql-name">${esc(m?.name ?? it.name ?? '')}</div><div class="mql-sub">${esc(artists)}</div></div>`
          + `<div class="mq-time">${it.duration ? mmss(it.duration) : ''}</div></div>`;
      }).join('');
      box.innerHTML = `<div class="music-h">Queue · ${esc(this.player?.name ?? '')}</div>`
        + row('Now playing', q.current_item)
        + `<div class="mq-h">Up next${facts ? ` · ${esc(facts)}` : ''}</div>`
        + `<div class="mq-list">${list}</div>`;

      return;
    }

    box.innerHTML = `<div class="music-h">Queue · ${esc(this.player?.name ?? '')}</div>`
      + (q ? row('Now playing', q.current_item) + (q.next_item ? row('Up next', q.next_item) : '<div class="mq-h">Up next</div><div class="music-lib-msg">Nothing after this one</div>')
        + (facts ? `<div class="mq-facts">${esc(facts)}</div>` : '')
        + (maConfigured() ? '' : '<div class="mq-facts mq-tip">To see the whole queue, connect Music Assistant in Settings → Home Assistant → Music Assistant.</div>')
        : `<div class="music-lib-msg">${esc(this.queueMsg)}</div>`);
  }

  private renderCats(): void {
    const box = child(this.el, '.music-cats');

    if (!this.cats.length) {
      box.innerHTML = `<div class="music-lib-msg">${esc(this.catsMsg || 'The library shows up once a speaker is available')}</div>`;

      return;
    }

    box.innerHTML = this.cats
      .map((c, i) => `<div class="mcat" data-focus="library-${i}" aria-disabled="${this.grouping}">${folderIcon(c.title)}<span>${esc(norm(c.title) === 'radio' ? 'Radio' : c.title)}</span></div>`)
      .join('');
  }

  /** The browser's grid is drawn once per folder; moving the remote only moves the focus. */
  private drawnLevel: Level | null = null;

  private renderBrowse(): void {
    const level = this.levels.at(-1);
    this.el.classList.toggle('browsing', !!level);
    child(this.el, '.music-hint').textContent = hint(level ? 'musicUp' : this.slider ? 'musicVolume' : this.grouping ? 'musicDone' : this.queueOpen ? 'musicQueue' : 'musicClose');

    if (!level) {
      this.drawnLevel = null;

      return;
    }

    const grid = child(this.el, '.music-grid');
    child(this.el, '.music-crumbs').innerHTML = this.levels.map((l) => `<span>${esc(l.title)}</span>`).join('<i>›</i>')
      + (level.msg && level.items?.length ? `<em>${esc(level.msg)}</em>` : '');

    if (this.drawnLevel !== level || grid.dataset.ready !== String(!!level.items)) {
      this.drawnLevel = level;
      grid.dataset.ready = String(!!level.items);
      grid.scrollTop = 0;
      grid.innerHTML = !level.items?.length
        ? `<div class="music-lib-msg">${esc(level.msg)}</div>`
        : level.items
          .map((it, i) => `<div class="mcard${it.playAll ? ' playall' : ''}" data-focus="card-${i}">
              <div class="mcard-art">${it.playAll ? ICON.playAll : it.thumb ? `<img loading="lazy" src="${esc(it.thumb)}" alt="">` : it.canExpand ? folderIcon(this.levels[0]?.title ?? '') : ICON.note}</div>
              <div class="mcard-name">${esc(it.title)}</div></div>`)
          .join('');
    }
  }

  /** The progress bar moves on its own between HA updates while playing. */
  private renderProgress(): void {
    const s = this.player ? speaker(this.player.entity) : undefined;
    const a = s?.a ?? NO_ATTRIBUTES;
    const dur = a.media_duration ?? 0;
    let pos = a.media_position ?? 0;

    if (s?.state === 'playing' && a.media_position_updated_at) {
      pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
    }

    pos = Math.min(Math.max(0, pos), dur || pos);
    child(this.el, '.music-progress i').style.width = dur ? `${(pos / dur) * 100}%` : '0';
    child(this.el, '.t-pos').textContent = dur ? mmss(pos) : '';
    child(this.el, '.t-dur').textContent = dur ? mmss(dur) : '';
  }

  // ---------- remote, touch and mouse (see focus.ts) ----------

  /** Back: up a folder, off the volume slider, out of grouping or the queue, or closed. */
  private back(): void {
    if (this.levels.length) this.closeFolder();
    else if (this.slider) this.stopSlider();
    else if (this.grouping) this.stopGrouping();
    else if (this.queueOpen) {
      this.queueOpen = false;
      this.render();
      this.nav.focus('control-queue');
    } else this.close();
  }

  /** While a speaker's volume slider is open, ←/→ change its volume; any other key closes it. */
  private sliderKey(e: KeyboardEvent): boolean {
    if (!this.slider || e.key === 'Escape' || e.key === 'Backspace') return false;
    e.preventDefault();
    const pl = this.players[this.sliderAt];

    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && pl) {
      this.stepVolume(pl.entity, e.key === 'ArrowRight');
      this.render();
    } else this.stopSlider();

    return true;
  }

  private stopSlider(): void {
    this.slider = false;
    this.render();
  }

  /**
   * What choosing an item does, whether by OK on the remote (which clicks the focused item), a tap
   * or a mouse click. The bottom hint is the Back button for touch and mouse.
   */
  private onClick(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;

    if (target?.closest('.music-hint')) {
      this.back();

      return;
    }

    // On a touch screen the open slider's bar sets the volume where it's tapped.
    const bar = target?.closest<HTMLElement>('.mspk-bar');
    const pl = this.players[this.sliderAt];

    if (bar && this.slider && pl) {
      const r = bar.getBoundingClientRect();
      const value = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 20) / 20;
      this.heldVolume.set(pl.entity, { value, until: Date.now() + 4000 });
      void ha.call('media_player', 'volume_set', { entity_id: pl.entity, volume_level: value });
      this.render();

      return;
    }

    const id = target?.closest<HTMLElement>('[data-focus]')?.dataset.focus ?? '';
    const [kind, which = ''] = id.split('-');
    const i = Number(which);

    if (kind === 'control') {
      const c = ALL_CONTROLS.find((x) => x === which);

      if (c && !this.grouping) this.press(c);
    } else if (kind === 'queue') {
      const it = this.maItems[i];

      if (it && this.maQueueId) {
        void ma.playIndex(this.maQueueId, it.queue_item_id).catch((err) => console.warn('Music Assistant play', err));
        // The list starts after the new song once Home Assistant reports it.
        this.nav.focus('control-playpause');
      }
    } else if (id === 'speaker-group') {
      if (this.grouping) this.stopGrouping();
      else this.startGrouping();
    } else if (id === 'speaker-everywhere') {
      this.everywhere();
      this.render();
    } else if (kind === 'speaker') {
      const sp = this.players[i];

      if (!sp) return;

      if (this.slider) this.stopSlider();
      else if (this.grouping) {
        if (i === this.active) this.stopGrouping();
        else {
          this.toggleGroup(sp.entity);
          this.render();
        }
      } else if (i === this.active || this.group().has(sp.entity)) {
        // OK on the chosen speaker (or one playing along with it) opens its volume slider.
        this.slider = ha.entities[sp.entity]?.state !== 'unavailable' && this.volumeOf(sp.entity) !== undefined;
        this.sliderAt = i;
        this.render();
      } else {
        // OK on any other speaker chooses it, to play something else there.
        this.active = i;
        void this.loadCats();
        this.render();
      }
    } else if (kind === 'library') {
      const c = this.cats[i];

      if (c && !this.grouping) void this.openFolder(c);
    } else if (kind === 'card') {
      const it = this.levels.at(-1)?.items?.[i];

      if (it?.canExpand && !it.playAll) void this.openFolder(it);
      else if (it?.canPlay) this.playItem(it);
    }
  }

  handleKey(e: KeyboardEvent): void {
    this.nav.handleKey(e);
  }
}

const toItem = (c: BrowseChild): LibraryItem => ({
  title: c.title ?? '',
  id: c.media_content_id ?? '',
  type: c.media_content_type ?? 'music',
  thumb: c.thumbnail ? haPath(c.thumbnail) : '',
  canPlay: !!c.can_play,
  canExpand: !!c.can_expand,
});

/** Folder names compared without case, and "Radio stations" as "Radio". */
const norm = (t: string) => t.trim().toLowerCase().replace(/^radio stations?$/, 'radio');
