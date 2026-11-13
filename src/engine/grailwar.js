// Holy Grail War: seven masters, one per class, battling in rounds until one claims the Grail.
// Pure and deterministic (seeded), shared by the browser (vs CPU) and the server (online rooms).
//
// Flow:  draft (random order, each master claims a class)
//        -> servants (everyone secretly picks a servant of their class)
//        -> rounds of simultaneous battles between random pairs (an odd master sits out and
//           is guaranteed a battle next round; nobody meets the same master again until they
//           have fought every other surviving master)
//        -> losers lose team HP: 10%, then 20%, 30%, 40% (a draw counts as a loss for both)
//        -> with two masters left, a final battle: the winner takes the Grail outright.
//           A final draw costs both their next loss and they fight again.

import { ROSTER } from '../data/servants.js';

export const WAR_CLASSES = ['Saber', 'Archer', 'Lancer', 'Rider', 'Caster', 'Assassin', 'Berserker'];
export const WAR_SIZE = 7;
export const LOSS_PENALTY = [10, 20, 30, 40];

const CPU_NAMES = ['Kiritsugu', 'Kirei', 'Tokiomi', 'Kayneth', 'Waver', 'Ryuunosuke', 'Ilya', 'Shinji', 'Sola-Ui', 'Bazett', 'Fiore', 'Darnic', 'Shirou', 'Rin', 'Sakura'];

