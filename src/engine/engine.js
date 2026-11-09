// Pure, deterministic duel engine. No I/O, no randomness, no timers.
// The server (or a local hotseat client) owns a match state and calls
// resolveTurn(state, [action0, action1]) once both players have locked in.
//
// Action shape:
//   { main: { type: 'attack', card: 'quick'|'arts'|'buster' }
//         | { type: 'skill', skillId }
//         | { type: 'np' },
//     seal: null | 'heal' | 'recharge' | 'empower' | 'grandOrder' }
//
// Buff durations: `turns` counts the turn it is applied on. A skill used on
// turn T with turns: 2 is active on T and T+1. turns: null = permanent.
// Defaults: evade / damageCut 2 turns; invincible is always 1 turn.

import { TUNING as T, CARDS, SEALS } from './constants.js';

const CARD_NAME = { quick: 'Quick', arts: 'Arts', buster: 'Buster' };

// ---------- setup ----------

export function deriveStats(servant) {
  const hp = servant.hp ?? Math.round(T.baseHp * (servant.fgoHp / T.refFgoHp) ** T.statExponent);
  const atk = servant.atk ?? Math.round(T.baseAtk * (servant.fgoAtk / T.refFgoAtk) ** T.statExponent);
  return { hp, atk };
}

function createPlayer(servant) {
  const { hp, atk } = deriveStats(servant);
  const p = {
    servantId: servant.id,
    name: servant.name,
    hp, maxHp: hp, atk,
    ap: T.startAp,
    maxAp: servant.maxAp ?? T.defaultMaxAp,
    np: 0,
    npGainAtk: servant.npGain ?? (servant.fgoNpAtk ? Math.sqrt(servant.fgoNpAtk / T.refFgoNpAtk) : 1),
    npGainDef: servant.npGainDef ?? (servant.fgoNpDef ? Math.sqrt(servant.fgoNpDef / T.refFgoNpDef) : 1),
    favoredCard: servant.favoredCard ?? null,
    seals: T.seals.count,
    revived: false,
    lastSkillId: null,
    empower: false,
    buffs: [],
  };
  const passives = servant.passives ?? (servant.passive ? [servant.passive] : []);
  const all = passives.flatMap(pas => pas.effects);
  for (const e of all.filter(e => e.type === 'maxApUp')) p.maxAp += e.value;
  for (const e of all.filter(e => e.type !== 'maxApUp')) applyEffect(p, { ...e, turns: null }, 'passive');
  p.ap = Math.min(p.ap, p.maxAp);
  return p;
}

export function createMatch(servantA, servantB) {
  return {
    turn: 1,
    over: false,
    result: null, // { winner: 0 | 1 | null, reason }
    servants: [servantA, servantB],
    players: [createPlayer(servantA), createPlayer(servantB)],
    history: [],
  };
}

// ---------- queries ----------

const sumBuff = (p, type, card) =>
  p.buffs.filter(b => b.type === type && (card === undefined || b.card === card))
    .reduce((s, b) => s + b.value, 0);
const hasBuff = (p, type) => p.buffs.some(b => b.type === type);

export function getLegalActions(state, idx) {
  const p = state.players[idx];
  const servant = state.servants[idx];
  const skills = servant.skills
    .filter(s => p.ap >= s.cost && p.lastSkillId !== s.id)
    .map(s => s.id);
  const seals = [];
  if (p.seals >= 1) seals.push('heal', 'recharge');
  if (p.seals >= 1 && !p.empower) seals.push('empower');
  if (p.seals >= 3 && p.np < T.npMax) seals.push('grandOrder');
  return { attacks: [...CARDS], skills, np: p.np >= T.npMax, seals };
}

export function validateAction(state, idx, action) {
  if (state.over) return 'Match is over';
  const legal = getLegalActions(state, idx);
  const m = action?.main;
  if (!m) return 'Missing main action';
  if (m.type === 'attack' && !legal.attacks.includes(m.card)) return `Unknown card: ${m.card}`;
  if (m.type === 'skill' && !legal.skills.includes(m.skillId)) return `Skill not available: ${m.skillId}`;
  if (m.type === 'np' && !legal.np) return 'NP gauge not full';
  if (!['attack', 'skill', 'np'].includes(m.type)) return `Unknown action: ${m.type}`;
  if (action.seal != null) {
    if (!SEALS.includes(action.seal)) return `Unknown seal: ${action.seal}`;
    if (!legal.seals.includes(action.seal)) return `Seal not available: ${action.seal}`;
  }
  return null;
}

