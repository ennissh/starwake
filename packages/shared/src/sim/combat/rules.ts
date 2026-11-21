import type { Weapon } from '../../schemas/content.js';

/**
 * The armour rule (PLAN §1.5): damage applies only if the weapon's penetration is at least the
 * armour of the part it hits. Shield emitters additionally block beam (Spinal Lance) damage to
 * every part of their ship while any emitter is alive.
 */
export function penetrates(penetration: number, armor: number): boolean {
  return penetration >= armor;
}

export type HitBlock = 'armor' | 'emitters' | null;

export interface HitCheck {
  weapon: Pick<Weapon, 'kind' | 'penetration'>;
  armor: number;
  emittersAlive: boolean;
}

/** Why a hit does nothing, or null if it does damage. */
export function hitBlockedBy(h: HitCheck): HitBlock {
  if (h.weapon.kind === 'beam' && h.emittersAlive) return 'emitters';
  if (!penetrates(h.weapon.penetration, h.armor)) return 'armor';
  return null;
}
