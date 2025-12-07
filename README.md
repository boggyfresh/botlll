# 🎁 White Elephant - Virtual Gift Exchange

A real-time, mobile-first web app for playing White Elephant gift exchange with friends while on a video call.

## Features

- **No authentication required** - Just enter your name and join
- **Avatar photos** - Take a selfie or upload a headshot
- **Secret gifts** - Upload gift photos that stay hidden until the reveal
- **Real-time gameplay** - Socket.io powered for instant updates
- **Standard rules** - Take from pool or steal, no steal-backs, 3-steal lock
- **Dramatic reveals** - Gifts revealed one-by-one at the end
- **Mobile-first** - Beautiful on phones, tablets, and desktops

## How to Play

1. **Create/Join a Game**
   - First player gets a game code automatically
   - Share the link with friends
   - Everyone adds their name and takes a selfie

2. **Add Your Gift**
   - Take a photo of your wrapped gift
   - Add a title (only you can see this until reveal)
   - Wait for everyone to submit

3. **Play!**
   - Players take turns in random order
   - On your turn: take from the pool OR steal from another player
   - Can't steal back from someone who just stole from you
   - Gifts lock after being stolen 3 times

4. **Reveal**
   - Once everyone has a gift, reveals begin
   - Gifts are shown one-by-one dramatically
   - Send your gift to the winner!

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start
```

The app will be available at `http://localhost:3000`

## Deployment

### Deploy to Render, Railway, or Fly.io

1. Push to GitHub
2. Connect your repo to your hosting platform
3. Set the start command to `npm start`
4. Deploy!

### Environment Variables

- `PORT` - Server port (default: 3000)

## Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: React (CDN), Vanilla CSS
- **Real-time**: WebSockets via Socket.io

## Game Rules (Standard White Elephant)

1. Everyone brings one wrapped gift
2. Players draw numbers to determine turn order
3. First player takes a gift from the pool and opens it
4. On your turn, either:
   - Take an unwrapped gift from the pool, OR
   - Steal an opened gift from another player
5. If your gift is stolen, you get another turn (take or steal)
6. **No steal-backs**: Can't immediately steal from someone who stole from you
7. **3-steal lock**: After a gift is stolen 3 times, it's locked to that person
8. Game ends when all gifts are distributed

## File Structure

```
white-elephant/
├── server.js          # Express + Socket.io server
├── package.json       # Dependencies
├── README.md          # This file
└── public/
    └── index.html     # React frontend (single file)
```

## License

MIT - Use freely for your holiday parties! 🎄
