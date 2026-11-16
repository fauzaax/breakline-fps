// BREAKLINE: boot and the one loop. A fixed 60 Hz simulation (movement, bots, match,
// grenades) feeds rendering at the display's rate. Shooting is resolved here, for the
// player and the bots alike, through one raycast path and one damage path.
// ?shot=start|play|buy|end with &seed=N stages a deterministic frame from the real game
// state, renders it twice, freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, range } from './rng.js';
import { createMap } from './map.js';
import { createMover } from './mover.js';
import { createSoldier, createPlayerHitbox } from './actors.js';
import { createWeaponSet, WEAPONS, damageAt, HEADSHOT_MULT } from './weapons.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createGrenades } from './grenades.js';
import { createBotAI } from './bots.js';
import { createHud } from './hud.js';
import { createMatch, WINS_NEEDED, MAX_ROUNDS, START_MONEY } from './match.js';
import { createInput } from './input.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const map = createMap(scene);
const effects = createEffects(scene);
const grenades = createGrenades(scene, map.colliders);
const audio = createAudio();
const hud = createHud();
const match = createMatch(scene, map, random);
const input = createInput(renderer.domElement, onLockChange);
const weaponSet = createWeaponSet(camera);
const raycaster = new THREE.Raycaster();
raycaster.far = 80;

// --- Actors: the player plus seven bots. One shape, one damage path. ---
const BOT_DEFS = [
  { name: 'Rook', team: 'attack', role: 'site', holdNode: 6, watchNode: 5 },
  { name: 'Iris', team: 'attack', role: 'mid', holdNode: 6, watchNode: 5 },
  { name: 'Dagger', team: 'attack', role: 'lurk', holdNode: 8, watchNode: 9 },
  { name: 'Havoc', team: 'defend', role: 'hold', holdNode: 18, watchNode: 5 },
  { name: 'Mira', team: 'defend', role: 'hold', holdNode: 19, watchNode: 14 },
  { name: 'Sable', team: 'defend', role: 'hold', holdNode: 20, watchNode: 10 },
  { name: 'Kite', team: 'defend', role: 'hold', holdNode: 11, watchNode: 10 },
];

function yawBetween(fromNode, toNode) {
  const a = map.nodes[fromNode];
  const b = map.nodes[toNode];
  return Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));
}

const playerMover = createMover(map.colliders);
const playerHitbox = createPlayerHitbox(scene);
const player = {
  id: 'you', name: 'You', team: 'attack', isPlayer: true, slot: 0,
  mover: playerMover, soldier: null, hitbox: playerHitbox,
  health: 100, armor: 0, alive: true, money: START_MONEY,
  weaponKey: 'P9', frags: 0, smokes: 0, role: 'site', holdNode: 6, holdYaw: 0,
};
playerHitbox.setActor(player);

const actors = [player];
const bots = [];
for (const def of BOT_DEFS) {
  const mover = createMover(map.colliders, { walkSpeed: 4.6 });
  const soldier = createSoldier(scene, def.team);
  const actor = {
    id: def.name.toLowerCase(), name: def.name, team: def.team, isPlayer: false,
    slot: actors.filter((a) => a.team === def.team).length,
    mover, soldier, hitbox: null, health: 100, armor: 0, alive: true, money: 0,
    weaponKey: 'P9', frags: 0, smokes: 0, role: def.role,
    holdNode: def.holdNode, holdYaw: yawBetween(def.holdNode, def.watchNode),
  };
  soldier.setActor(actor);
  actor.ai = createBotAI(actor, { map, random, canSee, shoot: shootBot });
  actors.push(actor);
  bots.push(actor);
}
const attackers = actors.filter((a) => a.team === 'attack');
const defenders = actors.filter((a) => a.team === 'defend');
const teammates = attackers.filter((a) => a !== player);
const botHitMeshes = bots.flatMap((bot) => bot.soldier.hitMeshes);
const playerTargets = map.shootables.concat(botHitMeshes);
const botTargets = map.shootables.concat(botHitMeshes, playerHitbox.hitMeshes);

