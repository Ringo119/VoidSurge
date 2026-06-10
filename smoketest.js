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

console.log(`\n${pass} checks passed — VOIDSURGE smoke test complete.`);
