/* ═══════════════════════════════════════════════════════════
   SNAKE — Power Edition  |  game.js
   ═══════════════════════════════════════════════════════════
   Features:
   • State machine: MENU → COUNTDOWN → PLAYING → PAUSED → GAMEOVER
   • Difficulty levels  (easy / medium / hard)
   • Wall mode  (collision with border = game over)
   • Speed increases every 5 points (level)
   • 3 fruit types: normal(1pt) | gold(3pt) | rare(5pt)
   • Special star fruit  (disappears over time)
   • 3 Power-ups: Shield / Turbo / Double-points
   • Particle explosions
   • Animated countdown  (3-2-1-GO!)
   • Level-up announcement overlay
   • Touch/swipe support
   • Web Audio API sound effects
   • High score saved in localStorage
   ════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   SOUND ENGINE  (Web Audio API)
   ───────────────────────────────────────────── */
const SFX = (() => {
  let ac = null;
  let on = true;
  const ctx = () => {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    return ac;
  };
  const tone = (freq, dur, type = 'square', vol = 0.12, delay = 0) => {
    if (!on) return;
    try {
      const a  = ctx();
      const o  = a.createOscillator();
      const g  = a.createGain();
      o.connect(g); g.connect(a.destination);
      o.type = type;
      o.frequency.setValueAtTime(freq, a.currentTime + delay);
      g.gain.setValueAtTime(vol, a.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + delay + dur);
      o.start(a.currentTime + delay);
      o.stop(a.currentTime + delay + dur);
    } catch (_) {}
  };
  return {
    eat()     { tone(520,.07,'square',.09); tone(780,.08,'square',.07,.06); },
    eatSpec() { tone(660,.07,'square',.1); tone(880,.08,'square',.09,.06); tone(1100,.1,'square',.07,.14); },
    over()    { tone(200,.3,'sawtooth',.13); tone(150,.4,'sawtooth',.11,.22); tone(100,.5,'sawtooth',.09,.44); },
    lvlUp()   { tone(660,.09,'square',.1); tone(880,.09,'square',.1,.1); tone(1100,.14,'square',.09,.2); },
    power()   { tone(440,.05,'sine',.12); tone(880,.05,'sine',.12,.05); tone(1320,.1,'sine',.1,.1); },
    toggle()  { on = !on; return on; },
    isOn()    { return on; }
  };
})();

/* ─────────────────────────────────────────────
   MUSIC ENGINE  (Web Audio API — chiptune loop)
   ───────────────────────────────────────────── */
const MUSIC = (() => {
  let ac      = null;
  let playing = false;
  let enabled = true;
  let timerId = null;
  let beat    = 0;

  // 16-step chiptune loop in C-major
  const MEL  = [261.63,329.63,392.00,329.63, 261.63,0,329.63,392.00,
                440.00,392.00,329.63,0,       261.63,329.63,523.25,0];
  const BASS = [130.81,0,164.81,0, 196.00,0,174.61,0,
                130.81,0,196.00,0, 261.63,0,196.00,0];
  const STEP = 210;   // ms per step

  const getAC = () => {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    return ac;
  };
  const note = (freq, dur, type, vol) => {
    if (!freq || !enabled) return;
    try {
      const a = getAC();
      const o = a.createOscillator();
      const g = a.createGain();
      o.connect(g); g.connect(a.destination);
      o.type = type;
      o.frequency.setValueAtTime(freq, a.currentTime);
      g.gain.setValueAtTime(vol, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
      o.start(a.currentTime);
      o.stop(a.currentTime + dur);
    } catch(_) {}
  };
  const tick = () => {
    if (!playing || !enabled) return;
    note(MEL[beat],          (STEP/1000)*.75, 'square',   0.038);
    note(BASS[beat],         (STEP/1000)*1.4, 'triangle', 0.052);
    if (beat % 4 === 0) note(MEL[beat]*1.5,  (STEP/1000)*.5, 'sine', 0.018);
    beat    = (beat + 1) % MEL.length;
    timerId = setTimeout(tick, STEP);
  };
  return {
    start() { if (playing) return; playing = true; beat = 0; tick(); },
    stop()  { playing = false; clearTimeout(timerId); timerId = null; },
    toggle(){ enabled = !enabled; if (!enabled) this.stop(); return enabled; },
    isOn()  { return enabled; }
  };
})();

/* ─────────────────────────────────────────────
   PARTICLE
   ───────────────────────────────────────────── */
function Particle(x, y, color) {
  this.x = x; this.y = y;
  this.vx = (Math.random() - .5) * 7;
  this.vy = (Math.random() - .5) * 7;
  this.r  = Math.random() * 3.5 + 1.5;
  this.color = color;
  this.life  = 1;
  this.decay = Math.random() * .025 + .025;
}
Particle.prototype.update = function () {
  this.x += this.vx; this.vy += .12; this.y += this.vy;
  this.vx *= .97; this.life -= this.decay;
};
Particle.prototype.draw = function (ctx) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, this.life);
  ctx.fillStyle   = this.color;
  ctx.shadowColor = this.color;
  ctx.shadowBlur  = 6;
  ctx.beginPath();
  ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

