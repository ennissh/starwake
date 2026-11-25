import { type CampaignState, type ContentBundle, byId, relationLabel } from '@starwake/shared';
import { esc } from '../ui/help.js';

/**
 * The Codex (K, PLAN §1.10, §5.9): every fact learned, by race, system and mechanic, so nothing
 * depends on a printed manual. Built from the campaign's codex ids and content; read-only.
 */
export type CodexTab = 'races' | 'systems' | 'knowledge' | 'mechanics';

export function codexBody(s: CampaignState, c: ContentBundle, tab: CodexTab): string {
  const has = (id: string) => s.codex.includes(id);
  const tabs: [CodexTab, string][] = [
    ['races', 'Races'],
    ['systems', 'Systems'],
    ['knowledge', 'What we were told'],
    ['mechanics', 'How things work'],
  ];
  const head = `<div class="sw-tabs" role="tablist">${tabs
    .map(
      ([id, label]) =>
        `<button class="sw-tab" role="tab" aria-selected="${id === tab}" data-act="tab" data-id="${id}">${label}</button>`,
    )
    .join('')}</div>`;

  let body: string;
  if (tab === 'races') {
    const met = c.races.filter((r) => has(`race:${r.id}`) || (s.stats.destroyed[r.id] ?? 0) > 0);
    body = met.length
      ? met
          .map((r) => {
            const rel = s.relations[r.id] ?? 0;
            const mem = s.conversationMemory[r.id]?.summary;
            const status = [
              s.treaties.includes(r.id) ? 'treaty' : '',
              s.flags.includes(`passage:${r.id}`) ? 'safe passage' : '',
              s.flags.includes(`permit:${r.id}`) ? 'claim permit' : '',
              s.flags.includes(`${r.id}_broken`) ? 'broken by force' : '',
            ].filter(Boolean);
            return `<article class="cx-entry"><h3>${esc(r.name)}</h3><p>${esc(r.persona.voice)}</p>
              <p class="sw-meta">${esc(r.persona.appearance)} Tell: ${esc(r.persona.tell.toLowerCase())}</p>
              <p>Relation: <b>${relationLabel(rel, c)}</b> (${rel})${status.length ? ` · ${status.join(' · ')}` : ''}. Destroyed: ${s.stats.destroyed[r.id] ?? 0}.</p>
              ${mem ? `<p><i>They seemed to think:</i> ${esc(mem)}</p>` : ''}</article>`;
          })
          .join('')
      : '<p class="sw-meta">You have not met anyone yet. Hail a system\'s occupants with V.</p>';
  } else if (tab === 'systems') {
    const known = c.systems.filter((x) => has(`system:${x.id}`));
    body = known.length
      ? known
          .map((x) => {
            const planets = x.planets
              .filter((p) => has(`planet:${p.id}`))
              .map(
                (p) =>
                  `<li><b>${esc(p.name)}</b> (${p.kind}, ${p.tempK} K, ${esc(p.atmosphere)})${p.habitable ? ' · <b>habitable</b>' : ''}${p.resources.length ? ` · ${p.resources.map((r) => `${r.kind} ${r.yield}`).join(', ')}` : ''}${s.claims.some((cl) => cl.planetId === p.id) ? ' · <i>claimed</i>' : ''}</li>`,
              )
              .join('');
            return `<article class="cx-entry"><h3>${esc(x.name)}</h3><p>${esc(x.description)}</p>${x.occupant ? `<p class="sw-meta">Home of the ${esc(byId(c.races, x.occupant).name)}.</p>` : ''}<ul>${planets}</ul></article>`;
          })
          .join('')
      : '<p class="sw-meta">Probe a system (P) to record it here.</p>';
  } else if (tab === 'knowledge') {
    const items = c.races.flatMap((r) =>
      r.knowledge.filter((k) => has(`knowledge:${k.id}`)).map((k) => ({ r, k })),
    );
    body = items.length
      ? items
          .map(
            ({ r, k }) =>
              `<article class="cx-entry"><h3>${esc(k.codexTitle)}</h3><p>${esc(k.text)}</p><p class="sw-meta">Told by the ${esc(r.name)}.</p></article>`,
          )
          .join('')
      : '<p class="sw-meta">Nothing yet. Ask the peoples of the cluster what they know.</p>';
  } else {
    body = c.codex.mechanics
      .map((m) => `<article class="cx-entry"><h3>${esc(m.title)}</h3><p>${esc(m.text)}</p></article>`)
      .join('');
  }
  return `${head}<div class="cx" role="tabpanel" tabindex="0" aria-label="Codex entries">${body}</div>`;
}