// --- Shared raycast helpers (reused vectors: no allocation in the hot loop) ---
const tmpOrigin = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpPoint = new THREE.Vector3();
const tmpEye = new THREE.Vector3();
const tmpChest = new THREE.Vector3();
const tmpWish = new THREE.Vector3();
const tmpMuzzle = new THREE.Vector3();

function canSee(viewer, target) {
  viewer.mover.eyePosition(tmpEye);
  tmpChest.set(target.mover.body.position.x, target.mover.body.position.y + 1.05, target.mover.body.position.z);
  const toTarget = tmpDir.subVectors(tmpChest, tmpEye);
  const distance = toTarget.length();
  toTarget.normalize();
  // Generous forward cone: bots notice what is roughly in front of them.
  const facingX = -Math.sin(viewer.mover.body.yaw);
  const facingZ = -Math.cos(viewer.mover.body.yaw);
  if (toTarget.x * facingX + toTarget.z * facingZ < 0) return false;
  raycaster.set(tmpEye, toTarget);
  const hit = raycaster.intersectObjects(map.shootables, false)[0];
  if (hit && hit.distance < distance - 0.4) return false;
  if (grenades.blocksSight(tmpEye, tmpChest)) return false;
  return true;
}

function resolveHit(hit, shooter, stats) {
  const actor = hit.object.userData.actor;
  if (actor && actor.team !== shooter.team && actor.alive) {
    const head = hit.object.userData.part === 'head';
    const damage = damageAt(stats, hit.distance) * (head ? HEADSHOT_MULT : 1);
    match.applyDamage(actor, damage, shooter, { headshot: head, weapon: stats.name });
    if (actor.soldier) actor.soldier.showHit();
    return true;
  }
  if (!actor) {
    tmpPoint.copy(hit.point);
    effects.impact(tmpPoint, tmpDir, 4);
  }
  return false;
}

function shootBot(bot, aimPoint, spread) {
  const stats = WEAPONS[bot.weaponKey];
  bot.mover.eyePosition(tmpOrigin);
  tmpDir.subVectors(aimPoint, tmpOrigin).normalize();
  tmpDir.x += (random() * 2 - 1) * spread;
  tmpDir.y += (random() * 2 - 1) * spread;
  tmpDir.z += (random() * 2 - 1) * spread;
  tmpDir.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(tmpOrigin, tmpDir);
  const hit = raycaster.intersectObjects(botTargets, false)[0];
  bot.soldier.showFlash();
  bot.soldier.group.updateMatrixWorld(true);
  tmpMuzzle.set(0.16, 1.18, -0.7).applyMatrix4(bot.soldier.group.matrixWorld);
  if (hit) {
    resolveHit(hit, bot, stats);
    effects.tracer(tmpMuzzle, hit.point, bot.team === 'defend');
  } else {
    tmpPoint.copy(tmpOrigin).addScaledVector(tmpDir, 60);
    effects.tracer(tmpMuzzle, tmpPoint, bot.team === 'defend');
  }
  const distToPlayer = tmpOrigin.distanceTo(player.mover.body.position);
  audio.shot(stats.kind, distToPlayer);
  match.addSound(bot.mover.body.position.x, bot.mover.body.position.z, 16);
}

// --- Bot loadouts: pistol round first, rifles once the money flows ---
function assignBotLoadouts(round) {
  const table = {
    Rook: round < 2 ? 'P9' : 'KR7',
    Iris: round < 2 ? 'P9' : 'VEX9',
    Dagger: round < 2 ? 'P9' : round < 3 ? 'BREACHER' : 'LONGSHOT',
    Havoc: round < 2 ? 'P9' : 'KR7',
    Mira: round < 2 ? 'P9' : 'VEX9',
    Sable: round < 2 ? 'P9' : 'LONGSHOT',
    Kite: round < 2 ? 'P9' : 'KR7',
  };
  for (const bot of bots) bot.weaponKey = table[bot.name];
}
assignBotLoadouts(1);

