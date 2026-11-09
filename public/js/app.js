// Fate Duel — local hotseat client (both masters share one screen).
// The engine runs in the browser; online play will swap this for the server.

import { createMatch, getLegalActions, resolveTurn, validateAction, deriveStats } from '/src/engine/engine.js';
import { ROSTER } from '/src/data/servants.js';
import { TUNING as T, CARDS } from '/src/engine/constants.js';
import { CARD_LABEL, describeSkill, describeNp, describeEffects, buffChip } from './describe.js';

const app = document.getElementById('app');
const overlay = document.getElementById('overlay');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MASTER = i => `Master ${i + 1}`;

// ---------- art (drop files into public/art/<id>.png|jpg|webp) ----------

const ART_EXTS = ['png', 'jpg', 'webp'];
const artCache = {}; // id -> resolved url | 'missing'
window.__artLoaded = img => { artCache[img.dataset.id] = img.getAttribute('src'); };
window.__artFallback = img => {
  const n = Number(img.dataset.try) + 1;
  if (!img.dataset.custom && n < ART_EXTS.length) {
    img.dataset.try = n;
    img.src = `/art/${img.dataset.id}.${ART_EXTS[n]}`;
  } else {
    artCache[img.dataset.id] = 'missing';
    img.remove();
  }
};
function art(servant, cls = '') {
  const cached = artCache[servant.id];
  const custom = servant.art ? 'data-custom="1"' : '';
  const src = cached && cached !== 'missing' ? cached : (servant.art ?? `/art/${servant.id}.png`);
  const initials = servant.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('');
  const img = cached === 'missing' ? '' :
    `<img src="${esc(src)}" alt="" data-id="${esc(servant.id)}" data-try="0" ${custom} onload="__artLoaded(this)" onerror="__artFallback(this)">`;
  return `<div class="art ${cls}" data-class="${esc(servant.class)}">
      <div class="art-fallback"><span>${esc(initials)}</span><small>${esc(servant.class)}</small></div>
      ${img}
    </div>`;
}

// ---------- ui state ----------

const ui = {
  screen: 'title',          // title | select | battle | end
  selecting: 0,             // which master is picking a servant
  focus: null,              // servant id shown in the select detail panel
  picks: [null, null],      // servant ids
  match: null,
  active: 0,                // master currently choosing an action
  draft: { main: null, seal: null },
  locked: [null, null],
  bars: {},                 // last shown % per bar, for animation
  logOpen: true,
};

function show(screen) { ui.screen = screen; render(); }

function render() {
  overlay.hidden = true;
  overlay.innerHTML = '';
  ({ title: renderTitle, select: renderSelect, battle: renderBattle, end: renderEnd })[ui.screen]();
  animateBars();
}

// ---------- overlay helpers ----------

function openOverlay(html, onReady) {
  overlay.innerHTML = `<div class="overlay-card">${html}</div>`;
  overlay.hidden = false;
  onReady?.(overlay);
}

function passScreen(i, text, next) {
  openOverlay(`
    <div class="pass">
      <div class="seal-mark big"></div>
      <h2>${MASTER(i)}</h2>
      <p>${esc(text)}</p>
      <p class="hint">${MASTER(1 - i)}, look away from the screen.</p>
      <button class="btn gold" id="ready">I'm ready</button>
    </div>`, o => o.querySelector('#ready').onclick = next);
}

// ---------- title ----------

function renderTitle() {
  app.innerHTML = `
    <div class="title-screen">
      <div class="title-emblem"></div>
      <h1>FATE <span>DUEL</span></h1>
      <p class="tag">Servant versus Servant · Master versus Master</p>
      <div class="title-actions">
        <button class="btn gold big" id="local">Local Duel</button>
        <button class="btn ghost big" disabled title="Coming in Phase 4">Online Duel <small>soon</small></button>
      </div>
      ${rulesHtml()}
    </div>`;
  app.querySelector('#local').onclick = () => {
    ui.picks = [null, null]; ui.selecting = 0; ui.focus = ROSTER[0].id;
    show('select');
  };
}

