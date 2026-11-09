// Class passives with rank scaling, so every servant's passives stay consistent.
// classPassive('riding', 'B') -> { name, rank, desc, effects }
//
// Rank ladder (index into each table): EX, A+, A, B+, B, C, D, E

const RANKS = ['EX', 'A+', 'A', 'B+', 'B', 'C', 'D', 'E'];

const TABLES = {
  // % weaker debuffs (deterministic, no RNG)
  magicResistance:  { name: 'Magic Resistance', values: [25, 22, 20, 17, 15, 10, 5, 3],
    make: v => [{ type: 'debuffResist', value: v }], desc: v => `Enemy debuffs on self ${v}% weaker` },
  // AP economy: +max AP and +starting AP
  independentAction: { name: 'Independent Action', values: [2, 2, 2, 1, 1, 1, 1, 0],
    make: v => [{ type: 'maxApUp', value: v }, { type: 'apGain', value: v }],
    desc: v => `+${v} max AP and +${v} starting AP` },
  riding:           { name: 'Riding', values: [15, 13, 12, 11, 10, 8, 6, 4],
    make: v => [{ type: 'cardUp', card: 'quick', value: v }], desc: v => `Quick attacks +${v}% damage` },
  territoryCreation: { name: 'Territory Creation', values: [15, 13, 12, 11, 10, 8, 6, 4],
    make: v => [{ type: 'cardUp', card: 'arts', value: v }], desc: v => `Arts attacks +${v}% damage` },
  madness:          { name: 'Mad Enhancement', values: [15, 13, 12, 11, 10, 8, 6, 4],
    make: v => [{ type: 'cardUp', card: 'buster', value: v }], desc: v => `Buster attacks +${v}% damage` },
  presenceConcealment: { name: 'Presence Concealment', values: [12, 11, 10, 9, 8, 6, 4, 2],
    make: v => [{ type: 'npGainUp', value: v }], desc: v => `NP gain +${v}%` },
  // flat damage added to every hit (attacks and NPs), at game scale (~120 ATK)
  divinity:         { name: 'Divinity', values: [12, 11, 10, 9, 8, 6, 4, 2],
    make: v => [{ type: 'flatDamage', value: v }], desc: v => `+${v} flat damage on every hit` },
};

export function classPassive(key, rank) {
  const t = TABLES[key];
  if (!t) throw new Error(`Unknown class passive: ${key}`);
  const idx = RANKS.indexOf(rank);
  if (idx < 0) throw new Error(`Unknown rank: ${rank}`);
  const v = t.values[idx];
  return { name: `${t.name} ${rank}`, kind: 'class', desc: t.desc(v), effects: t.make(v) };
}

export const unique = (name, desc, effects) => ({ name, kind: 'unique', desc, effects });
