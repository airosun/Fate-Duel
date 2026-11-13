// Room manager for online duels. Transport-agnostic (no Socket.IO here) so it
// can be unit tested. The server owns the match; clients only send intents.
//
// A room holds up to 7 named members. The creator is the host. Members are
// either 'player' (in the battle queue) or 'spectator'. The host starts a duel
// with the first two players in the queue; everyone else watches. Or the host
// starts a Holy Grail War: every player is a master, CPUs fill the other seats
// up to seven, and up to three battles run at once (see ../engine/grailwar.js).
//
// Runs in the browser too: a local war against six CPUs uses this same manager.
//
// Visibility:
//  - Duelists never see the opponent's servant pick or action before both are in.
//  - Everyone else is omniscient: live servant browsing, live action drafts,
//    and locked actions as they happen.

import { createMatch, resolveTurn, validateAction, getLegalActions, foresightView } from '../engine/engine.js';
import { SERVANTS } from '../data/servants.js';
import { chooseAction } from '../engine/ai.js';
import * as GW from '../engine/grailwar.js';

const randomUUID = () => globalThis.crypto?.randomUUID?.()
  ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => ((Math.random() * 16) | 0).toString(16));
export const WAR_CPU_STRENGTH = 0.6;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O
const EMPTY_ROOM_TTL_MS = 15 * 60 * 1000;
export const MAX_MEMBERS = 7;
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

// What the end-of-war stats screen needs from one battle: the stat tallies, max HP and the
// HP-per-turn trail (not the full match state, which carries every servant's whole kit).
function battleSummary(st, f, d, winner) {
  const m = d.match;
  return {
    round: st.round, final: !!f.final, fightId: f.id, seats: [...d.seats], winner,
    servants: m.servants.map(s => s.id), turns: (m.history ?? []).length, reason: m.result?.reason ?? null,
    players: m.players.map(p => ({ stats: p.stats, maxHp: p.maxHp, hp: Math.max(0, p.hp) })),
    history: (m.history ?? []).map(h => ({ hp: h.hp })),
  };
}

function newDuel(seats, { picks = [null, null], cpu = [false, false], fightId = null } = {}) {
  return {
    seats, fightId, cpu, phase: 'select',
    picks: [...picks], focus: [...picks],
    match: null, locked: [null, null], drafts: [null, null], foresight: null,
    lastTurn: null, rematch: [null, null], continued: [0, 0], timeline: [], replay: false,
  };
}

export class RoomManager {
  constructor({ now = () => Date.now(), random = Math.random, cpuStrength = WAR_CPU_STRENGTH } = {}) {
    this.rooms = new Map();
    this.now = now;
    this.random = random;
    this.cpuStrength = cpuStrength;
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
      phase: 'lobby',   // lobby | select | battle | over | war
      members: [],      // { id, token, name, role, connected }
      hostId: null,
      queue: [],        // member ids with role 'player', in battle order
      duel: null,
      war: null,        // { state, duels: {fightId: duel}, views: {memberId: view}, ready: [] }
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
    if (room.war) this.#warLeave(room, id);
  }

  setRole(room, id, role) {
    const m = this.member(room, id);
    if (!['player', 'spectator'].includes(role)) throw new RoomError('Unknown role.');
    if (room.duel?.seats.includes(id)) throw new RoomError('You are in the current duel.');
    if (room.war) throw new RoomError('A Holy Grail War is under way.');
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
    room.duel = newDuel([ready[0], ready[1]]);
    room.phase = 'select';
  }

