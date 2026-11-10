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

// hpMult pays for a revive passive (Heracles, Cú). When Ea neutralizes the
// revive, the servant gets full HP back: { uniquesOff: true }.
export function deriveStats(servant, { uniquesOff = false } = {}) {
  const mult = servant.hpMult ?? 1;
  const hpMult = uniquesOff ? mult + (1 - mult) * T.neutralizedHpRestore : mult;
  const hp = servant.hp ?? Math.round(T.baseHp * (servant.fgoHp / T.refFgoHp) ** T.statExponent * hpMult);
  const atk = servant.atk ?? Math.round(T.baseAtk * (servant.fgoAtk / T.refFgoAtk) ** T.statExponent);
  return { hp, atk };
}

function createPlayer(servant, { blockUniques = false } = {}) {
  const { hp, atk } = deriveStats(servant, { uniquesOff: blockUniques });
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
  let passives = servant.passives ?? (servant.passive ? [servant.passive] : []);
  if (blockUniques) { // the opponent's Ea switches off every unique passive
    p.neutralized = passives.filter(pa => pa.kind === 'unique').map(pa => pa.name);
    passives = passives.filter(pa => pa.kind !== 'unique');
  }
  const all = passives.flatMap(pas => pas.effects);
  for (const e of all.filter(e => e.type === 'maxApUp')) p.maxAp += e.value;
  for (const pas of passives) {
    for (const e of pas.effects) if (e.type !== 'maxApUp') applyEffect(p, { ...e, turns: null }, pas.name);
  }
  p.ap = Math.min(p.ap, p.maxAp);
  return p;
}

// Copy-the-opponent passives (EMIYA's Trace On): take every unique passive the
// opponent has, except other copy effects. Revives (guts) can't be copied: the
// sim showed a free copied revive swings matchups by 20+ points. Copies are
// permanent passives.
function applyCopiedUniques(p, servant, foe) {
  const copies = (servant.passives ?? []).some(pa => pa.effects.some(e => e.type === 'copyEnemyUnique'));
  if (!copies) return;
  p.copied = [];
  p.copyBlocked = [];
  for (const pa of foe.passives ?? []) {
    if (pa.kind !== 'unique' || pa.effects.some(e => e.type === 'copyEnemyUnique')) continue;
    if (pa.effects.some(e => e.type === 'guts')) { p.copyBlocked.push(pa.name); continue; }
    for (const e of pa.effects) applyEffect(p, { ...e, turns: null, copiedFrom: pa.name }, 'Trace On');
    p.copied.push(pa.name);
  }
}

const neutralizesUniques = s => (s.passives ?? []).some(pa => pa.kind === 'unique' && pa.effects.some(e => e.type === 'neutralizeEnemyUnique'));

export function createMatch(servantA, servantB, { seed } = {}) {
  // Ea (Gilgamesh) switches off the opponent's unique passives before anything
  // else, so a neutralized Trace On copies nothing. Two Eas cancel each other.
  const block = [neutralizesUniques(servantB), neutralizesUniques(servantA)];
  const players = [createPlayer(servantA, { blockUniques: block[0] }), createPlayer(servantB, { blockUniques: block[1] })];
  if (!block[0]) applyCopiedUniques(players[0], servantA, servantB);
  if (!block[1]) applyCopiedUniques(players[1], servantB, servantA);
  return {
    turn: 1,
    over: false,
    result: null, // { winner: 0 | 1 | null, reason }
    servants: [servantA, servantB],
    players,
    history: [],
    // Seeded RNG state (mulberry32). Kept in the match so turns are reproducible;
    // the server never sends it to clients.
    rng: (seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0,
  };
}

// Draw a number in [0, 1) and advance the match's RNG.
function roll(state) {
  state.rng = (state.rng + 0x6D2B79F5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

const DEBUFFS = ['atkDown', 'defDown', 'apRecoveryDown', 'cardVuln', 'terror', 'curse'];

// Lasting positive effects a servant puts on itself (what Breaker Gorgon can make fail).
const BUFF_TYPES = new Set(['ignoreDamageCut', 'buffSuccessUp', 'apRecoveryUp', 'atkUp', 'cardUp', 'npUp', 'damageCut', 'evade', 'invincible', 'npGainUp',
  'cardNpGainUp', 'debuffResist', 'guts', 'apRegen', 'busterConvert', 'flatDamage', 'sureHit',
  'nextHitUp', 'bonusVsStatus', 'debuffPotency', 'extraHitChance']);
const hasStatus = (p, status) => p.buffs.some(b => b.status === status);

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
    case 'apDrain':
      target.ap = Math.max(0, target.ap - Math.round(e.value * resistScale(target, e, user)));
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
               // nextHitUp (consumed by the next landed attack), affinityAll,
               // buffFailChance, apRecoveryDown{status?}, bonusVsStatus{status}, instantKillChance
      // turns: null = permanent (passives); undefined = use the default for this effect
      let turns = e.turns === undefined ? (T.defaultTurns[e.type] ?? null) : e.turns;
      if (e.type === 'invincible') turns = 1;
      // scaleMissingHp: bonus that grows with the target's missing HP at the moment it's applied
      const base = (e.value ?? 0) + (e.scaleMissingHp ? e.scaleMissingHp * (1 - target.hp / target.maxHp) : 0);
      const value = Math.round(base * (DEBUFFS.includes(e.type) ? resistScale(target, e, user) : 1) * 10) / 10;
      target.buffs.push({
        type: e.type,
        value,
        card: e.card,
        turns,
        charges: e.charges,
        resetNp: e.resetNp,
        resetAp: e.resetAp,
        status: e.status,
        copiedFrom: e.copiedFrom,
        npName: e.npName,
        ratio: e.ratio,
        debuff: DEBUFFS.includes(e.type),
        source,
      });
    }
  }
}

