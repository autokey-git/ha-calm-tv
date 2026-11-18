import { wallpapers } from './wallpapers';
import { videos } from './videos';
import { fadeWhenIdle, glass, onLookChange, showFps, transitions, videosOn } from './look';
import { fpsCounter } from './fps';
import { isHeld } from './keys';
import { load, save } from './state';
import { AppsSection } from './sections/apps-section';
import { SmartHomeSection } from './sections/smarthome-section';
import { CalendarSection } from './sections/calendar-section';
import { WeatherSection } from './sections/weather-section';
import { ZoneDetail } from './sections/zone-detail';
import { SettingsPanel, type BackgroundControls } from './sections/settings-panel';
import { BackgroundPicker, type BgChoice } from './sections/background-picker';
import type { Section } from './sections/section';
import type { App } from './types';
import { native } from './native';
import { ha, type HaLink } from './ha';
import { attributes, forecastEntries, WeatherAttributes, type ForecastEntry, type ForecastMessage } from './ha-data';
import { child, find, itemAt } from './dom';
import { applyStates, onZonesChange, WEATHER } from './home-data';
import { watchAreaRooms } from './areas';
import { conditionLabel } from './sections/weather-section';
import { MusicPanel } from './sections/music-panel';
import { MusicSection } from './sections/music-section';
import { DoorbellWindow, doorbellEnabled, doorbellLook, doorbellRinging } from './doorbell';
import { watchDoors } from './doors';
import { screenOrder, dashboardMode, type ScreenName } from './config';
import { DashboardBar, DASHBOARD_BAR_H } from './dashboard-bar';
import { hint } from './hints';
import { sky } from './sky';

/** A finger moved at least this far (CSS pixels) counts as a swipe, not a tap. */
const SWIPE_MIN = 60;
/** Seconds without input before the screens rest: their bars fade (Settings → Appearance → Fade when idle). */
const REST_AFTER = 8;
/** Where the app remembers which update it last showed the "Home button is off" note for. */
const SERVICE_NOTE_KEY = 'calmtv.serviceNote';


/** An element of the page's own markup (index.html). */
const qs = (selector: string) => child(document, selector);
const video = () => find(document, '#video', HTMLVideoElement);

export class CalmTv {
  private persist = load();
  private sections: Section[] = [];
  private secIndex = 0;
  private cols: number[] = [];
  private frontA = true;
  private overlay: null | 'launch' = null;
  private launchTimer = 0;
  private hintTimer = 0;
  private restTimer = 0;
  /** The press (a touch, or a click with no mouse move before it) that woke the screens: it only wakes them. */
  private wakingPress = false;
  private readonly reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private track!: HTMLElement;
  private detail!: ZoneDetail;
  private home!: SmartHomeSection;
  private settings!: SettingsPanel;
  private picker!: BackgroundPicker;
  private doorbell!: DoorbellWindow;
  private music!: MusicPanel;
  private appsSection!: AppsSection;
  private hintHtml?: string;
  /** Dashboard mode's tab bar (null on the TV). */
  private bar: DashboardBar | null = null;