// ---------- effects ----------

const DEBUFFS = ['atkDown', 'defDown'];

function resistScale(target, e) {
  // Debuff resistance is deterministic: it weakens debuffs by X% instead of
  // rolling a chance (the engine has no RNG).
  if (e.target !== 'enemy') return 1;
  return Math.max(0, 1 - sumBuff(target, 'debuffResist') / 100);
}

function applyEffect(target, e, source) {
  switch (e.type) {
    case 'heal':
      target.hp = Math.min(target.maxHp, target.hp + Math.round(target.maxHp * e.value / 100));
      return;
    case 'npCharge':
      target.np = Math.min(T.npMax, target.np + e.value);
      return;
    case 'npDrain':
      target.np = Math.max(0, target.np - Math.round(e.value * resistScale(target, e)));
      return;
    case 'apGain':
      target.ap = Math.min(target.maxAp, target.ap + e.value);
      return;
    case 'removeBuffs': // strips temporary, non-debuff buffs (passives stay)
      target.buffs = target.buffs.filter(b => b.turns === null || b.debuff);
      return;
    default: { // duration buff/debuff: atkUp, cardUp, npUp, damageCut, evade, invincible,
               // npGainUp, cardNpGainUp, debuffResist, guts, atkDown, defDown, apRegen,
               // busterConvert, flatDamage
      let turns = e.turns ?? T.defaultTurns[e.type] ?? null;
      if (e.type === 'invincible') turns = 1;
      const value = Math.round((e.value ?? 0) * (DEBUFFS.includes(e.type) ? resistScale(target, e) : 1) * 10) / 10;
      target.buffs.push({
        type: e.type,
        value,
        card: e.card,
        turns,
        charges: e.charges,
        resetNp: e.resetNp,
        resetAp: e.resetAp,
        debuff: DEBUFFS.includes(e.type),
        source,
      });
    }
  }
}

function conditionMet(user, e) {
  if (!e.condition) return true;
  if (e.condition === 'afterRevive') return user.revived;
  throw new Error(`Unknown condition: ${e.condition}`);
}

function applyEffects(user, enemy, effects, source) {
  for (const e of effects ?? []) {
    if (conditionMet(user, e)) applyEffect(e.target === 'enemy' ? enemy : user, e, source);
  }
}

// ---------- damage ----------

function atkMultiplier(p, card) {
  const pct = sumBuff(p, 'atkUp') + (card ? sumBuff(p, 'cardUp', card) : 0) - sumBuff(p, 'atkDown');
  return Math.max(0.1, 1 + pct / 100);
}

function defend(defender, raw, { isNp, ignoreDefense }) {
  if (hasBuff(defender, 'invincible')) return { amount: 0, blocked: 'invincible' };
  if (!isNp && !ignoreDefense && hasBuff(defender, 'evade')) return { amount: 0, blocked: 'evade' };
  const cut = ignoreDefense ? 0 : Math.min(T.maxDamageCut, sumBuff(defender, 'damageCut'));
  const vuln = 1 + sumBuff(defender, 'defDown') / 100;
  return { amount: Math.round(raw * vuln * (1 - cut / 100)), blocked: null };
}

function attackPacket(att, def, card, { counter, empowered }) {
  let raw = att.atk * T.cards[card].mult * atkMultiplier(att, card);
  if (att.favoredCard === card) raw *= 1 + T.affinityBonus[card];
  if (counter) raw *= 1 + T.counterBonus;
  if (empowered) raw *= 1 + T.seals.empowerBonus;
  raw += sumBuff(att, 'flatDamage');
  return defend(def, raw, { isNp: false, ignoreDefense: false });
}

