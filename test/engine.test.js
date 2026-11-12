import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch as createMatchRaw, resolveTurn, getLegalActions, validateAction, foresightView, skillCost, deriveStats } from '../src/engine/engine.js';
// Most tests check exact damage, so crits are off unless a test asks for them ({ crits: true }).
const createMatch = (a, b, o = {}) => {
  const s = createMatchRaw(a, b, o);
  if (!o.crits) for (const p of s.players) p.critChance = 0;
  return s;
};
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
  const expected = Math.round(s.players[0].atk * SERVANTS.medea.np.mult * 1.12); // Territory Creation A = Arts +12%
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
  assert.equal(1000 - s.players[1].hp, Math.round(k.atk * SERVANTS.kojirou.np.mult * 1.2));
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

test('passive damage cut is permanent (Invisible Air never expires)', () => {
  let s = createMatch(SERVANTS.artoria, dummy('B'));
  for (let k = 0; k < 4; k++) s = resolveTurn(s, [atk('arts'), atk('arts')]).state;
  const cut = s.players[0].buffs.find(b => b.type === 'damageCut');
  assert.ok(cut && cut.turns === null);
});

// ---------- clash simultaneity + effectiveness + EMIYA ----------
const skillOpt = (skillId, option) => ({ main: { type: 'skill', skillId, option }, seal: null });

test('NP clash: Rule Breaker does not strip Heracles\' buffs before Nine Lives lands', () => {
  let s = createMatch(SERVANTS.medea, SERVANTS.heracles);
  s.players[1].ap = 8;
  s = resolveTurn(s, [atk('arts'), skill('bravery')]).state;   // Heracles ATK +20%
  s.players[0].np = 100; s.players[1].np = 100;
  const h = s.players[1], m = s.players[0];
  const medeaHp = m.hp;
  const r = resolveTurn(s, [np(), np()]).state;
  // Nine Lives keeps Bravery (+20%) and Mad Enhancement (Buster +10%): 3.6 × (1 + .2 + .1) + 10 flat
  assert.equal(medeaHp - r.players[0].hp, Math.round(h.atk * SERVANTS.heracles.np.mult * 1.3 + 10));
  // Heracles' Bravery is removed afterwards, and Rule Breaker's ATK down lands afterwards
  assert.equal(r.players[1].buffs.some(b => b.source === 'bravery'), false);
  assert.ok(r.players[1].buffs.some(b => b.type === 'atkDown'));
});

test('NP clash: ATK down from one NP does not weaken the other NP', () => {
  let s = createMatch(SERVANTS.medea, SERVANTS.kojirou);
  s.players[0].np = 100; s.players[1].np = 100;
  const k = s.players[1];
  const before = s.players[0].hp;
  const r = resolveTurn(s, [np(), np()]).state;
  assert.equal(before - r.players[0].hp, Math.round(k.atk * SERVANTS.kojirou.np.mult * 1.2)); // Tsubame's own Quick +20% only
});

test('Arts effectiveness adds a flat NP gain bonus once, however many Arts buffs', () => {
  const base = resolveTurn(fresh(), [atk('arts'), atk('buster')]).state.players[0].np;
  const one = resolveTurn(fresh({ passives: [{ effects: [{ type: 'cardUp', card: 'arts', value: 50 }] }] }),
    [atk('arts'), atk('buster')]).state.players[0].np;
  const two = resolveTurn(fresh({ passives: [{ effects: [{ type: 'cardUp', card: 'arts', value: 20 }, { type: 'cardUp', card: 'arts', value: 30 }] }] }),
    [atk('arts'), atk('buster')]).state.players[0].np;
  assert.equal(base, T.cards.arts.npGain);
  assert.equal(one, Math.round(T.cards.arts.npGain * (1 + T.artsEffectNpGain / 100)));
  assert.equal(two, one);
});

test('Quick effectiveness gives +1 AP once, however many Quick buffs', () => {
  const two = resolveTurn(fresh({ passives: [{ effects: [{ type: 'cardUp', card: 'quick', value: 10 }, { type: 'cardUp', card: 'quick', value: 30 }] }] }),
    [atk('quick'), atk('arts')]).state.players[0].ap;
  const plainAp = resolveTurn(fresh(), [atk('quick'), atk('arts')]).state.players[0].ap;
  assert.equal(two - plainAp, 1);
});

test('Quick effectiveness gives +1 AP when attacking with Quick', () => {
  const plain = resolveTurn(fresh(), [atk('quick'), atk('arts')]).state.players[0].ap;
  const fast = resolveTurn(fresh({ passives: [{ effects: [{ type: 'cardUp', card: 'quick', value: 10 }] }] }),
    [atk('quick'), atk('arts')]).state.players[0].ap;
  assert.equal(fast - plain, 1);
});

test('NP card type: effectiveness buffs boost NPs of that type', () => {
  let s = createMatch(dummy('A', { passives: [{ effects: [{ type: 'cardUp', card: 'buster', value: 25 }] }] }), dummy('B'));
  s.players[0].np = 100;
  const r = resolveTurn(s, [np(), skill('charge')]).state;
  assert.equal(1000 - r.players[1].hp, Math.round(100 * 4 * 1.25));
});

test('EMIYA: Trace On gives every favored-card bonus', () => {
  for (const [card, loser] of [['quick', 'arts'], ['arts', 'buster'], ['buster', 'quick']]) {
    const s = createMatch(SERVANTS.emiya, dummy('B'));
    const e = s.players[0];
    const r = resolveTurn(s, [atk(card), atk(loser)]).state;
    const eff = card === 'quick' ? 0 : 0;
    assert.equal(1000 - r.players[1].hp, Math.round(e.atk * T.cards[card].mult * (1 + eff) * (1 + T.affinityBonus[card]) * 1.25), card);
  }
});

test('EMIYA: Circuit Connect needs a mode, switches UBW, and boosts the next landed hit once', () => {
  let s = createMatch(SERVANTS.emiya, dummy('B'));
  s.players[0].ap = 11;
  assert.throws(() => resolveTurn(s, [skill('circuit_connect'), atk('arts')]), /Choose an option/);
  s = resolveTurn(s, [skillOpt('circuit_connect', 'quick'), atk('arts')]).state;
  assert.equal(s.players[0].npMode, 'quick');
  const e = s.players[0];
  // whiffed attack keeps the bonus
  s = resolveTurn(s, [atk('arts'), atk('quick')]).state;
  assert.ok(s.players[0].buffs.some(b => b.type === 'nextHitUp'));
  const hp = s.players[1].hp;
  s = resolveTurn(s, [atk('buster'), atk('quick')]).state;
  assert.equal(hp - s.players[1].hp, Math.round(e.atk * 1.5 * 1.5 * 1.08 * 1.25));
  assert.equal(s.players[0].buffs.some(b => b.type === 'nextHitUp'), false);
  // Quick Mode UBW applies ATK down
  s.players[0].np = 100;
  s = resolveTurn(s, [np(), atk('arts')]).state;
  assert.equal(s.players[1].buffs.find(b => b.type === 'atkDown').value, 20);
});

test('Cu: Ath nGabla scales with missing HP; Battle Continuation revives at 1 HP keeping AP/NP', () => {
  let s = createMatch(SERVANTS.cu, dummy('B'));
  s.players[0].hp = Math.round(s.players[0].maxHp / 2);
  s = resolveTurn(s, [skill('ath_ngabla'), skill('charge')]).state;
  assert.equal(s.players[0].buffs.find(b => b.source === 'ath_ngabla').value, 35); // 20 + 30 × 0.5
  let t = createMatch(dummy('A', { atk: 5000 }), SERVANTS.cu);
  t.players[1].np = 60; t.players[1].ap = 7;
  t = resolveTurn(t, [atk('arts'), atk('buster')]).state;  // Arts beats Buster: the big hit lands
  assert.equal(t.players[1].hp, 1);
  assert.equal(t.players[1].ap, 7 + 2);         // kept (plus this turn's attack AP)
  assert.ok(t.players[1].np >= 60);
});

test('Cu: Gae Bolg grants Sure Hit for the next 2 turns and lowers enemy DEF', () => {
  const ev = { skills: [{ id: 'ev', name: 'Ev', cost: 3, effects: [{ type: 'evade', turns: 3 }] }] };
  let s = createMatch(SERVANTS.cu, dummy('B', ev));
  s.players[0].np = 100;
  s = resolveTurn(s, [np(), skill('ev')]).state;
  assert.ok(s.players[1].buffs.some(b => b.type === 'defDown'));
  const hp = s.players[1].hp;
  s = resolveTurn(s, [atk('buster'), atk('quick')]).state;  // buster through evade
  assert.ok(s.players[1].hp < hp);
});

// ---------- Medusa, RNG, Trace On copying ----------
test('RNG is seeded: the same seed gives the same match', () => {
  const run = seed => {
    let s = createMatch(SERVANTS.medusa, SERVANTS.artoria, { seed });
    for (let k = 0; k < 6; k++) s = resolveTurn(s, [atk(['quick', 'arts', 'buster'][k % 3]), k === 1 ? skill('radiant_road') : atk('arts')]).state;
    return JSON.stringify(s.players);
  };
  assert.equal(run(123), run(123));
});

test('Breaker Gorgon: about 10% of the opponent\'s self-buffs fail', () => {
  let failed = 0, total = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const s = createMatch(SERVANTS.medusa, SERVANTS.kojirou, { seed });
    s.players[1].ap = 10;
    const r = resolveTurn(s, [atk('arts'), skill('fade_out')]);
    total++;
    if (!r.state.players[1].buffs.some(b => b.source === 'fade_out')) failed++;
  }
  assert.ok(failed / total > 0.06 && failed / total < 0.14, `fail rate ${failed / total}`);
});

