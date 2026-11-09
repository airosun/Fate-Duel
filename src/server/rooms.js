// Room manager for online duels. Transport-agnostic (no Socket.IO here) so it
// can be unit tested. The server owns the match; clients only send intents.
//
// A room holds up to 6 named members. The creator is the host. Members are
// either 'player' (in the battle queue) or 'spectator'. The host starts a duel
// with the first two players in the queue; everyone else watches.
//
// Visibility:
//  - Duelists never see the opponent's servant pick or action before both are in.
//  - Everyone else is omniscient: live servant browsing, live action drafts,
//    and locked actions as they happen.

import { randomUUID } from 'node:crypto';
import { createMatch, resolveTurn, validateAction } from '../engine/engine.js';
import { SERVANTS } from '../data/servants.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O
const EMPTY_ROOM_TTL_MS = 15 * 60 * 1000;
export const MAX_MEMBERS = 6;
export const MAX_NAME = 16;

export class RoomError extends Error {}

export function cleanName(name) {
  const n = String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, MAX_NAME);
  if (!n) throw new RoomError('Enter a Master name first.');
  return n;
}

function cleanAction(a) {
  if (!a || typeof a !== 'object') return null;
  const m = a.main ?? {};
  const main = m.type === 'attack' ? { type: 'attack', card: String(m.card) }
    : m.type === 'skill' ? { type: 'skill', skillId: String(m.skillId) }
    : m.type === 'np' ? { type: 'np' }
    : null;
  return { main, seal: a.seal == null ? null : String(a.seal) };
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

  member(room, id) {
    const m = room.members.find(x => x.id === id);
    if (!m) throw new RoomError('You are not in this room.');
    return m;
  }

  // ---------- membership ----------

  create(name) {
    const code = this.newCode();
    const room = {
      code,
      phase: 'lobby',   // lobby | select | battle | over
      members: [],      // { id, token, name, role, connected }
      hostId: null,
      queue: [],        // member ids with role 'player', in battle order
      duel: null,
      emptySince: null,
    };
    this.rooms.set(code, room);
    const res = this.#add(room, name);
    room.hostId = res.member.id;
    return { room, ...res };
  }

  #add(room, name) {
    const clean = cleanName(name);
    if (room.members.length >= MAX_MEMBERS) throw new RoomError(`That room is full (${MAX_MEMBERS} people max).`);
    const member = { id: randomUUID().slice(0, 8), token: randomUUID(), name: clean, role: 'player', connected: true };
    room.members.push(member);
    room.queue.push(member.id);
    room.emptySince = null;
    return { member, token: member.token };
  }

  join(code, name) {
    const room = this.get(code);
    return { room, ...this.#add(room, name) };
  }

  rejoin(code, token) {
    const room = this.get(code);
    const member = room.members.find(m => m.token === token);
    if (!member) throw new RoomError('Your seat in that room is gone.');
    member.connected = true;
    room.emptySince = null;
    return { room, member };
  }

  disconnect(room, id) {
    const m = room.members.find(x => x.id === id);
    if (m) m.connected = false;
    if (room.members.every(x => !x.connected)) room.emptySince = this.now();
  }

  leave(room, id) {
    const idx = room.members.findIndex(m => m.id === id);
    if (idx < 0) return;
    room.members.splice(idx, 1);
    room.queue = room.queue.filter(q => q !== id);
    if (room.members.length === 0) { this.rooms.delete(room.code); return; }
    if (room.hostId === id) room.hostId = room.members[0].id;
    if (room.duel?.seats.includes(id)) this.#endDuel(room, { rotate: false }); // duel can't continue
  }

  setRole(room, id, role) {
    const m = this.member(room, id);
    if (!['player', 'spectator'].includes(role)) throw new RoomError('Unknown role.');
    if (room.duel?.seats.includes(id)) throw new RoomError('You are in the current duel.');
    m.role = role;
    room.queue = room.queue.filter(q => q !== id);
    if (role === 'player') room.queue.push(id);
  }

  // ---------- duel lifecycle ----------

  start(room, id) {
    if (room.hostId !== id) throw new RoomError('Only the host can start the duel.');
    if (room.phase !== 'lobby') throw new RoomError('A duel is already running.');
    const ready = room.queue.filter(q => room.members.find(m => m.id === q)?.connected);
    if (ready.length < 2) throw new RoomError('Need at least 2 players in the queue.');
    room.duel = {
      seats: [ready[0], ready[1]],
      picks: [null, null], focus: [null, null],
      match: null, locked: [null, null], drafts: [null, null],
      lastTurn: null, rematch: [null, null],
    };
    room.phase = 'select';
  }

  #seat(room, id) {
    const seat = room.duel?.seats.indexOf(id) ?? -1;
    if (seat < 0) throw new RoomError('You are not in the current duel.');
    return seat;
  }

  focus(room, id, servantId) {
    if (room.phase !== 'select' || !SERVANTS[servantId]) return;
    const seat = room.duel?.seats.indexOf(id) ?? -1;
    if (seat >= 0 && !room.duel.picks[seat]) room.duel.focus[seat] = servantId;
  }

  pick(room, id, servantId) {
    if (room.phase !== 'select') throw new RoomError('Not choosing servants right now.');
    if (!SERVANTS[servantId]) throw new RoomError('Unknown servant.');
    const seat = this.#seat(room, id);
    room.duel.picks[seat] = servantId;
    room.duel.focus[seat] = servantId;
    if (room.duel.picks.every(Boolean)) this.#startMatch(room);
  }

  #startMatch(room) {
    const d = room.duel;
    d.match = createMatch(SERVANTS[d.picks[0]], SERVANTS[d.picks[1]]);
    d.locked = [null, null];
    d.drafts = [null, null];
    d.lastTurn = null;
    d.rematch = [null, null];
    room.phase = 'battle';
  }

  draft(room, id, rawAction) {
    if (room.phase !== 'battle') return;
    const seat = room.duel?.seats.indexOf(id) ?? -1;
    if (seat < 0 || room.duel.locked[seat]) return;
    const a = cleanAction(rawAction);
    room.duel.drafts[seat] = a && (a.main || a.seal) ? a : null;
  }

  lock(room, id, rawAction) {
    if (room.phase !== 'battle') throw new RoomError('The battle is not in progress.');
    const seat = this.#seat(room, id);
    const d = room.duel;
    if (d.locked[seat]) throw new RoomError('Already locked in this turn.');
    const action = cleanAction(rawAction);
    if (!action?.main) throw new RoomError('Choose an action first.');
    const err = validateAction(d.match, seat, action);
    if (err) throw new RoomError(err);
    d.locked[seat] = action;
    d.drafts[seat] = action;
    if (d.locked.every(Boolean)) {
      const actions = d.locked;
      const turn = d.match.turn;
      const { state, log } = resolveTurn(d.match, actions);
      d.match = state;
      d.lastTurn = { turn, actions, log };
      d.locked = [null, null];
      d.drafts = [null, null];
      if (state.over) room.phase = 'over';
      return true;
    }
    return false;
  }

  unlock(room, id) {
    if (room.phase !== 'battle') return;
    const seat = this.#seat(room, id);
    room.duel.locked[seat] = null;
  }

  rematch(room, id, choice) {
    if (room.phase !== 'over') throw new RoomError('The match is not over.');
    const seat = this.#seat(room, id);
    const d = room.duel;
    d.rematch[seat] = choice === 'change' ? 'change' : 'same';
    if (d.rematch.every(Boolean)) {
      if (d.rematch.every(c => c === 'same')) this.#startMatch(room);
      else {
        Object.assign(d, { picks: [null, null], focus: [null, null], match: null, lastTurn: null, rematch: [null, null] });
        room.phase = 'select';
      }
    }
  }

  // Either duelist (or the host) can send everyone back to the room.
  returnToRoom(room, id) {
    if (room.phase !== 'over') throw new RoomError('The match is not over.');
    const isDuelist = room.duel?.seats.includes(id);
    if (!isDuelist && room.hostId !== id) throw new RoomError('Only the duelists or the host can do that.');
    this.#endDuel(room, { rotate: true });
  }

  // rotate: the two duelists go to the back of the queue so others get a turn.
  #endDuel(room, { rotate }) {
    const seats = room.duel?.seats ?? [];
    if (rotate) {
      const stay = room.queue.filter(q => !seats.includes(q));
      const back = seats.filter(s => room.queue.includes(s));
      room.queue = [...stay, ...back];
    }
    room.duel = null;
    room.phase = 'lobby';
  }

  // ---------- views ----------

  snapshot(room, id) {
    const me = room.members.find(m => m.id === id);
    const d = room.duel;
    const seat = d ? d.seats.indexOf(id) : -1;
    const omniscient = seat < 0;
    let duel = null;
    if (d) {
      const nameOf = mid => room.members.find(m => m.id === mid)?.name ?? '—';
      const hidePicks = room.phase === 'select' && !omniscient;
      duel = {
        seats: d.seats.map(mid => ({ id: mid, name: nameOf(mid), connected: !!room.members.find(m => m.id === mid)?.connected })),
        picked: d.picks.map(Boolean),
        picks: hidePicks ? d.picks.map((p, i) => (i === seat ? p : null)) : d.picks,
        focus: omniscient ? d.focus : null,
        match: d.match,
        locked: d.locked.map(Boolean),
        myAction: seat >= 0 ? d.locked[seat] : null,
        drafts: omniscient ? d.drafts : null,
        lockedActions: omniscient ? d.locked : null,
        lastTurn: d.lastTurn,
        rematch: d.rematch,
      };
    }
    return {
      code: room.code,
      phase: room.phase,
      me: me ? { id: me.id, name: me.name, role: me.role } : null,
      hostId: room.hostId,
      seat: seat >= 0 ? seat : null,
      members: room.members.map(m => ({ id: m.id, name: m.name, role: m.role, connected: m.connected })),
      queue: room.queue,
      maxMembers: MAX_MEMBERS,
      duel,
    };
  }

  sweep() {
    const cutoff = this.now() - EMPTY_ROOM_TTL_MS;
    for (const [code, room] of this.rooms) {
      if (room.emptySince != null && room.emptySince < cutoff) this.rooms.delete(code);
    }
  }
}
