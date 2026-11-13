// Class passives with rank scaling, so every servant's passives stay consistent.
// classPassive('riding', 'B') -> { name, rank, desc, effects }
//
// Rank ladder (index into each table): EX, A+, A, B+, B, C, D, E, E-

const RANKS = ['EX', 'A+', 'A', 'B+', 'B', 'C', 'D', 'E', 'E-'];

const TABLES = {
  // % weaker debuffs (deterministic, no RNG)
  magicResistance:  { name: 'Magic Resistance', values: [25, 22, 20, 17, 15, 10, 5, 3, 2],
    make: v => [{ type: 'debuffResist', value: v }], desc: v => `Debuff Resist +${v}%` },
  // AP economy: +max AP and +starting AP
  independentAction: { name: 'Independent Action', values: [2, 2, 2, 1, 1, 1, 1, 0, 0],
    make: v => [{ type: 'maxApUp', value: v }, { type: 'apGain', value: v }],
    desc: v => `Max AP +${v}; starting AP +${v}` },
  riding:           { name: 'Riding', values: [15, 13, 12, 11, 10, 8, 6, 4, 3],
    make: v => [{ type: 'cardUp', card: 'quick', value: v }], desc: v => `Quick +${v}%` },
  territoryCreation: { name: 'Territory Creation', values: [15, 13, 12, 11, 10, 8, 6, 4, 3],
    make: v => [{ type: 'cardUp', card: 'arts', value: v }], desc: v => `Arts +${v}%` },
  madness:          { name: 'Mad Enhancement', values: [15, 13, 12, 11, 10, 8, 6, 4, 3],
    make: v => [{ type: 'cardUp', card: 'buster', value: v }], desc: v => `Buster +${v}%` },
  presenceConcealment: { name: 'Presence Concealment', values: [24, 22, 20, 18, 16, 14, 12, 8, 4],
    make: v => [{ type: 'apGainUp', value: v }], desc: v => `AP gain +${v}%` },
  // flat damage added to every hit (attacks and NPs), at game scale (~120 ATK)
  divinity:         { name: 'Divinity', values: [12, 11, 10, 9, 8, 6, 4, 2, 1],
    make: v => [{ type: 'flatDamage', value: v }], desc: v => `+${v} damage on every hit` },
  // Oblivion Correction: stronger attacks (ATK up)
  oblivionCorrection: { name: 'Oblivion Correction', values: [12, 11, 10, 9, 8, 6, 4, 2, 1],
    make: v => [{ type: 'atkUp', value: v }], desc: v => `ATK +${v}%` },
  // Avenger: more NP from taking damage (multiplies the defending NP gain)
  avenger:          { name: 'Avenger', values: [30, 27, 25, 22, 20, 15, 10, 5, 3],
    make: v => [{ type: 'npGainDefUp', value: v }], desc: v => `NP gain when hit +${v}%` },
  // Self-Replenishment (Magic): NP at the end of every turn
  selfReplenishMagic: { name: 'Self-Replenishment (Magic)', values: [6, 5, 5, 4, 4, 3, 3, 2, 1],
    make: v => [{ type: 'npRegen', value: v }], desc: v => `NP +${v}% at the end of each turn` },
};

export function classPassive(key, rank) {
  const t = TABLES[key];
  if (!t) throw new Error(`Unknown class passive: ${key}`);
  let idx = RANKS.indexOf(rank), v;
  if (idx >= 0) v = t.values[idx];
  else if (rank.endsWith('+') && RANKS.includes(rank.slice(0, -1)) && RANKS.indexOf(rank.slice(0, -1)) > 0) {
    // Off-ladder "+" ranks (e.g. C+): halfway between the base rank and the one above it
    idx = RANKS.indexOf(rank.slice(0, -1));
    v = Math.round((t.values[idx] + t.values[idx - 1]) / 2);
  } else throw new Error(`Unknown rank: ${rank}`);
  return { name: `${t.name} ${rank}`, kind: 'class', desc: t.desc(v), effects: t.make(v) };
}

export const unique = (name, desc, effects) => ({ name, kind: 'unique', desc, effects });
