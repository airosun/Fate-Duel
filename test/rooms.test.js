import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, MAX_MEMBERS } from '../src/server/rooms.js';

const atk = card => ({ main: { type: 'attack', card } });

function room3() {
  const rm = new RoomManager();
  const h = rm.create('Shirou');
  const b = rm.join(h.room.code.toLowerCase(), 'Rin');
  const c = rm.join(h.room.code, 'Sakura');
  return { rm, room: h.room, H: h.member.id, B: b.member.id, C: c.member.id, tokens: [h.token, b.token, c.token] };
}

function startBattle(rm, room, H, B, picks = ['artoria', 'heracles']) {
  rm.start(room, H);
  rm.pick(room, H, picks[0]);
  rm.pick(room, B, picks[1]);
}

test('creator is host; joiners queue as players; names required and cleaned', () => {
  const { rm, room, H, B, C } = room3();
  assert.equal(room.hostId, H);
  assert.deepEqual(room.queue, [H, B, C]);
  assert.equal(room.phase, 'lobby');
  assert.throws(() => rm.join(room.code, '   '), /Master name/);
  const x = rm.join(room.code, '  <b>Kirei</b> the very long name  ');
  assert.equal(x.member.name, 'bKirei/b the ver');
});

test(`rooms cap at ${MAX_MEMBERS} members`, () => {
  const rm = new RoomManager();
  const { room } = rm.create('Host');
  for (let i = 1; i < MAX_MEMBERS; i++) rm.join(room.code, `P${i}`);
  assert.throws(() => rm.join(room.code, 'Extra'), /full/);
});

test('only the host can start, and only with 2 queued players', () => {
  const rm = new RoomManager();
  const h = rm.create('Host');
  assert.throws(() => rm.start(h.room, h.member.id), /2 players/);
  const b = rm.join(h.room.code, 'Guest');
  assert.throws(() => rm.start(h.room, b.member.id), /host/);
  rm.start(h.room, h.member.id);
  assert.equal(h.room.phase, 'select');
  assert.deepEqual(h.room.duel.seats, [h.member.id, b.member.id]);
});

test('spectators are skipped by the queue; anyone can switch roles in the lobby', () => {
  const { rm, room, H, B, C } = room3();
  rm.setRole(room, B, 'spectator');
  assert.deepEqual(room.queue, [H, C]);
  rm.start(room, H);
  assert.deepEqual(room.duel.seats, [H, C]);
  assert.throws(() => rm.setRole(room, C, 'spectator'), /current duel/);
  rm.setRole(room, B, 'player'); // spectator queues up mid-duel
  assert.deepEqual(room.queue, [H, C, B]);
});

test('duelists see hidden picks; spectators see live focus and picks', () => {
  const { rm, room, H, B, C } = room3();
  rm.start(room, H);
  rm.focus(room, H, 'medea');
  rm.pick(room, H, 'artoria');
  const toB = rm.snapshot(room, B).duel;
  assert.equal(toB.picks[0], null);
  assert.equal(toB.focus, null);
  const toC = rm.snapshot(room, C).duel;
  assert.equal(toC.picks[0], 'artoria');
  rm.focus(room, B, 'kojirou');
  assert.equal(rm.snapshot(room, C).duel.focus[1], 'kojirou');
});

test('spectators see live drafts and locks; the opponent does not', () => {
  const { rm, room, H, B, C } = room3();
  startBattle(rm, room, H, B);
  rm.draft(room, H, atk('arts'));
  assert.deepEqual(rm.snapshot(room, C).duel.drafts[0], atk('arts'));
  assert.equal(rm.snapshot(room, B).duel.drafts, null);
  rm.lock(room, H, atk('buster'));
  const toB = rm.snapshot(room, B);
  assert.equal(JSON.stringify(toB.duel).includes('"main"'), false);
  assert.deepEqual(rm.snapshot(room, C).duel.lockedActions[0], atk('buster'));
  assert.equal(rm.lock(room, B, atk('quick')), true);
  assert.equal(room.duel.lastTurn.turn, 1);
  assert.deepEqual(room.duel.drafts, [null, null]);
});

