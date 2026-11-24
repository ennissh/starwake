import { ACTIONS, ACTION_GROUPS, ACTION_IDS, type KeyMap, keyLabel } from '../input/keymap.js';

/** The key help overlay body (F1 / ?): every action with its current keys, grouped. */
export function helpTable(map: KeyMap, extra: { keys: string; label: string }[] = []): string {
  const rows: string[] = [];
  for (const g of ACTION_GROUPS) {
    rows.push(`<tr><th colspan="2">${g}</th></tr>`);
    for (const a of ACTION_IDS.filter((x) => ACTIONS[x].group === g)) {
      const def = ACTIONS[a];
      const keys = map[a].length
        ? map[a].map((b) => `<span class="sw-kbd">${esc(keyLabel(b))}</span>`).join(' ')
        : '<em>unbound</em>';
      const coming = 'comingIn' in def ? ` <small>(${def.comingIn})</small>` : '';
      rows.push(
        `<tr class="${'comingIn' in def ? 'sw-dim' : ''}"><td>${def.label}${coming}</td><td>${keys}</td></tr>`,
      );
    }
    if (g === 'General') {
      for (const e of extra)
        rows.push(`<tr><td>${e.label}</td><td><span class="sw-kbd">${e.keys}</span></td></tr>`);
    }
  }
  return `<table class="sw-table">${rows.join('')}</table>`;
}

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export const MOUSE_HELP = [
  {
    keys: 'Mouse',
    label: 'Steer (virtual joystick) in bridge and chase views; look in orbit and turret views',
  },
  { keys: 'Wheel', label: 'Zoom (orbit view)' },
  { keys: 'Esc', label: 'Pause and release the mouse' },
];
