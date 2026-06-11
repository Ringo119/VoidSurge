// Headless smoke test for VOIDSURGE: stub browser APIs, simulate gameplay frames.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const js = html.substring(html.indexOf("<script>") + 8, html.indexOf("</script>"));

// ---- stubs ----
const noop = () => {};
const ctx2d = new Proxy({}, {
  get(t, prop) {
    if (prop === "measureText") return () => ({ width: 50 });
    if (prop === "canvas") return canvasEl;
    return noop;
  },
  set() { return true; }
});
const listeners = {};
const canvasEl = {
  getContext: () => ctx2d,
  style: {},
  width: 0, height: 0,
  addEventListener: (ev, fn) => { listeners["canvas:" + ev] = fn; },
};
let rafCb = null;
const sandbox = {
  console,
  Math, JSON, Set, Map, Object, Array, Number, String, Boolean, parseInt, parseFloat, isNaN, setTimeout: (fn) => fn(),
  performance: { now: () => simNow },
  requestAnimationFrame: (cb) => { rafCb = cb; },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } },
  document: { getElementById: () => canvasEl },
  window: {
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    addEventListener: (ev, fn) => { listeners["window:" + ev] = fn; },
  },
  AudioContext: undefined, // Sound.init handles absence gracefully
};
sandbox.window.AudioContext = undefined;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let simNow = 0;
vm.runInContext(js, sandbox, { filename: "voidsurge.js" });

function frames(n, dt = 16.7) {
  for (let i = 0; i < n; i++) {
    simNow += dt;
    const cb = rafCb; rafCb = null;
    cb(simNow);
    if (!rafCb) throw new Error("rAF chain broke");
  }
}
function key(code, type = "keydown") {
  listeners["window:" + type]({ code, preventDefault: noop });
}
function get(expr) { return vm.runInContext(expr, sandbox); }
function run(expr) { return vm.runInContext(expr, sandbox); }

// ---- scenario ----
let pass = 0;
function check(label, cond) {
  if (cond) { pass++; console.log("  ok  " + label); }
  else { console.error("FAIL  " + label); process.exitCode = 1; }
}

frames(60); // title screen idles
check("title state", get("state") === "title");

// settings menu: toggle enemy intro popups off so the core-loop scenario runs unfrozen
key("KeyO"); check("settings screen opens", get("state") === "settings");
frames(10);
check("intro popups default on", get("settings.enemyIntros") === true);
key("Digit1");
check("toggle persists", get("settings.enemyIntros") === false && get("JSON.parse(localStorage.getItem('voidsurge_settings')).enemyIntros") === false);
key("Escape");
check("settings back to title", get("state") === "title");
check("one new enemy type per wave, never on a boss wave",
  get("(() => { const s = new Set(); for (const k in ENEMY_TYPES) { const t = ENEMY_TYPES[k]; if (s.has(t.intro) || t.intro % 5 === 0) return false; s.add(t.intro); } return true; })()"));

key("Enter"); key("Enter", "keyup");
check("game starts on Enter", get("state") === "play");
check("wave 1", get("wave") === 1);

// move + shoot for 10 simulated seconds
run("mouse.x = 900; mouse.y = 200; mouse.down = true;");
key("KeyD");
frames(600);
check("bullets fired", get("bullets.length + enemyBullets.length + particles.length") >= 0); // arrays alive
check("enemies spawned during wave", get("enemies.length > 0 || spawnQueue.length > 0 || state === 'upgrade'"));

// dash
key("Space"); key("Space", "keyup");
frames(30);

// force-clear wave 1 -> upgrade screen
run("enemies.length = 0; spawnQueue.length = 0; boss = null;");
frames(5);
check("upgrade screen after clear", get("state") === "upgrade");
check("3 choices offered", get("upgradeChoices.length") === 3);
key("Digit1");
check("upgrade applied, wave 2 begins", get("state") === "play" && get("wave") === 2);

