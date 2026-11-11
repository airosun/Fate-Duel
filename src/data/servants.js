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
    id: 'artoria', name: 'Artoria Pendragon', class: 'Saber', pronouns: 'she/her',
    fgoHp: 15150, fgoAtk: 11221, fgoNpAtk: 0.86, fgoNpDef: 3,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'A'),
      classPassive('riding', 'B'),
      unique('Invisible Air', "Damage Cut 5% (permanent)", [{ type: 'damageCut', value: 5 }]),
    ],
    skills: [
      { id: 'knight_of_utopia', name: 'Knight of Utopia EX', cost: 4,
        desc: "ATK +20% and Buster NP gain +100% (3 turns)",
        effects: [{ type: 'atkUp', value: 20, turns: 3 },
                  { type: 'cardNpGainUp', card: 'buster', value: 100, turns: 3 }] },
      { id: 'dragon_reactor', name: 'Dragon Reactor Core B', cost: 5,
        desc: "Buster +25% and NP damage +15% (3 turns); her next attack hits as Buster (it still clashes as the card she picked)",
        effects: [{ type: 'cardUp', card: 'buster', value: 25, turns: 3 },
                  { type: 'npUp', value: 15, turns: 3 },
                  { type: 'busterConvert', turns: 3 }] },
      { id: 'radiant_road', name: 'Radiant Road EX', cost: 3,
        desc: "NP +25%; Damage Cut 15% (2 turns)",
        effects: [{ type: 'npCharge', value: 25 }, { type: 'damageCut', value: 15, turns: 2 }] },
    ],
    np: { name: 'Excalibur', card: 'buster', mult: 3.5,
          desc: "Heavy Buster damage; NP +15%",
          postEffects: [{ type: 'npCharge', value: 15 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  heracles: {
    id: 'heracles', name: 'Heracles', class: 'Berserker', pronouns: 'he/him',
    fgoHp: 10327, fgoAtk: 10655, fgoNpAtk: 1.07, fgoNpDef: 5,
    hpMult: 0.73, // 27% below FGO-derived HP: his HP is split across two lives
    favoredCard: 'buster', maxAp: 8,
    passives: [
      classPassive('madness', 'B'),
      classPassive('divinity', 'A'),
      unique('12 Labors', "Guts once: revives at 25% HP, but his NP gauge and AP reset to 0",
        [{ type: 'guts', value: 25, charges: 1, resetNp: true, resetAp: true }]),
    ],
    skills: [
      { id: 'bravery', name: 'Bravery A+', cost: 4,
        desc: "ATK +20% and Debuff Resist +30% (3 turns)",
        effects: [{ type: 'atkUp', value: 20, turns: 3 },
                  { type: 'debuffResist', value: 30, turns: 3 }] },
      { id: 'eye_of_mind', name: 'Eye of the Mind (False) B', cost: 4,
        desc: "Applies Evade (2 turns)",
        effects: [{ type: 'evade', turns: 2 }] },
      { id: 'indomitable', name: 'Indomitable A', cost: 5,
        desc: "Buster +20% (3 turns); +40% instead once 12 Labors has revived him",
        effects: [{ type: 'cardUp', card: 'buster', value: 20, turns: 3 },
                  { type: 'cardUp', card: 'buster', value: 20, turns: 3, condition: 'afterRevive' }] },
    ],
    np: { name: 'Nine Lives', card: 'buster', mult: 3.6,
          desc: "Heavy Buster damage; Enemy DEF −20% (2 turns)",
          postEffects: [{ type: 'defDown', value: 20, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  medea: {
    id: 'medea', name: 'Medea', class: 'Caster', pronouns: 'she/her',
    fgoHp: 8643, fgoAtk: 7418, fgoNpAtk: 1.64, fgoNpDef: 3,
    favoredCard: 'arts', maxAp: 12,
    passives: [
      classPassive('territoryCreation', 'A'),
      unique("Hecate's Staff", "Her debuffs ignore up to 25% of the enemy's Debuff Resist",
        [{ type: 'debuffPotency', value: 25 }]),
    ],
    skills: [
      { id: 'high_speed', name: 'High-Speed Divine Words A', cost: 4,
        desc: "NP +50%",
        effects: [{ type: 'npCharge', value: 50 }] },
      { id: 'argon_coin', name: 'Argon Coin: The Golden Fleece', cost: 3,
        desc: "Heal 20% HP; AP +2",
        effects: [{ type: 'heal', value: 20 }, { type: 'apGain', value: 2 }] },
      { id: 'witch_of_colchis', name: 'Witch of Colchis A', cost: 6,
        desc: "Cleanses her debuffs; Arts +25%, NP damage +20% and NP gain +30% (3 turns)",
        effects: [{ type: 'cleanse' },
                  { type: 'cardUp', card: 'arts', value: 25, turns: 3 },
                  { type: 'npUp', value: 20, turns: 3 },
                  { type: 'npGainUp', value: 30, turns: 3 }] },
    ],
    // Utility NP: hampers the enemy rather than nuking them
    np: { name: 'Rule Breaker', card: 'arts', mult: 2.6,
          desc: "Removes the enemy's buffs (passives stay); Light Arts damage; Enemy ATK −20% (3 turns)",
          preEffects: [{ type: 'removeBuffs', target: 'enemy' }],
          postEffects: [{ type: 'atkDown', value: 20, turns: 4, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  kojirou: {
    id: 'kojirou', name: 'Sasaki Kojirou', class: 'Assassin', pronouns: 'he/him',
    fgoHp: 6220, fgoAtk: 5735, fgoNpAtk: 1.05, fgoNpDef: 4,
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('presenceConcealment', 'D'),
      unique('Heaven Among the Mountains', "His Quick attacks Pierce Evade",
        [{ type: 'pierceEvade', card: 'quick' }]),
    ],
    skills: [
      { id: 'minds_eye', name: 'Eye of the Mind (False) A', cost: 4,
        desc: "Applies Evade and Damage Cut 10% (2 turns)",
        effects: [{ type: 'evade', turns: 2 }, { type: 'damageCut', value: 10, turns: 2 }] },
      { id: 'fade_out', name: 'Fade Out A+', cost: 4,
        desc: "Cleanses his debuffs; Quick +40% (3 turns)",
        effects: [{ type: 'cleanse' }, { type: 'cardUp', card: 'quick', value: 40, turns: 3 }] },
      { id: 'souwa', name: 'Knowledge of the Souwa B++', cost: 5,
        desc: "Applies Sure Hit (3 turns)",
        effects: [{ type: 'sureHit', turns: 3 }] },
    ],
    np: { name: 'Tsubame Gaeshi', card: 'quick', mult: 3.8,
          desc: "Quick +20% (3 turns, boosts this NP too); Heavy Quick damage",
          preEffects: [{ type: 'cardUp', card: 'quick', value: 20, turns: 3 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  emiya: {
    id: 'emiya', name: 'EMIYA', class: 'Archer', pronouns: 'he/him',
    fgoHp: 11521, fgoAtk: 9398, fgoNpAtk: 0.51, fgoNpDef: 3,
    favoredCard: 'arts', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'D'),
      classPassive('independentAction', 'B'),
      unique('Reality Marble', "Gets the favored-card bonus on Quick, Arts and Buster", [{ type: 'affinityAll' }]),
      unique('Trace On', "Copies the opponent's unique passive for the battle (revives can't be copied)", [{ type: 'copyEnemyUnique' }]),
    ],
    skills: [
      { id: 'eye_of_mind_true', name: 'Eye of the Mind (True) EX', cost: 5,
        desc: "Applies Evade and Damage Cut 10% (2 turns); ATK +20% (3 turns)",
        effects: [{ type: 'evade', turns: 2 }, { type: 'damageCut', value: 10, turns: 2 },
                  { type: 'atkUp', value: 20, turns: 3 }] },
      { id: 'hawkeye', name: 'Hawkeye B+', cost: 3,
        desc: "NP +20%; NP gain +50% (3 turns)",
        effects: [{ type: 'npCharge', value: 20 }, { type: 'npGainUp', value: 50, turns: 3 }] },
      { id: 'circuit_connect', name: 'Circuit Connect EX', cost: 6,
        desc: "His next landed attack is 50% more effective; sets Unlimited Blade Works to the chosen mode",
        options: [
          { id: 'buster', label: 'Buster Mode', card: 'buster' },
          { id: 'arts', label: 'Arts Mode', card: 'arts' },
          { id: 'quick', label: 'Quick Mode', card: 'quick' },
        ],
        effects: [{ type: 'nextHitUp', value: 50, turns: 3 }, { type: 'setNpMode' }] },
    ],
    np: { name: 'Unlimited Blade Works', defaultMode: 'buster',
          modes: {
            buster: { label: 'Buster Mode', card: 'buster', mult: 4.1, desc: "Heavy Buster damage" },
            arts: { label: 'Arts Mode', card: 'arts', mult: 3.2, desc: "Medium Arts damage; NP +20%",
                    postEffects: [{ type: 'npCharge', value: 20 }] },
            quick: { label: 'Quick Mode', card: 'quick', mult: 2.6, desc: "Light Quick damage; Enemy ATK −20% (3 turns)",
                     postEffects: [{ type: 'atkDown', value: 20, turns: 4, target: 'enemy' }] },
          } },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  cu: {
    id: 'cu', name: 'Cú Chulainn', class: 'Lancer', pronouns: 'he/him',
    fgoHp: 9593, fgoAtk: 7239, fgoNpAtk: 1.07, fgoNpDef: 4,
    hpMult: 0.83, // 17% below FGO-derived HP: Battle Continuation is an extra life
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'C'),
      classPassive('divinity', 'B'),
      unique('Battle Continuation', "Guts once: revives at 1 HP (keeps his AP and NP gauge)",
        [{ type: 'guts', value: 0, charges: 1 }]),
    ],
    skills: [
      { id: 'ath_ngabla', name: 'Ath nGabla A', cost: 4,
        desc: "ATK +20% to +50% (3 turns): +20%, plus up to +30% more the lower his HP is when used",
        effects: [{ type: 'atkUp', value: 20, scaleMissingHp: 30, turns: 3 }] },
      { id: 'protection_from_arrows', name: 'Protection from Arrows B', cost: 4,
        desc: "Applies Evade and Damage Cut 10% (2 turns)",
        effects: [{ type: 'evade', turns: 2 }, { type: 'damageCut', value: 10, turns: 2 }] },
      { id: 'disengage', name: 'Disengage C', cost: 4,
        desc: "Cleanses his debuffs; Heal 15% HP",
        effects: [{ type: 'cleanse' }, { type: 'heal', value: 15 }] },
    ],
    np: { name: 'Gáe Bolg', card: 'quick', mult: 3.4,
          desc: "Applies Sure Hit (2 turns); Heavy Quick damage; Enemy DEF −20% (2 turns)",
          preEffects: [{ type: 'sureHit', turns: 3 }],
          postEffects: [{ type: 'defDown', value: 20, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  medusa: {
    id: 'medusa', name: 'Medusa', class: 'Rider', pronouns: 'she/her',
    fgoHp: 8937, fgoAtk: 7200, fgoNpAtk: 0.58, fgoNpDef: 3,
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'B'),
      classPassive('independentAction', 'C'),
      classPassive('riding', 'A+'),
      classPassive('divinity', 'E-'),
      unique('Breaker Gorgon', "Each buff the enemy gives themself has a 10% chance to fail",
        [{ type: 'buffFailChance', value: 10 }]),
    ],
    skills: [
      { id: 'mystic_eyes', name: 'Mystic Eyes A+', cost: 4,
        desc: "Inflicts Petrify: Enemy AP −3, and −2 AP from each of their attacks (3 turns)",
        effects: [{ type: 'apDrain', value: 3, target: 'enemy' },
                  { type: 'apRecoveryDown', value: 2, status: 'petrified', turns: 4, target: 'enemy' }] },
      { id: 'monstrous_snake', name: 'Monstrous Snake Metamorphosis B', cost: 5,
        desc: "ATK +20% (3 turns); her next attack on a Petrified enemy deals +50% damage",
        effects: [{ type: 'atkUp', value: 20, turns: 3 },
                  { type: 'bonusVsStatus', status: 'petrified', value: 50, turns: 3 }] },
      { id: 'blood_fort', name: 'Blood Fort Andromeda B', cost: 4,
        desc: "NP +35%; NP gain +50% (3 turns)",
        effects: [{ type: 'npCharge', value: 35 }, { type: 'npGainUp', value: 50, turns: 3 }] },
    ],
    np: { name: 'Bellerophon', card: 'quick', mult: 4.4,
          desc: "Heavy Quick damage; Enemy gets −1 AP from each attack (2 turns)",
          postEffects: [{ type: 'apRecoveryDown', value: 1, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  hassan: {
    id: 'hassan', name: 'Hassan of the Cursed Arm', class: 'Assassin', pronouns: 'he/him',
    fgoHp: 7594, fgoAtk: 6280, fgoNpAtk: 1.07, fgoNpDef: 4,
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('presenceConcealment', 'A+'),
      unique("Shaytan's Arm", "Zabaniya has a 5% chance of Instant Kill (revives don't trigger)",
        [{ type: 'instantKillChance', value: 5, npName: 'Zabaniya' }]),
    ],
    skills: [
      { id: 'throwing', name: 'Throwing/Retrieval A', cost: 3,
        desc: "AP +2; AP +2 at the end of this turn and the next",
        effects: [{ type: 'apGain', value: 2 }, { type: 'apRegen', value: 2, turns: 2 }] },
      { id: 'self_modification', name: 'Self-Modification C', cost: 3,
        desc: "Quick +45% (3 turns)",
        effects: [{ type: 'cardUp', card: 'quick', value: 45, turns: 3 }] },
      { id: 'protection_from_wind', name: 'Protection from Wind A', cost: 4,
        desc: "Applies Evade (2 turns); NP gain +30% (3 turns)",
        effects: [{ type: 'evade', turns: 2 }, { type: 'npGainUp', value: 30, turns: 3 }] },
    ],
    np: { name: 'Zabaniya', card: 'quick', mult: 4.1,
          desc: "Heavy Quick damage; ATK +20% (3 turns)",
          postEffects: [{ type: 'atkUp', value: 20, turns: 4 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  gilgamesh: {
    id: 'gilgamesh', name: 'Gilgamesh', class: 'Archer', pronouns: 'he/him',
    fgoHp: 13097, fgoAtk: 12280, fgoNpAtk: 0.34, fgoNpDef: 3,
    hpMult: 1.06, // lore: the King of Heroes should edge out every matchup (Artoria closest)
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('independentAction', 'A+'),
      classPassive('magicResistance', 'E'),
      classPassive('divinity', 'B'),
      unique('Ea', "Neutralizes the opponent's unique passives for the whole battle",
        [{ type: 'neutralizeEnemyUnique' }]),
    ],
    skills: [
      { id: 'saw_it_all', name: 'The One Who Saw It All EX', cost: 5,
        desc: "ATK +20% and NP damage +20% (3 turns)",
        effects: [{ type: 'atkUp', value: 20, turns: 3 }, { type: 'npUp', value: 20, turns: 3 }] },
      { id: 'golden_rule', name: 'Golden Rule A', cost: 3,
        desc: "NP gain +50% (3 turns); Damage Cut 10% (2 turns)",
        effects: [{ type: 'npGainUp', value: 50, turns: 3 }, { type: 'damageCut', value: 10, turns: 2 }] },
      { id: 'treasury', name: 'Treasury of Babylon EX', cost: 6,
        desc: "NP +30%; AP +3; Buster +25% (3 turns)",
        effects: [{ type: 'npCharge', value: 30 }, { type: 'apGain', value: 3 },
                  { type: 'cardUp', card: 'buster', value: 25, turns: 3 }] },
    ],
    np: { name: 'Enuma Elish', card: 'buster', mult: 3.0,
          desc: "NP damage +30% for this NP; Heavy Buster damage",
          preEffects: [{ type: 'npUp', value: 30, turns: 1 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  iskandar: {
    id: 'iskandar', name: 'Iskandar', class: 'Rider', pronouns: 'he/him',
    fgoHp: 13219, fgoAtk: 11560, fgoNpAtk: 0.86, fgoNpDef: 3,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'D'),
      classPassive('riding', 'A+'),
      classPassive('divinity', 'C'),
      unique('Bucephalus', "Quick +10% and Buster +10%",
        [{ type: 'cardUp', card: 'quick', value: 10 }, { type: 'cardUp', card: 'buster', value: 10 }]),
    ],
    skills: [
      { id: 'towards_beyond', name: 'Those Who Go Towards the Beyond A', cost: 6,
        desc: "NP +30%; ATK +25% and Ignores Damage Cut (3 turns)",
        effects: [{ type: 'npCharge', value: 30 }, { type: 'atkUp', value: 25, turns: 3 },
                  { type: 'ignoreDamageCut', turns: 3 }] },
      { id: 'conquest_tactics', name: 'Conquest Tactics A', cost: 4,
        desc: "NP damage +25% and NP gain +30% (3 turns)",
        effects: [{ type: 'npUp', value: 25, turns: 3 }, { type: 'npGainUp', value: 30, turns: 3 }] },
      { id: 'lightning_conqueror', name: 'Lightning Conqueror EX', cost: 5,
        desc: "Buster +30% (3 turns); AP +1",
        effects: [{ type: 'cardUp', card: 'buster', value: 30, turns: 3 }, { type: 'apGain', value: 1 }] },
    ],
    np: { name: 'Ionioi Hetairoi', card: 'buster', mult: 3.4,
          desc: "Heavy Buster damage; Enemy DEF −20% (2 turns)",
          postEffects: [{ type: 'defDown', value: 20, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  hundred_faces: {
    id: 'hundred_faces', name: 'Hassan of the Hundred Faces', class: 'Assassin', pronouns: 'they/them',
    fgoHp: 9310, fgoAtk: 6686, fgoNpAtk: 0.48, fgoNpDef: 4,
    favoredCard: 'arts', maxAp: 10,
    passives: [
      classPassive('presenceConcealment', 'A'),
      unique('One Hundred Personas', "Regular attacks against them have a 10% chance to miss (Sure Hit ignores this)",
        [{ type: 'missChance', value: 10 }]),
    ],
    skills: [
      { id: 'library', name: 'Library of Stored Information B', cost: 6,
        desc: "NP +30%; NP gain +30% and Buff success +20% (3 turns)",
        effects: [{ type: 'npCharge', value: 30 }, { type: 'npGainUp', value: 30, turns: 3 },
                  { type: 'buffSuccessUp', value: 20, turns: 3 }] },
      { id: 'expert', name: 'Expert of Many Specializations A+', cost: 4,
        desc: "Applies Evade (2 turns); Quick +25%, Arts +25% and Buster +25% (3 turns), each with an 80% chance",
        effects: [{ type: 'evade', turns: 2 },
                  { type: 'cardUp', card: 'quick', value: 25, turns: 3, chance: 80 },
                  { type: 'cardUp', card: 'arts', value: 25, turns: 3, chance: 80 },
                  { type: 'cardUp', card: 'buster', value: 25, turns: 3, chance: 80 }] },
      { id: 'battle_retreat', name: 'Battle Retreat B', cost: 3,
        desc: "Heal 30% HP; removes all of their own buffs (passives stay)",
        effects: [{ type: 'removeBuffs' }, { type: 'heal', value: 30 }] },
    ],
    np: { name: 'Zabaniya (Delusional Illusion)', card: 'arts', mult: 3.5,
          desc: "Heavy Arts damage; Enemy Arts resist −20% (2 turns)",
          postEffects: [{ type: 'cardVuln', card: 'arts', value: 20, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  lancelot: {
    id: 'lancelot', name: 'Lancelot', class: 'Berserker', pronouns: 'he/him',
    fgoHp: 10327, fgoAtk: 10477, fgoNpAtk: 0.5, fgoNpDef: 5,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'E'),
      classPassive('madness', 'C'),
      unique('Eternal Arms Mastery', "When the enemy raises their own ATK, he gains half as much for the same duration",
        [{ type: 'mirrorAtkUp', value: 50 }]),
    ],
    skills: [
      { id: 'arondight', name: 'Arondight A++', cost: 3,
        desc: "+2 AP from each attack (3 turns)",
        effects: [{ type: 'apRecoveryUp', value: 2, turns: 3 }] },
      { id: 'protection_of_spirits', name: 'Protection of the Spirits A', cost: 4,
        desc: "NP +30%; AP +3",
        effects: [{ type: 'npCharge', value: 30 }, { type: 'apGain', value: 3 }] },
      { id: 'mana_reversal', name: 'Mana Reversal A', cost: 4,
        desc: "NP gain +30% and Quick +40% (3 turns)",
        effects: [{ type: 'npGainUp', value: 30, turns: 3 }, { type: 'cardUp', card: 'quick', value: 40, turns: 3 }] },
    ],
    np: { name: 'Knight of Owner', card: 'quick', mult: 4.1,
          desc: "Heavy Quick damage; ATK +30% (3 turns)",
          postEffects: [{ type: 'atkUp', value: 30, turns: 4 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  gilles: {
    id: 'gilles', name: 'Gilles de Rais', class: 'Caster', pronouns: 'he/him',
    fgoHp: 9506, fgoAtk: 6514, fgoNpAtk: 1.58, fgoNpDef: 3,
    favoredCard: 'arts', maxAp: 10,
    passives: [
      classPassive('territoryCreation', 'B'),
      unique('Summoning: Sea Demons', "A landed Arts attack has a 40% chance of a Sea Demon follow-up hit for 30% of its damage",
        [{ type: 'extraHitChance', card: 'arts', value: 40, ratio: 30 }]),
    ],
    skills: [
      { id: 'mental_pollution', name: 'Mental Pollution A', cost: 4,
        desc: "Debuff effectiveness +30% and Debuff Resist +30% (3 turns)",
        effects: [{ type: 'debuffUp', value: 30, turns: 3 }, { type: 'debuffResist', value: 30, turns: 3 }] },
      { id: 'blasphemy', name: 'Blasphemy Aesthetic C+++', cost: 5,
        desc: "Enemy NP −15%; Enemy Arts resist −15% and Buster resist −15% (3 turns)",
        effects: [{ type: 'npDrain', value: 15, target: 'enemy' },
                  { type: 'cardVuln', card: 'arts', value: 15, turns: 3, target: 'enemy' },
                  { type: 'cardVuln', card: 'buster', value: 15, turns: 3, target: 'enemy' }] },
      { id: 'evil_eye', name: 'Evil Eye of the Abyss B+++', cost: 6,
        desc: "Inflicts Terror (40%), Curse (30 per turn) and Enemy DEF −15% (3 turns); his next attack on a Cursed enemy deals +30% damage",
        effects: [{ type: 'terror', value: 40, turns: 3, status: 'terrified', target: 'enemy' },
                  { type: 'curse', value: 30, turns: 3, status: 'cursed', target: 'enemy' },
                  { type: 'defDown', value: 15, turns: 3, target: 'enemy' },
                  { type: 'bonusVsStatus', status: 'cursed', value: 30, turns: 3 }] },
    ],
    np: { name: "Prelati's Spellbook", card: 'buster', mult: 3.8,
          desc: "Heavy Buster damage; Enemy ATK −20% (3 turns)",
          postEffects: [{ type: 'atkDown', value: 20, turns: 4, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  diarmuid: {
    id: 'diarmuid', name: 'Diarmuid Ua Duibhne', class: 'Lancer', pronouns: 'he/him',
    fgoHp: 10098, fgoAtk: 6877, fgoNpAtk: 0.79, fgoNpDef: 4,
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'B'),
      unique("Knight's Oath", "Quick +10% and Arts +10%",
        [{ type: 'cardUp', card: 'quick', value: 10 }, { type: 'cardUp', card: 'arts', value: 10 }]),
    ],
    skills: [
      { id: 'eye_of_mind', name: 'Eye of the Mind (True) B', cost: 4,
        desc: "Applies Evade and Damage Cut 20% (2 turns)",
        effects: [{ type: 'evade', turns: 2 }, { type: 'damageCut', value: 20, turns: 2 }] },
      { id: 'love_spot', name: 'Love Spot C', cost: 4,
        desc: "Enemy ATK −20% (3 turns); NP +15%",
        effects: [{ type: 'atkDown', value: 20, turns: 3, target: 'enemy' }, { type: 'npCharge', value: 15 }] },
      { id: 'blighted_love', name: 'Blighted Love Flowing in Profusion A', cost: 5,
        desc: "Quick +25%, Arts +25% and NP gain +25% (3 turns); AP +2",
        effects: [{ type: 'cardUp', card: 'quick', value: 25, turns: 3 }, { type: 'cardUp', card: 'arts', value: 25, turns: 3 },
                  { type: 'npGainUp', value: 25, turns: 3 }, { type: 'apGain', value: 2 }] },
    ],
    np: { name: 'Gáe Dearg & Gáe Buidhe', card: 'quick', mult: 3.1,
          desc: "Heavy Quick damage; Inflicts Curse (30 per turn, 3 turns)",
          postEffects: [{ type: 'curse', value: 30, turns: 3, status: 'cursed', target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  mordred: {
    id: 'mordred', name: 'Mordred', class: 'Saber', pronouns: 'she/her',
    fgoHp: 14680, fgoAtk: 11723, fgoNpAtk: 0.56, fgoNpDef: 3,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'B'),
      classPassive('riding', 'B'),
      unique('Clarent', "Starts the battle with 50% NP", [{ type: 'npCharge', value: 50 }]),
    ],
    skills: [
      { id: 'crimson_thunder', name: 'Knight of Crimson Thunder A+', cost: 5,
        desc: "Buster +30% and ATK +15% (3 turns)",
        effects: [{ type: 'cardUp', card: 'buster', value: 30, turns: 3 }, { type: 'atkUp', value: 15, turns: 3 }] },
      { id: 'cigarette_lion', name: 'Cigarette Lion B+', cost: 3,
        desc: "Max AP +2 (3 turns); AP +2; AP +1 at the end of each turn (3 turns)",
        effects: [{ type: 'maxApUp', value: 2, turns: 3 }, { type: 'apGain', value: 2 }, { type: 'apRegen', value: 1, turns: 3 }] },
      { id: 'secret_of_pedigree', name: 'Secret of Pedigree EX', cost: 5,
        desc: "Cleanses her debuffs; Damage Cut 20% (2 turns); NP +20%",
        effects: [{ type: 'cleanse' }, { type: 'damageCut', value: 20, turns: 2 }, { type: 'npCharge', value: 20 }] },
    ],
    np: { name: 'Clarent Blood Arthur', card: 'buster', mult: 3.6,
          desc: "Heavy Buster damage; NP +20%",
          postEffects: [{ type: 'npCharge', value: 20 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  siegfried: {
    id: 'siegfried', name: 'Siegfried', class: 'Saber', pronouns: 'he/him',
    fgoHp: 14165, fgoAtk: 8181, fgoNpAtk: 0.83, fgoNpDef: 3,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('riding', 'B'),
      unique("Fafnir's Blood", "A landed regular attack has a 35% chance to mark the enemy as a Dragon (2 turns)",
        [{ type: 'statusOnHit', status: 'dragon', value: 35, markTurns: 2 }]),
    ],
    skills: [
      { id: 'avaricious_gold', name: 'Avaricious Gold A', cost: 5,
        desc: "NP +20%; NP gain +30% and ATK +15% (3 turns)",
        effects: [{ type: 'npCharge', value: 20 }, { type: 'npGainUp', value: 30, turns: 3 }, { type: 'atkUp', value: 15, turns: 3 }] },
      { id: 'disengage', name: 'Disengage A', cost: 4,
        desc: "Cleanses his debuffs; Heal 20% HP",
        effects: [{ type: 'cleanse' }, { type: 'heal', value: 20 }] },
      { id: 'dragon_slayer', name: 'Dragon Slayer A++', cost: 5,
        desc: "+30% damage vs a Dragon and Buster +20% (3 turns); Damage Cut 20% (2 turns)",
        effects: [{ type: 'dmgVsStatus', status: 'dragon', value: 30, turns: 3 }, { type: 'cardUp', card: 'buster', value: 20, turns: 3 },
                  { type: 'damageCut', value: 20, turns: 2 }] },
    ],
    np: { name: 'Balmung', card: 'buster', mult: 3.5, vsStatus: { status: 'dragon', value: 40 },
          desc: "Heavy Buster damage; +40% damage to a Dragon" },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  atalanta: {
    id: 'atalanta', name: 'Atalanta', class: 'Archer', pronouns: 'she/her',
    fgoHp: 12476, fgoAtk: 8633, fgoNpAtk: 0.5, fgoNpDef: 3,
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'D'),
      classPassive('independentAction', 'A'),
      unique('Golden Apple', "Her Quick attacks have a 35% chance to loose a second arrow: +50% damage if the attack landed, or a full-damage hit if it was beaten (Evade and Invincible still stop it)",
        [{ type: 'doubleShot', card: 'quick', value: 35, ratio: 50 }]),
    ],
    skills: [
      { id: 'crossing_arcadia', name: 'Crossing Arcadia', cost: 3,
        desc: "Quick +40% (3 turns)",
        effects: [{ type: 'cardUp', card: 'quick', value: 40, turns: 3 }] },
      { id: 'art_of_the_hunt', name: 'Art of the Hunt C', cost: 3,
        desc: "AP +2; Applies Sure Hit (3 turns)",
        effects: [{ type: 'apGain', value: 2 }, { type: 'sureHit', turns: 3 }] },
      { id: 'calydonian_hunt', name: 'Calydonian Hunt EX', cost: 6,
        desc: "Applies Evade (2 turns); NP +30%; NP gain +30% and ATK +15% (3 turns)",
        effects: [{ type: 'evade', turns: 2 }, { type: 'npCharge', value: 30 },
                  { type: 'npGainUp', value: 30, turns: 3 }, { type: 'atkUp', value: 15, turns: 3 }] },
    ],
    np: { name: 'Phoebus Catastrophe', card: 'quick', mult: 4.3,
          desc: "Heavy Quick damage; AP +3",
          postEffects: [{ type: 'apGain', value: 3 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  chiron: {
    id: 'chiron', name: 'Chiron', class: 'Archer', pronouns: 'he/him',
    fgoHp: 12250, fgoAtk: 9294, fgoNpAtk: 0.68, fgoNpDef: 3,
    favoredCard: 'arts', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'B'),
      classPassive('independentAction', 'A'),
      classPassive('divinity', 'C'),
      unique("Teacher's Wisdom", "Foresight 3 times per battle: he sees the opponent's locked-in action before choosing his own",
        [{ type: 'foresight', charges: 3 }]),
    ],
    skills: [
      { id: 'eye_of_mind_chiron', name: 'Eye of the Mind (True) A', cost: 4,
        desc: "Applies Evade and Damage Cut 20% (2 turns)",
        effects: [{ type: 'evade', turns: 2 }, { type: 'damageCut', value: 20, turns: 2 }] },
      { id: 'eternal_consecration', name: 'Eternal Consecration EX', cost: 3,
        desc: "AP +6; lose 5% HP (can't KO him)",
        effects: [{ type: 'apGain', value: 6 }, { type: 'hpCost', value: 5 }] },
      { id: 'wisdom_of_divine', name: 'Wisdom of Divine A+', cost: 6,
        desc: "Quick +25%, Arts +25%, Buster +25% and ATK +15% (3 turns); Applies Sure Hit (3 turns)",
        effects: [{ type: 'cardUp', card: 'quick', value: 25, turns: 3 }, { type: 'cardUp', card: 'arts', value: 25, turns: 3 },
                  { type: 'cardUp', card: 'buster', value: 25, turns: 3 }, { type: 'atkUp', value: 15, turns: 3 },
                  { type: 'sureHit', turns: 3 }] },
    ],
    np: { name: 'Antares Snipe', card: 'arts', mult: 3.5,
          desc: "Removes the enemy's Evade, Invincible and Damage Cut; Heavy Arts damage",
          preEffects: [{ type: 'removeDefBuffs', target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  vlad: {
    id: 'vlad', name: 'Vlad III', class: 'Lancer', pronouns: 'he/him',
    fgoHp: 15086, fgoAtk: 11499, fgoNpAtk: 0.5, fgoNpDef: 5,
    favoredCard: 'arts', maxAp: 10, hpMult: 0.75, // 25% below FGO-derived HP: Protection of Faith is an extra life
    passives: [
      classPassive('madness', 'EX'),
      unique('Protection of Faith', "Guts once: revives at 15% HP; on revival, NP gain +30% for the rest of the battle (a normal buff, so it can be removed)",
        [{ type: 'guts', value: 15, charges: 1, onRevive: [{ type: 'npGainUp', value: 30, turns: 99 }] }]),
    ],
    skills: [
      { id: 'bloodsucker', name: 'Bloodsucker A', cost: 5,
        desc: "Enemy NP −20%; he gains what was drained",
        effects: [{ type: 'npSteal', value: 20, target: 'enemy' }] },
      { id: 'legend_of_dracula', name: 'Legend of Dracula A+', cost: 4,
        desc: "ATK +20% (3 turns); Damage Cut 20% (2 turns)",
        effects: [{ type: 'atkUp', value: 20, turns: 3 }, { type: 'damageCut', value: 20, turns: 2 }] },
      { id: 'fearsome_immortal', name: 'Fearsome Immortal A+', cost: 4,
        desc: "Arts +30% and NP gain +30% (3 turns)",
        effects: [{ type: 'cardUp', card: 'arts', value: 30, turns: 3 }, { type: 'npGainUp', value: 30, turns: 3 }] },
    ],
    np: { name: 'Kazikli Bey', card: 'arts', mult: 3.4,
          desc: "Heavy Arts damage; Enemy Arts resist −20% (2 turns)",
          postEffects: [{ type: 'cardVuln', card: 'arts', value: 20, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  karna: {
    id: 'karna', name: 'Karna', class: 'Lancer', pronouns: 'he/him',
    fgoHp: 13632, fgoAtk: 11976, fgoNpAtk: 0.72, fgoNpDef: 4,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'C'),
      classPassive('riding', 'A'),
      classPassive('divinity', 'A'),
      unique('Son of the Sun God', "Buster +10% and NP damage +10%",
        [{ type: 'cardUp', card: 'buster', value: 10 }, { type: 'npUp', value: 10 }]),
    ],
    skills: [
      { id: 'knowledge_of_deprived', name: 'Knowledge of the Deprived A', cost: 5,
        desc: "Enemy Debuff Resist −20% (3 turns); Inflicts NP Seal this turn (gauge −20% if it fizzles)",
        effects: [{ type: 'debuffResistDown', value: 20, turns: 3, target: 'enemy' }, { type: 'npSeal', value: 20, turns: 1, target: 'enemy' }] },
      { id: 'flash_of_sun_god', name: 'Flash of the Sun God EX', cost: 5,
        desc: "Quick +20%, Buster +20% and NP damage +20% (3 turns)",
        effects: [{ type: 'cardUp', card: 'quick', value: 20, turns: 3 }, { type: 'cardUp', card: 'buster', value: 20, turns: 3 },
                  { type: 'npUp', value: 20, turns: 3 }] },
      { id: 'almsgivers_end', name: "Almsgiver's End", cost: 4,
        desc: "NP +30%; NP gain +30% (3 turns)",
        effects: [{ type: 'npCharge', value: 30 }, { type: 'npGainUp', value: 30, turns: 3 }] },
    ],
    np: { name: 'Vasavi Shakti', card: 'buster', mult: 3.2,
          desc: "Heavy Buster damage; Enemy Buster resist −20% (2 turns)",
          postEffects: [{ type: 'cardVuln', card: 'buster', value: 20, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  achilles: {
    id: 'achilles', name: 'Achilles', class: 'Rider', pronouns: 'he/him',
    fgoHp: 13219, fgoAtk: 11883, fgoNpAtk: 0.57, fgoNpDef: 3,
    favoredCard: 'quick', maxAp: 10, hpMult: 0.73, // 27% below FGO-derived HP: only an NP (or Sure Hit first) can down him
    passives: [
      classPassive('magicResistance', 'C'),
      classPassive('riding', 'A+'),
      classPassive('divinity', 'C'),
      unique('Akhilleus Kosmos', "Only a Noble Phantasm can down him (anything else leaves him at 1 HP). A landed Sure Hit attack strikes his heel and removes this",
        [{ type: 'npOnlyKo' }]),
    ],
    skills: [
      { id: 'comet_form', name: 'Drómos Komḗtēs A+', cost: 5,
        desc: "Quick +30% (3 turns); Applies Sure Hit (3 turns)",
        effects: [{ type: 'cardUp', card: 'quick', value: 30, turns: 3 }, { type: 'sureHit', turns: 3 }] },
      { id: 'amaranth', name: 'Andreíos Amárantos B', cost: 5,
        desc: "Applies Invincible (this turn); Damage Cut 20% (2 turns)",
        effects: [{ type: 'invincible' }, { type: 'damageCut', value: 20, turns: 2 }] },
      { id: 'star_spear', name: 'Diatrekhōn Astēr Lonkhē B+', cost: 5,
        desc: "NP +20%; NP gain +30% (3 turns); Inflicts Taunt (next turn)",
        effects: [{ type: 'npCharge', value: 20 }, { type: 'npGainUp', value: 30, turns: 3 },
                  { type: 'taunt', value: 1, turns: 2, target: 'enemy' }] },
    ],
    np: { name: 'Troias Tragōidia', card: 'quick', mult: 3.4,
          desc: "Quick +30% for this NP; Heavy Quick damage; Inflicts Confusion (40%, 3 turns)",
          preEffects: [{ type: 'cardUp', card: 'quick', value: 30, turns: 1 }],
          postEffects: [{ type: 'confusion', value: 40, turns: 4, status: 'confused', target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  astolfo: {
    id: 'astolfo', name: 'Astolfo', class: 'Rider', pronouns: 'they/them',
    fgoHp: 11172, fgoAtk: 8937, fgoNpAtk: 0.66, fgoNpDef: 1,
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'A'),
      classPassive('riding', 'A+'),
      classPassive('independentAction', 'B'),
      unique('La Black Luna', "A landed regular attack has a 10% chance to inflict Terror (40%, 3 turns)",
        [{ type: 'debuffOnHit', value: 10, inflict: { type: 'terror', value: 40, turns: 3, status: 'terrified' } }]),
    ],
    skills: [
      { id: 'monstrous_strength', name: 'Monstrous Strength C-', cost: 3,
        desc: "ATK +30% (3 turns)",
        effects: [{ type: 'atkUp', value: 30, turns: 3 }] },
      { id: 'trap_of_argalia', name: 'Trap of Argalia D', cost: 5,
        desc: "Inflicts Trap (50% chance the enemy loses their next turn)",
        effects: [{ type: 'stun', value: 50, turns: 2, target: 'enemy' }] },
      { id: 'evaporation', name: 'Evaporation of Sanity D+', cost: 4,
        desc: "NP +20%; NP gain +30% (3 turns); a 50% chance of AP +2 at the end of each turn (3 turns)",
        effects: [{ type: 'npCharge', value: 20 }, { type: 'npGainUp', value: 30, turns: 3 },
                  { type: 'apChance', value: 50, amount: 2, turns: 3 }] },
    ],
    np: { name: 'Hippogriff', card: 'quick', mult: 4.2, ignoreCut: true,
          desc: "Heavy Quick damage (Ignores Damage Cut); Applies Evade (2 turns)",
          postEffects: [{ type: 'evade', turns: 3 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  jack: {
    id: 'jack', name: 'Jack the Ripper', class: 'Assassin', pronouns: 'she/her',
    fgoHp: 12696, fgoAtk: 11557, fgoNpAtk: 1.07, fgoNpDef: 4,
    favoredCard: 'quick', maxAp: 10,
    passives: [
      classPassive('presenceConcealment', 'A+'),
      unique('The Misty Night of London', "When her Quick attack meets a Buster attack, a 20% chance her Quick wins the clash instead",
        [{ type: 'rpsOverride', card: 'quick', vs: 'buster', value: 20 }]),
    ],
    skills: [
      { id: 'murderer_misty_night', name: 'Murderer of the Misty Night EX', cost: 6,
        desc: "Applies Evade (2 turns); NP +20%; Quick +25% and NP damage +20% (3 turns)",
        effects: [{ type: 'evade', turns: 2 }, { type: 'npCharge', value: 20 },
                  { type: 'cardUp', card: 'quick', value: 25, turns: 3 }, { type: 'npUp', value: 20, turns: 3 }] },
      { id: 'information_erasure', name: 'Information Erasure B', cost: 5,
        desc: "Removes the enemy's buffs (passives stay); Enemy AP −2",
        effects: [{ type: 'removeBuffs', target: 'enemy' }, { type: 'apDrain', value: 2, target: 'enemy' }] },
      { id: 'surgery', name: 'Surgery E', cost: 4,
        desc: "Heal 20% HP; AP +2",
        effects: [{ type: 'heal', value: 20 }, { type: 'apGain', value: 2 }] },
    ],
    np: { name: 'Maria the Ripper', card: 'quick', mult: 3.25, ignoreCut: true,
          desc: "Heavy Quick damage (Ignores Damage Cut)" },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  semiramis: {
    id: 'semiramis', name: 'Semiramis', class: 'Assassin', pronouns: 'she/her',
    fgoHp: 13266, fgoAtk: 11309, fgoNpAtk: 0.39, fgoNpDef: 4,
    favoredCard: 'arts', maxAp: 10,
    passives: [
      classPassive('presenceConcealment', 'C+'),
      classPassive('territoryCreation', 'EX'),
      classPassive('divinity', 'C'),
      unique('Ambiguous Chalice', "A landed regular attack has a 30% chance to inflict Poison (20 per turn, 3 turns)",
        [{ type: 'debuffOnHit', value: 30, inflict: { type: 'poison', value: 20, turns: 3, status: 'poisoned' } }]),
    ],
    skills: [
      { id: 'familiar_pigeon', name: 'Familiar (Pigeon) D', cost: 4,
        desc: "NP +20%; Enemy Debuff Resist −20% (3 turns)",
        effects: [{ type: 'npCharge', value: 20 }, { type: 'debuffResistDown', value: 20, turns: 3, target: 'enemy' }] },
      { id: 'double_summon', name: 'Double Summon B', cost: 4,
        desc: "NP gain +30% (3 turns); Inflicts No Boosts (3 turns)",
        effects: [{ type: 'npGainUp', value: 30, turns: 3 }, { type: 'nullifyBoosts', value: 1, turns: 3, target: 'enemy' }] },
      { id: 'sikera_usum', name: 'Sikera Ušum A', cost: 5,
        desc: "Inflicts Poison (30 per turn) and Enemy Buster resist −20% (3 turns); +30% damage vs a Poisoned enemy (3 turns)",
        effects: [{ type: 'poison', value: 30, turns: 3, status: 'poisoned', target: 'enemy' },
                  { type: 'cardVuln', card: 'buster', value: 20, turns: 3, target: 'enemy' },
                  { type: 'dmgVsStatus', status: 'poisoned', value: 30, turns: 3 }] },
    ],
    np: { name: 'Hanging Gardens of Babylon', card: 'buster', mult: 2.65,
          desc: "NP damage +30% for this NP; Heavy Buster damage; Damage Cut 20% (2 turns)",
          preEffects: [{ type: 'npUp', value: 30, turns: 1 }],
          postEffects: [{ type: 'damageCut', value: 20, turns: 3 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  shakespeare: {
    id: 'shakespeare', name: 'William Shakespeare', class: 'Caster', pronouns: 'he/him',
    fgoHp: 8080, fgoAtk: 5798, fgoNpAtk: 1.59, fgoNpDef: 3,
    favoredCard: 'arts', maxAp: 10,
    passives: [
      classPassive('territoryCreation', 'C'),
      unique('Works of Art', "At the start of each battle, one of his works takes the stage (its badge says which)", [{
        type: 'randomWork', works: [
          { name: 'Hamlet', weight: 20, desc: 'A landed regular attack has a 10% chance to inflict Madness (next turn)',
            effects: [{ type: 'debuffOnHit', value: 10, inflict: { type: 'madness', value: 1, turns: 2 } }] },
          { name: 'Macbeth', weight: 30, desc: 'Quick +10%, Arts +10% and Buster +10%',
            effects: [{ type: 'cardUp', card: 'quick', value: 10 }, { type: 'cardUp', card: 'arts', value: 10 }, { type: 'cardUp', card: 'buster', value: 10 }] },
          { name: 'Romeo and Juliet', weight: 10, desc: 'When either servant falls, a 10% chance the other falls too (a draw)',
            effects: [{ type: 'starCrossed', value: 10 }] },
          { name: 'Othello', weight: 20, desc: "Foresight 3 times per battle, but there's a 40% chance what he sees is a lie",
            effects: [{ type: 'foresight', charges: 3, deceive: 40 }] },
          { name: "A Midsummer Night's Dream", weight: 20, desc: 'A landed regular attack has a 10% chance to inflict Charm (next turn)',
            effects: [{ type: 'debuffOnHit', value: 10, inflict: { type: 'charm', value: 1, turns: 2 } }] },
        ],
      }]),
    ],
    skills: [
      { id: 'enchant', name: 'Enchant A', cost: 4,
        desc: "Buster +30% (3 turns)",
        effects: [{ type: 'cardUp', card: 'buster', value: 30, turns: 3 }] },
      { id: 'iambic_pentameter', name: 'Iambic Pentameter A+', cost: 6,
        desc: "Applies Invincible (this turn); Heal 20% HP; NP +20%; NP damage +20% (3 turns)",
        effects: [{ type: 'invincible' }, { type: 'heal', value: 20 }, { type: 'npCharge', value: 20 }, { type: 'npUp', value: 20, turns: 3 }] },
      { id: 'the_globe', name: "The Globe: The King's Men C", cost: 4,
        desc: "NP +20%; NP gain +30% (3 turns)",
        effects: [{ type: 'npCharge', value: 20 }, { type: 'npGainUp', value: 30, turns: 3 }] },
    ],
    np: { name: 'First Folio', card: 'buster', mult: 2.85, desc: "Heavy Buster damage" },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  avicebron: {
    id: 'avicebron', name: 'Avicebron', class: 'Caster', pronouns: 'he/him',
    fgoHp: 9981, fgoAtk: 6376, fgoNpAtk: 0.61, fgoNpDef: 3,
    favoredCard: 'arts', maxAp: 10,
    passives: [
      classPassive('territoryCreation', 'B'),
      unique("Golem's Support", "A landed Buster attack has a 40% chance of a Golem strike for 30% of its damage",
        [{ type: 'extraHitChance', card: 'buster', value: 40, ratio: 30 }]),
    ],
    skills: [
      { id: 'numerology', name: 'Numerology B', cost: 5,
        desc: "Arts +25% and Buster +25% (3 turns)",
        effects: [{ type: 'cardUp', card: 'arts', value: 25, turns: 3 }, { type: 'cardUp', card: 'buster', value: 25, turns: 3 }] },
      { id: 'high_speed_avi', name: 'High-Speed Incantation B+', cost: 4,
        desc: "NP +40%",
        effects: [{ type: 'npCharge', value: 40 }] },
      { id: 'fig_tree', name: 'Fig Tree of Tranquility EX', cost: 5,
        desc: "Heal 30% HP; below 30% HP, Applies Invincible (this turn) instead of the heal",
        effects: [{ type: 'heal', value: 30, condition: 'hpAtLeast', threshold: 30 },
                  { type: 'invincible', condition: 'hpBelow', threshold: 30 }] },
    ],
    np: { name: 'Golem Keter Malkuth', card: 'buster', mult: 2.7,
          desc: "NP damage +30% for this NP; Heavy Buster damage; NP gain +30% (3 turns)",
          preEffects: [{ type: 'npUp', value: 30, turns: 1 }],
          postEffects: [{ type: 'npGainUp', value: 30, turns: 4 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  frankenstein: {
    id: 'frankenstein', name: 'Frankenstein', class: 'Berserker', pronouns: 'she/her',
    fgoHp: 10687, fgoAtk: 9441, fgoNpAtk: 0.83, fgoNpDef: 5,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('madness', 'D'),
      unique('Procedure to Humanity', "A landed regular attack has a 20% chance to inflict Shock (20 per turn, 3 turns)",
        [{ type: 'debuffOnHit', value: 20, inflict: { type: 'shock', value: 20, turns: 3 } }]),
    ],
    skills: [
      { id: 'galvanism', name: 'Galvanism B', cost: 3,
        desc: "NP gain +40% (3 turns)",
        effects: [{ type: 'npGainUp', value: 40, turns: 3 }] },
      { id: 'lament', name: 'Lament of the Falsely Living C', cost: 5,
        desc: "60% chance to inflict Shock (30 per turn, 3 turns); Enemy DEF −20% (3 turns)",
        effects: [{ type: 'shock', value: 30, turns: 3, chance: 60, target: 'enemy' }, { type: 'defDown', value: 20, turns: 3, target: 'enemy' }] },
      { id: 'overload', name: 'Overload C', cost: 4,
        desc: "NP damage +30% (3 turns); Burn on herself (20 per turn, 3 turns)",
        effects: [{ type: 'npUp', value: 30, turns: 3 }, { type: 'burn', value: 20, turns: 3, refresh: true }] },
    ],
    np: { name: 'Blasted Tree', card: 'quick', mult: 3.95,
          desc: "Heavy Quick damage; Inflicts Shock (30 per turn, 3 turns)",
          postEffects: [{ type: 'shock', value: 30, turns: 3, target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  spartacus: {
    id: 'spartacus', name: 'Spartacus', class: 'Berserker', pronouns: 'he/him',
    fgoHp: 7722, fgoAtk: 5073, fgoNpAtk: 1.01, fgoNpDef: 5,
    favoredCard: 'buster', maxAp: 10, hpMult: 0.85, // 15% below FGO-derived HP: Unyielding Will is a guaranteed last NP
    passives: [
      classPassive('madness', 'EX'),
      unique('Unyielding Will', "Once, a lethal blow leaves him at 1 HP with a full NP gauge. Next turn he must fire his NP and can't fall before it lands; then he falls unless it took the enemy down",
        [{ type: 'lastStand' }]),
    ],
    skills: [
      { id: 'honor_of_battered', name: 'Honor of the Battered B+', cost: 5,
        desc: "Heal 8% HP at the end of each turn (3 turns)",
        effects: [{ type: 'hpRegen', value: 8, turns: 3 }] },
      { id: 'insurrection', name: 'Insurrection A', cost: 4,
        desc: "NP +30%; NP gain +30% (3 turns)",
        effects: [{ type: 'npCharge', value: 30 }, { type: 'npGainUp', value: 30, turns: 3 }] },
      { id: 'triumphant_return', name: 'Triumphant Return of the Sword B', cost: 5,
        desc: "Buster +30% (3 turns); Heal 25% HP",
        effects: [{ type: 'cardUp', card: 'buster', value: 30, turns: 3 }, { type: 'heal', value: 25 }] },
    ],
    np: { name: 'Crying Warmonger', card: 'buster', mult: 3.15, ignoreCut: true,
          desc: "Heavy Buster damage (Ignores Damage Cut)" },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  jeanne: {
    id: 'jeanne', name: "Jeanne d'Arc", class: 'Ruler', pronouns: 'she/her',
    fgoHp: 16500, fgoAtk: 9593, fgoNpAtk: 0.76, fgoNpDef: 3,
    favoredCard: 'arts', maxAp: 10, hpMult: 0.735, // 26.5% below FGO-derived HP: regen, Divine Intervention and Magic Resistance EX
    passives: [
      classPassive('magicResistance', 'EX'),
      unique('Revelation from Heaven', "Heal 3% HP at the end of each turn", [{ type: 'hpRegen', value: 3 }]),
    ],
    skills: [
      { id: 'pure_and_clear', name: 'At the End of the Pure and Clear Players EX', cost: 5,
        desc: "Arts +30% (3 turns); NP +20%",
        effects: [{ type: 'cardUp', card: 'arts', value: 30, turns: 3 }, { type: 'npCharge', value: 20 }] },
      { id: 'brilliant_holy_light', name: 'Restoration of the Brilliant Holy Light A', cost: 5,
        desc: "Enemy NP damage −20% and DEF −15% (3 turns); a further Enemy DEF −15% (2 turns)",
        effects: [{ type: 'npDown', value: 20, turns: 3, target: 'enemy' }, { type: 'defDown', value: 15, turns: 3, target: 'enemy' },
                  { type: 'defDown', value: 15, turns: 2, target: 'enemy' }] },
      { id: 'gods_resolution', name: "God's Resolution A", cost: 6,
        desc: "Damage Cut 40% (2 turns); 80% chance to inflict Blind (next turn); on a miss, AP +3",
        effects: [{ type: 'damageCut', value: 40, turns: 2 },
                  { type: 'stun', value: 100, turns: 2, chance: 80, target: 'enemy', onMiss: [{ type: 'apGain', value: 3 }] }] },
    ],
    np: { name: 'Luminosité Eternelle', card: 'arts', mult: 2.6,
          desc: "Medium Arts damage; Applies Divine Intervention",
          postEffects: [{ type: 'divineIntervention', value: 1, turns: 99 }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  amakusa: {
    id: 'amakusa', name: 'Amakusa Shirou', class: 'Ruler', pronouns: 'he/him',
    fgoHp: 14107, fgoAtk: 10972, fgoNpAtk: 0.86, fgoNpDef: 3,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      classPassive('magicResistance', 'A'),
      unique('Left Hand & Right Hand', "With his first action, his master chooses Left Hand (his buffs last 1 turn longer) or Right Hand (his debuffs on the enemy last 1 turn longer)", [{
        type: 'battleChoice', options: [
          { id: 'left', name: 'Left Hand: Xanadu Matrix', desc: 'Buffs he gives himself last 1 turn longer', effects: [{ type: 'buffDurationUp', value: 1 }] },
          { id: 'right', name: 'Right Hand: Evil Eater', desc: 'Debuffs he puts on the enemy last 1 turn longer', effects: [{ type: 'debuffDurationUp', value: 1 }] },
        ],
      }]),
    ],
    skills: [
      { id: 'prayer_long_journey', name: 'Prayer for the Long Journey A', cost: 4,
        desc: "AP +3; NP gain +30% (3 turns)",
        effects: [{ type: 'apGain', value: 3 }, { type: 'npGainUp', value: 30, turns: 3 }] },
      { id: 'grail_fiery_heavens', name: 'Grail of Fiery Heavens EX', cost: 6,
        desc: "Enemy NP −20%; Enemy Buster resist −20% (3 turns); NP +20%; NP +5% at the end of each turn (3 turns)",
        effects: [{ type: 'npDrain', value: 20, target: 'enemy' }, { type: 'cardVuln', card: 'buster', value: 20, turns: 3, target: 'enemy' },
                  { type: 'npCharge', value: 20 }, { type: 'npRegen', value: 5, turns: 3 }] },
      { id: 'gods_resolution_false', name: "God's Resolution (False) C++", cost: 5,
        desc: "Buster +25% (3 turns); 60% chance to inflict Blind (next turn)",
        effects: [{ type: 'cardUp', card: 'buster', value: 25, turns: 3 }, { type: 'stun', value: 100, turns: 2, chance: 60, target: 'enemy' }] },
    ],
    np: { name: 'Twin Arm: Big Crunch', card: 'buster', mult: 3.75,
          desc: "Removes the enemy's buffs (passives stay); Heavy Buster damage",
          preEffects: [{ type: 'removeBuffs', target: 'enemy' }] },
  },

  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-10)
  angra: {
    id: 'angra', name: 'Angra Mainyu', class: 'Avenger', pronouns: 'he/him',
    fgoHp: 7981, fgoAtk: 5683, fgoNpAtk: 0.79, fgoNpDef: 5,
    favoredCard: 'quick', maxAp: 10, hpMult: 1.6, atk: 160, // well above FGO-derived stats: his NP deals no damage of its own
    passives: [
      classPassive('avenger', 'A'),
      classPassive('selfReplenishMagic', 'E'),
      unique("All the World's Evils", "Every effect with a % chance always lands on him (except Instant Kill and Breaker Gorgon). Gains a Power Boost for each debuff on him", [{ type: 'worldsEvils', value: 10, scale: 20 }]),
    ],
    skills: [
      { id: 'zarich', name: 'Zarich: Right Fang Grinder C', cost: 4,
        desc: "Enemy AP −4",
        effects: [{ type: 'apDrain', value: 4, target: 'enemy' }] },
      { id: 'tawrich', name: 'Tawrich: Left Fang Grinder C', cost: 5,
        desc: "Enemy NP −30%; Enemy ATK −30% (3 turns)",
        effects: [{ type: 'npDrain', value: 30, target: 'enemy' }, { type: 'atkDown', value: 30, turns: 3, target: 'enemy' }] },
      { id: 'fourth_night', name: 'The End of the Fourth Night EX', cost: 6,
        desc: "Quick +40% and Arts +40% (3 turns); NP +40%",
        effects: [{ type: 'cardUp', card: 'quick', value: 40, turns: 3 }, { type: 'cardUp', card: 'arts', value: 40, turns: 3 }, { type: 'npCharge', value: 40 }] },
    ],
    np: { name: 'Verg Avesta', subtitle: 'False Copy of Inscribed Creation', card: 'arts', mult: 0, equalize: true,
          desc: "Equalizes HP %: if his is lower, the enemy's HP drops to match (can't be blocked); if his is higher, his own HP drops to match" },
  },
};

export const ROSTER = Object.values(SERVANTS);
