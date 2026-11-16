import { ha } from './ha';
import { playCamera, type CameraStream } from './camera-stream';
import { haPath, settings } from './config';
import { child, find } from './dom';

// When the doorbell rings, a small live video window appears in the corner, even over other apps.
// It follows an input_boolean that an HA automation turns on for ~60 seconds per ring. Both come
// from calm-tv.json: "doorbell": { "window": true, "camera": "camera.…", "ringing": "input_boolean.…" }.

const doorbellCamera = () => settings.config.doorbell?.camera ?? '';
export const doorbellRinging = () => settings.config.doorbell?.ringing ?? '';

/** True when calm-tv.json turns the doorbell window on and names its camera and switch. */
export const doorbellEnabled = () => !!(settings.config.doorbell?.window && doorbellCamera() && doorbellRinging());

/** How the window looks: width in % of the screen, centred or in the corner, and whether to pause other apps. */
export interface DoorbellLook {
  size: number;
  center: boolean;
  pause: boolean;
  sound: boolean;
}

export function doorbellLook(): DoorbellLook {
  const d = settings.config.doorbell;

  return { size: d?.size ?? 34, center: d?.position === 'center', pause: !!d?.pause, sound: !!d?.sound };
}

/** True in the over-other-apps window (index.html?doorbell). */
const overlayMode = () => document.documentElement.classList.contains('dbell-only');

/** On the fixed 1920-wide stage. */
const STAGE_WIDTH = 1920;

/** The corner video window. Used inside Calm TV, and alone in the TV's over-other-apps overlay. */
export class DoorbellWindow {
  readonly el: HTMLElement;
  private video: HTMLVideoElement;
  private still: HTMLImageElement;
  private stillTimer = 0;
  /** Over other apps, live video is copied onto this canvas (see paintFrames). */
  private canvas: HTMLCanvasElement;
  private painting = false;
  private msg: HTMLElement;
  private stream: CameraStream | null = null;
  private slowTimer = 0;
  private shown = false;

  constructor(mount: HTMLElement, hint = '') {
    this.el = document.createElement('div');
    this.el.className = 'dbell';
    this.el.innerHTML = `
      <img class="dbell-still" alt="">
      <video muted autoplay playsinline></video>
      <canvas class="dbell-canvas"></canvas>
      <div class="dbell-msg">Connecting…</div>
      <div class="dbell-tag"><span class="dot"></span>Front door</div>
      ${hint ? `<div class="dbell-hint">${hint}</div>` : ''}`;
    this.video = find(this.el, 'video', HTMLVideoElement);
    this.still = find(this.el, 'img', HTMLImageElement);
    this.canvas = find(this.el, 'canvas', HTMLCanvasElement);
    // Entities can arrive after the window opens (overlay mode connects from scratch).
    ha.onEntities(() => { if (this.shown && !this.still.src && !this.el.classList.contains('live')) this.startStill(); });
    this.msg = child(this.el, '.dbell-msg');
    mount.appendChild(this.el);
  }

  isOpen(): boolean {
    return this.shown;
  }

  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.applyLook();
    this.msg.textContent = 'Connecting…';
    this.msg.hidden = false;
    this.el.classList.add('open');
    // Live only once a frame is really drawn: "playing" can fire before any picture shows, and the
    // quick picture underneath should stay until then.
    const live = () => {
      if (!this.shown) return;
      this.msg.hidden = true;
      this.el.classList.add('live');
      // The quick picture is hidden now: stop its stream, so HA isn't sending it for the rest of the ring.
      clearInterval(this.stillTimer);
      this.still.removeAttribute('src');
      this.video.muted = !doorbellLook().sound;
      if (overlayMode()) this.paintFrames();
      if (!this.video.muted) this.video.play().catch(() => { this.video.muted = true; });
    };
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(live);
    else this.video.addEventListener('playing', () => { if (this.video.videoWidth) live(); }, { once: true });
    this.startStill();
    // Live video trouble only matters when there's no picture at all.
    const fail = (m: string) => {
      if (this.shown && !this.el.classList.contains('has-still')) {
        this.msg.hidden = false;
        this.msg.textContent = m;
      }
    };
    const conn = ha.connection;

