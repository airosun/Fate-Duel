// Fate Duel server: static client + Socket.IO online rooms.
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ROSTER } from './src/data/servants.js';
import { RoomManager, RoomError } from './src/server/rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const rooms = new RoomManager();

app.use(express.static(path.join(__dirname, 'public')));
// The browser only needs the shared engine + data, never server code.
app.use('/src/server', (_req, res) => res.status(404).end());
app.use('/src', express.static(path.join(__dirname, 'src')));
app.get('/health', (_req, res) => res.json({ ok: true, servants: ROSTER.length, rooms: rooms.rooms.size }));

// room.code -> [socketId | null, socketId | null]
const sockets = new Map();

function broadcast(room) {
  const ids = sockets.get(room.code) ?? [null, null];
  ids.forEach((id, seat) => { if (id) io.to(id).emit('room:state', rooms.snapshot(room, seat)); });
}

function bind(socket, room, seat) {
  socket.data.code = room.code;
  socket.data.seat = seat;
  const ids = sockets.get(room.code) ?? [null, null];
  const prev = ids[seat];
  if (prev && prev !== socket.id) io.sockets.sockets.get(prev)?.disconnect(true); // newer tab wins
  ids[seat] = socket.id;
  sockets.set(room.code, ids);
}

function current(socket) {
  const { code, seat } = socket.data;
  if (code == null) throw new RoomError('You are not in a room.');
  return { room: rooms.get(code), seat };
}

// Wrap a handler: run it, broadcast, and answer the client's ack with ok/error.
function handle(socket, event, fn) {
  socket.on(event, (payload, ack = () => {}) => {
    try {
      const result = fn(payload ?? {});
      ack({ ok: true, ...result });
    } catch (err) {
      if (!(err instanceof RoomError)) console.error(event, err);
      ack({ ok: false, error: err instanceof RoomError ? err.message : 'Something went wrong.' });
    }
  });
}

io.on('connection', socket => {
  handle(socket, 'room:create', () => {
    const { room, seat, token } = rooms.create();
    bind(socket, room, seat);
    broadcast(room);
    return { code: room.code, seat, token };
  });

  handle(socket, 'room:join', ({ code }) => {
    const { room, seat, token } = rooms.join(code);
    bind(socket, room, seat);
    broadcast(room);
    return { code: room.code, seat, token };
  });

  handle(socket, 'room:rejoin', ({ code, token }) => {
    const { room, seat } = rooms.rejoin(code, token);
    bind(socket, room, seat);
    broadcast(room);
    return { code: room.code, seat };
  });

  handle(socket, 'room:leave', () => {
    const { room, seat } = current(socket);
    rooms.leave(room, seat);
    const ids = sockets.get(room.code);
    if (ids) ids[seat] = null;
    socket.data.code = null;
    if (rooms.rooms.has(room.code)) broadcast(room); else sockets.delete(room.code);
    return {};
  });

  handle(socket, 'select:pick', ({ servantId }) => {
    const { room, seat } = current(socket);
    rooms.pick(room, seat, servantId);
    broadcast(room);
    return {};
  });

  handle(socket, 'battle:lock', ({ action }) => {
    const { room, seat } = current(socket);
    rooms.lock(room, seat, action);
    broadcast(room);
    return {};
  });

  handle(socket, 'battle:unlock', () => {
    const { room, seat } = current(socket);
    rooms.unlock(room, seat);
    broadcast(room);
    return {};
  });

  handle(socket, 'match:rematch', ({ choice }) => {
    const { room, seat } = current(socket);
    rooms.rematch(room, seat, choice);
    broadcast(room);
    return {};
  });

  socket.on('disconnect', () => {
    const { code, seat } = socket.data;
    if (code == null) return;
    const ids = sockets.get(code);
    if (!ids || ids[seat] !== socket.id) return; // replaced by a newer connection
    ids[seat] = null;
    if (!rooms.rooms.has(code)) return;
    const room = rooms.rooms.get(code);
    rooms.disconnect(room, seat);
    broadcast(room);
  });
});

setInterval(() => rooms.sweep(), 60 * 1000).unref();

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Fate Duel listening on :${PORT}`));