// --- Player shooting ---
let started = false;
let frozen = false;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let fov = 74;
let lastPrimary = null;
let throwCooldown = 0;
let stepDistance = 0;
let buyOpen = false;
let shotFired = false;

function playerShoot() {
  const stats = weaponSet.stats();
  if (!weaponSet.pullTrigger()) return;
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  weaponSet.muzzleWorld(tmpMuzzle);
  camera.getWorldDirection(tmpDir);
  const baseDir = tmpDir.clone();
  const speed = playerMover.groundSpeed();
  const spread = weaponSet.spread(speed, !playerMover.body.onGround, playerMover.body.crouching);
  let anyHit = false;
  for (let pellet = 0; pellet < stats.pellets; pellet += 1) {
    tmpDir.copy(baseDir);
    tmpDir.x += (random() * 2 - 1) * spread;
    tmpDir.y += (random() * 2 - 1) * spread;
    tmpDir.z += (random() * 2 - 1) * spread;
    tmpDir.normalize();
    raycaster.set(camera.position, tmpDir);
    const hit = raycaster.intersectObjects(playerTargets, false)[0];
    if (hit) {
      if (resolveHit(hit, player, stats)) anyHit = true;
      effects.tracer(tmpMuzzle, hit.point, false);
    } else {
      tmpPoint.copy(camera.position).addScaledVector(tmpDir, 60);
      effects.tracer(tmpMuzzle, tmpPoint, false);
    }
  }
  playerMover.recoil(stats.kick * (0.8 + random() * 0.4), (random() * 2 - 1) * stats.kick * 0.4);
  audio.shot(stats.kind, 0);
  match.addSound(playerMover.body.position.x, playerMover.body.position.z, 18);
  if (anyHit) shotFired = true;
}

function throwGrenade(type) {
  const count = type === 'frag' ? player.frags : player.smokes;
  if (count <= 0 || throwCooldown > 0) return;
  camera.getWorldDirection(tmpDir);
  tmpOrigin.copy(camera.position).addScaledVector(tmpDir, 0.5);
  tmpOrigin.y -= 0.15;
  if (grenades.throw(tmpOrigin, tmpDir, type, 'attack')) {
    if (type === 'frag') player.frags -= 1;
    else player.smokes -= 1;
    throwCooldown = 0.5;
    audio.click();
  }
}

function buyState() {
  return {
    money: player.money,
    owned: Object.keys(weaponSet.owned),
    current: weaponSet.state.current,
    armor: player.armor,
    frags: player.frags,
    smokes: player.smokes,
  };
}

function refreshBuyMenu() {
  if (buyOpen) hud.showBuy(true, buyState());
}

function handleBuy(kind, key) {
  if (kind === 'close') {
    closeBuyMenu();
    return;
  }
  if (match.state.phase !== 'buy' || !player.alive) return;
  if (kind === 'weapon') {
    const stats = WEAPONS[key];
    if (player.money < stats.price || weaponSet.has(key)) return;
    player.money -= stats.price;
    weaponSet.give(key);
    weaponSet.switchTo(key);
    lastPrimary = key;
    audio.buy();
  } else if (kind === 'armor') {
    if (player.money < 500 || player.armor >= 50) return;
    player.money -= 500;
    player.armor = 50;
    audio.buy();
  } else if (kind === 'frag') {
    if (player.money < 300 || player.frags >= 2) return;
    player.money -= 300;
    player.frags += 1;
    audio.buy();
  } else if (kind === 'smoke') {
    if (player.money < 250 || player.smokes >= 2) return;
    player.money -= 250;
    player.smokes += 1;
    audio.buy();
  }
  refreshBuyMenu();
}

function openBuyMenu() {
  if (match.state.phase !== 'buy' || !player.alive) return;
  buyOpen = true;
  hud.showBuy(true, buyState());
  input.exitLock();
}

function closeBuyMenu() {
  if (!buyOpen) return;
  buyOpen = false;
  hud.showBuy(false);
  if (started && match.state.phase !== 'matchEnd') input.requestLock();
}