  start(): void {
    // The picker offers videos while video backgrounds are on (Settings → Appearance), photos otherwise.
    this.picker = new BackgroundPicker(
      qs('#stage'),
      () =>
        this.bgMode === 'video'
          ? videos.map((v, index) => ({ kind: 'video' as const, index, name: v.name, thumb: v.thumb }))
          : wallpapers.map((w, index) => ({ kind: 'photo' as const, index, name: w.name, thumb: w.url })),
      () => ({ kind: this.bgMode, index: this.bgMode === 'video' ? this.vid : this.wp }),
      (c) => this.chooseBackground(c),
    );

    const bg: BackgroundControls = {
      mode: () => this.bgMode,
      name: () => (this.bgMode === 'video' ? videos[this.vid]?.name ?? '' : wallpapers[this.wp].name),
      openPicker: () => this.picker.show(),
    };

    this.settings = new SettingsPanel(qs('#stage'), bg, () => this.arrangeDock(), () => this.dockChanged());
    // Only the screens calm-tv.json asks for are built (see "screens"), so a hidden one never loads
    // anything. Smart Home is always made, unseen if hidden: the rooms' states, the "Outside" line and
    // the room panels hang off it.
    const order = screenOrder();
    const at = (name: ScreenName) => order.indexOf(name);
    this.music = new MusicPanel(qs('#stage'));

    const appsSection = this.appsSection = new AppsSection(at('apps'), (a) =>
      a.kind === 'settings' ? this.settings.show() : this.openLaunch(a),
    );

    this.detail = new ZoneDetail(qs('#stage'), () => this.home.refresh());
    this.doorbell = new DoorbellWindow(qs('#stage'), hint('doorbellClose'));
    this.doorbell.el.addEventListener('click', () => this.doorbell.hide());
    watchDoors(qs('#stage'));
    this.home = new SmartHomeSection(at('smarthome'), (z) => this.detail.openZone(z), () => ha.signIn());

    // Cards come and go as the calendar loads: keep focus valid while it's on screen. (A `let`, as
    // the calendar already calls back while it's being built.)
    let calendar: CalendarSection | null = null;

    if (order.includes('calendar')) {
      calendar = new CalendarSection(at('calendar'), () => { if (calendar && this.sections[this.secIndex] === calendar) this.render(); });
    }

    const weather = order.includes('weather') ? new WeatherSection(at('weather')) : null;
    const music = order.includes('music') ? new MusicSection(at('music'), this.music) : null;
    const built = { apps: appsSection, smarthome: this.home, calendar, weather, music };
    this.sections = order.flatMap((name) => built[name] ?? []);
    this.connectHomeAssistant(weather);
    this.cols = this.sections.map((s) => s.defaultItem ?? 0);

    this.track = qs('#sectionsTrack');
    this.sections.forEach((s) => this.track.appendChild(s.el));

    if (dashboardMode) {
      document.documentElement.classList.add('dashboard');
      this.bar = new DashboardBar(qs('#frame'), order, {
        // A screen's tab always shows that screen, so it first closes any panel open on top (Music, a room…).
        onScreen: (i) => { this.closePanels(); this.goTo(i); },
        // What's playing opens the Music screen (or, if calm-tv.json leaves it out, the Music panel).
        onMusic: () => {
          this.closePanels();

          if (order.includes('music')) this.goTo(order.indexOf('music'));
          else this.music.show();
        },
        onSettings: () => { this.closePanels(); this.settings.show(); },
      });
    }

    this.wireInput();
    this.stir();
    onLookChange(() => this.stir());
    this.checkHomeService();
    this.paintInitial();
    this.fit();
    window.addEventListener('resize', () => this.fit());
    this.render();
    this.hintTimer = window.setTimeout(() => qs('#hint').classList.add('gone'), 6000);
  }

  // ---------- Home Assistant ----------
  private connectHomeAssistant(weather: WeatherSection | null): void {
    let ringing: boolean | undefined;

    const update = () => {
      // Doorbell: act when "Doorbell ringing" turns on (not if it was already on when we connected).
      // Calm TV's own doorbell window is off unless calm-tv.json turns it on: Google TV
      // already shows its own alert for Nest doorbells.
      const r = ha.entities[doorbellRinging()]?.state === 'on';

      if (doorbellEnabled() && ringing === false && r) this.ring();

      if (ringing && !r) this.doorbell.hide();

      if (ha.status === 'connected' && ha.entities[doorbellRinging()]) ringing = r;
      applyStates(ha.entities);
      const w = ha.entities[WEATHER];
      const temperature = w ? attributes(w, WeatherAttributes).temperature : undefined;
      this.home.setOutside(temperature === undefined || !w ? {} : { temp: temperature, condition: conditionLabel(w.state) });
      weather?.setCurrent(temperature === undefined || !w ? null : { condition: w.state, temperature });
      this.appsSection.setWeather(temperature === undefined || !w ? null : { condition: w.state, temperature });
      this.detail.refresh();
    };

    ha.onEntities(update);

    // Rooms from Home Assistant's Areas (no "rooms" in calm-tv.json) arrive after connecting, and
    // are rebuilt on reconnecting: redraw the rooms, and close a room panel showing an old room.
    watchAreaRooms();
    onZonesChange(() => {
      if (this.detail.isOpen()) this.detail.close();
      applyStates(ha.entities);
      this.home.roomsChanged();
      this.settings.refresh();

      if (this.sections[this.secIndex] === this.home) {
        const sec = this.secIndex;
        this.cols[sec] = Math.min(this.cols[sec], Math.max(0, this.home.count() - 1));
        this.render();
      }
    });
    ha.onStatus(() => {
      this.home.refresh();
      this.settings.refresh();

      // The Smart Home bar swaps between rooms and the sign-in card: keep focus valid.
      if (this.sections[this.secIndex] === this.home) this.render();
    });

    // Forecasts aren't entity states; subscribe once per connection (the library resubscribes after a drop).
    // Not at all without the Weather screen.
    const subscribed = new WeakSet<HaLink>();
    ha.onConnected((conn) => {
      if (!weather || subscribed.has(conn)) return;
      subscribed.add(conn);

      const sub = (forecast_type: 'daily' | 'hourly', fn: (f: ForecastEntry[]) => void) =>
        conn
          .subscribeMessage<ForecastMessage>((m) => fn(forecastEntries(m)), {
            type: 'weather/subscribe_forecast',
            entity_id: WEATHER,
            forecast_type,
          })
          .catch((e) => console.warn('Forecast subscribe failed', forecast_type, e));

      sub('daily', (f) => weather.setDaily(f));
      sub('hourly', (f) => weather.setHourly(f));
    });

    // "Left unlocked" depends on time passing, not just on new states.
    window.setInterval(update, 60000);
    ha.start();
  }

