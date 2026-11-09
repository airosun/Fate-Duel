import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, resolveTurn, getLegalActions } from '../src/engine/engine.js';
import { SERVANTS } from '../src/data/servants.js';
import { TUNING as T } from '../src/engine/constants.js';

// Bare-bones servant so numbers are easy to reason about.
const dummy = (id, extra = {}) => ({
  id, name: id, hp: 1000, atk: 100, favoredCard: null, npGain: 1, maxAp: 10,
  skills: [
    { id: 'shield', name: 'Shield', cost: 3, effects: [{ type: 'damageCut', value: 50, turns: 1 }] },
    { id: 'charge', name: 'Charge', cost: 3, effects: [{ type: 'npCharge', value: 100 }] },
  ],
  np: { name: 'Beam', card: 'buster', mult: 4 },
  ...extra,
});
const atk = card => ({ main: { type: 'attack', card }, seal: null });
const skill = skillId => ({ main: { type: 'skill', skillId }, seal: null });
const np = () => ({ main: { type: 'np' }, seal: null });
const fresh = (a = {}, b = {}) => createMatch(dummy('A', a), dummy('B', b));

test('winner of a clash deals counter damage, loser whiffs', () => {
  const { state } = resolveTurn(fresh(), [atk('arts'), atk('buster')]);
  assert.equal(state.players[1].hp, 1000 - 125); // 100 × 1.0 × 1.25
  assert.equal(state.players[0].hp, 1000);
});

test('RPS triangle: quick > arts > buster > quick', () => {
  for (const [w, l] of [['quick', 'arts'], ['arts', 'buster'], ['buster', 'quick']]) {
    const { state } = resolveTurn(fresh(), [atk(w), atk(l)]);
    assert.equal(state.players[0].hp, 1000, `${w} vs ${l}`);
    assert.ok(state.players[1].hp < 1000);
  }
});

test('ties trade normal damage', () => {
  const { state } = resolveTurn(fresh(), [atk('buster'), atk('buster')]);
  assert.equal(state.players[0].hp, 850);
  assert.equal(state.players[1].hp, 850);
});

test('loser still gains on-hit NP; winner gains card NP', () => {
  const { state } = resolveTurn(fresh(), [atk('arts'), atk('buster')]);
  assert.equal(state.players[0].np, T.cards.arts.npGain);
  assert.equal(state.players[1].np, T.npGainOnHit);
});

test('AP: +2 per attack, +1 if it lands, +1 for quick', () => {
  const { state } = resolveTurn(fresh(), [atk('quick'), atk('buster')]); // quick loses
  assert.equal(state.players[0].ap, T.startAp + 2 + 1);       // attack + quick, no land
  assert.equal(state.players[1].ap, T.startAp + 2 + 1);       // attack + land
});

test('skill vs attack: attack lands unopposed, skill resolves first', () => {
  const { state } = resolveTurn(fresh(), [skill('shield'), atk('buster')]);
  assert.equal(state.players[0].hp, 1000 - 75); // 150 × 50% cut
  assert.equal(state.players[0].ap, T.startAp - 3);
});

test('same skill cannot be used on consecutive turns', () => {
  let s = fresh();
  s = resolveTurn(s, [skill('shield'), atk('arts')]).state;
  assert.ok(!getLegalActions(s, 0).skills.includes('shield'));
  assert.throws(() => resolveTurn(s, [skill('shield'), atk('arts')]));
});

test('NP cancels regular attack; defensive skill reduces NP', () => {
  let s = fresh();
  s = resolveTurn(s, [skill('charge'), skill('charge')]).state; // both at 100
  const r1 = resolveTurn(s, [np(), atk('buster')]).state;
  assert.equal(r1.players[0].hp, 1000);
  assert.equal(r1.players[1].hp, 600);
  assert.equal(r1.players[0].np, 0);
  // fresh match: B shields while A fires
  let s2 = fresh();
  s2 = resolveTurn(s2, [skill('charge'), atk('arts')]).state;
  const r2 = resolveTurn(s2, [np(), skill('shield')]).state;
  assert.equal(r2.players[1].hp, 1000 - 200); // 400 NP × 50% cut
});

test('NP vs NP: both fire; double KO is a draw', () => {
  let s = fresh({ hp: 400 }, { hp: 400 });
  s = resolveTurn(s, [skill('charge'), skill('charge')]).state;
  const { state } = resolveTurn(s, [np(), np()]);
  assert.equal(state.over, true);
  assert.equal(state.result.winner, null);
  assert.equal(state.result.reason, 'double KO');
});

test('guts survives once', () => {
  let s = fresh({}, { hp: 300, passive: { effects: [{ type: 'guts', value: 20, charges: 1 }] } });
  s = resolveTurn(s, [skill('charge'), atk('quick')]).state;
  s = resolveTurn(s, [np(), atk('arts')]).state;
  assert.equal(s.over, false);
  assert.equal(s.players[1].hp, 60);
  assert.equal(s.players[1].buffs.filter(b => b.type === 'guts').length, 0);
});

