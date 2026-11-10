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
      { id: 'high_speed', name: 'High-Speed Divine Words A', cost: 4,
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
    np: { name: 'Rule Breaker', card: 'arts', mult: 2.6,
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
      unique('Heaven Among the Mountains', 'Quick attacks pierce Evade and decoys (not Sure Hit)',
        [{ type: 'pierceEvade', card: 'quick' }]),
    ],
    skills: [
      { id: 'minds_eye', name: 'Eye of the Mind (False) A', cost: 4,
        desc: 'Evade regular attacks and 10% damage cut for 2 turns',
        effects: [{ type: 'evade', turns: 2 }, { type: 'damageCut', value: 10, turns: 2 }] },
      { id: 'fade_out', name: 'Fade Out A+', cost: 4,
        desc: 'Cleanse own debuffs; Quick +40% for 3 turns',
        effects: [{ type: 'cleanse' }, { type: 'cardUp', card: 'quick', value: 40, turns: 3 }] },
      { id: 'souwa', name: 'Knowledge of the Souwa B++', cost: 5,
        desc: 'Sure Hit for 3 turns (all attacks pierce Evade and decoys)',
        effects: [{ type: 'sureHit', turns: 3 }] },
    ],
    np: { name: 'Tsubame Gaeshi', card: 'quick', mult: 3.8,
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
        desc: 'Evade and 10% damage cut for 2 turns; ATK +20% for 3 turns',
        effects: [{ type: 'evade', turns: 2 }, { type: 'damageCut', value: 10, turns: 2 },
                  { type: 'atkUp', value: 20, turns: 3 }] },
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
            buster: { label: 'Buster Mode', card: 'buster', mult: 4.1, desc: 'Heavy Buster damage' },
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
    np: { name: 'Zabaniya', card: 'quick', mult: 4.1,
          desc: 'Heavy Quick damage, then ATK +20% for 3 turns',
          postEffects: [{ type: 'atkUp', value: 20, turns: 4 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  gilgamesh: {
    id: 'gilgamesh', name: 'Gilgamesh', class: 'Archer',
    fgoHp: 13097, fgoAtk: 12280, fgoNpAtk: 0.34, fgoNpDef: 3,
    hpMult: 1.06, // lore: the King of Heroes should edge out every matchup (Artoria closest)
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

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  iskandar: {
    id: 'iskandar', name: 'Iskandar', class: 'Rider',
    fgoHp: 13219, fgoAtk: 11560, fgoNpAtk: 0.86, fgoNpDef: 3,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'D'),
      classPassive('riding', 'A+'),
      classPassive('divinity', 'C'),
      unique('Bucephalus', 'Quick and Buster attacks are 10% more effective',
        [{ type: 'cardUp', card: 'quick', value: 10 }, { type: 'cardUp', card: 'buster', value: 10 }]),
    ],
    skills: [
      { id: 'towards_beyond', name: 'Those Who Go Towards the Beyond A', cost: 6,
        desc: 'NP +30% now; ATK +25% and attacks and NP ignore damage cut for 3 turns',
        effects: [{ type: 'npCharge', value: 30 }, { type: 'atkUp', value: 25, turns: 3 },
                  { type: 'ignoreDamageCut', turns: 3 }] },
      { id: 'conquest_tactics', name: 'Conquest Tactics A', cost: 4,
        desc: 'NP damage +25% and NP gain +30% for 3 turns',
        effects: [{ type: 'npUp', value: 25, turns: 3 }, { type: 'npGainUp', value: 30, turns: 3 }] },
      { id: 'lightning_conqueror', name: 'Lightning Conqueror EX', cost: 5,
        desc: 'Buster +30% for 3 turns and AP +1 now',
        effects: [{ type: 'cardUp', card: 'buster', value: 30, turns: 3 }, { type: 'apGain', value: 1 }] },
    ],
    np: { name: 'Ionioi Hetairoi', card: 'buster', mult: 3.4,
          desc: 'Heavy Buster damage, then the enemy takes 20% more damage for 2 turns',
          postEffects: [{ type: 'defDown', value: 20, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  hundred_faces: {
    id: 'hundred_faces', name: 'Hassan of the Hundred Faces', class: 'Assassin',
    fgoHp: 9310, fgoAtk: 6686, fgoNpAtk: 0.48, fgoNpDef: 4,
    favoredCard: 'arts', maxAp: 10,
    passives: [
      classPassive('presenceConcealment', 'A'),
      unique('One Hundred Personas', 'Regular attacks against him have a 10% chance to miss (Sure Hit ignores this)',
        [{ type: 'missChance', value: 10 }]),
    ],
    skills: [
      { id: 'library', name: 'Library of Stored Information B', cost: 6,
        desc: 'NP +30% now; NP gain +30% and buff success +20% for 3 turns',
        effects: [{ type: 'npCharge', value: 30 }, { type: 'npGainUp', value: 30, turns: 3 },
                  { type: 'buffSuccessUp', value: 20, turns: 3 }] },
      { id: 'expert', name: 'Expert of Many Specializations A+', cost: 4,
        desc: 'Evade for 2 turns; Quick, Arts and Buster +25% for 3 turns, each with an 80% chance',
        effects: [{ type: 'evade', turns: 2 },
                  { type: 'cardUp', card: 'quick', value: 25, turns: 3, chance: 80 },
                  { type: 'cardUp', card: 'arts', value: 25, turns: 3, chance: 80 },
                  { type: 'cardUp', card: 'buster', value: 25, turns: 3, chance: 80 }] },
      { id: 'battle_retreat', name: 'Battle Retreat B', cost: 3,
        desc: 'Heal 30% HP, but remove all of his own buffs (passives stay)',
        effects: [{ type: 'removeBuffs' }, { type: 'heal', value: 30 }] },
    ],
    np: { name: 'Zabaniya (Delusional Illusion)', card: 'arts', mult: 3.5,
          desc: 'Heavy Arts damage, then the enemy takes 20% more damage from Arts for 2 turns',
          postEffects: [{ type: 'cardVuln', card: 'arts', value: 20, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  lancelot: {
    id: 'lancelot', name: 'Lancelot', class: 'Berserker',
    fgoHp: 10327, fgoAtk: 10477, fgoNpAtk: 0.5, fgoNpDef: 5,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'E'),
      classPassive('madness', 'C'),
      unique('Eternal Arms Mastery', 'When the enemy raises its own ATK, he gains half as much for the same duration',
        [{ type: 'mirrorAtkUp', value: 50 }]),
    ],
    skills: [
      { id: 'arondight', name: 'Arondight A++', cost: 3,
        desc: '+2 AP from each attack for 3 turns',
        effects: [{ type: 'apRecoveryUp', value: 2, turns: 3 }] },
      { id: 'protection_of_spirits', name: 'Protection of the Spirits A', cost: 4,
        desc: 'NP +30% and AP +3 now',
        effects: [{ type: 'npCharge', value: 30 }, { type: 'apGain', value: 3 }] },
      { id: 'mana_reversal', name: 'Mana Reversal A', cost: 4,
        desc: 'NP gain +30% and Quick +40% (attacks and NP) for 3 turns',
        effects: [{ type: 'npGainUp', value: 30, turns: 3 }, { type: 'cardUp', card: 'quick', value: 40, turns: 3 }] },
    ],
    np: { name: 'Knight of Owner', card: 'quick', mult: 4.1,
          desc: 'Heavy Quick damage, then ATK +30% for 3 turns',
          postEffects: [{ type: 'atkUp', value: 30, turns: 4 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  gilles: {
    id: 'gilles', name: 'Gilles de Rais', class: 'Caster',
    fgoHp: 9506, fgoAtk: 6514, fgoNpAtk: 1.58, fgoNpDef: 3,
    favoredCard: 'arts', maxAp: 10,
    passives: [
      classPassive('territoryCreation', 'B'),
      unique('Summoning: Sea Demons', 'A landed Arts attack has a 40% chance to bring a Sea Demon follow-up hit for 30% of its damage',
        [{ type: 'extraHitChance', card: 'arts', value: 40, ratio: 30 }]),
    ],
    skills: [
      { id: 'mental_pollution', name: 'Mental Pollution A', cost: 4,
        desc: 'Debuff effectiveness +30% and debuff resist +30% for 3 turns',
        effects: [{ type: 'debuffUp', value: 30, turns: 3 }, { type: 'debuffResist', value: 30, turns: 3 }] },
      { id: 'blasphemy', name: 'Blasphemy Aesthetic C+++', cost: 5,
        desc: 'Drain 15% enemy NP; enemy takes +15% Arts and +15% Buster damage for 3 turns',
        effects: [{ type: 'npDrain', value: 15, target: 'enemy' },
                  { type: 'cardVuln', card: 'arts', value: 15, turns: 3, target: 'enemy' },
                  { type: 'cardVuln', card: 'buster', value: 15, turns: 3, target: 'enemy' }] },
      { id: 'evil_eye', name: 'Evil Eye of the Abyss B+++', cost: 6,
        desc: 'Terror (40%) and Curse (30/turn) on the enemy and DEF -15% for 3 turns; his next attack on a Cursed enemy +30%',
        effects: [{ type: 'terror', value: 40, turns: 3, status: 'terrified', target: 'enemy' },
                  { type: 'curse', value: 30, turns: 3, status: 'cursed', target: 'enemy' },
                  { type: 'defDown', value: 15, turns: 3, target: 'enemy' },
                  { type: 'bonusVsStatus', status: 'cursed', value: 30, turns: 3 }] },
    ],
    np: { name: "Prelati's Spellbook", card: 'buster', mult: 3.8,
          desc: 'Heavy Buster damage, then enemy ATK -20% for 3 turns',
          postEffects: [{ type: 'atkDown', value: 20, turns: 4, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  diarmuid: {
    id: 'diarmuid', name: 'Diarmuid Ua Duibhne', class: 'Lancer',
    fgoHp: 10098, fgoAtk: 6877, fgoNpAtk: 0.79, fgoNpDef: 4,
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'B'),
      unique("Knight's Oath", 'Quick and Arts +10% (attacks and NP)',
        [{ type: 'cardUp', card: 'quick', value: 10 }, { type: 'cardUp', card: 'arts', value: 10 }]),
    ],
    skills: [
      { id: 'eye_of_mind', name: 'Eye of the Mind (True) B', cost: 4,
        desc: 'Evade and damage cut 20% for 2 turns',
        effects: [{ type: 'evade', turns: 2 }, { type: 'damageCut', value: 20, turns: 2 }] },
      { id: 'love_spot', name: 'Love Spot C', cost: 4,
        desc: 'Enemy ATK -20% for 3 turns; NP +15%',
        effects: [{ type: 'atkDown', value: 20, turns: 3, target: 'enemy' }, { type: 'npCharge', value: 15 }] },
      { id: 'blighted_love', name: 'Blighted Love Flowing in Profusion A', cost: 5,
        desc: 'Quick +25%, Arts +25% and NP gain +25% for 3 turns; AP +2',
        effects: [{ type: 'cardUp', card: 'quick', value: 25, turns: 3 }, { type: 'cardUp', card: 'arts', value: 25, turns: 3 },
                  { type: 'npGainUp', value: 25, turns: 3 }, { type: 'apGain', value: 2 }] },
    ],
    np: { name: 'Gáe Dearg & Gáe Buidhe', card: 'quick', mult: 3.1,
          desc: 'Heavy Quick damage, then Curse the enemy (30 damage per turn for 3 turns)',
          postEffects: [{ type: 'curse', value: 30, turns: 3, status: 'cursed', target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  mordred: {
    id: 'mordred', name: 'Mordred', class: 'Saber',
    fgoHp: 14680, fgoAtk: 11723, fgoNpAtk: 0.56, fgoNpDef: 3,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'B'),
      classPassive('riding', 'B'),
      unique('Clarent', 'Starts the battle with 50% NP', [{ type: 'npCharge', value: 50 }]),
    ],
    skills: [
      { id: 'crimson_thunder', name: 'Knight of Crimson Thunder A+', cost: 5,
        desc: 'Buster +30% and ATK +15% for 3 turns',
        effects: [{ type: 'cardUp', card: 'buster', value: 30, turns: 3 }, { type: 'atkUp', value: 15, turns: 3 }] },
      { id: 'cigarette_lion', name: 'Cigarette Lion B+', cost: 3,
        desc: 'Max AP +2 for 3 turns, AP +2 now, and +1 AP at the end of each turn for 3 turns',
        effects: [{ type: 'maxApUp', value: 2, turns: 3 }, { type: 'apGain', value: 2 }, { type: 'apRegen', value: 1, turns: 3 }] },
      { id: 'secret_of_pedigree', name: 'Secret of Pedigree EX', cost: 5,
        desc: 'Remove her debuffs; damage cut 20% for 2 turns; NP +20%',
        effects: [{ type: 'cleanse' }, { type: 'damageCut', value: 20, turns: 2 }, { type: 'npCharge', value: 20 }] },
    ],
    np: { name: 'Clarent Blood Arthur', card: 'buster', mult: 3.6,
          desc: 'Heavy Buster damage, then NP +20%',
          postEffects: [{ type: 'npCharge', value: 20 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  siegfried: {
    id: 'siegfried', name: 'Siegfried', class: 'Saber',
    fgoHp: 14165, fgoAtk: 8181, fgoNpAtk: 0.83, fgoNpDef: 3,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('riding', 'B'),
      unique("Fafnir's Blood", 'A landed regular attack has a 35% chance to mark the enemy as Dragon for the next turn',
        [{ type: 'statusOnHit', status: 'dragon', value: 35, markTurns: 2 }]),
    ],
    skills: [
      { id: 'avaricious_gold', name: 'Avaricious Gold A', cost: 5,
        desc: 'NP +20% now; NP gain +30% and ATK +15% for 3 turns',
        effects: [{ type: 'npCharge', value: 20 }, { type: 'npGainUp', value: 30, turns: 3 }, { type: 'atkUp', value: 15, turns: 3 }] },
      { id: 'disengage', name: 'Disengage A', cost: 4,
        desc: 'Remove his debuffs and heal 20% HP',
        effects: [{ type: 'cleanse' }, { type: 'heal', value: 20 }] },
      { id: 'dragon_slayer', name: 'Dragon Slayer A++', cost: 5,
        desc: '+30% damage vs Dragon and Buster +20% for 3 turns; damage cut 20% for 2 turns',
        effects: [{ type: 'dmgVsStatus', status: 'dragon', value: 30, turns: 3 }, { type: 'cardUp', card: 'buster', value: 20, turns: 3 },
                  { type: 'damageCut', value: 20, turns: 2 }] },
    ],
    np: { name: 'Balmung', card: 'buster', mult: 3.5, vsStatus: { status: 'dragon', value: 40 },
          desc: 'Heavy Buster damage; +40% damage to a Dragon' },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  atalanta: {
    id: 'atalanta', name: 'Atalanta', class: 'Archer',
    fgoHp: 12476, fgoAtk: 8633, fgoNpAtk: 0.5, fgoNpDef: 3,
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'D'),
      classPassive('independentAction', 'A'),
      unique('Golden Apple', 'Quick attacks have a 35% chance to loose a second arrow: +50% damage if the attack landed, or a full-damage hit if it was beaten (Evade and Invincible still stop it)',
        [{ type: 'doubleShot', card: 'quick', value: 35, ratio: 50 }]),
    ],
    skills: [
      { id: 'crossing_arcadia', name: 'Crossing Arcadia', cost: 3,
        desc: 'Quick +40% for 3 turns',
        effects: [{ type: 'cardUp', card: 'quick', value: 40, turns: 3 }] },
      { id: 'art_of_the_hunt', name: 'Art of the Hunt C', cost: 3,
        desc: 'AP +2 now; Sure Hit for 3 turns',
        effects: [{ type: 'apGain', value: 2 }, { type: 'sureHit', turns: 3 }] },
      { id: 'calydonian_hunt', name: 'Calydonian Hunt EX', cost: 6,
        desc: 'Evade for 2 turns; NP +30% now; NP gain +30% and ATK +15% for 3 turns',
        effects: [{ type: 'evade', turns: 2 }, { type: 'npCharge', value: 30 },
                  { type: 'npGainUp', value: 30, turns: 3 }, { type: 'atkUp', value: 15, turns: 3 }] },
    ],
    np: { name: 'Phoebus Catastrophe', card: 'quick', mult: 4.3,
          desc: 'Heavy Quick damage, then AP +3',
          postEffects: [{ type: 'apGain', value: 3 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  chiron: {
    id: 'chiron', name: 'Chiron', class: 'Archer',
    fgoHp: 12250, fgoAtk: 9294, fgoNpAtk: 0.68, fgoNpDef: 3,
    favoredCard: 'arts', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'B'),
      classPassive('independentAction', 'A'),
      classPassive('divinity', 'C'),
      unique("Teacher's Wisdom", "3 times per battle, see the opponent's locked-in action before choosing his own",
        [{ type: 'foresight', charges: 3 }]),
    ],
    skills: [
      { id: 'eye_of_mind_chiron', name: 'Eye of the Mind (True) A', cost: 4,
        desc: 'Evade and damage cut 20% for 2 turns',
        effects: [{ type: 'evade', turns: 2 }, { type: 'damageCut', value: 20, turns: 2 }] },
      { id: 'eternal_consecration', name: 'Eternal Consecration EX', cost: 3,
        desc: 'AP +6 now; lose 5% HP (cannot KO him)',
        effects: [{ type: 'apGain', value: 6 }, { type: 'hpCost', value: 5 }] },
      { id: 'wisdom_of_divine', name: 'Wisdom of Divine A+', cost: 6,
        desc: 'Quick, Arts and Buster +25%, ATK +15% and Sure Hit for 3 turns',
        effects: [{ type: 'cardUp', card: 'quick', value: 25, turns: 3 }, { type: 'cardUp', card: 'arts', value: 25, turns: 3 },
                  { type: 'cardUp', card: 'buster', value: 25, turns: 3 }, { type: 'atkUp', value: 15, turns: 3 },
                  { type: 'sureHit', turns: 3 }] },
    ],
    np: { name: 'Antares Snipe', card: 'arts', mult: 3.5,
          desc: "Strip the enemy's Evade, Invincible and damage cut, then heavy Arts damage",
          preEffects: [{ type: 'removeDefBuffs', target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  vlad: {
    id: 'vlad', name: 'Vlad III', class: 'Lancer',
    fgoHp: 15086, fgoAtk: 11499, fgoNpAtk: 0.5, fgoNpDef: 5,
    favoredCard: 'arts', maxAp: 10, hpMult: 0.75, // 25% below FGO-derived HP: Protection of Faith is an extra life
    passives: [
      classPassive('madness', 'EX'),
      unique('Protection of Faith', 'Revives once with 15% HP; on revival, NP gain +30% for the rest of the battle (a normal buff, so it can be removed)',
        [{ type: 'guts', value: 15, charges: 1, onRevive: [{ type: 'npGainUp', value: 30, turns: 99 }] }]),
    ],
    skills: [
      { id: 'bloodsucker', name: 'Bloodsucker A', cost: 5,
        desc: "Drain 20% of the enemy's NP and gain what was drained",
        effects: [{ type: 'npSteal', value: 20, target: 'enemy' }] },
      { id: 'legend_of_dracula', name: 'Legend of Dracula A+', cost: 4,
        desc: 'ATK +20% for 3 turns; damage cut 20% for 2 turns',
        effects: [{ type: 'atkUp', value: 20, turns: 3 }, { type: 'damageCut', value: 20, turns: 2 }] },
      { id: 'fearsome_immortal', name: 'Fearsome Immortal A+', cost: 4,
        desc: 'Arts +30% and NP gain +30% for 3 turns',
        effects: [{ type: 'cardUp', card: 'arts', value: 30, turns: 3 }, { type: 'npGainUp', value: 30, turns: 3 }] },
    ],
    np: { name: 'Kazikli Bey', card: 'arts', mult: 3.4,
          desc: 'Heavy Arts damage, then the enemy takes +20% Arts damage for 2 turns',
          postEffects: [{ type: 'cardVuln', card: 'arts', value: 20, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  karna: {
    id: 'karna', name: 'Karna', class: 'Lancer',
    fgoHp: 13632, fgoAtk: 11976, fgoNpAtk: 0.72, fgoNpDef: 4,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'C'),
      classPassive('riding', 'A'),
      classPassive('divinity', 'A'),
      unique('Son of the Sun God', 'Buster +10% and NP damage +10%',
        [{ type: 'cardUp', card: 'buster', value: 10 }, { type: 'npUp', value: 10 }]),
    ],
    skills: [
      { id: 'knowledge_of_deprived', name: 'Knowledge of the Deprived A', cost: 5,
        desc: "Enemy debuff resist -20% for 3 turns; NP Seal this turn: if the enemy uses its NP now, it fizzles and the gauge drops 20%",
        effects: [{ type: 'debuffResistDown', value: 20, turns: 3, target: 'enemy' }, { type: 'npSeal', value: 20, turns: 1, target: 'enemy' }] },
      { id: 'flash_of_sun_god', name: 'Flash of the Sun God EX', cost: 5,
        desc: 'Quick +20%, Buster +20% and NP damage +20% for 3 turns',
        effects: [{ type: 'cardUp', card: 'quick', value: 20, turns: 3 }, { type: 'cardUp', card: 'buster', value: 20, turns: 3 },
                  { type: 'npUp', value: 20, turns: 3 }] },
      { id: 'almsgivers_end', name: "Almsgiver's End", cost: 4,
        desc: 'NP +30% now; NP gain +30% for 3 turns',
        effects: [{ type: 'npCharge', value: 30 }, { type: 'npGainUp', value: 30, turns: 3 }] },
    ],
    np: { name: 'Vasavi Shakti', card: 'buster', mult: 3.2,
          desc: 'Heavy Buster damage, then the enemy takes +20% Buster damage for 2 turns',
          postEffects: [{ type: 'cardVuln', card: 'buster', value: 20, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  achilles: {
    id: 'achilles', name: 'Achilles', class: 'Rider',
    fgoHp: 13219, fgoAtk: 11883, fgoNpAtk: 0.57, fgoNpDef: 3,
    favoredCard: 'quick', maxAp: 10, hpMult: 0.73, // 27% below FGO-derived HP: only an NP (or Sure Hit first) can down him
    passives: [
      classPassive('magicResistance', 'C'),
      classPassive('riding', 'A+'),
      classPassive('divinity', 'C'),
      unique('Akhilleus Kosmos', 'Can only be downed by a Noble Phantasm (anything else leaves him at 1 HP). A landed Sure Hit attack strikes his heel and removes this',
        [{ type: 'npOnlyKo' }]),
    ],
    skills: [
      { id: 'comet_form', name: 'Drómos Komḗtēs A+', cost: 5,
        desc: 'Quick +30% and Sure Hit for 3 turns',
        effects: [{ type: 'cardUp', card: 'quick', value: 30, turns: 3 }, { type: 'sureHit', turns: 3 }] },
      { id: 'amaranth', name: 'Andreíos Amárantos B', cost: 5,
        desc: 'Invincible this turn; damage cut 20% for 2 turns',
        effects: [{ type: 'invincible' }, { type: 'damageCut', value: 20, turns: 2 }] },
      { id: 'star_spear', name: 'Diatrekhōn Astēr Lonkhē B+', cost: 5,
        desc: 'NP +20% now; NP gain +30% for 3 turns; Taunt: next turn the enemy can only attack (no skills or NP)',
        effects: [{ type: 'npCharge', value: 20 }, { type: 'npGainUp', value: 30, turns: 3 },
                  { type: 'taunt', value: 1, turns: 2, target: 'enemy' }] },
    ],
    np: { name: 'Troias Tragōidia', card: 'quick', mult: 3.4,
          desc: 'Quick +30% for this NP, heavy Quick damage, then Confusion on the enemy (40% chance a skill fizzles) for 3 turns',
          preEffects: [{ type: 'cardUp', card: 'quick', value: 30, turns: 1 }],
          postEffects: [{ type: 'confusion', value: 40, turns: 4, status: 'confused', target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  astolfo: {
    id: 'astolfo', name: 'Astolfo', class: 'Rider',
    fgoHp: 11172, fgoAtk: 8937, fgoNpAtk: 0.66, fgoNpDef: 1,
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'A'),
      classPassive('riding', 'A+'),
      classPassive('independentAction', 'B'),
      unique('La Black Luna', 'A landed regular attack has a 10% chance to strike the enemy with Terror (40%) for 3 turns',
        [{ type: 'debuffOnHit', value: 10, inflict: { type: 'terror', value: 40, turns: 3, status: 'terrified' } }]),
    ],
    skills: [
      { id: 'monstrous_strength', name: 'Monstrous Strength C-', cost: 3,
        desc: 'ATK +30% for 3 turns',
        effects: [{ type: 'atkUp', value: 30, turns: 3 }] },
      { id: 'trap_of_argalia', name: 'Trap of Argalia D', cost: 5,
        desc: '50% chance the enemy loses its next turn (rolled when that turn resolves)',
        effects: [{ type: 'stun', value: 50, turns: 2, target: 'enemy' }] },
      { id: 'evaporation', name: 'Evaporation of Sanity D+', cost: 4,
        desc: 'NP +20% now; NP gain +30% for 3 turns; each turn, a 50% chance of +2 AP',
        effects: [{ type: 'npCharge', value: 20 }, { type: 'npGainUp', value: 30, turns: 3 },
                  { type: 'apChance', value: 50, amount: 2, turns: 3 }] },
    ],
    np: { name: 'Hippogriff', card: 'quick', mult: 4.2, ignoreCut: true,
          desc: 'Heavy Quick damage that ignores damage cut, then Evade for 2 turns',
          postEffects: [{ type: 'evade', turns: 3 }] },
  },
};

export const ROSTER = Object.values(SERVANTS);