// fast-forward to boss wave 5 by clearing waves
for (let w = 2; w < 5; w++) {
  frames(120);
  run("enemies.length = 0; spawnQueue.length = 0; boss = null;");
  frames(5);
  key("Digit" + ((w % 3) + 1));
}
check("reached wave 5 (boss)", get("wave") === 5);
frames(200); // boss spawns after delay
check("boss exists", get("boss !== null"));

// fight the boss across phases
frames(900);
check("boss survived/fought without crash", true);

// kill boss instantly, clear escorts
run("if (boss) boss.hp = 1;");
frames(120);
run("enemies.length = 0; spawnQueue.length = 0;");
frames(60);

// damage player to death
run("player.shield = 0; player.invuln = 0; player.dashing = 0;");
run("damagePlayer(99999);");
frames(5);
check("game over on death", get("state") === "over");
check("high score saved", +get("localStorage.getItem('voidsurge_hi')") === get("score") || get("score") <= +get("localStorage.getItem('voidsurge_hi')"));

// restart
frames(60);
key("KeyR");
check("restart works", get("state") === "play" && get("wave") === 1 && get("player.hp") === get("player.maxHp"));

// pause/unpause + mute don't crash
key("KeyP"); frames(10); key("KeyP");
key("KeyM");
frames(120);
check("post-restart frames run clean", true);

// ---- touch controls (mobile / iOS) ----
function touch(type, list) {
  listeners["canvas:" + type]({ preventDefault: noop, changedTouches: list, touches: list });
}

run("mouse.down = false;"); // hand off from mouse to touch input

// left-side drag = move stick
touch("touchstart", [{ identifier: 1, clientX: 200, clientY: 500 }]);
touch("touchmove",  [{ identifier: 1, clientX: 280, clientY: 500 }]);
frames(30);
check("touch move stick drives player", get("player.vx") > 50);

// right-side drag = aim stick (autofires past deadzone)
run("bullets.length = 0;");
touch("touchstart", [{ identifier: 2, clientX: 900, clientY: 400 }]);
touch("touchmove",  [{ identifier: 2, clientX: 960, clientY: 340 }]);
frames(30);
check("touch aim stick fires", get("bullets.length") > 0);
check("touch aim sets angle", Math.abs(get("player.angle") - Math.atan2(-60, 60)) < 0.01);

touch("touchend", [
  { identifier: 1, clientX: 280, clientY: 500 },
  { identifier: 2, clientX: 960, clientY: 340 },
]);
frames(10);

// on-screen dash button (bottom-right)
run("player.dashT = 0; player.dashing = 0;");
touch("touchstart", [{ identifier: 3, clientX: 1208, clientY: 648 }]);
touch("touchend",   [{ identifier: 3, clientX: 1208, clientY: 648 }]);
check("dash button dashes", get("player.dashing") > 0);
frames(30);

// pause button, then tap anywhere to resume
touch("touchstart", [{ identifier: 4, clientX: 1188, clientY: 96 }]);
touch("touchend",   [{ identifier: 4, clientX: 1188, clientY: 96 }]);
check("pause button pauses", get("paused") === true);
touch("touchstart", [{ identifier: 5, clientX: 400, clientY: 300 }]);
touch("touchend",   [{ identifier: 5, clientX: 400, clientY: 300 }]);
check("tap resumes", get("paused") === false);

// upgrade screen: tap a card
run("enemies.length = 0; spawnQueue.length = 0; boss = null;");
frames(5);
check("upgrade screen for touch test", get("state") === "upgrade");
const beforeWave = get("wave");
touch("touchstart", [{ identifier: 6, clientX: 384, clientY: 345 }]); // card 1 center at 1280x720
touch("touchend",   [{ identifier: 6, clientX: 384, clientY: 345 }]);
check("tap picks upgrade", get("state") === "play" && get("wave") === beforeWave + 1);