test('server rejects illegal actions and non-duelists', () => {
  const { rm, room, H, B, C } = room3();
  startBattle(rm, room, H, B, ['artoria', 'medea']);
  assert.throws(() => rm.lock(room, H, { main: { type: 'np' } }), /NP gauge/);
  assert.throws(() => rm.lock(room, H, { main: { type: 'attack', card: 'laser' } }), /Unknown card/);
  assert.throws(() => rm.lock(room, C, atk('arts')), /not in the current duel/);
});

function finish(rm, room, H, B) {
  room.duel.match.players[1].hp = 1;
  rm.lock(room, H, atk('buster')); rm.lock(room, B, atk('buster'));
  assert.equal(room.phase, 'over');
}

test('rematch votes: same -> new match, change -> back to select', () => {
  const { rm, room, H, B } = room3();
  startBattle(rm, room, H, B, ['artoria', 'kojirou']);
  finish(rm, room, H, B);
  rm.rematch(room, H, 'same'); rm.rematch(room, B, 'same');
  assert.equal(room.phase, 'battle');
  finish(rm, room, H, B);
  rm.rematch(room, H, 'same'); rm.rematch(room, B, 'change');
  assert.equal(room.phase, 'select');
});

test('return to room: winner stays on, loser goes to the back of the queue', () => {
  const { rm, room, H, B, C } = room3();
  startBattle(rm, room, H, B, ['artoria', 'kojirou']);
  finish(rm, room, H, B);                // H (seat 0) wins
  assert.throws(() => rm.returnToRoom(room, C), /duelists or the host/);
  rm.returnToRoom(room, B);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.duel, null);
  assert.deepEqual(room.queue, [H, C, B]);
  rm.start(room, H);
  assert.deepEqual(room.duel.seats, [H, C]); // champion vs next challenger
});

test('return to room after a draw sends both duelists to the back', () => {
  const { rm, room, H, B, C } = room3();
  startBattle(rm, room, H, B, ['artoria', 'kojirou']);
  room.duel.match.players[0].hp = 1; room.duel.match.players[1].hp = 1;
  rm.lock(room, H, atk('buster')); rm.lock(room, B, atk('buster'));
  assert.equal(room.duel.match.result.winner, null);
  rm.returnToRoom(room, H);
  assert.deepEqual(room.queue, [C, H, B]);
});

test('host leaving passes host on; a duelist leaving ends the duel', () => {
  const { rm, room, H, B, C } = room3();
  startBattle(rm, room, H, B);
  rm.leave(room, H);
  assert.equal(room.hostId, B);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.duel, null);
  rm.leave(room, B); rm.leave(room, C);
  assert.equal(rm.rooms.has(room.code), false);
});

test('rejoin by token; start skips disconnected players', () => {
  const { rm, room, H, B, C, tokens } = room3();
  rm.disconnect(room, B);
  rm.start(room, H);
  assert.deepEqual(room.duel.seats, [H, C]);
  assert.equal(rm.rejoin(room.code, tokens[1]).member.id, B);
  assert.throws(() => rm.rejoin(room.code, 'nope'), /gone/);
});

test('empty rooms are swept after 15 minutes', () => {
  let t = 0;
  const rm = new RoomManager({ now: () => t });
  const { room, member } = rm.create('Solo');
  rm.disconnect(room, member.id);
  t = 16 * 60 * 1000;
  rm.sweep();
  assert.equal(rm.rooms.size, 0);
});

