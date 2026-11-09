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
  defDown: 'DEF↓', flatDamage: 'Flat Dmg',
};

export function buffChip(b) {
  let label = BUFF_LABEL[b.type] ?? b.type;
  if (b.type === 'cardUp') label = `${CARD_LABEL[b.card]}↑`;
  if (b.type === 'cardNpGainUp') label = `${CARD_LABEL[b.card]} NP↑`;
  const val = b.value && !['evade', 'invincible', 'busterConvert', 'apRegen', 'flatDamage'].includes(b.type)
    ? ` ${Math.round(b.value)}%` : (['apRegen', 'flatDamage'].includes(b.type) ? ` +${b.value}` : '');
  const turns = b.turns === null ? '' : `<em>${b.turns}T</em>`;
  return { label: label + val, turns, debuff: !!b.debuff, passive: b.turns === null };
}
