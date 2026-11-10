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
import { createMatch, resolveTurn, validateAction, getLegalActions, foresightView } from '../engine/engine.js';
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
    : m.type === 'skill' ? { type: 'skill', skillId: String(m.skillId), ...(m.option != null ? { option: String(m.option) } : {}) }
    : m.type === 'np' ? { type: 'np' }
    : null;
  return { main, seal: a.seal == null ? null : String(a.seal), ...(a.choice != null ? { choice: String(a.choice) } : {}) };
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
      match: null, locked: [null, null], drafts: [null, null], foresight: null,
      lastTurn: null, rematch: [null, null], continued: [0, 0],
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
    d.foresight = null; d.foresightShown = null; d.pendingDivine = null; d.divine = [[], []];
    d.drafts = [null, null];
    d.lastTurn = null;
    d.continued = [0, 0];
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

  // Teacher's Wisdom: this seat will see the opponent's locked action before locking its own.
  foresight(room, id) {
    if (room.phase !== 'battle') throw new RoomError('The battle is not in progress.');
    const seat = this.#seat(room, id);
    const d = room.duel;
    if (d.locked[seat]) throw new RoomError('You have already locked in this turn.');
    if (d.foresight === seat) return;
    if (d.foresight != null) throw new RoomError("Your opponent is already using Teacher's Wisdom this turn.");
    if (!getLegalActions(d.match, seat).foresight) throw new RoomError("No Teacher's Wisdom uses left.");
    d.foresight = seat;
    d.foresightShown = null;
  }

  lock(room, id, rawAction) {
    if (room.phase !== 'battle') throw new RoomError('The battle is not in progress.');
    const seat = this.#seat(room, id);
    const d = room.duel;
    if (d.locked[seat]) throw new RoomError('Already locked in this turn.');
    const action = cleanAction(rawAction);
    if (!action?.main) throw new RoomError('Choose an action first.');
    if (d.foresight === seat) {
      if (!d.locked[1 - seat]) throw new RoomError('Wait for your opponent to lock in first.');
      action.foresight = true;
    }
    const err = validateAction(d.match, seat, action);
    if (err) throw new RoomError(err);
    d.locked[seat] = action;
    d.drafts[seat] = action;
    d.divine = [[], []];
    return d.locked.every(Boolean) ? this.#resolve(room) : false;
  }

  // Resolve the locked turn. If a Divine Intervention holder is about to take damage, pause and
  // wait for their master's decision (see divineDecision); returns true once the turn resolved.
  #resolve(room) {
    const d = room.duel;
    const actions = d.locked.map((a, i) => ({ ...a, divine: d.divine?.[i] ?? [] }));
    const turn = d.match.turn;
    const res = resolveTurn(d.match, actions, { interactive: [true, true] });
    if (res.needsDecision) { d.pendingDivine = res.needsDecision; return false; }
    const { state, log } = res;
    d.match = state;
    d.lastTurn = { turn, actions, log };
    d.locked = [null, null];
    d.drafts = [null, null];
    d.foresight = null; d.foresightShown = null;
    d.pendingDivine = null; d.divine = [[], []];
    if (state.over) room.phase = 'over';
    return true;
  }

  // The holder's master answers "use Divine Intervention on this hit?"
  divineDecision(room, id, use) {
    const d = room.duel;
    const seat = this.#seat(room, id);
    if (!d?.pendingDivine || d.pendingDivine.player !== seat) throw new RoomError('Nothing to decide right now.');
    d.divine[seat] = [...(d.divine[seat] ?? []), !!use];
    d.pendingDivine = null;
    return this.#resolve(room);
  }

  // A duelist has moved past the turn-result screen. When both have, spectators move on too.
  continueTurn(room, id) {
    const d = room.duel;
    if (!d?.lastTurn) return;
    const seat = this.#seat(room, id);
    d.continued[seat] = Math.max(d.continued[seat] ?? 0, d.lastTurn.turn);
  }

  unlock(room, id) {
    if (room.phase !== 'battle') return;
    const seat = this.#seat(room, id);
    if (room.duel.pendingDivine) throw new RoomError('The turn is already resolving.');
    // Once Teacher's Wisdom is reading this seat, its locked action is final.
    if (room.duel.foresight === 1 - seat) throw new RoomError("Your action is being read by Teacher's Wisdom and can't be changed.");
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

  // Winner stays on: the winner moves to the front of the queue and the loser
  // to the back. On a draw, both duelists go to the back.
  #endDuel(room, { rotate }) {
    const seats = room.duel?.seats ?? [];
    if (rotate) {
      const w = room.duel?.match?.result?.winner;
      const winner = w === 0 || w === 1 ? seats[w] : null;
      const losers = seats.filter(s => s !== winner && room.queue.includes(s));
      const others = room.queue.filter(q => !seats.includes(q));
      room.queue = [...(winner && room.queue.includes(winner) ? [winner] : []), ...others, ...losers];
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
        match: d.match ? { ...d.match, rng: undefined } : null, // the RNG seed stays on the server
        locked: d.locked.map(Boolean),
        myAction: seat >= 0 ? d.locked[seat] : null,
        drafts: omniscient ? d.drafts : null,
        lockedActions: omniscient ? d.locked : null,
        // Teacher's Wisdom: who is reading this turn, and (for that player only) what they see
        foresight: d.foresight == null ? null : {
          seat: d.foresight,
          // the reader sees what Othello shows them (maybe a lie, fixed once per turn); spectators see the truth
          revealed: omniscient ? d.locked[1 - d.foresight]
            : seat === d.foresight && d.locked[1 - d.foresight]
              ? (d.foresightShown ??= foresightView(d.match, d.foresight, d.locked[1 - d.foresight]))
              : null,
        },
        lastTurn: d.lastTurn,
        continued: d.continued ?? [0, 0],
        // Divine Intervention pending: the holder and spectators see the incoming hit; the opponent only that they're deciding
        pendingDivine: d.pendingDivine
          ? (seat === d.pendingDivine.player || omniscient ? d.pendingDivine : { player: d.pendingDivine.player })
          : null,
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