  /** Someone rang: video in Calm TV's corner, or over whatever app is on screen. */
  private ring(): void {
    if (native?.isInFront && !native.isInFront()) {
      const shown = native.showDoorbellWith
        ? native.showDoorbellWith(JSON.stringify(doorbellLook()))
        : native.showDoorbell?.();

      if (shown) return;
    }

    this.doorbell.show();
  }

  // ---------- navigation ----------
  private render(): void {
    // Sections cross-fade (see .section.is-active in style.css).
    this.sections.forEach((s, i) => {
      s.el.classList.toggle('is-active', i === this.secIndex);

      if (i !== this.secIndex) s.blur();
    });
    const s = this.sections[this.secIndex];
    const n = s.count();

    if (n > 0) {
      this.cols[this.secIndex] = Math.max(0, Math.min(this.cols[this.secIndex], n - 1));
      s.focus(this.cols[this.secIndex]);
    }

    this.bar?.setActive(this.secIndex);
  }

  /**
   * ↑/↓ (or a swipe): the screen above or below. The screens wrap round like the rows: ↑ on the
   * first goes to the last, ↓ on the last to the first. Not while the button is held, so holding it
   * stops at the end.
   */
  private moveV(d: number, held = false): void {
    const n = this.sections.length;
    const next = this.secIndex + d;

    this.goTo(!held && (next < 0 || next >= n) ? (next + n) % n : next);
  }

  /** Shows screen i (from ↑/↓, a swipe, or a dashboard tab). */
  private goTo(i: number): void {
    const ni = Math.max(0, Math.min(i, this.sections.length - 1));

    if (ni === this.secIndex) return;
    this.secIndex = ni;
    this.render();
    this.sections[ni].onEnter?.();
    this.hideHint();
  }

  private moveH(d: number, held = false): void {
    const s = this.sections[this.secIndex];
    const n = s.count();

    if (n <= 0) return;
    const next = this.cols[this.secIndex] + d;

    // Every screen's row wraps around (the dock, the rooms, the days, the Music bar…): Left on the
    // first goes to the last, and Right on the last to the first. Not while the button is held, so
    // holding it stops at the end instead of circling.
    if (!held && (next < 0 || next >= n)) this.cols[this.secIndex] = (next + n) % n;
    else this.cols[this.secIndex] = Math.max(0, Math.min(next, n - 1));
    s.focus(this.cols[this.secIndex]);
    this.hideHint();
  }

  private activate(): void {
    const s = this.sections[this.secIndex];

    if (s.count() > 0) s.activate(this.cols[this.secIndex]);
    this.hideHint();
  }

