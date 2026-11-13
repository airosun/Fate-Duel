import test from 'node:test';
import assert from 'node:assert/strict';
import { createWar, draftClass, pickServant, recordResult, nextRound, alive, master, currentDrafter, classServants, WAR_CLASSES, LOSS_PENALTY } from '../src/engine/grailwar.js';

// Fewest early rematches any legal round could have (the sitter from last round must fight).
function minRepeats(ids, repeat, mustFight) {
  let best = Infinity;
  const go = (left, count, sat) => {
    if (count >= best) return;
    if (left.length === 0) { best = count; return; }
    if (left.length % 2 === 1 && !sat) {
      for (const s of left) if (s !== mustFight) go(left.filter(x => x !== s), count, true);
      return;
    }
    const [a, ...rest] = left;
    for (const b of rest) go(rest.filter(x => x !== b), count + (repeat(a, b) ? 1 : 0), sat);
  };
  go(ids, 0, ids.length % 2 === 0);
  return best;
}

const humans = n => Array.from({ length: n }, (_, k) => ({ id: `h${k}`, name: `Human ${k}` }));

// Play the draft and servant picks for the humans (first free class, first servant of it).
function setUp(war) {
  while (war.stage === 'draft') {
    const id = currentDrafter(war);
    const free = WAR_CLASSES.find(c => !war.masters.some(m => m.cls === c));
    draftClass(war, id, free);
  }
  for (const m of war.masters) if (!m.servant) pickServant(war, m.id, classServants(m.cls)[0].id);
}

test('Grail War: 7 masters, CPUs fill empty seats, every class taken once, random draft order', () => {
  const war = createWar(humans(2), { seed: 3 });
  assert.equal(war.masters.length, 7);
  assert.equal(war.masters.filter(m => m.cpu).length, 5);
  assert.equal(new Set(war.draftOrder).size, 7);
  // the draft stops on a human's turn (CPUs before them already picked)
  assert.ok(!master(war, currentDrafter(war)).cpu);
  const id = currentDrafter(war);
  const taken = war.masters.map(m => m.cls).filter(Boolean);
  if (taken.length) assert.throws(() => draftClass(war, id, taken[0]), /already taken/);
  assert.throws(() => draftClass(war, id, 'Ruler'), /Choose Saber/);
  const other = war.masters.find(m => !m.cpu && m.id !== id);
  assert.throws(() => draftClass(war, other.id, 'Saber'), /not your turn/);
  setUp(war);
  assert.deepEqual([...war.masters.map(m => m.cls)].sort(), [...WAR_CLASSES].sort());
  for (const m of war.masters) assert.equal(classServants(m.cls).some(s => s.id === m.servant), true);
  assert.equal(war.stage, 'round');
  assert.equal(war.fights.length, 3);
  assert.ok(war.sitter);
});

test('Grail War: a servant must match the master\'s class; picks stay secret until all are in', () => {
  const war = createWar(humans(1), { seed: 9 });
  while (war.stage === 'draft') draftClass(war, currentDrafter(war), WAR_CLASSES.find(c => !war.masters.some(m => m.cls === c)));
  const me = master(war, 'h0');
  const wrong = WAR_CLASSES.find(c => c !== me.cls);
  assert.throws(() => pickServant(war, 'h0', classServants(wrong)[0].id), /Choose a/);
  assert.equal(war.stage, 'servants');
  pickServant(war, 'h0', classServants(me.cls)[0].id);
  assert.equal(war.stage, 'round');
});

