import { decodeConfig, demoMode, readConfigFile, settings, storedConfigText } from './config';
import { saveConfigText } from './config-store';
import { ha } from './ha';
import { visualSetup, type SetupJson } from './setup-visual';
import { child, find } from './dom';

// Settings → Home Assistant → Home setup → Edit: the home's setup as text, checked as you type,
// saved straight into the copy kept in Home Assistant (config-store.ts). For a keyboard: the
// dashboard or a browser, signed in as a Home Assistant admin. Every TV and dashboard then starts
// again with it, this page included.

/** Kinds of Home Assistant entity ids worth checking against the entities that exist. */
const DOMAINS = new Set([
  'light', 'switch', 'cover', 'climate', 'lock', 'camera', 'binary_sensor', 'sensor', 'media_player',
  'scene', 'weather', 'calendar', 'input_boolean', 'fan', 'script', 'button', 'vacuum', 'person', 'select',
]);

/** Entity ids in the setup that Home Assistant doesn't have (typos, renamed devices). */
function unknownEntities(json: unknown): string[] {
  const found = new Set<string>();
  const walk = (x: unknown) => {
    if (typeof x === 'string') {
      const m = /^([a-z_]+)\.[a-z0-9_]+$/.exec(x);

      if (m && DOMAINS.has(m[1]) && !ha.entities[x]) found.add(x);
    } else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };

  walk(json);

  return [...found];
}

/** A short summary of a setup that decodes. */
function summary(text: string): string {
  const c = decodeConfig(text);
  const rooms = c.rooms?.length ? `${c.rooms.length} room${c.rooms.length === 1 ? '' : 's'}` : 'rooms from your areas';
  const apps = c.apps?.length ? ` · ${c.apps.length} apps` : '';

  return `Looks good · ${rooms}${apps}`;
}

/** The setup to start from: the copy kept in Home Assistant, else calm-tv.json, else an empty one. */
async function startingText(): Promise<{ text: string; from: string }> {
  // Demo mode's made-up home (nothing is saved anywhere).
  if (demoMode) return { text: `${JSON.stringify(settings.config, null, 2)}\n`, from: 'the demo’s setup' };

  const stored = storedConfigText();

  if (stored) return { text: JSON.stringify(JSON.parse(stored), null, 2), from: 'the copy kept in Home Assistant' };
  const file = await readConfigFile();

  if (file.text) return { text: file.text, from: `calm-tv.json from ${file.source}` };

  return { text: '{}\n', from: 'an empty setup (rooms come from your areas)' };
}

