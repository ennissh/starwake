import { esc } from './help.js';

/**
 * The intro (M6, PLAN §5.2): WAKE explains the premise in a few captions. Enter, Space or a click
 * moves on; Esc or "Skip" ends it. Resolves when it's over. Text comes from content (codex.json).
 */
export function playIntro(parent: HTMLElement, lines: string[]): Promise<void> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sw-overlay sw-intro';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Introduction');
    parent.appendChild(el);
    let i = 0;
    const done = () => {
      window.removeEventListener('keydown', onKey, true);
      el.remove();
      resolve();
    };
    const render = () => {
      el.innerHTML = `<div class="sw-intro__card"><div class="sw-kicker">WAKE · ${i + 1}/${lines.length}</div>
        <p class="sw-intro__line" aria-live="polite">${esc(lines[i]!)}</p>
        <div class="sw-row"><button class="sw-btn sw-btn--primary" data-intro="next">${i + 1 < lines.length ? 'Next (Enter)' : 'Begin'}</button>
        <button class="sw-btn" data-intro="skip">Skip (Esc)</button></div></div>`;
      el.querySelector<HTMLElement>('[data-intro="next"]')?.focus();
    };
    const next = () => (++i >= lines.length ? done() : render());
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        done();
      } else if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        e.stopImmediatePropagation();
        next();
      }
    };
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-intro]');
      if (b?.dataset.intro === 'skip') done();
      else next();
    });
    window.addEventListener('keydown', onKey, true);
    render();
  });
}
