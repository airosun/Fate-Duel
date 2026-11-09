# Fate 1v1 Duel Battler

Servant vs servant duel with Quick/Arts/Buster rock-paper-scissors. Design doc: see the "Fate 1v1 Duel Battler — Design Doc" artifact.

## Run locally
```
npm install
npm start        # http://localhost:3000
npm test         # rules tests
npm run sim -- 1000   # balance simulator
```

## Layout
- `server.js` - Express + Socket.IO server (serves `public/`, the shared engine, and online rooms)
- `src/server/rooms.js` - online room manager: codes, seats, hidden picks/actions, rematch, reconnect
- `public/` - browser client (local hotseat duel: `js/app.js`, theme: `css/style.css`)
- `public/art/` - servant art drop-in folder (see its README for file names)
- `src/engine/constants.js` - every tuning number (card mults, NP gain, AP, seals, stat conversion)
- `src/engine/engine.js` - pure rules engine: `createMatch`, `getLegalActions`, `validateAction`, `resolveTurn`
- `src/data/servants.js` - servant definitions (prototype 4, **placeholder kits**; replace with your designs)
- `test/engine.test.js` - rules tests (`npm test`)
- `tools/simulate.js` - balance simulator (`npm run sim -- 1000`)

## Using the engine
```js
import { createMatch, resolveTurn } from './src/engine/engine.js';
import { SERVANTS } from './src/data/servants.js';
let state = createMatch(SERVANTS.artoria, SERVANTS.kojirou);
const { state: next, log } = resolveTurn(state, [
  { main: { type: 'attack', card: 'buster' }, seal: null },
  { main: { type: 'skill', skillId: 'minds_eye' }, seal: 'heal' },
]);
```
State is plain JSON (safe to send over Socket.IO). `resolveTurn` never mutates its input.

Tuning experiments without editing files: `BASE_HP=1100 STAT_EXP=0.3 npm run sim -- 500`

## Online play
Online Duel → enter a Master name → Create Room (4-letter code + invite link `/?room=CODE`) or Join.
- Rooms hold up to 6 people. The creator is the host; if they leave, host passes to the next member.
- Members are either queued to battle or spectating. The host starts a duel with the first two
  queued players; everyone else watches. "Return to Room" after a match is winner-stays-on: the
  winner goes to the front of the queue and the loser to the back (a draw sends both back).
- Duelists never see each other's pick or action early. Spectators see everything live:
  servant browsing, action drafts and lock-ins.
- The server validates every action. Refreshing the page rejoins your seat.
- Rooms live in server memory, so a redeploy or a sleeping free-tier instance clears them.