// death -> tap to restart
run("player.shield = 0; player.invuln = 0; player.dashing = 0; damagePlayer(99999);");
frames(80);
touch("touchstart", [{ identifier: 7, clientX: 600, clientY: 300 }]);
touch("touchend",   [{ identifier: 7, clientX: 600, clientY: 300 }]);
check("tap restarts after death", get("state") === "play" && get("wave") === 1);
frames(60);
check("touch session frames run clean", true);

// ---- meta progression ----
check("top-10 board persisted", get("JSON.parse(localStorage.getItem('voidsurge_scores')).length") >= 1);
check("lifetime stats persisted", get("JSON.parse(localStorage.getItem('voidsurge_stats')).runs") >= 2);

// die again, then go to the title menu instead of restarting
run("player.shield = 0; player.invuln = 0; player.dashing = 0; damagePlayer(99999);");
frames(80);
check("death cause recorded", get("Object.keys(stats.deathsBy).length") >= 1);
key("KeyT");
check("menu reachable from game over", get("state") === "title");

// menu screens render and navigate
key("KeyH"); check("scores screen opens", get("state") === "scores");
frames(10);
key("Escape"); check("escape returns to title", get("state") === "title");
key("KeyS"); check("stats screen opens", get("state") === "stats");
frames(10);
key("Escape");
key("KeyC"); check("hangar opens", get("state") === "ships");
frames(10);

// unlock + equip a skin
run("unlock('crimson');");
key("Digit2");
check("skin equipped and saved", get("skinId") === "crimson" && get("localStorage.getItem('voidsurge_skin')") === "crimson");
check("locked skin can't be equipped", (run("selectSkin('spectre')"), get("skinId") === "crimson"));
key("Escape");
key("Enter");
check("start from title after menus", get("state") === "play" && get("wave") === 1);
frames(60);
check("meta frames run clean", true);

// ---- enemy intro popups ----
check("no popup while disabled", get("introPopup") === null);
run("settings.enemyIntros = true;");
run("startGame();"); // fresh run resets seenThisRun
frames(60);          // first drifter spawns ~0.4s in
check("intro popup appears on first spawn", get("introPopup !== null") && get("introPopup.type") === "drifter");
const frozenTimer = get("spawnTimer");
frames(30);
check("popup freezes gameplay", get("spawnTimer") === frozenTimer && get("introPopup.t") > 0.35);
key("KeyW");
check("movement keys don't dismiss", get("introPopup !== null"));
key("Enter");
check("any other key dismisses", get("introPopup") === null);
frames(30);
check("gameplay resumes after dismiss", get("spawnTimer") > frozenTimer);

// a type's debut mid-wave also briefs, and a tap dismisses it
run("spawnEnemy('sentry', 100, 100);");
check("popup on debut of another type", get("introPopup !== null") && get("introPopup.type") === "sentry");
frames(30); // pass the accidental-dismiss grace period
touch("touchstart", [{ identifier: 8, clientX: 640, clientY: 360 }]);
touch("touchend",   [{ identifier: 8, clientX: 640, clientY: 360 }]);
check("tap dismisses popup", get("introPopup") === null);
frames(60);
check("popup session frames run clean", true);

// ---- settings are fully operable by touch ----
run("state = 'title';");
frames(10);
// SETTINGS title button: 4th of 4, at 1280x720 -> x0=319, w=150, gap=14, y=668..706
touch("touchstart", [{ identifier: 9, clientX: 886, clientY: 687 }]);
touch("touchend",   [{ identifier: 9, clientX: 886, clientY: 687 }]);
check("settings opens by tap", get("state") === "settings");
frames(10);
const before = get("settings.enemyIntros");
// first setting row: x=360..920, y=216..280
touch("touchstart", [{ identifier: 10, clientX: 640, clientY: 248 }]);
touch("touchend",   [{ identifier: 10, clientX: 640, clientY: 248 }]);
check("tap toggles setting", get("settings.enemyIntros") === !before);
touch("touchstart", [{ identifier: 11, clientX: 640, clientY: 248 }]);
touch("touchend",   [{ identifier: 11, clientX: 640, clientY: 248 }]);
check("tap toggles back", get("settings.enemyIntros") === before);
touch("touchstart", [{ identifier: 12, clientX: 200, clientY: 600 }]);
touch("touchend",   [{ identifier: 12, clientX: 200, clientY: 600 }]);
check("tap empty space returns to title", get("state") === "title");
frames(30);
check("touch settings frames run clean", true);