function rulesHtml() {
  return `
    <details class="rules">
      <summary>How to play</summary>
      <div class="rules-body">
        <div class="triangle">
          <span class="card-chip quick">Quick</span> beats <span class="card-chip arts">Arts</span> beats
          <span class="card-chip buster">Buster</span> beats <span class="card-chip quick">Quick</span>
        </div>
        <ul>
          <li>Each turn both Masters secretly pick <b>one action</b>: an attack card, a skill, or their Noble Phantasm.</li>
          <li>Clash winner hits with a <b>+${T.counterBonus * 100}% counter</b>; the loser whiffs. Ties trade blows.</li>
          <li><b>Buster</b> hits hardest · <b>Arts</b> charges NP · <b>Quick</b> restores AP.</li>
          <li>Skills cost AP and resolve first. The same skill can't be used two turns in a row.</li>
          <li>A full NP gauge unleashes a Noble Phantasm, which beats every regular attack.</li>
          <li>Command Seals (3 per match) are free extra actions: heal, recharge AP, empower, or all three to fill the NP gauge.</li>
          <li>Reduce the enemy Servant to 0 HP. Double KO or reaching turn ${T.maxTurns} is a draw.</li>
        </ul>
      </div>
    </details>`;
}

// ---------- servant select ----------

function statLine(s) {
  const { hp, atk } = deriveStats(s);
  return { hp, atk };
}

function kitHtml(s) {
  const { hp, atk } = statLine(s);
  const passives = s.passives ?? (s.passive ? [s.passive] : []);
  return `
    <div class="kit">
      <div class="kit-head">
        <h2>${esc(s.name)}</h2>
        <span class="class-badge" data-class="${esc(s.class)}">${esc(s.class)}</span>
      </div>
      <div class="kit-stats">
        <div><label>HP</label><b>${hp}</b></div>
        <div><label>ATK</label><b>${atk}</b></div>
        <div><label>Max AP</label><b>${s.maxAp ?? T.defaultMaxAp}</b></div>
        <div><label>Favored</label><b class="card-chip ${s.favoredCard}">${CARD_LABEL[s.favoredCard] ?? '—'}</b></div>
      </div>
      ${passives.length ? `<h3>Passives</h3>${passives.map(p => `
        <div class="kit-row"><b>${esc(p.name)}${p.kind === 'unique' ? ' <em class="unique-tag">Unique</em>' : ''}</b><span>${esc(p.desc ?? describeEffects(p.effects))}</span></div>`).join('')}` : ''}
      <h3>Skills</h3>
      ${s.skills.map(sk => `
        <div class="kit-row"><b>${esc(sk.name)} <em class="ap-cost">${sk.cost} AP</em></b><span>${esc(describeSkill(sk))}</span></div>`).join('')}
      <h3>Noble Phantasm</h3>
      <div class="kit-row np-row"><b>${esc(s.np.name)} <span class="card-chip ${s.np.card}">${CARD_LABEL[s.np.card]}</span></b>
        <span>${esc(describeNp(s.np))}</span></div>
    </div>`;
}

function renderSelect() {
  const i = ui.selecting;
  const focus = ROSTER.find(s => s.id === ui.focus) ?? ROSTER[0];
  app.innerHTML = `
    <div class="select-screen">
      <header class="screen-head">
        <button class="btn ghost small" id="back">← Back</button>
        <h1>${MASTER(i)} <span>— Summon your Servant</span></h1>
        <div></div>
      </header>
      <div class="select-body">
        <div class="roster">
          ${ROSTER.map(s => `
            <button class="roster-card ${s.id === focus.id ? 'focused' : ''}" data-id="${s.id}">
              ${art(s, 'portrait')}
              <div class="roster-name">${esc(s.name)}</div>
            </button>`).join('')}
        </div>
        <aside class="detail">
          ${art(focus, 'detail-art')}
          ${kitHtml(focus)}
          <button class="btn gold big" id="confirm">Summon ${esc(focus.name.split(' ')[0])}</button>
        </aside>
      </div>
    </div>`;
  app.querySelectorAll('.roster-card').forEach(b => b.onclick = () => { ui.focus = b.dataset.id; render(); });
  app.querySelector('#back').onclick = () => show('title');
  app.querySelector('#confirm').onclick = () => {
    ui.picks[i] = focus.id;
    if (i === 0) {
      ui.selecting = 1; ui.focus = ROSTER[0].id;
      show('select');
      passScreen(1, 'Choose your Servant. Your opponent\'s pick stays hidden until the duel begins.', () => render());
    } else startMatch();
  };
}

