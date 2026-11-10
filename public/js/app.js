// Fate Duel client.
//  - Local mode: both masters share one screen; the engine runs in the browser.
//  - Online mode: the server owns the match; this client renders snapshots and
//    sends intents (pick, lock in, rematch). Screens are shared between modes.

import { createMatch, getLegalActions, resolveTurn, validateAction, deriveStats, npOf } from '/src/engine/engine.js';
import { ROSTER } from '/src/data/servants.js';
import { TUNING as T, CARDS } from '/src/engine/constants.js';
import { CARD_LABEL, describeSkill, describeNp, describeEffects, buffChip } from './describe.js';
import { chooseAction } from '/src/engine/ai.js';
import { nextStrength, START_STRENGTH } from '/src/engine/difficulty.js';

const app = document.getElementById('app');
const overlay = document.getElementById('overlay');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  mode: 'local',            // local | online | cpu
  screen: 'title',          // title | lobby | room | select | battle | end
  selecting: 0,             // local: which master is picking a servant
  focus: null,              // servant id shown in the select detail panel
  picks: [null, null],      // local: servant ids
  match: null,
  active: 0,                // seat currently choosing an action (-1 = none)
  draft: { main: null, seal: null },
  draftTurn: null,
  locked: [null, null],
  bars: {},                 // last shown % per bar, for animation
  logOpen: true,
  revealing: false,
  net: { socket: null, code: null, snap: null, revealedTurn: 0, error: '', online: true },
};

const NAME_KEY = 'fateduel.name';
const savedName = () => localStorage.getItem(NAME_KEY) ?? '';

const online = () => ui.mode === 'online';
const vsCpu = () => ui.mode === 'cpu';

// ---------- CPU difficulty (adapts per browser to keep matches near 50/50) ----------
const CPU_KEY = 'fateduel.cpuStrength';
const cpuStrength = () => { const v = Number(localStorage.getItem(CPU_KEY)); return Number.isFinite(v) && localStorage.getItem(CPU_KEY) !== null ? v : START_STRENGTH; };
const cpuLevel = () => Math.round(cpuStrength() * 10);
function recordCpuResult(result) {
  localStorage.setItem(CPU_KEY, String(nextStrength(cpuStrength(), result)));
}
const mySeat = () => ui.net.snap?.seat ?? null;
const isDuelist = () => online() && mySeat() !== null;
const isHost = () => ui.net.snap?.hostId === ui.net.snap?.me?.id;
function masterLabel(i) {
  if (vsCpu()) return i === 0 ? 'You' : 'CPU';
  if (!online()) return `Master ${i + 1}`;
  const name = ui.net.snap?.duel?.seats[i]?.name ?? `Master ${i + 1}`;
  return i === mySeat() ? `${name} (You)` : name;
}

function show(screen) { ui.screen = screen; render(); }

function render() {
  if (!ui.revealing) { overlay.hidden = true; overlay.innerHTML = ''; }
  ({ title: renderTitle, lobby: renderLobby, room: renderRoom, select: renderSelect, spectate: renderSpectateSelect,
     battle: renderBattle, end: renderEnd })[ui.screen]();
  renderNetBanner();
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
      <h2>Master ${i + 1}</h2>
      <p>${esc(text)}</p>
      <p class="hint">Master ${2 - i}, look away from the screen.</p>
      <button class="btn gold" id="ready">I'm ready</button>
    </div>`, o => o.querySelector('#ready').onclick = next);
}

function renderNetBanner() {
  document.getElementById('net-banner')?.remove();
  if (!online()) return;
  const snap = ui.net.snap;
  let msg = '';
  if (!ui.net.online) msg = 'Connection lost. Reconnecting…';
  else if (snap?.duel && ['select', 'battle'].includes(snap.phase)) {
    const gone = snap.duel.seats.filter((s, i) => i !== snap.seat && !s.connected);
    if (gone.length) msg = `${gone.map(s => s.name).join(' and ')} disconnected. Waiting for them to come back…`;
  }
  if (!msg) return;
  const el = document.createElement('div');
  el.id = 'net-banner';
  el.textContent = msg;
  document.body.appendChild(el);
}

// ---------- title ----------

function renderTitle() {
  app.innerHTML = `
    <div class="title-screen">
      <div class="title-emblem"></div>
      <h1>FATE<span class="slash">/</span><span>DUEL</span></h1>
      <p class="tag">Servant versus Servant · Master versus Master</p>
      <div class="title-actions">
        <button class="btn gold big" id="online">Online Duel</button>
        <button class="btn ghost big" id="cpu">Play vs CPU</button>
        <button class="btn ghost big" id="local">Local Duel <small>one screen</small></button>
      </div>
      ${rulesHtml()}
    </div>`;
  app.querySelector('#local').onclick = () => {
    ui.mode = 'local';
    ui.picks = [null, null]; ui.selecting = 0; ui.focus = SORTED[0].id; ui.search = ''; ui.classFilter = null;
    show('select');
  };
  app.querySelector('#online').onclick = () => { ui.mode = 'online'; ui.net.error = ''; connect(); show('lobby'); };
  app.querySelector('#cpu').onclick = () => {
    ui.mode = 'cpu';
    ui.picks = [null, null]; ui.selecting = 0; ui.focus = SORTED[0].id; ui.search = ''; ui.classFilter = null;
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
          <li>Command Seals (3 per match) are free extra actions: heal, recharge AP, empower the next attack or NP, or all three to fill the NP gauge.</li>
          <li>Reduce the enemy Servant to 0 HP. Double KO or reaching turn ${T.maxTurns} is a draw.</li>
        </ul>
      </div>
    </details>`;
}

// ---------- online: connection + session ----------