    if (!conn) {
      fail('Someone rang · not connected to Home Assistant');

      return;
    }

    playCamera(conn, doorbellCamera(), this.video, (m) => fail(`Camera error: ${m}`))
      .then((s) => { if (this.shown) this.stream = s; else s.stop(); })
      .catch(() => fail('Someone rang · camera didn’t start'));
    this.slowTimer = window.setTimeout(() => fail('Someone rang · video is still connecting'), 10000);
  }

  /** Size and place from calm-tv.json. The over-other-apps window is sized by Android instead. */
  private applyLook(): void {
    if (overlayMode()) return;
    const look = doorbellLook();
    const width = Math.round((STAGE_WIDTH * look.size) / 100);
    this.el.style.width = `${width}px`;
    this.el.style.setProperty('--u', `${width / 100}px`);
    this.el.classList.toggle('center', look.center);
  }

  /**
   * A picture straight away: HA's camera proxy stream (MJPEG, or snapshots one after another for
   * cameras without it). It needs no WebRTC set-up, so it shows within a second or so, and stays
   * up if live video never connects (e.g. a camera whose WebRTC is slow or unsupported).
   */
  private startStill(): void {
    const token = ha.entities[doorbellCamera()]?.attributes.access_token;

    if (typeof token !== 'string' || !settings.haUrl) return;
    this.still.src = haPath(`/api/camera_proxy_stream/${doorbellCamera()}?token=${encodeURIComponent(token)}`);
    // A stream's first frame doesn't always fire "load"; check for a picture instead.
    this.stillTimer = window.setInterval(() => {
      if (this.still.naturalWidth > 0) {
        clearInterval(this.stillTimer);
        this.el.classList.add('has-still');

        if (!this.el.classList.contains('live')) this.msg.hidden = true;
      }
    }, 150);
  }

  /**
   * Over other apps, Android's WebView shows <video> by punching a hole through the window to a
   * video layer underneath, so the app behind (Netflix...) shows through instead of the camera.
   * There the video element stays hidden and each frame is drawn onto a canvas, which is part of
   * the page like any picture.
   */
  private paintFrames(): void {
    if (this.painting) return;
    this.painting = true;
    const ctx = this.canvas.getContext('2d');
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const draw = () => {
      if (!this.shown || !ctx) {
        this.painting = false;

        return;
      }

      const w = this.video.videoWidth;
      const h = this.video.videoHeight;

      if (w && h) {
        if (this.canvas.width !== w) this.canvas.width = w;
        if (this.canvas.height !== h) this.canvas.height = h;
        ctx.drawImage(this.video, 0, 0, w, h);
      }

      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw);
      else requestAnimationFrame(draw);
    };

    draw();
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.painting = false;
    clearInterval(this.stillTimer);
    this.still.removeAttribute('src');
    this.video.muted = true;
    this.el.classList.remove('has-still', 'live');
    clearTimeout(this.slowTimer);
    this.stream?.stop();
    this.stream = null;
    this.video.srcObject = null;
    this.el.classList.remove('open');
  }
}

/**
 * Overlay mode (index.html?doorbell): the TV shows this page in a small window over whatever app
 * is playing. It connects with the saved sign-in, plays the doorbell, and asks Android to close
 * the window once the ring is over.
 */
export function startDoorbellOnly(): void {
  document.documentElement.classList.add('dbell-only');
  // Back closes it: the Home button service catches Back while this window is up.
  const win = new DoorbellWindow(document.body, 'Back to close');

  const close = () => {
    win.hide();
    window.CalmTvDoorbell?.close();
  };

  let sawRinging = false;
  ha.onConnected(() => win.show());
  ha.onEntities(() => {
    const on = ha.entities[doorbellRinging()]?.state === 'on';

    if (on) sawRinging = true;
    else if (sawRinging) close();
  });
  ha.onStatus(() => {
    if (ha.status === 'signed-out') close();
  });
  ha.start();
}

declare global {
  interface Window {
    /** Only in the TV's doorbell overlay window. */
    CalmTvDoorbell?: { close(): void; getHaUrl?(): string; loadConfig?(): string };
  }
}
