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
  const hp = servant.hp ?? Math.round(T.baseHp * (servant.fgoHp / T.refFgoHp) ** T.statExponent * (servant.hpMult ?? 1));
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
    npMode: servant.np?.defaultMode ?? null,
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

// The NP as currently configured (servants like EMIYA switch NP modes).
export function npOf(servant, player) {
  const np = servant.np;
  if (!np.modes) return np;
  const mode = np.modes[player.npMode] ?? np.modes[np.defaultMode];
  return { ...np, ...mode, name: np.name, modeName: mode.label };
}

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
  if (m.type === 'skill') {
    const sk = state.servants[idx].skills.find(s => s.id === m.skillId);
    if (sk.options && !sk.options.some(o => o.id === m.option)) return `Choose an option for ${sk.name}`;
  }
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

function resistScale(target, e, user) {
  // Debuff resistance is deterministic: it weakens debuffs by X% instead of
  // rolling a chance (the engine has no RNG). The caster's debuffPotency
  // cancels resistance point-for-point (it can't push debuffs above 100%).
  if (e.target !== 'enemy') return 1;
  const resist = sumBuff(target, 'debuffResist') - (user ? sumBuff(user, 'debuffPotency') : 0);
  return Math.min(1, Math.max(0, 1 - resist / 100));
}

