import { native } from '../native';
import { ha, lastSignedOut } from '../ha';
import { settings, dashboardMode, MUSIC_BACKGROUNDS, type MusicBackground } from '../config';
import { zones, roomsFrom } from '../home-data';
import { showSetup } from '../setup';
import { showMaSetup } from '../ma-setup';
import { ma, maSettings } from '../music-assistant';
import { child } from '../dom';
import { FocusGroup } from '../focus';
import { hint } from '../hints';
import { isHeld } from '../keys';
import { copyFileToHa, removeStoredConfig, storedInfo } from '../config-store';
import { apps, dockChoices, hasDockChoice, hasDockOrder, resetDockOrder, toggleDockApp } from '../apps';
import {
  glass, glassSource, hasOverrides, resetToConfig, setGlass, setShowFps,
  setTransitions, setVideos, showFps, transitions, transitionsSource, videosOn, videosSource,
  musicBackground, musicBackgroundSource, setMusicBackground, musicWave, musicWaveSource, setMusicWave,
  fadeWhenIdle, fadeSource, setFadeWhenIdle,
} from '../look';

// Line icons, matching the room panels' style.
const line = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const ICONS = {
  home: line('<path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z"/>'),
  google: line('<path d="M4 11l8-6 8 6"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>'),
  tv: line('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  wallpaper: line('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/>'),
  close: line('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: line('<path d="M15 5l-7 7 7 7"/>'),
  chevron: line('<path d="M9 5l7 7-7 7"/>'),
  ha: line('<path d="M3 11l9-7 9 7"/><path d="M5 9.5V20h14V9.5"/><circle cx="12" cy="14" r="2"/><path d="M12 16v4"/>'),
  link: line('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'),
  rest: line('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  wave: line('<path d="M2 12c2.5-4 4.5-4 7 0s4.5 4 7 0 4.5-4 6 0"/>'),
  music: line('<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  file: line('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  video: line('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>'),
  glass: line('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 15l7-7M12 16l4-4"/>'),
  counter: line('<path d="M4 18h16M6 15l3-4 3 2 5-6"/>'),
  arrange: line('<rect x="3" y="8" width="5" height="8" rx="1.5"/><rect x="10" y="8" width="5" height="8" rx="1.5"/><path d="M18 12h4M20 10l2 2-2 2"/>'),
  apps: line('<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><path d="M17 14v6M14 17h6"/>'),
  edit: line('<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
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
  /** Rows made when the menu opens (e.g. the TV's installed apps). */
  fill?: () => Row[];
}

const onOff = (on: boolean) => (on ? 'On' : 'Off');

/** The Music screen's backgrounds, as Settings names them. */
const MUSIC_BACKGROUND_NAMES: Record<MusicBackground, string> = {
  glow: 'Glow around the cover', wash: 'Washed in its colour', solid: 'Solid colour', none: 'None',
};

/**
 * Calm TV's own settings, opened from the gear tile at the end of the app dock.
 * Reuses the room panel's look (.detail, .drow), as a single narrower column. Rows can open a
 * sub-menu (Appearance, Home Assistant) in place of the list; Back returns to the list above.
 */
export class SettingsPanel {
  private readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly closeEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly root: Menu;
  /** The open menus, top level first; each remembers its focused row. */
  private stack: { menu: Menu; focus: number }[] = [];
  private rowEls: HTMLElement[] = [];
  private open = false;
  private confirmSignOut = false;
  /** When the first sign-out press came: the second must come a moment later, not straight after. */
  private confirmAt = 0;
  private confirmTimer = 0;
  /** OK presses right after opening belong to the press that opened the panel. */
  private openedAt = 0;
  /** Remote, touch and mouse (see focus.ts): the rows, and the round button ("close"). */
  private nav!: FocusGroup;

  constructor(
    mount: HTMLElement,
    private bg: BackgroundControls,
    private arrangeDock: () => void,
    /** Choose apps changed the dock: the Apps screen builds its tiles again. */
    private dockChanged: () => void,
  ) {
    const onTv = !!native;

    const connection = (): string =>
      ha.status === 'signed-out' ? 'Not signed in'
      : ha.status === 'connecting' ? 'Connecting…'
      : ha.status === 'offline' ? 'Can’t reach Home Assistant'
      : `Connected${ha.userName ? ` as ${ha.userName}` : ''}`;

    // Everything about how Calm TV looks, in one place: the background, the Music screen's, and the
    // choices that trade looks for smoothness on slower TVs.
    const appearance: Menu = {
      title: 'Appearance',
      rows: [
        {
          icon: ICONS.wallpaper,
          name: 'Background',
          status: () => `${this.bg.name()} · ${this.bg.mode() === 'video' ? 'video' : 'photo'}${hint('chooseBackgroundRow')}`,
          run: () => {
            this.close();
            this.bg.openPicker();
          },
        },
        {
          icon: ICONS.music,
          name: 'Music background',
          status: () => `${MUSIC_BACKGROUND_NAMES[musicBackground()]} · ${musicBackgroundSource()}`,
          // OK steps through the choices.
          run: () => setMusicBackground(MUSIC_BACKGROUNDS[(MUSIC_BACKGROUNDS.indexOf(musicBackground()) + 1) % MUSIC_BACKGROUNDS.length]),
        },
        {
          icon: ICONS.wave,
          name: 'Music wave',
          status: () => `${onOff(musicWave())} · under the song, how far it's played · ${musicWaveSource()}`,
          run: () => setMusicWave(!musicWave()),
        },
        {
          icon: ICONS.video,
          name: 'Video backgrounds',
          status: () => `${onOff(videosOn())} · ${videosSource()}`,
          run: () => setVideos(!videosOn()),
        },
        {
          // Frosted glass and screen fades together: the two effects that cost a slower TV the most.
          // calm-tv.json can still set them apart ("display"); then this row says which is on.
          icon: ICONS.glass,
          name: 'Visual effects',
          status: () => {
            const frosted = glass() === 'blur';
            const fades = transitions() === 'fade';
            const how = frosted && fades ? 'On · frosted glass, fading screens'
              : !frosted && !fades ? 'Off · tinted glass, instant screens (lightest)'
              : `Partly on · ${frosted ? 'frosted glass' : 'tinted glass'}, ${fades ? 'fading' : 'instant'} screens`;
            const from = glassSource() === transitionsSource() ? ` · ${glassSource()}` : '';

            return how + from;
          },
          run: () => {
            const on = !(glass() === 'blur' && transitions() === 'fade');
            setGlass(on ? 'blur' : 'tint');
            setTransitions(on ? 'fade' : 'instant');
          },
        },
        {
          icon: ICONS.rest,
          name: 'Fade when idle',
          status: () => `${onOff(fadeWhenIdle())} · after a few seconds, only the clock, weather or album art stay · ${fadeSource()}`,
          run: () => setFadeWhenIdle(!fadeWhenIdle()),
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
          status: () => (hasOverrides() ? 'Undo this TV’s changes above (the background stays)' : 'Nothing changed on this TV'),
          run: () => resetToConfig(),
        },
      ],
    };

    const rooms = () => `${zones.length} room${zones.length === 1 ? '' : 's'}${roomsFrom === 'areas' ? ' from Home Assistant’s areas' : ''}`;
    const setupFrom = (): string => {
      if (settings.stored) return `Kept in Home Assistant · ${rooms()}${storedInfo.problem ? ` · its newest copy has a problem: ${storedInfo.problem}` : ''}`;

      if (!settings.source) return `No setup found${settings.error ? ` (${settings.error})` : ''} · ${rooms()}`;
      const from = settings.source === 'last saved copy' ? 'The last saved copy of calm-tv.json' : `calm-tv.json from ${settings.source}`;

      return `${from} · ${rooms()}${settings.error ? ` · its newest copy has a problem: ${settings.error}` : ''}`;
    };
    /** Changing the copy in Home Assistant: one at a time, and what went wrong if it did. */
    let storeBusy = false;
    let storeProblem = '';
    const changeStore = (what: () => Promise<void>) => {
      if (storeBusy || !ha.isAdmin) return;
      storeBusy = true;
      storeProblem = '';
      // Home Assistant then sends the change back, and Calm TV starts again with it (config-store.ts).
      what().catch((e: unknown) => { storeProblem = e instanceof Error ? e.message : 'it didn’t work'; })
        .finally(() => { storeBusy = false; this.refresh(); });
    };
    const adminOnly = () => (ha.status !== 'connected' ? 'Needs Home Assistant connected' : 'Needs a Home Assistant admin: do this from Calm TV’s dashboard, signed in as one');
    const storeStatus = (ready: string) =>
      storeBusy ? 'Saving in Home Assistant…' : storeProblem ? `Didn’t work: ${storeProblem}` : ha.isAdmin && ha.status === 'connected' ? ready : adminOnly();

    // Removing the copy in Home Assistant takes two presses: without calm-tv.json, it's gone.
    let confirmRemove = 0;
    // Where the home's setup comes from, and keeping it in Home Assistant instead of a public file.
    const setupRows: Row[] = [
        { icon: ICONS.file, name: 'In use', status: () => `${setupFrom()} · OK to load it again`, run: () => location.reload() },
        {
          icon: ICONS.edit,
          name: 'Edit',
          status: () => (ha.isAdmin && ha.status === 'connected'
            ? 'The setup as text, checked as you type; saving keeps it in Home Assistant · OK to open'
            : 'The setup as text · saving needs a Home Assistant admin · OK to open'),
          run: () => {
            this.close();
            void import('../setup-editor').then((m) => m.showSetupEditor());
          },
        },
        {
          icon: ICONS.ha,
          name: 'Keep it in Home Assistant',
          status: () => storeStatus('Copies calm-tv.json into Home Assistant, where only signed-in users can read it · OK to copy'),
          run: () => changeStore(copyFileToHa),
        },
        {
          icon: ICONS.ha,
          name: 'Copy calm-tv.json again',
          status: () => storeStatus('Replaces the copy in Home Assistant with calm-tv.json as it is now · OK to copy'),
          run: () => changeStore(copyFileToHa),
        },
        {
          icon: ICONS.reset,
          name: 'Back to calm-tv.json',
          status: () => storeStatus(Date.now() < confirmRemove
            ? 'OK again to remove it · without calm-tv.json in the www folder, this setup is gone'
            : 'Removes the copy from Home Assistant; calm-tv.json (or your areas) is used again · OK twice to remove'),
          run: () => {
            // A doubled or held OK isn't the second press.
            if (Date.now() < confirmRemove - 3000) return;

            if (Date.now() >= confirmRemove) {
              confirmRemove = Date.now() + 4000;
              window.setTimeout(() => this.refresh(), 4100);

              return;
            }

            confirmRemove = 0;
            changeStore(removeStoredConfig);
          },
        },
    ];
    const homeSetup: Menu = {
      title: 'Home setup',
      rows: [],
      // Only the rows that make sense now.
      fill: () => setupRows.filter((r) => {
        // Editing needs a keyboard: the dashboard or a browser, not the TV.
        if (r.name === 'Edit') return !native;

        if (r.name === 'In use') return true;

        return (r.name === 'Keep it in Home Assistant') !== settings.stored;
      }),
    };

    const homeAssistant: Menu = {
      title: 'Home Assistant',
      rows: [
        {
          icon: ICONS.ha,
          name: 'Connection',
          status: () =>
            ha.status === 'signed-out' ? `Not signed in${lastSignedOut() ? ` (${lastSignedOut()})` : ''} · ${hint('signInRow')}`
            : this.confirmSignOut ? hint('signOutAgain')
            : connection(),
          run: () => {
            if (ha.status === 'signed-out') {
              this.close();
              ha.signIn();

              return;
            }

            // Signing out takes two presses, so a stray OK can't do it.
            // A remote that doubles presses (or a held OK) mustn't sign out: the second press only
            // counts after a short pause.
            if (this.confirmSignOut && Date.now() - this.confirmAt < 1000) return;

            if (!this.confirmSignOut) {
              this.confirmSignOut = true;
              this.confirmAt = Date.now();
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
        { icon: ICONS.file, name: 'Home setup', status: () => setupFrom(), menu: homeSetup },
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
            // When the setup closes, come back here (Settings → Home Assistant → Music Assistant).
            showMaSetup(() => this.reopen(homeAssistant, 'Music Assistant'));
          },
        },
      ],
    };

    // Without "music" in calm-tv.json there's no Music panel, so nothing to connect Music Assistant to.
    if (!settings.config.music) homeAssistant.rows = homeAssistant.rows.filter((r) => r.name !== 'Music Assistant');

    this.root = {
      title: 'Settings',
      rows: [
        {
          icon: ICONS.wallpaper,
          name: 'Appearance',
          status: () =>
            `${this.bg.name()} · ${this.bg.mode() === 'video' ? 'video' : 'photo'} · ${glass() === 'blur' ? 'frosted' : 'tinted'} glass`,
          menu: appearance,
        },
        {
          icon: ICONS.arrange,
          name: 'Arrange dock',
          status: () => `${hasDockOrder() || hasDockChoice() ? 'Your dock' : 'As in calm-tv.json'} · ${apps.length - 1} apps`,
          menu: {
            title: 'Arrange dock',
            rows: [
              {
                icon: ICONS.apps,
                name: 'Choose apps',
                status: () => `${apps.length - 1} on the dock · OK to add or take off apps installed on this TV`,
                menu: {
                  title: 'Choose apps',
                  rows: [],
                  fill: () => dockChoices().map((a) => ({
                    icon: `<span class="dmark">${a.mark}</span>`,
                    name: a.name,
                    status: () => (apps.some((x) => x.pkg === a.pkg) ? 'On the dock · OK to take it off' : 'OK to add it to the dock'),
                    run: () => {
                      toggleDockApp(a.pkg, a.label);
                      this.dockChanged();
                    },
                  })),
                },
              },
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
                name: 'Back to calm-tv.json’s dock',
                status: () => (hasDockOrder() || hasDockChoice() ? 'Its apps, in its order · OK to reset' : 'Already as in calm-tv.json'),
                run: () => {
                  if (!hasDockOrder() && !hasDockChoice()) return;
                  resetDockOrder();
                  location.reload();
                },
              },
            ],
          },
        },
        { icon: ICONS.ha, name: 'Home Assistant', status: connection, menu: homeAssistant },
        {
          icon: ICONS.home,
          name: 'Home button',
          status: () => (native?.homeServiceOn?.()
            ? 'On · Home returns here, and the doorbell, door pop-ups and ★ show over other apps'
            : 'Off · Android turns it off after every update · OK, then Calm TV: Home button → On'),
          run: () => {
            this.close();
            native?.openAccessibilitySettings?.();
          },
        },
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

    // Without "music" in calm-tv.json there's no Music screen to choose a background for.
    if (!settings.config.music) appearance.rows = appearance.rows.filter((r) => !r.name.startsWith('Music '));

    // The dashboard has no dock, Google TV home or TV settings.
    if (dashboardMode) this.root.rows = this.root.rows.filter((r) => !['Arrange dock', 'Home button', 'Google TV home', 'TV settings'].includes(r.name));
    // Only a TV app new enough to say whether the Home button service is on.
    // Choosing apps needs the TV's list of installed apps.
    if (!native) this.walk((m) => { m.rows = m.rows.filter((r) => r.name !== 'Choose apps'); });

    if (!native?.homeServiceOn) this.root.rows = this.root.rows.filter((r) => r.name !== 'Home button');

    this.el = document.createElement('div');
    this.el.className = 'detail settings';
    this.el.innerHTML = `
      <div class="detail-scrim"></div>
      <div class="detail-panel">
        <div class="detail-head">
          <div class="detail-title"></div>
          <div class="detail-hint"></div>
          <button class="detail-close" data-focus="close" aria-label="Close">${ICONS.close}</button>
        </div>
        <div class="dcol-list"></div>
      </div>`;
    mount.appendChild(this.el);
    this.listEl = child(this.el, '.dcol-list');
    this.hintEl = child(this.el, '.detail-hint');
    this.closeEl = child(this.el, '.detail-close');
    this.titleEl = child(this.el, '.detail-title');
    // In a sub-menu the round button shows a back arrow, so it goes back a level, like Back does.
    this.closeEl.addEventListener('click', () => this.back());
    child(this.el, '.detail-scrim').addEventListener('click', () => this.close());

    this.nav = new FocusGroup(this.el, {
      onBack: () => this.back(),
      // Up from the first row goes to the last, and Down from the last to the first (like the dock).
      wrap: true,
      onKey: (e) => {
        // OK right after opening is the end (or a double) of the press that opened the panel or
        // menu. Any other key in between means the next OK is a new press.
        if (e.key === 'Enter' || e.key === ' ') {
          if (isHeld(e) || Date.now() - this.openedAt < 400) {
            e.preventDefault();

            return true;
          }
        } else this.openedAt = 0;

        if (this.confirmSignOut && e.key.startsWith('Arrow')) {
          this.confirmSignOut = false;
          this.paint();
        }

        return false;
      },
      onFocus: (id) => { this.level.focus = id === 'close' ? -1 : Number(id.slice(4)); },
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.stack = [{ menu: this.root, focus: 0 }];
    this.confirmSignOut = false;
    this.openedAt = Date.now();
    this.open = true;
    // Visible first, so the rows can take the focus as they're built.
    this.el.classList.add('open');
    this.build();
  }

  /** Opens Settings on a sub-menu, with the focus on one of its rows (by name). */
  private reopen(menu: Menu, rowName: string): void {
    this.show();
    const i = this.root.rows.findIndex((r) => r.menu === menu);

    if (i < 0) return;
    this.level.focus = i;
    this.stack.push({ menu, focus: Math.max(0, menu.rows.findIndex((r) => r.name === rowName)) });
    this.build();
  }

  close(): void {
    this.open = false;
    this.el.classList.remove('open');
  }

  /** Repaint the status lines (e.g. the Home Assistant connection or a performance choice changed). */
  refresh(): void {
    if (this.open) this.paint();
  }

  /** Every menu, from the top. */
  private walk(fn: (m: Menu) => void, m: Menu = this.root): void {
    fn(m);
    m.rows.forEach((r) => { if (r.menu) this.walk(fn, r.menu); });
  }

  private get level(): { menu: Menu; focus: number } {
    return this.stack[this.stack.length - 1];
  }

  /** OK on a row: open its sub-menu, or do what it says. */
  private activate(i: number): void {
    const row = this.level.menu.rows[i];

    if (!row) return;

    if (row.menu) {
      if (row.menu.fill) row.menu.rows = row.menu.fill();
      this.stack.push({ menu: row.menu, focus: 0 });
      this.confirmSignOut = false;
      // The OK that opened this menu can arrive twice; the second mustn't press its first row.
      this.openedAt = Date.now();
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
    this.nav.handleKey(e);
  }

  /** Builds the rows of the current menu. */
  private build(): void {
    const sub = this.stack.length > 1;
    this.titleEl.textContent = this.level.menu.title;
    // Back goes up a level in a sub-menu, and closes Settings at the top.
    // The remote reads it (the TV); a finger taps the round button instead (the dashboard, see style.css).
    this.hintEl.textContent = sub ? 'Back to go back' : 'Back to close';
    this.closeEl.innerHTML = sub ? ICONS.back : ICONS.close;
    this.closeEl.setAttribute('aria-label', sub ? 'Back' : 'Close');
    this.listEl.textContent = '';
    this.rowEls = this.level.menu.rows.map((r, i) => {
      const row = document.createElement('button');
      row.className = 'drow';
      row.dataset.focus = `row-${i}`;
      row.addEventListener('click', () => this.activate(i));
      this.listEl.appendChild(row);

      return row;
    });
    this.paint();
    this.nav.focus(this.level.focus < 0 ? 'close' : `row-${this.level.focus}`);
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
    this.nav.paint();
  }
}
