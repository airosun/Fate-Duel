// All tuning numbers live here so balance passes never touch engine logic.
// Values mirror the design doc; change them freely and re-run `npm run sim`.

export const TUNING = {
  cards: {
    quick:  { mult: 0.8, npGain: Number(globalThis.process?.env?.NPQ ?? 22), apBonus: 1 },
    arts:   { mult: 1.0, npGain: Number(globalThis.process?.env?.NPA ?? 38), apBonus: 0 },
    buster: { mult: 1.5, npGain: Number(globalThis.process?.env?.NPB ?? 12), apBonus: 0 },
  },
  // key beats value
  beats: { quick: 'arts', arts: 'buster', buster: 'quick' },

  // Card "effectiveness" side effects. They don't stack: having any number of
  // effectiveness buffs for that card gives the bonus once.
  artsEffectNpGain: Number(globalThis.process?.env?.ARTS_NPG ?? 15), // % extra NP gain on Arts hits
  quickEffectAp: 1,     // extra AP when attacking with Quick

  counterBonus: 0.25,   // winner of a clash
  // Favored-card damage bonus, per card. Buster is lower because it
  // multiplies an already-larger base (1.5x).
  affinityBonus: { quick: 0.15, arts: 0.15, buster: 0.08 },

  // Critical hits (regular attacks only, never NPs). Base chance scales with FGO star absorption:
  // chance = maxChance x starAbsorb / refAbsorb (Iskandar and Astolfo, 205, sit at the 20% cap).
  crit: {
    maxChance: 20,
    refAbsorb: 205,
    mult: { quick: 1.5, arts: 1.5, buster: 1.75 },
    quickAp: 1,       // Quick crit: +1 AP
    artsNp: 15,       // Arts crit: extra NP charge (scaled by the attacker's NP gain like any other charge)
  },

  npMax: 100,
  npGainOnHit: Number(globalThis.process?.env?.NPH ?? 17),      // defender gains this when hit (attack or NP)

  startAp: Number(globalThis.process?.env?.START_AP ?? 5),
  defaultMaxAp: Number(globalThis.process?.env?.MAX_AP ?? 12),
  apPerAttack: Number(globalThis.process?.env?.AP_ATK ?? 3),       // any outcome
  apOnLand: Number(globalThis.process?.env?.AP_LAND ?? 1),          // bonus if the attack connects

  // Command Seals: Replenish Magical Energy, used at once while choosing (up to all three a turn)
  seals: {
    count: 3,
    healPct: Number(globalThis.process?.env?.SEAL_HEAL ?? 15),   // % of max HP
    npCharge: Number(globalThis.process?.env?.SEAL_NP ?? 20),    // NP gauge %
  },

  // When Ea neutralizes a revive, the servant gets back this share of the HP
  // they gave up for it (hpMult): 0 = none, 1 = all.
  neutralizedHpRestore: Number(globalThis.process?.env?.NEUT_HP ?? 0.75),

  maxDamageCut: 90,     // % cap on stacked damage cut
  maxTurns: 50,         // reaching the limit = draw (stalemate)

  // Default durations when a skill doesn't specify one.
  // Invincible is always forced to 1 turn (only the turn it's cast).
  defaultTurns: { evade: 2, damageCut: 2 },

  // NP gain conversion from FGO per-hit values: mod = (FGO / ref) ^ 0.5
  refFgoNpAtk: 0.8,     // % per hit
  refFgoNpDef: 3,       // %

  // Stat conversion: GameStat = Base * (FGO / Reference) ^ statExponent
  // 0.5 = square root; lower = flatter (rarity matters less).
  statExponent: Number(globalThis.process?.env?.STAT_EXP ?? 0.1),
  baseHp: Number(globalThis.process?.env?.BASE_HP ?? 1250),
  baseAtk: 120,
  refFgoHp: 11500,
  refFgoAtk: 9000,
};

export const CARDS = ['quick', 'arts', 'buster'];
