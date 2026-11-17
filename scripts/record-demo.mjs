// Records the README's feature animations from demo mode (index.html?demo), as animated WebPs in
// docs/images/. A hidden Chrome at 1920×1080 presses the remote's keys at a human pace; each scene
// becomes a 960-pixel-wide, 15 fps loop. The README's opening animation (calm-tv-motion.webp) was
// made separately and isn't one of these scenes.
//
//   npm run dev                                   (in another terminal)
//   npm run record:demo                           (all scenes)
//   node scripts/record-demo.mjs weather          (one scene)
//   node scripts/record-demo.mjs --check weather  (no recording: a screenshot after each step)
//
// Needs Google Chrome, ffmpeg and img2webp (brew install ffmpeg webp).
// The dev server address can be changed with CT_URL (default http://localhost:5173).
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.CT_URL ?? 'http://localhost:5173';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = new URL('../docs/images/', import.meta.url).pathname;
// Saturday evening, so tonight has an event and the hourly forecast runs into the night.
const CLOCK = '2026-11-14T18:30';
const FPS = 15;
const WIDTH = 960;
const QUALITY = Number(process.env.CT_QUALITY ?? 85);

const KEYS = {
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Escape: 27,
};

/**
 * Each scene: the background, the keys pressed before recording starts (`setup`), and the recorded
 * steps. A step is [key, pause after it in ms] or [null, pause].
 * The background is the still photo unless `video` is set: a still compresses to almost nothing
 * between frames, so the UI scenes stay small. The video backgrounds have their own scene (and the
 * README's opening animation).
 */
const SCENES = {
  'smart-home': {
    background: 'Mountain Lake Sunset',
    setup: [['ArrowDown', 2000]],
    steps: [
      [null, 1200],
      ['ArrowRight', 700], ['ArrowRight', 700], ['ArrowLeft', 700], ['ArrowLeft', 900],
      ['Enter', 1400],
      ['ArrowDown', 700], ['Enter', 900],
      ['ArrowRight', 350], ['ArrowRight', 350], ['ArrowRight', 350], ['ArrowRight', 350], ['ArrowRight', 350], ['ArrowRight', 1300],
      ['Escape', 1300],
      ['Escape', 2200],
    ],
  },
  'thermostat-and-scenes': {
    background: 'Stylized Forest Brook',
    setup: [['ArrowDown', 1500], ['ArrowRight', 1500]],
    steps: [
      [null, 1000],
      ['Enter', 1300],
      ['Enter', 900],
      ['ArrowUp', 500], ['ArrowUp', 1300],
      ['Escape', 1000],
      ['Escape', 1200],
      ['ArrowRight', 900],
      ['Enter', 1300],
      ['Enter', 900],
      ['ArrowDown', 500], ['ArrowDown', 700], ['Enter', 1300],
      ['Escape', 2000],
    ],
  },
  cameras: {
    background: 'Mountain Lake Sunset',
    setup: [['ArrowDown', 1500], ['ArrowRight', 300], ['ArrowRight', 300], ['ArrowRight', 300], ['ArrowRight', 300], ['ArrowRight', 1500]],
    steps: [
      [null, 1000],
      ['Enter', 1300],
      ['ArrowRight', 600], ['ArrowRight', 900],
      ['Enter', 4500],
      ['Escape', 1200],
      ['Escape', 1500],
    ],
  },
  calendar: {
    background: 'Stylized Forest Brook',
    setup: [['ArrowDown', 600], ['ArrowDown', 600], ['ArrowDown', 2500]],
    steps: [
      [null, 1500],
      ['ArrowRight', 900], ['ArrowRight', 900], ['ArrowRight', 900], ['ArrowRight', 900],
      ['ArrowRight', 900], ['ArrowRight', 900], ['ArrowRight', 1800],
    ],
  },
  weather: {
    background: 'Mountain Lake Sunset',
    setup: [['ArrowDown', 600], ['ArrowDown', 600], ['ArrowDown', 600], ['ArrowDown', 2500]],
    steps: [
      [null, 1500],
      ['ArrowRight', 1100], ['ArrowRight', 1100], ['ArrowRight', 1100], ['ArrowRight', 1100], ['ArrowRight', 1800],
    ],
  },
  // The Music screen (the art and the bar), More → the kitchen speaker joins the group, and back
  // to the Music screen.
  music: {
    background: 'Stylized Forest Brook',
    setup: [['ArrowDown', 600], ['ArrowDown', 1500]],
    steps: [
      [null, 2500],
      // Along the bar to More.
      ['ArrowRight', 400], ['ArrowRight', 400], ['ArrowRight', 400], ['ArrowRight', 900],
      ['Enter', 2200],
      // Up to the Group speakers button above the speakers, then add the kitchen.
      ['ArrowUp', 1000],
      ['Enter', 1300],
      ['Enter', 2200],
      ['Escape', 1500],
      // Back to the Music screen.
      ['Escape', 3000],
    ],
  },
  backgrounds: {
    background: 'Mountain Lake Sunset',
    video: true,
    setup: [['ArrowRight', 200], ['ArrowRight', 200], ['ArrowRight', 200], ['ArrowRight', 200], ['ArrowRight', 200], ['ArrowRight', 200], ['ArrowRight', 1500]],
    steps: [
      [null, 800],
      ['Enter', 1300],
      ['Enter', 1300],
      ['ArrowRight', 900], ['Enter', 3500],
      ['ArrowLeft', 900], ['Enter', 3500],
    ],
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openChrome(profile) {
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=9556', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${profile}`, '--window-size=1920,1080', 'about:blank',
  ], { stdio: 'ignore' });
  let targets = [];

  for (let i = 0; i < 40 && !targets.length; i++) {
    await sleep(250);
    targets = await fetch('http://127.0.0.1:9556/json').then((r) => r.json()).catch(() => []);
  }

  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const frames = [];
  let recording = false;

  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);

    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }

    if (m.method === 'Page.screencastFrame') {
      // Timed by arrival, to line up with the stills added at the start and end (see record()).
      if (recording) frames.push({ data: m.params.data, t: performance.now() / 1000 });
      ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } }));
    }
  });
  const call = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });

  return {
    call,
    frames,
    setRecording: (on) => { recording = on; },
    close: () => { ws.close(); chrome.kill(); },
  };
}