test('Medusa: Mystic Eyes drains AP and petrifies; petrified attackers recover less AP', () => {
  let s = createMatch(SERVANTS.medusa, dummy('B'), { seed: 1 });
  s.players[1].ap = 6;
  s = resolveTurn(s, [skill('mystic_eyes'), skill('charge')]).state;
  assert.equal(s.players[1].ap, 6 - 3 - 3);                // skill cost 3, drained 3
  assert.ok(s.players[1].buffs.some(b => b.status === 'petrified'));
  const ap = s.players[1].ap;
  s = resolveTurn(s, [atk('arts'), atk('buster')]).state;  // B's buster loses: +2 attack AP -2 petrify
  assert.equal(s.players[1].ap, ap);
});

test('Medusa: Monstrous Snake boosts one attack against a Petrified enemy', () => {
  let s = createMatch(SERVANTS.medusa, dummy('B'), { seed: 3 });
  s.players[0].ap = 11;
  s = resolveTurn(s, [skill('mystic_eyes'), skill('charge')]).state;
  s = resolveTurn(s, [skill('monstrous_snake'), atk('quick')]).state;
  const m = s.players[0];
  const hp = s.players[1].hp;
  s = resolveTurn(s, [atk('arts'), atk('buster')]).state;
  assert.equal(hp - s.players[1].hp, Math.round(m.atk * 1.0 * 1.2 * 1.5 * 1.25 + 1));
  assert.equal(s.players[0].buffs.some(b => b.type === 'bonusVsStatus'), false);
});

test('EMIYA: Trace On copies the opponent\'s unique passive (not other copy effects)', () => {
  const vsHeracles = createMatch(SERVANTS.emiya, SERVANTS.heracles).players[0];
  assert.deepEqual(vsHeracles.copied, []);                     // revives can't be copied
  assert.deepEqual(vsHeracles.copyBlocked, ['12 Labors']);
  assert.equal(vsHeracles.buffs.some(b => b.type === 'guts'), false);
  const vsArtoria = createMatch(SERVANTS.emiya, SERVANTS.artoria).players[0];
  assert.ok(vsArtoria.buffs.some(b => b.type === 'damageCut' && b.copiedFrom === 'Invisible Air'));
  const mirror = createMatch(SERVANTS.emiya, SERVANTS.emiya).players[0];
  assert.deepEqual(mirror.copied, ['Reality Marble']);
  const vsMedusa = createMatch(SERVANTS.emiya, SERVANTS.medusa).players[0];
  assert.ok(vsMedusa.buffs.some(b => b.type === 'buffFailChance'));
});

test('Empower boosts the next NP if it comes before an attack, then is used up', () => {
  let s = fresh();
  s = resolveTurn(s, [{ main: { type: 'skill', skillId: 'charge' }, seal: 'empower' }, atk('arts')]).state;
  assert.equal(s.players[0].empower, true);
  const r = resolveTurn(s, [np(), atk('arts')]).state;
  assert.equal(s.players[1].hp - r.players[1].hp, 100 * 4 * 1.5);
  assert.equal(r.players[0].empower, false);
});

test('Hassan: Zabaniya instant kill lands about 5% of the time and ignores revives', () => {
  let kills = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const s = createMatch(SERVANTS.hassan, SERVANTS.heracles, { seed });
    s.players[0].np = 100;
    const r = resolveTurn(s, [np(), atk('arts')]).state;
    if (r.over) { kills++; assert.equal(r.result.winner, 0); assert.equal(r.players[1].hp, 0); }
  }
  assert.ok(kills / 600 > 0.025 && kills / 600 < 0.08, `kill rate ${kills / 600}`);
});

test('Hassan: Throwing/Retrieval gives AP now and at the end of this turn and the next', () => {
  let s = createMatch(SERVANTS.hassan, dummy('B'), { seed: 1 });
  const start = s.players[0].ap;               // 4
  s = resolveTurn(s, [skill('throwing'), skill('charge')]).state;
  assert.equal(s.players[0].ap, start - 3 + 2 + 2);
  s = resolveTurn(s, [skill('self_modification'), atk('arts')]).state;
  assert.equal(s.players[0].ap, start - 3 + 2 + 2 - 3 + 2);
});

test("EMIYA copies Shaytan's Arm but it does nothing without Zabaniya", () => {
  let kills = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const s = createMatch(SERVANTS.emiya, SERVANTS.hassan, { seed });
    assert.ok(s.players[0].buffs.some(b => b.type === 'instantKillChance' && b.copiedFrom === "Shaytan's Arm"));
    s.players[0].np = 100;
    s.players[1].hp = 5000; s.players[1].maxHp = 5000;   // NP damage alone can't kill
    if (resolveTurn(s, [np(), atk('arts')]).state.over) kills++;
  }
  assert.equal(kills, 0);
});

test("Gilgamesh: Ea neutralizes the opponent's unique passives", () => {
  const vsHer = createMatch(SERVANTS.gilgamesh, SERVANTS.heracles);
  assert.deepEqual(vsHer.players[1].neutralized, ['12 Labors']);
  assert.equal(vsHer.players[1].buffs.some(b => b.type === 'guts'), false);
  assert.ok(vsHer.players[1].buffs.some(b => b.source === 'Mad Enhancement B'));   // class passives stay
  assert.ok(vsHer.players[1].maxHp > createMatch(SERVANTS.artoria, SERVANTS.heracles).players[1].maxHp); // full HP back
  const vsEmiya = createMatch(SERVANTS.emiya, SERVANTS.gilgamesh).players[0];
  assert.deepEqual(vsEmiya.neutralized, ['Reality Marble', 'Trace On']);
  assert.equal(vsEmiya.buffs.some(b => b.type === 'affinityAll' || b.copiedFrom), false);
  const mirror = createMatch(SERVANTS.gilgamesh, SERVANTS.gilgamesh);
  assert.deepEqual(mirror.players.map(p => p.neutralized), [['Ea'], ['Ea']]);
});

test('Gilgamesh: Enuma Elish boosts its own damage only for that NP', () => {
  let s = createMatch(SERVANTS.gilgamesh, dummy('B'), { seed: 1 });
  const g = s.players[0];
  s.players[0].np = 100;
  s = resolveTurn(s, [np(), skill('charge')]).state;
  assert.equal(1000 - s.players[1].hp, Math.round(g.atk * 3.0 * 1.3 + 8));   // + Divinity B
  assert.equal(s.players[0].buffs.some(b => b.type === 'npUp'), false);
});

test('Iskandar: Towards the Beyond makes attacks ignore damage cut (not evade)', () => {
  const guard = { skills: [{ id: 'cut', name: 'Cut', cost: 3, effects: [{ type: 'damageCut', value: 50, turns: 3 }] }] };
  let s = createMatch(SERVANTS.iskandar, dummy('B', guard), { seed: 1 });
  const k = s.players[0];
  s.players[0].ap = 10;
  s = resolveTurn(s, [skill('towards_beyond'), skill('cut')]).state;
  const hp = s.players[1].hp;
  s = resolveTurn(s, [atk('arts'), atk('buster')]).state;
  assert.equal(hp - s.players[1].hp, Math.round(k.atk * 1.0 * 1.25 * 1.25 + 6));   // no 50% cut; Divinity C +6
});

test('Iskandar: Ionioi Hetairoi also ignores damage cut while Towards the Beyond is active', () => {
  const guard = { skills: [{ id: 'cut', name: 'Cut', cost: 3, effects: [{ type: 'damageCut', value: 50, turns: 3 }] }] };
  let s = createMatch(SERVANTS.iskandar, dummy('B', guard), { seed: 1 });
  const k = s.players[0];
  s.players[0].ap = 10;
  s = resolveTurn(s, [skill('towards_beyond'), skill('cut')]).state;
  s.players[0].np = 100;
  const hp = s.players[1].hp;
  s = resolveTurn(s, [np(), atk('arts')]).state;
  assert.equal(hp - s.players[1].hp, Math.round(k.atk * SERVANTS.iskandar.np.mult * (1 + 0.25 + 0.10) + 6));   // ATK +25%, Bucephalus Buster +10%
});

test('Hundred Faces: attacks on him miss about 10% of the time; Sure Hit ignores it', () => {
  let misses = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const s = createMatch(dummy('A'), SERVANTS.hundred_faces, { seed });
    const r = resolveTurn(s, [atk('arts'), atk('buster')]).state;   // A's Arts beats Buster
    if (r.players[1].hp === s.players[1].hp) misses++;
  }
  assert.ok(misses / 500 > 0.06 && misses / 500 < 0.14, `miss rate ${misses / 500}`);
});

test('Hundred Faces: Expert buffs land ~80% each; Library raises that to 100%', () => {
  let landed = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const s = createMatch(SERVANTS.hundred_faces, dummy('B'), { seed });
    const r = resolveTurn(s, [skill('expert'), atk('arts')]).state;
    landed += r.players[0].buffs.filter(b => b.type === 'cardUp').length;
  }
  assert.ok(landed / 900 > 0.74 && landed / 900 < 0.86, `land rate ${landed / 900}`);
  let s = createMatch(SERVANTS.hundred_faces, dummy('B'), { seed: 5 });
  s.players[0].ap = 10;
  s = resolveTurn(s, [skill('library'), atk('arts')]).state;
  s = resolveTurn(s, [skill('expert'), atk('arts')]).state;
  assert.equal(s.players[0].buffs.filter(b => b.type === 'cardUp').length, 3);
});

test('Hundred Faces: Battle Retreat heals but strips his own buffs; Zabaniya makes the enemy weak to Arts', () => {
  let s = createMatch(SERVANTS.hundred_faces, dummy('B'), { seed: 2 });
  s.players[0].ap = 10; s.players[0].hp = 600;
  s = resolveTurn(s, [skill('expert'), atk('arts')]).state;
  s.players[1].ap = 10;                      // dummy just shields, so no damage this turn
  s = resolveTurn(s, [skill('battle_retreat'), skill('shield')]).state;
  assert.equal(s.players[0].buffs.filter(b => b.turns !== null).length, 0);
  assert.equal(s.players[0].hp, 600 + Math.round(s.players[0].maxHp * 0.3));
  s.players[0].np = 100;
  s = resolveTurn(s, [np(), atk('arts')]).state;
  assert.ok(s.players[1].buffs.some(b => b.type === 'cardVuln' && b.card === 'arts' && b.value === 20));
});

