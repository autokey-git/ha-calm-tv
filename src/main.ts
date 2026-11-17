import './style.css';
import { CalmTv } from './app';
import { startDoorbellOnly } from './doorbell';
import { loadConfig, settings, haPath, demoMode } from './config';
import { loadHome } from './home-data';
import { loadApps } from './apps';
import { wallpapers } from './wallpapers';
import { videos } from './videos';
import { showSetup, SIGN_IN_NEXT } from './setup';
import { ha } from './ha';
import { PHASES, type Phase, type Variants } from './variants';

/** A background's dawn/day/dusk/night versions from calm-tv.json, as full addresses (undefined if none). */
function phaseUrls(b: Partial<Record<Phase, string>>): Variants | undefined {
  const out: Variants = {};

  for (const p of PHASES) {
    const url = b[p];

    if (url) out[p] = haPath(url);
  }

  return Object.keys(out).length ? out : undefined;
}

async function main(): Promise<void> {
  // Everything specific to a home comes from calm-tv.json (see config.ts), or the made-up home in demo mode.
  if (demoMode) (await import('./demo')).startDemo();
  else await loadConfig();

  loadHome();
  loadApps();
  const bg = settings.config.backgrounds;
  bg?.photos?.forEach((p) => wallpapers.push({ name: p.name, url: haPath(p.url), variants: phaseUrls(p), map: p.map }));
  bg?.videos?.forEach((v) => videos.push({ name: v.name, url: haPath(v.url), thumb: v.thumb ? haPath(v.thumb) : '', variants: phaseUrls(v), map: v.map }));

  if (new URLSearchParams(location.search).has('panel')) {
    (await import('./side-panel')).startSidePanel();

    return;
  }

  if (new URLSearchParams(location.search).has('doorbell')) {
    startDoorbellOnly();

    return;
  }

  new CalmTv().start();

  if (!settings.haUrl) {
    showSetup({ canCancel: false });

    return;
  }

  // Just set up (or changed) the address: go straight to Home Assistant's sign-in, unless the
  // saved sign-in already works for it.
  let next = false;

  try { next = !!sessionStorage.getItem(SIGN_IN_NEXT); sessionStorage.removeItem(SIGN_IN_NEXT); } catch { /* ignore */ }

  if (next) {
    const go = () => { if (ha.status === 'signed-out') { next = false; void ha.signIn(); } };

    ha.onStatus(() => { if (next) go(); });
    go();
  }
}

void main();