  // ---------- launch overlay ----------
  private openLaunch(a: App): void {
    this.overlay = 'launch';
    qs('#launchMark').innerHTML = a.mark;
    qs('#launchTxt').textContent = `Opening ${a.name}`;
    const bar = qs('#launch .lbar i');
    bar.style.animation = 'none';
    void bar.offsetWidth;
    bar.style.animation = '';
    qs('#launch').classList.add('open');
    clearTimeout(this.launchTimer);
    this.launchTimer = window.setTimeout(() => this.closeLaunch(), this.reduceMotion ? 600 : 1600);

    // On the TV, actually open the app. In a browser the launch stays faked.
    if (native && a.pkg && !native.launch(a.pkg)) {
      qs('#launchTxt').textContent = `${a.name} isn't installed`;
    }
  }
  private closeLaunch(): void {
    qs('#launch').classList.remove('open');
    this.overlay = null;
  }

  // ---------- wallpaper ----------
  private paintInitial(): void {
    sky.mount(qs('#stage'));
    sky.onPhase(() => this.phaseChanged());
    const css = `url("${this.photoUrl(this.wp)}")`;
    qs('#photo').style.backgroundImage = css;
    this.setBarImages(css);
    this.applyLook();
    onLookChange(() => this.applyLook());
  }

  /** Applies Settings → Appearance (or calm-tv.json's defaults): glass, transitions, video, fps. */
  private applyLook(): void {
    const root = document.documentElement;
    root.classList.toggle('glass-tint', glass() === 'tint');
    root.classList.toggle('instant', transitions() === 'instant');
    this.setBackground();
    fpsCounter(showFps());
    this.settings?.refresh();
  }