test("Teacher's Wisdom online: reveal only to the reader, opponent's lock becomes final", () => {
  const { rm, room, H, B, C } = room3();
  rm.setRole(room, C, 'spectator');
  startBattle(rm, room, H, B, ['chiron', 'medea']);
  assert.throws(() => rm.foresight(room, B), /uses left/);             // Medea has none
  rm.foresight(room, H);
  assert.throws(() => rm.lock(room, H, atk('arts')), /Wait for your opponent/);
  assert.equal(rm.snapshot(room, B).duel.foresight.seat, 0);             // Rin is told it's being used
  assert.equal(rm.snapshot(room, B).duel.foresight.revealed, null);
  rm.lock(room, B, atk('buster'));
  assert.throws(() => rm.unlock(room, B), /can't be changed/);
  assert.deepEqual(rm.snapshot(room, H).duel.foresight.revealed.main, { type: 'attack', card: 'buster' });
  assert.equal(rm.snapshot(room, B).duel.foresight.revealed, null);
  assert.equal(rm.lock(room, H, atk('arts')), true);                     // resolves
  const d = room.duel;
  assert.equal(d.foresight, null);
  assert.equal(d.lastTurn.actions[0].foresight, true);
  assert.equal(d.match.players[0].buffs.find(b => b.type === 'foresight').charges, 2);
});

test('Othello online: the reader gets one fixed reveal per turn (maybe a lie); spectators see the truth', () => {
  let lies = 0;
  for (let k = 0; k < 60; k++) {
    const { rm, room, H, B, C } = room3();
    rm.setRole(room, C, 'spectator');
    startBattle(rm, room, H, B, ['shakespeare', 'medea']);
    const p = room.duel.match.players[0];
    p.buffs = p.buffs.filter(b => b.type !== 'foresight');
    p.buffs.push({ type: 'foresight', charges: 3, deceive: 40, value: 0, turns: null, source: 'Works of Art: Othello' });
    rm.foresight(room, H);
    rm.lock(room, B, atk('buster'));
    const seen = rm.snapshot(room, H).duel.foresight.revealed;
    assert.deepEqual(rm.snapshot(room, H).duel.foresight.revealed, seen, 'stable within the turn');
    assert.deepEqual(rm.snapshot(room, C).duel.foresight.revealed.main, { type: 'attack', card: 'buster' });
    if (seen.main.type !== 'attack' || seen.main.card !== 'buster') lies++;
  }
  assert.ok(lies > 10 && lies < 40, `lies ${lies}/60`);
});

test('continue tracking: spectators see which turn each duelist has moved past', () => {
  const { rm, room, H, B, C } = room3();
  rm.setRole(room, C, 'spectator');
  startBattle(rm, room, H, B, ['artoria', 'medea']);
  rm.lock(room, H, atk('arts')); rm.lock(room, B, atk('quick'));
  assert.deepEqual(rm.snapshot(room, C).duel.continued, [0, 0]);
  rm.continueTurn(room, H);
  assert.deepEqual(rm.snapshot(room, C).duel.continued, [1, 0]);
  rm.continueTurn(room, B);
  assert.deepEqual(rm.snapshot(room, C).duel.continued, [1, 1]);
  assert.throws(() => rm.continueTurn(room, C));                    // spectators don't count
});

test('Divine Intervention online: the turn pauses for the holder; the opponent only sees that they are deciding', () => {
  const { rm, room, H, B, C } = room3();
  rm.setRole(room, C, 'spectator');
  startBattle(rm, room, H, B, ['jeanne', 'artoria']);
  const j = room.duel.match.players[0];
  j.buffs.push({ type: 'divineIntervention', value: 1, turns: 99, source: 'np' });
  rm.lock(room, H, atk('buster'));
  assert.equal(rm.lock(room, B, atk('arts')), false);                    // paused, not resolved
  const mine = rm.snapshot(room, H).duel.pendingDivine;
  assert.ok(mine.amount > 0 && mine.player === 0);
  assert.deepEqual(rm.snapshot(room, B).duel.pendingDivine, { player: 0 });
  assert.ok(rm.snapshot(room, C).duel.pendingDivine.amount > 0);
  assert.throws(() => rm.divineDecision(room, B, true), /Nothing to decide/);
  assert.throws(() => rm.unlock(room, B), /resolving/);
  assert.equal(rm.divineDecision(room, H, true), true);                  // resolves
  assert.ok(room.duel.lastTurn.log.some(l => l.blocked === 'divine'));
  assert.equal(room.duel.pendingDivine, null);
});

// ---------- Holy Grail War ----------
import { chooseAction } from '../src/engine/ai.js';
import { classServants } from '../src/engine/grailwar.js';

// Drive a war to the end: humans draft/pick the first free option, lock CPU-chosen actions,
// decline Divine Intervention, watch replays to the end and press ready on results.
function playWar(rm, room, humans, { onRound } = {}) {
  let guard = 0;
  while (room.war && guard++ < 20000) {
    const st = room.war.state;
    if (st.stage === 'draft') {
      const id = st.draftOrder[st.draftTurn];
      const free = rm.snapshot(room, id).war.classes.find(c => !st.masters.some(m => m.cls === c));
      rm.warDraft(room, id, free);
    } else if (st.stage === 'servants') {
      for (const id of humans) if (!st.masters.find(m => m.id === id).servant) rm.warPick(room, id, classServants(st.masters.find(m => m.id === id).cls)[0].id);
    } else if (st.stage === 'round' || st.stage === 'final') {
      onRound?.(st);
      let acted = false;
      for (const id of humans) {
        const snap = rm.snapshot(room, id);
        const d = snap.duel;
        if (!d || d.replay || snap.seat == null || d.phase !== 'battle') continue;
        if (d.pendingDivine?.player === snap.seat) { rm.divineDecision(room, id, false); acted = true; continue; }
        if (!d.locked[snap.seat] && !d.pendingDivine) { rm.lock(room, id, chooseAction(d.match, snap.seat, { strength: 0.5 })); acted = true; }
      }
      if (!acted) assert.fail(`war stalled in ${st.stage} round ${st.round}`);
    } else if (st.stage === 'results') {
      for (const id of humans) if (!st.masters.find(m => m.id === id).out) rm.warReady(room, id);
      if (room.war.state.stage === 'results') rm.warReady(room, room.hostId);
    } else if (st.stage === 'over') return st;
  }
  assert.fail('war did not finish');
}

test(`rooms hold ${MAX_MEMBERS} people`, () => {
  assert.equal(MAX_MEMBERS, 7);
});

test('Holy Grail War online: humans fill seats, CPUs the rest; fights run, sitters watch one, CPU battles replay', () => {
  const { rm, room, H, B, C } = room3();
  assert.throws(() => rm.startWar(room, B), /Only the host/);
  rm.startWar(room, H, { seed: 42 });
  assert.equal(room.phase, 'war');
  const st = room.war.state;
  assert.equal(st.masters.length, 7);
  assert.equal(st.masters.filter(m => !m.cpu).length, 3);
  // secret picks: during the servant stage you see only your own
  let checkedSecret = false, checkedSitter = false, checkedReplay = false;
  while (st.stage === 'draft') {
    const id = st.draftOrder[st.draftTurn];
    rm.warDraft(room, id, st.masters.find(m => m.id === id).cls ?? ['Saber', 'Archer', 'Lancer', 'Rider', 'Caster', 'Assassin', 'Berserker'].find(c => !st.masters.some(m => m.cls === c)));
  }
  rm.warPick(room, H, classServants(st.masters.find(m => m.id === H).cls)[0].id);
  const view = rm.snapshot(room, B).war;
  assert.equal(view.masters.find(m => m.id === H).servant, null);
  assert.equal(view.masters.find(m => m.id === H).picked, true);
  checkedSecret = true;
  const winner = playWar(rm, room, [H, B, C], {
    onRound: s => {
      if (s.stage !== 'round' || !s.sitter || checkedSitter) return;
      const sitter = s.sitter;
      const fights = room.war.state.fights;
      const snap = rm.snapshot(room, sitter);
      if (s.masters.find(m => m.id === sitter).cpu) return;
      assert.equal(snap.war.canWatch, true);
      rm.warSpectate(room, sitter, fights[0].id);
      assert.throws(() => rm.warSpectate(room, sitter, fights[1].id), /only watch one/);
      const watching = rm.snapshot(room, sitter).duel;
      assert.equal(watching.fightId, fights[0].id);
      if (watching.replay) {
        assert.equal(watching.step, 0);
        rm.warReplayNext(room, sitter);
        assert.equal(rm.snapshot(room, sitter).duel.step, 1);
        rm.warReplayNext(room, sitter, { toEnd: true });
        assert.equal(rm.snapshot(room, sitter).duel.phase, 'over');
        checkedReplay = true;
      }
      rm.warHub(room, sitter);
      assert.throws(() => rm.warSpectate(room, sitter, fights[1].id), /only watch one/);
      checkedSitter = true;
    },
  });
  assert.ok(checkedSecret && checkedSitter);
  assert.ok(winner.winner);
  assert.equal(winner.masters.filter(m => !m.out).length, 1);
  void checkedReplay;
  rm.returnToRoom(room, B);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.war, null);
});

