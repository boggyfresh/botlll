const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 10e6
});

// Game state
const games = new Map();

function createGame(gameId) {
  return {
    id: gameId,
    players: new Map(),
    gifts: new Map(),
    giftPool: [],
    currentTurnIndex: 0,
    turnOrder: [],
    phase: 'lobby', // lobby, playing, revealing, finished
    revealIndex: 0,
    lastStolenFrom: null,
    stealCounts: new Map() // Track how many times each gift has been stolen
  };
}

function getGameState(game) {
  const players = Array.from(game.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    hasGift: p.hasGift,
    currentGift: p.currentGift ? {
      id: p.currentGift.id,
      title: game.phase === 'revealing' || game.phase === 'finished' ? p.currentGift.title : '???',
      image: game.phase === 'revealing' || game.phase === 'finished' ? p.currentGift.image : null,
      revealed: p.currentGift.revealed || false
    } : null,
    isReady: p.isReady
  }));

  return {
    id: game.id,
    players,
    phase: game.phase,
    currentTurnIndex: game.currentTurnIndex,
    turnOrder: game.turnOrder,
    giftPoolCount: game.giftPool.length,
    revealIndex: game.revealIndex,
    currentPlayerId: game.turnOrder[game.currentTurnIndex] || null,
    lastStolenFrom: game.lastStolenFrom
  };
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  let currentGameId = null;
  let currentPlayerId = null;

  socket.on('joinGame', ({ gameId, playerName, avatar }) => {
    currentGameId = gameId;
    currentPlayerId = socket.id;

    if (!games.has(gameId)) {
      games.set(gameId, createGame(gameId));
    }

    const game = games.get(gameId);
    
    if (game.phase !== 'lobby') {
      socket.emit('error', { message: 'Game already in progress' });
      return;
    }

    game.players.set(socket.id, {
      id: socket.id,
      name: playerName,
      avatar: avatar,
      hasGift: false,
      currentGift: null,
      isReady: false
    });

    socket.join(gameId);
    io.to(gameId).emit('gameState', getGameState(game));
    console.log(`${playerName} joined game ${gameId}`);
  });

  socket.on('submitGift', ({ title, image }) => {
    if (!currentGameId) return;
    const game = games.get(currentGameId);
    if (!game) return;

    const player = game.players.get(socket.id);
    if (!player) return;

    const giftId = `gift_${socket.id}_${Date.now()}`;
    const gift = {
      id: giftId,
      title,
      image,
      ownerId: socket.id,
      originalOwnerId: socket.id,
      revealed: false
    };

    game.gifts.set(giftId, gift);
    game.giftPool.push(giftId);
    player.hasGift = true;
    player.isReady = true;

    io.to(currentGameId).emit('gameState', getGameState(game));
    socket.emit('giftSubmitted', { giftId });
    console.log(`${player.name} submitted gift: ${title}`);
  });

  socket.on('startGame', () => {
    if (!currentGameId) return;
    const game = games.get(currentGameId);
    if (!game) return;

    const players = Array.from(game.players.values());
    if (players.length < 2) {
      socket.emit('error', { message: 'Need at least 2 players' });
      return;
    }

    const allReady = players.every(p => p.isReady);
    if (!allReady) {
      socket.emit('error', { message: 'All players must submit their gifts first' });
      return;
    }

    // Randomize turn order
    game.turnOrder = Array.from(game.players.keys()).sort(() => Math.random() - 0.5);
    game.currentTurnIndex = 0;
    game.phase = 'playing';

    io.to(currentGameId).emit('gameState', getGameState(game));
    io.to(currentGameId).emit('gameStarted', { turnOrder: game.turnOrder });
    console.log(`Game ${currentGameId} started!`);
  });

  socket.on('takeFromPool', () => {
    if (!currentGameId) return;
    const game = games.get(currentGameId);
    if (!game || game.phase !== 'playing') return;

    const currentPlayerId = game.turnOrder[game.currentTurnIndex];
    if (socket.id !== currentPlayerId) {
      socket.emit('error', { message: 'Not your turn!' });
      return;
    }

    if (game.giftPool.length === 0) {
      socket.emit('error', { message: 'No gifts in pool!' });
      return;
    }

    const player = game.players.get(socket.id);
    const randomIndex = Math.floor(Math.random() * game.giftPool.length);
    const giftId = game.giftPool.splice(randomIndex, 1)[0];
    const gift = game.gifts.get(giftId);

    player.currentGift = gift;
    gift.ownerId = socket.id;
    game.lastStolenFrom = null;

    // Initialize steal count for this gift
    if (!game.stealCounts.has(giftId)) {
      game.stealCounts.set(giftId, 0);
    }

    advanceTurn(game);
    io.to(currentGameId).emit('gameState', getGameState(game));
    io.to(currentGameId).emit('action', { 
      type: 'took', 
      playerName: player.name,
      giftTitle: gift.title
    });
  });

  socket.on('stealGift', ({ targetPlayerId }) => {
    if (!currentGameId) return;
    const game = games.get(currentGameId);
    if (!game || game.phase !== 'playing') return;

    const currentPlayerId = game.turnOrder[game.currentTurnIndex];
    if (socket.id !== currentPlayerId) {
      socket.emit('error', { message: 'Not your turn!' });
      return;
    }

    // Can't steal back from who just stole from you
    if (game.lastStolenFrom === targetPlayerId) {
      socket.emit('error', { message: 'Cannot steal back immediately!' });
      return;
    }

    const targetPlayer = game.players.get(targetPlayerId);
    if (!targetPlayer || !targetPlayer.currentGift) {
      socket.emit('error', { message: 'Target has no gift!' });
      return;
    }

    const gift = targetPlayer.currentGift;
    
    // Check if gift has been stolen 3 times (locked)
    const stealCount = game.stealCounts.get(gift.id) || 0;
    if (stealCount >= 3) {
      socket.emit('error', { message: 'This gift is locked (stolen 3 times)!' });
      return;
    }

    const player = game.players.get(socket.id);
    
    // Transfer gift
    player.currentGift = gift;
    gift.ownerId = socket.id;
    targetPlayer.currentGift = null;
    game.lastStolenFrom = socket.id;
    
    // Increment steal count
    game.stealCounts.set(gift.id, stealCount + 1);

    // Target player gets to go next (unless they're out of options)
    const targetHasOptions = game.giftPool.length > 0 || 
      Array.from(game.players.values()).some(p => 
        p.id !== targetPlayerId && 
        p.currentGift && 
        p.id !== socket.id &&
        (game.stealCounts.get(p.currentGift.id) || 0) < 3
      );

    if (targetHasOptions) {
      // Insert target player's turn next
      game.currentTurnIndex = game.turnOrder.indexOf(targetPlayerId);
    } else {
      advanceTurn(game);
    }

    io.to(currentGameId).emit('gameState', getGameState(game));
    io.to(currentGameId).emit('action', { 
      type: 'stole', 
      playerName: player.name, 
      targetName: targetPlayer.name,
      giftTitle: gift.title
    });
  });

  socket.on('revealNext', () => {
    if (!currentGameId) return;
    const game = games.get(currentGameId);
    if (!game || game.phase !== 'revealing') return;

    const playersWithGifts = Array.from(game.players.values()).filter(p => p.currentGift);
    
    if (game.revealIndex < playersWithGifts.length) {
      const player = playersWithGifts[game.revealIndex];
      player.currentGift.revealed = true;
      game.revealIndex++;

      io.to(currentGameId).emit('gameState', getGameState(game));
      io.to(currentGameId).emit('giftRevealed', {
        playerName: player.name,
        gift: {
          title: player.currentGift.title,
          image: player.currentGift.image
        }
      });

      if (game.revealIndex >= playersWithGifts.length) {
        game.phase = 'finished';
        io.to(currentGameId).emit('gameState', getGameState(game));
        io.to(currentGameId).emit('gameFinished');
      }
    }
  });

  function advanceTurn(game) {
    // Check if everyone has a gift or pool is empty
    const playersWithoutGifts = Array.from(game.players.values()).filter(p => !p.currentGift);
    
    if (playersWithoutGifts.length === 0 || 
        (game.giftPool.length === 0 && !canAnyoneSteal(game))) {
      // Move to reveal phase
      game.phase = 'revealing';
      game.revealIndex = 0;
      return;
    }

    // Find next player without a gift
    let nextIndex = (game.currentTurnIndex + 1) % game.turnOrder.length;
    let attempts = 0;
    while (attempts < game.turnOrder.length) {
      const playerId = game.turnOrder[nextIndex];
      const player = game.players.get(playerId);
      if (!player.currentGift) {
        game.currentTurnIndex = nextIndex;
        return;
      }
      nextIndex = (nextIndex + 1) % game.turnOrder.length;
      attempts++;
    }
    
    // Everyone has a gift
    game.phase = 'revealing';
    game.revealIndex = 0;
  }

  function canAnyoneSteal(game) {
    return Array.from(game.players.values()).some(p => 
      p.currentGift && (game.stealCounts.get(p.currentGift.id) || 0) < 3
    );
  }

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (currentGameId) {
      const game = games.get(currentGameId);
      if (game && game.phase === 'lobby') {
        game.players.delete(socket.id);
        io.to(currentGameId).emit('gameState', getGameState(game));
      }
    }
  });
});

// Serve the React app for all routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`White Elephant server running on port ${PORT}`);
});