function applyEffect(target, e, source, user) {
  switch (e.type) {
    case 'heal':
      target.hp = Math.min(target.maxHp, target.hp + Math.round(target.maxHp * e.value / 100));
      return;
    case 'npCharge':
      target.np = Math.min(T.npMax, target.np + e.value);
      return;
    case 'npDrain':
      target.np = Math.max(0, target.np - Math.round(e.value * resistScale(target, e, user)));
      return;
    case 'apGain':
      target.ap = Math.min(target.maxAp, target.ap + e.value);
      return;
    case 'setNpMode':
      target.npMode = e.value;
      return;
    case 'cleanse': // removes all debuffs from the target
      target.buffs = target.buffs.filter(b => !b.debuff);
      return;
    case 'removeBuffs': // strips temporary, non-debuff buffs (passives stay)
      target.buffs = target.buffs.filter(b => b.turns === null || b.debuff);
      return;
    default: { // duration buff/debuff: atkUp, cardUp, npUp, damageCut, evade, invincible,
               // npGainUp, cardNpGainUp, debuffResist, guts, atkDown, defDown, apRegen,
               // busterConvert, flatDamage, sureHit{card?}, debuffPotency,
               // nextHitUp (consumed by the next landed attack), affinityAll
      // turns: null = permanent (passives); undefined = use the default for this effect
      let turns = e.turns === undefined ? (T.defaultTurns[e.type] ?? null) : e.turns;
      if (e.type === 'invincible') turns = 1;
      const value = Math.round((e.value ?? 0) * (DEBUFFS.includes(e.type) ? resistScale(target, e, user) : 1) * 10) / 10;
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
    if (conditionMet(user, e)) applyEffect(e.target === 'enemy' ? enemy : user, e, source, user);
  }
}

// ---------- damage ----------

// "Effectiveness" of a card type (cardUp buffs, plus extra such as Circuit
// Connect's next-hit bonus). Damage % stacks across buffs. Side effects don't:
// Arts gets a flat +artsEffectNpGain% NP gain on its hits and Quick gets
// +quickEffectAp AP when used, once, no matter how many buffs are active.
const effectiveness = (p, card) => (card ? sumBuff(p, 'cardUp', card) : 0);

function atkMultiplier(p, card, extraPct = 0) {
  const pct = sumBuff(p, 'atkUp') + effectiveness(p, card) + extraPct - sumBuff(p, 'atkDown');
  return Math.max(0.1, 1 + pct / 100);
}

const hasAffinity = (p, card) => p.favoredCard === card || hasBuff(p, 'affinityAll');

function defend(defender, raw, { isNp, ignoreDefense, sureHit }) {
  if (hasBuff(defender, 'invincible')) return { amount: 0, blocked: 'invincible' };
  if (!isNp && !ignoreDefense && !sureHit && hasBuff(defender, 'evade')) return { amount: 0, blocked: 'evade' };
  const cut = ignoreDefense ? 0 : Math.min(T.maxDamageCut, sumBuff(defender, 'damageCut'));
  const vuln = 1 + sumBuff(defender, 'defDown') / 100;
  return { amount: Math.round(raw * vuln * (1 - cut / 100)), blocked: null };
}

function attackPacket(att, def, card, { counter, empowered, nextHit = 0 }) {
  let raw = att.atk * T.cards[card].mult * atkMultiplier(att, card, nextHit);
  if (hasAffinity(att, card)) raw *= 1 + T.affinityBonus[card];
  if (counter) raw *= 1 + T.counterBonus;
  if (empowered) raw *= 1 + T.seals.empowerBonus;
  raw += sumBuff(att, 'flatDamage');
  const sureHit = att.buffs.some(b => b.type === 'sureHit' && (!b.card || b.card === card));
  return defend(def, raw, { isNp: false, ignoreDefense: false, sureHit });
}

function npPacket(att, def, np) {
  let mult = np.mult;
  if (np.missingHpBonus) mult *= 1 + np.missingHpBonus * (1 - def.hp / def.maxHp);
  const raw = att.atk * mult * atkMultiplier(att, np.card) * (1 + sumBuff(att, 'npUp') / 100)
    + sumBuff(att, 'flatDamage');
  return defend(def, raw, { isNp: true, ignoreDefense: !!np.ignoreDefense });
}

function gainNp(p, base, { defending = false, card, artsEffect = 0 } = {}) {
  const pct = sumBuff(p, 'npGainUp') + (card ? sumBuff(p, 'cardNpGainUp', card) : 0) + artsEffect;
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
    const option = skill.options?.find(o => o.id === mains[i].option);
    const effects = skill.effects.map(e => (e.type === 'setNpMode' ? { ...e, value: option.id } : e));
    skillUses[i] = { ...skill, effects };
    applyEffects(P[i], P[1 - i], effects.filter(e => e.target !== 'enemy'), skill.id);
    say(`${P[i].name} uses ${skill.name}${option ? ` (${option.label})` : ''}.`, { type: 'skill', player: i, skillId: skill.id });
  }
  for (const i of [0, 1]) {
    const skill = skillUses[i];
    if (skill) applyEffects(P[i], P[1 - i], skill.effects.filter(e => e.target === 'enemy'), skill.id);
  }

  // 3. Noble Phantasms — they hit simultaneously. Each NP's damage is worked
  // out on a private copy of the field (its own pre-effects apply only to its
  // own hit), so neither NP's effects touch the other. All NP effects land on
  // the real field after all damage.
  const packets = []; // { from, to, amount, blocked, kind, card }
  const npUsers = [0, 1].filter(i => mains[i].type === 'np');
  const nps = [0, 1].map(i => npOf(S[i], P[i]));
  for (const i of npUsers) {
    const att = structuredClone(P[i]), def = structuredClone(P[1 - i]);
    applyEffects(att, def, nps[i].preEffects, 'np');
    packets.push({ from: i, to: 1 - i, kind: 'np', card: nps[i].card, ...npPacket(att, def, nps[i]) });
  }
  for (const i of npUsers) {
    P[i].np = 0;
    say(`${P[i].name} unleashes ${nps[i].name}${nps[i].modeName ? ` (${nps[i].modeName})` : ''}!`, { type: 'np', player: i });
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
    const quickEff = card === 'quick' && effectiveness(P[i], 'quick') > 0 ? T.quickEffectAp : 0; // once
    P[i].ap = Math.min(P[i].maxAp, P[i].ap + T.apPerAttack + T.cards[card].apBonus + quickEff);

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
    const nextHit = sumBuff(P[i], 'nextHitUp');
    packets.push({ from: i, to: j, kind: 'attack', card, hitAs, reason, nextHit,
      ...attackPacket(P[i], P[j], hitAs, { counter, empowered, nextHit }) });
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
      const artsBoosted = pk.hitAs === 'arts' && (effectiveness(att, 'arts') > 0 || pk.nextHit > 0);
      const artsEffect = artsBoosted ? T.artsEffectNpGain : 0; // flat, once
      gainNp(att, T.cards[pk.hitAs].npGain, { card: pk.hitAs, artsEffect });
      const nextHitAp = pk.nextHit && pk.card === 'quick' ? 1 : 0;
      att.ap = Math.min(att.maxAp, att.ap + T.apOnLand + nextHitAp);
      if (pk.nextHit) att.buffs = att.buffs.filter(b => b.type !== 'nextHitUp'); // consumed on a landed hit
    }
    say(`${att.name} hits ${def.name} for ${pk.amount}${pk.hitAs && pk.hitAs !== pk.card ? ` (${CARD_NAME[pk.card]} → Buster)` : ''}${pk.reason === 'counter' ? ' (counter!)' : ''}.`, { type: 'hit', ...pk });
  }
  for (const i of npUsers) applyEffects(P[i], P[1 - i], nps[i].preEffects, 'np');
  for (const i of npUsers) applyEffects(P[i], P[1 - i], nps[i].postEffects, 'np');

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
