import { describe, expect, it } from 'vitest';
import {
  ACTION_IDS,
  bindingFromKey,
  bindingIndex,
  checkBinding,
  clearBinding,
  defaultKeyMap,
  keyLabel,
  rebind,
  resolvePress,
  sanitizeKeyMap,
} from '../src/input/keymap.js';

const ev = (
  code: string,
  mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {},
) => ({
  code,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe('keymap defaults', () => {
  it('match the README controls table', () => {
    const m = defaultKeyMap();
    expect(m.rollLeft).toEqual(['KeyQ']);
    expect(m.throttleFull).toEqual(['Shift+KeyW']);
    expect(m.fire).toEqual(['Mouse0', 'Space']);
    expect(m.cycleCamera).toEqual(['KeyC']);
    expect(m.starMap).toEqual(['Tab']);
    expect(m.help).toEqual(['F1', 'Shift+Slash']);
  });

  it('bind no key twice and only valid keys', () => {
    const all = ACTION_IDS.flatMap((a) => defaultKeyMap()[a]);
    expect(new Set(all).size).toBe(all.length);
    for (const b of all) expect(checkBinding(b)).toEqual({ ok: true });
  });
});

describe('reserved keys', () => {
  it.each(['Escape', 'F5', 'F11', 'F12', 'ControlLeft', 'AltLeft', 'MetaLeft', 'Shift+F11'])(
    '%s cannot be bound',
    (b) => {
      expect(checkBinding(b).ok).toBe(false);
    },
  );
  it('Ctrl/Alt/Meta combinations never become bindings', () => {
    expect(bindingFromKey(ev('KeyW', { ctrlKey: true }))).toBeNull();
    expect(bindingFromKey(ev('KeyT', { altKey: true }))).toBeNull();
    expect(bindingFromKey(ev('KeyN', { metaKey: true }))).toBeNull();
    expect(bindingFromKey(ev('KeyW', { shiftKey: true }))).toBe('Shift+KeyW');
    expect(bindingFromKey(ev('ShiftLeft', { shiftKey: true }))).toBe('ShiftLeft');
  });
});

describe('rebind', () => {
  it('moves a binding and reports where it was stolen from', () => {
    const { map, stolenFrom } = rebind(defaultKeyMap(), 'cycleCamera', 0, 'KeyQ');
    expect(map.cycleCamera[0]).toBe('KeyQ');
    expect(map.rollLeft).toEqual([]);
    expect(stolenFrom).toEqual(['rollLeft']);
  });

  it('adds a secondary binding, and replacing a slot replaces only that key', () => {
    let m = rebind(defaultKeyMap(), 'cycleCamera', 1, 'KeyG').map;
    expect(m.cycleCamera).toEqual(['KeyC', 'KeyG']);
    m = rebind(m, 'cycleCamera', 0, 'KeyB').map;
    expect(m.cycleCamera).toEqual(['KeyB', 'KeyG']);
    m = rebind(m, 'cycleCamera', 0, 'KeyG').map;
    expect(m.cycleCamera).toEqual(['KeyG']);
  });

  it('rejects reserved keys', () => {
    expect(() => rebind(defaultKeyMap(), 'fire', 0, 'F5')).toThrow(/reserved/);
  });

  it('does not mutate the input map', () => {
    const m = defaultKeyMap();
    rebind(m, 'cycleCamera', 0, 'KeyQ');
    expect(m.rollLeft).toEqual(['KeyQ']);
  });

  it('clearBinding removes a slot', () => {
    expect(clearBinding(defaultKeyMap(), 'fire', 0).fire).toEqual(['Space']);
  });
});

describe('resolvePress', () => {
  const idx = bindingIndex(defaultKeyMap());
  it('prefers the exact Shift binding', () => {
    expect(resolvePress(idx, 'Shift+KeyW')).toBe('throttleFull');
    expect(resolvePress(idx, 'Shift+KeyT')).toBe('targetPrev');
  });
  it('falls back to the plain key with Shift held', () => {
    expect(resolvePress(idx, 'Shift+KeyC')).toBe('cycleCamera');
  });
  it('unbound keys resolve to nothing', () => {
    expect(resolvePress(idx, 'KeyO')).toBeUndefined();
  });
});

describe('sanitizeKeyMap (stored per profile)', () => {
  it('drops unknown actions, invalid and duplicate bindings, fills missing actions with defaults', () => {
    const m = sanitizeKeyMap({ cycleCamera: ['KeyQ', 'F5', 'KeyG', 'KeyH'], bogus: ['KeyZ'] });
    expect(m.cycleCamera).toEqual(['KeyQ', 'KeyG']);
    expect(m.rollLeft).toEqual([]); // the stored choice beats rollLeft's default
    expect(m.fire).toEqual(['Mouse0', 'Space']);
  });
  it('between two stored actions, the first in action order keeps a duplicate', () => {
    const m = sanitizeKeyMap({ cycleCamera: ['KeyQ'], rollLeft: ['KeyQ'] });
    expect(m.rollLeft).toEqual(['KeyQ']);
    expect(m.cycleCamera).toEqual([]);
  });
  it('survives junk', () => {
    expect(sanitizeKeyMap('nope')).toEqual(defaultKeyMap());
    expect(sanitizeKeyMap(null)).toEqual(defaultKeyMap());
  });
});

describe('labels', () => {
  it.each([
    ['KeyW', 'W'],
    ['Shift+KeyW', 'Shift+W'],
    ['Shift+Slash', '?'],
    ['ArrowUp', '↑'],
    ['Digit1', '1'],
    ['Mouse0', 'Left mouse'],
    ['F1', 'F1'],
  ])('%s → %s', (b, l) => expect(keyLabel(b)).toBe(l));
});

describe('keymap: advisor placeholders', () => {
  it('the shared advisor test knows every client action (keep advisorKeys.ts in sync)', async () => {
    const { ACTION_KEY_PLACEHOLDER } = await import('../../../packages/shared/test/advisorKeys.js');
    expect([...ACTION_KEY_PLACEHOLDER].sort()).toEqual([...ACTION_IDS].sort());
  });
  it('playtest keys: L mouse steering, G face target', () => {
    const m = defaultKeyMap();
    expect(m.mouseSteer).toContain('KeyL');
    expect(m.faceTarget).toContain('KeyG');
  });
});