test('Holy Grail War: many full wars finish (CPU replays, draws, finals) with one human and with seven', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const rm = new RoomManager();
    const h = rm.create('Solo');
    const ids = [h.member.id];
    if (seed % 2 === 0) for (let k = 0; k < 6; k++) ids.push(rm.join(h.room.code, `P${k}`).member.id);
    rm.startWar(h.room, h.member.id, { seed });
    const st = playWar(rm, h.room, ids);
    assert.equal(st.stage, 'over');
    assert.equal(st.masters.filter(m => m.place === 1).length, 1);
  }
});

test('Holy Grail War: leaving mid-war hands the seat to a CPU', () => {
  const { rm, room, H, B, C } = room3();
  rm.startWar(room, H, { seed: 7 });
  const st = room.war.state;
  // finish draft + picks
  while (st.stage === 'draft') {
    const id = st.draftOrder[st.draftTurn];
    rm.warDraft(room, id, ['Saber', 'Archer', 'Lancer', 'Rider', 'Caster', 'Assassin', 'Berserker'].find(c => !st.masters.some(m => m.cls === c)));
  }
  for (const id of [H, B, C]) rm.warPick(room, id, classServants(st.masters.find(m => m.id === id).cls)[0].id);
  assert.equal(st.stage === 'round' || st.stage === 'final', true);
  const inFight = [B, C].find(id => st.fights.some(f => f.a === id || f.b === id)) ?? B;
  rm.leave(room, inFight);
  assert.equal(st.masters.find(m => m.id === inFight).cpu, true);
  const f = st.fights.find(x => x.a === inFight || x.b === inFight);
  if (f) {
    const d = room.war.duels[f.id];
    const other = d.seats.find(x => x !== inFight);
    // either it's now CPU-vs-CPU and finished, or it waits on the remaining human
    if (st.masters.find(m => m.id === other).cpu) assert.equal(d.phase, 'over');
    else assert.equal(d.locked[d.seats.indexOf(inFight)] != null, true);
  }
  const end = playWar(rm, room, [H, C].filter(id => id !== inFight));
  assert.equal(end.stage, 'over');
});

test('Command Seal online: resolves at once for the user, not while locked, shows to everyone', () => {
  const { rm, room, H, B, C } = room3();
  startBattle(rm, room, H, B);
  const before = room.duel.match.players[0];
  rm.seal(room, H);
  const after = room.duel.match.players[0];
  assert.equal(after.seals, before.seals - 1);
  assert.ok(after.np > before.np);
  assert.equal(rm.snapshot(room, C).duel.match.players[0].seals, 2);   // spectators see it
  assert.equal(rm.snapshot(room, B).duel.match.players[0].seals, 2);   // so does the opponent
  rm.lock(room, H, atk('quick'));
  assert.throws(() => rm.seal(room, H), /already locked in/);
  assert.throws(() => rm.seal(room, C), /not in the current duel/);
  rm.unlock(room, H);
  rm.seal(room, H); rm.seal(room, H);
  assert.throws(() => rm.seal(room, H), /No Command Seals/);
  rm.lock(room, H, atk('quick'));
  rm.lock(room, B, atk('quick'));
  const line = room.duel.lastTurn.log.find(l => l.type === 'seal');
  assert.match(line.msg, /uses 3 Command Seals/);
});