/* ─────────────────────────────────────────────
   CONSTANTS
   ───────────────────────────────────────────── */
const TC   = 20;         // tile count (20×20 grid)
const CS   = 400;        // canvas size
const TS   = CS / TC;    // tile size = 20px

const BASE_FPS   = { easy: 6, medium: 10, hard: 15 };
const INIT_TAIL  = 3;

const PU_TYPES = {
  shield: { id:'shield', icon:'🛡', name:'Escudo', color:'#44aaff', dur:5000 },
  turbo:  { id:'turbo',  icon:'⚡', name:'Turbo',  color:'#ff9900', dur:4000 },
  double: { id:'double', icon:'✨', name:'2× pts', color:'#ff44dd', dur:6000 }
};

/* ─────────────────────────────────────────────
   GAME STATE
   ───────────────────────────────────────────── */
let state      = 'MENU';   // MENU|COUNTDOWN|PLAYING|PAUSED|GAMEOVER
let difficulty = 'easy';
let wallMode   = false;

// Objects  — initialised so the render loop never crashes on frame 1
let player    = { x: 10, y: 10 };
let velocity  = { x: 0,  y: 0  };
let trail     = [];
let tail      = INIT_TAIL;
let fruit     = null;
let starFruit = null;
let puItem    = null;
let particles = [];
let activePU  = {};   // { shield?, turbo?, double? }

// Scoring / progression
let points  = 0;
let record  = 0;
let level   = 1;
let lastDir = 'none';

// Timers / animation
let starLife = 0;    let puLife = 0;
let goAlpha  = 0;    let levelUpTimer = 0;
let countdownNum = 3;
let gameTickMs   = 1000 / 6;   // default easy
let lastTick     = 0;

// Canvas refs
let canv, ctx;

// Touch
let tox, toy;

// rAF id
let rafId;

/* ─────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────── */
function lerp(a, b, t) { return a + (b - a) * t; }

function hsl(h, s, l) { return `hsl(${h},${s}%,${l}%)`; }

function occupied(x, y) {
  for (const s of trail) if (s.x === x && s.y === y) return true;
  return false;
}

function rndTile() {
  return { x: Math.floor(Math.random() * TC), y: Math.floor(Math.random() * TC) };
}