test('Lancelot: Eternal Arms Mastery copies half of an enemy ATK buff; Arondight adds AP from attacks', () => {
  let s = createMatch(SERVANTS.artoria, SERVANTS.lancelot, { seed: 1 });
  s = resolveTurn(s, [skill('knight_of_utopia'), skill('arondight')]).state;
  const mirror = s.players[1].buffs.find(b => b.source === 'mirror');
  assert.equal(mirror.value, 10);           // half of Knight of Utopia's ATK +20%
  const ap = s.players[1].ap;
  s = resolveTurn(s, [atk('buster'), atk('arts')]).state;   // Lancelot's Arts wins: +2 +1 land +2 Arondight
  assert.equal(s.players[1].ap, Math.min(s.players[1].maxAp, ap + 2 + 1 + 2));
});

test('NPs use ATK up, card effectiveness of their card, next-hit boosts and bonus vs status', () => {
  const npDmg = (buffs, defBuffs = []) => {
    const s = createMatch(dummy('A'), dummy('B'), { seed: 1 });
    s.players[0].np = 100; s.players[0].buffs.push(...buffs); s.players[1].buffs.push(...defBuffs);
    const r = resolveTurn(s, [np(), atk('quick')]).state;
    return { dmg: s.players[1].hp - r.players[1].hp, buffs: r.players[0].buffs };
  };
  const base = npDmg([]).dmg;
  const b = (type, value, extra = {}) => ({ type, value, turns: 3, source: 't', ...extra });
  assert.equal(npDmg([b('atkUp', 20)]).dmg, Math.round(base * 1.2));
  assert.equal(npDmg([b('cardUp', 20, { card: 'buster' })]).dmg, Math.round(base * 1.2));   // Beam is Buster
  assert.equal(npDmg([b('cardUp', 20, { card: 'quick' })]).dmg, base);                      // wrong card: no effect
  const nh = npDmg([b('nextHitUp', 50)]);
  assert.equal(nh.dmg, Math.round(base * 1.5));
  assert.ok(!nh.buffs.some(x => x.type === 'nextHitUp'), 'next-hit boost is used up by the NP');
  const petrified = b('apRecoveryDown', 2, { status: 'petrified', debuff: true });
  const vs = npDmg([b('bonusVsStatus', 50, { status: 'petrified' })], [petrified]);
  assert.equal(vs.dmg, Math.round(base * 1.5));
  assert.ok(!vs.buffs.some(x => x.type === 'bonusVsStatus'));
  assert.equal(npDmg([b('bonusVsStatus', 50, { status: 'petrified' })]).dmg, base);         // not petrified: no bonus
});

test('Gilles: Sea Demons add a 30% follow-up on ~40% of landed Arts attacks', () => {
  let procs = 0, n = 400;
  for (let seed = 1; seed <= n; seed++) {
    const s = createMatch(SERVANTS.gilles, dummy('B'), { seed });
    const r = resolveTurn(s, [atk('arts'), atk('buster')]);
    const demon = r.log.find(l => l.kind === 'extra');
    if (demon) {
      procs++;
      const hit = r.log.find(l => l.type === 'hit' && l.kind === 'attack' && l.from === 0);
      assert.equal(demon.amount, Math.round(hit.amount * 0.3));
    }
  }
  assert.ok(procs / n > 0.33 && procs / n < 0.47, `proc rate ${procs / n}`);
});

test('Terror: ~40% chance the enemy skips a winning attack, then it ends; Curse ticks at end of turn', () => {
  let froze = 0, n = 300;
  for (let seed = 1; seed <= n; seed++) {
    let s = createMatch(SERVANTS.gilles, dummy('B'), { seed });
    s.players[0].ap = 10;
    const r = resolveTurn(s, [skill('evil_eye'), atk('arts')]);
    const curse = r.state.players[1].buffs.find(b => b.type === 'curse');
    assert.equal(curse.value, 30);
    assert.ok(r.log.some(l => l.type === 'curse' && l.player === 1 && l.amount === 30));
    if (r.log.some(l => l.blocked === 'terror')) {
      froze++;
      assert.ok(!r.state.players[1].buffs.some(b => b.type === 'terror'), 'Terror ends once it triggers');
      assert.equal(r.state.players[0].hp, s.players[0].hp);
    }
  }
  assert.ok(froze / n > 0.32 && froze / n < 0.48, `freeze rate ${froze / n}`);
});

test('Diarmuid: Knight\'s Oath boosts Quick and Arts; his NP curses the enemy', () => {
  const s = createMatch(SERVANTS.diarmuid, dummy('B'), { seed: 3 });
  assert.equal(s.players[0].buffs.filter(b => b.type === 'cardUp' && b.turns === null).length, 2);
  s.players[0].np = 100;
  let r = resolveTurn(s, [np(), skill('shield')]).state;
  const hpAfterNp = r.players[1].hp;
  assert.ok(r.players[1].buffs.some(b => b.type === 'curse' && b.value === 30));
  r.players[1].ap = 10;
  r = resolveTurn(r, [skill('love_spot'), skill('charge')]).state;
  assert.equal(r.players[1].hp, hpAfterNp - 30);   // first tick already happened at the end of the NP turn
});

test('Gilles: Mental Pollution makes his debuffs 30% stronger', () => {
  let s = createMatch(SERVANTS.gilles, dummy('B'), { seed: 4 });
  s.players[0].ap = 10; s.players[1].ap = 10;
  s = resolveTurn(s, [skill('mental_pollution'), skill('charge')]).state;
  s.players[0].ap = 10; s.players[1].ap = 10; s.players[1].np = 50;
  s = resolveTurn(s, [skill('blasphemy'), skill('shield')]).state;
  const v = s.players[1].buffs.find(b => b.type === 'cardVuln' && b.card === 'arts');
  assert.equal(v.value, 19.5);                 // 15 × 1.3
  assert.equal(s.players[1].np, 50 - Math.round(15 * 1.3)); // drains 20 instead of 15
});

test('Mordred: Clarent starts her at 50% NP; Cigarette Lion raises max AP and it drops back when it ends', () => {
  let s = createMatch(SERVANTS.mordred, dummy('B'), { seed: 1 });
  assert.equal(s.players[0].np, 50);
  const base = s.players[0].maxAp;
  s.players[0].ap = base;
  s = resolveTurn(s, [skill('cigarette_lion'), atk('quick')]).state;
  assert.equal(s.players[0].maxAp, base + 2);
  assert.ok(s.players[0].ap > base - 3);            // paid 3, gained 2 (+regen), above the old cap is allowed
  for (let t = 0; t < 3; t++) s = resolveTurn(s, [atk('quick'), atk('quick')]).state;
  assert.equal(s.players[0].maxAp, base);
  assert.ok(s.players[0].ap <= base);
  const g = createMatch(SERVANTS.gilgamesh, SERVANTS.mordred, { seed: 1 });   // Ea switches Clarent off
  assert.equal(g.players[1].np, 0);
});

test("Siegfried: Fafnir's Blood marks Dragon ~35% of landed attacks; Dragon Slayer and Balmung hit Dragons harder", () => {
  let marks = 0, n = 400;
  for (let seed = 1; seed <= n; seed++) {
    const r = resolveTurn(createMatch(SERVANTS.siegfried, dummy('B'), { seed }), [atk('buster'), atk('quick')]).state;
    const m = r.players[1].buffs.find(b => b.type === 'statusMark' && b.status === 'dragon');
    if (m) { marks++; assert.equal(m.turns, 1); }   // lasts through the next turn
  }
  assert.ok(marks / n > 0.29 && marks / n < 0.41, `mark rate ${marks / n}`);
  const npDmg = (dragon, slayer) => {
    const s = createMatch(SERVANTS.siegfried, dummy('B'), { seed: 2 });
    s.players[0].np = 100;
    if (dragon) s.players[1].buffs.push({ type: 'statusMark', status: 'dragon', value: 0, turns: 2, debuff: true });
    if (slayer) s.players[0].buffs.push({ type: 'dmgVsStatus', status: 'dragon', value: 30, turns: 3 });
    const r = resolveTurn(s, [np(), atk('quick')]).state;
    return s.players[1].hp - r.players[1].hp;
  };
  const plain = npDmg(false, false), sp = SERVANTS.siegfried;
  assert.ok(Math.abs(npDmg(true, false) - plain * 1.4) <= 1);
  assert.ok(Math.abs(npDmg(true, true) - plain * 1.4 * 1.3) <= 2);
  assert.equal(npDmg(false, true), plain);
  assert.equal(sp.np.vsStatus.value, 40);
});

