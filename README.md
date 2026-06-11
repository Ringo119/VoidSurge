# VOIDSURGE

A neon wave-survival twin-stick shooter in a single HTML file. No dependencies, no assets — all art, sound effects, and music are generated procedurally in code. Runs on desktop and as a fullscreen mobile web app on iOS.

**Play on desktop:** open `index.html` in any modern browser.

## Playing on an iOS device

The game ships as a Progressive Web App: touch twin-stick controls, fullscreen home-screen install, landscape layout with notch-safe HUD, and offline play once installed over HTTPS.

### Quick test over Wi-Fi (phone + PC on the same network)

1. On this PC, start a web server in the project folder (pick either):

   ```
   npx serve .
   ```
   or, if you have Python:
   ```
   python -m http.server 8000
   ```

2. If Windows asks about firewall access, click **Allow** (private networks). If you get no prompt and the phone can't connect, allow the port once with an elevated prompt:
   ```
   netsh advfirewall firewall add rule name="voidsurge" dir=in action=allow protocol=TCP localport=8000
   ```

3. Find this PC's local IP address:
   ```
   ipconfig
   ```
   Look for **IPv4 Address** under your Wi-Fi adapter, e.g. `192.168.1.42`.

4. On your iPhone/iPad (same Wi-Fi network), open **Safari** and go to:
   ```
   http://192.168.1.42:8000
   ```
   (use your own IP; `npx serve` defaults to port `3000`, Python to `8000`).

5. Tap the screen and play — landscape is best, but the game renders rotated automatically if the phone stays portrait (iOS doesn't let web apps lock orientation). For the best experience, tap the **Share** button → **Add to Home Screen**, then launch from the icon — this runs fullscreen without Safari's address bar.

> Tips: if there's no sound, check the silent/ring switch on the side of the phone — iOS mutes web audio when the ringer is silenced. Tap once anywhere to unlock audio (an iOS requirement).

### Full install with offline play (HTTPS)

Service workers (offline caching) require HTTPS, which a LAN address doesn't have. The easiest free option is GitHub Pages:

1. Push this folder to a GitHub repository.
2. In the repo: **Settings → Pages → Source: Deploy from a branch**, pick `main` / root.
3. Open `https://<your-username>.github.io/<repo>/` in Safari on the phone.
4. **Share → Add to Home Screen.** The game now launches fullscreen from its own icon and keeps working with no connection.

Any other HTTPS host (Netlify, Cloudflare Pages, an `ngrok`/`cloudflared` tunnel) works the same way.

### Touch controls

| Input | Action |
|---|---|
| Drag on the **left half** | Move (virtual stick appears under your thumb) |
| Drag on the **right half** | Aim — fires automatically while held |
| **DASH** button (bottom-right) | Dash with brief invincibility; ring shows cooldown |
| **II** / **♪** buttons (top-right) | Pause / mute |
| Tap a card | Pick an augment between waves |
| Tap anywhere | Start, resume from pause, or restart after death |

### Native app option

A true App Store build (e.g. wrapping this with [Capacitor](https://capacitorjs.com)) requires Xcode on a Mac to compile and sign. Nothing in the game blocks that route — the PWA above is the way to get it on your phone from this Windows machine.

## Desktop controls

| Input | Action |
|---|---|
| WASD / Arrows | Move |
| Mouse | Aim — hold left button to fire |
| Space | Dash (brief invincibility) |
| 1 / 2 / 3 or click | Pick an augment between waves |
| P / Esc | Pause |
| M | Mute |
| H / S / C / O (title) | Score board / stats / ship hangar / settings |
| T (death screen) | Back to title menu |

## Features

- **10 enemy types** with distinct AI — early waves: drifters (chase), darters (lunge), sentries (kite + shoot), orbiters (circle-strafe), titans (tanks that split on death); late waves bring the hunters: shielders (frontal bullet-eating shield — flank or pierce), weavers (sine-slalom with a burning wake), phantoms (cloak, teleport beside you, strike), minelayers (seed proximity mines), reavers (heavy hunter-killers that detonate into a bullet nova on death)
- **Boss every 5 waves, two of them alternating** — the **Void Harbinger** (wave 5, 15, 25…) cycles radial bursts, aimed volleys, and a telegraphed charge, and calls reinforcements below half health; the **Null Mother** (wave 10, 20, 30…) is an edge-hugging carrier that births endless broods and only takes full damage while her core glows open
- **Boss modifiers** — the first fight against each boss in a run is plain; repeat encounters roll one of 5 modifiers per boss (Berserker, Bulletstorm, Warpshift, Phase Aegis, Void Leech for the Harbinger; Prolific, Armored Core, Elite Brood, Seeker Spines, Regenerator for the Mother), shown on the boss health bar and worth 30% more score
- **13 stackable augments** — multishot, pierce, crit, orbiting sentry drones, lifesteal, shields, and more; pick 1 of 3 after each wave
- **Combo multiplier** (up to 9x) that resets when you take a hit
- **Synthesized audio**: laser/explosion/pickup SFX plus a looping minor-key chiptune sequencer, all Web Audio — zero sound files
- **Game feel**: screen shake, hit flashes, knockback, particle explosions, spawn telegraphs, parallax starfield, neon glow rendering
- **Meta progression** (all saved in localStorage):
  - **Top-10 score board** — every run is ranked; see it from the title screen (SCORES) and your placement on the death screen
  - **Service record** — lifetime stats: runs, kills by enemy type, what killed you, bosses destroyed, best combo, dashes, pickups, favorite augment, time played (STATS)
  - **Hangar** — 8 ship skins unlocked by achievements (kill a boss, reach wave 10/20, max combo, 100 dashes, 250 pickups, clear wave 5+ untouched); recolors hull, trail, and bullets (SHIPS)
  - **Score ghosts** — a marker on the wave where your best run died, and a "record pace" toast when you pass your old high score mid-run
- **Enemy intel popups** — at most one new enemy type debuts per wave, and its first appearance in a run pauses the action with a briefing card (sprite, name, tactics); toggle it in SETTINGS on the title screen
- **Mobile**: twin-stick touch controls, safe-area-aware HUD, PWA manifest + service worker, generated home-screen icons; if the device stays in portrait (iOS PWAs can't lock orientation), the game renders itself rotated 90° so it always plays in landscape
- The current version number is shown in the top-right of the title screen (and tracked in `VERSION` in index.html — bump it together with the `sw.js` cache name when shipping changes)

## Dev

- `node smoketest.js` — headless simulation of the full game loop (title → waves → upgrades → boss → death → restart → touch controls) against stubbed browser APIs.
- `node tools/make-icons.js` — regenerates the PNG icons in `icons/` (pure Node, no dependencies).
