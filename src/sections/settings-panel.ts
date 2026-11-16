import { native } from '../native';
import { ha, lastSignedOut } from '../ha';
import { settings } from '../config';
import { zones } from '../home-data';
import { showSetup } from '../setup';
import { showMaSetup } from '../ma-setup';
import { ma, maSettings } from '../music-assistant';
import { child } from '../dom';
import { apps, hasDockOrder, resetDockOrder } from '../apps';
import {
  glass, glassSource, hasOverrides, resetToConfig, setGlass, setShowFps,
  setTransitions, setVideos, showFps, transitions, transitionsSource, videosOn, videosSource,
} from '../look';

// Line icons, matching the room panels' style.
const line = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const ICONS = {
  google: line('<path d="M4 11l8-6 8 6"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>'),
  tv: line('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  wallpaper: line('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/>'),
  close: line('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: line('<path d="M15 5l-7 7 7 7"/>'),
  chevron: line('<path d="M9 5l7 7-7 7"/>'),
  ha: line('<path d="M3 11l9-7 9 7"/><path d="M5 9.5V20h14V9.5"/><circle cx="12" cy="14" r="2"/><path d="M12 16v4"/>'),
  link: line('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'),
  music: line('<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  file: line('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  gauge: line('<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/><circle cx="12" cy="16" r="1.2"/>'),
  video: line('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>'),
  glass: line('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 15l7-7M12 16l4-4"/>'),
  fade: line('<rect x="3" y="6" width="11" height="12" rx="2"/><path d="M17 8v8M20 10v4"/>'),
  counter: line('<path d="M4 18h16M6 15l3-4 3 2 5-6"/>'),
  arrange: line('<rect x="3" y="8" width="5" height="8" rx="1.5"/><rect x="10" y="8" width="5" height="8" rx="1.5"/><path d="M18 12h4M20 10l2 2-2 2"/>'),
  reset: line('<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>'),
};

/** The background choices, owned by the app. */
export interface BackgroundControls {
  mode(): 'photo' | 'video';
  /** Name of the current photo or clip. */
  name(): string;
  openPicker(): void;
}

interface Row {
  icon: string;
  name: string;
  status: () => string;
  /** What OK does. Rows with a sub-menu open it instead. */
  run?: () => void;
  /** A list of its own, opened in place of this one; Back returns. */
  menu?: Menu;
}

interface Menu {
  title: string;
  rows: Row[];
}

const onOff = (on: boolean) => (on ? 'On' : 'Off');

/**
 * Calm TV's own settings, opened from the gear tile at the end of the app dock.
 * Reuses the room panel's look (.detail, .drow), as a single narrower column. Rows can open a
 * sub-menu (Performance, Home Assistant) in place of the list; Back returns to the list above.
 */
export class SettingsPanel {
  private readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly closeEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly root: Menu;
  /** The open menus, top level first; each remembers its focused row. */
  private stack: { menu: Menu; focus: number }[] = [];
  private rowEls: HTMLElement[] = [];
  private open = false;
  private confirmSignOut = false;
  private confirmTimer = 0;
  /** OK presses right after opening belong to the press that opened the panel. */
  private openedAt = 0;

  constructor(mount: HTMLElement, private bg: BackgroundControls, private arrangeDock: () => void) {
    const onTv = !!native;

    const connection = (): string =>
      ha.status === 'signed-out' ? 'Not signed in'
      : ha.status === 'connecting' ? 'Connecting…'
      : ha.status === 'offline' ? 'Can’t reach Home Assistant'
      : `Connected${ha.userName ? ` as ${ha.userName}` : ''}`;

    const performance: Menu = {
      title: 'Performance',
      rows: [
        {
          icon: ICONS.video,
          name: 'Video backgrounds',
          status: () => `${onOff(videosOn())} · ${videosSource()}`,
          run: () => setVideos(!videosOn()),
        },
        {
          icon: ICONS.glass,
          name: 'Frosted glass',
          status: () =>
            `${glass() === 'blur' ? 'On' : 'Off (tinted)'} · ${glassSource()}${videosOn() ? '' : ' · free over photos'}`,
          run: () => setGlass(glass() === 'blur' ? 'tint' : 'blur'),
        },
        {
          icon: ICONS.fade,
          name: 'Screen transitions',
          status: () => `${transitions() === 'fade' ? 'Fade' : 'Instant'} · ${transitionsSource()}`,
          run: () => setTransitions(transitions() === 'fade' ? 'instant' : 'fade'),
        },
        {
          icon: ICONS.counter,
          name: 'Show frame rate',
          status: () => `${onOff(showFps())} · a counter in the top-right corner`,
          run: () => setShowFps(!showFps()),
        },
        {
          icon: ICONS.reset,
          name: 'Reset to calm-tv.json',
          status: () => (hasOverrides() ? 'Undo this TV’s changes above' : 'Nothing changed on this TV'),
          run: () => resetToConfig(),
        },
      ],
    };

    const homeAssistant: Menu = {
      title: 'Home Assistant',
      rows: [
        {
          icon: ICONS.ha,
          name: 'Connection',
          status: () =>
            ha.status === 'signed-out' ? `Not signed in${lastSignedOut() ? ` (${lastSignedOut()})` : ''} · OK to sign in`
            : this.confirmSignOut ? 'Press OK again to sign out'
            : connection(),
          run: () => {
            if (ha.status === 'signed-out') {
              this.close();
              ha.signIn();

              return;
            }

            // Signing out takes two presses, so a stray OK can't do it.
            if (!this.confirmSignOut) {
              this.confirmSignOut = true;
              clearTimeout(this.confirmTimer);
              this.confirmTimer = window.setTimeout(() => {
                this.confirmSignOut = false;
                this.refresh();
              }, 4000);
            } else {
              this.confirmSignOut = false;
              ha.signOut();
            }
          },
        },
        {
          icon: ICONS.link,
          name: 'Address',
          status: () => `${settings.haUrl || 'Not set'} · OK to change`,
          run: () => {
            this.close();
            showSetup({ canCancel: true });
          },
        },
        {
          icon: ICONS.file,
          name: 'Home setup (calm-tv.json)',
          status: () => {
            const rooms = `${zones.length} room${zones.length === 1 ? '' : 's'}`;

            if (!settings.source) return `Not found${settings.error ? ` (${settings.error})` : ''} · OK to look again`;
            const from = settings.source === 'last saved copy' ? 'Using the last saved copy' : `From ${settings.source}`;

            return `${from} · ${rooms}${settings.error ? ` · newest copy has a problem: ${settings.error}` : ''} · OK to reload`;
          },
          run: () => location.reload(),
        },
        {
          icon: ICONS.music,
          name: 'Music Assistant',
          status: () => {
            const { url } = maSettings();

            if (!url) return 'Optional · for the Music panel’s full queue · OK to set up';

            return `${url} · ${ma.problem || (ma.connected ? 'Connected' : 'Set up')} · OK to change`;
          },
          run: () => {
            this.close();
            showMaSetup();
          },
        },
      ],
    };

    this.root = {
      title: 'Settings',
      rows: [
        {
          icon: ICONS.wallpaper,
          name: 'Background',
          status: () => `${this.bg.name()} · ${this.bg.mode() === 'video' ? 'video' : 'photo'} · OK to choose`,
          run: () => {
            this.close();
            this.bg.openPicker();
          },
        },
        {
          icon: ICONS.gauge,
          name: 'Performance',
          status: () =>
            `Video ${videosOn() ? 'on' : 'off'} · ${glass() === 'blur' ? 'frosted' : 'tinted'} glass · ${transitions() === 'fade' ? 'fade' : 'instant'}`,
          menu: performance,
        },
        {
          icon: ICONS.arrange,
          name: 'Arrange dock',
          status: () => `${hasDockOrder() ? 'Your order' : 'As in calm-tv.json'} · ${apps.length - 1} tiles · OK to move them`,
          menu: {
            title: 'Arrange dock',
            rows: [
              {
                icon: ICONS.arrange,
                name: 'Move tiles',
                status: () => 'On the dock: OK picks a tile up, ←/→ moves it, OK puts it down, Back when done',
                run: () => {
                  this.close();
                  this.arrangeDock();
                },
              },
              {
                icon: ICONS.reset,
                name: 'Back to the original order',
                status: () => (hasDockOrder() ? 'The order in calm-tv.json · OK to reset' : 'Already in the original order'),
                run: () => {
                  if (!hasDockOrder()) return;
                  resetDockOrder();
                  location.reload();
                },
              },
            ],
          },
        },
        { icon: ICONS.ha, name: 'Home Assistant', status: connection, menu: homeAssistant },
        {
          icon: ICONS.google,
          name: 'Google TV home',
          status: () => (onTv ? 'Switch to Google’s home screen. Open Calm TV from its apps to come back.' : 'Only on the TV'),
          run: () => {
            this.close();
            native?.openGoogleHome();
          },
        },
        {
          icon: ICONS.tv,
          name: 'TV settings',
          status: () => (onTv ? 'Network, display, accounts, and more' : 'Only on the TV'),
          run: () => {
            this.close();
            native?.openSettings();
          },
        },
      ],
    };

    this.el = document.createElement('div');
    this.el.className = 'detail settings';
    this.el.innerHTML = `
      <div class="detail-scrim"></div>
      <div class="detail-panel">
        <div class="detail-head">
          <div class="detail-title"></div>
          <button class="detail-close" aria-label="Close">${ICONS.close}</button>
        </div>
        <div class="dcol-list"></div>
      </div>`;
    mount.appendChild(this.el);
    this.listEl = child(this.el, '.dcol-list');
    this.closeEl = child(this.el, '.detail-close');
    this.titleEl = child(this.el, '.detail-title');
    this.closeEl.addEventListener('click', () => this.close());
    child(this.el, '.detail-scrim').addEventListener('click', () => this.close());
  }

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.stack = [{ menu: this.root, focus: 0 }];
    this.confirmSignOut = false;
    this.openedAt = Date.now();
    this.open = true;
    this.build();
    this.el.classList.add('open');
  }

  close(): void {
    this.open = false;
    this.el.classList.remove('open');
  }

  /** Repaint the status lines (e.g. the Home Assistant connection or a performance choice changed). */
  refresh(): void {
    if (this.open) this.paint();
  }

  private get level(): { menu: Menu; focus: number } {
    return this.stack[this.stack.length - 1];
  }

  /** OK on a row: open its sub-menu, or do what it says. */
  private activate(i: number): void {
    const row = this.level.menu.rows[i];

    if (!row) return;

    if (row.menu) {
      this.stack.push({ menu: row.menu, focus: 0 });
      this.confirmSignOut = false;
      this.build();

      return;
    }

    row.run?.();

    if (this.open) this.paint();
  }

  /** Back: up one menu, or close from the top. */
  private back(): void {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.confirmSignOut = false;
      this.build();
    } else {
      this.close();
    }
  }

  handleKey(e: KeyboardEvent): void {
    const k = e.key;

    if (k === 'Escape' || k === 'Backspace') {
      e.preventDefault();
      this.back();

      return;
    }

    if (k === 'Enter' || k === ' ') {
      e.preventDefault();

      if (e.repeat || Date.now() - this.openedAt < 400) return;

      if (this.level.focus < 0) this.back();
      else this.activate(this.level.focus);

      return;
    }

    if (this.confirmSignOut && k.startsWith('Arrow')) {
      this.confirmSignOut = false;
      this.paint();
    }

    if (k === 'ArrowUp') {
      e.preventDefault();
      this.level.focus = Math.max(-1, this.level.focus - 1);
      this.render();
    }
    else if (k === 'ArrowDown') {
      e.preventDefault();
      this.level.focus = Math.min(this.level.menu.rows.length - 1, this.level.focus + 1);
      this.render();
    }
    else if (k.startsWith('Arrow')) e.preventDefault();
  }

  /** Builds the rows of the current menu. */
  private build(): void {
    const sub = this.stack.length > 1;
    this.titleEl.textContent = this.level.menu.title;
    // In a sub-menu the round button goes back a level; at the top it closes.
    this.closeEl.innerHTML = sub ? ICONS.back : ICONS.close;
    this.closeEl.setAttribute('aria-label', sub ? 'Back' : 'Close');
    this.listEl.textContent = '';
    this.rowEls = this.level.menu.rows.map((r, i) => {
      const row = document.createElement('button');
      row.className = 'drow';
      row.addEventListener('mouseenter', () => {
        this.level.focus = i;
        this.render();
      });
      row.addEventListener('click', () => {
        this.level.focus = i;
        this.activate(i);
      });
      this.listEl.appendChild(row);

      return row;
    });
    this.paint();
  }

  private paint(): void {
    this.level.menu.rows.forEach((r, i) => {
      const more = r.menu ? `<div class="dmore">${ICONS.chevron}</div>` : '';
      this.rowEls[i].innerHTML =
        `<div class="dicon">${r.icon}</div>` +
        `<div class="dmeta"><div class="dname">${r.name}</div><div class="dstatus">${r.status()}</div></div>${more}`;
    });
    this.render();
  }

  private render(): void {
    this.closeEl.classList.toggle('focus', this.level.focus < 0);
    this.rowEls.forEach((el, i) => el.classList.toggle('focus', i === this.level.focus));
  }
}