hud.onBuy(handleBuy);
hud.onPlay(() => {
  if (shot) return;
  audio.resume();
  if (match.state.phase === 'lobby' || match.state.phase === 'matchEnd') {
    weaponSet.resetToSidearm();
    player.armor = 0;
    player.frags = 0;
    player.smokes = 0;
    lastPrimary = null;
    grenades.reset();
    assignBotLoadouts(1);
    match.startMatch(actors, player);
    started = true;
  }
  hud.hideOverlay();
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (!buyOpen && started && match.state.phase !== 'matchEnd' && match.state.phase !== 'lobby') {
    hud.showOverlay('paused');
  }
}

function syncCamera() {
  const body = playerMover.body;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  const shake = match.state.shake;
  if (shake > 0) {
    camera.position.x += (random() * 2 - 1) * shake * 0.08;
    camera.position.y += (random() * 2 - 1) * shake * 0.08;
  }
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  const wantFov = weaponSet.state.scoped ? 74 / WEAPONS.LONGSHOT.zoom : 74;
  fov += (wantFov - fov) * 0.25;
  if (Math.abs(fov - wantFov) > 0.05) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

function aimAt(point) {
  const body = playerMover.body;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

// --- Per-frame HUD sync from the single match state ---
function syncHud() {
  const state = match.state;
  const slot = weaponSet.slot();
  hud.setHealth(player.health, player.armor);
  hud.setAmmo(slot.mag, slot.reserve, WEAPONS[weaponSet.state.current].name, weaponSet.state.reloadLeft > 0);
  hud.setMoney(player.money);
  hud.setScores(state.winsA, state.winsD, state.round, WINS_NEEDED);
  hud.setGrenades(player.frags, player.smokes);
  if (state.phase === 'buy') hud.setTimer(state.timer, 'BUY PHASE');
  else if (state.charge.planted) hud.setTimer(state.charge.timer, 'CHARGE LIVE');
  else if (state.phase === 'live') hud.setTimer(state.timer, 'ROUND');
  else if (state.phase === 'roundEnd') hud.setTimer(state.timer, 'NEXT ROUND');
  else hud.setTimer(0, 'BREAKLINE');

  const charge = state.charge;
  if (charge.planted) hud.setCharge(`CHARGE PLANTED — SITE ${charge.site}`);
  else if (charge.holder === player) hud.setCharge('YOU CARRY THE CHARGE');
  else if (charge.holder) hud.setCharge(`CHARGE: ${charge.holder.name.toUpperCase()}`);
  else if (charge.dropped) hud.setCharge('CHARGE DOWN — PICK IT UP');
  else hud.setCharge('');

  if (!player.alive && state.phase === 'live') hud.setObjective('You are down — your team fights on.');
  else if (state.phase === 'buy') hud.setObjective('Buy phase — press B for the buy menu, then push with your team.');
  else if (charge.planted) hud.setObjective(`Charge planted at Site ${charge.site} — defend it until it blows.`);
  else if (charge.holder === player) hud.setObjective('Plant the Surge Charge at Site A or Site B.');
  else if (charge.holder) hud.setObjective(`${charge.holder.name} carries the charge — push with them.`);
  else if (charge.dropped) hud.setObjective('The charge is down — walk over it to pick it up.');
  else hud.setObjective('Eliminate the Sentinels or plant the charge.');

  // Objective prompt and channel progress for the player's own hands.
  const inSite = match.siteAt(playerMover.body.position);
  if (player.alive && state.phase === 'live' && !charge.planted && charge.holder === player && inSite) {
    hud.prompt('Hold E to plant the Surge Charge');
  } else {
    hud.prompt(null);
  }
  if (state.plantProgress > 0) hud.progress('PLANTING…', state.plantProgress);
  else hud.progress(null, null);

  const speed = playerMover.groundSpeed();
  hud.setCrosshair(weaponSet.spread(speed, !playerMover.body.onGround, playerMover.body.crouching));
  hud.drawMinimap(player, teammates, charge);
  playerHitbox.sync(playerMover.body.position, playerMover.body.crouching ? 0.65 : 1);
}

// --- Match events become HUD, sound and effects ---
function drainEvents() {
  const state = match.state;
  for (const event of state.events) {
    if (event.type === 'kill') {
      hud.killfeed(event.killer ? event.killer.name : 'Frag', event.victim.name, event.weapon, event.headshot, event.killer ? event.killer.team === 'attack' : true);
    } else if (event.type === 'hitConfirm') {
      hud.hitMarker(event.kill, shot ? 4000 : 90);
      audio.hit(event.kill);
    } else if (event.type === 'hurt' && event.from) {
      const dx = event.from.x - playerMover.body.position.x;
      const dz = event.from.z - playerMover.body.position.z;
      const rel = Math.atan2(-dx, -dz) - playerMover.body.yaw;
      hud.damageFrom(-rel);
      audio.hurt();
    } else if (event.type === 'roundStart') {
      hud.banner(`Round ${event.round}`, `Bots push Site ${event.site} — first to ${WINS_NEEDED} takes the match.`, 'att', 2400);
    } else if (event.type === 'live') {
      audio.roundStart();
      if (buyOpen) closeBuyMenu();
    } else if (event.type === 'planted') {
      hud.banner('CHARGE PLANTED', `Site ${event.site} — defend it until detonation.`, 'att', 2800);
    } else if (event.type === 'roundEnd') {
      const won = event.winner === 'attack';
      hud.banner(won ? 'ROUND WON' : 'ROUND LOST', event.reason, won ? 'att' : 'def', 3200);
      audio.sting(won);
      assignBotLoadouts(Math.min(MAX_ROUNDS, state.round + 1));
    } else if (event.type === 'detonated') {
      effects.explosion(event.position);
      audio.explosion();
      match.addSound(event.position.x, event.position.z, 30);
    } else if (event.type === 'beep') {
      audio.beep(event.fast);
    } else if (event.type === 'matchEnd') {
      const won = event.winner === 'attack';
      hud.showOverlay('match', {
        title: won ? 'Vanguard takes the match' : 'Sentinels take the match',
        copy: `Final score ${state.winsA} — ${state.winsD}. ${won ? 'Helios Relay is yours.' : 'The relay holds. Run it back.'}`,
        action: 'Play again',
      });
      input.exitLock();
    }
  }
  state.events.length = 0;
}

function drainGrenadeEvents() {
  for (const event of grenades.events) {
    if (event.type === 'explode') {
      effects.explosion(event.position);
      audio.explosion();
      match.applyExplosion(event.position, event.team, grenades.fragRadius, grenades.fragDamage, actors);
      match.addSound(event.position.x, event.position.z, 30);
      const dist = event.position.distanceTo(playerMover.body.position);
      if (dist < 18) match.state.shake = Math.max(match.state.shake, 1 - dist / 18);
    }
  }
  grenades.events.length = 0;
}

// --- Bot world views, rebuilt each step from the single match state ---
const worldAttack = { phase: 'lobby', time: 0, charge: null, sounds: [], calledSite: null, siteRoute: [], midRoute: [], lurkRoute: [], siteHoldYaw: 0, nearestDefuser: null, enemies: defenders, allies: attackers };
const worldDefend = { phase: 'lobby', time: 0, charge: null, sounds: [], calledSite: null, siteRoute: [], midRoute: [], lurkRoute: [], siteHoldYaw: 0, nearestDefuser: null, enemies: attackers, allies: defenders };

function refreshWorlds() {
  const state = match.state;
  const site = map.sites[state.calledSite];
  const siteNode = state.calledSite === 'A' ? 6 : 15;
  const holdYaw = yawBetween(siteNode, 11);
  for (const world of [worldAttack, worldDefend]) {
    world.phase = state.phase;
    world.time = elapsed;
    world.charge = state.charge;
    world.sounds = state.sounds;
    world.calledSite = site;
    world.siteRoute = [siteNode];
    world.midRoute = [10, siteNode];
    world.lurkRoute = [8, 9];
    world.siteHoldYaw = holdYaw;
    world.nearestDefuser = state.nearestDefuser;
  }
}

function step(dt) {
  elapsed += dt;
  throwCooldown = Math.max(0, throwCooldown - dt);
  scene.updateMatrixWorld(true);
  const keys = input.state.keys;
  const body = playerMover.body;

  // Player movement wish from keys and facing.
  tmpWish.set(0, 0, 0);
  if (player.alive && input.state.locked && !buyOpen) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      tmpWish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }
  }
  const beforeX = body.position.x;
  const beforeZ = body.position.z;
  if (player.alive) {
    playerMover.step(dt, tmpWish, {
      jump: keys.has('Space') && input.state.locked,
      crouch: keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'),
    });
    stepDistance += Math.hypot(body.position.x - beforeX, body.position.z - beforeZ);
    if (stepDistance > 2.2 && body.onGround && playerMover.groundSpeed() > 1) {
      stepDistance = 0;
      audio.footstep();
    }
  }
  weaponSet.step(dt);

  // Plant channel: E held, holder, in a site.
  const channels = { plant: false, defuse: false };
  if (player.alive && keys.has('KeyE') && input.state.locked) {
    channels.plant = match.state.charge.holder === player && Boolean(match.siteAt(body.position));
  }

  refreshWorlds();
  // Bots act during buy (idle at spawn) and live play; they hold still between rounds.
  if (match.state.phase === 'buy' || match.state.phase === 'live') {
    for (const bot of bots) {
      bot.ai.step(dt, bot.team === 'attack' ? worldAttack : worldDefend);
    }
  }
  match.step(dt, actors, player, channels);
  grenades.step(dt);
  effects.step(dt);
  map.update(dt, elapsed);
  drainEvents();
  drainGrenadeEvents();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    playerMover.look(look.x, look.y);
    const pressed = input.takePressed();
    for (const code of pressed) {
      if (code === 'KeyR' && player.alive && weaponSet.reload()) audio.reload();
      else if (code === 'KeyB') {
        if (buyOpen) closeBuyMenu();
        else openBuyMenu();
      } else if (code === 'KeyM') hud.setMuted(audio.toggleMute());
      else if (buyOpen && code.startsWith('Digit')) {
        const buyKeys = ['VEX9', 'BREACHER', 'KR7', 'LONGSHOT'];
        const index = Number(code.slice(5)) - 1;
        if (index >= 0 && index < 4) handleBuy('weapon', buyKeys[index]);
        else if (code === 'Digit5') handleBuy('armor', 'ARMOR');
        else if (code === 'Digit6') handleBuy('frag', 'FRAG');
        else if (code === 'Digit7') handleBuy('smoke', 'SMOKE');
      } else if (code === 'Digit1' && lastPrimary && weaponSet.switchTo(lastPrimary)) audio.click();
      else if (code === 'Digit2' && weaponSet.switchTo('P9')) audio.click();
      else if (code === 'KeyG' && player.alive) throwGrenade('frag');
      else if (code === 'Digit4' && player.alive) throwGrenade('smoke');
    }
    weaponSet.state.scoped = input.state.aiming && weaponSet.state.current === 'LONGSHOT' && weaponSet.state.reloadLeft === 0;
    if (player.alive && input.state.locked && !buyOpen && match.state.phase !== 'lobby' && match.state.phase !== 'matchEnd') {
      const stats = weaponSet.stats();
      const clickEdge = input.takeClickEdge();
      if (weaponSet.ready() && (stats.auto ? input.state.firing : clickEdge)) playerShoot();
      else if (clickEdge && weaponSet.dryFire()) audio.dryFire();
    } else {
      input.takeClickEdge();
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    syncHud();
  }
  renderer.render(scene, camera);
}

// --- Screenshot staging: the real game, driven to a chosen moment ---
function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function teleportBot(bot, x, z, yaw) {
  bot.mover.teleport(x, 0, z, yaw);
  bot.soldier.group.position.set(x, 0, z);
  bot.soldier.group.rotation.y = yaw;
  bot.ai.ai.state = 'hold';
  bot.ai.ai.holdYaw = yaw;
  bot.ai.ai.route = [map.nearestNode(x, z)];
}

function runShot(name) {
  hud.hideOverlay();
  hud.setMuted(false);
  playerMover.body.pitch = 0;
  playerMover.body.yaw = 0;
  assignBotLoadouts(2);
  match.startMatch(actors, player);
  settle(5);
  drainEvents();
  hud.hideBanner();

  if (name === 'start') {
    // Vista straight down mid: gantry, mid door and mast against the dusk sky.
    playerMover.teleport(0, 0, 13, 0);
    settle(10);
    aimAt(new THREE.Vector3(0, 2.2, -12));
    hud.showOverlay('start');
  } else if (name === 'buy') {
    player.money = 2400;
    playerMover.teleport(-2.5, 0, 15.5, 0);
    settle(10);
    aimAt(new THREE.Vector3(0, 1.4, -6));
    buyOpen = true;
    hud.showBuy(true, buyState());
  } else if (name === 'play') {
    match.state.phase = 'live';
    match.state.timer = 82;
    match.state.winsA = 2;
    match.state.winsD = 1;
    match.state.round = 4;
    player.money = 1150;
    weaponSet.give('KR7');
    weaponSet.switchTo('KR7');
    player.frags = 1;
    player.smokes = 1;
    playerMover.teleport(0, 0, 6.5, 0);
    teleportBot(defenders[0], 1.5, -1.5, Math.PI);
    teleportBot(defenders[1], -3.5, -4.5, Math.PI - 0.4);
    teleportBot(attackers[1], -4, 3.5, 0.3);
    teleportBot(attackers[2], 4.5, 3.5, -0.3);
    settle(24);
    const enemy = defenders[0];
    aimAt(new THREE.Vector3(enemy.mover.body.position.x, 1.2, enemy.mover.body.position.z));
    syncCamera();
    playerShoot();
    settle(1);
    drainEvents();
    hud.hideBanner();
  } else {
    // end: win the round for real — drop every defender, then hold the banner.
    match.state.winsA = 4;
    match.state.winsD = 2;
    match.state.round = 7;
    match.state.phase = 'live';
    match.state.timer = 64;
    weaponSet.give('KR7');
    weaponSet.switchTo('KR7');
    playerMover.teleport(0, 0, 6.5, 0);
    // Defenders in the open mid-lane, all on clear sightlines, so aimed fire drops
    // every one of them; no steps run between shots, so nobody strafes behind cover.
    teleportBot(defenders[0], -4.5, -2, Math.PI);
    teleportBot(defenders[1], -1.5, -2, Math.PI);
    teleportBot(defenders[2], 1.5, -2, Math.PI);
    teleportBot(defenders[3], 4.5, -2, Math.PI);
    settle(10);
    for (const enemy of defenders) {
      weaponSet.refillAll();
      let shots = 0;
      while (enemy.alive && shots < 12) {
        aimAt(new THREE.Vector3(enemy.mover.body.position.x, 1.2, enemy.mover.body.position.z));
        syncCamera();
        weaponSet.state.cooldown = 0;
        playerShoot();
        shots += 1;
      }
    }
    settle(10);
    drainEvents();
    aimAt(new THREE.Vector3(0, 1.4, -9));
    // The banner re-shows the real round-end event (elimination win) persistently.
    if (match.state.phase === 'roundEnd') hud.banner('ROUND WON', 'Sentinels eliminated', 'att', Infinity);
  }
  syncCamera();
  syncHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

playerMover.teleport(-2.5, 0, 15.5, 0);
syncCamera();
syncHud();
hud.showOverlay('start');
// Debug handle for automated play-testing: live match state and actors, plus a
// fast-forward that runs N fixed simulation steps without rendering.
window.__breakline = {
  match, actors, player, map, renderer,
  freeze(value) {
    frozen = value;
  },
  stepN(n) {
    for (let i = 0; i < n; i += 1) step(FIXED_STEP);
    syncCamera();
    syncHud();
  },
};
if (shot) runShot(shot);
else requestAnimationFrame(frame);
