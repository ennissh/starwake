/**
 * Key bindings (PLAN §2.6): rebindable, stored per profile. A binding is a KeyboardEvent.code,
 * optionally prefixed "Shift+", or "Mouse<button>". Only Shift may modify: Ctrl/Alt/Meta combos and
 * browser-reserved keys can never be bound.
 */
export type Binding = string;

export const ACTION_GROUPS = ['Flight', 'Combat', 'Views', 'Ship', 'General'] as const;
export type ActionGroup = (typeof ACTION_GROUPS)[number];

export interface ActionDef {
  label: string;
  group: ActionGroup;
  /** Default bindings (primary, optional secondary). */
  defaults: Binding[];
  /** Held (continuous) rather than pressed (edge). Held actions ignore Shift. */
  held?: boolean;
  /** The milestone that makes it work, if not yet built (shown dimmed in help). */
  comingIn?: string;
}

export const ACTIONS = {
  pitchUp: { label: 'Pitch up', group: 'Flight', defaults: ['ArrowDown'], held: true },
  pitchDown: { label: 'Pitch down', group: 'Flight', defaults: ['ArrowUp'], held: true },
  yawLeft: { label: 'Yaw left', group: 'Flight', defaults: ['ArrowLeft'], held: true },
  yawRight: { label: 'Yaw right', group: 'Flight', defaults: ['ArrowRight'], held: true },
  rollLeft: { label: 'Roll left', group: 'Flight', defaults: ['KeyQ'], held: true },
  rollRight: { label: 'Roll right', group: 'Flight', defaults: ['KeyE'], held: true },
  throttleUp: { label: 'Throttle up', group: 'Flight', defaults: ['KeyW'], held: true },
  throttleDown: { label: 'Throttle down', group: 'Flight', defaults: ['KeyS'], held: true },
  throttleFull: { label: 'Full throttle', group: 'Flight', defaults: ['Shift+KeyW'] },
  throttleStop: { label: 'Stop', group: 'Flight', defaults: ['KeyX'] },
  matchSpeed: { label: 'Match target speed', group: 'Flight', defaults: ['KeyM'] },
  flightAssist: { label: 'Flight assist on/off (drift)', group: 'Flight', defaults: ['KeyZ'] },
  fire: {
    label: 'Fire selected weapon',
    group: 'Combat',
    defaults: ['Mouse0', 'Space'],
    held: true,
  },
  targetNext: { label: 'Next target', group: 'Combat', defaults: ['KeyT'] },
  targetPrev: { label: 'Previous target', group: 'Combat', defaults: ['Shift+KeyT'] },
  targetSubsystem: { label: 'Target subsystem', group: 'Combat', defaults: ['KeyY'] },
  droneHornet: { label: 'Launch Hornet drone', group: 'Combat', defaults: ['Digit1'] },
  droneLance: { label: 'Launch Lance drone', group: 'Combat', defaults: ['Digit2'] },
  droneRam: { label: 'Launch Ram drone', group: 'Combat', defaults: ['Digit3'] },
  recallDrones: { label: 'Recall drones', group: 'Combat', defaults: ['KeyR'] },
  cycleCamera: { label: 'Cycle camera', group: 'Views', defaults: ['KeyC'] },
  starMap: { label: 'Star map', group: 'Ship', defaults: ['Tab'] },
  systemReport: { label: 'System report and services', group: 'Ship', defaults: ['KeyI'] },
  engineRoom: { label: 'Engine room', group: 'Ship', defaults: ['KeyF'], comingIn: 'M4' },
  colony: { label: 'Colony readiness', group: 'Ship', defaults: ['KeyH'] },
  codex: { label: 'Codex', group: 'Ship', defaults: ['KeyK'], comingIn: 'M6' },
  probe: { label: 'Probe system', group: 'Ship', defaults: ['KeyP'] },
  hail: { label: 'Hail ship or base', group: 'Ship', defaults: ['KeyV'], comingIn: 'M5' },
  jump: { label: 'Fold jump (from star map)', group: 'Ship', defaults: ['KeyJ'] },
  emergencyFold: {
    label: 'Emergency fold (hold 1 s)',
    group: 'Ship',
    defaults: ['Shift+KeyJ'],
  },
  help: { label: 'Key help', group: 'General', defaults: ['F1', 'Shift+Slash'] },
  perf: { label: 'Performance overlay', group: 'General', defaults: ['Backquote'] },
} as const satisfies Record<string, ActionDef>;

export type Action = keyof typeof ACTIONS;
export const ACTION_IDS = Object.keys(ACTIONS) as Action[];
export const MAX_BINDINGS = 2;

export type KeyMap = Record<Action, Binding[]>;

/** Keys that can never be bound: Esc is pause; the rest belong to the browser or OS. */
const RESERVED = new Set([
  'Escape',
  'F5',
  'F11',
  'F12',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'ShiftLeft',
  'ShiftRight',
  'OSLeft',
  'OSRight',
  'ContextMenu',
  'CapsLock',
  'NumLock',
  'PrintScreen',
]);

