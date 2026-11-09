// Balance simulator: plays every matchup N times with a simple heuristic bot
// and prints match length, NP frequency, draw rate and matchup win rates.
// Usage: node tools/simulate.js [gamesPerPairing=2000] [seed=1] [--out reports/]
//   --out writes winrates.csv, matchups.csv and run.csv for the win-rate dashboard.

import { createMatch, resolveTurn, getLegalActions } from '../src/engine/engine.js';
import { ROSTER } from '../src/data/servants.js';
import { TUNING as T } from '../src/engine/constants.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
const N = Number(args[0] ?? 2000);
let seed = Number(args[1] ?? 1);
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = arr => arr[Math.floor(rand() * arr.length)];
const weighted = w => { // {key: weight}
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (const [k, v] of Object.entries(w)) if ((r -= v) <= 0) return k;
  return Object.keys(w)[0];
};

// Heuristic bot — deliberately simple, a stand-in for "reasonable player".
function bot(state, i) {
  const me = state.players[i], foe = state.players[1 - i];
  const legal = getLegalActions(state, i);
  const servant = state.servants[i];
  let seal = null;
  if (legal.seals.includes('heal') && me.hp / me.maxHp < 0.3 && rand() < 0.7) seal = 'heal';
  else if (legal.seals.includes('grandOrder') && me.np < 40 && foe.hp / foe.maxHp < 0.45 && rand() < 0.3) seal = 'grandOrder';
  else if (legal.seals.includes('empower') && rand() < 0.04) seal = 'empower';

  if (legal.np && rand() < 0.75) return { main: { type: 'np' }, seal: seal === 'grandOrder' ? null : seal };
  // expect enemy NP? try a defensive skill
  if (foe.np >= T.npMax && legal.skills.length && rand() < 0.5) {
    const def = servant.skills.find(s => legal.skills.includes(s.id) &&
      s.effects.some(e => ['damageCut', 'invincible'].includes(e.type)));
    if (def) return { main: { type: 'skill', skillId: def.id }, seal };
  }
  if (legal.skills.length && rand() < 0.3) {
    const id = pick(legal.skills);
    const sk = servant.skills.find(x => x.id === id);
    return { main: { type: 'skill', skillId: sk.id, ...(sk.options ? { option: pick(sk.options).id } : {}) }, seal };
  }
  const w = { quick: 1, arts: 1, buster: 1 };
  if (me.favoredCard) w[me.favoredCard] += 0.4;
  if (me.ap < 3) w.quick += 0.6;
  if (me.np >= 60) w.arts += 0.5;
  return { main: { type: 'attack', card: weighted(w) }, seal };
}

function play(a, b) {
  let s = createMatch(a, b);
  const stats = { nps: [0, 0], seals: [0, 0], skills: [0, 0], cards: { quick: 0, arts: 0, buster: 0 } };
  while (!s.over) {
    const acts = [bot(s, 0), bot(s, 1)];
    acts.forEach((x, i) => {
      if (x.main.type === 'np') stats.nps[i]++;
      if (x.main.type === 'skill') stats.skills[i]++;
      if (x.main.type === 'attack') stats.cards[x.main.card]++;
      if (x.seal) stats.seals[i] += x.seal === 'grandOrder' ? 3 : 1;
    });
    s = resolveTurn(s, acts).state;
  }
  return { turns: s.turn - 1, result: s.result, stats };
}

const names = ROSTER.map(s => s.id);
const wins = Object.fromEntries(names.map(n => [n, Object.fromEntries(names.map(m => [m, 0]))]));
const agg = { games: 0, turns: [], draws: 0, timeouts: 0, npPerServant: 0, skillsPerServant: 0, cards: { quick: 0, arts: 0, buster: 0 } };
const perServant = Object.fromEntries(names.map(n => [n, { games: 0, wins: 0, nps: 0, fieldGames: 0, fieldScore: 0 }]));

