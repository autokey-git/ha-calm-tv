import { ha } from './ha';
import { playCamera, type CameraStream } from './camera-stream';
import { settings } from './config';
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
}

export function doorbellLook(): DoorbellLook {
  const d = settings.config.doorbell;

  return { size: d?.size ?? 34, center: d?.position === 'center', pause: !!d?.pause };
}

/** On the fixed 1920-wide stage. */
const STAGE_WIDTH = 1920;

/** The corner video window. Used inside Calm TV, and alone in the TV's over-other-apps overlay. */
export class DoorbellWindow {
  readonly el: HTMLElement;
  private video: HTMLVideoElement;
  private msg: HTMLElement;
  private stream: CameraStream | null = null;
  private slowTimer = 0;
  private shown = false;

  constructor(mount: HTMLElement, hint = '') {
    this.el = document.createElement('div');
    this.el.className = 'dbell';
    this.el.innerHTML = `
      <video muted autoplay playsinline></video>
      <div class="dbell-msg">Connecting…</div>
      <div class="dbell-tag"><span class="dot"></span>Front door</div>
      ${hint ? `<div class="dbell-hint">${hint}</div>` : ''}`;
    this.video = find(this.el, 'video', HTMLVideoElement);
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
    this.video.addEventListener('playing', () => { this.msg.hidden = true; }, { once: true });
    const fail = (m: string) => { if (this.shown) { this.msg.hidden = false; this.msg.textContent = m; } };
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
    if (document.documentElement.classList.contains('dbell-only')) return;
    const look = doorbellLook();
    const width = Math.round((STAGE_WIDTH * look.size) / 100);
    this.el.style.width = `${width}px`;
    this.el.style.setProperty('--u', `${width / 100}px`);
    this.el.classList.toggle('center', look.center);
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
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
    CalmTvDoorbell?: { close(): void };
  }
}