const BUFF_NAMES = {
  atkUp: 'ATK up', npUp: 'NP damage up', damageCut: 'damage cut', evade: 'Evade', invincible: 'Invincible',
  npGainUp: 'NP gain up', debuffResist: 'debuff resist', guts: 'Guts', apRegen: 'AP regen',
  busterConvert: 'Buster strike', flatDamage: 'flat damage', sureHit: 'Sure Hit', nextHitUp: 'next-hit boost',
  bonusVsStatus: 'bonus damage', debuffPotency: 'debuff potency', instantKillChance: 'instant kill',
  ignoreDamageCut: 'ignore damage cut', buffSuccessUp: 'buff success up', apRecoveryUp: 'AP recovery up',
};
const buffName = e => (e.type === 'cardUp' ? `${CARD_NAME[e.card]} up`
  : e.type === 'cardNpGainUp' ? `${CARD_NAME[e.card]} NP gain up` : BUFF_NAMES[e.type] ?? e.type);

// Breaker Gorgon: each buff the user puts on itself may fail to land.
// Rolls for effects that can fail: an effect's own `chance` (e.g. Expert of
// Many Specializations, 80%) and the enemy's Breaker Gorgon. The user's
// buffSuccessUp raises the first and lowers the second, point for point.
function screenBuffs(state, user, enemy, effects, say) {
  if (!effects?.length) return [];
  const success = sumBuff(user, 'buffSuccessUp');
  const fail = Math.max(0, sumBuff(enemy, 'buffFailChance') - success);
  return effects.filter(e => {
    if (e.target === 'enemy') return true;
    if (e.chance != null && roll(state) * 100 >= Math.min(100, e.chance + success)) {
      say(`${user.name}'s ${buffName(e)} doesn't take hold (${e.chance + success >= 100 ? 100 : e.chance + success}% chance).`, { type: 'buffFail' });
      return false;
    }
    if (!fail || !BUFF_TYPES.has(e.type)) return true;
    if (roll(state) * 100 >= fail) return true;
    say(`${user.name}'s ${buffName(e)} buff fails to take hold! (Breaker Gorgon)`, { type: 'buffFail' });
    return false;
  });
}

// AP from attacking, reduced by AP-recovery debuffs (Petrify, Bellerophon).
function gainAttackAp(p, amount) {
  const cut = Math.round(sumBuff(p, 'apRecoveryDown')) - Math.round(sumBuff(p, 'apRecoveryUp'));
  p.ap = Math.min(p.maxAp, p.ap + Math.max(0, amount - cut));
}

function conditionMet(user, e) {
  if (!e.condition) return true;
  if (e.condition === 'afterRevive') return user.revived;
  throw new Error(`Unknown condition: ${e.condition}`);
}

