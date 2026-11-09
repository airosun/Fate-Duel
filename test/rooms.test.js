import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/server/rooms.js';

const atk = card => ({ main: { type: 'attack', card }, seal: null });

function fullRoom() {
  const rm = new RoomManager();
  const a = rm.create();
  const b = rm.join(a.room.code.toLowerCase());
  return { rm, room: a.room, a, b };
}

test('create + join moves the room to servant select', () => {
  const { room, a, b } = fullRoom();
  assert.equal(a.seat, 0); assert.equal(b.seat, 1);
  assert.equal(room.phase, 'select');
  assert.match(room.code, /^[A-HJ-NP-Z]{4}$/);
});

test('third player is rejected; unknown code is rejected', () => {
  const { rm, room } = fullRoom();
  assert.throws(() => rm.join(room.code), /full/);
  assert.throws(() => rm.join('ZZZZ'), /not found/);
});

test('picks stay hidden from the opponent until both have chosen', () => {
  const { rm, room } = fullRoom();
  rm.pick(room, 0, 'artoria');
  assert.equal(rm.snapshot(room, 1).picks[0], null);
  assert.equal(rm.snapshot(room, 1).picked[0], true);
  assert.equal(rm.snapshot(room, 0).picks[0], 'artoria');
  rm.pick(room, 1, 'heracles');
  assert.equal(room.phase, 'battle');
  assert.deepEqual(rm.snapshot(room, 1).picks, ['artoria', 'heracles']);
});

test('locked actions stay hidden; turn resolves when both lock', () => {
  const { rm, room } = fullRoom();
  rm.pick(room, 0, 'artoria'); rm.pick(room, 1, 'kojirou');
  assert.equal(rm.lock(room, 0, atk('buster')), false);
  const snap = rm.snapshot(room, 1);
  assert.deepEqual(snap.locked, [true, false]);
  assert.equal(snap.myAction, null);
  assert.equal(JSON.stringify(snap).includes('"main"'), false); // no action object leaks
  assert.throws(() => rm.lock(room, 0, atk('arts')), /Already locked/);
  assert.equal(rm.lock(room, 1, atk('quick')), true);
  assert.equal(room.lastTurn.turn, 1);
  assert.equal(room.match.turn, 2);
  assert.deepEqual(room.locked, [null, null]);
});

test('illegal actions are rejected by the server', () => {
  const { rm, room } = fullRoom();
  rm.pick(room, 0, 'artoria'); rm.pick(room, 1, 'medea');
  assert.throws(() => rm.lock(room, 0, { main: { type: 'np' } }), /NP gauge/);
  assert.throws(() => rm.lock(room, 0, { main: { type: 'skill', skillId: 'dragon_reactor' } }), /not available/);
  assert.throws(() => rm.lock(room, 0, { main: { type: 'attack', card: 'laser' } }), /Unknown card/);
});

test('rejoin restores the seat; leave returns the room to waiting', () => {
  const { rm, room, a } = fullRoom();
  rm.disconnect(room, 0);
  assert.equal(rm.snapshot(room, 1).connected[0], false);
  const r = rm.rejoin(room.code, a.token);
  assert.equal(r.seat, 0);
  assert.throws(() => rm.rejoin(room.code, 'bogus'), /seat/);
  rm.leave(room, 1);
  assert.equal(room.phase, 'waiting');
  rm.leave(room, 0);
  assert.equal(rm.rooms.has(room.code), false);
});

test('rematch: both same -> new match; any change -> back to select', () => {
  const { rm, room } = fullRoom();
  rm.pick(room, 0, 'artoria'); rm.pick(room, 1, 'kojirou');
  room.match.players[1].hp = 1;
  rm.lock(room, 0, atk('buster')); rm.lock(room, 1, atk('buster'));
  assert.equal(room.phase, 'over');
  rm.rematch(room, 0, 'same'); rm.rematch(room, 1, 'same');
  assert.equal(room.phase, 'battle');
  assert.equal(room.match.turn, 1);
  room.match.players[1].hp = 1;
  rm.lock(room, 0, atk('buster')); rm.lock(room, 1, atk('buster'));
  rm.rematch(room, 0, 'same'); rm.rematch(room, 1, 'change');
  assert.equal(room.phase, 'select');
  assert.deepEqual(room.picks, [null, null]);
});

test('empty rooms are swept after 15 minutes', () => {
  let t = 0;
  const rm = new RoomManager({ now: () => t });
  const { room } = rm.create();
  rm.disconnect(room, 0);
  t = 16 * 60 * 1000;
  rm.sweep();
  assert.equal(rm.rooms.size, 0);
});