function safeTile() {
  let t; let tries = 0;
  do { t = rndTile(); tries++; } while (occupied(t.x, t.y) && tries < 100);
  return t;
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function burst(x, y, color, n = 14) {
  for (let i = 0; i < n; i++) particles.push(new Particle(x, y, color));
}

function popHUD(id) {
  const el = document.getElementById(id);
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

/* ─────────────────────────────────────────────
   FRUIT / POWERUP SPAWN
   ───────────────────────────────────────────── */
function spawnFruit() {
  const t    = safeTile();
  // Fruit type
  let type = 'normal';
  if (points > 0 && points % 12 === 0) type = 'gold';
  else if (Math.random() < .14) type = 'purple';
  fruit = { x: t.x, y: t.y, type };
}

function spawnStarFruit() {
  if (starFruit) return;
  const t = safeTile();
  starFruit = { x: t.x, y: t.y };
  starLife  = 1.0;
}

function spawnPU() {
  if (puItem) return;
  const keys = Object.keys(PU_TYPES);
  const type = PU_TYPES[keys[Math.floor(Math.random() * keys.length)]];
  const t    = safeTile();
  puItem = { x: t.x, y: t.y, type };
  puLife = 1.0;
}

/* ─────────────────────────────────────────────
   ACTIVE POWER-UPS
   ───────────────────────────────────────────── */
function activatePU(type) {
  SFX.power();
  const now = Date.now();
  activePU[type.id] = { type, start: now, end: now + type.dur };
  refreshPUBar();
}

function tickPUs() {
  const now = Date.now();
  let changed = false;
  for (const id in activePU) {
    if (activePU[id].end <= now) { delete activePU[id]; changed = true; }
  }
  if (changed) refreshPUBar();
}

function refreshPUBar() {
  const bar = document.getElementById('pu-bar');
  bar.innerHTML = '';
  const now = Date.now();
  for (const id in activePU) {
    const pu   = activePU[id];
    const prog = Math.max(0, (pu.end - now) / (pu.end - pu.start));
    const div  = document.createElement('div');
    div.className = `pi ${id}`;
    div.innerHTML =
      `${pu.type.icon} ${pu.type.name}
       <div class="pi-timer-wrap">
         <div class="pi-timer-fill" style="width:${prog*100}%;background:${pu.type.color}"></div>
       </div>`;
    bar.appendChild(div);
  }
}

/* ─────────────────────────────────────────────
   SPEED / LEVEL
   ───────────────────────────────────────────── */
function calcFPS() {
  const base  = BASE_FPS[difficulty];
  const bonus = (level - 1) * 1.2;
  const turbo = activePU.turbo ? 7 : 0;
  return base + bonus + turbo;
}

function updateSpeed() {
  gameTickMs = 1000 / calcFPS();
}

/* ─────────────────────────────────────────────
   RESET
   ───────────────────────────────────────────── */
function resetGame() {
  player   = { x: Math.floor(TC / 2), y: Math.floor(TC / 2) };
  velocity = { x: 0, y: 0 };
  trail    = [{ x: player.x, y: player.y }];
  tail     = INIT_TAIL;
  particles = [];
  activePU  = {};
  points   = 0;
  level    = 1;
  lastDir  = 'none';
  starFruit = null; puItem = null;
  starLife  = 0;    puLife = 0;
  goAlpha   = 0;    levelUpTimer = 0;
  updateSpeed();
  spawnFruit();
  updateHUD();
  refreshPUBar();
}

/* ─────────────────────────────────────────────
   HUD UPDATE
   ───────────────────────────────────────────── */
function updateHUD() {
  document.getElementById('hud-points').textContent = points;
  document.getElementById('hud-level').textContent  = level;
  document.getElementById('hud-record').textContent = record;
  document.getElementById('menu-record').textContent = record;
}

/* ─────────────────────────────────────────────
   GAME LOGIC (called each snake tick)
   ───────────────────────────────────────────── */
function updateGame() {
  const stopped = velocity.x === 0 && velocity.y === 0;
  if (stopped) return;

  // Move
  player.x += velocity.x;
  player.y += velocity.y;

  // Update lastDir
  if      (velocity.y < 0) lastDir = 'up';
  else if (velocity.y > 0) lastDir = 'down';
  else if (velocity.x < 0) lastDir = 'left';
  else                     lastDir = 'right';

  // Wall handling
  if (wallMode) {
    if (player.x < 0 || player.x >= TC || player.y < 0 || player.y >= TC) {
      triggerGameOver(); return;
    }
  } else {
    if (player.x < 0)   player.x = TC - 1;
    if (player.x >= TC) player.x = 0;
    if (player.y < 0)   player.y = TC - 1;
    if (player.y >= TC) player.y = 0;
  }

  // Add to trail
  trail.push({ x: player.x, y: player.y });
  while (trail.length > tail) trail.shift();

  // Self-collision (shield protects)
  if (!activePU.shield) {
    for (let i = 0; i < trail.length - 1; i++) {
      if (trail[i].x === player.x && trail[i].y === player.y) {
        triggerGameOver(); return;
      }
    }
  }

  // Fruit collision
  if (fruit && player.x === fruit.x && player.y === fruit.y) {
    eatFruit();
  }
  // Star fruit
  if (starFruit && player.x === starFruit.x && player.y === starFruit.y) {
    eatStarFruit();
  }
  // Power-up item
  if (puItem && player.x === puItem.x && player.y === puItem.y) {
    collectPU();
  }
}

function addPoints(n) {
  if (activePU.double) n *= 2;
  points += n;
  if (points > record) {
    record = points;
    localStorage.setItem('snakeRecord', record);
  }
  // Level up every 5 points
  const newLvl = Math.floor(points / 5) + 1;
  if (newLvl > level) {
    level = newLvl;
    levelUpTimer = 80;
    SFX.lvlUp();
    updateSpeed();
  }
  updateHUD();
  popHUD('hud-points');
  // Spawn specials
  if (points > 0 && points % 6 === 0) spawnStarFruit();
  if (points > 0 && points % 8 === 0) spawnPU();
}

function eatFruit() {
  const pts   = fruit.type === 'gold' ? 3 : fruit.type === 'purple' ? 5 : 1;
  const color = fruit.type === 'gold' ? '#ffd700' : fruit.type === 'purple' ? '#c44fff' : '#e94560';
  burst(fruit.x * TS + TS / 2, fruit.y * TS + TS / 2, color, 14);
  SFX.eat();
  tail++;
  addPoints(pts);
  spawnFruit();
}

function eatStarFruit() {
  burst(starFruit.x * TS + TS / 2, starFruit.y * TS + TS / 2, '#ffd700', 22);
  SFX.eatSpec();
  tail += 2;
  addPoints(5);
  starFruit = null;
}

function collectPU() {
  burst(puItem.x * TS + TS / 2, puItem.y * TS + TS / 2, puItem.type.color, 18);
  activatePU(puItem.type);
  puItem = null;
}

/* ─────────────────────────────────────────────
   GAME OVER
   ───────────────────────────────────────────── */
function triggerGameOver() {
  MUSIC.stop();
  SFX.over();
  state   = 'GAMEOVER';
  goAlpha = 0;
  syncActionButtons();
}

/* ─────────────────────────────────────────────
   RENDER
   ───────────────────────────────────────────── */
function render(ts) {
  // Game tick
  if (state === 'PLAYING') {
    if (ts - lastTick >= gameTickMs) {
      lastTick = ts;
      tickPUs();
      updateSpeed();   // refresh turbo effect
      updateGame();
      refreshPUBar();
    }
  }

  /* --- background (motion blur) --- */
  if (state === 'PLAYING' || state === 'PAUSED') {
    ctx.fillStyle = 'rgba(10,10,30,.40)';
  } else {
    ctx.fillStyle = '#0a0a1e';
  }
  ctx.fillRect(0, 0, CS, CS);

  drawGrid();
  if (wallMode) drawWallBorder();
  drawParticles();

  if (state !== 'GAMEOVER') {
    drawSnake();
    drawFruit();
    drawStarFruit();
    drawPUItem();
  }

  if (state === 'COUNTDOWN') {
    drawSnake(); drawFruit();
    drawCountdown();
  } else if (state === 'PLAYING') {
    drawLevelUp();
    drawHint();
  } else if (state === 'PAUSED') {
    drawPaused();
  } else if (state === 'GAMEOVER') {
    drawSnake();
    drawGameOver();
  }

  rafId = requestAnimationFrame(render);
}

/* --- sub-renderers --- */
function drawGrid() {
  ctx.strokeStyle = 'rgba(255,255,255,.028)';
  ctx.lineWidth   = .5;
  for (let i = 1; i < TC; i++) {
    ctx.beginPath(); ctx.moveTo(i * TS, 0); ctx.lineTo(i * TS, CS); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * TS); ctx.lineTo(CS, i * TS); ctx.stroke();
  }
}

function drawWallBorder() {
  ctx.strokeStyle = 'rgba(233,69,96,.5)';
  ctx.lineWidth   = 2;
  ctx.strokeRect(1, 1, CS - 2, CS - 2);
}

function drawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    particles[i].draw(ctx);
    if (particles[i].life <= 0) particles.splice(i, 1);
  }
}

