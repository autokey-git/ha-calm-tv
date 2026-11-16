import { ha, type ServiceData } from '../ha';
import { haPath, settings } from '../config';
import { child } from '../dom';
import { ma, maConfigured, type MaQueueItem } from '../music-assistant';
import { showMaSetup } from '../ma-setup';

// The Music panel: Music Assistant (or any media players) through Home Assistant. Opened from the
// dock's Music tile. Left: what the chosen speaker is playing, with its controls. Right: the
// speakers, and below them playlists (or other folders) from the player's media library, played on
// the chosen speaker. Everything goes through HA's media_player services and media browser, so
// the TV's own HA user is all it needs.

const wrap = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">${inner}</svg>`;
const ICON = {
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
  gear: wrap('<path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.4l-.4 2.7a7.6 7.6 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6c0 .3.2.5.5.5h4c.3 0 .5-.2.5-.4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>'),
  check: wrap('<path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/>'),
  playAll: wrap('<path d="M8 5.6v12.8a.6.6 0 0 0 .92.5l9.7-6.4a.6.6 0 0 0 0-1L8.92 5.1A.6.6 0 0 0 8 5.6z"/>'),
  note: wrap('<path d="M19 3.2v11.3a3.3 3.3 0 1 1-1.8-2.9V7.9L9.8 9.6v7.1a3.3 3.3 0 1 1-1.8-2.9V6.3a1 1 0 0 1 .78-.98l9-2.08A1 1 0 0 1 19 3.2z"/>'),
};

const lineIcon = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
/** Icons for the media browser's folders, matched by name (as Music Assistant's sidebar has them). */
const FOLDER_ICONS: [RegExp, string][] = [
  [/artist/i, lineIcon('<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 4v8.5a2 2 0 1 1-1.5-1.94"/>')],
  [/album/i, lineIcon('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/>')],
  [/track|song/i, lineIcon('<path d="M10 18V5l8-1.5"/><circle cx="7.5" cy="18" r="2.5"/>')],
  [/playlist/i, lineIcon('<path d="M4 6h11M4 11h11M4 16h6"/><path d="M18 9v8a2 2 0 1 1-1.5-1.94"/>')],
  [/audiobook|book/i, lineIcon('<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>')],
  [/podcast/i, '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 12c0 .74-.4 1.38-1 1.72V22h-2v-8.28c-.6-.35-1-.98-1-1.72 0-1.1.9-2 2-2s2 .9 2 2zm-2-6c-3.31 0-6 2.69-6 6 0 1.74.75 3.31 1.94 4.4l1.42-1.42C8.53 14.25 8 13.19 8 12c0-2.21 1.79-4 4-4s4 1.79 4 4c0 1.19-.53 2.25-1.36 2.98l1.42 1.42C17.25 15.31 18 13.74 18 12c0-3.31-2.69-6-6-6zm0-4C6.48 2 2 6.48 2 12c0 2.85 1.2 5.41 3.11 7.24l1.42-1.42C4.98 16.36 4 14.29 4 12c0-4.41 3.59-8 8-8s8 3.59 8 8c0 2.29-.98 4.36-2.53 5.82l1.42 1.42C20.8 17.41 22 14.85 22 12c0-5.52-4.48-10-10-10z"/></svg>'],
  [/radio/i, lineIcon('<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>')],
  [/genre/i, lineIcon('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5M3 16.5l9 5 9-5"/>')],
  [/favou?rite/i, lineIcon('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>')],
];
const folderIcon = (title: string) =>
  FOLDER_ICONS.find(([re]) => re.test(title))?.[1] ?? lineIcon('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>');

/** A queue entry, as music_assistant.get_queue answers (only the parts used here). */
interface QueueItem {
  name?: string;
  duration?: number | null;
  media_item?: { name?: string; image?: string | null; artists?: { name?: string }[]; album?: { name?: string } } | null;
}

interface QueueInfo {
  queue_id?: string;
  items?: number;
  current_index?: number | null;
  shuffle_enabled?: boolean;
  repeat_mode?: string;
  current_item?: QueueItem | null;
  next_item?: QueueItem | null;
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
  focus: number;
}