function applyEffects(user, enemy, effects, source) {
  for (const e of effects ?? []) {
    if (!conditionMet(user, e)) continue;
    applyEffect(e.target === 'enemy' ? enemy : user, e, source, user);
    // Eternal Arms Mastery (Lancelot): when the enemy buffs its own ATK, gain a weaker copy.
    if (e.type === 'atkUp' && e.target !== 'enemy' && source !== 'mirror') {
      const share = sumBuff(enemy, 'mirrorAtkUp');
      if (share) applyEffect(enemy, { type: 'atkUp', value: Math.round(e.value * share) / 100, turns: e.turns }, 'mirror', enemy);
    }
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

function defend(defender, raw, { isNp, ignoreDefense, sureHit, ignoreCut = false, card }) {
  if (hasBuff(defender, 'invincible')) return { amount: 0, blocked: 'invincible' };
  if (!isNp && !ignoreDefense && !sureHit && hasBuff(defender, 'evade')) return { amount: 0, blocked: 'evade' };
  const cut = ignoreDefense || ignoreCut ? 0 : Math.min(T.maxDamageCut, sumBuff(defender, 'damageCut'));
  // cardVuln: takes more damage from one card type (attacks and NPs of that card)
  const vuln = 1 + (sumBuff(defender, 'defDown') + (card ? sumBuff(defender, 'cardVuln', card) : 0)) / 100;
  return { amount: Math.round(raw * vuln * (1 - cut / 100)), blocked: null };
}

function attackPacket(att, def, card, { counter, empowered, nextHit = 0, vsBonus = 0 }) {
  let raw = att.atk * T.cards[card].mult * atkMultiplier(att, card, nextHit) * (1 + vsBonus / 100);
  if (hasAffinity(att, card)) raw *= 1 + T.affinityBonus[card];
  if (counter) raw *= 1 + T.counterBonus;
  if (empowered) raw *= 1 + T.seals.empowerBonus;
  raw += sumBuff(att, 'flatDamage');
  const sureHit = att.buffs.some(b => b.type === 'sureHit' && (!b.card || b.card === card));
  // ignoreDamageCut (Iskandar): attacks and NPs go straight through damage cut; Evade still works
  const out = defend(def, raw, { isNp: false, ignoreDefense: false, sureHit, ignoreCut: hasBuff(att, 'ignoreDamageCut'), card });
  return { ...out, sureHit };
}

// NPs use the same ATK modifiers as regular attacks: atkUp/atkDown, card effectiveness
// (cardUp for the NP's card, incl. class passives), next-hit boosts, bonus vs status and flat damage.
function npPacket(att, def, np, { empowered = false, nextHit = 0, vsBonus = 0 } = {}) {
  let mult = np.mult * (empowered ? 1 + T.seals.empowerBonus : 1);
  if (np.missingHpBonus) mult *= 1 + np.missingHpBonus * (1 - def.hp / def.maxHp);
  const raw = att.atk * mult * atkMultiplier(att, np.card, nextHit) * (1 + vsBonus / 100) * (1 + sumBuff(att, 'npUp') / 100)
    + sumBuff(att, 'flatDamage');
  return defend(def, raw, { isNp: true, ignoreDefense: !!np.ignoreDefense, ignoreCut: hasBuff(att, 'ignoreDamageCut'), card: np.card });
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
    say(`${P[i].name} uses ${skill.name}${option ? ` (${option.label})` : ''}.`, { type: 'skill', player: i, skillId: skill.id });
    applyEffects(P[i], P[1 - i], screenBuffs(state, P[i], P[1 - i], effects.filter(e => e.target !== 'enemy'), say), skill.id);
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
  const npPre = [0, 1].map(i => (npUsers.includes(i) ? screenBuffs(state, P[i], P[1 - i], nps[i].preEffects, say) : []));
  for (const i of npUsers) {
    const att = structuredClone(P[i]), def = structuredClone(P[1 - i]);
    applyEffects(att, def, npPre[i], 'np');
    // Empower boosts whichever comes first: the next regular attack or the next NP.
    // Next-hit boosts and bonus-vs-status work like Empower: used by whichever lands first, attack or NP.
    const nextHit = sumBuff(att, 'nextHitUp');
    const vs = att.buffs.find(b => b.type === 'bonusVsStatus' && hasStatus(def, b.status));
    const vsBonus = vs ? vs.value : 0;
    const pk = { from: i, to: 1 - i, kind: 'np', card: nps[i].card, empowered: P[i].empower, nextHit, vsBonus,
      ...npPacket(att, def, nps[i], { empowered: P[i].empower, nextHit, vsBonus }) };
    // Instant kill (Shaytan's Arm): rolled only when the NP connects; ignores revives.
    // npName ties the chance to one NP (Shaytan's Arm only works with Zabaniya).
    const ik = P[i].buffs.filter(b => b.type === 'instantKillChance' && (!b.npName || b.npName === nps[i].name))
      .reduce((a, b) => a + b.value, 0);
    if (ik && !pk.blocked && roll(state) * 100 < ik) pk.instantKill = true;
    packets.push(pk);
  }
  for (const i of npUsers) {
    P[i].np = 0;
    say(`${P[i].name} unleashes ${nps[i].name}${nps[i].modeName ? ` (${nps[i].modeName})` : ''}${P[i].empower ? ', empowered by a Command Seal' : ''}!`, { type: 'np', player: i });
    P[i].empower = false;
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
    gainAttackAp(P[i], T.apPerAttack + T.cards[card].apBonus + quickEff);

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
    const vs = P[i].buffs.find(b => b.type === 'bonusVsStatus' && hasStatus(P[j], b.status));
    packets.push({ from: i, to: j, kind: 'attack', card, hitAs, reason, nextHit, vsBonus: vs ? vs.value : 0,
      ...attackPacket(P[i], P[j], hitAs, { counter, empowered, nextHit, vsBonus: vs ? vs.value : 0 }) });
  }

  // 5. Apply all damage simultaneously
  for (const pk of packets) {
    const att = P[pk.from], def = P[pk.to];
    if (pk.blocked) {
      say(`${def.name} negates ${att.name}'s ${pk.kind === 'np' ? 'Noble Phantasm' : CARD_NAME[pk.card] + ' attack'} (${pk.blocked}).`, { type: 'blocked', ...pk });
      continue;
    }
    // Terror: a frightened servant may not follow through on a regular attack. Ends once it triggers.
    const terror = pk.kind === 'attack' ? att.buffs.find(b => b.type === 'terror') : null;
    if (terror && roll(state) * 100 < terror.value) {
      att.buffs.splice(att.buffs.indexOf(terror), 1);
      say(`${att.name} freezes in terror and doesn't follow through!`, { type: 'blocked', ...pk, blocked: 'terror' });
      continue;
    }
    // One Hundred Personas: regular attacks on this servant may miss outright (Sure Hit ignores it)
    const miss = pk.kind === 'attack' && !pk.sureHit ? sumBuff(def, 'missChance') : 0;
    if (miss && roll(state) * 100 < miss) {
      say(`${att.name}'s ${CARD_NAME[pk.card]} attack strikes a decoy and misses! (${def.name})`, { type: 'blocked', ...pk });
      continue;
    }
    def.hp -= pk.amount;
    if (pk.instantKill) {
      def.hp = 0;
      def.instantKilled = true;
      say(`Instant kill! ${def.name} is struck down outright and cannot revive.`, { type: 'instantKill', player: pk.to });
    }
    gainNp(def, T.npGainOnHit, { defending: true });
    if (pk.kind === 'attack') {
      const artsBoosted = pk.hitAs === 'arts' && (effectiveness(att, 'arts') > 0 || pk.nextHit > 0 || sumBuff(def, 'cardVuln', 'arts') > 0);
      const artsEffect = artsBoosted ? T.artsEffectNpGain : 0; // flat, once
      gainNp(att, T.cards[pk.hitAs].npGain, { card: pk.hitAs, artsEffect });
      const nextHitAp = pk.nextHit && pk.card === 'quick' ? 1 : 0;
      att.ap = Math.min(att.maxAp, att.ap + T.apOnLand + nextHitAp);
    }
    if (pk.nextHit) att.buffs = att.buffs.filter(b => b.type !== 'nextHitUp'); // consumed on a landed attack or NP
    if (pk.vsBonus) att.buffs = att.buffs.filter(b => b.type !== 'bonusVsStatus'); // one hit only
    say(`${att.name} hits ${def.name} for ${pk.amount}${pk.hitAs && pk.hitAs !== pk.card ? ` (${CARD_NAME[pk.card]} → Buster)` : ''}${pk.reason === 'counter' ? ' (counter!)' : ''}.`, { type: 'hit', ...pk });
    // Summoning: Sea Demons — a landed Arts attack may bring a follow-up hit for a share of its damage
    if (pk.kind === 'attack' && !pk.instantKill) for (const b of att.buffs.filter(b => b.type === 'extraHitChance' && b.card === pk.hitAs)) {
      if (roll(state) * 100 >= b.value) continue;
      const extra = Math.max(1, Math.round(pk.amount * (b.ratio ?? 30) / 100));
      def.hp -= extra;
      say(`A Sea Demon lashes ${def.name} for ${extra}!`, { type: 'hit', from: pk.from, to: pk.to, kind: 'extra', card: pk.hitAs, amount: extra });
    }
  }
  for (const i of npUsers) applyEffects(P[i], P[1 - i], npPre[i], 'np');
  for (const i of npUsers) applyEffects(P[i], P[1 - i], screenBuffs(state, P[i], P[1 - i], nps[i].postEffects, say), 'np');

  // Curse: damage over time at the end of the turn (before guts, so revives still work)
  for (const p of P) {
    const dot = Math.round(sumBuff(p, 'curse'));
    if (!dot || p.hp <= 0) continue;
    p.hp -= dot;
    say(`The curse eats at ${p.name} for ${dot}.`, { type: 'curse', player: P.indexOf(p), amount: dot });
  }

  // Guts
  for (const p of P) {
    if (p.hp > 0) continue;
    if (p.instantKilled) { delete p.instantKilled; continue; } // revives don't trigger
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