function drawSnake() {
  const hasShield = !!activePU.shield;
  const hasTurbo  = !!activePU.turbo;
  const n = trail.length;
  for (let i = 0; i < n; i++) {
    const t      = trail[i];
    const prog   = i / Math.max(n - 1, 1);   // 0=tail, 1=head
    const isHead = i === n - 1;
    ctx.save();
    if (hasShield) {
      ctx.fillStyle  = isHead ? '#aaddff' : `rgba(100,170,255,${.35 + prog * .65})`;
      ctx.shadowColor = '#44aaff';
      ctx.shadowBlur  = isHead ? 20 : 8;
    } else if (hasTurbo) {
      ctx.fillStyle  = isHead ? '#ffee88' : `rgba(255,${Math.round(120+prog*100)},0,${.4+prog*.6})`;
      ctx.shadowColor = '#ff9900';
      ctx.shadowBlur  = isHead ? 22 : 10;
    } else {
      if (isHead) {
        ctx.fillStyle   = '#b2ffe8';
        ctx.shadowColor = '#4ecca3';
        ctx.shadowBlur  = 22;
      } else {
        const g = Math.round(lerp(80, 204, prog));
        const b = Math.round(lerp(80, 163, prog));
        ctx.fillStyle   = `rgb(30,${g},${b})`;
        ctx.shadowColor = '#4ecca3';
        ctx.shadowBlur  = 7;
      }
    }
    const m = isHead ? 1 : 2;
    const r = isHead ? 5 : 4;
    roundRect(t.x * TS + m, t.y * TS + m, TS - m * 2, TS - m * 2, r);
    ctx.fill();
    ctx.restore();
  }
}