test('evade blocks attacks but not NPs; ignoreDefense pierces evade', () => {
  const ev = { skills: [{ id: 'ev', name: 'Ev', cost: 3, effects: [{ type: 'evade', turns: 1 }] },
                        { id: 'charge', name: 'C', cost: 3, effects: [{ type: 'npCharge', value: 100 }] }] };
  let r = resolveTurn(fresh({}, ev), [atk('buster'), skill('ev')]).state;
  assert.equal(r.players[1].hp, 1000);
  let s = resolveTurn(fresh({ np: { name: 'Swallow', card: 'quick', mult: 3, ignoreDefense: true } }, ev),
    [skill('charge'), atk('quick')]).state;
  r = resolveTurn(s, [np(), skill('ev')]).state;
  assert.equal(r.players[1].hp, 1000 - 300);
});

test('command seals: heal, empower wins ties, grand order fills NP', () => {
  let s = fresh();
  s = resolveTurn(s, [atk('buster'), atk('buster')]).state; // both 850
  s = resolveTurn(s, [{ main: { type: 'attack', card: 'arts' }, seal: 'empower' }, atk('arts')]).state;
  assert.equal(s.players[0].hp, 850);           // B's tie attack lost
  assert.equal(s.players[1].hp, 850 - 150);     // 100 × 1.5 empower
  s = resolveTurn(s, [{ main: { type: 'attack', card: 'quick' }, seal: 'heal' }, atk('quick')]).state;
  assert.equal(s.players[0].hp, Math.min(1000, 850 + 300) - 80);
  const g = resolveTurn(fresh(), [{ main: { type: 'attack', card: 'arts' }, seal: 'grandOrder' }, atk('arts')]).state;
  assert.equal(g.players[0].np, 100);
  assert.equal(g.players[0].seals, 0);
});

test('Rule Breaker strips buffs before damage', () => {
  let s = createMatch(SERVANTS.medea, dummy('B'));
  s.players[0].np = 100;
  const r = resolveTurn(s, [np(), skill('shield')]).state;
  const expected = Math.round(s.players[0].atk * 3.0);
  assert.equal(r.players[1].hp, 1000 - expected);
});

test('prototype roster builds valid matches', () => {
  for (const a of Object.values(SERVANTS)) for (const b of Object.values(SERVANTS)) {
    const s = createMatch(a, b);
    assert.ok(s.players[0].hp > 0 && s.players[0].atk > 0);
  }
});

test('turn limit is a draw', () => {
  let s = fresh();
  s.turn = T.maxTurns;
  const r = resolveTurn(s, [atk('arts'), skill('shield')]).state;
  assert.equal(r.result.winner, null);
  assert.equal(r.result.reason, 'turn limit');
});

test('buster affinity is smaller than quick/arts affinity', () => {
  const r = resolveTurn(fresh({ favoredCard: 'buster' }), [atk('buster'), atk('quick')]).state;
  assert.equal(r.players[1].hp, 1000 - Math.round(100 * 1.5 * 1.08 * 1.25));
});

test('invincible lasts only the turn it is cast; evade defaults to 2 turns', () => {
  const kit = { skills: [
    { id: 'inv', name: 'Inv', cost: 3, effects: [{ type: 'invincible', turns: 3 }] },
    { id: 'ev', name: 'Ev', cost: 3, effects: [{ type: 'evade' }] }] };
  let s = resolveTurn(fresh({}, kit), [atk('buster'), skill('inv')]).state;
  assert.equal(s.players[1].hp, 1000);
  assert.equal(s.players[1].buffs.length, 0);
  s = resolveTurn(fresh({}, kit), [atk('buster'), skill('ev')]).state;
  s = resolveTurn(s, [atk('buster'), atk('quick')]).state; // still evading on turn 2
  assert.equal(s.players[1].hp, 1000);
});

test('Artoria: Dragon Reactor Core converts next attack to Buster but keeps Arts priority', () => {
  let s = createMatch(SERVANTS.artoria, dummy('B'));
  s.players[0].ap = 5;
  s = resolveTurn(s, [skill('dragon_reactor'), atk('quick')]).state;
  const before = s.players[1].hp;
  const r = resolveTurn(s, [atk('arts'), atk('buster')]).state; // arts beats buster
  const a = s.players[0].atk;
  assert.equal(before - r.players[1].hp, Math.round(a * 1.5 * 1.25 * 1.08 * 1.25)); // buster +25%, affinity, counter
  assert.equal(r.players[0].buffs.some(b => b.type === 'busterConvert'), false);
});

test('Artoria: Knight of Utopia doubles Buster NP gain; Excalibur refunds 15%', () => {
  let s = createMatch(SERVANTS.artoria, dummy('B'));
  s = resolveTurn(s, [skill('knight_of_utopia'), atk('arts')]).state;
  const np0 = s.players[0].np;
  s = resolveTurn(s, [atk('buster'), atk('quick')]).state;
  assert.equal(s.players[0].np - np0, Math.round(10 * s.players[0].npGainAtk * 2));
  s.players[0].np = 100;
  s = resolveTurn(s, [np(), atk('arts')]).state;
  assert.equal(s.players[0].np, 15);
});

test('Artoria: Magic Resistance weakens debuffs', () => {
  const hexer = { skills: [{ id: 'hex', name: 'Hex', cost: 3, effects: [{ type: 'atkDown', value: 50, turns: 2, target: 'enemy' }] }] };
  const s = resolveTurn(createMatch(SERVANTS.artoria, dummy('B', hexer)), [atk('arts'), skill('hex')]).state;
  assert.equal(s.players[0].buffs.find(b => b.type === 'atkDown').value, 40);
});
