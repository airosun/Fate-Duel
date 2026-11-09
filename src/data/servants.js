// Servant definitions. Pure data — the engine reads these, never modifies them.
//
// ⚠ fgoHp / fgoAtk are approximate max (non-grailed) values from memory —
// verify against the FGO wiki before finalizing. Game HP/ATK are derived
// from them (see deriveStats); set `hp` / `atk` directly to override.
//
// Effect reference (engine v1)
//   instant:  heal{value:%maxHp} npCharge{value} npDrain{value} apGain{value} removeBuffs
//   duration: atkUp{value:%} cardUp{card,value:%} npUp{value:%} damageCut{value:%}
//             evade (default 2 turns) invincible (always 1 turn) npGainUp{value:%}
//             cardNpGainUp{card,value:%} debuffResist{value:%} guts{value:%hp, charges}
//             atkDown{value:%} apRegen{value} busterConvert (next attack hits as Buster)
//   target: 'self' (default) or 'enemy'
// Servant fields: fgoHp, fgoAtk, fgoNpAtk (% per hit), fgoNpDef (%), favoredCard,
//   maxAp, passives: class passives via classPassive(key, rank) + one unique(name, desc, effects)
// Extra effect types: defDown{value:%} (enemy takes more damage), flatDamage{value}, maxApUp{value}
// Effect condition: condition: 'afterRevive' (only applies once guts has triggered)
//   turns counts the turn it's applied on (turns:2 = this turn + next). Passives are permanent.
//
// NP fields: name, card, mult (× ATK), ignoreDefense, missingHpBonus,
//            preEffects (before damage), postEffects (after damage)

import { classPassive, unique } from './passives.js';