function drawFruit() {
  if (!fruit) return;
  const cx = fruit.x * TS + TS / 2;
  const cy = fruit.y * TS + TS / 2;
  const p  = 1 + Math.sin(Date.now() * .006) * .1;
  ctx.save();
  if      (fruit.type === 'gold')   { ctx.fillStyle = '#ffd700'; ctx.shadowColor = '#ffd700'; }
  else if (fruit.type === 'purple') { ctx.fillStyle = '#c44fff'; ctx.shadowColor = '#c44fff'; }
  else                              { ctx.fillStyle = '#e94560'; ctx.shadowColor = '#e94560'; }
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, (TS / 2 - 3) * p, 0, Math.PI * 2);
  ctx.fill();
  if (fruit.type !== 'normal') {
    ctx.shadowBlur = 0;
    ctx.fillStyle  = 'rgba(0,0,0,.7)';
    ctx.font       = `bold ${TS * .45}px Inter, sans-serif`;
    ctx.textAlign  = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fruit.type === 'gold' ? '3' : '5', cx, cy);
  }
  ctx.restore();
}

function drawStarFruit() {
  if (!starFruit) return;
  starLife -= .004;
  if (starLife <= 0) { starFruit = null; return; }
  const cx = starFruit.x * TS + TS / 2;
  const cy = starFruit.y * TS + TS / 2;
  ctx.save();
  ctx.globalAlpha = starLife;
  ctx.fillStyle   = '#ffd700';
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur  = 22;
  // Draw star
  drawStar(ctx, cx, cy, 5, TS * .42, TS * .18);
  ctx.fill();
  // Timer bar
  ctx.shadowBlur = 0;
  ctx.fillStyle  = 'rgba(255,215,0,.3)';
  ctx.fillRect(starFruit.x * TS, (starFruit.y + 1) * TS - 3, TS * starLife, 3);
  // Label
  ctx.fillStyle  = 'rgba(0,0,0,.7)';
  ctx.font       = `bold ${TS * .4}px Inter, sans-serif`;
  ctx.textAlign  = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('5', cx, cy);
  ctx.restore();
}