// ---------- battle ----------

const byId = id => ROSTER.find(s => s.id === id);

function startMatch() {
  ui.match = createMatch(byId(ui.picks[0]), byId(ui.picks[1]));
  ui.bars = {};
  ui.locked = [null, null];
  ui.history = [];
  beginTurn(0, true);
}

function beginTurn(i, first = false) {
  ui.active = i;
  ui.draft = { main: null, seal: null };
  show('battle');
  const msg = first && i === 0 ? 'The Holy Grail War begins. Choose your first action.' : `Turn ${ui.match.turn}: choose your action.`;
  passScreen(i, msg, () => { overlay.hidden = true; });
}

function bar(key, pct, cls, label) {
  const from = ui.bars[key] ?? pct;
  ui.bars[key] = pct;
  return `<div class="bar ${cls}"><div class="fill" style="width:${from}%" data-target="${pct}%"></div><span>${label}</span></div>`;
}

function animateBars() {
  requestAnimationFrame(() => requestAnimationFrame(() =>
    document.querySelectorAll('.fill[data-target]').forEach(el => { el.style.width = el.dataset.target; })));
}

function panelHtml(i) {
  const m = ui.match, p = m.players[i], s = m.servants[i];
  const hpPct = Math.max(0, (p.hp / p.maxHp) * 100);
  const npFull = p.np >= T.npMax;
  const buffs = p.buffs.map(buffChip);
  return `
    <section class="panel ${ui.active === i ? 'active' : ''} side-${i}">
      ${art(s, 'battle-art')}
      <div class="panel-info">
        <div class="panel-head">
          <span class="master-tag">${MASTER(i)}</span>
          <h2>${esc(s.name)}</h2>
          <span class="class-badge" data-class="${esc(s.class)}">${esc(s.class)}</span>
          ${ui.locked[i] ? '<span class="locked-tag">LOCKED IN</span>' : ''}
        </div>
        ${bar(`hp${i}`, hpPct, hpPct < 25 ? 'hp low' : 'hp', `${p.hp} / ${p.maxHp}`)}
        <div class="np-line">
          <label>NP</label>
          ${bar(`np${i}`, p.np, `np ${npFull ? 'full' : ''}`, `${p.np}%`)}
        </div>
        <div class="resource-line">
          <div class="ap" title="AP ${p.ap}/${p.maxAp}">
            <label>AP</label>
            ${Array.from({ length: p.maxAp }, (_, k) => `<i class="${k < p.ap ? 'on' : ''}"></i>`).join('')}
            <b>${p.ap}</b>
          </div>
          <div class="seals" title="Command Seals: ${p.seals}">
            ${Array.from({ length: T.seals.count }, (_, k) => `<i class="seal-mark ${k < p.seals ? '' : 'spent'}"></i>`).join('')}
          </div>
        </div>
        <div class="buffs">
          ${p.empower ? '<span class="buff empower">Empowered</span>' : ''}
          ${buffs.map(b => `<span class="buff ${b.debuff ? 'debuff' : ''} ${b.passive ? 'passive' : ''}">${esc(b.label)}${b.turns}</span>`).join('')}
        </div>
      </div>
    </section>`;
}

function actionLabel(servant, action) {
  const m = action.main;
  if (m.type === 'attack') return `${CARD_LABEL[m.card]} attack`;
  if (m.type === 'skill') return servant.skills.find(s => s.id === m.skillId)?.name ?? m.skillId;
  return servant.np.name;
}

