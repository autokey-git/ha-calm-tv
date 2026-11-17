import { find } from './dom';
import { guessMaUrl, ma, maSettings } from './music-assistant';

/**
 * "Connect to Music Assistant": the server's address and a long-lived token, for the Music
 * panel's full queue. Opened from Settings → Home Assistant → Music Assistant. Typing a long token with the remote is slow: the Google TV remote in the Google
 * Home app on a phone can paste it, and so can adb (adb shell input text '<token>').
 */
export function showMaSetup(onClose?: () => void): void {
  if (document.querySelector('.setup')) return;
  const saved = maSettings();
  const el = document.createElement('div');
  el.className = 'setup ma-setup';
  el.innerHTML = `
    <div class="setup-card">
      <div class="setup-title">Connect to Music Assistant</div>
      <div class="setup-text">For the Music panel’s full queue. Everything else already works through Home Assistant.</div>
      <div class="setup-label">Address</div>
      <input class="setup-input ma-url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="http://192.168.1.20:8095" />
      <div class="setup-label">Token <span>· Music Assistant → Settings → Profile → create a long-lived token</span></div>
      <input class="setup-input ma-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="Paste it from your phone’s Google TV remote" />
      <div class="setup-msg"></div>
      <div class="setup-hint">↑ ↓ to move · OK on the token to connect · empty address + OK to turn it off · Back to cancel</div>
    </div>`;
  (document.querySelector('#stage') ?? document.body).appendChild(el);
  const urlIn = find(el, '.ma-url', HTMLInputElement);
  const tokenIn = find(el, '.ma-token', HTMLInputElement);
  const msg = find(el, '.setup-msg', HTMLElement);
  urlIn.value = saved.url || guessMaUrl() || 'http://';
  tokenIn.value = saved.token;
  let busy = false;

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    onClose?.();
  };

  const focus = (input: HTMLInputElement) => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };

  const connect = async () => {
    if (busy) return;
    busy = true;
    const turnOff = !urlIn.value.trim() || urlIn.value.trim() === 'http://';
    msg.textContent = turnOff ? '' : 'Connecting…';
    const problem = await ma.save(turnOff ? '' : urlIn.value, tokenIn.value);
    busy = false;

    if (problem) {
      msg.textContent = problem;

      return;
    }

    msg.textContent = turnOff ? 'Turned off' : 'Connected';
    window.setTimeout(close, 700);
  };

  // Capture phase: the screens behind never see these keys while this is open.
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    const onToken = document.activeElement === tokenIn;

    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' && !onToken) {
      e.preventDefault();
      focus(tokenIn);
    } else if (e.key === 'ArrowUp' && onToken) {
      e.preventDefault();
      focus(urlIn);
    } else if (e.key === 'Enter') {
      e.preventDefault();

      if (!onToken && urlIn.value.trim() && urlIn.value.trim() !== 'http://') focus(tokenIn);
      else void connect();
    }
  };

  document.addEventListener('keydown', onKey, true);
  focus(saved.url ? tokenIn : urlIn);
}
