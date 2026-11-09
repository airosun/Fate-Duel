// Servant definitions. Pure data — the engine reads these, never modifies them.
//
// ⚠ PLACEHOLDER KITS: the skills/NPs below are stand-ins so the engine and
// simulator have something to run. Replace them with your own designs.
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
//   maxAp, passives: [{name, effects}] (or legacy passive: {...})
//   turns counts the turn it's applied on (turns:2 = this turn + next). Passives are permanent.
//
// NP fields: name, card, mult (× ATK), ignoreDefense, missingHpBonus,
//            preEffects (before damage), postEffects (after damage)

export const SERVANTS = {
  // ✅ USER-DESIGNED KIT (numbers proposed by Claude, 2026-11-09)
  artoria: {
    id: 'artoria', name: 'Artoria Pendragon', class: 'Saber',
    fgoHp: 15150, fgoAtk: 11221, fgoNpAtk: 0.86, fgoNpDef: 3,
    favoredCard: 'buster', maxAp: 10,
    passives: [
      { name: 'Magic Resistance A', desc: 'Enemy debuffs on her are 20% weaker',
        effects: [{ type: 'debuffResist', value: 20 }] },
      { name: 'Riding B', desc: 'Quick attacks +10% damage',
        effects: [{ type: 'cardUp', card: 'quick', value: 10 }] },
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

  heracles: {
    id: 'heracles', name: 'Heracles', class: 'Berserker',
    fgoHp: 13068, fgoAtk: 10655,
    favoredCard: 'buster', npGain: 0.8, maxAp: 8,
    passive: { name: 'God Hand', effects: [{ type: 'guts', value: 10, charges: 1 }] },
    skills: [
      { id: 'valor', name: 'Valor', cost: 4,
        effects: [{ type: 'atkUp', value: 20, turns: 3 }] },
      { id: 'eye_of_mind', name: 'Eye of the Mind (False)', cost: 4,
        effects: [{ type: 'evade', turns: 2 }] },
      { id: 'divinity', name: 'Divinity Surge', cost: 5,
        effects: [{ type: 'npCharge', value: 30 }] },
    ],
    np: { name: 'Nine Lives', card: 'buster', mult: 4.0 },
  },

  medea: {
    id: 'medea', name: 'Medea', class: 'Caster',
    fgoHp: 9000, fgoAtk: 6400,
    favoredCard: 'arts', npGain: 1.2, maxAp: 12,
    passive: { name: 'Territory Creation', effects: [{ type: 'apRegen', value: 1 }] },
    skills: [
      { id: 'argon_coin', name: 'Argon Coin', cost: 3,
        effects: [{ type: 'heal', value: 15 }] },
      { id: 'magic_shield', name: 'Bounded Field', cost: 4,
        effects: [{ type: 'damageCut', value: 40, turns: 2 }] },
      { id: 'high_speed', name: 'High-Speed Divine Words', cost: 6,
        effects: [{ type: 'npCharge', value: 50 }] },
    ],
    np: { name: 'Rule Breaker', card: 'arts', mult: 3.0,
          preEffects: [{ type: 'removeBuffs', target: 'enemy' }] },
  },

  kojirou: {
    id: 'kojirou', name: 'Sasaki Kojirou', class: 'Assassin',
    fgoHp: 7000, fgoAtk: 5700,
    favoredCard: 'quick', npGain: 1.0, maxAp: 10,
    passive: { name: 'Presence Concealment', effects: [{ type: 'npGainUp', value: 10 }] },
    skills: [
      { id: 'minds_eye', name: "Mind's Eye (Fake)", cost: 4,
        effects: [{ type: 'evade', turns: 2 }] },
      { id: 'swallow_stance', name: 'Swallow Stance', cost: 3,
        effects: [{ type: 'cardUp', card: 'quick', value: 50, turns: 3 }] },
      { id: 'vitrification', name: 'Vitrification', cost: 5,
        effects: [{ type: 'npCharge', value: 30 }, { type: 'heal', value: 10 }] },
    ],
    np: { name: 'Tsubame Gaeshi', card: 'quick', mult: 3.6, ignoreDefense: true },
  },
};

export const ROSTER = Object.values(SERVANTS);
