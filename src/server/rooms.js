// Room manager for online duels. Transport-agnostic (no Socket.IO here) so it
// can be unit tested. The server owns the match; clients only send intents.
//
// Hidden information: during servant select a player can't see the other's
// pick, and during battle only a "locked in" flag is shared until both
// actions are in and the turn resolves.

import { randomUUID } from 'node:crypto';
import { createMatch, resolveTurn, validateAction } from '../engine/engine.js';
import { SERVANTS } from '../data/servants.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O
const EMPTY_ROOM_TTL_MS = 15 * 60 * 1000;

export class RoomError extends Error {}

function cleanAction(a) {
  const m = a?.main ?? {};
  const main = m.type === 'attack' ? { type: 'attack', card: String(m.card) }
    : m.type === 'skill' ? { type: 'skill', skillId: String(m.skillId) }
    : m.type === 'np' ? { type: 'np' } : { type: String(m.type) };
  return { main, seal: a?.seal == null ? null : String(a.seal) };
}

export class RoomManager {
  constructor({ now = () => Date.now(), random = Math.random } = {}) {
    this.rooms = new Map();
    this.now = now;
    this.random = random;
  }

  newCode() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(this.random() * CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  get(code) {
    const room = this.rooms.get(String(code ?? '').trim().toUpperCase());
    if (!room) throw new RoomError('Room not found. Check the code and try again.');
    return room;
  }

  create() {
    const code = this.newCode();
    const room = {
      code, phase: 'waiting', // waiting | select | battle | over
      seats: [null, null],    // { token, connected }
      picks: [null, null],
      match: null,
      locked: [null, null],
      lastTurn: null,         // { turn, actions, log } of the most recent resolution
      rematch: [null, null],  // 'same' | 'change'
      emptySince: null,
    };
    this.rooms.set(code, room);
    return { room, ...this.#claim(room) };
  }

  #claim(room) {
    const seat = room.seats.findIndex(s => !s);
    if (seat < 0) throw new RoomError('That room is full.');
    const token = randomUUID();
    room.seats[seat] = { token, connected: true };
    room.emptySince = null;
    if (room.phase === 'waiting' && room.seats.every(Boolean)) room.phase = 'select';
    return { seat, token };
  }

  join(code) {
    const room = this.get(code);
    return { room, ...this.#claim(room) };
  }

  rejoin(code, token) {
    const room = this.get(code);
    const seat = room.seats.findIndex(s => s?.token === token);
    if (seat < 0) throw new RoomError('Your seat in that room is gone.');
    room.seats[seat].connected = true;
    room.emptySince = null;
    return { room, seat };
  }

  disconnect(room, seat) {
    if (room.seats[seat]) room.seats[seat].connected = false;
    if (room.seats.every(s => !s?.connected)) room.emptySince = this.now();
  }

  leave(room, seat) {
    room.seats[seat] = null;
    if (room.seats.every(s => !s)) { this.rooms.delete(room.code); return; }
    // The remaining player waits for a new opponent.
    Object.assign(room, { phase: 'waiting', picks: [null, null], match: null, locked: [null, null], lastTurn: null, rematch: [null, null] });
  }

  pick(room, seat, servantId) {
    if (room.phase !== 'select') throw new RoomError('Not choosing servants right now.');
    if (!SERVANTS[servantId]) throw new RoomError('Unknown servant.');
    room.picks[seat] = servantId;
    if (room.picks.every(Boolean)) this.#startMatch(room);
  }

  #startMatch(room) {
    room.match = createMatch(SERVANTS[room.picks[0]], SERVANTS[room.picks[1]]);
    room.locked = [null, null];
    room.lastTurn = null;
    room.rematch = [null, null];
    room.phase = 'battle';
  }

  lock(room, seat, rawAction) {
    if (room.phase !== 'battle') throw new RoomError('The battle is not in progress.');
    if (room.locked[seat]) throw new RoomError('Already locked in this turn.');
    const action = cleanAction(rawAction);
    const err = validateAction(room.match, seat, action);
    if (err) throw new RoomError(err);
    room.locked[seat] = action;
    if (room.locked.every(Boolean)) {
      const actions = room.locked;
      const turn = room.match.turn;
      const { state, log } = resolveTurn(room.match, actions);
      room.match = state;
      room.lastTurn = { turn, actions, log };
      room.locked = [null, null];
      if (state.over) room.phase = 'over';
      return true; // resolved
    }
    return false;
  }

  unlock(room, seat) {
    if (room.phase === 'battle') room.locked[seat] = null;
  }

  rematch(room, seat, choice) {
    if (room.phase !== 'over') throw new RoomError('The match is not over.');
    room.rematch[seat] = choice === 'change' ? 'change' : 'same';
    if (room.rematch.every(Boolean)) {
      if (room.rematch.every(c => c === 'same')) this.#startMatch(room);
      else Object.assign(room, { phase: 'select', picks: [null, null], match: null, lastTurn: null, rematch: [null, null] });
    }
  }

  // What one seat is allowed to see.
  snapshot(room, seat) {
    const hidePicks = room.phase === 'select';
    return {
      code: room.code,
      seat,
      phase: room.phase,
      present: room.seats.map(Boolean),
      connected: room.seats.map(s => !!s?.connected),
      picked: room.picks.map(Boolean),
      picks: hidePicks ? room.picks.map((p, i) => (i === seat ? p : null)) : room.picks,
      match: room.match,
      locked: room.locked.map(Boolean),
      myAction: room.locked[seat],
      lastTurn: room.lastTurn,
      rematch: room.rematch,
    };
  }

  sweep() {
    const cutoff = this.now() - EMPTY_ROOM_TTL_MS;
    for (const [code, room] of this.rooms) {
      if (room.emptySince != null && room.emptySince < cutoff) this.rooms.delete(code);
    }
  }
}
