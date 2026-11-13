// Named effects in skill, NP and passive text. glossify() wraps each one in a
// .term span that shows its definition on hover (desktop) or tap (touch).

export const GLOSSARY = [
  // longer phrases first so they win over the shorter terms inside them
  { term: 'Ignores Damage Cut', re: 'Ignores? Damage Cut', def: "Goes straight through the target's Damage Cut. Evade and Invincible still work." },
  { term: 'Divine Intervention', def: 'Negates one hit that would deal damage (attack, NP or follow-up). Its master chooses which hit, then it is spent. Damage over time is not stopped. Only one at a time, and buff removal strips it.' },
  { term: 'Debuff Resist', def: "Debuffs on this servant are weaker by this %: smaller stat drops and drains, less damage over time. It doesn't stop chance-based effects from landing." },
  { term: 'Debuff effectiveness', def: 'Debuffs this servant inflicts are stronger by this %: bigger stat drops and drains, more damage over time, higher Terror chance.' },
  { term: 'Buff success', re: '[Bb]uff success', def: 'Chance-based buffs are this much more likely to land, and enemy buff-failure effects (Breaker Gorgon) are this much weaker.' },
  { term: 'Pierce Evade', def: 'Attacks go through Evade and decoys. This is not Sure Hit, so effects that need Sure Hit do not trigger.' },
  { term: 'Sure Hit', def: "Attacks always hit: they go through Evade and can't be dodged by decoys. Invincible still blocks them. Some effects react to Sure Hit specifically (Akhilleus Kosmos)." },
  { term: 'Damage Cut', def: 'Takes this % less damage from attacks and Noble Phantasms. Stacks up to 90%.' },
  { term: 'Invincible', def: 'Takes no damage from anything this turn, Noble Phantasms included.' },
  { term: 'Evade', def: 'Dodges regular attacks. Noble Phantasms still hit, and Sure Hit and Pierce Evade go through it.' },
  { term: 'Guts', def: 'Survives one killing blow and revives.' },
  { term: 'Cleanse', re: 'Cleanses?', def: 'Removes all debuffs.' },
  { term: 'Curse', re: 'Curse[ds]?', def: 'Takes fixed damage at the end of each turn.' },
  { term: 'Poison', re: 'Poison(?:ed|s)?', def: 'Takes fixed damage at the end of each turn. Each Poison is a separate stack.' },
  { term: 'Shocked', def: 'Stunned by electricity: loses the whole next action. Chance-based: it can miss when it is applied.' },
  { term: 'Mistified', def: 'Lost in the prose: loses the whole next action. Chance-based: it can miss when it is applied.' },
  { term: 'Burn', def: 'Takes fixed damage at the end of each turn. Recasting refreshes it instead of stacking.' },
  { term: 'Terror', def: 'A chance not to follow through on a regular attack. Ends once it triggers.' },
  { term: 'Confusion', def: 'A chance that a skill fizzles (its AP is still spent). Ends once it triggers.' },
  { term: 'Taunt', def: 'Next turn the servant can only attack: no skills, no Noble Phantasm.' },
  { term: 'Charm', def: "Next turn, if both servants attack, the charmed servant's card becomes the one that loses the clash." },
  { term: 'Madness', def: 'Next turn the servant takes a random action instead of the one chosen.' },
  { term: 'Blind', re: 'Blind(?:ed)?', def: "Loses the whole next action. Chance-based: it can miss when it's applied." },
  { term: 'Trap', def: 'A chance to lose the whole next action, rolled when that turn resolves.' },
  { term: 'NP Seal', def: 'If the servant fires its Noble Phantasm this turn, it fizzles and the gauge drops.' },
  { term: 'Petrified', def: 'Turned to stone: loses the whole next action, and counts as Petrified that turn. Chance-based: it can miss when it is applied.' },
  { term: 'Dragon', def: 'A mark with no effect on its own. Anti-Dragon effects (Dragon Slayer, Balmung) deal extra damage to it.' },
  { term: 'Power Boost', def: 'Extra damage for each debuff on him: Boost = 10% + 20% × (1 − current HP ÷ max HP). At full HP that is +10% per debuff, rising to +30% per debuff near 0 HP.' },
  { term: 'Crit damage', re: '(?:Buster |Quick |Arts )?[Cc]rit damage', def: 'Crits deal this much more damage, on top of the usual crit multiplier (Quick and Arts 1.5×, Buster 1.75×).' },
  { term: 'Crit chance', re: '(?:Buster |Quick |Arts )?[Cc]rit chance', def: "Changes the chance that a regular attack crits. The base chance comes from the servant's star absorption (20% max)." },
  { term: 'AP gain', def: 'More (or less) AP from each attack, by this %. Fractions carry over to the next attack.' },
  { term: 'Buff Removal Resist', def: "A chance that an enemy's buff removal (Rule Breaker, Information Erasure...) fails outright." },
  { term: 'Command Seal', def: 'Every master starts with 3. Replenish Magical Energy: restores some HP and charges the NP gauge, the moment the master confirms it, on top of the turn\'s action. Any number can be used in one turn.' },
  { term: 'Critical', re: 'Crit(?:ical)?', def: 'Regular attacks (never NPs) can crit. Quick and Arts crits deal 1.5× damage; Quick also gives +1 AP and Arts extra NP charge. Buster crits deal 1.75× damage.' },
  { term: 'Instant Kill', def: "Kills outright when it lands. Revives don't trigger." },
  { term: 'No Boosts', def: 'Deals base damage: ATK up, card effectiveness, NP damage up, flat damage and other boosts (passives too) are ignored. Debuffs still apply.' },
  { term: 'Foresight', def: "See the opponent's locked-in action before choosing. The opponent is told and can't change it that turn." },
  { term: 'resist', re: '(?:Quick|Arts|Buster) resist', def: "Card resist down: takes this % more damage from that card's attacks and Noble Phantasms." },
  { term: 'DEF', def: 'DEF down: takes this % more damage from attacks and Noble Phantasms.' },
];

const BY_MATCH = GLOSSARY.map(g => ({ ...g, rx: new RegExp(`^(?:${g.re ?? g.term})$`) }));
const ALL = new RegExp(`(?<![\\w-])(?:${GLOSSARY.map(g => g.re ?? g.term).join('|')})(?![\\w-])`, 'g');
const attr = t => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function termDef(text) {
  return BY_MATCH.find(g => g.rx.test(text));
}

// Input is already HTML-escaped text; returns HTML with each named effect wrapped.
// Demerits are written [[like this]] in descriptions: drawn in red, and dropped from plain-text tooltips.
export const plainDesc = t => String(t ?? '').replace(/\[\[|\]\]/g, '');
const demerits = html => html.replace(/\[\[/g, '<span class="demerit">').replace(/\]\]/g, '</span>');

export function glossify(html) {
  return demerits(html).replace(ALL, m => {
    const g = termDef(m);
    if (!g) return m;
    const title = g.term === 'resist' ? `${m.split(' ')[0]} resist` : g.term;
    return `<span class="term" tabindex="0" data-tip-title="${attr(title)}" data-tip="${attr(g.def)}">${m}</span>`;
  });
}
