import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, resolveTurn, validateAction } from '../src/engine/engine.js';
import { chooseAction, predictOpponent } from '../src/engine/ai.js';
import { nextStrength } from '../src/engine/difficulty.js';
import { ROSTER, SERVANTS } from '../src/data/servants.js';

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

test('CPU always picks a legal action, for every servant pairing, through full matches', () => {
  for (const a of ROSTER) for (const b of ROSTER) {
    let s = createMatch(a, b);
    while (!s.over) {
      const acts = [0, 1].map(i => chooseAction(s, i, { strength: rand(), random: rand }));
      acts.forEach((x, i) => assert.equal(validateAction(s, i, x), null, `${a.id} vs ${b.id}`));
      s = resolveTurn(s, acts).state;
    }
  }
});

test('CPU reads a predictable opponent', () => {
  let s = createMatch(SERVANTS.artoria, SERVANTS.emiya);
  s.players[1].ap = 0;   // card read only: no skills affordable
  const mine = ['quick', 'arts', 'buster'];
  for (let k = 0; k < 6; k++) s.history.push({ turn: k + 1, actions: [{ main: { type: 'attack', card: 'buster' } }, { main: { type: 'attack', card: mine[k % 3] } }], log: [] });
  const pred = predictOpponent(s, 0);
  const buster = pred.find(d => d.action.main.card === 'buster').p;
  assert.ok(buster > 0.6, `predicted buster ${buster}`);
  // Max strength CPU answers mostly with Arts (beats Buster)
  let arts = 0;
  for (let k = 0; k < 200; k++) if (chooseAction(s, 1, { strength: 1, random: rand }).main.card === 'arts') arts++;
  assert.ok(arts > 100, `arts picks ${arts}/200`);
});

test('CPU fires a full NP to finish a low-HP opponent', () => {
  let s = createMatch(SERVANTS.artoria, SERVANTS.kojirou);
  s.players[0].np = 100;
  s.players[1].hp = 300;
  let nps = 0;
  for (let k = 0; k < 50; k++) if (chooseAction(s, 0, { strength: 1, random: rand }).main.type === 'np') nps++;
  assert.ok(nps > 40, `np picks ${nps}/50`);
});

test('adaptive difficulty steps toward a 50% result and stays in range', () => {
  assert.equal(nextStrength(0.5, 'win'), 0.6);
  assert.equal(nextStrength(0.5, 'loss'), 0.4);
  assert.equal(nextStrength(0.5, 'draw'), 0.5);
  assert.equal(nextStrength(1, 'win'), 1);
  assert.equal(nextStrength(0, 'loss'), 0);
});