async function press(call, key) {
  const k = { key, code: key, windowsVirtualKeyCode: KEYS[key] };
  await call('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
}

async function play(call, steps, after) {
  for (const [i, [key, pause]] of steps.entries()) {
    if (key) await press(call, key);
    await sleep(pause);
    await after?.(i, key);
  }
}

/** Frames at their real times → an evenly timed, smaller animated WebP. */
function encode(frames, dir, name) {
  frames.forEach((f, i) => writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(f.data, 'base64')));
  const list = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    list.push(`file f${String(i).padStart(4, '0')}.jpg`);
    list.push(`duration ${(i < frames.length - 1 ? frames[i + 1].t - f.t : 1 / FPS).toFixed(4)}`);
  });
  writeFileSync(join(dir, 'list.txt'), list.join('\n'));
  mkdirSync(join(dir, 'out'));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'concat', '-i', join(dir, 'list.txt'), '-vf', `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos`, join(dir, 'out', '%04d.png')]);
  const pngs = readdirSync(join(dir, 'out')).sort().map((f) => join(dir, 'out', f));
  const file = join(OUT, `demo-${name}.webp`);
  execFileSync('img2webp', ['-loop', '0', '-lossy', '-q', String(QUALITY), '-m', '6', '-d', String(Math.round(1000 / FPS)), ...pngs, '-o', file], { stdio: 'ignore' });

  return { file, count: pngs.length, mb: statSync(file).size / 1e6 };
}

async function record(name, scene, check) {
  const dir = mkdtempSync(join(tmpdir(), `calm-tv-${name}-`));
  const chrome = await openChrome(join(dir, 'profile'));
  const { call } = chrome;

  try {
    await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    const url = `${BASE}/?demo&at=${CLOCK}`;
    await call('Page.navigate', { url });
    await sleep(1500);
    await call('Runtime.evaluate', { expression: `localStorage.setItem('calmtv.demo', JSON.stringify({ vidName: ${JSON.stringify(scene.background)}, wpName: ${JSON.stringify(scene.background)} })); localStorage.setItem('calmtv.demo.look', JSON.stringify({ videos: ${!!scene.video} })); location.reload();` });
    await sleep(8000); // the clip is loaded and the keyboard hint has faded
    await play(call, scene.setup);

    if (check) {
      const shot = async (i, key) => {
        const r = await call('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
        const file = join(dir, `step-${String(i).padStart(2, '0')}-${key ?? 'wait'}.jpg`);
        writeFileSync(file, Buffer.from(r.data, 'base64'));
      };
      await shot(-1, 'start');
      await play(call, scene.steps, shot);
      console.log(`${name}: screenshots in ${dir}`);

      return;
    }

    await call('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    await sleep(300);
    // Chrome only sends a frame when the screen changes, so over a still photo the opening and
    // closing pauses would have none: hold a still at each end to keep them.
    const still = async () => ({ data: (await call('Page.captureScreenshot', { format: 'jpeg', quality: 88 })).data, t: performance.now() / 1000 });
    chrome.frames.push(await still());
    chrome.setRecording(true);
    await play(call, scene.steps);
    chrome.setRecording(false);
    chrome.frames.push(await still());
    await call('Page.stopScreencast');
    const r = encode(chrome.frames, dir, name);
    console.log(`${name}: ${r.count} frames, ${r.mb.toFixed(1)} MB → ${r.file}`);
    rmSync(dir, { recursive: true, force: true });
  } finally {
    chrome.close();
  }
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const names = args.filter((a) => !a.startsWith('--'));

for (const name of names.length ? names : Object.keys(SCENES)) {
  if (!SCENES[name]) throw new Error(`No scene "${name}". Scenes: ${Object.keys(SCENES).join(', ')}`);
  await record(name, SCENES[name], check);
}