test('match stats: damage dealt matches HP lost; hits, NPs and chance effects are counted', () => {
  const cards = ['quick', 'arts', 'buster'];
  for (const [a, b] of [['gilles', 'hundred_faces'], ['siegfried', 'medusa'], ['diarmuid', 'lancelot']]) {
    for (let seed = 1; seed <= 20; seed++) {
      let s = createMatch(SERVANTS[a], SERVANTS[b], { seed });
      for (let t = 0; t < 4 && !s.over; t++) {
        s = resolveTurn(s, [0, 1].map(i => {
          if (s.players[i].np >= 100) return np();
          return atk(cards[(seed + t * (i + 1)) % 3]);
        })).state;
      }
      if (s.over) continue;
      for (const i of [0, 1]) {
        const me = s.players[i].stats, foe = s.players[1 - i];
        const dealtTotal = me.dmg.attack + me.dmg.np + me.dmg.extra + me.dmg.curse + me.dmg.poison + me.dmg.shock;
        assert.equal(dealtTotal, foe.maxHp - foe.hp + foe.stats.healed, `${a} vs ${b} seed ${seed}`);
        const landed = me.landed.quick + me.landed.arts + me.landed.buster;
        assert.ok(landed <= me.attempted.quick + me.attempted.arts + me.attempted.buster);
        assert.ok(me.nps.landed <= me.nps.fired);
        for (const v of Object.values(me.procs)) assert.ok(v.hits <= v.tries);
      }
      assert.equal(s.history.at(-1).hp[1], s.players[1].hp);
    }
  }
  // Gilles' Sea Demons are counted per landed Arts attack
  let s = createMatch(SERVANTS.gilles, dummy('B'), { seed: 9 });
  s = resolveTurn(s, [atk('arts'), atk('buster')]).state;
  assert.equal(s.players[0].stats.procs['Summoning: Sea Demons (follow-up hits)'].tries, 1);
});

test('Atalanta: Golden Apple adds 50% on ~35% of landed Quick attacks; a beaten Quick may fire a full second arrow', () => {
  let extra = 0, arrows = 0, n = 400;
  for (let seed = 1; seed <= n; seed++) {
    const r = resolveTurn(createMatch(SERVANTS.atalanta, dummy('B'), { seed }), [atk('quick'), atk('arts')]);   // Quick beats Arts
    const hit = r.log.find(l => l.type === 'hit' && l.kind === 'attack' && l.from === 0);
    const x = r.log.find(l => l.kind === 'extra' && l.from === 0);
    if (x) { extra++; assert.equal(x.amount, Math.round(hit.amount * 0.5)); }
    const r2 = resolveTurn(createMatch(SERVANTS.atalanta, dummy('B'), { seed }), [atk('quick'), atk('buster')]); // Buster beats Quick
    const second = r2.log.find(l => l.secondArrow);
    if (second) {
      arrows++;
      const plain = resolveTurn(createMatch(SERVANTS.atalanta, dummy('B'), { seed }), [atk('quick'), skill('charge')]).log
        .find(l => l.type === 'hit' && l.from === 0 && l.kind === 'attack');
      assert.ok(Math.abs(second.amount - plain.amount) <= 1, 'second arrow is a full, non-counter hit');
    }
  }
  assert.ok(extra / n > 0.28 && extra / n < 0.42, `extra ${extra / n}`);
  assert.ok(arrows / n > 0.28 && arrows / n < 0.42, `arrows ${arrows / n}`);
  // Evade still stops the second arrow
  let blocked = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const s = createMatch(SERVANTS.atalanta, dummy('B'), { seed });
    s.players[1].buffs.push({ type: 'evade', value: 0, turns: 2 });
    const r = resolveTurn(s, [atk('quick'), atk('buster')]);
    assert.equal(r.state.players[1].hp, 1000);
    if (r.log.some(l => l.type === 'blocked' && l.secondArrow)) blocked++;
  }
  assert.ok(blocked > 15);
});

