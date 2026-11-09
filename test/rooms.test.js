import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, MAX_MEMBERS } from '../src/server/rooms.js';

const atk = card => ({ main: { type: 'attack', card }, seal: null });

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

test('return to room rotates the duelists to the back of the queue', () => {
  const { rm, room, H, B, C } = room3();
  startBattle(rm, room, H, B, ['artoria', 'kojirou']);
  finish(rm, room, H, B);
  assert.throws(() => rm.returnToRoom(room, C), /duelists or the host/);
  rm.returnToRoom(room, B);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.duel, null);
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