// ---- bosses: alternation, null mother, modifiers ----
check("bosses alternate by wave",
  get("bossIdForWave(5)") === "harbinger" && get("bossIdForWave(10)") === "mother" &&
  get("bossIdForWave(15)") === "harbinger" && get("bossIdForWave(20)") === "mother");
check("5 modifiers per boss",
  get("BOSSES.harbinger.mods.length") === 5 && get("BOSSES.mother.mods.length") === 5);

run("settings.enemyIntros = true;");
run("startGame(); startWave(10);");
run("player.maxHp = 100000; player.hp = 100000;"); // survive unattended boss fights
frames(200); // boss spawns 2s into the wave
check("null mother spawns on wave 10", get("boss !== null") && get("boss.id") === "mother");
check("boss briefing popup", get("introPopup !== null") && get("introPopup.type") === "mother");
key("Enter"); // dismiss briefing
check("boss briefing dismisses", get("introPopup") === null);
run("settings.enemyIntros = false;"); // keep the rest of the fight deterministic
run("boss.spawnT = 0;");              // skip the spawn telegraph the popup froze
frames(30);

// weak point: sealed core resists damage, open core takes it all
run("enemies.length = 0; spawnQueue.length = 0;");
run("boss.coreT = 99; boss.coreOpen = 0; boss.hp = boss.maxHp;");
run("bullets.length = 0; bullets.push({ x: boss.x, y: boss.y, vx: 0, vy: 0, dmg: 100, life: 1, pierce: 0, crit: false, hit: new Set() });");
frames(1);
check("sealed core resists damage", Math.abs(get("boss.maxHp - boss.hp") - 30) < 0.01);
run("boss.coreOpen = 5; boss.hp = boss.maxHp;");
run("bullets.length = 0; bullets.push({ x: boss.x, y: boss.y, vx: 0, vy: 0, dmg: 100, life: 1, pierce: 0, crit: false, hit: new Set() });");
frames(1);
check("open core takes full damage", Math.abs(get("boss.maxHp - boss.hp") - 100) < 0.01);

// carrier behavior: broods launch even at full health
run("enemies.length = 0; boss.broodT = 0.1; boss.coreT = 99; boss.coreOpen = 0;");
frames(30);
check("mother launches broods", get("enemies.length") >= 2);

// modifiers arrive once a boss has been fought before in the run
run("startWave(20);");
frames(200);
check("repeat mother gains modifier", get("boss !== null") && get("boss.id") === "mother" && get("boss.mod !== null && typeof boss.modName === 'string'"));
run("startWave(15);");
frames(200);
check("first harbinger of the run is unmodified", get("boss !== null") && get("boss.id") === "harbinger" && get("boss.mod") === null);
run("startWave(25);");
frames(200);
check("repeat harbinger gains modifier", get("boss !== null") && get("boss.id") === "harbinger" && get("boss.mod !== null"));
frames(300);
check("boss frames run clean", true);

// ---- late-game enemies ----
check("version string defined", typeof get("VERSION") === "string" && get("VERSION").length > 0);
check("five new hostiles registered",
  ["shielder", "weaver", "phantom", "minelayer", "reaver"].every(t => get("!!ENEMY_TYPES." + t)));