test("Chiron: Teacher's Wisdom has 3 uses, Ea switches it off; Eternal Consecration can't KO; Antares strips defenses first", () => {
  let s = createMatch(SERVANTS.chiron, dummy('B'), { seed: 1 });
  assert.equal(getLegalActions(s, 0).foresight, 3);
  for (let k = 0; k < 3; k++) s = resolveTurn(s, [{ ...atk('arts'), foresight: true }, atk('quick')]).state;
  assert.equal(getLegalActions(s, 0).foresight, 0);
  assert.match(validateAction(s, 0, { ...atk('arts'), foresight: true }), /Teacher's Wisdom/);
  assert.equal(s.players[0].stats.procs["Teacher's Wisdom (opponent's move read)"].hits, 3);
  assert.equal(getLegalActions(createMatch(SERVANTS.gilgamesh, SERVANTS.chiron), 1).foresight, 0);

  let c = createMatch(SERVANTS.chiron, dummy('B'), { seed: 2 });
  c.players[0].hp = 10; c.players[0].ap = 3;
  c = resolveTurn(c, [skill('eternal_consecration'), skill('charge')]).state;
  assert.equal(c.players[0].hp, 1);
  assert.equal(c.players[0].ap, 3 - 3 + 6);

  const npDmg = defBuffs => {
    const x = createMatch(SERVANTS.chiron, dummy('B'), { seed: 3 });
    x.players[0].np = 100; x.players[1].buffs.push(...defBuffs);
    const r = resolveTurn(x, [np(), atk('quick')]).state;
    return { dmg: 1000 - r.players[1].hp, left: r.players[1].buffs };
  };
  const plain = npDmg([]).dmg;
  const guarded = npDmg([{ type: 'damageCut', value: 50, turns: 2 }, { type: 'invincible', value: 0, turns: 1 }]);
  assert.equal(guarded.dmg, plain);
  assert.equal(guarded.left.filter(b => ['damageCut', 'invincible'].includes(b.type)).length, 0);
});

test('Vlad III: Protection of Faith revives at 15% and grants removable NP gain; Bloodsucker steals NP', () => {
  let s = createMatch(SERVANTS.vlad, dummy('B'), { seed: 1 });
  s.players[0].hp = 1; s.players[0].ap = 10;
  s = resolveTurn(s, [skill('legend_of_dracula'), atk('arts')]).state;   // dummy hits through: KO -> revive
  const v = s.players[0];
  assert.equal(v.hp, Math.round(v.maxHp * 0.15));
  const npg = v.buffs.find(b => b.type === 'npGainUp' && b.source === 'Protection of Faith');
  assert.ok(npg && npg.turns > 50 && npg.value === 30);
  const r = createMatch(SERVANTS.medea, SERVANTS.vlad, { seed: 2 });
  r.players[1].buffs.push({ ...npg }); r.players[0].np = 100;
  const after = resolveTurn(r, [np(), atk('quick')]).state;               // Rule Breaker strips buffs
  assert.ok(!after.players[1].buffs.some(b => b.type === 'npGainUp' && b.source === 'Protection of Faith'));

  let b = createMatch(SERVANTS.vlad, dummy('B'), { seed: 3 });
  b.players[1].np = 50; b.players[0].np = 10; b.players[0].ap = 10; b.players[1].ap = 10;
  b = resolveTurn(b, [skill('bloodsucker'), skill('shield')]).state;
  assert.equal(b.players[1].np, 30);
  assert.equal(b.players[0].np, 30);
});

test("Karna: NP Seal makes a same-turn NP fizzle and costs 20% gauge; debuff resist down; Son of the Sun God", () => {
  let s = createMatch(SERVANTS.karna, SERVANTS.artoria, { seed: 1 });
  s.players[1].np = 100; s.players[0].ap = 10;
  const hp = s.players[0].hp;
  const r = resolveTurn(s, [skill('knowledge_of_deprived'), np()]);
  assert.equal(r.state.players[0].hp, hp);
  const sealed = r.state.players[1].np;
  assert.ok(sealed >= 80 && sealed < 100, `gauge ${sealed}`);           // 20%, a little less through Magic Resistance
  assert.ok(r.log.some(l => l.blocked === 'npSeal'));
  assert.ok(!r.state.players[1].buffs.some(b => b.type === 'npSeal'), 'NP Seal lasts only this turn');
  assert.ok(r.state.players[1].buffs.some(b => b.type === 'debuffResistDown'));
  const k = createMatch(SERVANTS.karna, dummy('B'));
  assert.ok(k.players[0].buffs.some(b => b.type === 'npUp' && b.turns === null && b.value === 10));
});

test('Sure Hit (e.g. Chiron\'s Wisdom of Divine) always hits through One Hundred Personas decoys and Evade', () => {
  let missesWithout = 0;
  for (let seed = 1; seed <= 300; seed++) {
    let s = createMatch(SERVANTS.chiron, SERVANTS.hundred_faces, { seed });
    s.players[0].ap = 10; s.players[1].ap = 10;
    s = resolveTurn(s, [skill('wisdom_of_divine'), skill('expert')]).state;     // Sure Hit vs Evade + decoys
    assert.ok(s.players[0].buffs.some(b => b.type === 'sureHit'));
    const hp = s.players[1].hp;
    const r = resolveTurn(s, [atk('arts'), skill('battle_retreat')]);          // Hundred Faces doesn't attack
    assert.ok(r.state.players[1].hp < hp + Math.round(r.state.players[1].maxHp * 0.3), `seed ${seed}: Sure Hit attack missed`);
    assert.ok(!r.log.some(l => /decoy/.test(l.msg)), `seed ${seed}: decoy triggered`);
    const plain = resolveTurn(createMatch(dummy('A'), SERVANTS.hundred_faces, { seed }), [atk('arts'), atk('buster')]);
    if (plain.log.some(l => /decoy/.test(l.msg))) missesWithout++;
  }
  assert.ok(missesWithout > 10, 'without Sure Hit, decoys do trigger');
});

test("Kojirou: Heaven Among the Mountains pierces Evade on Quick but isn't Sure Hit; Knowledge of the Souwa is real Sure Hit", () => {
  const withEvade = s => { s.players[1].buffs.push({ type: 'evade', value: 0, turns: 2 }); return s; };
  // Passive: Quick goes through Evade, flagged as pierce but not Sure Hit
  let r = resolveTurn(withEvade(createMatch(SERVANTS.kojirou, dummy('B'), { seed: 1 })), [atk('quick'), atk('arts')]);
  const hit = r.log.find(l => l.type === 'hit' && l.from === 0 && l.kind === 'attack');
  assert.ok(hit && hit.pierce === true && hit.sureHit === false);
  // Passive doesn't cover Arts
  r = resolveTurn(withEvade(createMatch(SERVANTS.kojirou, dummy('B'), { seed: 1 })), [atk('arts'), atk('buster')]);
  assert.ok(r.log.some(l => l.type === 'blocked' && l.from === 0));
  // Knowledge of the Souwa: true Sure Hit on every card
  let s = createMatch(SERVANTS.kojirou, dummy('B'), { seed: 2 });
  s.players[0].ap = 10;
  s = resolveTurn(s, [skill('souwa'), atk('quick')]).state;
  r = resolveTurn(withEvade(s), [atk('arts'), atk('buster')]);
  const h2 = r.log.find(l => l.type === 'hit' && l.from === 0 && l.kind === 'attack');
  assert.ok(h2 && h2.sureHit === true);
  assert.match(SERVANTS.kojirou.skills.find(k => k.id === 'souwa').desc, /Sure Hit/);
});

test('Achilles: only an NP can down him; a true Sure Hit attack breaks Akhilleus Kosmos (Kojirou\'s passive does not)', () => {
  // A lethal regular attack leaves him at 1 HP
  let s = createMatch(dummy('A'), SERVANTS.achilles, { seed: 1 });
  s.players[1].hp = 5;
  let r = resolveTurn(s, [atk('arts'), atk('buster')]).state;   // Arts beats Buster
  assert.equal(r.players[1].hp, 1);
  assert.equal(r.over, false);
  // An NP can down him
  s = createMatch(dummy('A'), SERVANTS.achilles, { seed: 1 });
  s.players[1].hp = 5; s.players[0].np = 100;
  assert.equal(resolveTurn(s, [np(), atk('quick')]).state.over, true);
  // Kojirou's Heaven Among the Mountains (not Sure Hit) leaves Kosmos intact
  s = createMatch(SERVANTS.kojirou, SERVANTS.achilles, { seed: 1 });
  r = resolveTurn(s, [atk('quick'), atk('arts')]).state;
  assert.ok(r.players[1].buffs.some(b => b.type === 'npOnlyKo'));
  // Knowledge of the Souwa (true Sure Hit) breaks it, then a regular attack can finish him
  s = createMatch(SERVANTS.kojirou, SERVANTS.achilles, { seed: 1 });
  s.players[0].ap = 10;
  s = resolveTurn(s, [skill('souwa'), atk('buster')]).state;
  s = resolveTurn(s, [atk('quick'), atk('arts')]).state;
  assert.ok(!s.players[1].buffs.some(b => b.type === 'npOnlyKo'));
  s.players[1].hp = 5;
  assert.equal(resolveTurn(s, [atk('quick'), atk('arts')]).state.over, true);
});

test('Achilles: Taunt forces attacks next turn; Troias Tragōidia confuses (~40% a skill fizzles, then it ends)', () => {
  let s = createMatch(SERVANTS.achilles, dummy('B'), { seed: 1 });
  s.players[0].ap = 10;
  s = resolveTurn(s, [skill('star_spear'), skill('charge')]).state;
  const legal = getLegalActions(s, 1);
  assert.ok(legal.taunted && legal.skills.length === 0 && !legal.np);
  assert.match(validateAction(s, 1, skill('shield')), /./);
  s = resolveTurn(s, [atk('quick'), atk('arts')]).state;
  assert.equal(getLegalActions(s, 1).taunted, false);              // only one turn
  let fumbles = 0, n = 300;
  for (let seed = 1; seed <= n; seed++) {
    let c = createMatch(SERVANTS.achilles, dummy('B'), { seed });
    c.players[0].np = 100;
    c = resolveTurn(c, [np(), atk('quick')]).state;
    assert.ok(c.players[1].buffs.some(b => b.type === 'confusion'));
    c.players[1].ap = 10;
    const r = resolveTurn(c, [atk('quick'), skill('shield')]);
    if (r.log.some(l => l.blocked === 'confusion')) {
      fumbles++;
      assert.ok(!r.state.players[1].buffs.some(b => b.type === 'confusion'));
    }
  }
  assert.ok(fumbles / n > 0.3 && fumbles / n < 0.5, `fumble ${fumbles / n}`);
});

test('Astolfo: Black Luna Terror on ~10% of hits; Trap of Argalia ~50% skip next turn; Evaporation AP chance; Hippogriff ignores damage cut', () => {
  let terror = 0, n = 600;
  for (let seed = 1; seed <= n; seed++) {
    const r = resolveTurn(createMatch(SERVANTS.astolfo, dummy('B'), { seed }), [atk('quick'), atk('arts')]).state;
    if (r.players[1].buffs.some(b => b.type === 'terror')) terror++;
  }
  assert.ok(terror / n > 0.06 && terror / n < 0.14, `terror ${terror / n}`);
  let skipped = 0;
  for (let seed = 1; seed <= 300; seed++) {
    let s = createMatch(SERVANTS.astolfo, dummy('B'), { seed });
    s.players[0].ap = 10;
    s = resolveTurn(s, [skill('trap_of_argalia'), atk('quick')]).state;
    const r = resolveTurn(s, [atk('quick'), atk('buster')]);              // Buster would beat Quick
    if (r.log.some(l => l.blocked === 'stun')) { skipped++; assert.ok(!r.log.some(l => l.type === 'hit' && l.from === 1)); }
    assert.ok(!r.state.players[1].buffs.some(b => b.type === 'stun'));
  }
  assert.ok(skipped / 300 > 0.4 && skipped / 300 < 0.6, `skipped ${skipped / 300}`);
  let s = createMatch(SERVANTS.astolfo, dummy('B'), { seed: 4 });
  s.players[0].ap = 10;
  s = resolveTurn(s, [skill('evaporation'), atk('quick')]).state;
  assert.ok(s.players[0].stats.procs['Evaporation of Sanity D+ (bonus AP)'].tries === 1);
  const npDmg = cut => {
    const x = createMatch(SERVANTS.astolfo, dummy('B'), { seed: 5 });
    x.players[0].np = 100;
    if (cut) x.players[1].buffs.push({ type: 'damageCut', value: 50, turns: 2 });
    const r = resolveTurn(x, [np(), atk('quick')]).state;
    return { dmg: 1000 - r.players[1].hp, evade: r.players[0].buffs.some(b => b.type === 'evade') };
  };
  assert.equal(npDmg(true).dmg, npDmg(false).dmg);
  assert.ok(npDmg(false).evade);
});

test('Jack: Misty Night flips ~20% of Quick-vs-Buster clashes; Information Erasure strips buffs and drains AP; Maria ignores cut', () => {
  let flips = 0, n = 600;
  for (let seed = 1; seed <= n; seed++) {
    const r = resolveTurn(createMatch(SERVANTS.jack, dummy('B'), { seed }), [atk('quick'), atk('buster')]);
    const jackHit = r.log.some(l => l.type === 'hit' && l.from === 0 && l.reason === 'counter');
    const foeHit = r.log.some(l => l.type === 'hit' && l.from === 1);
    if (jackHit) { flips++; assert.ok(!foeHit, 'the Buster attack is countered'); }
    else assert.ok(foeHit);
  }
  assert.ok(flips / n > 0.15 && flips / n < 0.25, `flip rate ${flips / n}`);
  // Never triggers in other matchups
  const r = resolveTurn(createMatch(SERVANTS.jack, dummy('B'), { seed: 1 }), [atk('quick'), atk('arts')]);
  assert.ok(!r.state.players[0].stats.procs['The Misty Night of London (clashes overturned)']);

  let s = createMatch(SERVANTS.jack, SERVANTS.artoria, { seed: 2 });
  s.players[0].ap = 10; s.players[1].ap = 8;
  s.players[1].buffs.push({ type: 'atkUp', value: 20, turns: 3, source: 'x' });
  s = resolveTurn(s, [skill('information_erasure'), atk('quick')]).state;
  assert.ok(!s.players[1].buffs.some(b => b.source === 'x'));
  assert.ok(s.players[1].buffs.some(b => b.turns === null), 'passives stay');
  const npDmg = cut => {
    const x = createMatch(SERVANTS.jack, dummy('B'), { seed: 5 });
    x.players[0].np = 100;
    if (cut) x.players[1].buffs.push({ type: 'damageCut', value: 50, turns: 2 });
    return 1000 - resolveTurn(x, [np(), atk('quick')]).state.players[1].hp;
  };
  assert.equal(npDmg(true), npDmg(false));
});

test('Semiramis: Poison stacks and ticks; Ambiguous Chalice ~30%; Double Summon makes the enemy deal base damage', () => {
  let s = createMatch(SERVANTS.semiramis, dummy('B'), { seed: 1 });
  s.players[0].ap = 20; s.players[0].maxAp = 20;
  s = resolveTurn(s, [skill('sikera_usum'), skill('charge')]).state;
  assert.equal(s.players[1].buffs.filter(b => b.type === 'poison').length, 1);
  s.players[1].buffs.push({ type: 'poison', value: 20, turns: 3, debuff: true, status: 'poisoned' });
  const hp = s.players[1].hp;
  s.players[1].ap = 10;
  const r = resolveTurn(s, [skill('familiar_pigeon'), skill('shield')]);
  assert.equal(r.state.players[1].hp, hp - 50);                       // 30 + 20 stacked
  assert.ok(r.log.some(l => /2 stacks/.test(l.msg)));
  assert.equal(r.state.players[0].stats.dmg.poison, 30 + 50);

  let pois = 0, n = 500;
  for (let seed = 1; seed <= n; seed++) {
    const x = resolveTurn(createMatch(SERVANTS.semiramis, dummy('B'), { seed }), [atk('arts'), atk('buster')]).state;
    if (x.players[1].buffs.some(b => b.type === 'poison')) pois++;
  }
  assert.ok(pois / n > 0.24 && pois / n < 0.36, `poison rate ${pois / n}`);

  // Double Summon: a heavily buffed Artoria hits for exactly what an unbuffed one would
  const hitFor = (summoned, buffed) => {
    const x = createMatch(SERVANTS.semiramis, SERVANTS.artoria, { seed: 3 });
    x.players[0].ap = 10;
    if (buffed) x.players[1].buffs.push({ type: 'atkUp', value: 40, turns: 3 }, { type: 'flatDamage', value: 30, turns: 3 });
    const y = summoned ? resolveTurn(x, [skill('double_summon'), atk('arts')]).state : x;
    if (!summoned) y.players[0].ap = 10;
    const z = resolveTurn(y, [skill('familiar_pigeon'), atk('buster')]);
    return z.log.find(l => l.type === 'hit' && l.from === 1).amount;
  };
  assert.ok(hitFor(false, true) > hitFor(false, false));
  // Artoria's own passives are ignored too, so summoned < plain unbuffed
  assert.ok(hitFor(true, true) <= hitFor(false, false));
  assert.equal(hitFor(true, true), hitFor(true, false));
});

test('Off-ladder ranks: Presence Concealment C+ sits between B and C', () => {
  const d = SERVANTS.semiramis.passives[0];
  assert.match(d.name, /C\+/);
  assert.equal(d.effects[0].value, 7);
});

// Find a seed whose Works of Art roll lands on the given work.
const withWork = (name, opp = dummy('B')) => {
  for (let seed = 1; seed < 500; seed++) {
    const s = createMatch(SERVANTS.shakespeare, opp, { seed });
    if (s.players[0].work.name === name) return s;
  }
  throw new Error('no seed for ' + name);
};

test('Shakespeare: Works of Art rolls one work per battle by weight, seeded; Ea blocks it', () => {
  const c = {};
  for (let seed = 1; seed <= 2000; seed++) {
    const w = createMatch(SERVANTS.shakespeare, dummy('B'), { seed }).players[0].work.name;
    c[w] = (c[w] ?? 0) + 1;
  }
  assert.ok(c.Macbeth > 520 && c.Macbeth < 680, `Macbeth ${c.Macbeth}`);
  assert.ok(c['Romeo and Juliet'] > 140 && c['Romeo and Juliet'] < 260);
  assert.equal(createMatch(SERVANTS.shakespeare, dummy('B'), { seed: 7 }).players[0].work.name,
               createMatch(SERVANTS.shakespeare, dummy('B'), { seed: 7 }).players[0].work.name);
  const m = withWork('Macbeth');
  assert.equal(m.players[0].buffs.filter(b => b.type === 'cardUp' && b.turns === null && b.source === 'Works of Art: Macbeth').length, 3);
  assert.equal(createMatch(SERVANTS.shakespeare, SERVANTS.gilgamesh, { seed: 1 }).players[0].work, undefined);
});

test('Shakespeare: Hamlet Madness forces a random action; Midsummer Charm throws the next clash', () => {
  let s = withWork('Hamlet');
  s.players[1].buffs.push({ type: 'madness', value: 1, turns: 2, debuff: true, source: 'Works of Art: Hamlet' });
  s = resolveTurn(s, [atk('arts'), atk('quick')]).state;                 // arms at end of turn
  const r = resolveTurn(s, [atk('arts'), atk('quick')]);
  assert.ok(r.log.some(l => /Madness/.test(l.msg)));
  assert.ok(!r.state.players[1].buffs.some(b => b.type === 'madness'));

  let c = withWork("A Midsummer Night's Dream");
  c.players[1].buffs.push({ type: 'charm', value: 1, turns: 2, debuff: true, source: "Works of Art: A Midsummer Night's Dream" });
  c = resolveTurn(c, [skill('the_globe'), skill('charge')]).state;
  const r2 = resolveTurn(c, [atk('buster'), atk('arts')]);               // Arts would beat Buster, but Charm turns it to Quick
  assert.ok(r2.log.some(l => l.type === 'hit' && l.from === 0 && l.reason === 'counter'));
  assert.ok(!r2.log.some(l => l.type === 'hit' && l.from === 1));
});

test('Shakespeare: Romeo and Juliet can end a KO in a draw; Othello reveals lie ~40% of the time', () => {
  let draws = 0, n = 300;
  for (let seed = 1; seed <= n; seed++) {
    const s = withWork('Romeo and Juliet');
    s.rng = seed;
    s.players[1].hp = 1;
    const r = resolveTurn(s, [atk('arts'), atk('buster')]).state;
    assert.ok(r.over);
    if (r.result.winner === null) draws++;
  }
  assert.ok(draws / n > 0.05 && draws / n < 0.16, `draws ${draws / n}`);
  const o = withWork('Othello');
  assert.equal(getLegalActions(o, 0).foresight, 3);
  let lies = 0, seed = 3;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let k = 0; k < 1000; k++) {
    const seen = foresightView(o, 0, atk('quick'), rand);
    if (seen.main.card !== 'quick' || seen.main.type !== 'attack') lies++;
  }
  assert.ok(lies > 330 && lies < 470, `lies ${lies}`);
  const honest = createMatch(SERVANTS.chiron, dummy('B'), { seed: 1 });
  assert.deepEqual(foresightView(honest, 0, atk('quick'), rand), atk('quick'));
});

