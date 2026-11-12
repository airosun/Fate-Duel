// Builds reports/roster.html: every servant's full kit, generated from
// src/data/servants.js so the page always matches the game.
// Usage: node tools/roster-page.js
import { writeFileSync, mkdirSync } from 'node:fs';
import { ROSTER } from '../src/data/servants.js';
import { deriveStats } from '../src/engine/engine.js';
import { TUNING as T } from '../src/engine/constants.js';
import { glossify } from '../public/js/glossary.js';
// glossary terms get a hover definition (title attribute) on the static page
const gl = t => glossify(t).replace(/data-tip="/g, 'title="').replace(/ data-tip-title="[^"]*"/g, '');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CARD = { quick: 'Quick', arts: 'Arts', buster: 'Buster' };
const CLASS_ORDER = ['Saber', 'Archer', 'Lancer', 'Rider', 'Caster', 'Assassin', 'Berserker', 'Ruler', 'Avenger'];
const chip = card => `<span class="card ${card}">${CARD[card]}</span>`;
const npGain = (v, ref) => (v ? Math.sqrt(v / ref) : 1).toFixed(2);

function maxAp(s) {
  const bonus = (s.passives ?? []).flatMap(p => p.effects).filter(e => e.type === 'maxApUp').reduce((a, e) => a + e.value, 0);
  return (s.maxAp ?? T.defaultMaxAp) + bonus;
}
const favoredAll = s => (s.passives ?? []).some(p => p.effects.some(e => e.type === 'affinityAll'));

function npHtml(np) {
  if (np.modes) {
    return `<div class="np">
      <div class="np-head"><span class="label">Noble Phantasm</span><h4>${esc(np.name)}</h4><span class="card modes">Modes</span></div>
      <ul class="modes-list">${Object.entries(np.modes).map(([id, m]) => `
        <li><span class="mode-name">${esc(m.label)}${id === np.defaultMode ? ' <em>(default)</em>' : ''}</span>${chip(m.card)}<span class="mult">${m.mult}×</span><span>${gl(esc(m.desc ?? ''))}</span></li>`).join('')}
      </ul></div>`;
  }
  return `<div class="np">
    <div class="np-head"><span class="label">Noble Phantasm</span><h4>${esc(np.name)}</h4>${chip(np.card)}<span class="mult">${np.mult}×</span></div>
    <p>${gl(esc(np.desc ?? ''))}${np.ignoreDefense ? ' Ignores Damage Cut and Evade.' : ''}</p></div>`;
}

function servantHtml(s) {
  const { hp, atk, crit } = deriveStats(s);
  const initials = s.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('');
  const passives = s.passives ?? [];
  return `
  <article class="servant" id="${esc(s.id)}" data-class="${esc(s.class)}">
    <header>
      <div class="badge" aria-hidden="true">${esc(initials)}</div>
      <div class="title"><span class="cls">${esc(s.class)}</span><h3>${esc(s.name)}</h3></div>
    </header>
    <dl class="stats">
      <div><dt>HP</dt><dd>${hp.toLocaleString('en-US')}${s.hpMult ? `<small>×${s.hpMult}</small>` : ''}</dd></div>
      <div><dt>ATK</dt><dd>${atk}</dd></div>
      <div><dt>Max AP</dt><dd>${maxAp(s)}</dd></div>
      <div><dt>Crit</dt><dd>${crit}%</dd></div>
      <div class="wide"><dt>NP gain</dt><dd>${npGain(s.fgoNpAtk, T.refFgoNpAtk)}× <small>atk</small> · ${npGain(s.fgoNpDef, T.refFgoNpDef)}× <small>def</small></dd></div>
      <div><dt>Favored</dt><dd>${favoredAll(s) ? '<span class="card all">All</span>' : chip(s.favoredCard)}</dd></div>
    </dl>
    <section>
      <h5>Passives</h5>
      <ul class="rows">${passives.map(p => `
        <li><span class="name">${esc(p.name)}${p.kind === 'unique' ? '<span class="tag">Unique</span>' : ''}</span><span>${gl(esc(p.desc ?? ''))}</span></li>`).join('')}
      </ul>
    </section>
    <section>
      <h5>Skills</h5>
      <ul class="rows">${s.skills.map(sk => `
        <li><span class="name">${esc(sk.name)}<span class="ap">${sk.cost} AP${sk.costStep ? ` +${sk.costStep}/use` : ''}</span></span><span>${gl(esc(sk.desc ?? ''))}${sk.costStep ? `. Costs ${sk.costStep} more AP each time it's used` : ''}${sk.options ? ` <em>Options: ${sk.options.map(o => esc(o.label)).join(' / ')}</em>` : ''}</span></li>`).join('')}
      </ul>
    </section>
    ${npHtml(s.np)}
    <p class="fgo">FGO stats: ${s.fgoHp?.toLocaleString('en-US') ?? '—'} HP · ${s.fgoAtk?.toLocaleString('en-US') ?? '—'} ATK · NP ${s.fgoNpAtk ?? '—'}% / ${s.fgoNpDef ?? '—'}%</p>
  </article>`;
}

const classes = CLASS_ORDER.filter(c => ROSTER.some(s => s.class === c));
const date = new Date().toISOString().slice(0, 10);
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fate/Duel Roster</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Noto+Sans:wght@400;600;700&display=swap">
<style>
:root {
  /* Single-theme: the game's own night-sky navy with gold trim. Layout: filter bar, then a responsive grid of kit cards. */
  --bg: #090d22; --panel: #121a3d; --panel-2: #19224b; --ink: #ece8f6; --muted: #a2a9cc;
  --gold: #d8b25a; --gold-2: #f3dc93; --line: rgba(216,178,90,.28);
  --quick: #2fbf71; --arts: #3d7fe6; --buster: #e2463a;
  --display: 'Cinzel', 'Times New Roman', serif; --body: 'Noto Sans', system-ui, sans-serif;
  color-scheme: dark;
}
[data-class="Saber"] { --cls: #3a74c9; } [data-class="Archer"] { --cls: #c9453a; } [data-class="Lancer"] { --cls: #2c9c8a; }
[data-class="Rider"] { --cls: #c98b2c; } [data-class="Caster"] { --cls: #7b4cc9; } [data-class="Assassin"] { --cls: #5d6380; }
[data-class="Berserker"] { --cls: #9c2c4f; }
.term { text-decoration: underline dotted; text-underline-offset: 2px; cursor: help; }
[data-class="Ruler"] { --cls: #b8963a; }
[data-class="Avenger"] { --cls: #3d2350; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 var(--body); }
.wrap { max-width: 1280px; margin: 0 auto; padding: 28px clamp(16px, 3vw, 32px) 48px; display: flex; flex-direction: column; gap: 20px; }
h1 { font-family: var(--display); font-weight: 800; color: var(--gold-2); letter-spacing: .06em; margin: 0; font-size: clamp(1.8rem, 4vw, 2.6rem); text-wrap: balance; }
h1 span { color: var(--gold); font-weight: 600; }
.intro { color: var(--muted); margin: 4px 0 0; max-width: 70ch; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; }
.filters button { font: 600 .82rem var(--body); color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 99px; padding: 6px 14px; cursor: pointer; }
.filters button[aria-pressed="true"] { background: var(--gold); color: #1c1405; border-color: var(--gold); }
.filters button:focus-visible { outline: 2px solid var(--gold-2); outline-offset: 2px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr)); gap: 18px; align-items: start; }
.servant { background: var(--panel); border: 1px solid var(--line); border-top: 4px solid var(--cls); border-radius: 10px; padding: 18px; display: flex; flex-direction: column; gap: 14px; }
.servant[hidden] { display: none; }
.servant header { display: flex; align-items: center; gap: 12px; }
.badge { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; font: 800 1.05rem var(--display); color: #fff; background: radial-gradient(circle at 40% 35%, var(--cls), #0b0f24 90%); border: 1px solid var(--line); flex: none; }
.cls { font-size: .7rem; letter-spacing: .2em; text-transform: uppercase; color: var(--muted); }
h3 { font-family: var(--display); font-weight: 800; font-size: 1.3rem; color: var(--gold-2); margin: 0; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 8px; margin: 0; }
.stats div { background: var(--panel-2); border-radius: 6px; padding: 6px 8px; }
.stats .wide { grid-column: span 2; }
dt { font-size: .66rem; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
dd { margin: 0; font-weight: 700; font-variant-numeric: tabular-nums; }
dd small { color: var(--muted); font-weight: 400; margin-left: 3px; }
h5 { font-size: .72rem; letter-spacing: .2em; text-transform: uppercase; color: var(--gold); margin: 0 0 6px; }
.rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
.rows li { display: flex; flex-direction: column; gap: 2px; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
.rows li:last-child { border-bottom: 0; }
.rows .name { font-weight: 700; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rows li > span:last-child { color: #d3cfe3; font-size: .9rem; }
.rows em { color: var(--muted); font-style: normal; }
.tag { font-size: .62rem; letter-spacing: .12em; text-transform: uppercase; background: var(--gold); color: #1c1405; border-radius: 3px; padding: 1px 6px; }
.ap { font-size: .72rem; font-weight: 700; color: #9ed0ff; border: 1px solid rgba(158,208,255,.4); border-radius: 4px; padding: 0 6px; }
.card { font-size: .72rem; font-weight: 700; color: #fff; border-radius: 4px; padding: 1px 7px; }
.card.quick { background: var(--quick); } .card.arts { background: var(--arts); } .card.buster { background: var(--buster); }
.card.all, .card.modes { background: linear-gradient(90deg, var(--quick), var(--arts), var(--buster)); }
.np { background: linear-gradient(160deg, rgba(216,178,90,.14), rgba(216,178,90,.03)); border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
.np-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.np .label { width: 100%; font-size: .66rem; letter-spacing: .2em; text-transform: uppercase; color: var(--gold); }
.np h4 { font-family: var(--display); font-size: 1.05rem; color: var(--gold-2); margin: 0; }
.mult { font-weight: 700; font-variant-numeric: tabular-nums; }
.np p { margin: 6px 0 0; color: #d3cfe3; font-size: .9rem; }
.modes-list { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-direction: column; gap: 6px; font-size: .9rem; }
.modes-list li { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; color: #d3cfe3; }
.mode-name { font-weight: 700; color: var(--ink); }
.mode-name em { color: var(--muted); font-style: normal; font-weight: 400; }
.fgo { margin: 0; font-size: .75rem; color: var(--muted); }
footer { color: var(--muted); font-size: .8rem; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Fate<span>/</span>Duel Roster</h1>
    <p class="intro">${ROSTER.length} servants and their complete kits, generated from the game's own data. HP and ATK are the in-game values; NP gain is relative to an average servant (1.00×).</p>
  </header>
  <nav class="filters" aria-label="Filter by class">
    <button type="button" data-filter="all" aria-pressed="true">All (${ROSTER.length})</button>
    ${classes.map(c => `<button type="button" data-filter="${c}" aria-pressed="false">${c} (${ROSTER.filter(s => s.class === c).length})</button>`).join('\n    ')}
  </nav>
  <main class="grid">
${ROSTER.map(servantHtml).join('\n')}
  </main>
  <footer>Generated from src/data/servants.js on ${date}. Kits are rebuilt whenever a servant is added or rebalanced.</footer>
</div>
<script>
  const buttons = document.querySelectorAll('.filters button');
  buttons.forEach(b => b.addEventListener('click', () => {
    buttons.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('.servant').forEach(s => { s.hidden = b.dataset.filter !== 'all' && s.dataset.class !== b.dataset.filter; });
  }));
</script>
</body>
</html>
`;
mkdirSync('reports', { recursive: true });
writeFileSync('reports/roster.html', html);
console.log(`Wrote reports/roster.html (${ROSTER.length} servants)`);