let forced = 0;
test('Grail War rules hold over many wars: sitters fight next round, no rematch before meeting everyone, penalties, one winner', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const war = createWar(humans(seed % 8), { seed });
    setUp(war);
    let rng = seed * 7919;
    const coin = () => ((rng = (rng * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const met = Object.fromEntries(war.masters.map(m => [m.id, []]));   // opponents in order
    let lastSitter = null, guard = 0;
    while (war.stage !== 'over' && guard++ < 200) {
      const live = alive(war).map(m => m.id);
      if (war.stage === 'round') {
        const fighting = war.fights.flatMap(f => [f.a, f.b]);
        assert.equal(new Set(fighting).size, fighting.length);
        assert.equal(fighting.length + (war.sitter ? 1 : 0), live.length);
        if (lastSitter && live.includes(lastSitter)) assert.ok(fighting.includes(lastSitter), `seed ${seed}: sitter ${lastSitter} sat twice`);
        // cycle rule: once x has met every surviving master the slate is wiped; until then no repeats
        for (const id of live) if (live.every(o => o === id || met[id].includes(o))) met[id] = [];
        const repeat = (x, y) => met[x].includes(y) || met[y].includes(x);
        const repeats = war.fights.filter(f => repeat(f.a, f.b)).length;
        if (repeats) {
          // only allowed when eliminations made every pairing break the rule somewhere
          const fewest = minRepeats(live, repeat, lastSitter);
          assert.equal(repeats, fewest, `seed ${seed} round ${war.round}: avoidable rematch`);
          forced++;
        }
        lastSitter = war.sitter;
      }
      for (const f of war.fights) {
        const r = coin();
        recordResult(war, f.id, r < 0.45 ? f.a : r < 0.9 ? f.b : null);
        met[f.a].push(f.b); met[f.b].push(f.a);
      }
      if (war.stage === 'results') nextRound(war);
    }
    assert.equal(war.stage, 'over', `seed ${seed}`);
    assert.ok(war.winner);
    assert.equal(alive(war).length, 1);
    for (const m of war.masters) {
      const expected = Math.max(0, 100 - LOSS_PENALTY.slice(0, m.losses).reduce((a, b) => a + b, 0));
      if (!m.out) assert.ok(m.hp >= 1);
      else assert.ok(m.hp === 0 || m.hp === expected);
    }
  }
});

test('Grail War: losses cost 10/20/30/40; a draw costs both; four losses eliminate', () => {
  const war = createWar(humans(0), { seed: 5 });
  const [f] = war.fights;
  recordResult(war, f.id, null);
  assert.equal(master(war, f.a).hp, 90);
  assert.equal(master(war, f.b).hp, 90);
  const m = master(war, f.a);
  m.losses = 3; m.hp = 40;
  // finish the round, then force another loss on m via a new round
  for (const g of war.fights.slice(1)) recordResult(war, g.id, g.a);
  nextRound(war);
  const g = war.fights.find(x => x.a === m.id || x.b === m.id);
  if (g) {
    recordResult(war, g.id, g.a === m.id ? g.b : g.a);
    for (const h of war.fights) if (h !== g) recordResult(war, h.id, h.a);
    assert.equal(m.hp, 0);
    assert.equal(m.out, true);
  }
});

test('Grail War final: a win ends it outright; draws cost both and they fight again', () => {
  const war = createWar(humans(0), { seed: 11 });
  // knock out five masters by hand
  for (const m of war.masters.slice(2)) { m.out = true; m.hp = 0; }
  war.masters[0].hp = 30; war.masters[0].losses = 3;
  war.masters[1].hp = 90; war.masters[1].losses = 1;
  war.stage = 'results';
  nextRound(war);
  assert.equal(war.stage, 'final');
  const [a, b] = war.masters;
  recordResult(war, war.fights[0].id, null);          // draw: a loses 40 -> out
  assert.equal(war.stage, 'over');
  assert.equal(war.winner, b.id);
  // and a straight win in the final eliminates the loser regardless of team HP
  const w2 = createWar(humans(0), { seed: 12 });
  for (const m of w2.masters.slice(2)) { m.out = true; m.hp = 0; }
  w2.masters[1].hp = 10;
  w2.stage = 'results'; nextRound(w2);
  recordResult(w2, w2.fights[0].id, w2.masters[1].id);
  assert.equal(w2.winner, w2.masters[1].id);
  assert.equal(w2.masters[0].out, true);
  // a draw that leaves both standing goes back to results, then another final
  const w3 = createWar(humans(0), { seed: 13 });
  for (const m of w3.masters.slice(2)) { m.out = true; m.hp = 0; }
  w3.stage = 'results'; nextRound(w3);
  recordResult(w3, w3.fights[0].id, null);
  assert.equal(w3.stage, 'results');
  assert.equal(w3.masters[0].hp, 90); assert.equal(w3.masters[1].hp, 90);
  nextRound(w3);
  assert.equal(w3.stage, 'final');
  assert.equal(w3.finalCount, 2);
});