const SESSION_KEY = 'fateduel.session';
const saveSession = (code, token) => sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, token }));
const loadSession = () => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; } };
const clearSession = () => sessionStorage.removeItem(SESSION_KEY);

function emit(event, payload = {}) {
  return new Promise(resolve => {
    if (!ui.net.socket?.connected) return resolve({ ok: false, error: 'Not connected to the server yet.' });
    ui.net.socket.timeout(8000).emit(event, payload, (err, res) =>
      resolve(err ? { ok: false, error: 'The server did not respond.' } : res));
  });
}

function connect() {
  if (ui.net.socket) return;
  // global `io` comes from /socket.io/socket.io.js
  const socket = window.io();
  ui.net.socket = socket;
  socket.on('connect', async () => {
    ui.net.online = true;
    const s = loadSession();
    if (s?.code && s?.token) {
      const res = await emit('room:rejoin', s);
      if (!res.ok) { clearSession(); ui.net.code = null; ui.net.snap = null; ui.net.error = res.error; if (online()) show('lobby'); }
    } else if (online()) render();
  });
  socket.on('disconnect', () => { ui.net.online = false; if (online()) renderNetBanner(); });
  socket.on('room:state', onSnapshot);
}

function onSnapshot(snap) {
  const firstForRoom = ui.net.code !== snap.code;
  ui.mode = 'online';
  ui.net.snap = snap;
  ui.net.code = snap.code;
  const duel = snap.duel;
  if (!duel?.lastTurn) ui.net.revealedTurn = 0;               // new match: nothing revealed yet
  else if (firstForRoom) ui.net.revealedTurn = duel.lastTurn.turn; // refresh: don't replay old turns
  if (duel?.match) { ui.match = duel.match; ui.locked = duel.locked; }
  if (ui.revealing) return; // applied when the reveal closes

  if (snap.phase === 'lobby') return show('room');
  if (snap.phase === 'select') {
    if (!isDuelist()) return show('spectate');
    if (ui.screen !== 'select') { ui.focus = duel.picks[snap.seat] ?? SORTED[0].id; ui.bars = {}; }
    show('select');
    if (duel.picks[snap.seat]) waitingOverlay('Servant summoned', 'Waiting for your opponent to choose…');
    return;
  }
  // battle / over
  if (duel.lastTurn && duel.lastTurn.turn > ui.net.revealedTurn) {
    ui.net.revealedTurn = duel.lastTurn.turn;
    ui.active = -1;
    show('battle');
    return showReveal(duel.lastTurn, duel.match, () => {
      ui.revealing = false;
      onSnapshot(ui.net.snap); // re-apply whatever arrived during the reveal
    });
  }
  if (snap.phase === 'over') return show('end');
  if (ui.draftTurn !== duel.match.turn) { ui.draft = { main: null, seal: null }; ui.draftTurn = duel.match.turn; }
  ui.active = isDuelist() && !duel.locked[snap.seat] ? snap.seat : -1;
  show('battle');
}

function waitingOverlay(title, text) {
  openOverlay(`
    <div class="pass">
      <div class="spinner"></div>
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
      <button class="btn ghost" id="leave">Leave room</button>
    </div>`, o => o.querySelector('#leave').onclick = leaveRoom);
}

async function leaveRoom() {
  await emit('room:leave');
  clearSession();
  Object.assign(ui.net, { code: null, snap: null, revealedTurn: 0, error: '' });
  ui.mode = 'local';
  ui.match = null;
  history.replaceState(null, '', location.pathname);
  show('title');
}

// ---------- online: lobby + room ----------

function renderLobby() {
  const invite = new URLSearchParams(location.search).get('room') ?? '';
  app.innerHTML = `
    <div class="title-screen lobby">
      <h1 class="small-title">ONLINE <span>DUEL</span></h1>
      <label class="name-field">
        <span>Master name</span>
        <input id="name" maxlength="16" placeholder="Your name" autocomplete="nickname" value="${esc(savedName())}" />
      </label>
      <div class="lobby-cards">
        <section class="lobby-card">
          <h3>Create a room</h3>
          <p class="muted">Host a room for up to 6 people and share the code.</p>
          <button class="btn gold big" id="create">Create Room</button>
        </section>
        <section class="lobby-card">
          <h3>Join a room</h3>
          <p class="muted">Enter the 4-letter code you were given.</p>
          <form id="joinForm" class="join-row">
            <input id="code" maxlength="4" placeholder="ABCD" autocomplete="off" value="${esc(invite)}" />
            <button class="btn gold" type="submit">Join</button>
          </form>
        </section>
      </div>
      <p class="error lobby-error">${esc(ui.net.error)}</p>
      <button class="btn ghost small" id="back">← Back</button>
    </div>`;
  const nameInput = app.querySelector('#name');
  const codeInput = app.querySelector('#code');
  if (!nameInput.value) nameInput.focus();
  codeInput.oninput = () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, ''); };
  const name = () => {
    const n = nameInput.value.trim();
    if (!n) { ui.net.error = 'Enter a Master name first.'; app.querySelector('.lobby-error').textContent = ui.net.error; nameInput.focus(); return null; }
    localStorage.setItem(NAME_KEY, n);
    return n;
  };
  app.querySelector('#back').onclick = () => { ui.mode = 'local'; show('title'); };
  app.querySelector('#create').onclick = async () => {
    const n = name(); if (!n) return;
    const res = await emit('room:create', { name: n });
    if (!res.ok) { ui.net.error = res.error; return render(); }
    saveSession(res.code, res.token);
  };
  app.querySelector('#joinForm').onsubmit = async e => {
    e.preventDefault();
    const n = name(); if (!n) return;
    const res = await emit('room:join', { code: codeInput.value, name: n });
    if (!res.ok) { ui.net.error = res.error; return render(); }
    saveSession(res.code, res.token);
  };
}

