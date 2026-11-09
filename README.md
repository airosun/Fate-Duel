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
- `server.js` - Express + Socket.IO server (serves `public/` and the shared engine)
- `public/` - browser client
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
