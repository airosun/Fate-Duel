// Fate Duel server: static client + Socket.IO online rooms.
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ROSTER } from './src/data/servants.js';
import { RoomManager, RoomError } from './src/server/rooms.js';
import { ACTIONS } from './src/server/actions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const rooms = new RoomManager();

app.use(express.static(path.join(__dirname, 'public')));
// The browser needs the shared engine + data, plus the room manager and its action table
// (a local Holy Grail War runs them in the page). Nothing else under src/server is served.
const BROWSER_SERVER_FILES = new Set(['/rooms.js', '/actions.js']);
app.use('/src/server', (req, res, next) => (BROWSER_SERVER_FILES.has(req.path) ? next() : res.status(404).end()));
app.use('/src', express.static(path.join(__dirname, 'src')));
app.get('/health', (_req, res) => res.json({ ok: true, servants: ROSTER.length, rooms: rooms.rooms.size }));

// room code -> Map(memberId -> socketId)
const sockets = new Map();

function broadcast(room) {
  const ids = sockets.get(room.code);
  if (!ids) return;
  for (const [memberId, socketId] of ids) {
    if (room.members.some(m => m.id === memberId)) io.to(socketId).emit('room:state', rooms.snapshot(room, memberId));
  }
}

function bind(socket, room, memberId) {
  socket.data.code = room.code;
  socket.data.memberId = memberId;
  if (!sockets.has(room.code)) sockets.set(room.code, new Map());
  const ids = sockets.get(room.code);
  const prev = ids.get(memberId);
  if (prev && prev !== socket.id) io.sockets.sockets.get(prev)?.disconnect(true); // newer tab wins
  ids.set(memberId, socket.id);
}

function current(socket) {
  const { code, memberId } = socket.data;
  if (code == null) throw new RoomError('You are not in a room.');
  return { room: rooms.get(code), id: memberId };
}

// Run a handler, broadcast the room, answer the client's ack with ok/error.
function handle(socket, event, fn, { quiet = false } = {}) {
  socket.on(event, (payload, ack = () => {}) => {
    if (typeof ack !== 'function') ack = () => {};
    try {
      const result = fn(payload ?? {}) ?? {};
      ack({ ok: true, ...result });
    } catch (err) {
      if (!(err instanceof RoomError)) console.error(event, err);
      if (!quiet) ack({ ok: false, error: err instanceof RoomError ? err.message : 'Something went wrong.' });
    }
  });
}

function joined(socket, room, member, token) {
  bind(socket, room, member.id);
  broadcast(room);
  return { code: room.code, memberId: member.id, token };
}

io.on('connection', socket => {
  handle(socket, 'room:create', ({ name }) => {
    const { room, member, token } = rooms.create(name);
    return joined(socket, room, member, token);
  });

  handle(socket, 'room:join', ({ code, name }) => {
    const { room, member, token } = rooms.join(code, name);
    return joined(socket, room, member, token);
  });

  handle(socket, 'room:rejoin', ({ code, token }) => {
    const { room, member } = rooms.rejoin(code, token);
    return joined(socket, room, member, token);
  });

  handle(socket, 'room:leave', () => {
    const { room, id } = current(socket);
    rooms.leave(room, id);
    sockets.get(room.code)?.delete(id);
    socket.data.code = null;
    if (rooms.rooms.has(room.code)) broadcast(room); else sockets.delete(room.code);
  });

  for (const [event, fn] of Object.entries(ACTIONS)) {
    handle(socket, event, payload => {
      const { room, id } = current(socket);
      fn(rooms, room, id, payload);
      broadcast(room);
    });
  }

  socket.on('disconnect', () => {
    const { code, memberId } = socket.data;
    if (code == null) return;
    const ids = sockets.get(code);
    if (!ids || ids.get(memberId) !== socket.id) return; // replaced by a newer connection
    ids.delete(memberId);
    const room = rooms.rooms.get(code);
    if (!room) return;
    rooms.disconnect(room, memberId);
    broadcast(room);
  });
});

setInterval(() => rooms.sweep(), 60 * 1000).unref();

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Fate Duel listening on :${PORT}`));
