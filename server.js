// Fate Duel server. Phase 1: serves the static client and a health check.
// Socket.IO rooms and the online duel come in Phase 4.
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ROSTER } from './src/data/servants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));
// The engine is shared with the browser, so serve it as static ES modules.
app.use('/src', express.static(path.join(__dirname, 'src')));
app.get('/health', (_req, res) => res.json({ ok: true, servants: ROSTER.length }));

io.on('connection', socket => {
  socket.emit('hello', { message: 'Connected to Fate Duel', servants: ROSTER.map(s => s.name) });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Fate Duel listening on :${PORT}`));