for (const a of ROSTER) for (const b of ROSTER) {
  for (let g = 0; g < N; g++) {
    const r = play(a, b);
    agg.games++; agg.turns.push(r.turns);
    if (r.result.winner === null) agg.draws++;
    if (r.result.reason === 'turn limit') agg.timeouts++;
    agg.npPerServant += (r.stats.nps[0] + r.stats.nps[1]) / 2;
    agg.skillsPerServant += (r.stats.skills[0] + r.stats.skills[1]) / 2;
    for (const c in r.stats.cards) agg.cards[c] += r.stats.cards[c];
    [a, b].forEach((s, i) => {
      perServant[s.id].games++; perServant[s.id].nps += r.stats.nps[i];
      if (r.result.winner === i) perServant[s.id].wins++;
      if (a.id !== b.id) {
        perServant[s.id].fieldGames++;
        perServant[s.id].fieldScore += r.result.winner === i ? 1 : r.result.winner === null ? 0.5 : 0;
      }
    });
    if (r.result.winner === 0) wins[a.id][b.id]++;
  }
}

agg.turns.sort((x, y) => x - y);
const pct = q => agg.turns[Math.floor(q * (agg.turns.length - 1))];
const mean = agg.turns.reduce((x, y) => x + y, 0) / agg.games;
const totalCards = Object.values(agg.cards).reduce((x, y) => x + y, 0);
const f = x => (100 * x).toFixed(1).padStart(5) + '%';

console.log(`\n=== ${agg.games} games (${N} per pairing, seed ${process.argv[3] ?? 1}) ===`);
console.log(`Match length: mean ${mean.toFixed(1)} turns | p10 ${pct(0.1)} | median ${pct(0.5)} | p90 ${pct(0.9)}   (target 12–15)`);
console.log(`NPs fired per servant per match: ${(agg.npPerServant / agg.games).toFixed(2)}   (target 2–3)`);
console.log(`Skills used per servant per match: ${(agg.skillsPerServant / agg.games).toFixed(2)}`);
console.log(`Draws: ${f(agg.draws / agg.games)} | turn-limit games: ${f(agg.timeouts / agg.games)}`);
console.log(`Card picks: ` + Object.entries(agg.cards).map(([c, n]) => `${c} ${f(n / totalCards)}`).join(' | '));

console.log(`\nServant stats (derived) and overall win rate (mirror matches included):`);
for (const s of ROSTER) {
  const p = createMatch(s, s).players[0];
  const ps = perServant[s.id];
  console.log(`  ${s.name.padEnd(20)} HP ${String(p.hp).padStart(4)}  ATK ${String(p.atk).padStart(3)}  win ${f(ps.wins / ps.games)}  vs field ${f(ps.fieldScore / ps.fieldGames)}  NPs/match ${(ps.nps / ps.games).toFixed(2)}`);
}

console.log(`\nMatchup win rate (row servant as player 1 vs column):`);
console.log('                ' + names.map(n => n.padStart(9)).join(''));
for (const a of names) console.log(a.padEnd(16) + names.map(b => f(wins[a][b] / N).padStart(9)).join(''));
console.log('');

if (OUT) {
  mkdirSync(OUT, { recursive: true });
  const pct = x => (100 * x).toFixed(1);
  const rows = ROSTER.map(s => {
    const p = createMatch(s, s).players[0], ps = perServant[s.id];
    return [s.name, s.class, pct(ps.fieldScore / ps.fieldGames), pct(ps.wins / ps.games), (ps.nps / ps.games).toFixed(2), p.hp, p.atk];
  });
  const csv = (header, data) => [header, ...data].map(r => r.map(v => /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\n') + '\n';
  writeFileSync(`${OUT}/winrates.csv`, csv(['servant', 'class', 'score_vs_field_pct', 'overall_win_pct', 'nps_per_match', 'hp', 'atk'], rows));
  const mrows = [];
  for (const a of ROSTER) for (const b of ROSTER) mrows.push([a.name, b.name, pct(wins[a.id][b.id] / N)]);
  writeFileSync(`${OUT}/matchups.csv`, csv(['servant', 'opponent', 'win_pct'], mrows));
  writeFileSync(`${OUT}/run.csv`, csv(['run_date', 'servants', 'games_per_pairing', 'total_games', 'mean_turns', 'draw_pct'],
    [[new Date().toISOString().slice(0, 10), ROSTER.length, N, agg.games, mean.toFixed(1), pct(agg.draws / agg.games)]]));
  console.log(`Wrote ${OUT}/winrates.csv, matchups.csv, run.csv`);
}