  // ---------- video background ----------
  private videoUrl = '';
  /** The version of the clip that's playing (see sky.pick). */
  private videoPick = '';
  private get vid(): number {
    const byName = videos.findIndex((v) => v.name === this.persist.vidName);

    if (byName >= 0) return byName;
    const n = this.persist.vid;

    return n >= 0 && n < videos.length ? n : 0;
  }
  /** The background showing now: a video while video backgrounds are on, otherwise a photo. */
  private bgMode: 'photo' | 'video' = 'photo';
  /**
   * Shows a video or a photo, following the video setting. Each kind remembers its own choice, so
   * turning videos off and on again returns to the same clip. The photo stays underneath a video,
   * so it shows while a clip loads.
   */
  private setBackground(): void {
    const mode = videosOn() && videos.length ? 'video' : 'photo';

    if (mode === this.bgMode && (mode === 'photo' || video().getAttribute('src'))) return;
    this.bgMode = mode;
    document.documentElement.classList.toggle('bg-video', mode === 'video');
    const v = video();

    if (mode === 'video') void this.playVideo(this.vid);
    else {
      this.photoUrl(this.wp);
      v.pause();
      v.classList.remove('ready');
      v.removeAttribute('src');
      v.load();

      if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);
      this.videoUrl = '';
    }
  }
  /**
   * Loads the whole clip into memory first, then loops it from there. Seeking and looping straight
   * from the app's built-in files is unreliable in the TV's web view; clips are small enough for this.
   */
  private async playVideo(i: number): Promise<void> {
    const clip = videos[i];
    const v = video();

    if (!clip) return;
    // The version for this time of day, if the clip has them (see sky.ts).
    const pick = sky.pick(clip.name, clip.url, clip.variants);
    this.videoPick = pick.url;
    sky.setScene(clip.name, pick.native, clip.map, !!clip.variants);

    try {
      // Clips on another server (Home Assistant's www folder) can't be read into memory (CORS),
      // so those play straight from their address.
      let src = pick.url;

      if (new URL(pick.url, location.href).origin === location.origin) {
        const blob = await (await fetch(pick.url)).blob();

        if (this.bgMode !== 'video' || this.vid !== i || this.videoPick !== pick.url) return; // changed while loading
        src = URL.createObjectURL(blob);
      }

      if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);
      this.videoUrl = src.startsWith('blob:') ? src : '';
      v.classList.remove('ready');
      v.src = src;
      v.addEventListener('playing', () => v.classList.add('ready'), { once: true });

      if (!document.hidden) await v.play();
    } catch (e) {
      console.warn('Video background failed', clip.name, e);
    }
  }
  /** Only play while Calm TV is on screen. */
  private pauseVideo(paused: boolean): void {
    const v = video();

    if (this.bgMode !== 'video' || !v.src) return;

    if (paused) v.pause();
    else void v.play().catch(() => {});
  }
  private setBarImages(css: string): void {
    document.querySelectorAll<HTMLElement>('.gb-img').forEach((el) => (el.style.backgroundImage = css));
  }
  private get wp(): number {
    const byName = wallpapers.findIndex((w) => w.name === this.persist.wpName);

    if (byName >= 0) return byName;
    const n = this.persist.wp;

    return n >= 0 && n < wallpapers.length ? n : 0;
  }
  /** From the background picker: a clip or a photo. */
  private chooseBackground(c: BgChoice): void {
    if (c.kind === 'video') {
      if (c.index === this.vid) return;
      this.persist.vid = c.index;
      this.persist.vidName = videos[c.index]?.name ?? '';
      save(this.persist);
      void this.playVideo(c.index);
    } else if (c.index !== this.wp) {
      this.showPhoto(c.index);
    }
  }
  /** Photo n's version for this time of day (see sky.pick); also tells the sky which one is showing. */
  private photoUrl(n: number): string {
    const w = wallpapers[n];
    const pick = sky.pick(w.name, w.url, w.variants);
    sky.setScene(w.name, pick.native, w.map, !!w.variants);

    return pick.url;
  }

  /**
   * Morning, day, evening or night has taken over: a background with a version for it changes to that
   * version, slowly. One without versions needs nothing; the sky's colours change by themselves.
   */
  private phaseChanged(): void {
    if (this.bgMode === 'video') {
      const clip = videos[this.vid];

      if (clip?.variants && sky.pick(clip.name, clip.url, clip.variants).url !== this.videoPick) void this.playVideo(this.vid);

      return;
    }

    if (!wallpapers[this.wp].variants) return;
    const slow = '8s';
    ['#photo', '#photo2'].forEach((id) => (qs(id).style.transitionDuration = slow));
    this.showPhoto(this.wp);
    window.setTimeout(() => ['#photo', '#photo2'].forEach((id) => (qs(id).style.transitionDuration = '')), 8500);
  }

  /** Cross-fades to the next wallpaper; returns its name. */
  private nextWallpaper(): string {
    return this.showPhoto((this.wp + 1) % wallpapers.length);
  }
  /** Cross-fades to photo n; returns its name. */
  private showPhoto(n: number): string {
    this.persist.wp = n;
    this.persist.wpName = wallpapers[n]?.name ?? '';
    save(this.persist);
    const css = `url("${this.photoUrl(n)}")`;
    const incoming = qs(this.frontA ? '#photo2' : '#photo');
    const outgoing = qs(this.frontA ? '#photo' : '#photo2');
    incoming.style.backgroundImage = css;
    incoming.style.opacity = '1';
    outgoing.style.opacity = '0';
    this.setBarImages(css);
    this.frontA = !this.frontA;

    return wallpapers[n].name;
  }

  // ---------- input ----------
  private wireInput(): void {
    document.addEventListener('keydown', (e) => {
      const k = e.key;

      // Resting: the first key only wakes the screens, whatever it is (so ↑ doesn't also change screen).
      // Not over the doorbell window, where Back closes it.
      if (this.stir() && !this.doorbell.isOpen()) {
        e.preventDefault();

        return;
      }

      // A held-down OK repeats; only the first press counts, everywhere.
      if (isHeld(e) && (k === 'Enter' || k === ' ')) {
        e.preventDefault();

        return;
      }

      if (this.doorbell.isOpen() && (k === 'Escape' || k === 'Backspace')) {
        e.preventDefault();
        this.doorbell.hide();

        return;
      }

      if (this.picker.isOpen()) {
        this.picker.handleKey(e);

        return;
      }

      if (this.settings.isOpen()) {
        this.settings.handleKey(e);

        return;
      }

      if (this.detail.isOpen()) {
        this.detail.handleKey(e);

        return;
      }

      if (this.music.isOpen()) {
        this.music.handleKey(e);

        return;
      }

      if (this.appsSection.arranging && ['Escape', 'Backspace', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) {
        e.preventDefault();
        const sec = this.sections.indexOf(this.appsSection);
        this.cols[sec] = this.appsSection.arrangeKey(k, this.cols[sec]);

        if (!this.appsSection.arranging) this.showArrangeHint(false);

        return;
      }

      if (this.overlay === 'launch') {
        if (k === 'Escape' || k === 'Backspace') {
          e.preventDefault();
          this.closeLaunch();
        } else if (k.startsWith('Arrow')) e.preventDefault();

        return;
      }

      switch (k) {
        case 'ArrowUp': e.preventDefault(); this.moveV(-1, isHeld(e)); break;
        case 'ArrowDown': e.preventDefault(); this.moveV(1, isHeld(e)); break;
        case 'ArrowLeft': e.preventDefault(); this.moveH(-1, isHeld(e)); break;
        case 'ArrowRight': e.preventDefault(); this.moveH(1, isHeld(e)); break;
        case 'Enter':
        case ' ': e.preventDefault(); this.activate(); break;
        case 'w':
        case 'W': this.nextWallpaper(); break;
        default: return;
      }
    });

    // Resting: a press only wakes the screens (its tap, click or swipe is dropped). A mouse wakes them
    // as soon as it moves, so its clicks then act as usual.
    document.addEventListener('pointerdown', () => { this.wakingPress = this.stir(); }, true);
    document.addEventListener('click', (e) => {
      if (!this.wakingPress) return;
      this.wakingPress = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
    document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this.stir(); });

    const sections = qs('#sections');
    sections.addEventListener('mouseover', (e) => {
      const el = itemAt(e.target);

      if (!el) return;
      const sec = Number(el.dataset.sec);
      const it = Number(el.dataset.item);

      if (sec !== this.secIndex) return;
      this.cols[sec] = it;
      this.sections[sec].focus(it);
    });
    sections.addEventListener('click', (e) => {
      const el = itemAt(e.target);

      if (!el) return;
      const sec = Number(el.dataset.sec);
      const it = Number(el.dataset.item);

      if (sec !== this.secIndex) return;
      this.cols[sec] = it;
      this.sections[sec].focus(it);
      this.activate();
    });

    qs('#launch').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeLaunch();
    });

    // Touch: swipe up or down for the next or previous screen. Sideways, the rows scroll by
    // themselves like any touch list (see row-scroll.ts), which ends this gesture (pointercancel).
    let start: { x: number; y: number } | null = null;
    sections.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && !this.wakingPress) start = { x: e.clientX, y: e.clientY }; });
    sections.addEventListener('pointerup', (e) => {
      if (!start || e.pointerType !== 'touch') return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;

      if (Math.abs(dy) >= SWIPE_MIN && Math.abs(dy) > Math.abs(dx)) this.moveV(dy < 0 ? 1 : -1);
    });
    sections.addEventListener('pointercancel', () => { start = null; });

    // From the TV app: Home pressed (back to the app dock), and returning from another app.
    window.addEventListener('ct-home', () => { this.stir(); this.goHome(); });
    // A phone remote's Settings key (the Home button service brings Calm TV forward): its Settings.
    window.addEventListener('ct-settings', () => { this.stir(); this.closePanels(); this.settings.show(); });

    // Dev only: try the doorbell window without anyone ringing.
    if (import.meta.env.DEV) {
      Object.assign(window, { ctRing: () => this.ring(), ctRingEnd: () => this.doorbell.hide() });
    }

    window.addEventListener('ct-resume', () => { this.stir(); this.closeLaunch(); this.pauseVideo(false); this.checkHomeService(); });
    window.addEventListener('ct-pause', () => this.pauseVideo(true));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.closeLaunch();
      this.pauseVideo(document.hidden);
    });
  }

  // ---------- resting ----------

  /**
   * Input: wakes the screens if they were resting, and starts the countdown to the next rest. True
   * when they were resting, so the caller can treat this input as only waking them.
   */
  private stir(): boolean {
    const html = document.documentElement;
    const resting = html.classList.contains('calm');
    html.classList.remove('calm');
    clearTimeout(this.restTimer);

    if (fadeWhenIdle()) this.restTimer = window.setTimeout(() => this.rest(), REST_AFTER * 1000);

    return resting;
  }

  /** After a while without input the screens' bars fade (see html.calm in style.css), unless something's open. */
  private rest(): void {
    const busy = this.picker.isOpen() || this.settings.isOpen() || this.detail.isOpen() || this.music.isOpen()
      || this.appsSection.arranging || this.overlay !== null;

    if (busy) this.restTimer = window.setTimeout(() => this.rest(), REST_AFTER * 1000);
    else document.documentElement.classList.add('calm');
  }

  /**
   * Android turns Calm TV's Home button service off whenever the app is updated, and then Home,
   * the doorbell window, door pop-ups and ★ quietly stop working. So the first time Calm TV opens
   * after an update with the service off, a note says how to turn it back on (Settings → Home
   * button too). It goes once the service is on, at the next key, or after 30 seconds.
   */
  private checkHomeService(): void {
    const note = document.getElementById('serviceNote');

    if (!native?.homeServiceOn || native.homeServiceOn()) {
      note?.remove();

      return;
    }

    const installed = String(native.installedAt?.() ?? '');
    let shown = '';

    try { shown = localStorage.getItem(SERVICE_NOTE_KEY) ?? ''; } catch { /* storage off: show it */ }

    if (note || shown === installed) return;

    try { localStorage.setItem(SERVICE_NOTE_KEY, installed); } catch { /* once is enough */ }
    const el = document.createElement('div');
    el.id = 'serviceNote';
    el.innerHTML = '<b>The Home button is off.</b> Android turns it off after every update of Calm TV. To turn it back on: '
      + 'TV Settings → System → Accessibility → <b>Calm TV: Home button</b> → On (or Calm TV\u2019s Settings → Home button).';
    qs('#stage').appendChild(el);
    const done = () => el.remove();
    window.setTimeout(done, 30000);
    document.addEventListener('keydown', done, { once: true });
  }

  /** Closes whatever panel is open: the background picker, Settings, a room, Music, arranging. */
  private closePanels(): void {
    if (this.picker.isOpen()) this.picker.close();

    if (this.settings.isOpen()) this.settings.close();

    if (this.detail.isOpen()) this.detail.close();

    if (this.music.isOpen()) this.music.close();

    if (this.appsSection.arranging) {
      this.appsSection.stopArrange();
      this.showArrangeHint(false);
    }

    this.closeLaunch();
  }

  /** Home button: close anything open and return to the app dock. */
  private goHome(): void {
    this.closePanels();

    if (this.secIndex !== 0) {
      this.secIndex = 0;
      this.render();
      this.sections[0].onEnter?.();
    }
  }

  // ---------- misc ----------
  /** Settings → Arrange dock: go to the dock and move tiles with the remote. */
  arrangeDock(): void {
    const sec = this.sections.indexOf(this.appsSection);

    if (sec < 0) return;
    this.secIndex = sec;
    this.cols[sec] = 0;
    this.render();
    this.appsSection.startArrange();
    this.showArrangeHint(true);
  }

  /** Settings → Choose apps added or took off an app: the dock's tiles again, the focus kept in range. */
  private dockChanged(): void {
    const sec = this.sections.indexOf(this.appsSection);

    if (sec < 0) return;
    this.cols[sec] = this.appsSection.rebuild(this.cols[sec]);
    this.render();
  }

  private showArrangeHint(on: boolean): void {
    const hint = qs('#hint');

    if (on) {
      this.hintHtml ??= hint.innerHTML;
      hint.innerHTML = '<kbd>OK</kbd> pick up or put down &middot; <kbd>←</kbd><kbd>→</kbd> move &middot; <kbd>Back</kbd> done';
      clearTimeout(this.hintTimer);
      hint.classList.remove('gone');
    } else {
      hint.classList.add('gone');

      if (this.hintHtml !== undefined) hint.innerHTML = this.hintHtml;
    }
  }

  private hideHint(): void {
    qs('#hint').classList.add('gone');
    clearTimeout(this.hintTimer);
  }
  private fit(): void {
    // Demo mode's on-screen remote (demo-remote.ts) takes the right edge of a phone held sideways.
    const side = document.documentElement.classList.contains('with-remote') && window.innerWidth > window.innerHeight && window.innerHeight < 600 ? 190 : 0;
    // Dashboard mode: the screens sit above the tab bar.
    const bottom = this.bar ? DASHBOARD_BAR_H : 0;
    const width = window.innerWidth - side;
    const height = window.innerHeight - bottom;
    const s = Math.min(width / 1920, height / 1080);
    const stage = qs('#stage');
    stage.style.left = side ? `${width / 2}px` : '';
    stage.style.top = bottom ? `${height / 2}px` : '';
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  }
}