/** What media_player/browse_media answers (only the parts used here). */
interface BrowseNode {
  title?: string;
  media_content_id?: string;
  media_content_type?: string;
  can_play?: boolean;
  can_expand?: boolean;
  thumbnail?: string | null;
  children?: BrowseNode[];
}

type Area = 'controls' | 'speakers' | 'cats' | 'browse' | 'queue' | 'gear';
/** Queue items asked of Music Assistant at a time, and at most in all. */
const QUEUE_PAGE = 100;
/** While grouping, the "Play everywhere" tile beside Done (top right of the speakers). */
const EVERYWHERE = -2;
const QUEUE_MAX = 500;
const CAT_COLS = 3;
/** The two rows of controls under the art: playback, then volume and grouping. */
const CONTROL_ROWS = [['shuffle', 'prev', 'playpause', 'next', 'queue'], ['volDown', 'volUp']] as const;
type Control = (typeof CONTROL_ROWS)[number][number];
/** A folder's items drawn at most (Music Assistant can list thousands of tracks). */
const MAX_ITEMS = 500;
/** The library buttons, in order, when calm-tv.json's "library" doesn't name its own: Music Assistant's folders. */
const DEFAULT_LIBRARY = ['Artists', 'Albums', 'Tracks', 'Playlists', 'Radio', 'Podcasts', 'Audiobooks'];
const GRID_COLS = 5;
const VOLUME_STEP = 0.05;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The speakers from calm-tv.json's "music", or every media player that Music Assistant made. */
export function musicPlayers(): Player[] {
  const listed = settings.config.music?.players;

  if (listed?.length) return listed;

  return Object.values(ha.entities)
    .filter((e) => e.entity_id.startsWith('media_player.') && 'mass_player_type' in e.attributes)
    .map((e) => ({ name: String(e.attributes.friendly_name ?? e.entity_id), entity: e.entity_id }));
}

/** True when the Music tile should be in the dock. */
export const musicEnabled = () => !!settings.config.music;

