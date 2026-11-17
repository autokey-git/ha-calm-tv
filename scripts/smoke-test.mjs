// Drives the app in demo mode the two ways it's used, and fails if either stops working:
//
//   - with the remote (arrow keys, OK and Back), as on the TV: index.html?demo
//   - with taps, as on the Home Assistant dashboard: index.html?demo&dash
//
// Each panel is opened, used and closed both ways, and in every open panel all its items must be
// reachable with the arrows (see focus.ts). Runs on every pull request (.github/workflows/test.yml).
//
//   npm test                       (needs Google Chrome; CHROME_PATH to point at another copy)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const CHROME = process.env.CHROME_PATH
  ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
    .find((p) => existsSync(p));
const KEYS = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Escape: 27 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!CHROME) throw new Error('Google Chrome not found; set CHROME_PATH');

const server = await createServer({ server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const profile = mkdtempSync(join(tmpdir(), 'calm-tv-test-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--remote-debugging-port=9557', '--hide-scrollbars', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let failures = 0;

try {
  let targets = [];

  // Wait for Chrome's page, not just any target: on a busy CI machine the page can come a moment later.
  for (let i = 0; i < 120 && !targets.some((t) => t.type === 'page'); i++) {
    await sleep(250);
    targets = await fetch('http://127.0.0.1:9557/json').then((r) => r.json()).catch(() => []);
  }

  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];

  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);

    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }

    if (m.method === 'Fetch.requestPaused') ws.send(JSON.stringify({ id: 1e6 + Math.floor(Math.random() * 1e6), method: 'Fetch.failRequest', params: { requestId: m.params.requestId, errorReason: 'BlockedByClient' } }));

    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);

    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });

  const call = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });

  /** Runs `fn` (source of an expression or async function body) in the page; returns its value. */
  async function page(expression) {
    const m = await call('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });

    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? 'page error');

    return m.result?.result?.value;
  }

  /** A press on the remote; `held` sends it as the repeat of a held key. */
  const key = async (k, held = false) => {
    const p = { key: k, code: k, windowsVirtualKeyCode: KEYS[k] };
    await call('Input.dispatchKeyEvent', { type: 'keyDown', autoRepeat: held, ...p });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
    await sleep(120);
  };

  /** Taps the first visible element matching `selector`: its centre, or near its top-left corner with `corner`. */
  const tap = async (selector, corner = false) => {
    const at = await page(`const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.getClientRects().length);
      if (!el) return null; const r = el.getBoundingClientRect();
      return ${corner} ? { x: r.x + 12, y: r.y + 12 } : { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);

    if (!at) throw new Error(`nothing to tap: ${selector}`);

    for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await sleep(250);
  };

  /** A swipe with a finger, from (x, y) by (dx, dy). */
  const swipe = async (x, y, dx, dy) => {
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx / 2, y: y + dy / 2 }] });
    await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] });
    await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
  };

  const text = (selector) => page(`return document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null;`);
  const has = (selector) => page(`return [...document.querySelectorAll(${JSON.stringify(selector)})].some((e) => e.getClientRects().length > 0);`);

  let mode = '';

  const check = (ok, what) => {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${mode}: ${what}`);

    if (!ok) failures++;
  };

  /**
   * In the open panel `root`, every item must be reachable with the arrows from the focused one
   * (by the same rules as focus.ts), so nothing can be tapped that the remote can't reach.
   */
  const reachable = (root) => page(`
    const { nearest } = await import('/src/focus.ts');
    const items = [...document.querySelectorAll(${JSON.stringify(root)} + ' [data-focus]')]
      .filter((e) => e.getAttribute('aria-disabled') !== 'true' && e.getClientRects().length > 0);
    const start = items.find((e) => e.classList.contains('focus')) ?? items[0];
    if (!start) return { total: 0, missing: ['(no items)'] };
    const seen = new Set([start]); const queue = [start];
    while (queue.length) {
      const from = queue.shift();
      for (const dir of ['up', 'down', 'left', 'right']) {
        const next = nearest(from, items.filter((i) => i !== from), dir);
        if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    return { total: items.length, missing: items.filter((i) => !seen.has(i)).map((i) => i.dataset.focus) };`);

  const allReachable = async (root, name) => {
    const r = await reachable(root);
    check(r.total > 0 && r.missing.length === 0, `${name}: all ${r.total} items reachable with the arrows${r.missing.length ? ` (not: ${r.missing.join(', ')})` : ''}`);
  };

  const open = async (query, width, height, touch = false) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await call('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 0 });
    await call('Page.navigate', { url: `${base}?${query}&at=2026-11-14T18:30` });
    await sleep(3500);
  };

  await call('Page.enable');
  await call('Runtime.enable');

  // ---------- the TV: remote only ----------
  mode = 'remote';
  await open('demo', 1920, 1080);
  check(await has('#secApps.is-active'), 'starts on the Apps screen');
  // The screens wrap round too: ↑ on the first goes to the last, ↓ comes back.
  await key('ArrowUp');
  const lastScreen = await page("return document.querySelector('.section.is-active')?.id;");
  await key('ArrowDown');
  check(lastScreen === 'secWeather' && await has('#secApps.is-active'), `↑ on the first screen goes to the last (${lastScreen}), ↓ comes back`);
  // Holding ↑ (as the TV sends it): the first press wraps to the last screen, the repeats go on up
  // through the screens, and stop at the first instead of circling again.
  const up = { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: KEYS.ArrowUp };
  for (let i = 0; i < 9; i++) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', ...up });
    await sleep(60);
  }
  await call('Input.dispatchKeyEvent', { type: 'keyUp', ...up });
  await sleep(300);
  check(await has('#secApps.is-active'), 'holding ↑ goes round once and stops at the first screen');
  // A screen name this version doesn't know (from a newer calm-tv.json) is skipped, not fatal.
  const decoded = await page(`const { decodeConfig } = await import('/src/config.ts');
    const c = decodeConfig(JSON.stringify({ screens: ['apps', 'some-future-screen', 'weather'], rooms: [{ name: 'Den', groups: [] }] }));
    return JSON.stringify([c.screens, c.rooms.length]);`);
  check(decoded === '[["apps","weather"],1]', `an unknown screen name is skipped, and the rest of calm-tv.json still loads (${decoded})`);
  await key('ArrowDown');
  check(await has('#secHome.is-active'), '↓ goes to Smart Home');
  // The rooms wrap around like the dock: ← on the first goes to the last, → comes back.
  const roomFocus = () => page("return Number(document.querySelector('#secHome .is-focus')?.dataset.item);");
  const firstRoom = await roomFocus();
  await key('ArrowLeft');
  const wrapped = await roomFocus();
  const lastRoom = await page("return document.querySelectorAll('#secHome [data-item]').length - 1;");
  await key('ArrowRight');
  check(firstRoom === 0 && wrapped === lastRoom && (await roomFocus()) === 0, `the rooms wrap: ← from the first goes to the last (${wrapped} of ${lastRoom})`);
  // Held, as the TV's remote sends it: key-downs with no repeat flag and no key-up until the end. It
  // stops at the last room instead of wrapping round.
  const right = { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: KEYS.ArrowRight };
  for (let i = 0; i < lastRoom + 3; i++) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', ...right });
    await sleep(60);
  }
  await call('Input.dispatchKeyEvent', { type: 'keyUp', ...right });
  check((await roomFocus()) === lastRoom, `holding → stops at the last room, as the TV sends it (on ${await roomFocus()})`);
  await key('ArrowRight');
  check((await roomFocus()) === 0, '…and a new press then wraps to the first');

  await key('Enter');
  check(await has('.detail.open:not(.settings)'), 'OK opens a room');
  await allReachable('.detail.open:not(.settings) .detail-panel', 'room');
  await key('Enter');
  check(await has('.detail-control.open .ctl-light'), 'OK on a dimmer opens it');
  const before = await text('.ctl-state');
  await key('ArrowLeft');
  check((await text('.ctl-state')) !== before, `← dims it (${before} → ${await text('.ctl-state')})`);
  await key('Escape');
  check(!(await has('.detail-control.open')), 'Back closes the dimmer');
  await key('Escape');
  check(!(await has('.detail.open')), 'Back closes the room');

  await key('ArrowRight');
  await key('Enter');
  await key('Enter');
  const temp = await text('.ctl-set');
  await key('ArrowUp');
  check(Number(await text('.ctl-set')) === Number(temp) + 1, `↑ raises the thermostat (${temp} → ${await text('.ctl-set')})`);
  await key('Escape');
  await key('Escape');

  await key('ArrowRight');
  await key('Enter');
  await key('Enter');
  check(await has('.detail-control.open .scene-opt'), 'OK on a scene opens the list');
  await allReachable('.detail-control.open', 'scene list');
  await key('ArrowDown');
  const scene = await text('.scene-opt.focus');
  await key('Enter');
  check(!(await has('.detail-control.open')) && (await text('.detail.open .drow .dstatus')) === scene, `OK sets the scene (${scene})`);
  await key('Escape');

  await key('ArrowUp');
  // Held, → stops at the end of the dock (pressed one at a time it wraps round): the gear. Sent the
  // way the TV's remote sends a held button: key-downs with no repeat flag, then one key-up.
  const heldRight = { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: KEYS.ArrowRight };
  for (let i = 0; i < 14; i++) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', ...heldRight });
    await sleep(60);
  }
  await call('Input.dispatchKeyEvent', { type: 'keyUp', ...heldRight });
  await sleep(200);
  await key('Enter');
  await sleep(500);
  check(await has('.settings.open'), 'OK on the gear opens Settings');
  await allReachable('.settings.open', 'Settings');
  // Appearance: the background, the Music background and the look choices, in one sub-menu.
  await key('Enter');
  check((await text('.settings .detail-title')) === 'Appearance', 'OK opens a Settings sub-menu (Appearance)');
  await allReachable('.settings.open', 'Appearance');
  await key('Escape');
  check((await text('.settings .detail-title')) === 'Settings', 'Back returns to Settings');
  await key('Enter');
  // Music background: OK steps to the next choice, and the Music screen follows.
  const mbRow = await page("return [...document.querySelectorAll('.settings .drow')].findIndex((r) => r.querySelector('.dname')?.textContent === 'Music background');");
  await page(`document.querySelectorAll('.settings .drow')[${mbRow}].click();`);
  check((await page("return document.querySelector('#secMusic').dataset.glow;")) === 'glow', 'Settings → Appearance → Music background steps from None to Glow');
  await page(`document.querySelectorAll('.settings .drow')[${mbRow}].click(); document.querySelectorAll('.settings .drow')[${mbRow}].click(); document.querySelectorAll('.settings .drow')[${mbRow}].click();`);
  check((await page("return document.querySelector('#secMusic').dataset.glow;")) === 'none', '…and round again to None');
  const waveRow = await page("return [...document.querySelectorAll('.settings .drow')].findIndex((r) => r.querySelector('.dname')?.textContent === 'Music wave');");
  const waveOn = await page("return document.querySelector('#secMusic').dataset.wave;");
  await page(`document.querySelectorAll('.settings .drow')[${waveRow}].click();`);
  const waveOff = await page("return document.querySelector('#secMusic').dataset.wave;");
  await page(`document.querySelectorAll('.settings .drow')[${waveRow}].click();`);
  const fadeRow = await page("return [...document.querySelectorAll('.settings .drow')].findIndex((r) => r.querySelector('.dname')?.textContent === 'Fade when idle');");
  const fadeStatus = () => page(`return document.querySelectorAll('.settings .drow')[${fadeRow}].querySelector('.dstatus').textContent;`);
  const fadeOn = await fadeStatus();
  await page(`document.querySelectorAll('.settings .drow')[${fadeRow}].click();`);
  const fadeOff = await fadeStatus();
  await page(`document.querySelectorAll('.settings .drow')[${fadeRow}].click();`);
  check(fadeOn.startsWith('On') && fadeOff.startsWith('Off') && (await fadeStatus()).startsWith('On'), 'Fade when idle is on by default, and OK turns it off and on');
  check(waveOn === 'on' && waveOff === 'off' && (await page("return document.querySelector('#secMusic').dataset.wave;")) === 'on', 'Music wave is on by default, and OK turns it off and on');
  const fxRow = await page("return [...document.querySelectorAll('.settings .drow')].findIndex((r) => r.querySelector('.dname')?.textContent === 'Visual effects');");
  const fx = () => page(`return document.querySelectorAll('.settings .drow')[${fxRow}].querySelector('.dstatus').textContent;`);
  const fxBefore = await fx();
  await page(`document.querySelectorAll('.settings .drow')[${fxRow}].click();`);
  const fxOff = await fx();
  await page(`document.querySelectorAll('.settings .drow')[${fxRow}].click();`);
  check(fxBefore.startsWith('On') && fxOff.startsWith('Off') && (await fx()).startsWith('On'), `Visual effects switches glass and fades together (${fxOff.split(' · ')[1]})`);
  // Up from Visual effects to Background, the first row.
  for (let i = 0; i < 4; i++) await key('ArrowUp');
  await key('Enter');
  check(await has('.bgpick.open'), 'Background opens the picker');
  await allReachable('.bgpick.open', 'background picker');
  await key('Escape');
  check(!(await has('.bgpick.open')), 'Back closes the picker');

  check(!(await page("return [...document.querySelectorAll('#secApps .tile')].some((t) => /music/i.test(t.getAttribute('aria-label') ?? ''));")), 'the dock has no Music tile');

  // The Music screen: the art and the main controls; More opens the Music panel.
  await key('ArrowDown');
  await key('ArrowDown');
  await sleep(600);
  check(await has('#secMusic.is-active') && await has('#secMusic .mx-art img.loaded') && !(await has('#secMusic.no-cover')), 'the Music screen shows the album art once it has loaded');
  const playLabel = () => page("return document.querySelector('#secMusic .mxb.is-focus')?.getAttribute('aria-label');");
  const wasLabel = await playLabel();
  await key('Enter');
  check(wasLabel === 'Pause' && (await playLabel()) === 'Play', `OK on play/pause pauses (${wasLabel} → ${await playLabel()})`);
  await key('Enter');
  // Resting: after 8 s without input every screen's bar fades; the first key, any key, only wakes it.
  await sleep(9000);
  const rested = await page("return document.documentElement.classList.contains('calm');");
  await key('ArrowUp');
  check(rested && !(await page("return document.documentElement.classList.contains('calm');")) && await has('#secMusic.is-active'),
    'after 8 s the screens rest; ↑ then only wakes them (still on Music)');
  await page("document.documentElement.classList.add('calm');");
  await key('Enter');
  check((await playLabel()) === 'Pause', 'resting, OK only wakes the screens (the music keeps playing)');
  for (let i = 0; i < 4; i++) await key('ArrowRight');
  await key('Enter');
  check(await has('.music.open'), 'More opens the Music panel');
  await allReachable('.music.open', 'Music');
  // → along a row of buttons goes to the next one, not diagonally to a closer one on the staggered row below.
  await page("document.querySelector('.music [data-focus=\"library-0\"]').dispatchEvent(new PointerEvent('pointerover', { pointerType: 'mouse', bubbles: true }));");
  await key('ArrowRight');
  check((await page("return document.querySelector('.music .focus')?.dataset.focus;")) === 'library-1', 'Music library: → from Artists goes to Albums, the next one in its row');
  await page("document.querySelector('.music [data-focus=\"speaker-0\"]').dispatchEvent(new PointerEvent('pointerover', { pointerType: 'mouse', bubbles: true }));");
  // Down the speakers, then across to the end of the library row (Playlists)…
  await key('ArrowDown');
  await key('ArrowDown');
  await key('ArrowRight');
  await key('ArrowRight');
  const endOfRow = await page("return document.querySelector('.music .focus')?.dataset.focus;");
  // …where → goes round to the first control level with it, and ← comes back.
  await key('ArrowRight');
  const wrappedTo = await page("return document.querySelector('.music .focus')?.dataset.focus;");
  await key('ArrowLeft');
  check(wrappedTo === 'control-shuffle' && (await page("return document.querySelector('.music .focus')?.dataset.focus;")) === endOfRow,
    `Music: → at the end of the library row goes round to the controls, ← comes back (${endOfRow} → ${wrappedTo})`);
  await key('Enter');
  await sleep(300);
  check(await has('.music.browsing .mcard'), 'OK on a library button opens it');
  await allReachable('.music.open', 'Music folder');
  await key('Escape');
  check(!(await has('.music.browsing')), 'Back leaves the folder');
  await key('Escape');
  check(!(await has('.music.open')) && await has('#secMusic.is-active'), 'Back closes the panel, back on the Music screen');

  // ---------- rooms from Home Assistant's Areas (no "rooms" in calm-tv.json) ----------
  await open('demo&areas', 1920, 1080);
  await key('ArrowDown');
  await sleep(600);
  const roomNames = await page("return [...document.querySelectorAll('#secHome .zone .zname')].map((e) => e.textContent.trim()).join(', ');");
  check(roomNames === 'Living room, Kitchen, Office, Bedroom, Hallways, Outside', `rooms from Areas, in floor order (${roomNames})`);
  /** The open room panel: its group titles and device names. */
  const roomPanel = async (i) => {
    await page(`document.querySelector('#secHome [data-item="${i}"]').click();`);
    await sleep(400);
    const r = await page("const rows = [...document.querySelectorAll('.detail.open .drow')]; return { groups: [...document.querySelectorAll('.detail.open .dcol-title')].map((e) => e.textContent.trim()), names: rows.map((e) => e.querySelector('.dname')?.textContent.trim() ?? ''), statuses: rows.map((e) => e.querySelector('.dstatus')?.textContent.trim() ?? '') };");
    return r;
  };
  const living = await roomPanel(0);
  check(living.groups.join(',') === 'Lights,Plugs,Curtains & blinds,Locks' && !living.names.some((n) => /music|hidden/i.test(n)),
    `Living room: lamps, curtains and the lock; a lamp's feature and a labelled device stay out (${living.groups.join(' / ')}: ${living.names.join(', ')})`);
  await key('Escape');
  const office = await roomPanel(2);
  const sceneAt = office.names.indexOf('Scene');
  check(sceneAt >= 0 && office.statuses[sceneAt] === 'Relax', `Office: a scene picker from the Area's scenes, showing the latest one (${office.statuses[sceneAt]})`);
  // Pick "Focus" in the scene list: it turns that scene on, and becomes the room's scene.
  await page(`document.querySelectorAll('.detail.open .drow')[${sceneAt}].click();`);
  await sleep(300);
  await page("[...document.querySelectorAll('.scene-opt')].find((e) => e.textContent.trim() === 'Focus')?.click();");
  await sleep(500);
  check((await page(`return document.querySelectorAll('.detail.open .drow')[${sceneAt}].querySelector('.dstatus')?.textContent.trim();`)) === 'Focus', 'picking a scene turns it on, and it becomes the room\u2019s scene');
  await key('Escape');
  const outside = await roomPanel(5);
  check(outside.groups.includes('Doors & windows') && outside.names.includes('Garage door') && !outside.groups.includes('Curtains & blinds'),
    `Outside: the garage door's sensor, but not its opener (a cover that's a door) (${outside.groups.join(' / ')})`);
  await key('Escape');

  // ---------- the ★ side panel: a garage door moves only on a deliberate second OK ----------
  await open('demo&panel', 684, 1080);
  const garage = () => page("const f = document.querySelector('.sp-item.focus'); return f ? f.textContent : '';");
  for (let i = 0; i < 25 && !/garage/i.test(await garage()); i++) await key('ArrowDown');
  check(/garage/i.test(await garage()) && /closed/i.test(await garage()), `the ★ panel reaches the garage door (${(await garage()).trim()})`);
  await key('Enter');
  check(/OK again to open/.test(await garage()), 'OK on the garage door asks "OK again to open"');
  await key('Enter');
  check(/OK again to open/.test(await garage()), 'a second OK straight away (a bounce) does nothing');
  await key('ArrowUp');
  await key('ArrowDown');
  check(!/OK again/.test(await garage()), 'moving away cancels it');
  await key('Enter');
  await sleep(650);
  await key('Enter');
  await sleep(200);
  check(/opening/i.test(await garage()), 'a deliberate second OK opens it');
  await key('Enter');
  check(/OK again to stop/.test(await garage()), 'while it moves, the hint is "OK again to stop"');
  await sleep(650);
  await key('Enter');
  await sleep(300);
  check(!/opening|closing/i.test(await garage()), `…and a second OK stops it, not reverses it (${(await garage()).trim()})`);

  // ---------- the Home Assistant dashboard: taps only ----------
  mode = 'touch';
  // The demo's album cover can't be fetched here, like covers a TV can't reach on some networks.
  // Only the image request fails: the dev server also serves a small module for the cover's address.
  await call('Fetch.enable', { patterns: [{ urlPattern: '*album-echoes*', resourceType: 'Image' }] });
  await open('demo&dash', 1280, 800, true);
  check(await has('#dashboardBar') && await has('#secHome.is-active'), 'starts on Home, with the tab bar');
  await tap('#dashboardBar .tb-tab:nth-child(3)');
  check(await has('#secCalendar.is-active'), 'the Calendar tab shows Calendar');
  await swipe(640, 300, 0, 200);
  check(await has('#secMusic.is-active'), 'swiping down goes back a screen (Music)');
  await tap('#dashboardBar .tb-tab:nth-child(1)');

  await page("document.documentElement.classList.add('calm');");
  await tap('#secHome [data-item="0"]');
  check(!(await has('.detail.open')) && !(await page("return document.documentElement.classList.contains('calm');")), 'resting, a tap only wakes the screens');
  await tap('#secHome [data-item="0"]');
  check(await has('.detail.open:not(.settings)'), 'tapping a room opens it');
  await tap('.detail.open [data-focus="device-0-0"]');
  check(await has('.detail-control.open .ctl-light'), 'tapping a dimmer opens it');
  await tap('.ctl-light .ctl-name');
  check((await text('.ctl-state')) === 'Off', 'tapping its name switches it off');
  await tap('.detail-control', true);
  check(!(await has('.detail-control.open')), 'tapping outside closes the dimmer');
  await tap('.detail.open .detail-close');
  check(!(await has('.detail.open')), 'the close button closes the room');

  await tap('#secHome [data-item="1"]');
  await tap('.detail.open [data-focus="device-0-0"]');
  const t0 = await text('.ctl-set');
  await tap('.ctl-step[data-step="1"]');
  check(Number(await text('.ctl-set')) === Number(t0) + 1, `+ raises the thermostat (${t0} → ${await text('.ctl-set')})`);
  await tap('.detail-control', true);
  await tap('.detail.open .detail-close');

  // Rows are grabbed and dragged like any touch list (row-scroll.ts), not stepped one card per swipe.
  const rowLeft = () => page("return Math.round(document.querySelector('#secHome .touch-row').scrollLeft);");
  const row = await page("const r = document.querySelector('#secHome .touch-row').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };");
  // A finger moving in small steps, as on a real screen (Chrome on Linux ignores synthesizeScrollGesture).
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: row.x, y: row.y }] });

  for (let i = 1; i <= 15; i++) {
    await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: row.x - i * 20, y: row.y }] });
    await sleep(16);
  }

  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(800);
  const dragged = await rowLeft();
  const why = dragged > 100 ? '' : await page(`const s = document.querySelector('#secHome .touch-row');
    const at = document.elementFromPoint(${row.x}, ${row.y});
    return '; scrollWidth ' + s.scrollWidth + ', clientWidth ' + s.clientWidth + ', under the finger: ' + (at ? at.tagName + '.' + at.className : 'nothing')
      + ', touch points ' + navigator.maxTouchPoints;`);
  check(dragged > 100, `dragging the rooms scrolls them (${dragged}px${why})`);
  check(await has('#secHome.is-active'), 'a sideways drag doesn’t change screens');

  // Tapping a card that the drag brought into view must not snap the row back (only if the drag worked).
  if (dragged > 100) {
    await tap('#secHome [data-item="4"]');
    await tap('.detail.open .detail-close');
    check(Math.abs((await rowLeft()) - dragged) < 200, `tapping a card doesn’t snap the row back (${dragged} → ${await rowLeft()}px)`);
  }
  await swipe(row.x, row.y, 0, -200);
  check(await has('#secMusic.is-active'), 'swiping up on the rooms still changes screens');
  await tap('#dashboardBar .tb-tab:nth-child(1)');

  await tap('#dashboardBar .tb-tab:nth-child(2)');
  check(await has('#secMusic.is-active'), 'the Music tab shows the Music screen');
  check(await has('#secMusic.no-cover .mx-art-empty') && !(await has('#secMusic .mx-art img')), 'a cover that can\u2019t be fetched shows the note placeholder, not an empty frame');
  await call('Fetch.disable');
  await tap('#secMusic .mxb.more');
  check(await has('.music.open'), 'tapping More opens the Music panel');
  await tap('.music .mcat:nth-child(4)');
  await sleep(300);
  check(await has('.music.browsing .mcard'), 'tapping a library button opens it');
  await tap('.music-grid .mcard');
  await sleep(300);
  check(await has('.music.browsing .mcard'), 'tapping a playlist opens it');
  await tap('#dashboardBar .tb-tab:nth-child(4)');
  check(!(await has('.music.open')) && await has('#secWeather.is-active'), 'a screen tab closes Music and shows that screen');
  await tap('#secWeather [data-item="0"]');
  await tap('#dashboardBar .tb-tab:nth-child(1)');
  check(await has('#secHome.is-active'), 'the Home tab goes back to Home');
  await tap('#secHome [data-item="0"]');
  await tap('#dashboardBar .tb-tab:nth-child(1)');
  check(!(await has('.detail.open')), 'the tab of the screen on show closes a room on top of it');
  await tap('#dashboardBar .tb-tab:nth-child(2)');
  await tap('#secMusic .mxb.more');
  await tap('.music .mcat:nth-child(4)');
  await sleep(300);
  await tap('.music-grid .mcard');
  await sleep(300);
  await tap('.music-hint');
  await tap('.music-hint');
  await tap('.music-hint');
  check(!(await has('.music.open')), 'the Back and Close button closes Music');

  await tap('#dashboardBar .tb-icon');
  check(await has('.settings.open'), 'the gear opens Settings');
  check(!(await page("return [...document.querySelectorAll('.settings .dname')].some((e) => e.textContent === 'TV settings');")), 'Settings leaves out the TV-only rows');
  await tap('.settings .drow');
  check((await text('.settings .detail-title')) === 'Appearance', 'tapping Appearance opens it');
  await tap('.settings .drow');
  check(await has('.bgpick.open'), 'tapping Background opens the picker');
  await tap('.bgpick-done');
  check(!(await has('.bgpick.open')), 'Done closes the picker');

  // On the TV: Settings → Arrange dock → Choose apps, with a stand-in for the TV app's bridge.
  mode = 'TV apps';
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bridge = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.removeItem('calmtv.demo.dockChoice');
    window.CalmTvNative = {
      apps: () => JSON.stringify([
        { pkg: 'com.google.android.youtube.tv', label: 'YouTube' },
        { pkg: 'com.example.zeta', label: 'Zeta Player' },
        { pkg: 'com.example.blank', label: 'Blank' },
      ]),
      appIcon: (pkg) => (pkg === 'com.example.zeta' ? '${PNG}' : ''),
      launch: () => true, openSettings() {}, openGoogleHome() {},
    };` });
  await open('demo', 1920, 1080);
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: bridge.result.identifier });
  const tiles = () => page("return document.querySelectorAll('.gb-track .tile').length;");
  const dockBefore = await tiles();
  await key('ArrowLeft');
  await key('Enter');
  await sleep(500);
  await key('ArrowDown');
  await key('Enter');
  await sleep(500);
  check((await text('.settings .detail-title')) === 'Arrange dock', 'Settings → Arrange dock opens');
  await key('Enter');
  await sleep(500);
  const rows = () => page("return [...document.querySelectorAll('.settings .drow')].map((r) => ({ name: r.querySelector('.dname').textContent, status: r.querySelector('.dstatus').textContent, own: !!r.querySelector('.mark-app'), letter: r.querySelector('.mark-text')?.textContent ?? '' }));");
  let list = await rows();
  check(list.map((r) => r.name).join() === 'Blank,YouTube,Zeta Player', `Choose apps lists the installed apps by name (${list.map((r) => r.name).join()})`);
  check(list[1]?.status.startsWith('On the dock') && !list[2]?.status.startsWith('On the dock'), 'it says which are on the dock');
  check(list[2]?.own && list[0]?.letter === 'B', 'an app without a Calm TV icon shows Android’s icon, or else its first letter');
  await key('ArrowDown');
  await key('ArrowDown');
  await key('Enter');
  list = await rows();
  check(list[2]?.status.startsWith('On the dock') && (await tiles()) === dockBefore + 1 && (await has('.gb-track .tile .mark-app')), 'OK adds the app to the dock, with its own icon');
  check((await page("return localStorage.getItem('calmtv.demo.dockChoice') ?? '';")).includes('com.example.zeta'), 'the choice is kept on this TV');
  await sleep(500);
  await key('Enter');
  check(!(await rows())[2]?.status.startsWith('On the dock') && (await tiles()) === dockBefore, 'OK again takes it off');
  await key('Escape'); await key('Escape'); await key('Escape');
  check(await page("const t = [...document.querySelectorAll('.gb-track .tile')]; return t.at(-1).classList.contains('is-focus');"), 'leaving Settings, the Settings tile still has the focus');

  // The setup kept in Home Assistant comes before calm-tv.json (config.ts, config-store.ts).
  mode = 'setup in HA';
  // Rooms from the demo's areas, so "My own list" starts from them.
  await open('demo&areas', 1920, 1080);
  await key('ArrowLeft'); await key('Enter'); await sleep(500);
  const pick = async (name) => { await page(`[...document.querySelectorAll('.detail.open .drow')].find((r) => r.querySelector('.dname')?.textContent.trim() === ${JSON.stringify(name)})?.click();`); await sleep(500); };
  await pick('Home Assistant');
  await pick('Home setup');
  const setupRows = await page("return [...document.querySelectorAll('.detail.open .drow')].map((r) => r.querySelector('.dname').textContent + ': ' + r.querySelector('.dstatus').textContent);");
  check(setupRows.length === 3 && setupRows[1].startsWith('Edit:') && setupRows[2].startsWith('Keep it in Home Assistant: Needs'), `Home setup offers to keep it in Home Assistant, for admins (${setupRows.join(' | ')})`);
  // Home setup → Edit: the setup as text and as Screens & rooms (setup-editor.ts, setup-visual.ts).
  await pick('Edit');
  await sleep(1500);
  check(await has('.cfgedit.tab-visual'), 'Edit opens on Screens & rooms');
  const editText = () => page("return document.querySelector('.cfgedit-text').value;");
  await tap('.vs-screens [data-screen="0"]');
  check(JSON.parse(await editText()).screens?.[1] !== 'smarthome', 'unticking a screen changes the text');
  await tap('.vs-rooms [data-rooms="own"]');
  await sleep(300);
  const ownRooms = JSON.parse(await editText()).rooms ?? [];
  check(ownRooms.length > 0 && ownRooms.some((r) => r.groups.some((g) => g.devices.some((d) => d.scenes?.length))), `"My own list" starts from the areas, scene pickers included (${ownRooms.length} rooms)`);
  await tap('.vs-rooms [data-room-down="0"]');
  check((JSON.parse(await editText()).rooms ?? [])[1]?.name === ownRooms[0]?.name, '↓ moves a room down');
  await tap('.vs-rooms [data-rooms="areas"]');
  check(!('rooms' in JSON.parse(await editText())), '"From my areas" takes the list out');
  await tap('.cfgedit [data-tab="text"]');
  await page("const a = document.querySelector('.cfgedit-text'); a.value = '{ \"rooms\": 3 }'; a.dispatchEvent(new Event('input'));");
  await sleep(500);
  check((await text('.cfgedit-msg')).startsWith('rooms:') && (await page("return document.querySelector('[data-act=save]').disabled;")), 'a mistake is named, and Save waits');
  await tap('.cfgedit [data-tab="visual"]');
  check(!(await has('.cfgedit.tab-visual')), 'Screens & rooms waits until the text is fixed');
  await key('Escape'); await key('Escape');
  check(!(await has('.cfgedit')), 'Esc twice closes without saving');

  const errorsBefore = errors.length;
  const stored = await call('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('ct.configStored', '{"screens":["weather"]}');` });
  await open('x', 1920, 1080);
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: stored.result.identifier });
  const used = await page("const { settings } = await import('/src/config.ts'); return JSON.stringify({ source: settings.source, stored: settings.stored, screens: settings.config.screens });");
  check(used === '{"source":"Home Assistant","stored":true,"screens":["weather"]}', `the copy kept in Home Assistant is used first (${used})`);
  await page("localStorage.removeItem('ct.configStored');");
  errors.length = errorsBefore; // the start without a Home Assistant address isn't what's tested here

  check(errors.length === 0, `no errors in the page${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  ws.close();
} finally {
  // Wait for Chrome to exit before removing its profile; a leftover temp folder must never fail the run.
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await Promise.race([exited, sleep(5000)]);
  await server.close();

  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    console.warn(`(couldn't remove ${profile})`);
  }
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
