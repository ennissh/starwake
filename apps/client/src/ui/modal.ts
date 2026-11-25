/** A simple modal overlay: render HTML, route clicks on [data-act] to handlers. */
export class Modal {
  readonly el: HTMLDivElement;
  private handlers: Record<string, (el: HTMLElement) => void> = {};

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'sw-overlay';
    this.el.hidden = true;
    parent.appendChild(this.el);
    // A modal dialog keeps keyboard focus inside itself (Tab and Shift+Tab wrap around).
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || this.el.hidden) return;
      const items = [
        ...this.el.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select, textarea, [href], [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const inside = this.el.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    });
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (t?.dataset.act) this.handlers[t.dataset.act]?.(t);
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Which panel is showing (for callers that toggle a panel with the same key). */
  kind: string | null = null;

  show(
    title: string,
    body: string,
    handlers: Record<string, (el: HTMLElement) => void>,
    opts: { wide?: boolean; kind?: string; closable?: boolean } = {},
  ): void {
    this.handlers = handlers;
    this.kind = opts.kind ?? null;
    const close = opts.closable
      ? '<button class="sw-btn" data-act="close" aria-label="Close">Close (Esc)</button>'
      : '';
    this.el.innerHTML = `<section class="sw-panel sw-dialog ${opts.wide ? 'sw-dialog--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="sw-modal-title">
      <div class="sw-dialog__head"><h2 id="sw-modal-title">${title}</h2>${close}</div><div class="sw-dialog__body">${body}</div></section>`;
    this.el.hidden = false;
    if (!this.el.contains(document.activeElement))
      this.el.querySelector<HTMLElement>('button[data-act]:not([data-act="close"]):not(:disabled)')?.focus();
  }

  /** Replace just the body, keeping title and handlers (no focus jump). */
  update(body: string): void {
    const b = this.el.querySelector('.sw-dialog__body');
    if (b) b.innerHTML = body;
  }

  close(): void {
    this.el.hidden = true;
    this.handlers = {};
    this.kind = null;
  }
}