const SEAL_INFO = {
  heal: { name: 'Heal', desc: `Restore ${T.seals.healPct}% HP`, cost: 1 },
  recharge: { name: 'Recharge', desc: `+${T.seals.rechargeAp} AP`, cost: 1 },
  empower: { name: 'Empower', desc: `Next attack +${T.seals.empowerBonus * 100}%, wins ties`, cost: 1 },
  grandOrder: { name: 'Grand Order', desc: 'Spend all 3: fill NP gauge', cost: 3 },
};

function controlsHtml() {
  const i = ui.active, m = ui.match, p = m.players[i], s = m.servants[i];
  const legal = getLegalActions(m, i);
  const d = ui.draft;
  const sel = (type, key) => d.main && d.main.type === type && (key === undefined || d.main.card === key || d.main.skillId === key);
  const conv = p.buffs.some(b => b.type === 'busterConvert');
  const perk = { quick: `+${T.apPerAttack + T.cards.quick.apBonus} AP`, arts: `NP +${T.cards.arts.npGain}%`, buster: `${T.cards.buster.mult}× DMG` };

  return `
    <section class="controls">
      <div class="controls-head">
        <h3>${MASTER(i)} <span>· ${esc(s.name)}</span></h3>
        <span class="turn-tag">Turn ${m.turn}</span>
      </div>
      <div class="action-rows">
        <div class="cards">
          ${CARDS.map(c => `
            <button class="cmd-card ${c} ${sel('attack', c) ? 'selected' : ''}" data-card="${c}" title="Key: ${c[0].toUpperCase()}">
              ${art(s, 'card-art')}
              <div class="cmd-frame">
                <span class="cmd-name">${CARD_LABEL[c]}</span>
                <span class="cmd-perk">${perk[c]}</span>
                ${s.favoredCard === c ? '<span class="cmd-fav" title="Favored card">★</span>' : ''}
                ${conv && c !== 'buster' ? '<span class="cmd-conv">hits as Buster</span>' : ''}
              </div>
            </button>`).join('')}
          <button class="np-card ${legal.np ? 'ready' : ''} ${sel('np') ? 'selected' : ''}" id="np" ${legal.np ? '' : 'disabled'}>
            <span class="np-label">Noble Phantasm</span>
            <b>${esc(s.np.name)}</b>
            <small>${legal.np ? esc(describeNp(s.np)) : `Gauge ${p.np}%`}</small>
          </button>
        </div>
        <div class="skills">
          ${s.skills.map((sk, k) => {
            const ok = legal.skills.includes(sk.id);
            const why = p.lastSkillId === sk.id ? 'Used last turn' : (p.ap < sk.cost ? `Needs ${sk.cost} AP` : '');
            return `<button class="skill ${sel('skill', sk.id) ? 'selected' : ''}" data-skill="${sk.id}" ${ok ? '' : 'disabled'} title="Key: ${k + 1}">
              <span class="skill-top"><b>${esc(sk.name)}</b><em class="ap-cost">${sk.cost} AP</em></span>
              <small>${esc(why || describeSkill(sk))}</small>
            </button>`;
          }).join('')}
        </div>
        <div class="seal-row">
          <label>Command Seal <small>(free action)</small></label>
          ${Object.entries(SEAL_INFO).map(([k, v]) => `
            <button class="seal-btn ${d.seal === k ? 'selected' : ''}" data-seal="${k}" ${legal.seals.includes(k) ? '' : 'disabled'} title="${esc(v.desc)}">
              ${'<i class="seal-mark"></i>'.repeat(v.cost)} ${v.name}
            </button>`).join('')}
        </div>
      </div>
      <div class="lock-row">
        <span class="draft">${d.main ? `${esc(actionLabel(s, d))}${d.seal ? ` + ${SEAL_INFO[d.seal].name}` : ''}` : 'Choose an action'}</span>
        <span class="error" id="err"></span>
        <button class="btn gold" id="lock" ${d.main ? '' : 'disabled'}>Lock in ⏎</button>
      </div>
    </section>`;
}

