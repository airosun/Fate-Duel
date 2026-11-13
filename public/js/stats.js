// Post-battle stats screen. Reads the per-player tallies the engine keeps in
// match.players[i].stats and the per-turn HP snapshots in match.history.

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const CARDS = [['quick', 'Quick'], ['arts', 'Arts'], ['buster', 'Buster']];
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
export const total = st => st.dmg.attack + st.dmg.np + st.dmg.extra + st.dmg.curse + (st.dmg.poison ?? 0) + (st.dmg.shock ?? 0) + (st.dmg.bleed ?? 0);

// One comparison row: label in the middle, each side's value, and a split bar
// showing who had more (left = player 1, right = player 2).
function row(label, a, b, { va = a, vb = b, hint = '', bar = true } = {}) {
  const sum = a + b;
  const share = sum ? (100 * a) / sum : 50;
  const lead = a === b ? '' : a > b ? 'lead-l' : 'lead-r';
  return `
    <div class="st-row ${lead}" ${hint ? `title="${esc(hint)}"` : ''}>
      <span class="st-v l">${va}</span>
      <span class="st-label">${esc(label)}</span>
      <span class="st-v r">${vb}</span>
      ${bar ? `<div class="st-bar"><i style="width:${share.toFixed(1)}%"></i><b style="width:${(100 - share).toFixed(1)}%"></b></div>` : ''}
    </div>`;
}

function hpChart(match) {
  const hist = match.history ?? [];
  if (!hist.length || !hist[0].hp) return '';
  const max = match.players.map(p => p.maxHp);
  const pts = i => [100, ...hist.map(h => (100 * h.hp[i]) / max[i])];
  const W = 640, H = 170, padL = 34, padB = 22, n = hist.length;
  const x = k => padL + (k / Math.max(1, n)) * (W - padL - 8);
  const y = v => 8 + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - 8 - padB);
  const path = i => pts(i).map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const grid = [0, 50, 100].map(v => `<line x1="${padL}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`).join('');
  const step = n > 20 ? 5 : n > 10 ? 2 : 1;
  const ticks = Array.from({ length: n + 1 }, (_, k) => k).filter(k => k % step === 0 || k === n)
    .map(k => `<text x="${x(k)}" y="${H - 6}" text-anchor="middle">${k}</text>`).join('');
  const end = i => { const v = pts(i).at(-1); return `<circle cx="${x(n)}" cy="${y(v)}" r="4" class="p${i}"/>`; };
  return `
    <section class="st-card st-chart">
      <h3>HP over the battle</h3>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="HP percentage for each servant after every turn">
        ${grid}${ticks}
        <path d="${path(0)}" class="p0"/><path d="${path(1)}" class="p1"/>${end(0)}${end(1)}
      </svg>
      <p class="st-axis">Turn</p>
    </section>`;
}

function procList(st) {
  const items = Object.entries(st.procs ?? {}).filter(([, v]) => v.tries > 0);
  if (!items.length) return '<p class="st-none">No chance-based effects</p>';
  return items.map(([name, v]) => {
    const always = v.hits === v.tries && /copied/.test(name);
    return `<div class="st-proc"><span>${esc(name)}</span><b>${always ? v.hits : `${v.hits} / ${v.tries}`}</b>${always ? '' : `<em>${pct(v.hits, v.tries)}</em>`}</div>`;
  }).join('');
}