test("Avicebron: Golem's Support ~40% on landed Buster; Fig Tree heals above 30% HP, Invincible below", () => {
  let golems = 0, n = 400;
  for (let seed = 1; seed <= n; seed++) {
    const r = resolveTurn(createMatch(SERVANTS.avicebron, dummy('B'), { seed }), [atk('buster'), atk('quick')]);
    const g = r.log.find(l => l.kind === 'extra' && l.from === 0);
    if (g) { golems++; assert.match(g.msg, /Golem/); }
  }
  assert.ok(golems / n > 0.33 && golems / n < 0.47, `golems ${golems / n}`);
  let s = createMatch(SERVANTS.avicebron, dummy('B'), { seed: 1 });
  s.players[0].ap = 10; s.players[0].hp = Math.round(s.players[0].maxHp * 0.5);
  let r = resolveTurn(s, [skill('fig_tree'), skill('charge')]).state;
  assert.equal(r.players[0].hp, Math.round(s.players[0].maxHp * 0.5) + Math.round(s.players[0].maxHp * 0.3));
  assert.ok(!r.players[0].buffs.some(b => b.type === 'invincible'));
  s = createMatch(SERVANTS.avicebron, dummy('B'), { seed: 1 });
  s.players[0].ap = 10; s.players[0].hp = 100;
  r = resolveTurn(s, [skill('fig_tree'), atk('arts')]);
  assert.equal(r.state.players[0].hp, 100);                            // no heal, and the attack is blocked
  assert.ok(r.log.some(l => l.type === 'blocked' && l.from === 1));
});

test('Frankenstein: Shock stacks; Lament lands ~60%; Overload Burn hurts her, refreshes instead of stacking', () => {
  let s = createMatch(SERVANTS.frankenstein, dummy('B'), { seed: 1 });
  s.players[1].buffs.push({ type: 'shock', value: 20, turns: 3, debuff: true }, { type: 'shock', value: 30, turns: 3, debuff: true });
  s.players[1].ap = 10;
  const hp = s.players[1].hp;
  let r = resolveTurn(s, [skill('galvanism'), skill('shield')]);
  assert.equal(r.state.players[1].hp, hp - 50);
  assert.equal(r.state.players[0].stats.dmg.shock, 50);
  let landed = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const x = createMatch(SERVANTS.frankenstein, dummy('B'), { seed });
    x.players[0].ap = 10;
    const y = resolveTurn(x, [skill('lament'), atk('quick')]).state;
    if (y.players[1].buffs.some(b => b.type === 'shock' && b.source === 'lament')) landed++;
    assert.ok(y.players[1].buffs.some(b => b.type === 'defDown'));   // DEF down always lands
  }
  assert.ok(landed / 300 > 0.5 && landed / 300 < 0.7, `lament ${landed / 300}`);
  let o = createMatch(SERVANTS.frankenstein, dummy('B'), { seed: 2 });
  o.players[0].ap = 10; o.players[1].ap = 10;
  const fhp = o.players[0].hp;
  o = resolveTurn(o, [skill('overload'), skill('shield')]).state;
  assert.equal(o.players[0].hp, fhp - 20);
  o.players[0].ap = 10; o.players[0].lastSkillId = null; o.players[1].ap = 10;
  o = resolveTurn(o, [skill('galvanism'), skill('charge')]).state;
  o.players[0].ap = 10; o.players[0].lastSkillId = null;
  o = resolveTurn(o, [skill('overload'), skill('shield')]).state;
  assert.equal(o.players[0].buffs.filter(b => b.type === 'burn').length, 1);
});

test('Spartacus: Unyielding Will — 1 HP + full NP, forced NP next turn, falls after unless the enemy went down', () => {
  let s = createMatch(dummy('A'), SERVANTS.spartacus, { seed: 1 });
  s.players[1].hp = 5;
  s = resolveTurn(s, [atk('arts'), atk('buster')]).state;            // lethal
  assert.equal(s.over, false);
  assert.equal(s.players[1].hp, 1);
  assert.equal(s.players[1].np, 100);
  const legal = getLegalActions(s, 1);
  assert.ok(legal.lastStand && legal.attacks.length === 0 && legal.skills.length === 0 && legal.np);
  assert.match(validateAction(s, 1, atk('buster')), /./);
  // Enemy survives his NP: he falls at the end of the turn, even though their attack can't KO him first
  let a = structuredClone(s);
  a.players[0].hp = 5000; a.players[0].maxHp = 5000;
  a = resolveTurn(a, [atk('quick'), np()]).state;
  assert.ok(a.over && a.result.winner === 0);
  // His NP takes the enemy down: he wins, standing at 1 HP
  let b = structuredClone(s);
  b.players[0].hp = 10;
  b = resolveTurn(b, [atk('quick'), np()]).state;
  assert.ok(b.over && b.result.winner === 1);
  // Gilgamesh's Ea switches it off; Trace On can't copy it
  assert.ok(!createMatch(SERVANTS.gilgamesh, SERVANTS.spartacus).players[1].buffs.some(x => x.type === 'lastStand'));
  assert.ok(createMatch(SERVANTS.emiya, SERVANTS.spartacus).players[0].copyBlocked.includes('Unyielding Will'));
});

