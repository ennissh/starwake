/** A simple modal overlay: render HTML, route clicks on [data-act] to handlers. */
export class Modal {
  readonly el: HTMLDivElement;
  private handlers: Record<string, (el: HTMLElement) => void> = {};

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'sw-overlay';
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (t?.dataset.act) this.handlers[t.dataset.act]?.(t);
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  show(title: string, body: string, handlers: Record<string, (el: HTMLElement) => void>): void {
    this.handlers = handlers;
    this.el.innerHTML = `<section class="sw-panel sw-dialog" role="dialog" aria-modal="true" aria-labelledby="sw-modal-title">
      <div class="sw-dialog__head"><h2 id="sw-modal-title">${title}</h2></div>${body}</section>`;
    this.el.hidden = false;
    this.el.querySelector<HTMLElement>('[data-act]')?.focus();
  }

  close(): void {
    this.el.hidden = true;
    this.handlers = {};
  }
}
