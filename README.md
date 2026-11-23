# Snow Village

A calm Christmas world for small kids, for Meta Quest 3 (WebXR).
three.js r187 classic-script build (made from the official module). No CDN.
`copilot.js` is the same file as in ski and casatrack (PeerJS 1.5.5 and qrcode-generator 2.0.4 inside, MIT).

## Controls
- Left stick: walk
- Right stick: left/right turns (smooth, or snap with the TURN option), up/down walks
- Trigger, grip, A/B/X/Y: throw snowballs
- On the sled: the sticks steer left and right on the run
- On screen: W A S D walks (or steers the sled), mouse looks, click throws

## The sled hill
- Walk through the candy cane gate behind the start point.
- Step on the blue ring: the lift basket takes you up the mountain (about 23 s).
- At the top, walk to the sled with the gold ring. After three bells it goes down (about 30 s).
- At the bottom the sled stops. Walk away and the sled goes back to the top.

## Copilot (the Mac sees along)
1. On the Mac, open the page and push BE COPILOT. The Mac shows a QR code.
2. Scan the QR code with the Quest. The game opens on the Quest and connects. The Quest keeps the pair.
3. Or type the code of the Quest (in the panel on the Quest start page) on the Mac and push JOIN.
- `C` on the Mac: the view of the kid, or the view from behind.
- Keys `1` to `9` or the panel buttons: GO TO THE VILLAGE, GO TO THE SLED HILL, SLED RIDE NOW, CALL SANTA, MUSIC, WALK, TURN, SLED, SNOWBALLS, SNOW.
- The free PeerJS cloud server pairs the two devices. After that the data goes directly between them (WebRTC).
- `?peer=host:port` uses your own PeerServer.

## Deploy
GitHub Pages from the `master` branch. All files are in the root.