  // The duel this member is seated in: the room's duel, or their battle in the Holy Grail War.
  #duelOf(room, id) {
    if (room.war) return Object.values(room.war.duels).find(d => d.seats.includes(id)) ?? null;
    return room.duel;
  }

  #seatIn(d, id) {
    const seat = d?.seats.indexOf(id) ?? -1;
    if (seat < 0) throw new RoomError('You are not in the current duel.');
    return seat;
  }

  #setPhase(room, d, phase) {
    d.phase = phase;
    if (room.duel === d) room.phase = phase;
  }

  focus(room, id, servantId) {
    const d = this.#duelOf(room, id);
    if (d?.phase !== 'select' || !SERVANTS[servantId]) return;
    const seat = d.seats.indexOf(id);
    if (seat >= 0 && !d.picks[seat]) d.focus[seat] = servantId;
  }

  pick(room, id, servantId) {
    const d = this.#duelOf(room, id);
    if (d?.phase !== 'select') throw new RoomError('Not choosing servants right now.');
    if (!SERVANTS[servantId]) throw new RoomError('Unknown servant.');
    const seat = this.#seatIn(d, id);
    d.picks[seat] = servantId;
    d.focus[seat] = servantId;
    if (d.picks.every(Boolean)) this.#startMatch(room, d);
  }

  #startMatch(room, d) {
    d.match = createMatch(SERVANTS[d.picks[0]], SERVANTS[d.picks[1]]);
    d.locked = [null, null];
    d.foresight = null; d.foresightShown = null; d.pendingDivine = null; d.divine = [[], []];
    d.drafts = [null, null];
    d.lastTurn = null;
    d.continued = [0, 0];
    d.rematch = [null, null];
    d.timeline = [];
    d.initial = { ...d.match, rng: undefined };
    this.#setPhase(room, d, 'battle');
    this.#drive(room, d);
  }

  draft(room, id, rawAction) {
    const d = this.#duelOf(room, id);
    if (d?.phase !== 'battle') return;
    const seat = d.seats.indexOf(id);
    if (seat < 0 || d.locked[seat]) return;
    const a = cleanAction(rawAction);
    d.drafts[seat] = a && (a.main || a.seal) ? a : null;
  }

  // Teacher's Wisdom: this seat will see the opponent's locked action before locking its own.
  foresight(room, id) {
    const d = this.#duelOf(room, id);
    if (d?.phase !== 'battle') throw new RoomError('The battle is not in progress.');
    const seat = this.#seatIn(d, id);
    if (d.locked[seat]) throw new RoomError('You have already locked in this turn.');
    if (d.foresight === seat) return;
    if (d.foresight != null) throw new RoomError("Your opponent is already using Teacher's Wisdom this turn.");
    if (!getLegalActions(d.match, seat).foresight) throw new RoomError("No Teacher's Wisdom uses left.");
    d.foresight = seat;
    d.foresightShown = null;
  }

  lock(room, id, rawAction) {
    const d = this.#duelOf(room, id);
    if (d?.phase !== 'battle') throw new RoomError('The battle is not in progress.');
    const seat = this.#seatIn(d, id);
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
    const done = d.locked.every(Boolean) ? this.#resolve(room, d) : false;
    this.#drive(room, d);
    return done;
  }

  // Resolve the locked turn. If a Divine Intervention holder is about to take damage, pause and
  // wait for their master's decision (see divineDecision); returns true once the turn resolved.
  // CPU seats decide Divine Intervention for themselves.
  #resolve(room, d) {
    const actions = d.locked.map((a, i) => ({ ...a, divine: d.divine?.[i] ?? [] }));
    const turn = d.match.turn;
    const res = resolveTurn(d.match, actions, { interactive: d.cpu.map(c => !c) });
    if (res.needsDecision) { d.pendingDivine = res.needsDecision; return false; }
    const { state, log } = res;
    d.match = state;
    d.lastTurn = { turn, actions, log };
    if (d.replay) d.timeline.push({ ...d.lastTurn, state: { ...state, rng: undefined } });
    d.locked = [null, null];
    d.drafts = [null, null];
    d.foresight = null; d.foresightShown = null;
    d.pendingDivine = null; d.divine = [[], []];
    if (state.over) {
      this.#setPhase(room, d, 'over');
      if (room.war) this.#fightOver(room, d);
    }
    return true;
  }

  // CPU seats lock in as soon as a turn starts; two CPUs play the whole battle out at once.
  #drive(room, d) {
    for (let guard = 0; guard < 500; guard++) {
      if (d.phase !== 'battle' || d.pendingDivine) return;
      for (const seat of [0, 1]) {
        if (!d.cpu[seat] || d.locked[seat]) continue;
        const a = chooseAction(d.match, seat, { strength: this.cpuStrength, random: this.random });
        d.locked[seat] = a; d.drafts[seat] = a; d.divine = [[], []];
      }
      if (!d.locked.every(Boolean)) return;   // waiting on a human
      if (!this.#resolve(room, d)) return;    // paused for a Divine Intervention decision
    }
  }

  // The holder's master answers "use Divine Intervention on this hit?"
  divineDecision(room, id, use) {
    const d = this.#duelOf(room, id);
    const seat = this.#seatIn(d, id);
    if (!d?.pendingDivine || d.pendingDivine.player !== seat) throw new RoomError('Nothing to decide right now.');
    d.divine[seat] = [...(d.divine[seat] ?? []), !!use];
    d.pendingDivine = null;
    const done = this.#resolve(room, d);
    this.#drive(room, d);
    return done;
  }

  // A duelist has moved past the turn-result screen. When both have, spectators move on too.
  continueTurn(room, id) {
    const d = this.#duelOf(room, id);
    if (!d?.lastTurn) return;
    const seat = this.#seatIn(d, id);
    d.continued[seat] = Math.max(d.continued[seat] ?? 0, d.lastTurn.turn);
  }

  unlock(room, id) {
    const d = this.#duelOf(room, id);
    if (d?.phase !== 'battle') return;
    const seat = this.#seatIn(d, id);
    if (d.pendingDivine) throw new RoomError('The turn is already resolving.');
    // Once Teacher's Wisdom is reading this seat, its locked action is final.
    if (d.foresight === 1 - seat) throw new RoomError("Your action is being read by Teacher's Wisdom and can't be changed.");
    d.locked[seat] = null;
  }

  rematch(room, id, choice) {
    if (room.war) throw new RoomError('Battles in the Holy Grail War have no rematches.');
    if (room.phase !== 'over') throw new RoomError('The match is not over.');
    const d = room.duel;
    const seat = this.#seatIn(d, id);
    d.rematch[seat] = choice === 'change' ? 'change' : 'same';
    if (d.rematch.every(Boolean)) {
      if (d.rematch.every(c => c === 'same')) this.#startMatch(room, d);
      else {
        Object.assign(d, { picks: [null, null], focus: [null, null], match: null, lastTurn: null, rematch: [null, null] });
        this.#setPhase(room, d, 'select');
      }
    }
  }

  // Either duelist (or the host) can send everyone back to the room.
  returnToRoom(room, id) {
    if (room.war) return this.warReturn(room, id);
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

  // ---------- Holy Grail War ----------

  #war(room) {
    if (!room.war) throw new RoomError('No Holy Grail War is running.');
    return room.war;
  }

  #warCall(fn) {
    try { return fn(); } catch (e) { if (e instanceof GW.WarError) throw new RoomError(e.message); throw e; }
  }

  // The host starts a war: every connected player is a master; CPUs fill the rest of the seven seats.
  startWar(room, id, { seed } = {}) {
    if (room.hostId !== id) throw new RoomError('Only the host can start the Holy Grail War.');
    if (room.phase !== 'lobby') throw new RoomError('A battle is already running.');
    const humans = room.queue.map(q => room.members.find(m => m.id === q)).filter(m => m?.connected).slice(0, GW.WAR_SIZE);
    if (!humans.length) throw new RoomError('Need at least 1 player in the queue.');
    const state = GW.createWar(humans.map(m => ({ id: m.id, name: m.name })), { seed: seed ?? Math.floor(this.random() * 2 ** 32) });
    room.war = { state, duels: {}, views: {}, ready: [], round: 0, battles: [] };
    room.phase = 'war';
    this.#warSync(room);
  }

  warDraft(room, id, cls) {
    const w = this.#war(room);
    this.#warCall(() => GW.draftClass(w.state, id, String(cls)));
    this.#warSync(room);
  }

  warPick(room, id, servantId) {
    const w = this.#war(room);
    this.#warCall(() => GW.pickServant(w.state, id, String(servantId)));
    this.#warSync(room);
  }

  // Watch a battle. A master who is sitting the round out picks exactly one; members who aren't
  // in the war (spectators) or are already out of it can switch freely.
  warSpectate(room, id, fightId) {
    const w = this.#war(room), st = w.state;
    const f = st.fights.find(x => x.id === fightId);
    if (!f || !w.duels[fightId]) throw new RoomError('That battle is not running.');
    const m = GW.master(st, id);
    if (f.a === id || f.b === id) { w.views[id] = { fight: fightId, chosen: null, step: null }; return; } // back to your own battle
    if (m && !m.out) {
      if (st.fights.some(x => x.a === id || x.b === id)) throw new RoomError('You are fighting this round.');
      const v = w.views[id];
      if (v?.chosen && v.chosen !== fightId) throw new RoomError('You can only watch one battle this round.');
    }
    const d = w.duels[fightId];
    w.views[id] = { fight: fightId, chosen: m && !m.out ? fightId : null, step: 0 };
    if (!d.replay) w.views[id].step = null;
  }

  // Back to the war overview (after your battle, or to stop watching).
  warHub(room, id) {
    const w = this.#war(room);
    const v = w.views[id];
    w.views[id] = { ...(v ?? {}), fight: null };
  }

  // Replays of CPU-only battles move one turn per Continue.
  warReplayNext(room, id, { toEnd = false } = {}) {
    const w = this.#war(room);
    const v = w.views[id];
    const d = v?.fight && w.duels[v.fight];
    if (!d?.replay) return;
    v.step = toEnd ? d.timeline.length : Math.min(d.timeline.length, (v.step ?? 0) + 1);
  }

  // Results screen: once every connected human master still in the war is ready, the next round starts.
  warReady(room, id) {
    const w = this.#war(room), st = w.state;
    if (st.stage !== 'results') throw new RoomError('The round is not over yet.');
    if (!w.ready.includes(id)) w.ready.push(id);
    const need = st.masters.filter(m => !m.cpu && !m.out && room.members.find(x => x.id === m.id)?.connected).map(m => m.id);
    if (need.every(n => w.ready.includes(n))) {
      w.ready = [];
      GW.nextRound(st);
      this.#warSync(room);
    }
  }

  // After the war (or to abandon it, host only), everyone goes back to the room.
  warReturn(room, id) {
    const w = this.#war(room);
    if (w.state.stage !== 'over' && room.hostId !== id) throw new RoomError('Only the host can end the war early.');
    room.war = null;
    room.duel = null;
    room.phase = 'lobby';
  }

  // Set up the battles for a new round once the war reaches one.
  #warSync(room) {
    const w = room.war, st = w.state;
    if (!['round', 'final'].includes(st.stage) || w.round === st.round) return;
    w.round = st.round;
    w.duels = {};
    w.views = {};
    w.ready = [];
    w.logStart = st.log.length;
    for (const f of st.fights) {
      const A = GW.master(st, f.a), B = GW.master(st, f.b);
      const d = newDuel([f.a, f.b], { picks: [A.servant, B.servant], cpu: [A.cpu, B.cpu], fightId: f.id });
      d.replay = A.cpu && B.cpu;
      w.duels[f.id] = d;
    }
    for (const f of st.fights) for (const id of [f.a, f.b]) w.views[id] = { fight: f.id, chosen: null, step: null };
    // CPU-only battles are played out right away and watched as replays
    for (const d of Object.values(w.duels)) this.#startMatch(room, d);
  }

  // A battle ended: once every battle of the round is over, the results go to the war.
  #fightOver(room, d) {
    const w = room.war, st = w.state;
    if (Object.keys(w.duels).length < st.fights.length || !Object.values(w.duels).every(x => x.phase === 'over')) return;
    for (const f of st.fights) {
      const x = w.duels[f.id];
      const r = x.match.result.winner;
      const winner = r === 0 || r === 1 ? x.seats[r] : null;
      w.battles.push(battleSummary(st, f, x, winner));
      GW.recordResult(st, f.id, winner);
    }
  }

  // A human left mid-war: a CPU takes their seat, including in their current battle.
  #warLeave(room, id) {
    const w = room.war, st = w.state;
    delete w.views[id];
    w.ready = w.ready.filter(x => x !== id);
    GW.cpuTakeover(st, id);
    for (const d of Object.values(w.duels)) {
      const seat = d.seats.indexOf(id);
      if (seat < 0) continue;
      d.cpu[seat] = true;
      if (d.phase !== 'battle') continue;
      if (d.foresight === seat) d.foresight = null;
      if (d.pendingDivine?.player === seat) { d.divine[seat] = [...(d.divine[seat] ?? []), false]; d.pendingDivine = null; this.#resolve(room, d); }
      if (d.locked[seat] && d.locked[1 - seat]) this.#resolve(room, d);
      this.#drive(room, d);
    }
    this.#warSync(room);
  }

  // ---------- views ----------

  #duelView(room, d, id, step) {
    const seat = d.seats.indexOf(id);
    const omniscient = seat < 0;
    const nameOf = mid => room.members.find(m => m.id === mid)?.name
      ?? (room.war && GW.master(room.war.state, mid)?.name) ?? '—';
    const cpuSeat = i => !!d.cpu?.[i];
    const hidePicks = d.phase === 'select' && !omniscient;
    const seats = d.seats.map((mid, i) => ({ id: mid, name: nameOf(mid), cpu: cpuSeat(i), connected: cpuSeat(i) || !!room.members.find(m => m.id === mid)?.connected }));
    if (step != null) {
      // a replay of a CPU-only battle, at this viewer's own pace
      const t = d.timeline, k = Math.min(step, t.length);
      const prev = k > 0 ? t[k - 1] : null;
      return {
        fightId: d.fightId, replay: true, step: k, steps: t.length,
        phase: k >= t.length ? 'over' : 'battle',
        seats, picked: [true, true], picks: d.picks, focus: d.picks,
        match: k > 0 ? prev.state : d.initial,
        locked: [false, false], myAction: null, drafts: [null, null], lockedActions: [null, null],
        foresight: null, lastTurn: prev ? { turn: prev.turn, actions: prev.actions, log: prev.log } : null,
        continued: [0, 0], pendingDivine: null, rematch: [null, null],
      };
    }
    return {
      fightId: d.fightId ?? null, replay: false,
      phase: d.phase,
      seats,
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
      // CPU seats never hold spectators back
      continued: d.continued.map((c, i) => (cpuSeat(i) ? Infinity : c ?? 0)).map(c => (c === Infinity ? 1e9 : c)),
      // Divine Intervention pending: the holder and spectators see the incoming hit; the opponent only that they're deciding
      pendingDivine: d.pendingDivine
        ? (seat === d.pendingDivine.player || omniscient ? d.pendingDivine : { player: d.pendingDivine.player })
        : null,
      rematch: d.rematch,
    };
  }

  #warView(room, id) {
    const w = room.war, st = w.state;
    const v = w.views[id] ?? {};
    const me = GW.master(st, id);
    const showResults = st.stage === 'results' || st.stage === 'over';
    const fighting = st.fights.find(f => f.a === id || f.b === id);
    const live = ['round', 'final'].includes(st.stage);
    return {
      stage: st.stage, round: st.round, finalCount: st.finalCount, winner: st.winner,
      sitter: live ? st.sitter : null,
      drafter: GW.currentDrafter(st), draftOrder: st.draftOrder,
      classes: GW.WAR_CLASSES, penalties: GW.LOSS_PENALTY,
      masters: st.masters.map(m => ({
        id: m.id, name: m.name, cpu: m.cpu, cls: m.cls,
        servant: st.stage === 'servants' && m.id !== id ? null : m.servant,
        picked: !!m.servant, hp: m.hp, losses: m.losses, out: m.out, place: m.place, record: m.record,
        connected: m.cpu || !!room.members.find(x => x.id === m.id)?.connected,
      })),
      fights: st.fights.map(f => {
        const d = w.duels[f.id];
        return { id: f.id, a: f.a, b: f.b, final: f.final, over: d?.phase === 'over', replay: !!d?.replay, turn: d?.match?.turn ?? 0, result: showResults ? f.result : undefined };
      }),
      log: st.log.slice(w.logStart ?? 0),
      me: me ? { master: true, out: me.out } : { master: false },
      view: v.fight ?? null,
      chosen: v.chosen ?? null,
      // who may pick a battle to watch right now
      canWatch: live && !fighting && (!me || me.out || !v.chosen),
      ready: w.ready,
      // every battle of the war, for the end-of-war stats (only once there's a winner)
      battles: st.stage === 'over' ? w.battles : null,
    };
  }

  snapshot(room, id) {
    const me = room.members.find(m => m.id === id);
    let d = room.duel, step = null;
    if (room.war) {
      const v = room.war.views[id];
      d = v?.fight ? room.war.duels[v.fight] ?? null : null;
      step = d?.replay ? v.step ?? 0 : null;
    }
    const seat = d ? d.seats.indexOf(id) : -1;
    return {
      code: room.code,
      phase: room.phase,
      me: me ? { id: me.id, name: me.name, role: me.role } : null,
      hostId: room.hostId,
      seat: seat >= 0 ? seat : null,
      members: room.members.map(m => ({ id: m.id, name: m.name, role: m.role, connected: m.connected })),
      queue: room.queue,
      maxMembers: MAX_MEMBERS,
      duel: d ? this.#duelView(room, d, id, step) : null,
      war: room.war ? this.#warView(room, id) : null,
    };
  }

  sweep() {
    const cutoff = this.now() - EMPTY_ROOM_TTL_MS;
    for (const [code, room] of this.rooms) {
      if (room.emptySince != null && room.emptySince < cutoff) this.rooms.delete(code);
    }
  }
}
