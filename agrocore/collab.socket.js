// agrocore/collab.socket.js
// Real-time collaboration: formula rooms, presence tracking, field-delta broadcast

const rooms = new Map();      // formulaId -> Set<socketId>
const socketMeta = new Map(); // socketId -> { formulaId, username, color }

const USER_COLORS = ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7'];
let colorIdx = 0;

function nextColor() {
  const c = USER_COLORS[colorIdx % USER_COLORS.length];
  colorIdx++;
  return c;
}

function getPresence(formulaId) {
  const sids = rooms.get(formulaId) || new Set();
  return [...sids].map(sid => {
    const m = socketMeta.get(sid);
    return m ? { username: m.username, color: m.color } : null;
  }).filter(Boolean);
}

export function setupCollabSocket(io) {
  io.on('connection', (socket) => {
    const username = socket.handshake.auth?.username || 'Nutritionist';
    const color = nextColor();
    socketMeta.set(socket.id, { formulaId: null, username, color });

    socket.on('join_formula', ({ formulaId }) => {
      const meta = socketMeta.get(socket.id);

      // Leave previous room
      if (meta?.formulaId) {
        const prev = meta.formulaId;
        socket.leave(`formula:${prev}`);
        rooms.get(prev)?.delete(socket.id);
        io.to(`formula:${prev}`).emit('presence_update', {
          formulaId: prev,
          users: getPresence(prev)
        });
      }

      if (!formulaId) {
        socketMeta.set(socket.id, { ...meta, formulaId: null });
        return;
      }

      socket.join(`formula:${formulaId}`);
      if (!rooms.has(formulaId)) rooms.set(formulaId, new Set());
      rooms.get(formulaId).add(socket.id);
      socketMeta.set(socket.id, { ...meta, formulaId });

      io.to(`formula:${formulaId}`).emit('presence_update', {
        formulaId,
        users: getPresence(formulaId)
      });
    });

    // A nutritionist made a field edit — broadcast to other clients in same formula
    socket.on('formula_delta', ({ formulaId, field, value, rowIndex }) => {
      const meta = socketMeta.get(socket.id);
      if (!formulaId || meta?.formulaId !== formulaId) return;

      socket.to(`formula:${formulaId}`).emit('formula_delta', {
        formulaId,
        field,
        value,
        rowIndex,
        from: meta.username,
        color: meta.color,
        timestamp: new Date().toISOString()
      });
    });

    socket.on('disconnect', () => {
      const meta = socketMeta.get(socket.id);
      if (meta?.formulaId) {
        rooms.get(meta.formulaId)?.delete(socket.id);
        io.to(`formula:${meta.formulaId}`).emit('presence_update', {
          formulaId: meta.formulaId,
          users: getPresence(meta.formulaId)
        });
      }
      socketMeta.delete(socket.id);
    });
  });
}
