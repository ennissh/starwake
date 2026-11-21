import type { FlightInput, FlightState } from '../flight.js';
import type { FlightStats } from '../flight.js';
import type { Vec3 } from '../math.js';
import type { HullClass, SystemId } from '../../schemas/content.js';
import type { HitBlock } from './rules.js';

export type Side = 'player' | 'hostile';
export type DroneType = 'hornet' | 'lance' | 'ram';

export interface SubState {
  id: string;
  kind: 'emitter' | 'turret' | 'engine';
  offset: Vec3;
  radius: number;
  hp: number;
  maxHp: number;
  armor: number;
  weaponId: string | null;
  cooldown: number;
  alive: boolean;
}

export interface Mount {
  weaponId: string;
  offset: Vec3;
  cooldown: number;
}

export interface AiMemory {
  mode: 'approach' | 'breakoff' | 'evade' | 'retreat' | 'standoff' | 'hold';
  timer: number;
  targetId: string | null;
  jink: Vec3;
  calledHelp: boolean;
  lastHitT: number;
  launchTimer: number;
}

export interface Ent {
  id: string;
  kind: 'starwake' | 'hull' | 'drone';
  side: Side;
  name: string;
  hullId: string | null;
  hullClass: HullClass | null;
  droneType: DroneType | null;
  f: FlightState;
  stats: FlightStats | null;
  hp: number;
  maxHp: number;
  armor: number;
  radius: number;
  subs: SubState[];
  mounts: Mount[];
  alive: boolean;
  fled: boolean;
  ai: AiMemory;
  /** Drones: seconds left; target and subsystem for one-use drones; recall flag. */
  life: number;
  targetId: string | null;
  targetSubId: string | null;
  docking: boolean;
}

export interface Bolt {
  id: number;
  weaponId: string;
  side: Side;
  ownerId: string;
  pos: Vec3;
  vel: Vec3;
  ttl: number;
}

export interface InstalledComponent {
  system: SystemId;
  slot: number;
  componentId: string;
  /** 0..100 */
  condition: number;
}

export type TurretCommand = { mode: 'wake' } | { mode: 'manual'; aim: Vec3; fire: boolean };

/** Everything the player does in one tick. */
export interface PlayerCommand {
  flight: FlightInput;
  fireLance: boolean;
  turret: TurretCommand;
  targetId: string | null;
  subsystemId: string | null;
  launch: DroneType | null;
  recall: boolean;
  /** The Hornet the player is riding, flying it and firing its gun. */
  drone: { id: string; flight: FlightInput; fire: boolean } | null;
  emergencyFold: boolean;
}

export type CombatEvent =
  | { t: 'lance'; from: Vec3; to: Vec3; hitId: string | null; blocked: HitBlock }
  | { t: 'shot'; weaponId: string; side: Side; from: Vec3 }
  | { t: 'hit'; targetId: string; subId: string | null; weaponId: string; damage: number; blocked: HitBlock; pos: Vec3 }
  | { t: 'playerHit'; region: 'fore' | 'aft'; absorbed: number; hull: number; pos: Vec3 }
  | { t: 'componentWorn'; system: SystemId; slot: number; componentId: string; condition: number }
  | { t: 'componentDestroyed'; system: SystemId; slot: number; componentId: string }
  | { t: 'subDestroyed'; targetId: string; subId: string; pos: Vec3 }
  | { t: 'destroyed'; id: string; pos: Vec3; radius: number }
  | { t: 'fled'; id: string }
  | { t: 'launch'; id: string; drone: DroneType }
  | { t: 'launchFailed'; reason: string }
  | { t: 'docked'; id: string }
  | { t: 'detonate'; id: string; pos: Vec3 }
  | { t: 'reinforcements'; count: number; by: string }
  | { t: 'crippled' }
  | { t: 'over'; outcome: Outcome };

export type Outcome = 'ongoing' | 'victory' | 'emergencyFold' | 'lifeboat';

export interface EncounterResult {
  outcome: Outcome;
  ticks: number;
  destroyed: { id: string; hullId: string }[];
  fled: { id: string; hullId: string }[];
  /** Component ids recovered from destroyed hulls (offered on the salvage screen). */
  salvage: string[];
  /** Installed components after the fight (condition changed by hull damage). */
  installed: InstalledComponent[];
  /** Components lost (destroyed by damage, or by an emergency fold). */
  lost: InstalledComponent[];
  hullFraction: number;
  framesLeft: number;
  dronesLost: Record<DroneType, number>;
}