function logHtml() {
  const turns = [...(ui.history ?? [])].reverse();
  return `
    <section class="log ${ui.logOpen ? '' : 'collapsed'}">
      <button class="log-toggle" id="logToggle">Battle log ${ui.logOpen ? '▾' : '▸'}</button>
      <div class="log-body">
        ${turns.length ? turns.map(t => `
          <div class="log-turn"><h4>Turn ${t.turn}</h4>${t.log.map(l => `<p class="log-${l.type}">${esc(l.msg)}</p>`).join('')}</div>`).join('')
          : '<p class="muted">No actions yet.</p>'}
      </div>
    </section>`;
}

function renderBattle() {
  app.innerHTML = `
    <div class="battle">
      <div class="field">
        ${panelHtml(0)}
        <div class="versus">VS</div>
        ${panelHtml(1)}
      </div>
      <div class="lower">
        ${ui.active >= 0 ? controlsHtml() : '<section class="controls resolving"><p>Resolving the clash…</p></section>'}
        ${logHtml()}
      </div>
    </div>`;
  bindControls();
}

function setDraft(patch) {
  Object.assign(ui.draft, patch);
  const scroll = window.scrollY;
  render();
  overlay.hidden = true;
  window.scrollTo(0, scroll);
}

function bindControls() {
  const $ = sel => app.querySelectorAll(sel);
  $('.cmd-card').forEach(b => b.onclick = () => setDraft({ main: { type: 'attack', card: b.dataset.card } }));
  $('.skill').forEach(b => b.onclick = () => setDraft({ main: { type: 'skill', skillId: b.dataset.skill } }));
  const np = app.querySelector('#np');
  if (np) np.onclick = () => setDraft({ main: { type: 'np' } });
  $('.seal-btn').forEach(b => b.onclick = () => setDraft({ seal: ui.draft.seal === b.dataset.seal ? null : b.dataset.seal }));
  const lock = app.querySelector('#lock');
  if (lock) lock.onclick = lockIn;
  app.querySelector('#logToggle').onclick = () => { ui.logOpen = !ui.logOpen; setDraft({}); };
}

function lockIn() {
  const i = ui.active;
  const action = { main: ui.draft.main, seal: ui.draft.seal };
  const err = validateAction(ui.match, i, action);
  if (err) { app.querySelector('#err').textContent = err; return; }
  ui.locked[i] = action;
  if (i === 0) beginTurn(1);
  else resolve();
}

// ---------- reveal ----------

function clashBanner(actions) {
  const [a, b] = actions.map(x => x.main);
  const names = ui.match.servants.map(s => s.name);
  if (a.type === 'np' && b.type === 'np') return { text: 'Noble Phantasms collide!', cls: 'np' };
  if (a.type === 'np' || b.type === 'np') return { text: `${names[a.type === 'np' ? 0 : 1]} unleashes their Noble Phantasm!`, cls: 'np' };
  if (a.type === 'attack' && b.type === 'attack') {
    if (a.card === b.card) return { text: `${CARD_LABEL[a.card]} clash. Both strike!`, cls: a.card };
    const w = T.beats[a.card] === b.card ? 0 : 1;
    const wc = w === 0 ? a.card : b.card, lc = w === 0 ? b.card : a.card;
    return { text: `${CARD_LABEL[wc]} beats ${CARD_LABEL[lc]}: ${names[w]} counters!`, cls: wc };
  }
  if (a.type === 'skill' && b.type === 'skill') return { text: 'Both Servants prepare…', cls: 'skill' };
  const atk = a.type === 'attack' ? 0 : 1;
  return { text: `${names[atk]} strikes unopposed!`, cls: [a, b][atk].card };
}