test('Spartacus: Honor of the Battered heals 8% at the end of each turn', () => {
  let s = createMatch(SERVANTS.spartacus, dummy('B'), { seed: 1 });
  s.players[0].ap = 10; s.players[1].ap = 10; s.players[0].hp = 300;
  s = resolveTurn(s, [skill('honor_of_battered'), skill('shield')]).state;
  assert.equal(s.players[0].hp, 300 + Math.round(s.players[0].maxHp * 0.08));
});

test("Jeanne: Divine Intervention negates one damaging hit (not DoT), can't stack, is stripped by Rule Breaker", () => {
  let s = createMatch(SERVANTS.jeanne, dummy('B'), { seed: 1 });
  s.players[0].np = 100;
  s = resolveTurn(s, [np(), atk('quick')]).state;
  assert.equal(s.players[0].buffs.filter(b => b.type === 'divineIntervention').length, 1);
  s.players[0].hp = 500;
  const hp = s.players[0].hp;
  let r = resolveTurn(s, [{ ...atk('buster'), divine: [true] }, atk('arts')]);   // dummy's Arts beats Buster: she uses it
  assert.ok(r.log.some(l => l.blocked === 'divine'));
  assert.equal(r.state.players[0].hp, hp + Math.round(r.state.players[0].maxHp * 0.03));   // only the passive heal
  assert.ok(!r.state.players[0].buffs.some(b => b.type === 'divineIntervention'));
  // DoT goes through
  let d = structuredClone(s);
  d.players[0].buffs.push({ type: 'poison', value: 40, turns: 3, debuff: true });
  d.players[1].ap = 10; d.players[0].ap = 10;
  const t = resolveTurn(d, [skill('pure_and_clear'), skill('shield')]).state;
  assert.ok(t.players[0].buffs.some(b => b.type === 'divineIntervention'));
  assert.ok(t.players[0].hp < d.players[0].hp + Math.round(d.players[0].maxHp * 0.03));
  // Rule Breaker strips it
  let m = createMatch(SERVANTS.medea, SERVANTS.jeanne, { seed: 3 });
  m.players[1].buffs.push({ type: 'divineIntervention', value: 1, turns: 99, source: 'np' });
  m.players[0].np = 100;
  const mr = resolveTurn(m, [np(), atk('quick')]);
  assert.ok(!mr.log.some(l => l.blocked === 'divine'));
});

test("Jeanne: God's Resolution blinds ~80% (AP back on a miss); Holy Light lowers NP damage and DEF", () => {
  let blinded = 0, apBack = 0, n = 300;
  for (let seed = 1; seed <= n; seed++) {
    let s = createMatch(SERVANTS.jeanne, dummy('B'), { seed });
    s.players[0].ap = 6;
    s = resolveTurn(s, [skill('gods_resolution'), atk('quick')]).state;
    if (s.players[1].buffs.some(b => b.type === 'stun')) {
      blinded++;
      const r = resolveTurn(s, [atk('quick'), atk('buster')]);
      assert.ok(r.log.some(l => /Blinded by Holy Light/.test(l.msg)));
    } else if (s.players[0].ap >= 3) apBack++;
  }
  assert.ok(blinded / n > 0.72 && blinded / n < 0.88, `blind ${blinded / n}`);
  assert.equal(blinded + apBack, n);
  let h = createMatch(SERVANTS.jeanne, SERVANTS.artoria, { seed: 2 });
  h.players[0].ap = 10;
  h = resolveTurn(h, [skill('brilliant_holy_light'), atk('quick')]).state;
  const defs = h.players[1].buffs.filter(b => b.type === 'defDown');
  assert.equal(defs.length, 2);
  assert.ok(defs.some(b => b.turns === 1) && defs.some(b => b.turns === 2));
  assert.ok(h.players[1].buffs.some(b => b.type === 'npDown'));
});

test('Amakusa: the master picks a hand with the first action; Left = own buffs +1 turn, Right = debuffs on the enemy +1 turn', () => {
  const s = createMatch(SERVANTS.amakusa, dummy('B'), { seed: 1 });
  assert.equal(getLegalActions(s, 0).choice.length, 2);
  assert.match(validateAction(s, 0, atk('quick')), /Choose/);
  const turnsOf = (hand, id, pick) => {
    let x = createMatch(SERVANTS.amakusa, dummy('B'), { seed: 1 });
    x.players[0].ap = 10;
    x = resolveTurn(x, [{ ...skill(id), choice: hand }, atk('quick')]).state;
    assert.equal(getLegalActions(x, 0).choice, null);
    return pick(x);
  };
  const buffT = p => p.players[0].buffs.find(b => b.type === 'cardUp' && b.card === 'buster' && b.turns !== null).turns;
  const vulnT = p => p.players[1].buffs.find(b => b.type === 'cardVuln').turns;
  assert.equal(turnsOf('left', 'gods_resolution_false', buffT), turnsOf('right', 'gods_resolution_false', buffT) + 1);
  assert.equal(turnsOf('right', 'grail_fiery_heavens', vulnT), turnsOf('left', 'grail_fiery_heavens', vulnT) + 1);
});

test("Amakusa: Twin Arm strips buffs before it hits; Grail of Fiery Heavens drains and regenerates NP", () => {
  const npDmg = buffs => {
    const x = createMatch(SERVANTS.amakusa, dummy('B'), { seed: 5 });
    x.players[0].np = 100; x.players[1].buffs.push(...buffs);
    const r = resolveTurn(x, [{ ...np(), choice: 'left' }, atk('quick')]).state;
    return { dmg: 1000 - r.players[1].hp, left: r.players[1].buffs.length };
  };
  assert.equal(npDmg([{ type: 'damageCut', value: 50, turns: 2 }, { type: 'divineIntervention', value: 1, turns: 99 }]).dmg, npDmg([]).dmg);
  let g = createMatch(SERVANTS.amakusa, dummy('B'), { seed: 2 });
  g.players[0].ap = 10; g.players[1].np = 50; g.players[1].ap = 10;
  g = resolveTurn(g, [{ ...skill('grail_fiery_heavens'), choice: 'left' }, skill('shield')]).state;
  assert.equal(g.players[1].np, 30);
  assert.equal(g.players[0].np, 20 + 5);
});


test('Divine Intervention is the master\'s choice: the turn pauses at each hit, and declining keeps it', () => {
  let s = createMatch(SERVANTS.jeanne, dummy('B'), { seed: 1 });
  s.players[0].buffs.push({ type: 'divineIntervention', value: 1, turns: 99, source: 'np' });
  s.players[0].hp = 500;
  const acts = [atk('buster'), atk('arts')];
  const ask = resolveTurn(s, acts, { interactive: [true, false] });
  assert.ok(ask.needsDecision);
  assert.equal(ask.needsDecision.player, 0);
  assert.ok(ask.needsDecision.amount > 0 && /Arts attack/.test(ask.needsDecision.what));
  // decline: damage taken, Divine Intervention kept
  const no = resolveTurn(s, [{ ...acts[0], divine: [false] }, acts[1]], { interactive: [true, false] });
  assert.ok(no.state.players[0].hp < 500);
  assert.ok(no.state.players[0].buffs.some(b => b.type === 'divineIntervention'));
  assert.ok(no.log.some(l => /in reserve/.test(l.msg)));
  // use: negated, spent; the replay is otherwise identical (same RNG)
  const yes = resolveTurn(s, [{ ...acts[0], divine: [true] }, acts[1]], { interactive: [true, false] });
  assert.equal(yes.state.players[0].hp, 500 + Math.round(yes.state.players[0].maxHp * 0.03));
  assert.ok(!yes.state.players[0].buffs.some(b => b.type === 'divineIntervention'));
  assert.equal(yes.state.rng, no.state.rng);
  // non-interactive (CPU/simulator): uses it on a lethal hit
  s.players[0].hp = 5;
  const cpu = resolveTurn(s, acts);
  assert.ok(cpu.log.some(l => l.blocked === 'divine'));
});

test('Angra: Verg Avesta drags the enemy down to his HP % (unblockable), or lowers his own to theirs', () => {
  let s = createMatch(SERVANTS.angra, dummy('B'), { seed: 1 });
  const A = s.players[0], B = s.players[1];
  A.hp = Math.round(A.maxHp * 0.3); A.np = 100;
  B.buffs.push({ type: 'invincible', value: 0, turns: 2 }, { type: 'damageCut', value: 50, turns: 2 });
  let r = resolveTurn(s, [np(), atk('quick')]);
  // the dummy's Quick attack is overpowered by the NP; enemy ends at 30% (no end-of-turn effects on the dummy)
  assert.equal(r.state.players[1].hp, Math.round(B.maxHp * 0.3));
  assert.ok(r.log.some(l => /dragged down/.test(l.msg)));
  // higher: his own HP falls instead, enemy untouched
  s = createMatch(SERVANTS.angra, dummy('B'), { seed: 1 });
  s.players[1].hp = Math.round(s.players[1].maxHp * 0.4); s.players[0].np = 100;
  const before = s.players[1].hp;
  r = resolveTurn(s, [np(), atk('quick')]);
  assert.equal(r.state.players[1].hp, before);
  const pct = r.state.players[0].hp / r.state.players[0].maxHp;
  assert.ok(Math.abs(pct - 0.4) < 0.04, `pct ${pct}`);   // + a little NP-free regen noise only
});