function npPacket(att, def, np) {
  let mult = np.mult;
  if (np.missingHpBonus) mult *= 1 + np.missingHpBonus * (1 - def.hp / def.maxHp);
  const raw = att.atk * mult * atkMultiplier(att, np.card) * (1 + sumBuff(att, 'npUp') / 100)
    + sumBuff(att, 'flatDamage');
  return defend(def, raw, { isNp: true, ignoreDefense: !!np.ignoreDefense });
}

function gainNp(p, base, { defending = false, card } = {}) {
  const pct = sumBuff(p, 'npGainUp') + (card ? sumBuff(p, 'cardNpGainUp', card) : 0);
  const mod = (defending ? p.npGainDef : p.npGainAtk) * (1 + pct / 100);
  p.np = Math.min(T.npMax, p.np + Math.round(base * mod));
}

// ---------- turn resolution ----------

export function resolveTurn(prev, actions) {
  for (const i of [0, 1]) {
    const err = validateAction(prev, i, actions[i]);
    if (err) throw new Error(`Player ${i + 1}: ${err}`);
  }
  const state = structuredClone(prev);
  const P = state.players;
  const S = state.servants;
  const log = [];
  const say = (msg, data = {}) => log.push({ msg, ...data });
  const mains = actions.map(a => a.main);

  // 1. Command Seals
  for (const i of [0, 1]) {
    const seal = actions[i].seal;
    if (!seal) continue;
    const p = P[i];
    if (seal === 'grandOrder') {
      p.seals -= 3; p.np = T.npMax;
      say(`${p.name}'s master burns all three Command Seals: NP gauge full!`, { type: 'seal', player: i, seal });
      continue;
    }
    p.seals -= 1;
    if (seal === 'heal') applyEffect(p, { type: 'heal', value: T.seals.healPct });
    if (seal === 'recharge') applyEffect(p, { type: 'apGain', value: T.seals.rechargeAp });
    if (seal === 'empower') p.empower = true;
    say(`${p.name}'s master uses a Command Seal: ${{ heal: 'Heal', recharge: 'Recharge', empower: 'Empower' }[seal]}.`, { type: 'seal', player: i, seal });
  }

  // 2. Skills — self effects for both first, then enemy-targeted effects
  const skillUses = [0, 1].map(i =>
    mains[i].type === 'skill' ? S[i].skills.find(s => s.id === mains[i].skillId) : null);
  for (const i of [0, 1]) {
    const skill = skillUses[i];
    P[i].lastSkillId = skill ? skill.id : null;
    if (!skill) continue;
    P[i].ap -= skill.cost;
    applyEffects(P[i], P[1 - i], skill.effects.filter(e => e.target !== 'enemy'), skill.id);
    say(`${P[i].name} uses ${skill.name}.`, { type: 'skill', player: i, skillId: skill.id });
  }
  for (const i of [0, 1]) {
    const skill = skillUses[i];
    if (skill) applyEffects(P[i], P[1 - i], skill.effects.filter(e => e.target === 'enemy'), skill.id);
  }

  // 3. Noble Phantasms — pre-effects, then packets computed simultaneously
  const packets = []; // { from, to, amount, blocked, kind, card }
  const npUsers = [0, 1].filter(i => mains[i].type === 'np');
  for (const i of npUsers) {
    P[i].np = 0;
    applyEffects(P[i], P[1 - i], S[i].np.preEffects, 'np');
    say(`${P[i].name} unleashes ${S[i].np.name}!`, { type: 'np', player: i });
  }
  for (const i of npUsers) {
    packets.push({ from: i, to: 1 - i, kind: 'np', card: S[i].np.card, ...npPacket(P[i], P[1 - i], S[i].np) });
  }

  // 4. Regular attacks — RPS clash
  const clash = { cards: [null, null], outcome: null };
  for (const i of [0, 1]) {
    if (mains[i].type !== 'attack') continue;
    const j = 1 - i;
    const card = mains[i].card;
    clash.cards[i] = card;
    const empowered = P[i].empower;
    P[i].empower = false;
    // busterConvert (e.g. Dragon Reactor Core): the attack keeps its chosen
    // card for the RPS clash and AP, but hits (damage + NP gain) as Buster.
    const conv = P[i].buffs.find(b => b.type === 'busterConvert');
    const hitAs = conv ? 'buster' : card;
    if (conv) P[i].buffs.splice(P[i].buffs.indexOf(conv), 1);
    P[i].ap = Math.min(P[i].maxAp, P[i].ap + T.apPerAttack + T.cards[card].apBonus);

    let lands = true, counter = false, reason = 'unopposed';
    if (mains[j].type === 'np') { lands = false; reason = 'overpowered by NP'; }
    else if (mains[j].type === 'attack') {
      const other = mains[j].card;
      if (card === other) {
        const otherEmp = actions[j].seal === 'empower' || prev.players[j].empower;
        if (otherEmp && !empowered) { lands = false; reason = 'empowered tie lost'; }
        else reason = empowered && !otherEmp ? 'empowered tie won' : 'tie';
      } else if (T.beats[card] === other) { counter = true; reason = 'counter'; }
      else { lands = false; reason = 'countered'; }
    }
    if (!lands) { say(`${P[i].name}'s ${CARD_NAME[card]} attack fails (${reason}).`, { type: 'whiff', player: i, card, reason }); continue; }
    packets.push({ from: i, to: j, kind: 'attack', card, hitAs, reason, ...attackPacket(P[i], P[j], hitAs, { counter, empowered }) });
  }

  // 5. Apply all damage simultaneously
  for (const pk of packets) {
    const att = P[pk.from], def = P[pk.to];
    if (pk.blocked) {
      say(`${def.name} negates ${att.name}'s ${pk.kind === 'np' ? 'Noble Phantasm' : CARD_NAME[pk.card] + ' attack'} (${pk.blocked}).`, { type: 'blocked', ...pk });
      continue;
    }
    def.hp -= pk.amount;
    gainNp(def, T.npGainOnHit, { defending: true });
    if (pk.kind === 'attack') {
      gainNp(att, T.cards[pk.hitAs].npGain, { card: pk.hitAs });
      att.ap = Math.min(att.maxAp, att.ap + T.apOnLand);
    }
    say(`${att.name} hits ${def.name} for ${pk.amount}${pk.hitAs && pk.hitAs !== pk.card ? ` (${CARD_NAME[pk.card]} → Buster)` : ''}${pk.reason === 'counter' ? ' (counter!)' : ''}.`, { type: 'hit', ...pk });
  }
  for (const i of npUsers) applyEffects(P[i], P[1 - i], S[i].np.postEffects, 'np');

  // Guts
  for (const p of P) {
    if (p.hp > 0) continue;
    const g = p.buffs.find(b => b.type === 'guts');
    if (!g) continue;
    p.hp = Math.max(1, Math.round(p.maxHp * g.value / 100));
    p.revived = true;
    if (g.resetNp) p.np = 0;
    if (g.resetAp) p.ap = 0;
    if (g.charges != null && --g.charges > 0) { /* keep */ } else p.buffs.splice(p.buffs.indexOf(g), 1);
    say(`${p.name} refuses to fall! (guts: ${p.hp} HP)`, { type: 'guts', player: P.indexOf(p) });
  }

  // 6. End of turn
  for (const p of P) {
    const regen = sumBuff(p, 'apRegen');
    if (regen) p.ap = Math.min(p.maxAp, p.ap + regen);
    p.buffs = p.buffs.filter(b => b.turns === null || --b.turns > 0);
    p.hp = Math.max(0, p.hp);
  }

  const dead = P.map(p => p.hp <= 0);
  if (dead[0] && dead[1]) state.result = { winner: null, reason: 'double KO' };
  else if (dead[0] || dead[1]) state.result = { winner: dead[0] ? 1 : 0, reason: 'KO' };
  else if (state.turn >= T.maxTurns) state.result = { winner: null, reason: 'turn limit' };
  if (state.result) {
    state.over = true;
    say(state.result.winner === null ? 'Draw!' : `${P[state.result.winner].name} wins!`, { type: 'end', ...state.result });
  }

  state.history.push({ turn: state.turn, actions, log });
  state.turn += 1;
  return { state, log };
}