export const SERVANTS = {
  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  artoria: {
    id: 'artoria', name: 'Artoria Pendragon', class: 'Saber',
    fgoHp: 15150, fgoAtk: 11221, fgoNpAtk: 0.86, fgoNpDef: 3,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'A'),
      classPassive('riding', 'B'),
      unique('Invisible Air', 'Permanent 5% damage cut', [{ type: 'damageCut', value: 5 }]),
    ],
    skills: [
      { id: 'knight_of_utopia', name: 'Knight of Utopia EX', cost: 4,
        desc: 'ATK +20% and Buster NP gain +100% for 3 turns',
        effects: [{ type: 'atkUp', value: 20, turns: 3 },
                  { type: 'cardNpGainUp', card: 'buster', value: 100, turns: 3 }] },
      { id: 'dragon_reactor', name: 'Dragon Reactor Core B', cost: 5,
        desc: 'Buster +25% and NP damage +15% for 3 turns; next attack hits as Buster (keeps its chosen card for the clash)',
        effects: [{ type: 'cardUp', card: 'buster', value: 25, turns: 3 },
                  { type: 'npUp', value: 15, turns: 3 },
                  { type: 'busterConvert', turns: 3 }] },
      { id: 'radiant_road', name: 'Radiant Road EX', cost: 3,
        desc: 'NP gauge +25% and 15% damage cut for 2 turns',
        effects: [{ type: 'npCharge', value: 25 }, { type: 'damageCut', value: 15, turns: 2 }] },
    ],
    np: { name: 'Excalibur', card: 'buster', mult: 3.5,
          desc: 'Heavy Buster damage, then refunds 15% NP',
          postEffects: [{ type: 'npCharge', value: 15 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  heracles: {
    id: 'heracles', name: 'Heracles', class: 'Berserker',
    fgoHp: 10327, fgoAtk: 10655, fgoNpAtk: 1.07, fgoNpDef: 5,
    hpMult: 0.73, // 27% below FGO-derived HP: his HP is split across two lives
    favoredCard: 'buster', maxAp: 8,
    passives: [
      classPassive('madness', 'B'),
      classPassive('divinity', 'A'),
      unique('12 Labors', 'Revives once at 25% HP, but his NP gauge and AP reset to 0',
        [{ type: 'guts', value: 25, charges: 1, resetNp: true, resetAp: true }]),
    ],
    skills: [
      { id: 'bravery', name: 'Bravery A+', cost: 4,
        desc: 'ATK +20% and debuffs on self 30% weaker for 3 turns',
        effects: [{ type: 'atkUp', value: 20, turns: 3 },
                  { type: 'debuffResist', value: 30, turns: 3 }] },
      { id: 'eye_of_mind', name: 'Eye of the Mind (False) B', cost: 4,
        desc: 'Evade regular attacks for 2 turns',
        effects: [{ type: 'evade', turns: 2 }] },
      { id: 'indomitable', name: 'Indomitable A', cost: 5,
        desc: 'Buster +20% for 3 turns; +40% instead after 12 Labors has revived him',
        effects: [{ type: 'cardUp', card: 'buster', value: 20, turns: 3 },
                  { type: 'cardUp', card: 'buster', value: 20, turns: 3, condition: 'afterRevive' }] },
    ],
    np: { name: 'Nine Lives', card: 'buster', mult: 3.6,
          desc: 'Heavy Buster damage, then the enemy takes 20% more damage for 2 turns',
          postEffects: [{ type: 'defDown', value: 20, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  medea: {
    id: 'medea', name: 'Medea', class: 'Caster',
    fgoHp: 8643, fgoAtk: 7418, fgoNpAtk: 1.64, fgoNpDef: 3,
    favoredCard: 'arts', maxAp: 12,
    passives: [
      classPassive('territoryCreation', 'A'),
      unique("Hecate's Staff", 'Her debuffs ignore up to 25% of enemy debuff resistance',
        [{ type: 'debuffPotency', value: 25 }]),
    ],
    skills: [
      { id: 'high_speed', name: 'High-Speed Divine Words A', cost: 5,
        desc: 'NP gauge +40%',
        effects: [{ type: 'npCharge', value: 40 }] },
      { id: 'argon_coin', name: 'Argon Coin: The Golden Fleece', cost: 3,
        desc: 'Heal 20% HP and gain 2 AP',
        effects: [{ type: 'heal', value: 20 }, { type: 'apGain', value: 2 }] },
      { id: 'witch_of_colchis', name: 'Witch of Colchis A', cost: 6,
        desc: 'Cleanse own debuffs; Arts +25%, NP damage +20% and NP gain +30% for 3 turns',
        effects: [{ type: 'cleanse' },
                  { type: 'cardUp', card: 'arts', value: 25, turns: 3 },
                  { type: 'npUp', value: 20, turns: 3 },
                  { type: 'npGainUp', value: 30, turns: 3 }] },
    ],
    np: { name: 'Rule Breaker', card: 'arts', mult: 3.0,
          desc: 'Removes all enemy buffs (passives stay), then moderate Arts damage',
          preEffects: [{ type: 'removeBuffs', target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  kojirou: {
    id: 'kojirou', name: 'Sasaki Kojirou', class: 'Assassin',
    fgoHp: 6220, fgoAtk: 5735, fgoNpAtk: 1.05, fgoNpDef: 4,
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('presenceConcealment', 'D'),
      unique('Heaven Among the Mountains', 'Quick attacks always hit through Evade',
        [{ type: 'sureHit', card: 'quick' }]),
    ],
    skills: [
      { id: 'minds_eye', name: 'Eye of the Mind (False) A', cost: 4,
        desc: 'Evade regular attacks and 10% damage cut for 2 turns',
        effects: [{ type: 'evade', turns: 2 }, { type: 'damageCut', value: 10, turns: 2 }] },
      { id: 'fade_out', name: 'Fade Out A+', cost: 4,
        desc: 'Cleanse own debuffs; Quick +30% for 3 turns',
        effects: [{ type: 'cleanse' }, { type: 'cardUp', card: 'quick', value: 30, turns: 3 }] },
      { id: 'souwa', name: 'Knowledge of the Souwa B++', cost: 5,
        desc: 'All attacks hit through Evade for 3 turns',
        effects: [{ type: 'sureHit', turns: 3 }] },
    ],
    np: { name: 'Tsubame Gaeshi', card: 'quick', mult: 3.6,
          desc: 'Quick +20% for 3 turns (boosts this NP too), then heavy Quick damage',
          preEffects: [{ type: 'cardUp', card: 'quick', value: 20, turns: 3 }] },
  },
};

export const ROSTER = Object.values(SERVANTS);
