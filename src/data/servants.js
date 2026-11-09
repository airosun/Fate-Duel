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
        desc: 'NP gauge +50%',
        effects: [{ type: 'npCharge', value: 50 }] },
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
    // Utility NP: hampers the enemy rather than nuking them
    np: { name: 'Rule Breaker', card: 'arts', mult: 2.4,
          desc: 'Removes all enemy buffs (passives stay), deals light Arts damage, then enemy ATK -20% for 3 turns',
          preEffects: [{ type: 'removeBuffs', target: 'enemy' }],
          postEffects: [{ type: 'atkDown', value: 20, turns: 4, target: 'enemy' }] },
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
        desc: 'Cleanse own debuffs; Quick +40% for 3 turns',
        effects: [{ type: 'cleanse' }, { type: 'cardUp', card: 'quick', value: 40, turns: 3 }] },
      { id: 'souwa', name: 'Knowledge of the Souwa B++', cost: 5,
        desc: 'All attacks hit through Evade for 3 turns',
        effects: [{ type: 'sureHit', turns: 3 }] },
    ],
    np: { name: 'Tsubame Gaeshi', card: 'quick', mult: 3.6,
          desc: 'Quick +20% for 3 turns (boosts this NP too), then heavy Quick damage',
          preEffects: [{ type: 'cardUp', card: 'quick', value: 20, turns: 3 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  emiya: {
    id: 'emiya', name: 'EMIYA', class: 'Archer',
    fgoHp: 11521, fgoAtk: 9398, fgoNpAtk: 0.51, fgoNpDef: 3,
    favoredCard: 'arts', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'D'),
      classPassive('independentAction', 'B'),
      unique('Reality Marble', 'Has every favored-card bonus (Quick, Arts and Buster)', [{ type: 'affinityAll' }]),
      unique('Trace On', "Copies the opponent's unique passive for the match (revives can't be copied)", [{ type: 'copyEnemyUnique' }]),
    ],
    skills: [
      { id: 'eye_of_mind_true', name: 'Eye of the Mind (True) EX', cost: 5,
        desc: 'Evade and 10% damage cut for 2 turns; ATK +15% for 3 turns',
        effects: [{ type: 'evade', turns: 2 }, { type: 'damageCut', value: 10, turns: 2 },
                  { type: 'atkUp', value: 15, turns: 3 }] },
      { id: 'hawkeye', name: 'Hawkeye B+', cost: 3,
        desc: 'NP +20% now and NP gain +50% for 3 turns',
        effects: [{ type: 'npCharge', value: 20 }, { type: 'npGainUp', value: 50, turns: 3 }] },
      { id: 'circuit_connect', name: 'Circuit Connect EX', cost: 6,
        desc: 'Next landed attack is 50% more effective; set Unlimited Blade Works to a mode',
        options: [
          { id: 'buster', label: 'Buster Mode', card: 'buster' },
          { id: 'arts', label: 'Arts Mode', card: 'arts' },
          { id: 'quick', label: 'Quick Mode', card: 'quick' },
        ],
        effects: [{ type: 'nextHitUp', value: 50, turns: 3 }, { type: 'setNpMode' }] },
    ],
    np: { name: 'Unlimited Blade Works', defaultMode: 'buster',
          modes: {
            buster: { label: 'Buster Mode', card: 'buster', mult: 4.2, desc: 'Heavy Buster damage' },
            arts: { label: 'Arts Mode', card: 'arts', mult: 3.2, desc: 'Good Arts damage, then NP +20%',
                    postEffects: [{ type: 'npCharge', value: 20 }] },
            quick: { label: 'Quick Mode', card: 'quick', mult: 2.6, desc: 'Light Quick damage, then enemy ATK -20% for 3 turns',
                     postEffects: [{ type: 'atkDown', value: 20, turns: 4, target: 'enemy' }] },
          } },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  cu: {
    id: 'cu', name: 'Cú Chulainn', class: 'Lancer',
    fgoHp: 9593, fgoAtk: 7239, fgoNpAtk: 1.07, fgoNpDef: 4,
    hpMult: 0.83, // 17% below FGO-derived HP: Battle Continuation is an extra life
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'C'),
      classPassive('divinity', 'B'),
      unique('Battle Continuation', 'Revives once at 1 HP (keeps his AP and NP gauge)',
        [{ type: 'guts', value: 0, charges: 1 }]),
    ],
    skills: [
      { id: 'ath_ngabla', name: 'Ath nGabla A', cost: 4,
        desc: 'ATK +20% to +50% for 3 turns (20% + 30% × missing HP when used)',
        effects: [{ type: 'atkUp', value: 20, scaleMissingHp: 30, turns: 3 }] },
      { id: 'protection_from_arrows', name: 'Protection from Arrows B', cost: 4,
        desc: 'Evade and 10% damage cut for 2 turns',
        effects: [{ type: 'evade', turns: 2 }, { type: 'damageCut', value: 10, turns: 2 }] },
      { id: 'disengage', name: 'Disengage C', cost: 4,
        desc: 'Cleanse own debuffs and heal 15% HP',
        effects: [{ type: 'cleanse' }, { type: 'heal', value: 15 }] },
    ],
    np: { name: 'Gáe Bolg', card: 'quick', mult: 3.4,
          desc: 'Sure Hit for 2 turns, heavy Quick damage, then the enemy takes 20% more damage for 2 turns',
          preEffects: [{ type: 'sureHit', turns: 3 }],
          postEffects: [{ type: 'defDown', value: 20, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  medusa: {
    id: 'medusa', name: 'Medusa', class: 'Rider',
    fgoHp: 8937, fgoAtk: 7200, fgoNpAtk: 0.58, fgoNpDef: 3,
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'B'),
      classPassive('independentAction', 'C'),
      classPassive('riding', 'A+'),
      classPassive('divinity', 'E-'),
      unique('Breaker Gorgon', 'Each buff the opponent gives themselves has a 10% chance to fail',
        [{ type: 'buffFailChance', value: 10 }]),
    ],
    skills: [
      { id: 'mystic_eyes', name: 'Mystic Eyes A+', cost: 4,
        desc: 'Petrify the enemy: AP -3 now, and -2 AP from each attack for 3 turns',
        effects: [{ type: 'apDrain', value: 3, target: 'enemy' },
                  { type: 'apRecoveryDown', value: 2, status: 'petrified', turns: 4, target: 'enemy' }] },
      { id: 'monstrous_snake', name: 'Monstrous Snake Metamorphosis B', cost: 5,
        desc: 'ATK +20% for 3 turns; her next attack on a Petrified enemy deals +50% damage',
        effects: [{ type: 'atkUp', value: 20, turns: 3 },
                  { type: 'bonusVsStatus', status: 'petrified', value: 50, turns: 3 }] },
      { id: 'blood_fort', name: 'Blood Fort Andromeda B', cost: 4,
        desc: 'NP +35% now and NP gain +50% for 3 turns',
        effects: [{ type: 'npCharge', value: 35 }, { type: 'npGainUp', value: 50, turns: 3 }] },
    ],
    np: { name: 'Bellerophon', card: 'quick', mult: 4.4,
          desc: 'Heavy Quick damage, then the enemy gets -1 AP from each attack for 2 turns',
          postEffects: [{ type: 'apRecoveryDown', value: 1, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  hassan: {
    id: 'hassan', name: 'Hassan of the Cursed Arm', class: 'Assassin',
    fgoHp: 7594, fgoAtk: 6280, fgoNpAtk: 1.07, fgoNpDef: 4,
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('presenceConcealment', 'A+'),
      unique("Shaytan's Arm", 'Zabaniya has a 5% chance to kill outright. Revives do not trigger',
        [{ type: 'instantKillChance', value: 5, npName: 'Zabaniya' }]),
    ],
    skills: [
      { id: 'throwing', name: 'Throwing/Retrieval A', cost: 3,
        desc: 'AP +2 now, then +2 AP at the end of this turn and the next',
        effects: [{ type: 'apGain', value: 2 }, { type: 'apRegen', value: 2, turns: 2 }] },
      { id: 'self_modification', name: 'Self-Modification C', cost: 3,
        desc: 'Quick +45% for 3 turns',
        effects: [{ type: 'cardUp', card: 'quick', value: 45, turns: 3 }] },
      { id: 'protection_from_wind', name: 'Protection from Wind A', cost: 4,
        desc: 'Evade for 2 turns and NP gain +30% for 3 turns',
        effects: [{ type: 'evade', turns: 2 }, { type: 'npGainUp', value: 30, turns: 3 }] },
    ],
    np: { name: 'Zabaniya', card: 'quick', mult: 4.0,
          desc: 'Heavy Quick damage, then ATK +20% for 3 turns',
          postEffects: [{ type: 'atkUp', value: 20, turns: 4 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  gilgamesh: {
    id: 'gilgamesh', name: 'Gilgamesh', class: 'Archer',
    fgoHp: 13097, fgoAtk: 12280, fgoNpAtk: 0.34, fgoNpDef: 3,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('independentAction', 'A+'),
      classPassive('magicResistance', 'E'),
      classPassive('divinity', 'B'),
      unique('Ea', "Neutralizes the opponent's unique passives for the whole match",
        [{ type: 'neutralizeEnemyUnique' }]),
    ],
    skills: [
      { id: 'saw_it_all', name: 'The One Who Saw It All EX', cost: 5,
        desc: 'ATK +20% and NP damage +20% for 3 turns',
        effects: [{ type: 'atkUp', value: 20, turns: 3 }, { type: 'npUp', value: 20, turns: 3 }] },
      { id: 'golden_rule', name: 'Golden Rule A', cost: 3,
        desc: 'NP gain +50% for 3 turns and 10% damage cut for 2 turns',
        effects: [{ type: 'npGainUp', value: 50, turns: 3 }, { type: 'damageCut', value: 10, turns: 2 }] },
      { id: 'treasury', name: 'Treasury of Babylon EX', cost: 6,
        desc: 'NP +30% and AP +3 now; Buster +25% for 3 turns',
        effects: [{ type: 'npCharge', value: 30 }, { type: 'apGain', value: 3 },
                  { type: 'cardUp', card: 'buster', value: 25, turns: 3 }] },
    ],
    np: { name: 'Enuma Elish', card: 'buster', mult: 3.0,
          desc: 'NP damage +30% for this NP, then heavy Buster damage',
          preEffects: [{ type: 'npUp', value: 30, turns: 1 }] },
  },
};

export const ROSTER = Object.values(SERVANTS);