export function statsHtml(match, { masterLabel, art }) {
  const [A, B] = match.players.map(p => p.stats);
  if (!A || !B) return '<p class="muted">No stats recorded for this match.</p>';
  const S = match.servants;
  const turns = (match.history ?? []).length;
  const dmgRow = (label, k, hint) => row(label, A.dmg[k], B.dmg[k], { hint });
  const landed = st => CARDS.reduce((a, [c]) => a + st.landed[c], 0);
  const tried = st => CARDS.reduce((a, [c]) => a + st.attempted[c], 0);
  const frac = (st, c) => `${st.landed[c]}<small> / ${st.attempted[c]}</small>`;
  const head = i => `
    <div class="st-head p${i}">
      ${art(S[i], 'st-art')}
      <div><b>${esc(S[i].name)}</b><span>${esc(masterLabel(i))}</span></div>
    </div>`;
  const tA = total(A), tB = total(B);
  return `
    <div class="stats-screen">
      <div class="st-heads">${head(0)}<div class="st-vs">${turns} turn${turns === 1 ? '' : 's'}</div>${head(1)}</div>

      <section class="st-card">
        <h3>Damage</h3>
        ${row('Total damage dealt', tA, tB, { va: `<strong>${tA}</strong>`, vb: `<strong>${tB}</strong>` })}
        ${dmgRow('From regular attacks', 'attack')}
        ${dmgRow('From Noble Phantasms', 'np')}
        ${A.dmg.extra || B.dmg.extra ? dmgRow('From follow-up hits', 'extra', 'Sea Demons and similar extra hits') : ''}
        ${A.dmg.curse || B.dmg.curse ? dmgRow('From Curse', 'curse', 'Damage over time from Curse') : ''}
        ${A.dmg.poison || B.dmg.poison ? dmgRow('From Poison', 'poison', 'Damage over time from Poison stacks') : ''}
        ${A.dmg.shock || B.dmg.shock ? dmgRow('From Shock', 'shock', 'Damage over time from Shock stacks') : ''}
        ${A.dmg.bleed || B.dmg.bleed ? dmgRow('From Bleed', 'bleed', 'Damage over time from Bleed stacks') : ''}
        ${row('Biggest single hit', A.biggest.amount, B.biggest.amount, {
          va: A.biggest.amount ? `${A.biggest.amount}<small>${esc(A.biggest.what)}</small>` : '—',
          vb: B.biggest.amount ? `${B.biggest.amount}<small>${esc(B.biggest.what)}</small>` : '—' })}
        ${row('Average damage per turn', tA / Math.max(1, turns), tB / Math.max(1, turns), {
          va: Math.round(tA / Math.max(1, turns)), vb: Math.round(tB / Math.max(1, turns)) })}
        ${row('HP healed', A.healed, B.healed)}
      </section>

      <section class="st-card">
        <h3>Attacks</h3>
        ${row('Hits landed', landed(A), landed(B), { va: `${landed(A)}<small> / ${tried(A)} (${pct(landed(A), tried(A))})</small>`, vb: `${landed(B)}<small> / ${tried(B)} (${pct(landed(B), tried(B))})</small>`, hint: 'Regular attacks that dealt damage, out of all regular attacks chosen' })}
        ${CARDS.map(([c, name]) => row(`${name} hits`, A.landed[c], B.landed[c], { va: frac(A, c), vb: frac(B, c) })).join('')}
        ${row('Clashes won', A.clash.won, B.clash.won, { hint: 'Your card beat theirs (a counter hit)' })}
        ${row('Clashes lost', A.clash.lost, B.clash.lost, { bar: false, hint: 'Your card was beaten, or an NP overpowered your attack' })}
        ${row('Ties', A.clash.tied, B.clash.tied, { bar: false })}
        ${row('Critical hits', A.crits ?? 0, B.crits ?? 0, { hint: 'Regular attacks that crit' })}
        ${row('Longest hit streak', A.maxCombo, B.maxCombo, { hint: 'Most regular attacks landed in a row' })}
      </section>

      <section class="st-card">
        <h3>Noble Phantasms &amp; actions</h3>
        ${row('NPs landed', A.nps.landed, B.nps.landed, { va: `${A.nps.landed}<small> / ${A.nps.fired} fired</small>`, vb: `${B.nps.landed}<small> / ${B.nps.fired} fired</small>` })}
        ${row('Enemy hits negated', A.negated, B.negated, { hint: 'Enemy attacks and NPs stopped by Evade or Invincible' })}
        ${row('Skills used', A.skills, B.skills)}
        ${row('Command Seals used', A.seals, B.seals)}
        ${A.revives || B.revives ? row('Revives', A.revives, B.revives) : ''}
      </section>

      <section class="st-card st-procs">
        <h3>Chance effects</h3>
        <div class="st-proc-cols">
          <div><h4 class="p0">${esc(S[0].name)}</h4>${procList(A)}</div>
          <div><h4 class="p1">${esc(S[1].name)}</h4>${procList(B)}</div>
        </div>
      </section>

      ${hpChart(match)}
    </div>`;
}