function revealSide(i, action) {
  const s = ui.match.servants[i];
  const m = action.main;
  const kind = m.type === 'attack' ? m.card : m.type;
  return `
    <div class="reveal-side">
      <span class="master-tag">${MASTER(i)}</span>
      <div class="reveal-card ${kind}">
        ${art(s, 'card-art')}
        <div class="cmd-frame"><span class="cmd-name">${esc(actionLabel(s, action))}</span>
          <span class="cmd-perk">${m.type === 'skill' ? 'Skill' : m.type === 'np' ? 'Noble Phantasm' : 'Attack'}</span></div>
      </div>
      ${action.seal ? `<div class="reveal-seal"><i class="seal-mark"></i> ${SEAL_INFO[action.seal].name}</div>` : '<div class="reveal-seal none">No seal</div>'}
    </div>`;
}

function resolve() {
  const actions = ui.locked;
  const turn = ui.match.turn;
  const { state, log } = resolveTurn(ui.match, actions);
  ui.match = state;
  ui.history.push({ turn, log });
  ui.locked = [null, null];
  ui.active = -1;
  show('battle');
  const banner = clashBanner(actions);
  openOverlay(`
    <div class="reveal">
      <h4>Turn ${turn}</h4>
      <div class="reveal-row">${revealSide(0, actions[0])}<div class="versus">VS</div>${revealSide(1, actions[1])}</div>
      <div class="clash-banner ${banner.cls}">${esc(banner.text)}</div>
      <div class="reveal-log">${log.map((l, k) => `<p class="log-${l.type}" style="animation-delay:${0.25 + k * 0.35}s">${esc(l.msg)}</p>`).join('')}</div>
      <button class="btn gold" id="cont">${state.over ? 'See result' : 'Continue'}</button>
    </div>`, o => o.querySelector('#cont').onclick = () => state.over ? show('end') : beginTurn(0));
}

// ---------- end ----------

function renderEnd() {
  const m = ui.match;
  const { winner, reason } = m.result;
  const draw = winner === null;
  const s = draw ? null : m.servants[winner];
  app.innerHTML = `
    <div class="end-screen ${draw ? 'draw' : ''}">
      ${draw ? `<div class="end-pair">${art(m.servants[0], 'end-art')}${art(m.servants[1], 'end-art')}</div>` : art(s, 'end-art winner')}
      <h1>${draw ? 'Stalemate' : 'Victory'}</h1>
      <p class="tag">${draw
        ? (reason === 'double KO' ? 'Both Servants fall. Both Masters survive to fight again.' : `The battle reaches turn ${T.maxTurns} without a victor.`)
        : `${MASTER(winner)} and ${esc(s.name)} claim the Grail. (${m.turn - 1} turns)`}</p>
      <div class="title-actions">
        <button class="btn gold big" id="rematch">Rematch</button>
        <button class="btn ghost big" id="newpick">New Servants</button>
        <button class="btn ghost big" id="title">Title</button>
      </div>
    </div>`;
  app.querySelector('#rematch').onclick = startMatch;
  app.querySelector('#newpick').onclick = () => { ui.picks = [null, null]; ui.selecting = 0; ui.focus = ROSTER[0].id; show('select'); };
  app.querySelector('#title').onclick = () => show('title');
}

// ---------- keyboard shortcuts (battle) ----------

document.addEventListener('keydown', e => {
  if (ui.screen !== 'battle' || !overlay.hidden || ui.active < 0) return;
  const s = ui.match.servants[ui.active];
  const legal = getLegalActions(ui.match, ui.active);
  const k = e.key.toLowerCase();
  if (k === 'q') setDraft({ main: { type: 'attack', card: 'quick' } });
  else if (k === 'a') setDraft({ main: { type: 'attack', card: 'arts' } });
  else if (k === 'b') setDraft({ main: { type: 'attack', card: 'buster' } });
  else if (k === 'n' && legal.np) setDraft({ main: { type: 'np' } });
  else if (['1', '2', '3'].includes(k)) {
    const sk = s.skills[Number(k) - 1];
    if (sk && legal.skills.includes(sk.id)) setDraft({ main: { type: 'skill', skillId: sk.id } });
  } else if (k === 'enter' && ui.draft.main) lockIn();
});

render();