export function defaultKeyMap(): KeyMap {
  const m = {} as KeyMap;
  for (const a of ACTION_IDS) m[a] = [...ACTIONS[a].defaults];
  return m;
}

export type BindingCheck = { ok: true } | { ok: false; reason: string };

export function checkBinding(b: Binding): BindingCheck {
  if (/^Mouse[0-4]$/.test(b)) return { ok: true };
  const code = b.startsWith('Shift+') ? b.slice(6) : b;
  if (!/^[A-Za-z0-9]+$/.test(code)) return { ok: false, reason: 'Not a key' };
  if (RESERVED.has(code)) return { ok: false, reason: `${keyLabel(code)} is reserved` };
  return { ok: true };
}

/** Build a binding from a key event; null for events that can't be bindings (Ctrl/Alt/Meta held). */
export function bindingFromKey(e: {
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): Binding | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  if (!e.code) return null;
  return e.shiftKey && !e.code.startsWith('Shift') ? `Shift+${e.code}` : e.code;
}

export interface RebindResult {
  map: KeyMap;
  /** Actions that lost this binding because it moved to the new action. */
  stolenFrom: Action[];
}

/** Set binding slot `slot` of `action`. Any other action using the same binding loses it. */
export function rebind(map: KeyMap, action: Action, slot: number, binding: Binding): RebindResult {
  const check = checkBinding(binding);
  if (!check.ok) throw new Error(check.reason);
  if (slot < 0 || slot >= MAX_BINDINGS) throw new Error(`slot must be 0..${MAX_BINDINGS - 1}`);
  const next = cloneMap(map);
  const stolenFrom: Action[] = [];
  for (const a of ACTION_IDS) {
    if (a === action) continue;
    if (next[a].includes(binding)) {
      next[a] = next[a].filter((b) => b !== binding);
      stolenFrom.push(a);
    }
  }
  // Replace the key in that slot (or append if the slot is empty).
  const own = next[action].filter((b) => b !== binding);
  if (slot < own.length) own[slot] = binding;
  else own.push(binding);
  next[action] = own.slice(0, MAX_BINDINGS);
  return { map: next, stolenFrom };
}

export function clearBinding(map: KeyMap, action: Action, slot: number): KeyMap {
  const next = cloneMap(map);
  next[action] = next[action].filter((_, i) => i !== slot);
  return next;
}

/** Merge a stored map over the defaults: unknown actions and invalid bindings are dropped. */
export function sanitizeKeyMap(stored: unknown): KeyMap {
  const m = defaultKeyMap();
  if (!stored || typeof stored !== 'object') return m;
  const src = stored as Record<string, unknown>;
  const explicit = new Set<Action>();
  for (const a of ACTION_IDS) {
    const v = src[a];
    if (!Array.isArray(v)) continue;
    explicit.add(a);
    m[a] = v.filter((b): b is string => typeof b === 'string' && checkBinding(b).ok).slice(0, MAX_BINDINGS);
  }
  // A binding belongs to one action: stored choices beat defaults, then ACTION_IDS order decides.
  const seen = new Set<Binding>();
  const order = [...ACTION_IDS.filter((a) => explicit.has(a)), ...ACTION_IDS.filter((a) => !explicit.has(a))];
  for (const a of order) {
    m[a] = m[a].filter((b) => (seen.has(b) ? false : (seen.add(b), true)));
  }
  return m;
}

/** Index from binding to action for event dispatch. */
export function bindingIndex(map: KeyMap): Map<Binding, Action> {
  const idx = new Map<Binding, Action>();
  for (const a of ACTION_IDS) for (const b of map[a]) idx.set(b, a);
  return idx;
}

/**
 * Resolve a pressed binding to an action: exact match first ("Shift+KeyW" → throttleFull), then
 * the unshifted key (Shift held while pressing a plain-bound key still works).
 */
export function resolvePress(idx: Map<Binding, Action>, binding: Binding): Action | undefined {
  return idx.get(binding) ?? (binding.startsWith('Shift+') ? idx.get(binding.slice(6)) : undefined);
}

const NAMED: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Backquote: '`',
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Mouse0: 'Left mouse',
  Mouse1: 'Middle mouse',
  Mouse2: 'Right mouse',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
};
const SHIFTED: Record<string, string> = { Slash: '?', Digit1: '!', Backquote: '~' };

export function keyLabel(b: Binding): string {
  if (b.startsWith('Shift+')) {
    const code = b.slice(6);
    return SHIFTED[code] ?? `Shift+${keyLabel(code)}`;
  }
  if (NAMED[b]) return NAMED[b];
  if (b.startsWith('Key')) return b.slice(3);
  if (b.startsWith('Digit')) return b.slice(5);
  if (b.startsWith('Numpad')) return `Num ${b.slice(6)}`;
  return b;
}

function cloneMap(m: KeyMap): KeyMap {
  const c = {} as KeyMap;
  for (const a of ACTION_IDS) c[a] = [...(m[a] ?? [])];
  return c;
}
