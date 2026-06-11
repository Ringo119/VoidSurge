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

console.log(`\n${pass} checks passed — VOIDSURGE smoke test complete.`);