test("Angra: All the World's Evils — chance effects always land; Power Boost per debuff grows as HP falls; Avenger NP gain", () => {
  // Lament's 60% Shock always lands on him; God's Resolution's Blind (stops him acting) still rolls 80%
  let blinded = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const f = createMatch(SERVANTS.frankenstein, SERVANTS.angra, { seed });
    f.players[0].ap = 10;
    const ft = resolveTurn(f, [skill('lament'), atk('quick')]).state;
    assert.ok(ft.players[1].buffs.some(b => b.type === 'shock'), `seed ${seed}`);
    const s = createMatch(SERVANTS.jeanne, SERVANTS.angra, { seed });
    s.players[0].ap = 6;
    const t = resolveTurn(s, [skill('gods_resolution'), atk('quick')]).state;
    if (t.players[1].buffs.some(b => b.type === 'stun')) blinded++;
  }
  assert.ok(blinded > 35 && blinded < 60, `blinded ${blinded}`);
  // Power Boost: each debuff adds 10% + 20% x missing HP to his damage
  const dmg = (debuffs, hpPct) => {
    const s = createMatch(SERVANTS.angra, dummy('B'), { seed: 2 });
    s.players[0].hp = Math.round(s.players[0].maxHp * hpPct);
    for (let k = 0; k < debuffs; k++) s.players[0].buffs.push({ type: 'defDown', value: 0, turns: 5, debuff: true });
    const r = resolveTurn(s, [atk('quick'), atk('arts')]);
    return r.log.find(l => l.type === 'hit' && l.from === 0).amount;
  };
  const base = dmg(0, 1), two = dmg(2, 1), twoLow = dmg(2, 0.25);
  // Power Boost adds to his ATK up (Oblivion Correction A: +10%)
  assert.ok(Math.abs(two / base - 1.3 / 1.1) < 0.03, `${two}/${base}`);
  assert.ok(Math.abs(twoLow / base - 1.6 / 1.1) < 0.03, `${twoLow}/${base}`);
  // Avenger A: +25% NP when hit
  const s = createMatch(SERVANTS.angra, dummy('B'), { seed: 2 });
  const t = resolveTurn(s, [atk('arts'), atk('quick')]).state;   // Quick beats Arts: he's hit
  const plain = Math.round(T.npGainOnHit * s.players[0].npGainDef);
  assert.ok(t.players[0].np >= Math.round(T.npGainOnHit * s.players[0].npGainDef * 1.25) && t.players[0].np > plain);
});

test("Angra: Terror rolls its normal chance against him (inflicting and freezing)", () => {
  let frozen = 0, n = 200;
  for (let seed = 1; seed <= n; seed++) {
    const s = createMatch(SERVANTS.angra, dummy('B'), { seed });
    s.players[0].buffs.push({ type: 'terror', value: 40, turns: 3, debuff: true, source: 'test' });
    const r = resolveTurn(s, [atk('quick'), atk('quick')]);
    if (r.log.some(l => l.blocked === 'terror')) frozen++;
  }
  assert.ok(frozen > n * 0.25 && frozen < n * 0.55, `frozen ${frozen}`);
  let inflicted = 0;
  for (let seed = 1; seed <= n; seed++) {
    const s = createMatch(SERVANTS.astolfo, SERVANTS.angra, { seed });
    const r = resolveTurn(s, [atk('buster'), atk('quick')]);   // Buster beats Quick: Astolfo's attack lands
    if (r.state.players[1].buffs.some(b => b.type === 'terror')) inflicted++;
  }
  assert.ok(inflicted < n * 0.3, `inflicted ${inflicted}`);   // 10% proc, not 100%
});

test('NP drain cancels an NP chosen the same turn (Tawrich vs a full Frankenstein)', () => {
  const s = createMatch(SERVANTS.angra, SERVANTS.frankenstein, { seed: 3 });
  s.players[0].ap = 10; s.players[1].np = 100;
  const r = resolveTurn(s, [skill('tawrich'), np()]);
  assert.equal(r.state.players[0].hp, s.players[0].hp);            // no NP damage (Angra didn't attack either)
  assert.equal(r.state.players[1].np, 60);
  assert.ok(r.log.some(l => l.blocked === 'npDrained'));
  // without the drain the NP fires
  const s2 = createMatch(SERVANTS.angra, SERVANTS.frankenstein, { seed: 3 });
  s2.players[1].np = 100;
  const r2 = resolveTurn(s2, [atk('quick'), np()]);
  assert.ok(r2.state.players[0].hp < s2.players[0].hp);
});

test("NP drain beats the attacker's NP gain: Amakusa's Grail vs Iskandar's Arts hit", () => {
  const s = createMatch(SERVANTS.amakusa, SERVANTS.iskandar, { seed: 4 });
  s.players[0].ap = 10; s.players[1].np = 60;
  const r = resolveTurn(s, [{ ...skill('grail_fiery_heavens'), choice: 'left' }, atk('arts')]);
  const [ama, isk] = r.state.players;
  assert.ok(r.log.some(l => l.type === 'hit' && l.from === 1), 'Iskandar landed');
  assert.ok(isk.np >= 40 && isk.np <= 41, `np ${isk.np}`);   // drained 20 (19 after his Magic Resistance), no Arts charge
  assert.ok(ama.np > s.players[0].np + 20);        // Grail's NP +20% plus charge for being hit
  // without the drain, the same hit charges Iskandar
  const s2 = createMatch(SERVANTS.amakusa, SERVANTS.iskandar, { seed: 4 });
  s2.players[0].ap = 10; s2.players[1].np = 60;
  const r2 = resolveTurn(s2, [{ ...skill('prayer_long_journey'), choice: 'left' }, atk('arts')]);
  assert.ok(r2.state.players[1].np > 60);
});

test('Healing skills cost 3 more AP each time they are used', () => {
  let s = createMatch(SERVANTS.hundred_faces, dummy('B'), { seed: 1 });
  const p = () => s.players[0];
  const sk = SERVANTS.hundred_faces.skills.find(k => k.id === 'battle_retreat');
  assert.equal(skillCost(sk, p()), 3);
  s.players[0].ap = 12;
  s = resolveTurn(s, [skill('battle_retreat'), atk('quick')]).state;
  assert.equal(skillCost(sk, p()), 6);
  const apAfter = p().ap;
  s = resolveTurn(s, [atk('arts'), atk('quick')]).state;           // can't repeat it back to back anyway
  s.players[0].ap = 5;
  assert.ok(!getLegalActions(s, 0).skills.includes('battle_retreat'));   // 5 < 6
  s.players[0].ap = 6;
  assert.ok(getLegalActions(s, 0).skills.includes('battle_retreat'));
  s = resolveTurn(s, [skill('battle_retreat'), atk('quick')]).state;
  assert.equal(skillCost(sk, p()), 9);
  // other skills are unaffected
  const lib = SERVANTS.hundred_faces.skills.find(k => !k.costStep);
  assert.equal(skillCost(lib, p()), lib.cost);
  assert.ok(apAfter >= 0);
});

test('Crits: chance from star absorption (20% cap); 1.5x Quick (+1 AP), 1.5x Arts (+NP), 1.75x Buster; never NPs', () => {
  assert.equal(deriveStats(SERVANTS.iskandar).crit, 20);
  assert.equal(deriveStats(SERVANTS.astolfo).crit, 20);
  assert.equal(deriveStats(SERVANTS.spartacus).crit, 0.9);
  assert.equal(createMatchRaw(SERVANTS.medea, dummy('B'), { seed: 1 }).players[0].critChance, 4.9);
  const hit = (card, crit) => {
    const s = createMatch(SERVANTS.mordred, dummy('B'), { seed: 7 });
    s.players[0].critChance = crit ? 100 : 0; s.players[0].np = 0;
    const lose = { quick: 'arts', arts: 'buster', buster: 'quick' }[card];
    const r = resolveTurn(s, [atk(card), atk(lose)]);
    return { amount: r.log.find(l => l.type === 'hit' && l.from === 0).amount, ap: r.state.players[0].ap, np: r.state.players[0].np, log: r.log };
  };
  for (const [card, mult] of [['quick', 1.5], ['arts', 1.5], ['buster', 1.75]]) {
    const a = hit(card, false), b = hit(card, true);
    assert.ok(Math.abs(b.amount / a.amount - mult) < 0.02, `${card} ${b.amount}/${a.amount}`);
    assert.ok(b.log.some(l => /^Critical!/.test(l.msg)));
    if (card === 'quick') assert.equal(b.ap, a.ap + 1);
    if (card === 'arts') assert.ok(b.np > a.np);
    if (card === 'buster') { assert.equal(b.ap, a.ap); assert.equal(b.np, a.np); }
  }
  // NPs never crit
  const s = createMatch(SERVANTS.mordred, dummy('B'), { seed: 7 });
  s.players[0].critChance = 100; s.players[0].np = 100;
  const r = resolveTurn(s, [np(), atk('quick')]);
  assert.ok(!r.log.some(l => /^Critical!/.test(l.msg)));
  // a real rate lands near its chance (Iskandar 20%)
  let crits = 0, hits = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const m = createMatch(SERVANTS.iskandar, dummy('B'), { seed, crits: true });
    const t = resolveTurn(m, [atk('buster'), atk('quick')]);
    const h = t.log.find(l => l.type === 'hit' && l.from === 0);
    if (h) { hits++; if (/^Critical!/.test(h.msg)) crits++; }
  }
  assert.ok(crits / hits > 0.13 && crits / hits < 0.27, `${crits}/${hits}`);
});

test("Crits don't count as an effect landing on Angra (All the World's Evils)", () => {
  let crits = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const m = createMatch(SERVANTS.medea, SERVANTS.angra, { seed, crits: true });   // Medea 4.9%
    const t = resolveTurn(m, [atk('buster'), atk('quick')]);
    if (t.log.some(l => /^Critical!/.test(l.msg) && l.from === 0)) crits++;
  }
  assert.ok(crits < 30, `crits ${crits}`);
});