export async function showSetupEditor(): Promise<void> {
  if (document.querySelector('.cfgedit')) return;
  const { text, from } = await startingText();
  const canSave = ha.isAdmin && ha.status === 'connected';

  const el = document.createElement('div');
  el.className = 'setup cfgedit';
  el.innerHTML = `
    <div class="setup-card cfgedit-card">
      <div class="cfgedit-head">
        <div>
          <div class="setup-title">Edit the home setup</div>
          <div class="setup-text"></div>
        </div>
        <div class="cfgedit-buttons">
          <button class="cfgedit-btn" data-act="format">Tidy</button>
          <button class="cfgedit-btn" data-act="close">Close</button>
          <button class="cfgedit-btn primary" data-act="save">Save</button>
        </div>
      </div>
      <div class="cfgedit-tabs">
        <button data-tab="visual">Screens &amp; rooms</button>
        <button data-tab="text">Text</button>
      </div>
      <div class="cfgedit-visual"></div>
      <textarea class="cfgedit-text" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
      <div class="setup-msg cfgedit-msg"></div>
      <div class="setup-hint">The format is in docs/configuration.md · Tab indents · ${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl'}+S saves · Esc closes</div>
    </div>`;
  (document.querySelector('#stage') ?? document.body).appendChild(el);

  const area = find(el, 'textarea', HTMLTextAreaElement);
  const msg = child(el, '.cfgedit-msg');
  const save = find(el, '[data-act="save"]', HTMLButtonElement);
  child(el, '.setup-text').textContent = canSave
    ? `Starting from ${from}. Saving keeps it in Home Assistant, and every TV and dashboard follows.`
    : `Showing ${from}. ${ha.status === 'connected' ? 'Only a Home Assistant admin can save it.' : 'Connect to Home Assistant to save it.'}`;
  area.value = text;
  save.disabled = !canSave;
  let dirty = false;
  let saving = false;
  let discardAt = 0;

  /** Checks the text: an error saves nothing; unknown entities are only a warning. */
  const check = (): boolean => {
    msg.classList.remove('bad', 'warn');
    save.disabled = true;

    try {
      const s = summary(area.value);
      const unknown = unknownEntities(JSON.parse(area.value));

      if (unknown.length && Object.keys(ha.entities).length) {
        msg.classList.add('warn');
        msg.textContent = `${s} · Home Assistant has no ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? ` and ${unknown.length - 3} more` : ''}`;
      } else {
        msg.textContent = s;
      }

      save.disabled = !canSave || saving;

      return true;
    } catch (e) {
      msg.classList.add('bad');
      msg.textContent = e instanceof Error ? e.message : 'unreadable';

      return false;
    }
  };

  let timer = 0;
  area.addEventListener('input', () => {
    dirty = true;
    discardAt = 0;
    clearTimeout(timer);
    timer = window.setTimeout(check, 300);
  });

  const close = () => {
    if (dirty && Date.now() > discardAt) {
      discardAt = Date.now() + 4000;
      msg.classList.add('warn');
      msg.textContent = 'Not saved · Close again to throw the changes away';

      return;
    }

    document.removeEventListener('keydown', onKey, true);
    el.remove();
  };

  const doSave = () => {
    if (!canSave || saving || !check()) return;
    saving = true;
    save.disabled = true;
    msg.textContent = 'Saving in Home Assistant…';
    saveConfigText(area.value)
      .then(() => {
        dirty = false;
        // Home Assistant sends the new copy back, and Calm TV starts again with it (config-store.ts).
        msg.textContent = 'Saved · starting again with it…';

        // Saved unchanged: nothing comes back, so nothing restarts.
        window.setTimeout(() => { if (document.body.contains(el)) close(); }, 4000);
      })
      .catch((e: unknown) => {
        msg.classList.add('bad');
        msg.textContent = `Didn’t save: ${e instanceof Error ? e.message : 'it didn’t work'}`;
        save.disabled = false;
      })
      .finally(() => { saving = false; });
  };

  // The two tabs change the same setup: the visual one edits the parsed text and writes it back.
  let setup: SetupJson = {};
  const visualEl = child(el, '.cfgedit-visual');
  const drawVisual = visualSetup(visualEl, () => setup, () => {
    area.value = `${JSON.stringify(setup, null, 2)}\n`;
    dirty = true;
    discardAt = 0;
    check();
  });
  const showTab = (tab: 'visual' | 'text') => {
    if (tab === 'visual') {
      if (!check()) return; // fix the text first: the message says what's wrong
      setup = JSON.parse(area.value) as SetupJson;
      drawVisual();
    }

    el.classList.toggle('tab-visual', tab === 'visual');
    el.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));

    if (tab === 'text') area.focus();
  };

  el.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab;

    if (tab === 'visual' || tab === 'text') showTab(tab);
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;

    if (act === 'close') close();
    else if (act === 'save') doSave();
    else if (act === 'format' && check()) {
      area.value = `${JSON.stringify(JSON.parse(area.value), null, 2)}\n`;
      dirty = true;
    }
  });

  // Capture phase: the screens behind never see these keys while this is open.
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();

    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key.toLowerCase() === 's' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      doSave();
    } else if (e.key === 'Tab' && document.activeElement === area) {
      e.preventDefault();
      area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
    }
  };

  document.addEventListener('keydown', onKey, true);
  showTab(check() ? 'visual' : 'text');
  area.setSelectionRange(0, 0);
}