// ---------- online: room lobby ----------

function rosterHtml({ compact = false } = {}) {
  const snap = ui.net.snap;
  const duelSeats = snap.duel?.seats.map(s => s.id) ?? [];
  const queuePos = id => snap.queue.indexOf(id);
  const rows = snap.members.map(m => {
    const isMe = m.id === snap.me.id;
    const dueling = duelSeats.includes(m.id);
    const tag = dueling ? '<span class="role-chip duel">Dueling</span>'
      : m.role === 'player' ? `<span class="role-chip player">Queue #${queuePos(m.id) + 1}</span>`
      : '<span class="role-chip spec">Spectating</span>';
    return `<li class="${m.connected ? '' : 'offline'} ${isMe ? 'me' : ''}">
      <span class="member-name">${esc(m.name)}${isMe ? ' <em>(you)</em>' : ''}</span>
      ${m.id === snap.hostId ? '<span class="host-chip">Host</span>' : ''}
      ${m.connected ? '' : '<span class="offline-chip">offline</span>'}
      ${tag}
    </li>`;
  }).join('');
  const me = snap.members.find(m => m.id === snap.me.id);
  const inDuel = duelSeats.includes(me.id);
  const toggle = inDuel ? '' : me.role === 'player'
    ? '<button class="btn ghost small" id="toSpec">Switch to spectating</button>'
    : '<button class="btn gold small" id="toPlayer">Queue up to battle</button>';
  return `
    <section class="roster-panel ${compact ? 'compact' : ''}">
      <h3>Room ${esc(snap.code)} <small>${snap.members.length}/${snap.maxMembers}</small></h3>
      <ul class="member-list">${rows}</ul>
      <div class="roster-actions">${toggle}</div>
    </section>`;
}

function bindRoster() {
  const toSpec = app.querySelector('#toSpec');
  if (toSpec) toSpec.onclick = () => emit('room:role', { role: 'spectator' });
  const toPlayer = app.querySelector('#toPlayer');
  if (toPlayer) toPlayer.onclick = () => emit('room:role', { role: 'player' });
}

function renderRoom() {
  const snap = ui.net.snap;
  const link = `${location.origin}/?room=${snap.code}`;
  const nameOf = id => snap.members.find(m => m.id === id)?.name;
  const ready = snap.queue.filter(id => snap.members.find(m => m.id === id)?.connected);
  const next = ready.length >= 2 ? `${esc(nameOf(ready[0]))} vs ${esc(nameOf(ready[1]))}` : null;
  const host = isHost();
  app.innerHTML = `
    <div class="room-screen">
      <header class="screen-head">
        <button class="btn ghost small" id="leave">Leave room</button>
        <h1>Room <span class="code-inline">${esc(snap.code)}</span></h1>
        <button class="btn ghost small" id="copy">Copy invite link</button>
      </header>
      <div class="room-body">
        ${rosterHtml()}
        <section class="start-panel">
          <p class="tag">Next duel</p>
          <h2>${next ?? 'Waiting for players…'}</h2>
          <p class="muted">${next ? 'The first two players in the queue duel. Everyone else watches.' : 'At least two people need to be queued up to battle.'}</p>
          ${host
            ? `<button class="btn gold big" id="start" ${next ? '' : 'disabled'}>Start Duel</button>`
            : `<p class="muted">Waiting for the host (${esc(nameOf(snap.hostId))}) to start.</p>`}
          <p class="error" id="startErr"></p>
        </section>
      </div>
    </div>`;
  bindRoster();
  app.querySelector('#leave').onclick = leaveRoom;
  app.querySelector('#copy').onclick = async e => {
    try { await navigator.clipboard.writeText(link); e.target.textContent = 'Copied!'; }
    catch { e.target.textContent = link; }
  };
  const start = app.querySelector('#start');
  if (start) start.onclick = async () => {
    const res = await emit('room:start');
    if (!res.ok) app.querySelector('#startErr').textContent = res.error;
  };
}

// ---------- online: spectator servant select ----------

function renderSpectateSelect() {
  const d = ui.net.snap.duel;
  const side = i => {
    const id = d.picks[i] ?? d.focus[i];
    const s = id ? byId(id) : null;
    return `
      <div class="spec-pick ${d.picked[i] ? 'done' : ''}">
        <span class="master-tag">${esc(d.seats[i].name)}</span>
        ${s ? art(s, 'spec-art') : '<div class="art spec-art empty"><div class="art-fallback"><span>?</span></div></div>'}
        <b>${s ? esc(s.name) : 'Browsing…'}</b>
        <span class="spec-status">${d.picked[i] ? 'Summoned ✓' : s ? 'Considering…' : 'Browsing…'}</span>
      </div>`;
  };
  app.innerHTML = `
    <div class="room-screen">
      <header class="screen-head">
        <button class="btn ghost small" id="leave">Leave room</button>
        <h1>Masters are summoning</h1>
        <div></div>
      </header>
      <div class="spec-select">${side(0)}<div class="versus">VS</div>${side(1)}</div>
      <div class="room-body single">${rosterHtml({ compact: true })}</div>
    </div>`;
  bindRoster();
  app.querySelector('#leave').onclick = leaveRoom;
}

// ---------- servant select ----------

