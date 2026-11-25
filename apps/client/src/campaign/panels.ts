import {
  type CampaignState,
  type ContentBundle,
  type Readiness,
  RESOURCE_KINDS,
  byId,
  holdFree,
  isBroken,
  itemQty,
  relationLabel,
  system,
} from '@starwake/shared';
import { esc } from '../ui/help.js';

const RES_LABEL: Record<string, string> = {
  ice: 'Ice',
  biomass: 'Biomass',
  ore: 'Ore',
  isotopes: 'Isotopes',
};

/** System report (I, and after a probe): planets, occupants, station services, the hold. */
export function systemBody(s: CampaignState, c: ContentBundle, r: Readiness): string {
  const sys = system(c, s.systemId);
  const known = s.known.includes(sys.id);
  const v = s.visits[sys.id];
  const probeUsed = v?.probedOn === v?.count;
  const parts: string[] = [`<p>${esc(sys.description)}</p>`];
  if (!known) {
    parts.push(`<p class="sw-meta">Unsurveyed. Launch the surveyor probe to see planets, resources and occupants.</p>
      <button class="sw-btn sw-btn--primary" data-act="probe">Launch probe (P)</button>`);
  } else {
    if (!probeUsed) parts.push('<button class="sw-btn" data-act="probe">Re-probe (P)</button>');
    parts.push(
      `<div class="sw-cards">${sys.planets
        .map((p) => {
          const claimed = s.claims.some((x) => x.planetId === p.id);
          const worth = p.habitable || p.resources.length > 0;
          const res = p.resources
            .map(
              (x) =>
                `<span class="sw-chip sw-chip--${x.kind}">${RES_LABEL[x.kind]} ${'●'.repeat(x.yield)}</span>`,
            )
            .join(' ');
          return `<div class="sw-card"><div class="sw-card__head"><b>${esc(p.name)}</b>${p.habitable ? ' <span class="sw-chip sw-chip--hab">habitable</span>' : ''}</div>
            <div class="sw-meta">${p.kind} · ${p.tempK} K · ${esc(p.atmosphere)}</div>
            <div>${res || '<span class="sw-meta">No resources of value</span>'}</div>
            ${claimed ? '<div class="sw-ok">Beacon placed</div>' : worth ? `<button class="sw-btn" data-act="claim" data-id="${p.id}" ${s.beacons > 0 ? '' : 'disabled'}>Place claim beacon</button>` : ''}</div>`;
        })
        .join('')}</div>`,
    );
    if (sys.occupant) {
      const race = byId(c.races, sys.occupant);
      const rel = s.relations[race.id] ?? 0;
      const permit = s.flags.includes(`permit:${race.id}`) || s.treaties.includes(race.id);
      parts.push(`<div class="sw-kicker">Occupant</div><p><b>${esc(race.name)}</b>: ${esc(race.summary)}</p>
        <div class="sw-rel"><span>Relation: <b>${relationLabel(rel, c)}</b> (${rel})</span><div class="sw-meter"><i style="left:${(rel + 100) / 2}%"></i></div></div>
        ${!permit ? `<p class="sw-warn">Placing a beacon here without their permission is a hostile act.</p>` : ''}
        ${s.treaties.includes(race.id) ? '<p class="sw-ok">Treaty signed.</p>' : ''}
        <div class="sw-row"><button class="sw-btn sw-btn--primary" data-act="hail" data-id="${race.id}">Hail (V)</button>
        ${sys.baseEncounter && !isBroken(s, race.id) ? '<button class="sw-btn sw-btn--danger" data-act="attack">Attack their base</button>' : ''}</div>`);
    }
  }
  if (sys.station === 'waystation') {
    const cores = itemQty(s, 'data-core');
    parts.push(`<div class="sw-kicker">Waystation</div>
      <div class="sw-row"><button class="sw-btn sw-btn--primary" data-act="dock">Dock and refit (${c.rules.clock.refitYears} yr)</button>
      <span class="sw-meta">Refuel, repair hull and components, restock beacons and drone frames, fabricate Provender.</span></div>
      <div class="sw-meta">Mk I components for Data Cores (you have ${cores}):</div>
      <div class="sw-row">${c.rules.waystation.sells
        .map(
          (o) =>
            `<button class="sw-btn" data-act="buy" data-id="${o.componentId}" ${cores >= o.price ? '' : 'disabled'}>${esc(byId(c.components, o.componentId).name)} · ${o.price}</button>`,
        )
        .join('')}</div>`);
  }
  if (s.hull < 1)
    parts.push(
      `<div class="sw-row"><button class="sw-btn" data-act="repair">Repair in place (+${Math.round(c.rules.repairInPlaceHull * 100)}% hull, ${c.rules.clock.repairYears} yr)</button></div>`,
    );
  if (r.canSignal)
    parts.push('<button class="sw-btn sw-btn--primary" data-act="signal">Signal the Long Caravan</button>');
  parts.push(holdBody(s, c));
  parts.push(
    `<div class="sw-kicker">Log</div><ul class="sw-log">${s.log
      .slice(-6)
      .reverse()
      .map((l) => `<li><span class="sw-meta">${l.clock.toFixed(2)} y</span> ${esc(l.text)}</li>`)
      .join('')}</ul>`,
  );
  return parts.join('');
}

