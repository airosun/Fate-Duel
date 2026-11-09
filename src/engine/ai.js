// CPU opponent. Shared by the browser (Play vs CPU) and the simulator.
//
// How it thinks (one turn ahead, using the real engine):
//  1. Predict the opponent: Quick/Arts/Buster weighted by what they've played
//     (recent turns count double), likely NP when their gauge is full, and a
//     share for their skills.
//  2. For each of its own legal actions (with a few sensible Command Seal
//     pairings), simulate the turn against every predicted opponent action and
//     score the result: HP, NP gauge, AP, seals, buffs and debuffs, KOs.
//  3. Pick by softmax over the expected scores. `strength` (0..1) controls how
//     sharp that choice is and how often it makes a deliberate mistake, so
//     difficulty can be tuned without changing the logic.
// It never looks at the opponent's locked action; it only uses public state.

import { getLegalActions, resolveTurn } from './engine.js';
import { CARDS } from './constants.js';

const POSITIVE = new Set(['atkUp', 'cardUp', 'npUp', 'npGainUp', 'cardNpGainUp', 'flatDamage', 'nextHitUp', 'debuffResist']);

function buffScore(p) {
  let v = 0;
  for (const b of p.buffs) {
    if (b.type === 'guts') { v += 1.5; continue; }  // an extra life
    if (b.turns === null) continue;                  // passives are equal in every line
    const t = Math.min(b.turns, 3);
    if (POSITIVE.has(b.type)) v += (b.value / 100) * t * 0.8 + (b.type === 'flatDamage' ? 0.1 * t : 0);
    else if (b.type === 'damageCut') v += (b.value / 100) * t * 0.9;
    else if (b.type === 'evade') v += 0.35 * t;
    else if (b.type === 'invincible') v += 0.5;
    else if (b.type === 'sureHit' || b.type === 'busterConvert') v += 0.25;
    else if (b.type === 'atkDown' || b.type === 'defDown') v -= (b.value / 100) * t * 0.9;
  }
  if (p.empower) v += 0.6;
  return v;
}

function value(st, i) {
  if (st.over) {
    const w = st.result.winner;
    return w === i ? 100 : w === null ? 0 : -100;
  }
  const me = st.players[i], op = st.players[1 - i];
  let v = (me.hp / me.maxHp - op.hp / op.maxHp) * 10;
  v += (me.np - op.np) / 100 * 3;
  v += (Math.min(me.ap, 8) - Math.min(op.ap, 8)) * 0.15;
  v += (me.seals - op.seals) * 0.45;
  v += buffScore(me) - buffScore(op);
  return v;
}

function skillMains(state, i, legal) {
  const s = state.servants[i];
  const out = [];
  for (const id of legal.skills) {
    const sk = s.skills.find(x => x.id === id);
    if (sk.options) for (const o of sk.options) out.push({ type: 'skill', skillId: id, option: o.id });
    else out.push({ type: 'skill', skillId: id });
  }
  return out;
}

function myCandidates(state, i) {
  const legal = getLegalActions(state, i);
  const p = state.players[i];
  const mains = [...legal.attacks.map(card => ({ type: 'attack', card })), ...skillMains(state, i, legal)];
  if (legal.np) mains.push({ type: 'np' });
  const out = mains.map(main => ({ main, seal: null }));
  // Seal pairings worth considering (kept small so the search stays fast)
  if (legal.seals.includes('heal') && p.hp / p.maxHp < 0.45) out.push(...mains.map(main => ({ main, seal: 'heal' })));
  if (legal.seals.includes('recharge') && p.ap <= 2) for (const main of mains) if (main.type === 'attack') out.push({ main, seal: 'recharge' });
  if (legal.seals.includes('empower')) for (const main of mains) if (main.type === 'attack') out.push({ main, seal: 'empower' });
  if (legal.seals.includes('grandOrder') && p.np <= 40) for (const main of mains) if (main.type !== 'np') out.push({ main, seal: 'grandOrder' });
  return out;
}

// Predicted opponent actions with probabilities.
export function predictOpponent(state, j) {
  const legal = getLegalActions(state, j);
  const counts = { quick: 1.5, arts: 1.5, buster: 1.5 };
  const hist = state.history ?? [];
  hist.forEach((h, k) => {
    const m = h.actions[j]?.main;
    if (m?.type === 'attack') counts[m.card] += k >= hist.length - 5 ? 2 : 1;
  });
  const pNp = legal.np ? 0.6 : 0;
  const skills = skillMains(state, j, legal);
  const pSkill = skills.length ? 0.18 * (1 - pNp) : 0;
  const pAttack = 1 - pNp - pSkill;
  const total = counts.quick + counts.arts + counts.buster;
  const dist = CARDS.map(card => ({ action: { main: { type: 'attack', card }, seal: null }, p: pAttack * counts[card] / total }));
  if (pNp) dist.push({ action: { main: { type: 'np' }, seal: null }, p: pNp });
  for (const main of skills) dist.push({ action: { main, seal: null }, p: pSkill / skills.length });
  return dist.filter(d => d.p > 0);
}

/**
 * Choose an action for seat i.
 * @param {object} state  current match state (public information only)
 * @param {number} i      CPU seat
 * @param {object} opts   { strength: 0..1, random: () => number }
 */
export function chooseAction(state, i, { strength = 0.7, random = Math.random } = {}) {
  const j = 1 - i;
  // History isn't needed to simulate (and is slow to copy). The RNG is re-seeded
  // so the CPU can't foresee random outcomes (e.g. Breaker Gorgon) it wouldn't know.
  const base = { ...state, history: [], rng: Math.floor(random() * 2 ** 32) };
  const opp = predictOpponent(state, j);
  const cands = myCandidates(state, i);

  // Don't become predictable: discourage repeating the same attack card.
  const recent = (state.history ?? []).slice(-4).map(h => h.actions[i]?.main).filter(m => m?.type === 'attack').map(m => m.card);

  const scored = cands.map(a => {
    let ev = 0;
    for (const { action, p } of opp) {
      const acts = i === 0 ? [a, action] : [action, a];
      ev += p * value(resolveTurn(base, acts).state, i);
    }
    if (a.main.type === 'attack') ev -= 0.1 * recent.filter(c => c === a.main.card).length;
    if (a.seal) ev -= 0.15; // spend seals only when they clearly help
    return { a, ev };
  });

  // Deliberate mistakes at low strength: a random legal attack.
  if (random() < (1 - strength) * 0.3) {
    const attacks = scored.filter(x => x.a.main.type === 'attack' && !x.a.seal);
    return attacks[Math.floor(random() * attacks.length)].a;
  }
  // Softmax: low strength = flatter (more random), high = sharper.
  const temp = 0.2 + (1 - strength) * 1.6;
  const max = Math.max(...scored.map(x => x.ev));
  const weights = scored.map(x => Math.exp((x.ev - max) / temp));
  let r = random() * weights.reduce((s, w) => s + w, 0);
  for (let k = 0; k < scored.length; k++) if ((r -= weights[k]) <= 0) return scored[k].a;
  return scored[scored.length - 1].a;
}
