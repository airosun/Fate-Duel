// Human-readable text for skills, NPs and buffs, generated from effect data.
// A skill's own `desc` wins when present.

import { TUNING as T } from '/src/engine/constants.js';

export const CARD_LABEL = { quick: 'Quick', arts: 'Arts', buster: 'Buster' };

const turnsText = (e) => {
  let t = e.turns ?? T.defaultTurns[e.type];
  if (e.type === 'invincible') t = 1;
  return t ? ` (${t}T)` : '';
};

export function describeEffect(e) {
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
    case 'guts': return `Guts: revive at ${v}% HP${e.charges ? ` (${e.charges}×)` : ''}`;
    case 'atkDown': return `${who}ATK −${v}%${turnsText(e)}`;
    case 'apRegen': return `+${v} AP each turn`;
    case 'busterConvert': return `Next attack hits as Buster`;
    case 'defDown': return `${who}takes +${v}% damage${turnsText(e)}`;
    case 'flatDamage': return `+${v} flat damage per hit`;
    case 'maxApUp': return `Max AP +${v}`;
    case 'cleanse': return `Cleanse own debuffs`;
    case 'sureHit': return `${c ? c + ' attacks' : 'Attacks'} pierce Evade${turnsText(e)}`;
    case 'debuffPotency': return `Debuffs ignore ${v}% resistance`;
    case 'nextHitUp': return `Next landed attack ${v}% more effective`;
    case 'apDrain': return `${who}AP −${v}`;
    case 'apRecoveryDown': return `${who}${e.status === 'petrified' ? 'Petrified: ' : ''}−${v} AP from attacks${turnsText(e)}`;
    case 'bonusVsStatus': return `Next attack vs ${e.status} +${v}% damage`;
    case 'buffFailChance': return `Enemy self-buffs ${v}% likely to fail`;
    case 'copyEnemyUnique': return `Copies the enemy's unique passive`;
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
  if (np.missingHpBonus) parts.push('stronger vs low-HP targets');
  if (np.preEffects?.length) parts.unshift(describeEffects(np.preEffects));
  if (np.postEffects?.length) parts.push(describeEffects(np.postEffects));
  return parts.join(' · ');
}

const BUFF_LABEL = {
  atkUp: 'ATK↑', cardUp: '↑', npUp: 'NP Dmg↑', damageCut: 'DEF↑', evade: 'Evade',
  invincible: 'Invincible', npGainUp: 'NP Gain↑', cardNpGainUp: 'NP Gain↑', debuffResist: 'Debuff Res',
  guts: 'Guts', atkDown: 'ATK↓', apRegen: 'AP Regen', busterConvert: 'Buster Strike',
  defDown: 'DEF↓', flatDamage: 'Flat Dmg', sureHit: 'Sure Hit', debuffPotency: 'Debuff Potency',
  nextHitUp: 'Next Hit↑', affinityAll: 'All Cards Favored', apRecoveryDown: 'AP Recovery↓',
  bonusVsStatus: 'vs Petrified↑', buffFailChance: 'Breaker Gorgon', copyEnemyUnique: 'Trace On',
};

export function buffChip(b) {
  let label = BUFF_LABEL[b.type] ?? b.type;
  if (b.type === 'cardUp') label = `${CARD_LABEL[b.card]}↑`;
  if (b.type === 'cardNpGainUp') label = `${CARD_LABEL[b.card]} NP↑`;
  if (b.type === 'sureHit' && b.card) label = `${CARD_LABEL[b.card]} Sure Hit`;
  if (b.type === 'apRecoveryDown' && b.status === 'petrified') label = 'Petrified';
  const val = b.type === 'apRecoveryDown' ? ` −${Math.round(b.value)} AP`
    : b.value && !['evade', 'invincible', 'busterConvert', 'apRegen', 'flatDamage', 'sureHit', 'copyEnemyUnique'].includes(b.type)
      ? ` ${Math.round(b.value)}%` : (['apRegen', 'flatDamage'].includes(b.type) ? ` +${b.value}` : '');
  const kind = b.debuff ? 'debuff' : b.turns === null ? 'passive' : 'active';
  let duration;
  if (b.turns === null) duration = b.charges != null ? `Passive · ${b.charges} use${b.charges === 1 ? '' : 's'} left` : 'Passive · permanent';
  else if (b.turns === 1) duration = 'Ends after this turn';
  else duration = `${b.turns} turns left (including this one)`;
  if (b.type === 'busterConvert') duration += ' · used on the next attack';
  if (b.type === 'bonusVsStatus') duration += ' · used on the next attack vs a Petrified enemy';
  if (b.type === 'apRecoveryDown') duration += ` · −${Math.round(b.value)} AP gained from each attack`;
  if (b.copiedFrom) duration = `Copied from ${b.copiedFrom} via Trace On · permanent`;
  return { label: label + val, kind, duration };
}