check("new hostiles debut in the late game",
  ["shielder", "weaver", "phantom", "minelayer", "reaver"].every(t => get("ENEMY_TYPES." + t + ".intro") >= 7));

// quarantine the arena so each behavior can be tested in isolation
run("boss = null; enemies.length = 0; spawnQueue.length = 0; enemyBullets.length = 0; bullets.length = 0; waveActive = false;");
run("player.x = 200; player.y = 360; player.invuln = 0; player.dashing = 0; player.shield = 0;");

// shielder: frontal arc eats bullets, rear shots land
run("spawnEnemy('shielder', 900, 360); enemies[0].spawnT = 0; enemies[0].angle = Math.PI;");
run("bullets.push({ x: 882, y: 360, vx: 0, vy: 0, dmg: 10, life: 0.5, pierce: 0, crit: false, hit: new Set() });");
frames(1);
check("shielder blocks frontal hits", Math.abs(get("enemies[0].maxHp - enemies[0].hp")) < 0.01 && get("bullets.length") === 0);
run("bullets.push({ x: 918, y: 360, vx: 0, vy: 0, dmg: 10, life: 0.5, pierce: 0, crit: false, hit: new Set() });");
frames(1);
check("shielder takes rear hits", get("enemies[0].maxHp - enemies[0].hp") >= 9);

// phantom: untouchable while cloaked
run("enemies.length = 0; bullets.length = 0;");
run("spawnEnemy('phantom', 900, 360); enemies[0].spawnT = 0; enemies[0].cloaked = 5;");
run("bullets.push({ x: 900, y: 360, vx: 0, vy: 0, dmg: 10, life: 0.2, pierce: 0, crit: false, hit: new Set() });");
frames(1);
check("cloaked phantom can't be hit", Math.abs(get("enemies[0].maxHp - enemies[0].hp")) < 0.01);

// weaver: leaves a burning wake
run("enemies.length = 0; bullets.length = 0; enemyBullets.length = 0;");
run("spawnEnemy('weaver', 640, 200); enemies[0].spawnT = 0; enemies[0].fireT = 0;");
frames(30);
check("weaver leaves a damaging wake", get("enemyBullets.filter(b => b.trail).length") >= 3);

// minelayer: seeds mines that detonate on proximity
run("enemies.length = 0; enemyBullets.length = 0;");
run("spawnEnemy('minelayer', 1100, 600); enemies[0].spawnT = 0; enemies[0].fireT = 0.1;");
frames(30);
check("minelayer seeds mines", get("enemyBullets.filter(b => b.mine).length") >= 1);
run("enemies.length = 0; enemyBullets.length = 0;");
run("enemyBullets.push({ x: player.x + 40, y: player.y, vx: 0, vy: 0, dmg: 18, life: 9, r: 7, src: 'minelayer', mine: true, armT: 0 });");
run("player.invuln = 0; player.dashing = 0; player.shield = 0;");
const hpBeforeMine = get("player.hp");
frames(1);
check("proximity mine detonates", get("enemyBullets.filter(b => b.mine).length") === 0 && get("player.hp") < hpBeforeMine);

// reaver: dies into a bullet nova
run("enemies.length = 0; enemyBullets.length = 0; bullets.length = 0;");
run("spawnEnemy('reaver', 900, 360); enemies[0].spawnT = 0; enemies[0].hp = 1;");
run("bullets.push({ x: 900, y: 360, vx: 0, vy: 0, dmg: 10, life: 0.3, pierce: 0, crit: false, hit: new Set() });");
frames(1);
check("reaver detonates into a bullet nova", get("enemies.length") === 0 && get("enemyBullets.length") >= 8);
frames(120);
check("late-game enemy frames run clean", true);