function kitHtml(s) {
  const { hp, atk } = deriveStats(s);
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
        <div><label>Favored</label>${favoredAll(s) ? '<b class="card-chip all">All</b>' : `<b class="card-chip ${s.favoredCard}">${CARD_LABEL[s.favoredCard] ?? '—'}</b>`}</div>
      </div>
      ${passives.length ? `<h3>Passives</h3>${passives.map(p => `
        <div class="kit-row"><b>${esc(p.name)}${p.kind === 'unique' ? ' <em class="unique-tag">Unique</em>' : ''}</b><span>${esc(p.desc ?? describeEffects(p.effects))}</span></div>`).join('')}` : ''}
      <h3>Skills</h3>
      ${s.skills.map(sk => `
        <div class="kit-row"><b>${esc(sk.name)} <em class="ap-cost">${sk.cost} AP</em></b><span>${esc(describeSkill(sk))}${sk.options ? ` (${sk.options.map(o => o.label).join(' / ')})` : ''}</span></div>`).join('')}
      <h3>Noble Phantasm</h3>
      <div class="kit-row np-row"><b>${esc(s.np.name)} ${s.np.modes ? '<span class="card-chip all">Modes</span>' : `<span class="card-chip ${s.np.card}">${CARD_LABEL[s.np.card]}</span>`}</b>
        <span>${esc(describeNp(s.np))}</span></div>
    </div>`;
}

const CLASS_ORDER = ['Saber', 'Archer', 'Lancer', 'Rider', 'Caster', 'Assassin', 'Berserker'];
const SORTED = [...ROSTER].sort((a, b) => a.name.localeCompare(b.name));
const CLASSES = CLASS_ORDER.filter(c => ROSTER.some(s => s.class === c))
  .concat([...new Set(ROSTER.map(s => s.class))].filter(c => !CLASS_ORDER.includes(c)));
const norm = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function matchesFilter(s) {
  if (ui.classFilter && s.class !== ui.classFilter) return false;
  const q = norm((ui.search ?? '').trim());
  if (!q) return true;
  return [s.name, s.class, s.np.name].some(t => norm(t).includes(q));
}
// Hide/show cards in place so the search box keeps focus while typing.
function applyRosterFilter() {
  let shown = 0;
  app.querySelectorAll('.roster-card').forEach(b => {
    const ok = matchesFilter(byId(b.dataset.id));
    b.hidden = !ok; if (ok) shown++;
  });
  app.querySelectorAll('.class-filter button').forEach(b => b.classList.toggle('on', (b.dataset.cls || null) === (ui.classFilter ?? null)));
  const empty = app.querySelector('.roster-empty');
  if (empty) empty.hidden = shown > 0;
}

function renderSelect() {
  const focus = ROSTER.find(s => s.id === ui.focus) ?? ROSTER[0];
  const snap = ui.net.snap;
  const title = online() ? `${esc(snap.me.name)} <span>— Summon your Servant</span>`
    : vsCpu() ? (ui.selecting === 0 ? 'Summon your Servant' : 'Choose the <span>CPU\'s Servant</span>')
    : `Master ${ui.selecting + 1} <span>— Summon your Servant</span>`;
  const opp = online() ? snap.duel.seats[1 - snap.seat] : null;
  const oppReady = online() && snap.duel.picked[1 - snap.seat];
  const status = online()
    ? `<span class="opp-status ${oppReady ? 'ready' : ''}">${esc(opp.name)}: ${oppReady ? 'ready' : 'choosing…'}</span>`
    : vsCpu() ? `<span class="opp-status" title="Adapts after every match to keep games close">CPU level ${cpuLevel()}/10</span>`
    : '<div></div>';
  app.innerHTML = `
    <div class="select-screen">
      <header class="screen-head">
        <button class="btn ghost small" id="back">${online() ? 'Leave room' : '← Back'}</button>
        <h1>${title}</h1>
        ${status}
      </header>
      <div class="select-body">
        <div class="roster-col">
        <div class="roster-tools">
          <input type="search" id="rosterSearch" placeholder="Search servants…" autocomplete="off" value="${esc(ui.search ?? '')}">
          <div class="class-filter">
            <button data-cls="">All</button>
            ${CLASSES.map(c => `<button data-cls="${esc(c)}" class="class-badge" data-class="${esc(c)}">${esc(c)}</button>`).join('')}
          </div>
        </div>
        <div class="roster-empty" hidden>No servants match.</div>
        <div class="roster">
          ${SORTED.map(s => `
            <button class="roster-card ${s.id === focus.id ? 'focused' : ''}" data-id="${s.id}">
              ${art(s, 'portrait')}
              <div class="roster-name">${esc(s.name)}</div>
            </button>`).join('')}
        </div>
        </div>
        <aside class="detail">
          ${art(focus, 'detail-art')}
          ${kitHtml(focus)}
          <button class="btn gold big" id="confirm">${vsCpu() && ui.selecting === 1 ? 'CPU summons' : 'Summon'} ${esc(focus.name.split(' ')[0])}</button>
          ${vsCpu() && ui.selecting === 1 ? '<button class="btn ghost" id="randomCpu">Random Servant</button>' : ''}
        </aside>
      </div>
    </div>`;
  const search = app.querySelector('#rosterSearch');
  search.oninput = () => { ui.search = search.value; applyRosterFilter(); };
  search.onfocus = () => { ui.searchFocused = true; };
  search.onblur = () => { ui.searchFocused = false; };
  if (ui.searchFocused) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
  app.querySelectorAll('.class-filter button').forEach(b => b.onclick = () => {
    ui.classFilter = b.dataset.cls || null; applyRosterFilter();
  });
  applyRosterFilter();
  app.querySelectorAll('.roster-card').forEach(b => b.onclick = () => {
    ui.focus = b.dataset.id;
    const picked = online() && ui.net.snap.duel.picks[ui.net.snap.seat];
    if (online() && !picked) emit('select:focus', { servantId: ui.focus });
    render();
    if (picked) waitingOverlay('Servant summoned', 'Waiting for your opponent to choose…');
  });
  app.querySelector('#back').onclick = () => {
    if (online()) return leaveRoom();
    if (ui.selecting === 1) { ui.selecting = 0; ui.focus = ui.picks[0] ?? SORTED[0].id; return show('select'); }
    show('title');
  };
  app.querySelector('#confirm').onclick = async () => {
    if (online()) {
      const res = await emit('select:pick', { servantId: focus.id });
      if (!res.ok) alert(res.error);
      return;
    }
    ui.picks[ui.selecting] = focus.id;
    if (ui.selecting === 0) {
      ui.selecting = 1; ui.focus = SORTED[0].id; ui.search = ''; ui.classFilter = null;
      show('select');
      if (!vsCpu()) passScreen(1, 'Choose your Servant. Your opponent\'s pick stays hidden until the duel begins.', () => render());
    } else startLocalMatch();
  };
  const randomCpu = app.querySelector('#randomCpu');
  if (randomCpu) randomCpu.onclick = () => {
    ui.picks[1] = ROSTER[Math.floor(Math.random() * ROSTER.length)].id;
    startLocalMatch();
  };
}

// ---------- battle (shared) ----------

const byId = id => ROSTER.find(s => s.id === id);

function startLocalMatch() {
  ui.match = createMatch(byId(ui.picks[0]), byId(ui.picks[1]));
  ui.bars = {};
  ui.locked = [null, null];
  ui.resultRecorded = false;
  beginLocalTurn(0, true);
}

function beginLocalTurn(i, first = false) {
  ui.active = i;
  ui.draft = { main: null, seal: null };
  show('battle');
  if (vsCpu()) return; // no hand-off screens against the CPU
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

// Where a buff came from, in words: a skill or NP name, a passive name, or the opponent's.
function sourceName(servant, b) {
  if (b.copiedFrom) return `Trace On: ${b.copiedFrom}`;
  if (b.debuff) { // debuffs come from the opponent
    const foe = ui.match.servants.find(x => x !== servant) ?? servant;
    const fsk = foe.skills.find(x => x.id === b.source);
    if (fsk) return `${foe.name}: ${fsk.name}`;
    if (b.source === 'np') return `${foe.name}: ${foe.np.name}`;
    return 'Debuff';
  }
  const sk = servant.skills.find(x => x.id === b.source);
  if (sk) return sk.name;
  if (b.source === 'np') return servant.np.name;
  if (b.source === 'mirror') return 'Eternal Arms Mastery (copied ATK buff)';
  return b.source ?? 'Passive';
}

const badge = (kind, label, title, body, meta) =>
  `<span class="buff ${kind}" tabindex="0" data-tip-title="${esc(title)}" data-tip="${esc(body)}" data-tip-meta="${esc(meta)}">${esc(label)}</span>`;

function panelHtml(i) {
  const m = ui.match, p = m.players[i], s = m.servants[i];
  const hpPct = Math.max(0, (p.hp / p.maxHp) * 100);
  const npFull = p.np >= T.npMax;
  const highlight = online() ? i === mySeat() : vsCpu() ? i === 0 : ui.active === i;
  return `
    <section class="panel ${highlight ? 'active' : ''} side-${i}">
      ${art(s, 'battle-art')}
      <div class="panel-info">
        <div class="panel-head">
          <span class="master-tag">${masterLabel(i)}</span>
          <h2>${esc(s.name)}</h2>
          <span class="class-badge" data-class="${esc(s.class)}">${esc(s.class)}</span>
          ${ui.locked[i] ? '<span class="locked-tag">LOCKED IN</span>' : ''}
        </div>
        ${bar(`hp${i}`, hpPct, hpPct < 25 ? 'hp low' : 'hp', `${p.hp} / ${p.maxHp}`)}
        <div class="np-line">
          <label>NP</label>
          ${bar(`np${i}`, p.np, `np ${npFull ? 'full' : ''}`, `${p.np}%`)}
          ${s.np.modes ? `<span class="np-mode ${npOf(s, p).card}">${esc(npOf(s, p).modeName)}</span>` : ''}
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
          ${p.empower ? badge('active', 'Empowered', 'Command Seal: Empower', `The next attack or Noble Phantasm deals ${T.seals.empowerBonus * 100}% more damage, whichever comes first. An empowered attack also wins a tie.`, 'Used up by the next attack or NP') : ''}
          ${(p.neutralized ?? []).map(n => badge('passive blocked', `⊘ ${n}`, `Neutralized: ${n}`, "The opponent's Ea switches off this unique passive for the whole match.", '')).join('')}
          ${(p.copyBlocked ?? []).map(n => badge('passive blocked', `✕ ${n}`, `Trace On: ${n}`, "Trace On couldn't copy this passive, because revives can't be copied.", '')).join('')}
          ${p.buffs.map(b => ({ b, chip: buffChip(b) }))
            .sort((x, y) => ({ passive: 0, active: 1, debuff: 2 }[x.chip.kind] - { passive: 0, active: 1, debuff: 2 }[y.chip.kind]))
            .map(({ b, chip }) => badge(chip.kind, chip.label, sourceName(s, b), chip.explain, chip.duration)).join('')}
        </div>
      </div>
    </section>`;
}

function actionLabel(servant, action) {
  const m = action.main;
  if (m.type === 'attack') return `${CARD_LABEL[m.card]} attack`;
  if (m.type === 'skill') {
    const sk = servant.skills.find(s => s.id === m.skillId);
    const opt = sk?.options?.find(o => o.id === m.option);
    return `${sk?.name ?? m.skillId}${opt ? ` (${opt.label})` : ''}`;
  }
  return servant.np.name;
}

const favoredAll = s => (s.passives ?? []).some(p => p.effects.some(e => e.type === 'affinityAll'));
const isFavored = (s, card) => s.favoredCard === card || favoredAll(s);

const SEAL_INFO = {
  heal: { name: 'Heal', desc: `Restore ${T.seals.healPct}% HP`, cost: 1 },
  recharge: { name: 'Recharge', desc: `+${T.seals.rechargeAp} AP`, cost: 1 },
  empower: { name: 'Empower', desc: `Next attack or NP +${T.seals.empowerBonus * 100}% damage (attacks also win ties)`, cost: 1 },
  grandOrder: { name: 'Grand Order', desc: 'Spend all 3: fill NP gauge', cost: 3 },
};

function controlsHtml() {
  const i = ui.active, m = ui.match, p = m.players[i], s = m.servants[i];
  const legal = getLegalActions(m, i);
  const d = ui.draft;
  const np = npOf(s, p);
  const optSkill = d.main?.type === 'skill' ? s.skills.find(x => x.id === d.main.skillId && x.options) : null;
  const sel = (type, key) => d.main && d.main.type === type && (key === undefined || d.main.card === key || d.main.skillId === key);
  const conv = p.buffs.some(b => b.type === 'busterConvert');
  const perk = { quick: `+${T.apPerAttack + T.cards.quick.apBonus} AP`, arts: `NP +${T.cards.arts.npGain}%`, buster: `${T.cards.buster.mult}× DMG` };

  return `
    <section class="controls">
      <div class="controls-head">
        <h3>${masterLabel(i)} <span>· ${esc(s.name)}</span></h3>
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
                ${isFavored(s, c) ? '<span class="cmd-fav" title="Favored card">★</span>' : ''}
                ${conv && c !== 'buster' ? '<span class="cmd-conv">hits as Buster</span>' : ''}
              </div>
            </button>`).join('')}
          <button class="np-card ${legal.np ? 'ready' : ''} ${sel('np') ? 'selected' : ''}" id="np" ${legal.np ? '' : 'disabled'}>
            <span class="np-label">Noble Phantasm${np.modeName ? ` · ${esc(np.modeName)}` : ''}</span>
            <b>${esc(np.name)}</b>
            <small>${legal.np ? esc(describeNp(np)) : `Gauge ${p.np}%`}</small>
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
        ${optSkill ? `
        <div class="option-row">
          <label>${esc(optSkill.name)}: choose</label>
          ${optSkill.options.map(o => `<button class="option-btn ${o.card ?? ''} ${d.main.option === o.id ? 'selected' : ''}" data-option="${o.id}">${esc(o.label)}${o.id === p.npMode ? ' <small>(current)</small>' : ''}</button>`).join('')}
        </div>` : ''}
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

function describeAction(i, action) {
  if (!action?.main && !action?.seal) return null;
  const s = ui.match.servants[i];
  const main = action.main ? actionLabel(s, action) : 'No action yet';
  return `${main}${action.seal ? ` + ${SEAL_INFO[action.seal].name}` : ''}`;
}

function spectatorHtml() {
  const d = ui.net.snap.duel;
  const col = i => {
    const locked = d.lockedActions?.[i];
    const draft = d.drafts?.[i];
    const text = describeAction(i, locked ?? draft);
    const kind = locked?.main ? (locked.main.type === 'attack' ? locked.main.card : locked.main.type)
      : draft?.main ? (draft.main.type === 'attack' ? draft.main.card : draft.main.type) : '';
    return `
      <div class="spec-col ${locked ? 'locked' : ''}">
        <span class="master-tag">${esc(d.seats[i].name)} · ${esc(ui.match.servants[i].name)}</span>
        <div class="spec-action ${kind}">${text ? esc(text) : 'Thinking…'}</div>
        <span class="spec-status">${locked ? 'LOCKED IN' : draft ? 'selecting…' : ''}</span>
      </div>`;
  };
  return `
    <section class="controls spectator">
      <div class="controls-head"><h3>Spectating <span>· live selections</span></h3><span class="turn-tag">Turn ${ui.match.turn}</span></div>
      <div class="spec-cols">${col(0)}${col(1)}</div>
      ${rosterHtml({ compact: true })}
    </section>`;
}

function waitingControlsHtml() {
  if (vsCpu()) return '<section class="controls resolving"><div><div class="spinner"></div><p class="muted">The CPU is choosing…</p></div></section>';
  if (!online()) return '<section class="controls resolving"><p>Resolving the clash…</p></section>';
  if (!isDuelist()) return spectatorHtml();
  const mine = ui.net.snap.duel.myAction;
  const s = ui.match.servants[mySeat()];
  return `
    <section class="controls resolving">
      <div>
        <p class="locked-line">Locked in: <b>${mine ? esc(actionLabel(s, mine)) : '…'}${mine?.seal ? ` + ${SEAL_INFO[mine.seal].name}` : ''}</b></p>
        <div class="spinner"></div>
        <p class="muted">Waiting for your opponent…</p>
        <button class="btn ghost small" id="unlock">Change action</button>
      </div>
    </section>`;
}

function logHtml() {
  const turns = [...(ui.match.history ?? [])].reverse();
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
      ${online() ? `<div class="room-tag">${isDuelist() ? '' : '<span class="spec-badge">Spectating</span>'} Room ${esc(ui.net.code)} <button class="btn ghost small" id="leaveBattle">Leave</button></div>` : ''}
      <div class="field">
        ${panelHtml(0)}
        <div class="versus">VS</div>
        ${panelHtml(1)}
      </div>
      <div class="lower">
        ${ui.active >= 0 ? controlsHtml() : waitingControlsHtml()}
        ${logHtml()}
      </div>
    </div>`;
  bindControls();
}

