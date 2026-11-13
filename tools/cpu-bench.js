// Benchmark the CPU (src/engine/ai.js): strength curve vs the simulator's
// heuristic bot, and how the adaptive difficulty settles against stand-in
// "players" of different skill. Usage: node tools/cpu-bench.js [games=300]
import { createMatch, resolveTurn, getLegalActions } from '../src/engine/engine.js';
import { chooseAction, applySealPlan } from '../src/engine/ai.js';
import { nextStrength, START_STRENGTH } from '../src/engine/difficulty.js';
import { ROSTER } from '../src/data/servants.js';
import { TUNING as T } from '../src/engine/constants.js';

const N = Number(process.argv[2] ?? 300);
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = a => a[Math.floor(rand() * a.length)];

function heuristic(state, i) {
  const me = state.players[i], foe = state.players[1 - i], L = getLegalActions(state, i), sv = state.servants[i];
  const seal = null;   // Command Seals are spent before the action (sealPlan)
  if (L.np && rand() < 0.75) return { main: { type: 'np' }, seal };
  if (foe.np >= T.npMax && L.skills.length && rand() < 0.5) {
    const d = sv.skills.find(x => L.skills.includes(x.id) && x.effects.some(e => ['damageCut', 'invincible'].includes(e.type)));
    if (d) return { main: { type: 'skill', skillId: d.id }, seal };
  }
  if (L.skills.length && rand() < 0.3) {
    const id = pick(L.skills), sk = sv.skills.find(x => x.id === id);
    return { main: { type: 'skill', skillId: id, ...(sk.options ? { option: pick(sk.options).id } : {}) }, seal };
  }
  return { main: { type: 'attack', card: pick(['quick', 'arts', 'buster']) }, seal };
}

function play(botA, botB) {
  let s = createMatch(pick(ROSTER), pick(ROSTER));
  while (!s.over) { for (const i of [0, 1]) s = applySealPlan(s, i, { strength: 1, random: rand }); s = resolveTurn(s, [botA(s, 0), botB(s, 1)]).state; }
  return s.result.winner;
}
const cpu = strength => (s, i) => chooseAction(s, i, { strength, random: rand });

function score(a, b, n = N) {
  let pts = 0;
  for (let g = 0; g < n; g++) {
    const flip = g % 2, w = flip ? play(b, a) : play(a, b), mine = flip ? 1 : 0;
    pts += w === mine ? 1 : w === null ? 0.5 : 0;
  }
  return (100 * pts / n).toFixed(1) + '%';
}

// A "player" faces the adaptive CPU for many matches in a row.
function adaptive(player, matches = N) {
  let strength = START_STRENGTH, pts = 0, late = 0, lateN = 0;
  for (let g = 0; g < matches; g++) {
    const w = play(player, cpu(strength)); // player is seat 0
    const result = w === 0 ? 'win' : w === null ? 'draw' : 'loss';
    pts += result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
    if (g >= matches / 3) { late += result === 'win' ? 1 : result === 'draw' ? 0.5 : 0; lateN++; }
    strength = nextStrength(strength, result);
  }
  return `player won ${(100 * pts / matches).toFixed(1)}% overall, ${(100 * late / lateN).toFixed(1)}% once settled`;
}

let t0 = Date.now(), decisions = 0;
const timed = (s, i) => { decisions++; return chooseAction(s, i, { strength: 1, random: rand }); };
for (let k = 0; k < 3; k++) play(timed, heuristic);
console.log(`avg CPU decision time: ${((Date.now() - t0) / decisions).toFixed(1)} ms`);

console.log(`\nCPU vs heuristic bot (${N} games each, draws = 1/2):`);
for (const st of [0, 0.25, 0.5, 0.75, 1]) console.log(`  strength ${st.toFixed(2)}: ${score(cpu(st), heuristic)}`);

console.log(`\nAdaptive difficulty vs stand-in players (${N} matches each):`);
console.log(`  weak player   (heuristic bot):  ${adaptive(heuristic)}`);
console.log(`  medium player (CPU at 0.5):     ${adaptive(cpu(0.5))}`);
console.log(`  strong player (CPU at 1.0):     ${adaptive(cpu(1))}`);