export function holdBody(s: CampaignState, c: ContentBundle): string {
  const rows = s.hold
    .map((h, i) => {
      const label =
        h.type === 'component'
          ? `${esc(byId(c.components, h.componentId).name)}${h.condition < 100 ? ` (${Math.round(h.condition)}%)` : ''}`
          : `${esc(byId(c.items, h.itemId).name)} ×${h.qty}`;
      return `<li>${label} <button class="sw-link" data-act="drop" data-id="${i}" aria-label="Jettison ${label}">jettison</button></li>`;
    })
    .join('');
  return `<div class="sw-kicker">Hold (${c.rules.start.hold - holdFree(s, c)}/${c.rules.start.hold} slots)</div><ul class="sw-list">${rows || '<li class="sw-meta">Empty</li>'}</ul>`;
}

/** Colony Readiness (H). */
export function readinessBody(s: CampaignState, c: ContentBundle, r: Readiness): string {
  const mark = (ok: boolean) => `<span class="${ok ? 'sw-ok' : 'sw-warn'}">${ok ? '✓' : '✗'}</span>`;
  const cradle = r.cradle.planetId
    ? `${byId(c.systems, r.cradle.systemId!).planets.find((p) => p.id === r.cradle.planetId)!.name} in ${byId(c.systems, r.cradle.systemId!).name}`
    : 'No habitable world claimed yet';
  const quotas = RESOURCE_KINDS.map((k) => {
    const q = r.quotas[k];
    return `<div class="sw-quota">${mark(q.ok)} ${RES_LABEL[k]} <div class="sw-meter sw-meter--fill"><i style="width:${Math.min(100, (q.have / Math.max(1, q.need)) * 100)}%"></i></div> ${q.have}/${q.need}</div>`;
  }).join('');
  const threats = r.safety.threats.map((t) => byId(c.races, t).name).join(', ');
  return `<div class="sw-ready">
      <div>${mark(r.cradle.ok)} <b>Cradle world</b>: ${esc(cradle)}</div>
      <div><b>Resource quotas</b>${quotas}</div>
      <div>${mark(r.safety.ok)} <b>Safety</b>: ${!r.cradle.ok ? 'needs a Cradle first' : r.safety.ok ? `no hostile race within ${c.rules.readiness.safetyHops} jumps` : `hostile within ${c.rules.readiness.safetyHops} jumps: ${esc(threats)} (treaty, tribute or force)`}</div>
      <div>${mark(r.clock.ok)} <b>Caravan Clock</b>: ${s.clock.toFixed(2)} years left</div>
    </div>
    ${r.canSignal ? '<button class="sw-btn sw-btn--primary" data-act="signal">Signal the Long Caravan</button>' : `<p class="sw-meta">When all four are met, signal the Caravan from the Cradle system.</p>`}`;
}

export function salvageBody(s: CampaignState, c: ContentBundle): string {
  const free = holdFree(s, c);
  return `<p>Components recovered from the wrecks. ${free} free hold slot${free === 1 ? '' : 's'}.</p>
    <ul class="sw-list sw-checks">${s.salvageOffer
      .map(
        (id, i) =>
          `<li><label><input type="checkbox" data-salvage="${i}" ${i < free ? 'checked' : ''}/> ${esc(byId(c.components, id).name)}</label></li>`,
      )
      .join('')}</ul>
    <div class="sw-row"><button class="sw-btn sw-btn--primary" data-act="take">Take selected</button><button class="sw-btn" data-act="leave">Leave it all</button></div>`;
}

export function endingBody(s: CampaignState, c: ContentBundle): string {
  const won = s.outcome === 'won';
  const destroyed = Object.entries(s.stats.destroyed)
    .map(([r, n]) => `${n} ${byId(c.races, r).name}`)
    .join(', ');
  return `<p>${won ? 'The Long Caravan is on its way to its new home.' : 'The Caravan Clock ran out before the colony was ready.'}</p>
    <dl class="sw-dl"><dt>Time left</dt><dd>${s.clock.toFixed(2)} years</dd><dt>Jumps</dt><dd>${s.stats.jumps} (${s.stats.parsecs.toFixed(1)} pc)</dd>
    <dt>Claims</dt><dd>${s.claims.length} held, ${s.stats.claimsLost} lost</dd><dt>Fights</dt><dd>${s.stats.fights}${destroyed ? ` · destroyed ${destroyed}` : ''}</dd>
    <dt>Treaties</dt><dd>${s.treaties.length || 'none'}</dd></dl>
    <p class="sw-meta">The full ending summary arrives in M6.</p>
    <button class="sw-btn sw-btn--primary" data-act="title">Back to title</button>`;
}
