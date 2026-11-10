// Human-readable text for skills, NPs and buffs, generated from effect data.
// A skill's own `desc` wins when present.

import { TUNING as T } from '/src/engine/constants.js';

export const CARD_LABEL = { quick: 'Quick', arts: 'Arts', buster: 'Buster' };

const turnsText = (e) => {
  let t = e.turns ?? T.defaultTurns[e.type];
  if (e.type === 'invincible') t = 1;
  if (t > 50) return ' (rest of battle)';
  return t ? ` (${t}T)` : '';
};

const cap = t => (t ? t[0].toUpperCase() + t.slice(1) : '');

export function describeEffect(e) {
  const base = describeEffectCore(e);
  if (e.condition === 'hpBelow') return `${base} (if below ${e.threshold}% HP)`;
  if (e.condition === 'hpAtLeast') return `${base} (if at ${e.threshold}%+ HP)`;
  return base;
}

function describeEffectCore(e) {
  const v = e.value;
  const c = CARD_LABEL[e.card] ?? '';
  const who = e.target === 'enemy' ? 'Enemy ' : '';
  switch (e.type) {
    case 'atkUp': return `ATK +${v}%${turnsText(e)}`;
    case 'cardUp': return `${c} +${v}%${turnsText(e)}`;
    case 'npUp': return `NP damage +${v}%${turnsText(e)}`;
    case 'damageCut': return `Damage cut ${v}%${turnsText(e)}`;
    case 'evade': return `Evade${turnsText(e)}`;
    case 'invincible': return `Invincible (this turn)`;
    case 'npGainUp': return `NP gain +${v}%${turnsText(e)}`;
    case 'cardNpGainUp': return `${c} NP gain +${v}%${turnsText(e)}`;
    case 'debuffResist': return `Debuffs on self ${v}% weaker`;
    case 'guts': return `Guts: revive at ${v}% HP${e.charges ? ` (${e.charges}×)` : ''}${e.onRevive ? `; then ${e.onRevive.map(x => describeEffect(x)).join(', ')}` : ''}`;
    case 'atkDown': return `${who}ATK −${v}%${turnsText(e)}`;
    case 'apRegen': return `+${v} AP each turn`;
    case 'busterConvert': return `Next attack hits as Buster`;
    case 'defDown': return `${who}takes +${v}% damage${turnsText(e)}`;
    case 'flatDamage': return `+${v} flat damage per hit`;
    case 'maxApUp': return `Max AP +${v}`;
    case 'cleanse': return `Cleanse own debuffs`;
    case 'sureHit': return `Sure Hit${c ? ` (${c})` : ''}: attacks always hit${turnsText(e)}`;
    case 'pierceEvade': return `${c ? c + ' attacks' : 'Attacks'} pierce Evade and decoys`;
    case 'debuffPotency': return `Debuffs ignore ${v}% resistance`;
    case 'debuffUp': return `Debuff effectiveness +${v}%${turnsText(e)}`;
    case 'nextHitUp': return `Next landed attack ${v}% more effective`;
    case 'apDrain': return `${who}AP −${v}`;
    case 'apRecoveryDown': return `${who}${e.status === 'petrified' ? 'Petrified: ' : ''}−${v} AP from attacks${turnsText(e)}`;
    case 'bonusVsStatus': return `Next attack vs ${e.status} +${v}% damage`;
    case 'buffFailChance': return `Enemy self-buffs ${v}% likely to fail`;
    case 'copyEnemyUnique': return `Copies the enemy's unique passive`;
    case 'neutralizeEnemyUnique': return `Neutralizes the enemy's unique passives`;
    case 'ignoreDamageCut': return `Attacks and NP ignore damage cut${turnsText(e)}`;
    case 'missChance': return `Attacks on him ${v}% likely to miss`;
    case 'maxApUp': return `Max AP +${v}${turnsText(e)}`;
    case 'npSteal': return `${who}NP -${v}%, gained by self`;
    case 'npOnlyKo': return 'Only an NP can down him; Sure Hit breaks this';
    case 'rpsOverride': return `${v}% chance ${c} beats ${e.vs}`;
    case 'divineIntervention': return 'Divine Intervention (negate the next damaging hit)';
    case 'npDown': return `${who}NP damage -${v}%${turnsText(e)}`;
    case 'npRegen': return `+${v}% NP each turn${turnsText(e)}`;
    case 'battleChoice': return 'choose a hand at battle start';
    case 'shock': return `${who}Shock (${v} per turn)${turnsText(e)}${e.chance != null ? ` at ${e.chance}% chance` : ''}`;
    case 'burn': return `Burn self (${v} per turn)${turnsText(e)}`;
    case 'lastStand': return 'Survive one lethal blow for a final NP';
    case 'hpRegen': return `heal ${v}% HP each turn${turnsText(e)}`;
    case 'poison': return `${who}Poison (${v} per turn)${turnsText(e)}`;
    case 'nullifyBoosts': return `${who}deals base damage (boosts ignored)${turnsText(e)}`;
    case 'taunt': return `${who}Taunt next turn (attacks only)`;
    case 'confusion': return `${who}Confusion (${v}% a skill fizzles)${turnsText(e)}`;
    case 'stun': return e.value >= 100 ? `${who}can't act next turn${e.chance != null ? ` (${e.chance}% chance${e.onMiss ? '; on a miss: ' + e.onMiss.map(x => describeEffect(x)).join(', ') : ''})` : ''}` : `${who}${v}% chance to lose next turn`;
    case 'debuffOnHit': return `${v}% chance on hit: ${e.inflict?.type === 'terror' ? 'Terror' : e.inflict?.type === 'poison' ? `Poison (${e.inflict.value}/turn)` : cap(e.inflict?.type)}`;
    case 'apChance': return `${v}% chance of +${e.amount} AP each turn${turnsText(e)}`;
    case 'npSeal': return `${who}NP Seal this turn (NP fizzles, -${v}% gauge)`;
    case 'debuffResistDown': return `${who}debuff resist -${v}%${turnsText(e)}`;
    case 'doubleShot': return `${v}% chance of a second arrow on ${c} attacks`;
    case 'foresight': return `${e.charges}× per battle: see the opponent's locked action first${e.deceive ? ` (${e.deceive}% chance it's a lie)` : ''}`;
    case 'madness': return `${who}Madness: random action next turn`;
    case 'charm': return `${who}Charm: next turn their attack loses the clash`;
    case 'starCrossed': return `${v}% chance a fall takes both servants`;
    case 'randomWork': return 'a random work each battle';
    case 'hpCost': return `lose ${v}% HP (can't KO)`;
    case 'removeDefBuffs': return `${who}loses Evade, Invincible and damage cut`;
    case 'statusOnHit': return `${v}% chance to mark the enemy ${e.status} on hit`;
    case 'dmgVsStatus': return `+${v}% damage vs ${e.status}${turnsText(e)}`;
    case 'terror': return `${who}Terror (${v}% chance to skip an attack)${turnsText(e)}`;
    case 'curse': return `${who}Curse (${v} damage per turn)${turnsText(e)}`;
    case 'extraHitChance': return `${v}% chance of a ${e.ratio}% follow-up hit on ${c} attacks`;
    case 'buffSuccessUp': return `Buff success +${v}%${turnsText(e)}`;
    case 'cardVuln': return `${who}takes +${v}% ${c} damage${turnsText(e)}`;
    case 'mirrorAtkUp': return `Copies ${v}% of enemy ATK buffs`;
    case 'apRecoveryUp': return `+${v} AP from attacks${turnsText(e)}`;
    case 'instantKillChance': return `NP ${v}% chance to kill outright`;
    case 'affinityAll': return `Every favored-card bonus`;
    case 'setNpMode': return `Change NP mode`;
    case 'heal': return `${who}Heal ${v}% HP`;
    case 'npCharge': return `NP +${v}%`;
    case 'npDrain': return `${who}NP −${v}%`;
    case 'apGain': return `+${v} AP`;
    case 'removeBuffs': return `Remove ${who.toLowerCase() || 'enemy '}buffs`;
    default: return e.type;
  }
}

export const describeEffects = (effects = []) =>
  effects.map(e => describeEffect(e) + (e.condition === 'afterRevive' ? ' (after revive)' : '')).join(' · ');

export function describeSkill(s) {
  return s.desc ?? describeEffects(s.effects);
}

export function describeNp(np) {
  if (np.modes && !np.modeName) {
    return Object.values(np.modes).map(m => `${m.label}: ${m.mult}× ${CARD_LABEL[m.card]}${m.desc ? ` (${m.desc})` : ''}`).join(' · ');
  }
  if (np.desc) return np.desc;
  const parts = [`${np.mult}× ATK ${CARD_LABEL[np.card]} damage`];
  if (np.ignoreDefense) parts.push('ignores Damage Cut and Evade');
  else if (np.ignoreCut) parts.push('ignores damage cut');
  if (np.missingHpBonus) parts.push('stronger vs low-HP targets');
  if (np.preEffects?.length) parts.unshift(describeEffects(np.preEffects));
  if (np.postEffects?.length) parts.push(describeEffects(np.postEffects));
  return parts.join(' · ');
}

const BUFF_LABEL = {
  atkUp: 'ATK↑', cardUp: '↑', npUp: 'NP Dmg↑', damageCut: 'DEF↑', evade: 'Evade',
  invincible: 'Invincible', npGainUp: 'NP Gain↑', cardNpGainUp: 'NP Gain↑', debuffResist: 'Debuff Res',
  guts: 'Guts', atkDown: 'ATK↓', apRegen: 'AP Regen', busterConvert: 'Buster Strike',
  defDown: 'DEF↓', flatDamage: 'Flat Dmg', sureHit: 'Sure Hit', pierceEvade: 'Pierce Evade', debuffPotency: 'Debuff Potency', debuffUp: 'Debuff↑',
  nextHitUp: 'Next Hit↑', affinityAll: 'All Cards Favored', apRecoveryDown: 'AP Recovery↓',
  bonusVsStatus: 'vs Petrified↑', buffFailChance: 'Breaker Gorgon', copyEnemyUnique: 'Trace On',
  instantKillChance: 'Instant Kill', neutralizeEnemyUnique: 'Ea', ignoreDamageCut: 'Pierce DEF', terror: 'Terror', curse: 'Curse', divineIntervention: 'Divine Intervention', npDown: 'NP Dmg↓', buffDurationUp: 'Buffs +1T', debuffDurationUp: 'Debuffs +1T', npRegen: 'NP Regen', shock: 'Shock', burn: 'Burn', lastStand: 'Unyielding Will', lastStandActive: 'Blaze of Glory', hpRegen: 'HP Regen', madness: 'Madness', charm: 'Charm', starCrossed: 'Star-Crossed', rpsOverride: 'Misty Night', poison: 'Poison', nullifyBoosts: 'No Boosts', npOnlyKo: 'Kosmos', taunt: 'Taunted', confusion: 'Confusion', stun: 'Trap', debuffOnHit: 'Black Luna', apChance: 'AP Chance', npSeal: 'NP Seal', debuffResistDown: 'Debuff Res↓', doubleShot: 'Golden Apple', foresight: 'Foresight', maxApUp: 'Max AP↑', statusOnHit: "Fafnir's Blood", dmgVsStatus: 'vs Dragon↑', extraHitChance: 'Sea Demons', missChance: 'Decoys', buffSuccessUp: 'Buff Success↑', cardVuln: '↓ Resist',
  mirrorAtkUp: 'Arms Mastery', apRecoveryUp: 'AP Recovery↑',
};

// Plain-language explanation of what a buff, debuff or passive does.
export function explainBuff(b) {
  const v = Math.round(b.value * 10) / 10;
  const c = CARD_LABEL[b.card];
  switch (b.type) {
    case 'atkUp': return `Deals ${v}% more damage with every attack and Noble Phantasm.`;
    case 'cardUp': {
      const extra = b.card === 'arts' ? ` Arts hits also give +${T.artsEffectNpGain}% NP gain.`
        : b.card === 'quick' ? ` Quick attacks also give +${T.quickEffectAp} AP.` : '';
      return `${c} attacks and ${c} Noble Phantasms deal ${v}% more damage.${extra}`;
    }
    case 'npUp': return `Noble Phantasm deals ${v}% more damage.`;
    case 'damageCut': return `Takes ${v}% less damage from attacks and Noble Phantasms.`;
    case 'evade': return 'Dodges regular attacks. Noble Phantasms still hit.';
    case 'invincible': return 'Takes no damage from anything, Noble Phantasms included.';
    case 'npGainUp': return `Gains ${v}% more NP from hits.`;
    case 'cardNpGainUp': return `${c} hits give ${v}% more NP.`;
    case 'debuffResist': return `Enemy debuffs on this servant are ${v}% weaker.`;
    case 'guts': {
      const at = b.value ? `${v}% HP` : '1 HP';
      const reset = b.resetNp || b.resetAp ? ' Its NP gauge and AP drop to 0 when it revives.' : ' Keeps its AP and NP gauge.';
      const bonus = b.onRevive?.length ? ` On revival: ${b.onRevive.map(x => describeEffect(x)).join(', ')}.` : '';
      return `Survives one killing blow and comes back at ${at}.${reset}${bonus}`;
    }
    case 'atkDown': return `Deals ${v}% less damage.`;
    case 'defDown': return `Takes ${v}% more damage from attacks and Noble Phantasms.`;
    case 'apRegen': return `Gains ${v} AP at the end of every turn.`;
    case 'busterConvert': return 'The next attack deals damage and gains NP as a Buster card, but still clashes as the card picked.';
    case 'flatDamage': return `Adds ${v} damage to every hit.`;
    case 'sureHit': return `Sure Hit: ${c ? `${c} attacks` : 'attacks'} always hit. They pierce Evade and can't be dodged by decoys (One Hundred Personas). Invincible still blocks them.`;
    case 'pierceEvade': return `${c ? `${c} attacks` : 'Attacks'} pierce Evade and can't be dodged by decoys. This is not Sure Hit, so effects that specifically need Sure Hit don't apply.`;
    case 'nextHitUp': return `The next attack or Noble Phantasm that lands is ${v}% more effective.`;
    case 'affinityAll': return 'Gets the favored-card bonus on Quick, Arts and Buster.';
    case 'debuffPotency': return `This servant's debuffs ignore up to ${v}% of the enemy's debuff resistance.`;
    case 'debuffUp': return `Debuffs this servant inflicts are ${v}% stronger: bigger stat drops, NP and AP drains, Curse damage and Terror chance.`;
    case 'buffFailChance': return `Each buff the opponent gives themselves has a ${v}% chance to fail.`;
    case 'copyEnemyUnique': return "Copies the opponent's unique passive for the match. Revives can't be copied.";
    case 'apRecoveryDown': return `${b.status === 'petrified' ? 'Petrified: g' : 'G'}ains ${Math.round(b.value)} less AP from each attack.`;
    case 'bonusVsStatus': return `The next attack or Noble Phantasm against a ${b.status} enemy deals ${v}% more damage.`;
    case 'divineIntervention': return 'Divine Intervention: the next hit that would deal damage (attack, NP or follow-up) is negated, then this is spent. Damage over time is not stopped. Buff-stripping effects remove it.';
    case 'npDown': return `NP damage -${v}%.`;
    case 'buffDurationUp': return `Buffs this servant gives itself last ${v} turn${v === 1 ? '' : 's'} longer.`;
    case 'debuffDurationUp': return `Debuffs this servant puts on the enemy last ${v} turn${v === 1 ? '' : 's'} longer.`;
    case 'npRegen': return `Gains ${v}% NP at the end of each turn.`;
    case 'shock': return `Shocked: takes ${Math.round(b.value)} damage at the end of each turn. Each Shock is a separate stack; stacks add up.`;
    case 'burn': return `Burning: takes ${Math.round(b.value)} damage at the end of each turn. Recasting the skill refreshes the Burn instead of stacking it.`;
    case 'lastStand': return "Unyielding Will: once, a lethal blow leaves him at 1 HP with a full NP gauge. Next turn he must fire his NP and can't fall before it lands. Then he falls, unless it took the enemy down.";
    case 'lastStandActive': return "Blaze of Glory: he must fire his Noble Phantasm this turn and can't fall before it lands. At the end of the turn he falls, unless the enemy is down.";
    case 'hpRegen': return `Heals ${v}% of max HP at the end of each turn.`;
    case 'rpsOverride': return `When a ${c} attack meets ${b.vs === 'buster' ? 'Buster' : b.vs}, a ${v}% chance the ${c} attack wins the clash instead.`;
    case 'poison': return `Poisoned: takes ${Math.round(b.value)} damage at the end of each turn. Each Poison is a separate stack; stacks add up.`;
    case 'nullifyBoosts': return "Double Summon: this servant deals base damage. Its ATK up, card effectiveness, NP damage up, flat damage and other boosts (passives too) are ignored. Debuffs still apply.";
    case 'npOnlyKo': return "Can only be downed by a Noble Phantasm: anything else leaves this servant at 1 HP. A landed Sure Hit attack strikes the heel and removes this.";
    case 'taunt': return 'Taunted: can only attack (no skills, no Noble Phantasm).';
    case 'confusion': return `Confused: ${v}% chance a skill fizzles (AP is still spent). Ends once it triggers.`;
    case 'stun': return String(b.source).startsWith('gods_resolution') ? `Blinded by Holy Light: ${v >= 100 ? 'loses' : `${v}% chance to lose`} the whole next action (Magic Resistance can shrink the chance).` : `Trapped: ${v}% chance to lose the whole next action. Rolled once, when that turn resolves.`;
    case 'debuffOnHit': return `A landed regular attack has a ${v}% chance to inflict ${b.inflict?.type === 'terror' ? `Terror (${b.inflict.value}%)` : b.inflict?.type === 'poison' ? `Poison (${b.inflict.value} damage per turn, stacking)` : cap(b.inflict?.type)} on the enemy.`;
    case 'apChance': return `At the end of each turn, a ${v}% chance to gain ${b.amount ?? 2} AP.`;
    case 'npSeal': return `NP Seal: if this servant uses its Noble Phantasm this turn, it fizzles and the gauge drops ${v}%.`;
    case 'debuffResistDown': return `Debuff resistance -${v}%: debuffs on this servant are stronger.`;
    case 'doubleShot': return `${c} attacks have a ${v}% chance to loose a second arrow: +${b.ratio ?? 50}% damage if the attack landed, or a full-damage hit if it was beaten (Evade and Invincible still stop it).`;
    case 'foresight': return `${b.charges ?? 0} use${b.charges === 1 ? '' : 's'} left: see the opponent's locked-in action before choosing.${b.deceive ? ` Othello deceives: a ${b.deceive}% chance what you see is a lie.` : ''}`;
    case 'madness': return 'Madness: next turn this servant takes a random action instead of the one chosen.';
    case 'charm': return "Charmed: next turn, if both servants attack, this servant's card becomes the one that loses to the charmer's.";
    case 'starCrossed': return `Romeo and Juliet: when either servant falls, a ${v}% chance the other falls too and the battle ends in a draw.`;
    case 'maxApUp': return `Max AP +${v}. AP above the normal maximum is lost when this ends.`;
    case 'statusMark': return b.status === 'dragon' ? 'Dragon: no effect on its own, but Siegfried\'s Dragon Slayer and Balmung deal extra damage to it.' : `Marked: ${b.status}.`;
    case 'statusOnHit': return `A landed regular attack has a ${v}% chance to mark the enemy as ${b.status[0].toUpperCase() + b.status.slice(1)} for the next turn.`;
    case 'dmgVsStatus': return `Attacks and Noble Phantasms deal ${v}% more damage to a ${b.status[0].toUpperCase() + b.status.slice(1)} enemy.`;
    case 'terror': return `Terrified: ${v}% chance to not follow through on a regular attack. Ends once it triggers.`;
    case 'curse': return `Cursed: takes ${Math.round(b.value)} damage at the end of each turn.`;
    case 'extraHitChance': return `A landed ${c} attack has a ${v}% chance to bring a follow-up hit for ${b.ratio ?? 30}% of its damage.`;
    case 'missChance': return `Regular attacks against this servant have a ${v}% chance to miss. Sure Hit ignores this.`;
    case 'buffSuccessUp': return `Chance-based buffs are ${v}% more likely to land, and enemy buff-failure effects are ${v}% weaker.`;
    case 'cardVuln': return `Takes ${v}% more damage from ${c} attacks and ${c} Noble Phantasms. ${c === 'Arts' ? `Arts hits on this servant also give the attacker +${T.artsEffectNpGain}% NP gain.` : ''}`;
    case 'mirrorAtkUp': return `When the enemy raises its own ATK, this servant gains ${v}% of that boost for the same duration.`;
    case 'apRecoveryUp': return `Gains ${Math.round(b.value)} more AP from each attack.`;
    case 'ignoreDamageCut': return "Attacks and Noble Phantasms go straight through the enemy's damage cut. Evade still dodges regular attacks.";
    case 'neutralizeEnemyUnique': return "Switches off all of the opponent's unique passives for the whole match.";
    case 'instantKillChance': return b.npName
      ? `${b.npName} has a ${v}% chance to kill outright when it connects. Revives don't trigger.${b.copiedFrom ? ` Only works with ${b.npName}, so it has no effect here.` : ''}`
      : `Each Noble Phantasm that connects has a ${v}% chance to kill outright. Revives don't trigger.`;
    default: return '';
  }
}

export function buffChip(b) {
  let label = BUFF_LABEL[b.type] ?? b.type;
  if (b.type === 'cardUp') label = `${CARD_LABEL[b.card]}↑`;
  if (b.type === 'cardNpGainUp') label = `${CARD_LABEL[b.card]} NP↑`;
  if (b.type === 'sureHit' && b.card) label = `${CARD_LABEL[b.card]} Sure Hit`;
  if (b.type === 'apRecoveryDown' && b.status === 'petrified') label = 'Petrified';
  if (b.type === 'cardVuln') label = `${CARD_LABEL[b.card]} Resist↓`;
  if (b.type === 'terror') label = 'Terror';
  if (b.type === 'extraHitChance') label = b.source === "Golem's Support" ? 'Golem' : 'Sea Demons';  // value is appended below
  if (b.type === 'foresight') label = `Foresight ×${b.charges ?? 0}`;
  if (b.type === 'stun' && String(b.source).startsWith('gods_resolution')) label = 'Blinded';
  if (b.type === 'doubleShot') label = '2nd Arrow';
  if (b.type === 'statusMark') label = b.status[0].toUpperCase() + b.status.slice(1);
  if (b.type === 'curse') label = 'Curse';
  // Labels never include the value; it's appended once here.
  const val = b.type === 'apRecoveryDown' ? ` −${Math.round(b.value)} AP` : b.type === 'apRecoveryUp' ? ` +${Math.round(b.value)} AP`
    : ['curse', 'poison', 'shock', 'burn'].includes(b.type) ? ` ${Math.round(b.value)}/turn` : ['hpRegen', 'npRegen'].includes(b.type) ? ` ${b.value}%/turn` : ['buffDurationUp', 'debuffDurationUp'].includes(b.type) ? ''
    : b.value && !['evade', 'invincible', 'busterConvert', 'apRegen', 'flatDamage', 'sureHit', 'copyEnemyUnique', 'guts', 'ignoreDamageCut', 'nullifyBoosts', 'madness', 'charm', 'lastStand', 'lastStandActive', 'divineIntervention', 'taunt', 'npOnlyKo', 'pierceEvade', 'statusMark'].includes(b.type)
      ? ` ${Math.round(b.value)}%` : (['apRegen', 'flatDamage'].includes(b.type) ? ` +${b.value}` : '');
  const kind = b.debuff ? 'debuff' : b.turns === null ? 'passive' : 'active';
  let duration;
  if (b.copiedFrom) duration = `Copied from ${b.copiedFrom} · lasts the whole match`;
  else if (b.turns === null) duration = b.charges != null ? `Passive · ${b.charges} use${b.charges === 1 ? '' : 's'} left` : 'Passive · lasts the whole match';
  else if (b.turns > 50) duration = 'Lasts the rest of the battle (can be removed)';
  else if (b.turns === 1) duration = 'Ends after this turn';
  else duration = `${b.turns} turns left, including this one`;
  if (b.type === 'busterConvert') duration += ' · used up by one attack';
  if (b.type === 'nextHitUp' || b.type === 'bonusVsStatus') duration += ' · used up by the next attack or NP';
  return { label: label + val, kind, duration, explain: explainBuff(b) };
}
