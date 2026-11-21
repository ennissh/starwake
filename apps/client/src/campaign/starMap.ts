import {
  type CampaignState,
  type ContentBundle,
  byId,
  jumpCost,
  laneBetween,
  parsecsBetween,
  relationLabel,
} from '@starwake/shared';
import { esc } from '../ui/help.js';

/**
 * Star map (Tab, PLAN §1.7): the Shoal in 3D, rotated by dragging, drawn as crisp SVG. Shows lanes
 * with their length, known/unknown systems, occupants once probed, and the jump cost from here.
 */
export interface MapView {
  yaw: number;
  pitch: number;
  selected: string | null;
}

export function mapBody(s: CampaignState, c: ContentBundle, v: MapView, ship: { range: number }): string {
  const W = 560;
  const H = 420;
  const cx = c.systems.reduce((a, x) => a + x.position.x, 0) / c.systems.length;
  const cy = c.systems.reduce((a, x) => a + x.position.y, 0) / c.systems.length;
  const cz = c.systems.reduce((a, x) => a + x.position.z, 0) / c.systems.length;
  const rot = (p: { x: number; y: number; z: number }) => {
    const x = p.x - cx;
    const y = p.y - cy;
    const z = p.z - cz;
    const x1 = x * Math.cos(v.yaw) - z * Math.sin(v.yaw);
    const z1 = x * Math.sin(v.yaw) + z * Math.cos(v.yaw);
    const y2 = y * Math.cos(v.pitch) - z1 * Math.sin(v.pitch);
    const z2 = y * Math.sin(v.pitch) + z1 * Math.cos(v.pitch);
    return { x: x1, y: y2, depth: z2 };
  };
  // Fit the rotated cluster into the view, leaving room for labels on the right.
  const raw = c.systems.map((sys) => rot(sys.position));
  const span = (k: 'x' | 'y') =>
    Math.max(1e-6, Math.max(...raw.map((r) => r[k])) - Math.min(...raw.map((r) => r[k])));
  const scale = Math.min((W - 190) / span('x'), (H - 70) / span('y'));
  const mid = (k: 'x' | 'y') => (Math.max(...raw.map((r) => r[k])) + Math.min(...raw.map((r) => r[k]))) / 2;
  const mx = mid('x');
  const my = mid('y');
  const proj = (p: { x: number; y: number; z: number }) => {
    const r = rot(p);
    return { x: (W - 150) / 2 + (r.x - mx) * scale, y: H / 2 - (r.y - my) * scale, depth: r.depth };
  };
  const pts = new Map(c.systems.map((sys) => [sys.id, proj(sys.position)]));
  const lanes = c.lanes
    .map((l) => {
      const a = pts.get(l.a)!;
      const b = pts.get(l.b)!;
      const pc = parsecsBetween(c, l.a, l.b);
      const reach = pc <= ship.range + 1e-9;
      const mine = l.a === s.systemId || l.b === s.systemId;
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="map-lane ${mine ? 'map-lane--here' : ''} ${reach ? '' : 'map-lane--far'}"/>
        <text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 4}" class="map-lane-label">${pc.toFixed(1)} pc</text>`;
    })
    .join('');
  const nodes = [...c.systems]
    .sort((a, b) => pts.get(b.id)!.depth - pts.get(a.id)!.depth)
    .map((sys) => {
      const p = pts.get(sys.id)!;
      const known = s.known.includes(sys.id);
      const here = sys.id === s.systemId;
      const sel = sys.id === v.selected;
      const label = known && sys.occupant ? `${sys.name} · ${byId(c.races, sys.occupant).name}` : sys.name;
      return `<g class="map-node ${known ? '' : 'map-node--unknown'} ${here ? 'map-node--here' : ''} ${sel ? 'map-node--sel' : ''}" data-act="select" data-id="${sys.id}" tabindex="0" role="button" aria-label="${esc(sys.name)}">
        <circle cx="${p.x}" cy="${p.y}" r="${here ? 11 : 8}" fill="${sys.starColor}"/>
        <circle cx="${p.x}" cy="${p.y}" r="13" class="map-hit"/>
        ${here ? `<circle cx="${p.x}" cy="${p.y}" r="17" class="map-here"/>` : ''}
        ${sel ? `<circle cx="${p.x}" cy="${p.y}" r="22" class="map-sel"/>` : ''}
        <text x="${p.x + 14}" y="${p.y + 4}">${esc(label)}${known ? '' : ' ?'}</text></g>`;
    })
    .join('');
  return `<div class="cmap">
      <svg class="cmap__svg" id="cmap-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="Star map of the Shoal">${lanes}${nodes}</svg>
      <div class="cmap__side">${details(s, c, v.selected)}</div>
    </div>
    <p class="sw-meta">Drag to rotate. Click a system. J jumps along a lane. Dashed lanes are beyond your Fold Drive's range (${ship.range.toFixed(2)} pc).</p>`;
}

function details(s: CampaignState, c: ContentBundle, id: string | null): string {
  if (!id) return '<p class="sw-meta">Select a system.</p>';
  const sys = c.systems.find((x) => x.id === id)!;
  const known = s.known.includes(sys.id);
  const here = sys.id === s.systemId;
  const lane = laneBetween(c, s.systemId, sys.id);
  let jump: string;
  if (here) jump = '<p class="sw-meta">You are here.</p>';
  else if (!lane) jump = '<p class="sw-meta">No fold lane from here.</p>';
  else {
    const cost = jumpCost(parsecsBetween(c, s.systemId, sys.id), s.installed, c);
    const fuelOk = cost.fuel <= s.fuel + 1e-9;
    const why = !cost.inRange ? 'Beyond range' : !fuelOk ? 'Not enough fold mass' : '';
    jump = `<dl class="sw-dl"><dt>Distance</dt><dd>${cost.parsecs.toFixed(2)} pc</dd><dt>Fold mass</dt><dd>${cost.fuel.toFixed(1)} of ${s.fuel.toFixed(1)}</dd><dt>Time</dt><dd>${cost.years.toFixed(2)} years</dd></dl>
      ${lane.ambush && known ? '<p class="sw-warn">Ambushes reported on this lane.</p>' : ''}
      <button class="sw-btn sw-btn--primary" data-act="jump" data-id="${sys.id}" ${why ? 'disabled' : ''}>Fold jump (J)</button>${why ? ` <span class="sw-warn">${why}</span>` : ''}`;
  }
  const occ =
    known && sys.occupant
      ? `<p>${esc(byId(c.races, sys.occupant).name)}: <b>${relationLabel(s.relations[sys.occupant] ?? 0, c)}</b></p>`
      : known
        ? '<p class="sw-meta">Unoccupied.</p>'
        : '<p class="sw-meta">Unknown. Probe it when you get there.</p>';
  const claims = s.claims.filter((x) => x.systemId === sys.id).length;
  return `<h3>${esc(sys.name)}</h3><div class="sw-meta">${esc(sys.starType)}${known ? ` · ${sys.planets.length} planet${sys.planets.length === 1 ? '' : 's'}` : ''}${claims ? ` · ${claims} claimed` : ''}</div>${occ}${jump}`;
}