function drawPUItem() {
  if (!puItem) return;
  puLife -= .003;
  if (puLife <= 0) { puItem = null; return; }
  const cx  = puItem.x * TS + TS / 2;
  const cy  = puItem.y * TS + TS / 2;
  const p   = 1 + Math.sin(Date.now() * .008) * .15;
  ctx.save();
  ctx.globalAlpha = puLife;
  ctx.fillStyle   = puItem.type.color;
  ctx.shadowColor = puItem.type.color;
  ctx.shadowBlur  = 22 * p;
  ctx.beginPath();
  ctx.arc(cx, cy, (TS / 2 - 2) * p, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.font       = `${TS * .55}px serif`;
  ctx.textAlign  = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(puItem.type.icon, cx, cy);
  // Timer bar
  ctx.fillStyle  = puItem.type.color + '55';
  ctx.fillRect(puItem.x * TS, (puItem.y + 1) * TS - 3, TS * puLife, 3);
  ctx.restore();
}

function drawLevelUp() {
  if (levelUpTimer <= 0) return;
  const alpha = Math.min(levelUpTimer / 25, 1);
  const yOff  = 1 - Math.min(levelUpTimer / 80, 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = '#ffd700';
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur  = 25;
  ctx.font        = `bold 28px Orbitron, sans-serif`;
  ctx.textAlign   = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(`★ NÍVEL ${level} ★`, CS / 2, CS * .25 - yOff * 20);
  ctx.restore();
  levelUpTimer--;
}

function drawHint() {
  const stopped = velocity.x === 0 && velocity.y === 0;
  ctx.fillStyle = 'rgba(200,200,200,.22)';
  ctx.font      = '12px Inter, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  if (stopped) {
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillText('Use as setas ou os botões para começar', 10, CS - 10);
  } else {
    ctx.fillText('ESC: menu   SPACE: pausa', 10, CS - 10);
  }
}

function drawCountdown() {
  ctx.fillStyle = 'rgba(10,10,30,.78)';
  ctx.fillRect(0, 0, CS, CS);
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (countdownNum > 0) {
    ctx.font       = `bold 96px Orbitron, sans-serif`;
    ctx.fillStyle  = '#4ecca3';
    ctx.shadowColor = '#4ecca3';
    ctx.shadowBlur  = 40;
    ctx.fillText(countdownNum, CS / 2, CS / 2);
  } else {
    ctx.font       = `bold 54px Orbitron, sans-serif`;
    ctx.fillStyle  = '#ffd700';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur  = 35;
    ctx.fillText('GO!', CS / 2, CS / 2);
  }
  ctx.restore();
}

function drawPaused() {
  ctx.fillStyle = 'rgba(10,10,30,.72)';
  ctx.fillRect(0, 0, CS, CS);
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle  = '#4ecca3';
  ctx.shadowColor = '#4ecca3';
  ctx.shadowBlur  = 25;
  ctx.font       = `bold 42px Orbitron, sans-serif`;
  ctx.fillText('PAUSA', CS / 2, CS / 2 - 20);
  ctx.shadowBlur = 0;
  ctx.fillStyle  = 'rgba(255,255,255,.45)';
  ctx.font       = '15px Inter, sans-serif';
  ctx.fillText('ESPAÇO para continuar', CS / 2, CS / 2 + 28);
  ctx.restore();
}

function drawGameOver() {
  goAlpha = Math.min(goAlpha + .025, 1);
  ctx.save();
  ctx.globalAlpha = goAlpha * .88;
  ctx.fillStyle   = '#0b0b1a';
  ctx.fillRect(0, 0, CS, CS);
  ctx.globalAlpha = goAlpha;
  ctx.textAlign   = 'center'; ctx.textBaseline = 'middle';
  // Title
  ctx.fillStyle   = '#e94560';
  ctx.shadowColor = '#e94560';
  ctx.shadowBlur  = 22;
  ctx.font        = `bold 42px Orbitron, sans-serif`;
  ctx.fillText('GAME OVER', CS / 2, CS / 2 - 65);
  // Score
  ctx.fillStyle   = '#4ecca3';
  ctx.shadowColor = '#4ecca3';
  ctx.shadowBlur  = 12;
  ctx.font        = `bold 28px Orbitron, sans-serif`;
  ctx.fillText(`${points} pts — Nível ${level}`, CS / 2, CS / 2 - 5);
  // Record
  ctx.fillStyle   = '#ffd700';
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur  = 10;
  ctx.font        = `16px Orbitron, sans-serif`;
  ctx.fillText(`🏆 Recorde: ${record}`, CS / 2, CS / 2 + 38);
  // Hint
  ctx.shadowBlur  = 0;
  ctx.fillStyle   = 'rgba(255,255,255,.45)';
  ctx.font        = '14px Inter, sans-serif';
  ctx.fillText('Pressione ESC para voltar ao menu', CS / 2, CS / 2 + 80);
  ctx.restore();
}

/* ─────────────────────────────────────────────
   STAR SHAPE HELPER
   ───────────────────────────────────────────── */
function drawStar(ctx, cx, cy, spikes, outer, inner) {
  let rot = -Math.PI / 2;
  const step = Math.PI / spikes;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    ctx.lineTo(cx + Math.cos(rot) * r, cy + Math.sin(rot) * r);
    rot += step;
  }
  ctx.closePath();
}