// A skill draft; skills with options start on the servant's current NP mode.
function skillMain(skillId) {
  const s = ui.match.servants[ui.active], p = ui.match.players[ui.active];
  const sk = s.skills.find(x => x.id === skillId);
  if (!sk?.options) return { type: 'skill', skillId };
  return { type: 'skill', skillId, option: sk.options.find(o => o.id === p.npMode)?.id ?? sk.options[0].id };
}

function setDraft(patch) {
  Object.assign(ui.draft, patch);
  if (isDuelist() && ui.active >= 0) emit('battle:draft', { action: ui.draft }); // spectators see it live
  const scroll = window.scrollY;
  render();
  window.scrollTo(0, scroll);
}

function bindControls() {
  const $ = sel => app.querySelectorAll(sel);
  $('.cmd-card').forEach(b => b.onclick = () => setDraft({ main: { type: 'attack', card: b.dataset.card } }));
  $('.skill').forEach(b => b.onclick = () => setDraft({ main: skillMain(b.dataset.skill) }));
  $('.option-btn').forEach(b => b.onclick = () => setDraft({ main: { ...ui.draft.main, option: b.dataset.option } }));
  const np = app.querySelector('#np');
  if (np) np.onclick = () => setDraft({ main: { type: 'np' } });
  $('.seal-btn').forEach(b => b.onclick = () => setDraft({ seal: ui.draft.seal === b.dataset.seal ? null : b.dataset.seal }));
  const lock = app.querySelector('#lock');
  if (lock) lock.onclick = lockIn;
  const unlock = app.querySelector('#unlock');
  if (unlock) unlock.onclick = () => emit('battle:unlock');
  const leave = app.querySelector('#leaveBattle');
  if (leave) leave.onclick = () => {
    if (!isDuelist() || confirm('Leave this duel? It will end and everyone returns to the room.')) leaveRoom();
  };
  bindRoster();
  app.querySelector('#logToggle').onclick = () => { ui.logOpen = !ui.logOpen; setDraft({}); };
}

