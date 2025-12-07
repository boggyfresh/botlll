# 🎁 White Elephant Gift Exchange

A real-time virtual White Elephant gift exchange game for playing with friends over video call.

## Features

- **No authentication required** - Just enter your name and take a photo
- **Real-time multiplayer** - Play with any number of friends
- **Camera capture or upload** - Take photos or upload images for avatars and gifts
- **Gift secrecy** - Gifts remain hidden until the reveal phase
- **Standard White Elephant rules** - Take from the pool or steal from others (no steal-backs!)
- **One-by-one reveal** - Build suspense with dramatic gift reveals
- **Mobile-first design** - Works great on phones, tablets, and desktops

## How to Play

1. **Create or Join a Room**
   - One person creates a room and shares the 6-letter code
   - Others join using the code

2. **Set Up Your Avatar**
   - Enter your name
   - Take or upload a photo of yourself

3. **Add Your Gift**
   - Take or upload a photo of your wrapped gift
   - Give it a title (only you can see this until reveal)

4. **Wait in the Lobby**
   - See who's joined and who has their gift ready
   - Host starts the game when everyone's ready

5. **Play the Game**
   - On your turn, either:
     - Take a wrapped gift from the pool, OR
     - Steal an already-claimed gift from another player
   - No steal-backs (can't immediately steal back a gift that was just stolen from you)

6. **Reveal Phase**
   - Watch gifts be revealed one by one
   - See who gave what to whom

7. **Mail Your Gifts!**
   - After the game, mail your gift to the person who ended up with it

## Setup

```bash
# Install dependencies
npm install

# Start the server
npm start

# Open in browser
open http://localhost:3000
```

## Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Vanilla HTML/CSS/JS
- **Real-time**: WebSockets via Socket.io

## Tips for Playing

- Have everyone on a Zoom/video call while playing
- The person who ends up with your gift will need your mailing address
- Consider setting a price range for gifts beforehand
- The host should wait until everyone has submitted their gift before starting

## Room Codes

Room codes are 6 characters using letters and numbers (excluding confusable characters like 0/O and 1/I/L).

---

Made with ❤️ for virtual holiday parties