// mulberry32 on a numeric state kept inside the war, so the war is plain JSON
function rand(war) {
  let t = (war.rng = (war.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pickOne = (war, list) => list[Math.floor(rand(war) * list.length)];
function shuffle(war, list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand(war) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export class WarError extends Error {}

export const classServants = cls => ROSTER.filter(s => s.class === cls).sort((a, b) => a.name.localeCompare(b.name));

// participants: [{ id, name, cpu }] for the humans; CPUs fill the rest of the 7 seats.
export function createWar(humans, { seed = Math.floor(Math.random() * 2 ** 32) } = {}) {
  if (humans.length > WAR_SIZE) throw new WarError(`A Holy Grail War has ${WAR_SIZE} masters at most.`);
  const war = { rng: seed >>> 0, stage: 'draft', masters: [], draftOrder: [], draftTurn: 0, round: 0, fights: [], sitter: null, log: [], winner: null, finalCount: 0 };
  const taken = new Set(humans.map(h => h.name));
  const cpuNames = shuffle(war, CPU_NAMES.filter(n => !taken.has(n)));
  const masters = [...humans.map(h => ({ id: h.id, name: h.name, cpu: false }))];
  for (let k = 0; masters.length < WAR_SIZE; k++) masters.push({ id: `cpu${k + 1}`, name: cpuNames[k], cpu: true });
  war.masters = masters.map(m => ({ ...m, cls: null, servant: null, hp: 100, losses: 0, out: false, place: null, cycle: [], sat: false, record: { w: 0, l: 0, d: 0 } }));
  war.draftOrder = shuffle(war, war.masters.map(m => m.id));
  autoPlay(war);
  return war;
}

export const master = (war, id) => war.masters.find(m => m.id === id);
export const alive = war => war.masters.filter(m => !m.out);
export const takenClasses = war => war.masters.map(m => m.cls).filter(Boolean);
export const currentDrafter = war => (war.stage === 'draft' ? war.draftOrder[war.draftTurn] : null);

export function draftClass(war, id, cls) {
  if (war.stage !== 'draft') throw new WarError('The class draft is over.');
  if (currentDrafter(war) !== id) throw new WarError("It's not your turn to choose a class.");
  if (!WAR_CLASSES.includes(cls)) throw new WarError('Choose Saber, Archer, Lancer, Rider, Caster, Assassin or Berserker.');
  if (takenClasses(war).includes(cls)) throw new WarError(`${cls} is already taken.`);
  master(war, id).cls = cls;
  war.log.push({ type: 'draft', id, cls });
  war.draftTurn++;
  if (war.draftTurn >= war.draftOrder.length) war.stage = 'servants';
  autoPlay(war);
}

export function pickServant(war, id, servantId) {
  if (war.stage !== 'servants') throw new WarError('Not choosing servants right now.');
  const m = master(war, id);
  if (!m) throw new WarError('You are not a master in this war.');
  const s = ROSTER.find(x => x.id === servantId);
  if (!s || s.class !== m.cls) throw new WarError(`Choose a ${m.cls} servant.`);
  m.servant = servantId;
  if (war.masters.every(x => x.servant)) startRound(war);
}

// CPUs act at once whenever it's their move (draft picks, then servants).
function autoPlay(war) {
  while (war.stage === 'draft') {
    const id = currentDrafter(war), m = master(war, id);
    if (!m.cpu) break;
    const left = WAR_CLASSES.filter(c => !takenClasses(war).includes(c));
    m.cls = pickOne(war, left);
    war.log.push({ type: 'draft', id, cls: m.cls });
    war.draftTurn++;
    if (war.draftTurn >= war.draftOrder.length) war.stage = 'servants';
  }
  if (war.stage === 'servants') {
    for (const m of war.masters) if (m.cpu && !m.servant) m.servant = pickOne(war, classServants(m.cls)).id;
    if (war.masters.every(x => x.servant)) startRound(war);
  }
}

// ----- pairings -----

// Who A may still face this cycle: once A has met every other survivor, their cycle starts over.
function cycleOf(war, m) {
  const others = alive(war).filter(x => x.id !== m.id).map(x => x.id);
  if (others.every(o => m.cycle.includes(o))) m.cycle = [];   // met everyone: the cycle starts over
  return m.cycle.filter(o => others.includes(o));
}

// Every way to split the survivors into pairs (plus one sitter when the count is odd).
function matchings(ids) {
  if (ids.length === 0) return [[]];
  if (ids.length % 2 === 1) {
    const out = [];
    for (let s = 0; s < ids.length; s++) {
      const rest = ids.filter((_, k) => k !== s);
      for (const m of matchings(rest)) out.push([...m, [ids[s]]]);
    }
    return out;
  }
  const [a, ...rest] = ids, out = [];
  for (let k = 0; k < rest.length; k++) {
    const b = rest[k], others = rest.filter((_, j) => j !== k);
    for (const m of matchings(others)) out.push([[a, b], ...m]);
  }
  return out;
}

export function startRound(war) {
  const live = alive(war);
  if (live.length <= 1) return finish(war, live[0]?.id ?? null);
  war.round++;
  if (live.length === 2) {
    war.stage = 'final';
    war.finalCount++;
    war.sitter = null;
    war.fights = [{ id: `r${war.round}f1`, a: live[0].id, b: live[1].id, final: true, result: undefined }];
    return;
  }
  war.stage = 'round';
  const ids = live.map(m => m.id);
  const cycles = Object.fromEntries(live.map(m => [m.id, new Set(cycleOf(war, m))]));
  const sat = new Set(live.filter(m => m.sat).map(m => m.id));
  const all = matchings(shuffle(war, ids));
  const scoreOf = (mt, cyc, mustFight) => {
    let score = 0;
    for (const g of mt) {
      if (g.length === 1) { if (mustFight.has(g[0])) score += 1000; continue; }
      if (cyc[g[0]].has(g[1]) || cyc[g[1]].has(g[0])) score += 10;
    }
    return score;
  };
  const advance = (mt, cyc) => {
    const next = {};
    for (const id of ids) next[id] = new Set(cyc[id]);
    for (const g of mt) if (g.length === 2) { next[g[0]].add(g[1]); next[g[1]].add(g[0]); }
    for (const id of ids) if (next[id].size >= ids.length - 1) next[id] = new Set();
    return next;
  };
  // Look ahead: prefer a pairing that still leaves a clean schedule (no early rematch,
  // no master sitting twice running) for the next few rounds, so we don't paint ourselves
  // into a corner where a rematch becomes forced.
  let budget = 40000;
  const feasible = (cyc, mustFight, depth) => {
    if (depth === 0 || ids.every(id => cyc[id].size === 0)) return true;
    for (const mt of all) {
      if (--budget < 0) return false;
      if (scoreOf(mt, cyc, mustFight)) continue;
      const sitter = mt.find(g => g.length === 1)?.[0];
      if (feasible(advance(mt, cyc), new Set(sitter ? [sitter] : []), depth - 1)) return true;
    }
    return false;
  };
  const depth = Math.min(4, Math.max(...ids.map(id => ids.length - 1 - cycles[id].size)) - 1);
  // Ranking: hard rules first (sitter fights, no early rematch), then a clean schedule ahead,
  // then avoiding a back-to-back rematch with last round's opponent.
  const lastOf = Object.fromEntries(live.map(m => [m.id, m.lastOpp ?? null]));
  let best = null, bestKey = null;
  for (const mt of all) {
    const hard = scoreOf(mt, cycles, sat);
    if (bestKey && hard > bestKey[0]) continue;
    const back = mt.filter(g => g.length === 2 && lastOf[g[0]] === g[1]).length;
    let ahead = 1;
    if (hard === 0 && budget > 0) {
      const sitter = mt.find(g => g.length === 1)?.[0];
      ahead = feasible(advance(mt, cycles), new Set(sitter ? [sitter] : []), depth) ? 0 : 1;
    }
    const key = [hard, ahead, back];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) { best = mt; bestKey = key; }
    if (key.every(v => v === 0)) break;
  }
  const pairs = best.filter(g => g.length === 2);
  war.sitter = best.find(g => g.length === 1)?.[0] ?? null;
  for (const m of live) m.sat = m.id === war.sitter;
  war.fights = pairs.map(([a, b], k) => ({ id: `r${war.round}f${k + 1}`, a, b, final: false, result: undefined }));
}

// ----- results -----

function takeLoss(war, m, why) {
  const pen = LOSS_PENALTY[Math.min(m.losses, LOSS_PENALTY.length - 1)];
  m.losses++;
  m.hp = Math.max(0, m.hp - pen);
  war.log.push({ type: 'loss', id: m.id, pen, hp: m.hp, why });
  return pen;
}

function eliminate(war, ids) {
  const left = alive(war).length;
  for (const id of ids) { const m = master(war, id); m.out = true; m.place = left - ids.length + 1; war.log.push({ type: 'out', id }); }
}

// winner: the master id who won, or null for a draw.
export function recordResult(war, fightId, winner) {
  const f = war.fights.find(x => x.id === fightId);
  if (!f) throw new WarError('Unknown battle.');
  if (f.result !== undefined) return;
  f.result = winner ?? null;
  const A = master(war, f.a), B = master(war, f.b);
  A.cycle.push(B.id); B.cycle.push(A.id);
  A.lastOpp = B.id; B.lastOpp = A.id;
  if (winner === A.id) { A.record.w++; B.record.l++; } else if (winner === B.id) { B.record.w++; A.record.l++; } else { A.record.d++; B.record.d++; }
  if (f.final) return recordFinal(war, f, A, B, winner);
  const losers = winner == null ? [A, B] : [winner === A.id ? B : A];
  for (const m of losers) takeLoss(war, m, winner == null ? 'draw' : 'loss');
  if (war.fights.every(x => x.result !== undefined)) {
    eliminate(war, war.masters.filter(m => !m.out && m.hp <= 0).map(m => m.id));
    war.stage = alive(war).length <= 1 ? 'over' : 'results';
    if (war.stage === 'over') finish(war, alive(war)[0]?.id ?? null);
  }
}

function recordFinal(war, f, A, B, winner) {
  if (winner != null) {
    const loser = winner === A.id ? B : A;
    loser.hp = 0;
    eliminate(war, [loser.id]);
    return finish(war, winner);
  }
  // A draw in the final: both pay their next loss and fight again, until one runs out of team HP.
  const before = [A.hp, B.hp];
  takeLoss(war, A, 'final draw'); takeLoss(war, B, 'final draw');
  if (A.hp <= 0 && B.hp <= 0) {
    // both ran dry together: the one who had more team HP left before this battle takes it; if even, again
    if (before[0] !== before[1]) {
      const w = before[0] > before[1] ? A : B, l = w === A ? B : A;
      w.hp = Math.max(w.hp, 1);
      eliminate(war, [l.id]);
      return finish(war, w.id);
    }
    A.hp = before[0]; B.hp = before[1];
  } else if (A.hp <= 0 || B.hp <= 0) {
    const l = A.hp <= 0 ? A : B;
    eliminate(war, [l.id]);
    return finish(war, (l === A ? B : A).id);
  }
  war.stage = 'results';   // results screen, then the final is fought again
}

function finish(war, winnerId) {
  war.stage = 'over';
  war.winner = winnerId;
  const w = winnerId && master(war, winnerId);
  if (w) w.place = 1;
}

// After the results screen: the next round (or the next final battle).
export function nextRound(war) {
  if (war.stage !== 'results') throw new WarError('The round is not over yet.');
  startRound(war);
}

// The fight a master is in this round, if any.
export const fightOf = (war, id) => war.fights.find(f => f.a === id || f.b === id) ?? null;

// A human master left: a CPU takes over their seat (and acts at once if it's their move).
export function cpuTakeover(war, id) {
  const m = master(war, id);
  if (!m || m.cpu) return;
  m.cpu = true;
  autoPlay(war);
}
