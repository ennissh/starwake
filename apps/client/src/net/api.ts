import {
  type ApiError,
  type CampaignAction,
  type CampaignEvent,
  type CampaignState,
  type CommandLog,
  type ContentBundle,
  type EncounterResult,
  type InstalledComponent,
  type Readiness,
  type Roster,
  ContentBundleSchema,
  Health,
} from '@starwake/shared';

/** Typed calls to the Starwake server. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await r.json().catch(() => ({}))) as unknown;
  if (!r.ok) {
    const e = json as Partial<ApiError>;
    throw new ApiFailure(r.status, e.code ?? 'HTTP', e.error ?? `HTTP ${r.status}`);
  }
  return json as T;
}

export async function getHealth(): Promise<Health> {
  return Health.parse(await call('GET', '/healthz'));
}

export async function getContent(): Promise<ContentBundle> {
  return ContentBundleSchema.parse(await call('GET', '/api/content'));
}

export interface ProfileSummary {
  id: string;
  name: string;
  createdAt: string;
}
export const listProfiles = () => call<ProfileSummary[]>('GET', '/api/profiles');
export const createProfile = (name: string) => call<ProfileSummary>('POST', '/api/profiles', { name });
export const getProfile = (id: string) =>
  call<ProfileSummary & { settings: unknown }>('GET', `/api/profiles/${id}`);
export const putSettings = (id: string, settings: unknown) =>
  call<{ ok: true }>('PUT', `/api/profiles/${id}/settings`, { settings });

export interface SaveMeta {
  profile: string;
  slot: 'auto' | '1' | '2' | '3';
  savedAt: string;
  systemName: string;
  clock: number;
  outcome: CampaignState['outcome'];
}
export interface SaveView {
  id: string;
  meta: SaveMeta;
  state: CampaignState;
  readiness: Readiness;
  ship: { range: number; fuelPerParsec: number };
}
export interface ActionView extends SaveView {
  events: CampaignEvent[];
}

export const listSaves = (profile: string) =>
  call<{ id: string; meta: SaveMeta }[]>('GET', `/api/saves?profile=${encodeURIComponent(profile)}`);
export const newSave = (profile: string, slot: SaveMeta['slot'], copyFrom?: string) =>
  call<SaveView>('POST', '/api/saves', { profile, slot, ...(copyFrom ? { copyFrom } : {}) });
export const getSave = (id: string) => call<SaveView>('GET', `/api/saves/${id}`);
export const act = (id: string, action: CampaignAction) =>
  call<ActionView>('POST', `/api/campaign/${id}/action`, { action });

export interface EncounterStart {
  encounterId: string;
  reason: 'ambush' | 'patrol' | 'attack';
  raceId: string;
  name: string;
  options: {
    seed: string;
    roster: Roster;
    distance: number;
    installed: InstalledComponent[];
    frames: number;
    hullFraction: number;
  };
}
export const startEncounter = (saveId: string) =>
  call<EncounterStart>('POST', '/api/encounters/start', { saveId });
export const postEncounterResult = (
  encounterId: string,
  saveId: string,
  result: EncounterResult,
  log: CommandLog,
) =>
  call<ActionView & { verification: 'verified' | 'plausible' }>(
    'POST',
    `/api/encounters/${encounterId}/result`,
    { saveId, result, log },
  );

export interface AdvisorReply {
  advisorId: string;
  topicId: string | null;
  text: string;
  handoff: boolean;
  suggestions: string[];
}

/** Ask WAKE or a council member (read-only; answers from the save when one is given). */
export async function askAdvisor(
  saveId: string | null,
  advisor: string,
  question: string,
): Promise<AdvisorReply> {
  return call('POST', '/api/advisor/ask', { ...(saveId ? { saveId } : {}), advisor, question });
}
