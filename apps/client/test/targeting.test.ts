import { describe, expect, it } from 'vitest';
import { cycleSubsystem, cycleTarget, validTarget } from '../src/combat/targeting.js';

const list = [
  { id: 'far', distance: 3000 },
  { id: 'near', distance: 500 },
  { id: 'mid', distance: 1500 },
];

describe('targeting', () => {
  it('T starts at the nearest and walks outward, wrapping', () => {
    expect(cycleTarget(list, null, 1)).toBe('near');
    expect(cycleTarget(list, 'near', 1)).toBe('mid');
    expect(cycleTarget(list, 'far', 1)).toBe('near');
  });
  it('Shift+T walks back', () => {
    expect(cycleTarget(list, null, -1)).toBe('far');
    expect(cycleTarget(list, 'near', -1)).toBe('far');
  });
  it('nothing to target', () => {
    expect(cycleTarget([], 'x', 1)).toBeNull();
  });
  it('Y cycles live subsystems, then the whole ship', () => {
    const subs = [
      { id: 'a', alive: true },
      { id: 'b', alive: false },
      { id: 'c', alive: true },
    ];
    expect(cycleSubsystem(subs, null)).toBe('a');
    expect(cycleSubsystem(subs, 'a')).toBe('c');
    expect(cycleSubsystem(subs, 'c')).toBeNull();
    expect(cycleSubsystem([], null)).toBeNull();
  });
  it('drops a dead target', () => {
    expect(validTarget(list, 'gone')).toBeNull();
    expect(validTarget(list, 'mid')).toBe('mid');
  });
});