export class MusicPanel {
  private el: HTMLElement;
  private open = false;
  private area: Area = 'speakers';
  private ctrl = 2;
  private ctrlRow = 0;
  /** The queue (what's playing and what's next) shows in place of the speakers and library. */
  private queueOpen = false;
  private queue: QueueInfo | null = null;
  private queueMsg = '';
  private queueFor = '';
  private queueTitle = '';
  /** The whole queue, straight from Music Assistant when it's set up on this TV (see music-assistant.ts). */
  private maQueueId = '';
  private maItems: MaQueueItem[] = [];
  /** The queue position of maItems[0]. */
  private maStart = 0;
  private maLoading = false;
  private qFocus = 0;
  private spk = 0;
  private cat = 0;
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
      <div class="music-body">
        <div class="music-now">
          <div class="music-art"></div>
          <div class="music-title"></div>
          <div class="music-artist"></div>
          <div class="music-group"></div>
          <div class="music-progress"><i></i></div>
          <div class="music-times"><span class="t-pos"></span><span class="t-dur"></span></div>
          <div class="music-controls">
            ${CONTROL_ROWS[0].map((c) => `<button class="mbtn" data-c="${c}"></button>`).join('')}
          </div>
          <div class="music-controls music-controls-2">
            <button class="mbtn" data-c="volDown"></button>
            <div class="music-volbar"><i></i></div>
            <span class="music-vol"></span>
            <button class="mbtn" data-c="volUp"></button>
          </div>
        </div>
        <div class="music-side">
          <div class="music-home">
            <div class="music-h music-spk-h">Speakers</div>
            <div class="music-note"></div>
            <div class="music-speakers"></div>
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
      <div class="music-hint">Back to close</div>
      <button class="music-gear" aria-label="Music Assistant settings">${ICON.gear}</button>`;
    mount.appendChild(this.el);
    // Every state change in the house arrives here; redraw only when one of the speakers changed.
    ha.onEntities(() => {
      if (!this.open) return;
      const sig = this.playersSignature();

      if (sig === this.lastSig) return;
      this.lastSig = sig;
      // A new song: what's next changed too.
      const title = this.player ? String(ha.entities[this.player.entity]?.attributes.media_title ?? '') : '';

      if (this.queueOpen && title !== this.queueTitle) void this.loadQueue();
      this.render();
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.players = musicPlayers();
    this.open = true;
    // Start on the speaker that's playing, if any.
    const playing = this.players.findIndex((p) => ha.entities[p.entity]?.state === 'playing');
    this.active = this.spk = Math.max(0, playing);
    this.area = 'speakers';
    this.grouping = false;
    this.slider = false;
    this.queueOpen = false;
    this.levels = [];
    this.lastSig = this.playersSignature();
    this.el.classList.add('open');
    this.render();
    void this.loadCats();
    this.tick = window.setInterval(() => this.renderProgress(), 1000);
  }

  close(): void {
    this.open = false;
    this.grouping = false;
    clearInterval(this.tick);
    this.el.classList.remove('open');
  }

  private playersSignature(): string {
    return JSON.stringify(this.players.map((p) => { const e = ha.entities[p.entity]; return e ? [e.state, e.attributes] : null; }));
  }

  private get player(): Player | undefined {
    return this.players[this.active];
  }

  // ---------- Home Assistant ----------

  private browse(entity: string, id?: string, type?: string): Promise<BrowseNode> {
    const conn = ha.connection;

    if (!conn) return Promise.reject(new Error('Not connected'));

    return conn.sendMessagePromise<BrowseNode>({
      type: 'media_player/browse_media',
      entity_id: entity,
      ...(id ? { media_content_id: id, media_content_type: type ?? '' } : {}),
    });
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

    this.cat = Math.min(this.cat, Math.max(0, this.cats.length - 1));
    this.renderCats();
  }

  /** Opens a folder in the browser (a category, an artist, an album…). */
  private async openFolder(item: LibraryItem): Promise<void> {
    const p = this.player;

    if (!p) return;
    const level: Level = { title: item.title, id: item.id, type: item.type, items: null, msg: 'Loading…', focus: 0 };
    this.levels.push(level);
    this.area = 'browse';
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

    if (this.levels.at(-1) === level) this.renderBrowse();
  }

  private closeFolder(): void {
    this.levels.pop();

    if (!this.levels.length) this.area = 'cats';
    this.render();
  }

  private act(service: string, data: ServiceData = {}): void {
    const p = this.player;

    if (p) void ha.call('media_player', service, { entity_id: p.entity, ...data });
  }

  /** One speaker's volume (0–1), or the one just set until HA catches up. */
  private volumeOf(entity: string): number | undefined {
    const held = this.heldVolume.get(entity);

    if (held && held.until > Date.now()) return held.value;
    const v = ha.entities[entity]?.attributes.volume_level;

    return typeof v === 'number' ? v : undefined;
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
  private group(): Set<string> {
    const p = this.player;

    if (!p) return new Set();
    const members = ha.entities[p.entity]?.attributes.group_members;
    const set = new Set<string>([p.entity, ...(Array.isArray(members) ? members.filter((m): m is string => typeof m === 'string') : [])]);

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
    this.area = 'speakers';
    this.spk = this.active === 0 ? 1 : 0;
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
    this.queueTitle = String(ha.entities[p.entity]?.attributes.media_title ?? '');
    this.queueMsg = this.queue ? '' : 'Loading…';
    this.renderQueue();

    try {
      const reply = await conn.sendMessagePromise<{ response?: Record<string, QueueInfo> }>({
        type: 'call_service', domain: 'music_assistant', service: 'get_queue',
        target: { entity_id: p.entity }, return_response: true,
      });
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
  private async loadFullQueue(p: Player, q: QueueInfo): Promise<void> {
    const start = (q.current_index ?? -1) + 1;

    try {
      let id = q.queue_id ?? '';

      // Older Home Assistant doesn't say which queue it is: find it by the speaker's name.
      if (!id) {
        const name = String(ha.entities[p.entity]?.attributes.friendly_name ?? p.name).toLowerCase();
        const all = await ma.queues();
        id = (all.find((x) => x.display_name?.toLowerCase() === name) ?? all.find((x) => x.display_name?.toLowerCase() === p.name.toLowerCase()))?.queue_id ?? '';
      }

      if (!id) return;
      const items = await ma.items(id, start, QUEUE_PAGE);

      if (this.queueFor !== p.entity) return;
      this.maQueueId = id;
      this.maStart = start;
      this.maItems = items;
      this.qFocus = Math.min(this.qFocus, Math.max(0, items.length - 1));
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

    try {
      const more = await ma.items(this.maQueueId, this.maStart + this.maItems.length, QUEUE_PAGE);
      this.maItems = [...this.maItems, ...more];
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
      this.qFocus = 0;
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
        const on = this.player ? ha.entities[this.player.entity]?.attributes.shuffle === true : false;
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
    grid.querySelector('.mcard.focus')?.classList.add('started');
  }

  // ---------- drawing ----------

  private render(): void {
    if (!this.open) return;
    const p = this.player;
    const s = p ? ha.entities[p.entity] : undefined;
    const a = s?.attributes ?? {};
    const pic = typeof a.entity_picture === 'string' ? haPath(a.entity_picture) : '';
    if (pic !== this.artUrl) {
      this.artUrl = pic;
      child(this.el, '.music-art').innerHTML = pic ? `<img src="${esc(pic)}" alt="">` : `<div class="music-art-empty">${ICON.note}</div>`;
      child(this.el, '.music-bg').style.backgroundImage = pic ? `url("${pic.replace(/"/g, '%22')}")` : 'none';
    }
    const title = typeof a.media_title === 'string' ? a.media_title : '';
    child(this.el, '.music-title').textContent = title || (s ? (s.state === 'unavailable' ? 'Unavailable' : 'Nothing playing') : 'No speakers');
    child(this.el, '.music-artist').textContent = [a.media_artist, a.media_album_name].filter((x) => typeof x === 'string' && x).join(' · ') || (p?.name ?? '');

    const group = this.group();
    const others = this.players.filter((pl) => pl.entity !== p?.entity && group.has(pl.entity)).map((pl) => pl.name);
    child(this.el, '.music-group').innerHTML = others.length ? `${ICON.group}<span>Also on ${esc(others.join(', '))}</span>` : '';
    child(this.el, '.music-spk-h').textContent = this.grouping ? `Play on ${p?.name ?? ''} and…` : 'Speakers';
    child(this.el, '.music-note').textContent = this.grouping
      ? 'OK on a speaker to add or take it out · Done or Back when finished'
      : 'OK on the chosen speaker to change its volume · OK on another to play different music in that room';
    this.el.classList.toggle('grouping', this.grouping);
    this.el.classList.toggle('sliding', this.slider);

    const focused = this.area === 'controls' ? CONTROL_ROWS[this.ctrlRow][this.ctrl] : null;
    this.el.querySelectorAll<HTMLElement>('.mbtn').forEach((b) => {
      const c = b.dataset.c as Control;
      b.innerHTML = c === 'playpause' ? (s?.state === 'playing' ? ICON.pause : ICON.play) : ICON[c];
      b.classList.toggle('big', c === 'playpause');
      b.classList.toggle('on', (c === 'shuffle' && a.shuffle === true) || (c === 'queue' && this.queueOpen) );
      b.classList.toggle('focus', c === focused);
    });
    child(this.el, '.music-gear').classList.toggle('focus', this.area === 'gear');
    const vol = this.volume();
    child(this.el, '.music-vol').textContent = vol === undefined ? '' : `${Math.round(vol * 100)}%`;
    child(this.el, '.music-volbar i').style.width = `${Math.round((vol ?? 0) * 100)}%`;

    const at = (i: number) => (this.area === 'speakers' && this.spk === i ? ' focus' : '');
    const groupTile = this.players.length < 2 ? '' : this.grouping
      ? `<div class="mspk top${at(-1)}"><span class="mspk-ico">${ICON.check}</span><div class="mspk-text"><div class="mspk-name"><span>Done grouping</span></div><div class="mspk-status"><span>${others.length ? `${others.length + 1} speakers together` : 'Just one speaker'}</span></div></div></div>`
        + `<div class="mspk top${at(EVERYWHERE)}"><span class="mspk-ico">${ICON.everywhere}</span><div class="mspk-text"><div class="mspk-name"><span>${this.allGrouped() ? 'Just this speaker' : 'Play everywhere'}</span></div><div class="mspk-status"><span>${this.allGrouped() ? 'Take the others out' : 'Every speaker plays along'}</span></div></div></div>`
      : `<div class="mspk wide${this.area === 'speakers' && this.spk === -1 ? ' focus' : ''}"><span class="mspk-ico">${ICON.group}</span><div class="mspk-text"><div class="mspk-name"><span>Group speakers</span></div><div class="mspk-status"><span>${others.length ? `${esc(p?.name ?? '')} with ${esc(others.join(', '))}` : `Play what ${esc(p?.name ?? 'this speaker')} is playing in more rooms`}</span></div></div></div>`;
    child(this.el, '.music-speakers').innerHTML = groupTile + this.players
      .map((pl, i) => {
        const e = ha.entities[pl.entity];
        const t = e?.attributes.media_title;
        const inGroup = i !== this.active && group.has(pl.entity);
        const status = !e || e.state === 'unavailable' ? 'Unavailable'
          : inGroup ? `With ${p?.name ?? ''}`
          : this.grouping && i === this.active ? 'Chosen speaker · OK when done'
          : e.state === 'playing' ? `Playing · ${typeof t === 'string' ? t : ''}` : e.state === 'paused' ? 'Paused' : 'Idle';
        const cls = ['mspk', i === this.active ? 'active' : '', inGroup ? 'grouped' : '', e?.state === 'playing' ? 'playing' : '', this.area === 'speakers' && this.spk === i ? 'focus' : ''].join(' ');
        if (this.slider && this.area === 'speakers' && this.spk === i) {
          const v = this.volumeOf(pl.entity) ?? 0;

          return `<div class="${cls} sliding"><span class="mspk-ico">${ICON.volUp}</span><div class="mspk-text"><div class="mspk-name"><span>${esc(pl.name)}</span></div>`
            + `<div class="mspk-slider"><div class="mspk-bar"><i style="width:${Math.round(v * 100)}%"></i></div><span class="mspk-pct">${Math.round(v * 100)}%</span></div></div></div>`;
        }
        const mark = this.grouping ? `<span class="mspk-check${i === this.active || inGroup ? ' on' : ''}">${i === this.active || inGroup ? ICON.check : ''}</span>` : '<span class="mspk-dot"></span>';

        return `<div class="${cls}">${mark}<div class="mspk-text"><div class="mspk-name"><span>${esc(pl.name)}</span></div><div class="mspk-status"><span>${esc(status)}</span></div></div></div>`;
      })
      .join('');
    this.marquee();

    this.renderProgress();
    this.renderCats();
    this.renderBrowse();
    this.renderQueue();
  }

  /** Speaker cards keep their size; a name or status too long for the focused card scrolls. */
  private marquee(): void {
    this.el.querySelectorAll<HTMLElement>('.mspk.focus .mspk-name, .mspk.focus .mspk-status').forEach((box) => {
      const span = box.firstElementChild as HTMLElement | null;
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
    const row = (label: string, it: QueueItem | null | undefined) => {
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

        return `<div class="mql${this.area === 'queue' && this.qFocus === i ? ' focus' : ''}">`
          + `<div class="mql-art">${img ? `<img loading="lazy" src="${esc(img)}" alt="" onerror="this.remove()">` : ''}${ICON.note}</div>`
          + `<div class="mql-text"><div class="mql-name">${esc(m?.name ?? it.name ?? '')}</div><div class="mql-sub">${esc(artists)}</div></div>`
          + `<div class="mq-time">${it.duration ? mmss(it.duration) : ''}</div></div>`;
      }).join('');
      box.innerHTML = `<div class="music-h">Queue · ${esc(this.player?.name ?? '')}</div>`
        + row('Now playing', q.current_item)
        + `<div class="mq-h">Up next${facts ? ` · ${esc(facts)}` : ''}</div>`
        + `<div class="mq-list">${list}</div>`;
      box.querySelector<HTMLElement>('.mql.focus')?.scrollIntoView({ block: 'nearest' });

      return;
    }

    box.innerHTML = `<div class="music-h">Queue · ${esc(this.player?.name ?? '')}</div>`
      + (q ? row('Now playing', q.current_item) + (q.next_item ? row('Up next', q.next_item) : '<div class="mq-h">Up next</div><div class="music-lib-msg">Nothing after this one</div>')
        + (facts ? `<div class="mq-facts">${esc(facts)}</div>` : '')
        + (maConfigured() ? '' : '<div class="mq-facts mq-tip">To see the whole queue, connect Music Assistant: the gear at the bottom right.</div>')
        : `<div class="music-lib-msg">${esc(this.queueMsg)}</div>`);
  }

  private renderCats(): void {
    const box = child(this.el, '.music-cats');

    if (!this.cats.length) {
      box.innerHTML = `<div class="music-lib-msg">${esc(this.catsMsg)}</div>`;

      return;
    }

    box.innerHTML = this.cats
      .map((c, i) => `<div class="mcat${this.area === 'cats' && this.cat === i ? ' focus' : ''}">${folderIcon(c.title)}<span>${esc(norm(c.title) === 'radio' ? 'Radio' : c.title)}</span></div>`)
      .join('');
  }

  /** The browser's grid is drawn once per folder; moving the remote only moves the focus. */
  private drawnLevel: Level | null = null;

  private renderBrowse(): void {
    const level = this.levels.at(-1);
    this.el.classList.toggle('browsing', !!level);
    child(this.el, '.music-hint').textContent = level ? 'Back to go back' : this.slider ? '← → volume · OK when done' : this.grouping ? 'Back when done' : this.queueOpen ? 'Back to close the queue' : 'Back to close';

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
          .map((it) => `<div class="mcard${it.playAll ? ' playall' : ''}">
              <div class="mcard-art">${it.playAll ? ICON.playAll : it.thumb ? `<img loading="lazy" src="${esc(it.thumb)}" alt="">` : it.canExpand ? folderIcon(this.levels[0]?.title ?? '') : ICON.note}</div>
              <div class="mcard-name">${esc(it.title)}</div></div>`)
          .join('');
    }

    const cards = grid.children;
    grid.querySelector('.mcard.focus')?.classList.remove('focus');
    const focused = this.area === 'browse' ? cards[level.focus] : undefined;

    if (focused?.classList.contains('mcard')) {
      focused.classList.add('focus');
      focused.scrollIntoView({ block: 'nearest' });
    }
  }

  /** The progress bar moves on its own between HA updates while playing. */
  private renderProgress(): void {
    const s = this.player ? ha.entities[this.player.entity] : undefined;
    const a = s?.attributes ?? {};
    const dur = typeof a.media_duration === 'number' ? a.media_duration : 0;
    let pos = typeof a.media_position === 'number' ? a.media_position : 0;

    if (s?.state === 'playing' && typeof a.media_position_updated_at === 'string') {
      pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
    }

    pos = Math.min(Math.max(0, pos), dur || pos);
    child(this.el, '.music-progress i').style.width = dur ? `${(pos / dur) * 100}%` : '0';
    child(this.el, '.t-pos').textContent = dur ? mmss(pos) : '';
    child(this.el, '.t-dur').textContent = dur ? mmss(dur) : '';
  }

  // ---------- remote ----------

  handleKey(e: KeyboardEvent): void {
    const k = e.key;

    if (k === 'Escape' || k === 'Backspace') {
      e.preventDefault();

      if (this.levels.length) {
        this.closeFolder();

        return;
      }

      if (this.slider) {
        this.slider = false;
        this.render();

        return;
      }

      if (this.grouping) {
        this.grouping = false;
        this.render();

        return;
      }

      if (this.queueOpen) {
        this.queueOpen = false;
        if (this.area === 'queue') this.area = 'controls';
        this.render();

        return;
      }

      this.close();

      return;
    }

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(k)) return;
    e.preventDefault();
    const spkCount = this.players.length;

    if (this.slider) {
      const pl = this.players[this.spk];

      if ((k === 'ArrowLeft' || k === 'ArrowRight') && pl) this.stepVolume(pl.entity, k === 'ArrowRight');
      else this.slider = false;
      this.render();

      return;
    }

    if (k === 'Enter' || k === ' ') {
      if (this.area === 'controls') this.press(CONTROL_ROWS[this.ctrlRow][this.ctrl]);
      else if (this.area === 'gear') {
        showMaSetup(() => {
          // Connected just now: fetch the whole queue if it's showing.
          if (this.queueOpen) void this.loadQueue();
          this.render();
        });
      } else if (this.area === 'queue') {
        const it = this.maItems[this.qFocus];

        if (it && this.maQueueId) {
          void ma.playIndex(this.maQueueId, it.queue_item_id).catch((err) => console.warn('Music Assistant play', err));
          // The list starts after the new song once Home Assistant reports it.
          this.qFocus = 0;
          this.area = 'controls';
        }
      }
      else if (this.area === 'speakers' && this.spk === -1) {
        if (this.grouping) this.grouping = false;
        else this.startGrouping();
      } else if (this.area === 'speakers' && this.grouping) {
        const pl = this.players[this.spk];

        if (this.spk === EVERYWHERE) this.everywhere();
        else if (this.spk === this.active) this.grouping = false;
        else if (pl) this.toggleGroup(pl.entity);
      } else if (this.area === 'speakers') {
        const pl = this.players[this.spk];

        // OK on the chosen speaker (or one playing along with it) opens its volume slider;
        // OK on any other speaker chooses it, to play something else there.
        if (pl && (this.spk === this.active || this.group().has(pl.entity))) {
          this.slider = ha.entities[pl.entity]?.state !== 'unavailable' && this.volumeOf(pl.entity) !== undefined;
        } else {
          this.active = this.spk;
          void this.loadCats();
        }
      } else if (this.area === 'cats') {
        const c = this.cats[this.cat];

        if (c) void this.openFolder(c);
      } else {
        const level = this.levels.at(-1);
        const it = level?.items?.[level.focus];

        if (it?.canExpand && !it.playAll) void this.openFolder(it);
        else if (it?.canPlay) this.playItem(it);

        return;
      }
      this.render();

      return;
    }

    // What's on the right: the browser, the queue (nothing to focus), or speakers and library.
    const right = (): Area | null => (this.levels.length ? 'browse' : this.queueOpen ? (this.maItems.length ? 'queue' : null) : 'speakers');

    if (this.area === 'controls') {
      const row = CONTROL_ROWS[this.ctrlRow];

      if (k === 'ArrowLeft') this.ctrl = Math.max(0, this.ctrl - 1);
      if (k === 'ArrowRight') {
        if (this.ctrl < row.length - 1) this.ctrl++;
        else if (right()) this.area = right()!;
      }
      if (k === 'ArrowDown') {
        if (this.ctrlRow === 0) {
          this.ctrlRow = 1;
          this.ctrl = this.ctrl <= 2 ? 0 : 1;
        } else this.area = 'gear';
      }
      if (k === 'ArrowUp') {
        if (this.ctrlRow === 1) {
          this.ctrlRow = 0;
          this.ctrl = this.ctrl === 0 ? 1 : 3;
        } else if (right() === 'browse') this.area = 'browse';
        else if (right() === 'queue') this.area = 'queue';
        else if (right() === 'speakers') {
          // Up from the controls goes to the library (or the speakers if there's no library).
          if (this.cats.length && !this.grouping) {
            this.area = 'cats';
            this.cat = Math.floor((this.cats.length - 1) / CAT_COLS) * CAT_COLS;
          } else {
            this.area = 'speakers';
            this.spk = Math.max(0, spkCount - 1);
          }
        }
      }
    } else if (this.area === 'gear') {
      if (k === 'ArrowUp' || k === 'ArrowLeft') this.area = 'controls';
    } else if (this.area === 'queue') {
      if (k === 'ArrowLeft') this.area = 'controls';
      if (k === 'ArrowUp') this.qFocus = Math.max(0, this.qFocus - 1);
      if (k === 'ArrowDown') this.qFocus = Math.min(this.maItems.length - 1, this.qFocus + 1);
      if (this.qFocus > this.maItems.length - 10) void this.moreQueue();
    } else if (this.area === 'speakers') {
      // Two columns of speakers, under the Group tile (-1; while grouping, Done at -1 and
      // Play everywhere at EVERYWHERE side by side).
      if (k === 'ArrowUp' && this.spk >= 0) {
        if (this.spk >= 2) this.spk -= 2;
        else if (this.players.length > 1) this.spk = this.grouping && this.spk === 1 ? EVERYWHERE : -1;
      }
      if (k === 'ArrowDown') {
        if (this.spk === -1) this.spk = 0;
        else if (this.spk === EVERYWHERE) this.spk = Math.min(1, spkCount - 1);
        else if (this.spk + 2 < spkCount) this.spk += 2;
        else if (this.spk % 2 === 0 && this.spk + 1 < spkCount && Math.floor(this.spk / 2) < Math.floor((spkCount - 1) / 2)) this.spk = spkCount - 1;
        else if (this.cats.length && !this.grouping) {
          this.area = 'cats';
          this.cat = this.spk % 2 === 0 ? 0 : Math.min(CAT_COLS - 1, this.cats.length - 1);
        }
      }
      if (k === 'ArrowRight') {
        if (this.spk === -1 && this.grouping) this.spk = EVERYWHERE;
        else if (this.spk >= 0 && this.spk % 2 === 0 && this.spk + 1 < spkCount) this.spk++;
      }
      if (k === 'ArrowLeft') {
        if (this.spk === EVERYWHERE) this.spk = -1;
        else if (this.spk >= 0 && this.spk % 2 === 1) this.spk--;
        else {
          // Left out of the speakers goes to the controls; while grouping, that also finishes it.
          this.grouping = false;
          this.area = 'controls';
        }
      }
    } else if (this.area === 'cats') {
      // A grid of library buttons, CAT_COLS across.
      const col = this.cat % CAT_COLS;

      if (k === 'ArrowRight' && col < CAT_COLS - 1 && this.cat + 1 < this.cats.length) this.cat++;
      if (k === 'ArrowLeft') {
        if (col > 0) this.cat--;
        else this.area = 'controls';
      }
      if (k === 'ArrowDown') {
        if (this.cat + CAT_COLS < this.cats.length) this.cat += CAT_COLS;
        else if (Math.floor(this.cat / CAT_COLS) < Math.floor((this.cats.length - 1) / CAT_COLS)) this.cat = this.cats.length - 1;
        else {
          this.area = 'controls';
          this.ctrlRow = 0;
        }
      }
      if (k === 'ArrowUp') {
        if (this.cat >= CAT_COLS) this.cat -= CAT_COLS;
        else {
          this.area = 'speakers';
          const lastRow = this.players.length - (this.players.length % 2 === 0 ? 2 : 1);
          this.spk = Math.min(this.players.length - 1, lastRow + (col >= CAT_COLS / 2 ? 1 : 0));
        }
      }
    } else {
      // The browser: a grid that scrolls up and down.
      const level = this.levels.at(-1);
      const n = level?.items?.length ?? 0;

      if (level && n) {
        const col = level.focus % GRID_COLS;

        if (k === 'ArrowRight' && col < GRID_COLS - 1 && level.focus + 1 < n) level.focus++;
        if (k === 'ArrowLeft') {
          if (col > 0) level.focus--;
          else this.area = 'controls';
        }
        if (k === 'ArrowDown') level.focus = Math.min(n - 1, level.focus + GRID_COLS);
        if (k === 'ArrowUp' && level.focus >= GRID_COLS) level.focus -= GRID_COLS;
      } else if (k === 'ArrowLeft') this.area = 'controls';
    }

    this.render();
  }
}

const toItem = (c: BrowseNode): LibraryItem => ({
  title: c.title ?? '',
  id: c.media_content_id ?? '',
  type: c.media_content_type ?? 'music',
  thumb: c.thumbnail ? haPath(c.thumbnail) : '',
  canPlay: !!c.can_play,
  canExpand: !!c.can_expand,
});

/** Folder names compared without case, and "Radio stations" as "Radio". */
const norm = (t: string) => t.trim().toLowerCase().replace(/^radio stations?$/, 'radio');
