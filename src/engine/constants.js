// All tuning numbers live here so balance passes never touch engine logic.
// Values mirror the design doc; change them freely and re-run `npm run sim`.

export const TUNING = {
  cards: {
    quick:  { mult: 0.8, npGain: 18, apBonus: 1 },
    arts:   { mult: 1.0, npGain: 32, apBonus: 0 },
    buster: { mult: 1.5, npGain: 10, apBonus: 0 },
  },
  // key beats value
  beats: { quick: 'arts', arts: 'buster', buster: 'quick' },

  counterBonus: 0.25,   // winner of a clash
  // Favored-card damage bonus, per card. Buster is lower because it
  // multiplies an already-larger base (1.5x).
  affinityBonus: { quick: 0.15, arts: 0.15, buster: 0.08 },

  npMax: 100,
  npGainOnHit: 14,      // defender gains this when hit (attack or NP)

  startAp: 4,
  defaultMaxAp: 10,
  apPerAttack: 2,       // any outcome
  apOnLand: 1,          // bonus if the attack connects

  seals: {
    count: 3,
    healPct: 30,
    rechargeAp: 5,
    empowerBonus: 0.5,
  },

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
  statExponent: Number(process.env.STAT_EXP ?? 0.25),
  baseHp: Number(process.env.BASE_HP ?? 1150),
  baseAtk: 120,
  refFgoHp: 11500,
  refFgoAtk: 9000,
};

export const CARDS = ['quick', 'arts', 'buster'];
export const SEALS = ['heal', 'recharge', 'empower', 'grandOrder'];