async function lockIn() {
  const i = ui.active;
  const action = { main: ui.draft.main, seal: ui.draft.seal };
  const err = validateAction(ui.match, i, action);
  if (err) { app.querySelector('#err').textContent = err; return; }
  if (online()) {
    const res = await emit('battle:lock', { action });
    if (!res.ok) { const e = app.querySelector('#err'); if (e) e.textContent = res.error; }
    return; // the server's snapshot moves us on
  }
  ui.locked[i] = action;
  if (vsCpu()) {
    ui.active = -1;
    show('battle'); // shows "CPU is choosing…"
    setTimeout(() => {
      ui.locked[1] = chooseAction(ui.match, 1, { strength: cpuStrength() });
      resolveLocal();
    }, 450);
    return;
  }
  if (i === 0) beginLocalTurn(1);
  else resolveLocal();
}

// ---------- reveal (shared) ----------

function clashBanner(actions, servants) {
  const [a, b] = actions.map(x => x.main);
  const names = servants.map(s => s.name);
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

function revealSide(i, action, servants) {
  const s = servants[i];
  const m = action.main;
  const kind = m.type === 'attack' ? m.card : m.type;
  return `
    <div class="reveal-side">
      <span class="master-tag">${masterLabel(i)}</span>
      <div class="reveal-card ${kind}">
        ${art(s, 'card-art')}
        <div class="cmd-frame"><span class="cmd-name">${esc(actionLabel(s, action))}</span>
          <span class="cmd-perk">${m.type === 'skill' ? 'Skill' : m.type === 'np' ? 'Noble Phantasm' : 'Attack'}</span></div>
      </div>
      ${action.seal ? `<div class="reveal-seal"><i class="seal-mark"></i> ${SEAL_INFO[action.seal].name}</div>` : '<div class="reveal-seal none">No seal</div>'}
    </div>`;
}

function showReveal({ turn, actions, log }, state, onContinue) {
  ui.revealing = true;
  const banner = clashBanner(actions, state.servants);
  openOverlay(`
    <div class="reveal">
      <h4>Turn ${turn}</h4>
      <div class="reveal-row">${revealSide(0, actions[0], state.servants)}<div class="versus">VS</div>${revealSide(1, actions[1], state.servants)}</div>
      <div class="clash-banner ${banner.cls}">${esc(banner.text)}</div>
      <div class="reveal-log">${log.map((l, k) => `<p class="log-${l.type}" style="animation-delay:${0.25 + k * 0.35}s">${esc(l.msg)}</p>`).join('')}</div>
      <button class="btn gold" id="cont">${state.over ? 'See result' : 'Continue'}</button>
    </div>`, o => o.querySelector('#cont').onclick = () => { ui.revealing = false; onContinue(); });
}

function resolveLocal() {
  const actions = ui.locked;
  const turn = ui.match.turn;
  const { state, log } = resolveTurn(ui.match, actions);
  ui.match = state;
  ui.locked = [null, null];
  ui.active = -1;
  show('battle');
  showReveal({ turn, actions, log }, state, () => state.over ? show('end') : beginLocalTurn(0));
}

// ---------- end ----------

function renderEnd() {
  const m = ui.match;
  const { winner, reason } = m.result;
  const draw = winner === null;
  const s = draw ? null : m.servants[winner];
  let headline = draw ? 'Stalemate' : 'Victory';
  if (isDuelist() && !draw) headline = winner === mySeat() ? 'Victory' : 'Defeat';
  else if (vsCpu() && !draw) headline = winner === 0 ? 'Victory' : 'Defeat';
  else if (online() && !draw) headline = `${esc(ui.net.snap.duel.seats[winner].name)} wins`;
  const sub = draw
    ? (reason === 'double KO' ? 'Both Servants fall. Both Masters survive to fight again.' : `The battle reaches turn ${T.maxTurns} without a victor.`)
    : `${online() ? (winner === mySeat() ? 'You' : esc(ui.net.snap.duel.seats[winner].name)) : vsCpu() ? (winner === 0 ? 'You' : 'The CPU') : `Master ${winner + 1}`} and ${esc(s.name)} claim the Grail. (${m.turn - 1} turns)`;

  let cpuNote = '';
  if (vsCpu()) {
    const before = cpuLevel();
    if (!ui.resultRecorded) { recordCpuResult(draw ? 'draw' : winner === 0 ? 'win' : 'loss'); ui.resultRecorded = true; ui.cpuLevelBefore = before; }
    const from = ui.cpuLevelBefore, to = cpuLevel();
    cpuNote = `<p class="muted">CPU level ${from}/10${to !== from ? ` → ${to}/10` : ''}. The CPU adapts after every match to keep games close.</p>`;
  }

  let actions;
  if (online()) {
    const d = ui.net.snap.duel;
    const voteText = v => v === 'same' ? 'wants a rematch' : v === 'change' ? 'wants new servants' : '';
    const votes = d.seats.map((st, i) => d.rematch[i] ? `${esc(st.name)} ${voteText(d.rematch[i])}.` : '').filter(Boolean).join(' ');
    if (isDuelist()) {
      const mine = d.rematch[mySeat()];
      actions = `
        <div class="title-actions">
          <button class="btn gold big ${mine === 'same' ? 'voted' : ''}" id="rematch">Rematch</button>
          <button class="btn ghost big ${mine === 'change' ? 'voted' : ''}" id="newpick">New Servants</button>
          <button class="btn ghost big" id="toRoom">Return to Room</button>
        </div>
        <p class="muted">${votes || 'Rematch and New Servants need both masters to agree. Return to Room sends everyone back to the room.'}</p>`;
    } else {
      actions = `
        <p class="muted">${votes || 'Waiting for the masters to decide what\'s next…'}</p>
        <div class="title-actions">${isHost() ? '<button class="btn ghost big" id="toRoom">Return to Room</button>' : ''}</div>`;
    }
  } else {
    actions = `
      <div class="title-actions">
        <button class="btn gold big" id="rematch">Rematch</button>
        <button class="btn ghost big" id="newpick">New Servants</button>
        <button class="btn ghost big" id="title">Title</button>
      </div>`;
  }

  if (cpuNote) actions = cpuNote + actions;
  app.innerHTML = `
    <div class="end-screen ${draw ? 'draw' : ''}">
      ${draw ? `<div class="end-pair">${art(m.servants[0], 'end-art')}${art(m.servants[1], 'end-art')}</div>` : art(s, `end-art ${headline === 'Defeat' ? 'loser' : 'winner'}`)}
      <h1>${headline}</h1>
      <p class="tag">${sub}</p>
      ${actions}
    </div>`;

  if (online()) {
    const $ = sel => app.querySelector(sel);
    if ($('#rematch')) $('#rematch').onclick = () => emit('match:rematch', { choice: 'same' });
    if ($('#newpick')) $('#newpick').onclick = () => emit('match:rematch', { choice: 'change' });
    if ($('#toRoom')) $('#toRoom').onclick = () => emit('match:return');
  } else {
    app.querySelector('#rematch').onclick = startLocalMatch;
    app.querySelector('#newpick').onclick = () => { ui.picks = [null, null]; ui.selecting = 0; ui.focus = SORTED[0].id; ui.search = ''; ui.classFilter = null; show('select'); };
    app.querySelector('#title').onclick = () => show('title');
  }
}

// ---------- badge tooltips (one floating box, so panels never clip it) ----------

const tipBox = document.createElement('div');
tipBox.id = 'tipbox';
tipBox.hidden = true;
document.body.appendChild(tipBox);
function showTip(el) {
  tipBox.replaceChildren();
  const t = document.createElement('b'); t.textContent = el.dataset.tipTitle ?? '';
  const p = document.createElement('p'); p.textContent = el.dataset.tip ?? '';
  tipBox.append(t, p);
  if (el.dataset.tipMeta) { const m = document.createElement('small'); m.textContent = el.dataset.tipMeta; tipBox.append(m); }
  tipBox.hidden = false;
  const r = el.getBoundingClientRect(), w = tipBox.offsetWidth, h = tipBox.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  const top = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8;
  tipBox.style.left = `${left}px`;
  tipBox.style.top = `${top}px`;
}
const hideTip = () => { tipBox.hidden = true; };
document.addEventListener('mouseover', e => { const el = e.target.closest?.('[data-tip]'); if (el) showTip(el); else hideTip(); });
document.addEventListener('focusin', e => { const el = e.target.closest?.('[data-tip]'); if (el) showTip(el); });
document.addEventListener('focusout', hideTip);
window.addEventListener('scroll', hideTip, true);

// ---------- keyboard shortcuts (battle) ----------

document.addEventListener('keydown', e => {
  if (ui.screen !== 'battle' || !overlay.hidden || ui.active < 0) return;
  if (e.target.tagName === 'INPUT') return;
  const s = ui.match.servants[ui.active];
  const legal = getLegalActions(ui.match, ui.active);
  const k = e.key.toLowerCase();
  if (k === 'q') setDraft({ main: { type: 'attack', card: 'quick' } });
  else if (k === 'a') setDraft({ main: { type: 'attack', card: 'arts' } });
  else if (k === 'b') setDraft({ main: { type: 'attack', card: 'buster' } });
  else if (k === 'n' && legal.np) setDraft({ main: { type: 'np' } });
  else if (['1', '2', '3'].includes(k)) {
    const sk = s.skills[Number(k) - 1];
    if (sk && legal.skills.includes(sk.id)) setDraft({ main: skillMain(sk.id) });
  } else if (k === 'enter' && ui.draft.main) lockIn();
});

// ---------- boot ----------

if (loadSession() || new URLSearchParams(location.search).get('room')) {
  ui.mode = 'online';
  connect();
  show('lobby'); // replaced by the room snapshot if the session rejoins
} else {
  render();
}