/* ─────────────────────────────────────────────
   INPUT HANDLING
   ───────────────────────────────────────────── */
function handleDir(dir) {
  if (state === 'GAMEOVER') { goToMenu(); return; }
  if (state === 'PAUSED')   { togglePause(); return; }
  if (state !== 'PLAYING')  return;
  switch (dir) {
    case 'up':    if (lastDir !== 'down')  { velocity.x = 0;  velocity.y = -1; } break;
    case 'down':  if (lastDir !== 'up')    { velocity.x = 0;  velocity.y =  1; } break;
    case 'left':  if (lastDir !== 'right') { velocity.x = -1; velocity.y =  0; } break;
    case 'right': if (lastDir !== 'left')  { velocity.x =  1; velocity.y =  0; } break;
  }
  // Visual feedback on dpad
  const map = { up:'btn-up', down:'btn-down', left:'btn-left', right:'btn-right' };
  const btn = document.getElementById(map[dir]);
  if (btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 100); }
}

function onKey(e) {
  if (state === 'MENU') {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startGame(); }
    return;
  }
  if (state === 'GAMEOVER') {
    if (e.key === 'Escape' || e.key === 'Enter') goToMenu();
    return;
  }
  if (state === 'COUNTDOWN') return;
  switch (e.key) {
    case 'ArrowLeft':  case 'a': handleDir('left');  e.preventDefault(); break;
    case 'ArrowRight': case 'd': handleDir('right'); e.preventDefault(); break;
    case 'ArrowUp':    case 'w': handleDir('up');    e.preventDefault(); break;
    case 'ArrowDown':  case 's': handleDir('down');  e.preventDefault(); break;
    case ' ':   togglePause(); e.preventDefault(); break;
    case 'Escape': goToMenu(); e.preventDefault(); break;
  }
}

function syncActionButtons() {
  const resumeBtn = document.getElementById('resume-btn');
  const restartBtn = document.getElementById('restart-btn');

  resumeBtn.classList.toggle('hidden', state !== 'PAUSED');
  restartBtn.classList.toggle('hidden', state !== 'GAMEOVER');
}

function togglePause() {
  if (state === 'PLAYING') {
    state = 'PAUSED';
    document.getElementById('pause-btn').textContent = '▶';
    syncActionButtons();
  } else if (state === 'PAUSED') {
    state = 'PLAYING';
    lastTick = performance.now();
    document.getElementById('pause-btn').textContent = '⏸';
    syncActionButtons();
  }
}

/* ─────────────────────────────────────────────
   COUNTDOWN → START
   ───────────────────────────────────────────── */
function startGame() {
  resetGame();
  MUSIC.start();
  state        = 'COUNTDOWN';
  countdownNum = 3;
  lastTick     = performance.now();
  document.getElementById('menu-screen').classList.remove('active');
  document.getElementById('game-screen').classList.add('active');
  document.getElementById('pause-btn').textContent = '⏸';
  syncActionButtons();
  // Countdown timers
  setTimeout(() => { if (state === 'COUNTDOWN') countdownNum = 2; }, 1000);
  setTimeout(() => { if (state === 'COUNTDOWN') countdownNum = 1; }, 2000);
  setTimeout(() => { if (state === 'COUNTDOWN') countdownNum = 0; }, 3000);
  setTimeout(() => { if (state === 'COUNTDOWN') { state = 'PLAYING'; lastTick = performance.now(); } }, 3500);
}

