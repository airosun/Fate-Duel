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
  const expected = Math.round(s.players[0].atk * 2.4 * 1.12); // Territory Creation A = Arts +12%
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
  assert.equal(s.players[0].np - np0, Math.round(T.cards.buster.npGain * s.players[0].npGainAtk * 2));
  s.players[0].np = 100;
  s = resolveTurn(s, [np(), atk('arts')]).state;
  assert.equal(s.players[0].np, 15);
});

test('Artoria: Magic Resistance weakens debuffs', () => {
  const hexer = { skills: [{ id: 'hex', name: 'Hex', cost: 3, effects: [{ type: 'atkDown', value: 50, turns: 2, target: 'enemy' }] }] };
  const s = resolveTurn(createMatch(SERVANTS.artoria, dummy('B', hexer)), [atk('arts'), skill('hex')]).state;
  assert.equal(s.players[0].buffs.find(b => b.type === 'atkDown').value, 40);
});

test('Heracles: 12 Labors revives at 25%; Indomitable is stronger after revive', () => {
  let s = createMatch(dummy('A', { atk: 2000 }), SERVANTS.heracles);
  s = resolveTurn(s, [atk('buster'), atk('quick')]).state; // lethal → revive
  const h = s.players[1];
  assert.equal(h.revived, true);
  assert.equal(h.hp, Math.round(h.maxHp * 0.25));
  assert.equal(h.np, 0); assert.equal(h.ap, 0);
  h.ap = 8;
  s = resolveTurn(s, [skill('shield'), skill('indomitable')]).state;
  assert.equal(s.players[1].buffs.filter(b => b.type === 'cardUp' && b.card === 'buster' && b.turns !== null).length, 2);
});

test('Heracles: Divinity adds flat damage; Nine Lives applies defense down', () => {
  const s0 = createMatch(SERVANTS.heracles, dummy('B'));
  const he = s0.players[0];
  let s = resolveTurn(s0, [atk('arts'), atk('buster')]).state;
  assert.equal(1000 - s.players[1].hp, Math.round(he.atk * 1.0 * 1.25 + 10));
  s.players[0].np = 100;
  s = resolveTurn(s, [np(), skill('charge')]).state;
  assert.equal(s.players[1].buffs.find(b => b.type === 'defDown').value, 20);
  const before = s.players[1].hp;
  s = resolveTurn(s, [atk('arts'), atk('buster')]).state;
  assert.equal(before - s.players[1].hp, Math.round((he.atk * 1.25 + 10) * 1.2));
});

test('Artoria: Magic Resistance weakens Nine Lives defense down', () => {
  let s = createMatch(SERVANTS.heracles, SERVANTS.artoria);
  s.players[0].np = 100;
  s = resolveTurn(s, [np(), atk('arts')]).state;
  assert.equal(s.players[1].buffs.find(b => b.type === 'defDown').value, 16);
});

test('Independent Action raises max and starting AP', async () => {
  const { classPassive } = await import('../src/data/passives.js');
  const s = createMatch(dummy('A', { passives: [classPassive('independentAction', 'A')] }), dummy('B'));
  assert.equal(s.players[0].maxAp, 12);
  assert.equal(s.players[0].ap, T.startAp + 2);
});

test('Medea: Witch of Colchis cleanses debuffs; Hecate\'s Staff cancels debuff resistance', () => {
  const hexer = { skills: [{ id: 'hex', name: 'Hex', cost: 3, effects: [{ type: 'atkDown', value: 20, turns: 3, target: 'enemy' }] }] };
  let s = createMatch(SERVANTS.medea, dummy('B', hexer));
  s.players[0].ap = 12;
  s = resolveTurn(s, [atk('arts'), skill('hex')]).state;
  assert.ok(s.players[0].buffs.some(b => b.type === 'atkDown'));
  s = resolveTurn(s, [skill('witch_of_colchis'), atk('arts')]).state;
  assert.equal(s.players[0].buffs.some(b => b.type === 'atkDown'), false);
  // potency vs resistance: a 30% resist target loses only 5% of Medea-cast debuff value
  const caster = createMatch(SERVANTS.medea, dummy('B')).players[0];
  assert.equal(caster.buffs.find(b => b.type === 'debuffPotency').value, 25);
});

test('Kojirou: Quick attacks pierce evade; Souwa makes every card pierce', () => {
  const ev = { skills: [{ id: 'ev', name: 'Ev', cost: 3, effects: [{ type: 'evade', turns: 3 }] }] };
  let s = resolveTurn(createMatch(SERVANTS.kojirou, dummy('B', ev)), [atk('buster'), skill('ev')]).state;
  assert.equal(s.players[1].hp, 1000);                       // buster evaded
  s = resolveTurn(s, [atk('quick'), atk('buster')]).state;    // quick loses clash → whiff anyway
  s = resolveTurn(createMatch(SERVANTS.kojirou, dummy('B', ev)), [atk('quick'), skill('ev')]).state;
  assert.ok(s.players[1].hp < 1000);                          // quick pierces
  let t = createMatch(SERVANTS.kojirou, dummy('B', ev));
  t.players[0].ap = 10;
  t = resolveTurn(t, [skill('souwa'), skill('ev')]).state;
  t = resolveTurn(t, [atk('buster'), atk('quick')]).state;
  assert.ok(t.players[1].hp < 1000);                          // buster pierces with Souwa
});

test('Kojirou: Tsubame Gaeshi buffs Quick before dealing damage', () => {
  let s = createMatch(SERVANTS.kojirou, dummy('B'));
  const k = s.players[0];
  s.players[0].np = 100;
  s = resolveTurn(s, [np(), skill('charge')]).state;
  assert.equal(1000 - s.players[1].hp, Math.round(k.atk * 3.6 * 1.2));
  assert.ok(s.players[0].buffs.some(b => b.type === 'cardUp' && b.card === 'quick' && b.turns === 2));
});

test('Medea: Rule Breaker applies ATK down, which Hecate\'s Staff pushes through Magic Resistance', () => {
  let s = createMatch(SERVANTS.medea, SERVANTS.artoria);   // Artoria: Magic Resistance A (20%)
  s.players[0].np = 100;
  s = resolveTurn(s, [np(), atk('arts')]).state;
  const d = s.players[1].buffs.find(b => b.type === 'atkDown');
  assert.equal(d.value, 20);    // potency 25 fully cancels resistance 20
  assert.equal(d.turns, 3);     // active for the next 3 turns
});
