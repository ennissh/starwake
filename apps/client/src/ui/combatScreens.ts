import type { ContentBundle, EncounterResult } from '@starwake/shared';
import { esc } from './help.js';

/** HTML bodies for the arena picker, the crippled choice and the after-action / salvage screen. */
export function arenaPicker(c: ContentBundle): string {
  const items = c.encounters
    .filter((e) => e.id.startsWith('arena-'))
    .map(
      (e) =>
        `<button class="sw-btn" data-act="pick" data-id="${e.id}"><span><b>${esc(e.name)}</b><br/><small>${esc(e.description)}</small></span></button>`,
    )
    .join('');
  return `<p class="sw-meta">Practice fights. Nothing here is kept: damage, drones and salvage reset every time.</p>
    <div class="sw-menu sw-menu--tall">${items}<button class="sw-btn" data-act="cancel">Back</button></div>
    <p class="sw-meta">T target · Y subsystem · fire with Left mouse / Space (Lance in bridge or chase, turret in turret view) ·
    1/2/3 drones · R recall · C cameras (ride a drone) · Shift+J hold to fold out.</p>`;
}

export function crippledBody(): string {
  return `<p>The hull is breached. Drift has stopped and the weapons are offline. WAKE can still get you out.</p>
    <div class="sw-menu">
      <button class="sw-btn sw-btn--primary" data-act="fold"><span><b>Emergency fold</b><br/><small>Escape to the last system you visited. Lose 2–3 random installed components.</small></span></button>
      <button class="sw-btn" data-act="lifeboat"><span><b>Lifeboat</b><br/><small>Wake up at the Waystation with a basic refit. Lose cargo and spare components. +1.5 years on the Caravan Clock.</small></span></button>
    </div>`;
}

const TITLES: Record<string, string> = {
  victory: 'Victory',
  emergencyFold: 'Emergency fold',
  lifeboat: 'Lifeboat',
  ongoing: 'Fight over',
};

export function resultTitle(r: EncounterResult): string {
  return TITLES[r.outcome] ?? 'Fight over';
}

export function resultBody(r: EncounterResult, c: ContentBundle, practice: boolean): string {
  const name = (id: string) => c.components.find((x) => x.id === id)?.name ?? id;
  const counts = new Map<string, number>();
  for (const s of r.salvage) counts.set(s, (counts.get(s) ?? 0) + 1);
  const salvage = counts.size
    ? `<ul class="sw-list">${[...counts].map(([id, n]) => `<li>${esc(name(id))}${n > 1 ? ` ×${n}` : ''}</li>`).join('')}</ul>`
    : '<p class="sw-meta">No usable components in the wreckage.</p>';
  const lost = r.lost.length
    ? `<p>Components lost: ${r.lost.map((l) => esc(name(l.componentId))).join(', ')}</p>`
    : '';
  const drones = Object.entries(r.dronesLost)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ');
  return `<div class="sw-grid2">
      <div><div class="sw-kicker">Result</div>
        <p>Destroyed ${r.destroyed.length}${r.fled.length ? ` · fled ${r.fled.length}` : ''} · hull ${Math.round(r.hullFraction * 100)}% · ${Math.round(r.ticks / 60)} s</p>
        ${drones ? `<p>Drones spent or lost: ${drones}</p>` : ''}${lost}</div>
      <div><div class="sw-kicker">Salvage</div>${salvage}</div>
    </div>
    ${practice ? '<p class="sw-meta">Practice arena: salvage and damage are not kept.</p>' : ''}
    <div class="sw-row"><button class="sw-btn sw-btn--primary" data-act="again">Fight again</button><button class="sw-btn" data-act="title">Back to title</button></div>`;
}
