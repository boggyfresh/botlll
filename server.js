const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 10e6 // 10MB for image uploads
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// Game rooms storage
const rooms = new Map();

// Game phases
const PHASES = {
  LOBBY: 'lobby',
  PLAYING: 'playing',
  REVEAL: 'reveal',
  FINISHED: 'finished'
};

// Create a new room
function createRoom() {
  const roomCode = generateRoomCode();
  rooms.set(roomCode, {
    code: roomCode,
    players: new Map(),
    gifts: new Map(),
    phase: PHASES.LOBBY,
    turnOrder: [],
    currentTurnIndex: 0,
    currentPlayerId: null,
    giftOwnership: new Map(), // giftId -> playerId
    lastStolenGiftId: null,
    lastStolenFromPlayerId: null,
    revealedGifts: [],
    revealIndex: 0,
    hostId: null
  });
  return rooms.get(roomCode);
}

// Generate a 6-character room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Ensure unique
  if (rooms.has(code)) {
    return generateRoomCode();
  }
  return code;
}

// Get room state for broadcasting
function getRoomState(room) {
  // Build a set of player IDs who have submitted gifts
  const playerIdsWithGifts = new Set();
  room.gifts.forEach(gift => playerIdsWithGifts.add(gift.creatorId));

  const players = Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    hasGift: playerIdsWithGifts.has(p.id),
    isHost: p.id === room.hostId,
    isConnected: p.isConnected
  }));

  // Get gifts in pool (unclaimed)
  const giftsInPool = [];
  const playerGifts = new Map(); // playerId -> gift info

  room.gifts.forEach((gift, giftId) => {
    const ownerId = room.giftOwnership.get(giftId);
    if (!ownerId) {
      giftsInPool.push({
        id: giftId,
        wrapped: true // Always show as wrapped until claimed or revealed
      });
    } else {
      // Gift is owned by someone
      const giftInfo = {
        id: giftId,
        wrapped: room.phase !== PHASES.REVEAL && room.phase !== PHASES.FINISHED,
        title: (room.phase === PHASES.REVEAL || room.phase === PHASES.FINISHED) ? gift.title : null,
        image: (room.phase === PHASES.REVEAL || room.phase === PHASES.FINISHED) ? gift.image : null,
        creatorId: gift.creatorId,
        creatorName: room.players.get(gift.creatorId)?.name || 'Unknown'
      };
      playerGifts.set(ownerId, giftInfo);
    }
  });

  return {
    code: room.code,
    phase: room.phase,
    players,
    giftsInPool,
    playerGifts: Object.fromEntries(playerGifts),
    currentPlayerId: room.currentPlayerId,
    turnOrder: room.turnOrder,
    currentTurnIndex: room.currentTurnIndex,
    lastStolenGiftId: room.lastStolenGiftId,
    lastStolenFromPlayerId: room.lastStolenFromPlayerId,
    revealedGifts: room.revealedGifts,
    revealIndex: room.revealIndex,
    hostId: room.hostId
  };
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  let currentRoom = null;
  let currentPlayerId = null;

  // Create a new room
  socket.on('createRoom', (callback) => {
    const room = createRoom();
    callback({ success: true, roomCode: room.code });
  });

  // Check if room exists
  socket.on('checkRoom', (roomCode, callback) => {
    const room = rooms.get(roomCode.toUpperCase());
    if (room) {
      callback({ exists: true, phase: room.phase });
    } else {
      callback({ exists: false });
    }
  });

  // Join a room
  socket.on('joinRoom', ({ roomCode, playerName, avatar }, callback) => {
    const code = roomCode.toUpperCase();
    let room = rooms.get(code);
    
    if (!room) {
      // Create room if it doesn't exist
      room = createRoom();
      rooms.delete(room.code);
      room.code = code;
      rooms.set(code, room);
    }

    if (room.phase !== PHASES.LOBBY) {
      callback({ success: false, error: 'Game already in progress' });
      return;
    }

    const playerId = uuidv4();
    const player = {
      id: playerId,
      name: playerName,
      avatar: avatar,
      socketId: socket.id,
      isConnected: true
    };

    room.players.set(playerId, player);
    
    // First player becomes host
    if (room.players.size === 1) {
      room.hostId = playerId;
    }

    socket.join(code);
    currentRoom = room;
    currentPlayerId = playerId;

    callback({ success: true, playerId, roomState: getRoomState(room) });
    
    // Broadcast updated state to all players
    socket.to(code).emit('roomUpdate', getRoomState(room));
  });

  // Submit gift
  socket.on('submitGift', ({ title, image }, callback) => {
    if (!currentRoom || !currentPlayerId) {
      callback({ success: false, error: 'Not in a room' });
      return;
    }

    // Check if player already submitted a gift
    const alreadySubmitted = Array.from(currentRoom.gifts.values())
      .some(gift => gift.creatorId === currentPlayerId);
    
    if (alreadySubmitted) {
      callback({ success: false, error: 'Already submitted a gift' });
      return;
    }

    const giftId = uuidv4();
    currentRoom.gifts.set(giftId, {
      id: giftId,
      title,
      image,
      creatorId: currentPlayerId
    });

    callback({ success: true });
    
    // Broadcast updated state
    io.to(currentRoom.code).emit('roomUpdate', getRoomState(currentRoom));
  });

  // Start game (host only)
  socket.on('startGame', (callback) => {
    console.log('startGame called by', currentPlayerId);
    console.log('currentRoom:', currentRoom?.code);
    console.log('hostId:', currentRoom?.hostId);
    
    if (!currentRoom || !currentPlayerId) {
      console.log('Error: Not in a room');
      callback({ success: false, error: 'Not in a room' });
      return;
    }

    if (currentRoom.hostId !== currentPlayerId) {
      console.log('Error: Not the host');
      callback({ success: false, error: 'Only host can start game' });
      return;
    }

    if (currentRoom.players.size < 2) {
      console.log('Error: Not enough players:', currentRoom.players.size);
      callback({ success: false, error: 'Need at least 2 players' });
      return;
    }

    // Check all players have submitted gifts
    const playersWithGifts = new Set();
    currentRoom.gifts.forEach(gift => playersWithGifts.add(gift.creatorId));
    
    console.log('Players:', currentRoom.players.size);
    console.log('Players with gifts:', playersWithGifts.size);
    
    if (playersWithGifts.size !== currentRoom.players.size) {
      callback({ success: false, error: 'Not all players have submitted gifts' });
      return;
    }

    console.log('Starting game!');
    
    // Randomize turn order
    currentRoom.turnOrder = Array.from(currentRoom.players.keys())
      .sort(() => Math.random() - 0.5);
    
    currentRoom.currentTurnIndex = 0;
    currentRoom.currentPlayerId = currentRoom.turnOrder[0];
    currentRoom.phase = PHASES.PLAYING;

    callback({ success: true });
    io.to(currentRoom.code).emit('roomUpdate', getRoomState(currentRoom));
    io.to(currentRoom.code).emit('gameStarted');
  });

  // Take gift from pool
  socket.on('takeFromPool', ({ giftId }, callback) => {
    if (!currentRoom || !currentPlayerId) {
      callback({ success: false, error: 'Not in a room' });
      return;
    }

    if (currentRoom.currentPlayerId !== currentPlayerId) {
      callback({ success: false, error: 'Not your turn' });
      return;
    }

    // Check gift exists and is in pool
    const gift = Array.from(currentRoom.gifts.entries())
      .find(([id]) => id === giftId);
    
    if (!gift || currentRoom.giftOwnership.has(giftId)) {
      callback({ success: false, error: 'Gift not available' });
      return;
    }

    // Assign gift to player
    currentRoom.giftOwnership.set(giftId, currentPlayerId);
    currentRoom.lastStolenGiftId = null;
    currentRoom.lastStolenFromPlayerId = null;

    // Move to next turn
    advanceTurn(currentRoom);

    callback({ success: true });
    io.to(currentRoom.code).emit('roomUpdate', getRoomState(currentRoom));
    io.to(currentRoom.code).emit('giftTaken', {
      playerId: currentPlayerId,
      playerName: currentRoom.players.get(currentPlayerId).name,
      fromPool: true
    });
  });

  // Steal gift from another player
  socket.on('stealGift', ({ fromPlayerId }, callback) => {
    if (!currentRoom || !currentPlayerId) {
      callback({ success: false, error: 'Not in a room' });
      return;
    }

    if (currentRoom.currentPlayerId !== currentPlayerId) {
      callback({ success: false, error: 'Not your turn' });
      return;
    }

    // Find the gift owned by fromPlayerId
    let stolenGiftId = null;
    currentRoom.giftOwnership.forEach((ownerId, giftId) => {
      if (ownerId === fromPlayerId) {
        stolenGiftId = giftId;
      }
    });

    if (!stolenGiftId) {
      callback({ success: false, error: 'Player has no gift to steal' });
      return;
    }

    // Check steal-back rule
    if (stolenGiftId === currentRoom.lastStolenGiftId) {
      callback({ success: false, error: 'Cannot steal back the same gift' });
      return;
    }

    // Transfer ownership
    currentRoom.giftOwnership.set(stolenGiftId, currentPlayerId);
    currentRoom.lastStolenGiftId = stolenGiftId;
    currentRoom.lastStolenFromPlayerId = fromPlayerId;

    // The player who was stolen from gets the next turn
    // But we need to check if game should end
    const unclaimedGifts = Array.from(currentRoom.gifts.keys())
      .filter(giftId => !currentRoom.giftOwnership.has(giftId));

    if (unclaimedGifts.length === 0) {
      // All gifts claimed, game ends
      currentRoom.phase = PHASES.REVEAL;
      currentRoom.currentPlayerId = null;
      prepareReveal(currentRoom);
    } else {
      // Stolen-from player gets next turn
      currentRoom.currentPlayerId = fromPlayerId;
    }

    callback({ success: true });
    io.to(currentRoom.code).emit('roomUpdate', getRoomState(currentRoom));
    io.to(currentRoom.code).emit('giftStolen', {
      thiefId: currentPlayerId,
      thiefName: currentRoom.players.get(currentPlayerId).name,
      victimId: fromPlayerId,
      victimName: currentRoom.players.get(fromPlayerId).name
    });

    if (currentRoom.phase === PHASES.REVEAL) {
      io.to(currentRoom.code).emit('revealPhase');
    }
  });

  // Reveal next gift
  socket.on('revealNext', (callback) => {
    if (!currentRoom) {
      callback({ success: false, error: 'Not in a room' });
      return;
    }

    if (currentRoom.phase !== PHASES.REVEAL) {
      callback({ success: false, error: 'Not in reveal phase' });
      return;
    }

    if (currentRoom.revealIndex >= currentRoom.gifts.size) {
      currentRoom.phase = PHASES.FINISHED;
      callback({ success: true, finished: true });
      io.to(currentRoom.code).emit('roomUpdate', getRoomState(currentRoom));
      io.to(currentRoom.code).emit('gameFinished');
      return;
    }

    const giftIds = Array.from(currentRoom.giftOwnership.keys());
    const giftId = giftIds[currentRoom.revealIndex];
    const gift = currentRoom.gifts.get(giftId);
    const ownerId = currentRoom.giftOwnership.get(giftId);
    const owner = currentRoom.players.get(ownerId);
    const creator = currentRoom.players.get(gift.creatorId);

    const revealData = {
      giftId,
      title: gift.title,
      image: gift.image,
      ownerId,
      ownerName: owner?.name || 'Unknown',
      ownerAvatar: owner?.avatar,
      creatorId: gift.creatorId,
      creatorName: creator?.name || 'Unknown',
      creatorAvatar: creator?.avatar
    };

    currentRoom.revealedGifts.push(revealData);
    currentRoom.revealIndex++;

    callback({ success: true, revealData, finished: false });
    io.to(currentRoom.code).emit('giftRevealed', revealData);
    io.to(currentRoom.code).emit('roomUpdate', getRoomState(currentRoom));
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    if (currentRoom && currentPlayerId) {
      const player = currentRoom.players.get(currentPlayerId);
      if (player) {
        player.isConnected = false;
        io.to(currentRoom.code).emit('roomUpdate', getRoomState(currentRoom));
      }
    }
  });
});

// Helper function to advance turn
function advanceTurn(room) {
  room.currentTurnIndex++;
  
  // Check if all gifts are claimed
  const unclaimedGifts = Array.from(room.gifts.keys())
    .filter(giftId => !room.giftOwnership.has(giftId));

  if (unclaimedGifts.length === 0 || room.currentTurnIndex >= room.turnOrder.length) {
    // Game ends, move to reveal phase
    room.phase = PHASES.REVEAL;
    room.currentPlayerId = null;
    prepareReveal(room);
    io.to(room.code).emit('revealPhase');
  } else {
    room.currentPlayerId = room.turnOrder[room.currentTurnIndex];
  }
}

// Prepare for reveal phase
function prepareReveal(room) {
  room.revealedGifts = [];
  room.revealIndex = 0;
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`White Elephant server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to play`);
});