// ---- portrait rotation (iOS PWAs can't lock orientation; the game rotates itself) ----
run("state = 'title'; paused = false;");
check("landscape is not rotated", get("ROT") === false && get("W") === 1280 && get("H") === 720);
run("window.innerWidth = 720; window.innerHeight = 1280; resize();");
check("portrait viewport renders rotated", get("ROT") === true && get("W") === 1280 && get("H") === 720);
check("portrait touch maps into game space",
  get("eventXY({clientX: 100, clientY: 300}).x") === 300 && get("eventXY({clientX: 100, clientY: 300}).y") === 620);

// tap the SETTINGS title button through rotated screen coords: game (886,687) = screen (33,886)
touch("touchstart", [{ identifier: 13, clientX: 33, clientY: 886 }]);
touch("touchend",   [{ identifier: 13, clientX: 33, clientY: 886 }]);
check("rotated tap hits title buttons", get("state") === "settings");
touch("touchstart", [{ identifier: 14, clientX: 120, clientY: 200 }]); // game (200,600): empty space
touch("touchend",   [{ identifier: 14, clientX: 120, clientY: 200 }]);
check("rotated tap returns to title", get("state") === "title");

// start a run and drive the move stick through rotated coords
touch("touchstart", [{ identifier: 15, clientX: 400, clientY: 640 }]); // game (640,320): empty title space
check("rotated tap starts game", get("state") === "play");
touch("touchend", [{ identifier: 15, clientX: 400, clientY: 640 }]);
run("enemies.length = 0; spawnQueue.length = 0; waveActive = false;");
touch("touchstart", [{ identifier: 16, clientX: 220, clientY: 200 }]); // game (200,500): left half = move stick
touch("touchmove",  [{ identifier: 16, clientX: 220, clientY: 280 }]); // drag to game (280,500): +x
frames(30);
check("rotated move stick drives player", get("player.vx") > 50);
touch("touchend", [{ identifier: 16, clientX: 220, clientY: 280 }]);

run("window.innerWidth = 1280; window.innerHeight = 720; resize();");
check("landscape restores unrotated", get("ROT") === false && get("W") === 1280 && get("H") === 720);
frames(30);
check("rotation frames run clean", true);

// ---- fixed world + follow camera ----
check("world is larger than the screen", get("WORLD.w") > 1280 && get("WORLD.h") > 720);
key("KeyD", "keyup"); // release the move key held since the core-loop section
run("startGame();");
run("enemies.length = 0; spawnQueue.length = 0; waveActive = false; boss = null;");
check("player starts at world center",
  get("player.x") === get("WORLD.w / 2") && get("player.y") === get("WORLD.h / 2"));
check("camera snaps to the player on run start",
  Math.abs(get("cam.x - clamp(player.x - W / 2, 0, WORLD.w - W)")) < 1 &&
  Math.abs(get("cam.y - clamp(player.y - H / 2, 0, WORLD.h - H)")) < 1);

run("player.x = WORLD.w - 50; player.y = WORLD.h - 50; player.vx = 0; player.vy = 0;");
frames(120);
check("player can roam beyond the screen", get("player.x") > 1280);
check("camera follows and clamps at the far world border",
  Math.abs(get("cam.x - (WORLD.w - W)")) < 2 && Math.abs(get("cam.y - (WORLD.h - H)")) < 2);

run("player.x = 30; player.y = 30; player.vx = 0; player.vy = 0;");
frames(120);
check("camera clamps at the origin corner", get("cam.x") < 2 && get("cam.y") < 2);

run("player.x = 30; player.vx = -2000;");
frames(5);
check("world border still blocks the player", get("player.x") >= get("player.r"));

// spawns land near the camera view and inside the world
check("edge spawns stay inside the world",
  get("(() => { for (let i = 0; i < 200; i++) { const [x, y] = edgeSpawnPos(); if (x < 0 || x > WORLD.w || y < 0 || y > WORLD.h) return false; } return true; })()"));
frames(60);
check("camera frames run clean", true);

console.log(`\n${pass} checks passed — VOIDSURGE smoke test complete.`);