function goToMenu() {
  MUSIC.stop();
  state = 'MENU';
  document.getElementById('game-screen').classList.remove('active');
  document.getElementById('menu-screen').classList.add('active');
  document.getElementById('pause-btn').textContent = '⏸';
  syncActionButtons();
  updateHUD();
}

/* ─────────────────────────────────────────────
   ANIMATED MENU SNAKE
   ───────────────────────────────────────────── */
function runMenuAnimation() {
  const mc  = document.getElementById('menu-canvas');
  if (!mc) return;
  const mctx = mc.getContext('2d');
  const W = mc.width, H = mc.height;
  const pts = [];
  let t = 0;
  function frame() {
    if (state !== 'MENU') { requestAnimationFrame(frame); return; }
    mctx.fillStyle = 'rgba(11,11,26,.35)';
    mctx.fillRect(0, 0, W, H);
    t += .02;
    // Sinusoidal snake
    const segments = 28;
    for (let i = 0; i < segments; i++) {
      const prog = i / segments;
      const x = (i / segments) * W + 20;
      const y = H / 2 + Math.sin(t + i * .4) * (H * .3);
      const g = Math.round(lerp(60, 204, prog));
      const b = Math.round(lerp(80, 163, prog));
      mctx.fillStyle   = i === segments - 1 ? '#b2ffe8' : `rgb(30,${g},${b})`;
      mctx.shadowColor = '#4ecca3';
      mctx.shadowBlur  = 10;
      mctx.beginPath();
      mctx.arc(x, y, 7 - prog * 2, 0, Math.PI * 2);
      mctx.fill();
    }
    requestAnimationFrame(frame);
  }
  frame();
}

/* ─────────────────────────────────────────────
   INIT
   ───────────────────────────────────────────── */
function init() {
  canv = document.getElementById('gc');
  ctx  = canv.getContext('2d');

  // Load record
  record = parseInt(localStorage.getItem('snakeRecord') || '0');
  document.getElementById('menu-record').textContent = record;
  document.getElementById('hud-record').textContent  = record;

  // Keyboard
  document.addEventListener('keydown', onKey);

  // D-pad buttons
  const dirs = ['up','down','left','right'];
  dirs.forEach(d => {
    document.getElementById(`btn-${d}`).addEventListener('click', () => handleDir(d));
    document.getElementById(`btn-${d}`).addEventListener('touchstart', e => {
      e.preventDefault(); handleDir(d);
    }, { passive: false });
  });

  // Touch swipe on canvas
  canv.addEventListener('touchstart', e => {
    tox = e.touches[0].clientX;
    toy = e.touches[0].clientY;
    e.preventDefault();
  }, { passive: false });
  canv.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tox;
    const dy = e.changedTouches[0].clientY - toy;
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
    if (Math.abs(dx) > Math.abs(dy)) handleDir(dx > 0 ? 'right' : 'left');
    else                              handleDir(dy > 0 ? 'down'  : 'up');
    e.preventDefault();
  }, { passive: false });

  // Sound button
  document.getElementById('sound-btn').addEventListener('click', () => {
    const on = SFX.toggle();
    MUSIC.toggle();
    document.getElementById('sound-btn').textContent = on ? '🔊' : '🔇';
  });

  // Pause / resume actions
  document.getElementById('pause-btn').addEventListener('click', togglePause);
  document.getElementById('resume-btn').addEventListener('click', () => {
    if (state === 'PAUSED') togglePause();
  });
  document.getElementById('restart-btn').addEventListener('click', () => {
    startGame();
  });

  // Play button
  document.getElementById('play-btn').addEventListener('click', startGame);

  // Difficulty buttons
  document.querySelectorAll('[data-difficulty]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-difficulty]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      difficulty = btn.dataset.difficulty;
    });
  });

  // Mode buttons
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      wallMode = btn.dataset.mode === 'walls';
    });
  });

  // Start rendering loop
  rafId = requestAnimationFrame(render);

  // Menu animation
  runMenuAnimation();
}

document.addEventListener('DOMContentLoaded', init);