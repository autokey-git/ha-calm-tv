// Puts the built app in Home Assistant's www folder (www/calm-tv/), so a dashboard (or any browser) can
// open it from Home Assistant itself: http://<your-ha>/local/calm-tv/index.html?dash
// See docs/dashboard.md.
//
//   HA_URL=http://homeassistant.local:8123 npm run publish:ha
//
// It builds the app (npm run build), re-encodes any clip too big to upload (needs ffmpeg), then
// copies dist/ through Home Assistant's File editor app,
// which must be installed and started. It needs an administrator's long-lived access token: in
// HA_TOKEN, or in the file HA_TOKEN_FILE (default ~/.config/homeassistant/token). Files left over
// from an earlier build are removed from www/calm-tv/assets. Nothing else in www is touched.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const TARGET = '/homeassistant/www/calm-tv';
const EDITOR = 'core_configurator';
/** Just under Home Assistant's 16 MB request limit. */
const MAX_UPLOAD = 15e6;

const haUrl = (process.env.HA_URL ?? '').replace(/\/+$/, '');

if (!/^https?:\/\//.test(haUrl)) {
  console.error('Set HA_URL to your Home Assistant address, e.g. HA_URL=http://homeassistant.local:8123');
  process.exit(1);
}

const token = (process.env.HA_TOKEN ?? readFileSync(process.env.HA_TOKEN_FILE ?? join(homedir(), '.config/homeassistant/token'), 'utf8')).trim();
const auth = { Authorization: `Bearer ${token}` };

// Home Assistant only lets the Supervisor API through its websocket, not plain HTTP.
const ws = new WebSocket(`${haUrl.replace(/^http/, 'ws')}/api/websocket`);
const pending = new Map();
let nextId = 1;

await new Promise((resolve, reject) => {
  ws.onerror = () => reject(new Error(`Couldn't reach ${haUrl}`));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);

    if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
    else if (m.type === 'auth_ok') resolve();
    else if (m.type === 'auth_invalid') reject(new Error('Home Assistant refused the token'));
    else if (m.type === 'result' && pending.has(m.id)) {
      const { ok, fail } = pending.get(m.id);
      pending.delete(m.id);

      if (m.success) ok(m.result);
      else fail(new Error(m.error?.message ?? 'failed'));
    }
  };
});

/** One websocket command; resolves with its result. */
function call(message) {
  const id = nextId++;

  return new Promise((ok, fail) => {
    pending.set(id, { ok, fail });
    ws.send(JSON.stringify({ id, ...message }));
  });
}

/** A call to Home Assistant's Supervisor API (an administrator's token is needed). */
const supervisor = (endpoint, method = 'get') => call({ type: 'supervisor/api', endpoint, method });

const editor = await supervisor(`/addons/${EDITOR}/info`);

if (editor.state !== 'started') throw new Error('Start the File editor app in Home Assistant first (Settings → Apps → File editor).');
const { session } = await supervisor('/ingress/session', 'post');
const base = `${haUrl}${editor.ingress_entry}`.replace(/\/?$/, '/');
const cookie = { ...auth, Cookie: `ingress_session=${session}` };

/** A call to the File editor's own API (through Home Assistant's ingress). */
async function files(path, body) {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: cookie, body });
  const answer = await r.json().catch(() => ({ error: true, message: `${r.status}` }));

  if (answer.error) throw new Error(`${path}: ${answer.message}`);

  return answer;
}

const form = (fields) => new URLSearchParams(fields);
const list = async (dir) => (await files(`api/listdir?path=${encodeURIComponent(dir)}`)).content ?? [];

async function ensureFolder(dir) {
  const parent = dir.slice(0, dir.lastIndexOf('/'));
  const name = dir.slice(dir.lastIndexOf('/') + 1);

  if ((await list(parent)).some((e) => e.name === name && e.type === 'dir')) return;
  await files('api/newfolder', form({ path: parent, name }));
}

/** Every file under `dir`, as paths relative to it with forward slashes. */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);

    return statSync(full).isDirectory() ? walk(full) : [relative(DIST, full).split(sep).join('/')];
  });
}

console.log('Building…');
execFileSync('npm', ['run', '-s', 'build'], { cwd: ROOT, stdio: 'inherit' });

const built = walk(DIST);

// Home Assistant takes at most 16 MB per upload: re-encode bigger clips (H.264 at CRF 26, which
// looks the same on a tablet), as the live demo does. Smaller files are sent as they are.
for (const f of built.filter((f) => f.endsWith('.mp4') && statSync(join(DIST, f)).size > MAX_UPLOAD)) {
  const src = join(DIST, f);
  console.log(`Shrinking ${f.split('/').pop()} (${(statSync(src).size / 1e6).toFixed(1)} MB)…`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${src}.small.mp4`]);
  renameSync(`${src}.small.mp4`, src);

  if (statSync(src).size > MAX_UPLOAD) throw new Error(`${f} is still over 16 MB; shorten or shrink it first.`);
}

const folders = [...new Set(built.map((f) => f.split('/').slice(0, -1).join('/')).filter(Boolean))].sort();
await ensureFolder(TARGET);

for (const f of folders) await ensureFolder(`${TARGET}/${f}`);
let bytes = 0;

for (const f of built) {
  const data = readFileSync(join(DIST, f));
  const dir = `${TARGET}/${f.split('/').slice(0, -1).join('/')}`.replace(/\/$/, '');
  const body = new FormData();
  body.append('path', dir);
  body.append('file', new Blob([data]), f.split('/').pop());
  await files('api/upload', body);
  bytes += data.length;
}

// Old builds' files (their names change with every build) would otherwise pile up.
const fresh = new Set(built);
let removed = 0;

for (const f of folders) {
  for (const e of await list(`${TARGET}/${f}`)) {
    if (e.type === 'file' && !fresh.has(`${f}/${e.name}`)) {
      await files('api/delete', form({ path: `${TARGET}/${f}/${e.name}` }));
      removed++;
    }
  }
}

// Home Assistant tells browsers to keep www files for a month, so a dashboard would keep showing the
// old index.html. Dashboards that show Calm TV (an iframe card on /local/calm-tv/index.html) get a
// new ?v= on its address instead, which makes dashboards load the new version.
const version = Date.now().toString(36);
const updated = [];

for (const d of await call({ type: 'lovelace/dashboards/list' })) {
  if (d.mode !== 'storage') continue;
  const config = await call({ type: 'lovelace/config', url_path: d.url_path }).catch(() => null);
  let changed = false;

  const visit = (node) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') {
      if (node.type === 'iframe' && typeof node.url === 'string' && node.url.startsWith('/local/calm-tv/index.html')) {
        const u = new URL(node.url, haUrl);
        u.searchParams.set('v', version);
        node.url = `${u.pathname}?${u.searchParams.toString().replace(/=(?=&|$)/g, '')}`;
        changed = true;
      }

      Object.values(node).forEach(visit);
    }
  };

  visit(config);

  if (changed) {
    await call({ type: 'lovelace/config/save', url_path: d.url_path, config });
    updated.push(d.title);
  }
}

ws.close();

if (updated.length) console.log(`Updated the Calm TV address in: ${updated.join(', ')}.`);
console.log(`Published ${built.length} files (${(bytes / 1e6).toFixed(1)} MB) to www/calm-tv${removed ? `, removed ${removed} old ones` : ''}.`);
console.log(`Dashboard: ${haUrl}/local/calm-tv/index.html?dash`);
