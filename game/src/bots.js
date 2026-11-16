// Bot AI: waypoint routes, hold positions, sight and sound reactions, burst fire and
// objective play. Bots walk the map's waypoint graph (BFS), hold angles, investigate
// gunshots, and plant or defuse the charge. They shoot with the same stats, spread and
// damage rules as the player, and their accuracy drops while they move, like the player's.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { range } from './rng.js';

const PERCEIVE_EVERY = 0.15;
const LOST_SIGHT_TIMEOUT = 2.5;
const ARRIVE_DIST = 0.9;

export function createBotAI(actor, deps) {
  const { map, random } = deps;
  const ai = {
    role: 'hold',
    state: 'route',
    route: [],
    routeIndex: 0,
    path: [],
    pathIndex: 0,
    holdYaw: 0,
    scanPhase: random() * Math.PI * 2,
    target: null,
    lastKnown: new THREE.Vector3(),
    lostTimer: 0,
    reaction: 0,
    perceiveTimer: random() * PERCEIVE_EVERY,
    burstLeft: 0,
    burstPause: 0,
    fireCooldown: 0,
    mag: 12,
    reserve: Infinity,
    reloading: 0,
    strafeDir: 1,
    strafeTimer: 0,
    investigate: null,
    investigateTimer: 0,
    aimYawError: 0,
    aimPitchError: 0,
    repathTimer: 0,
    channeling: null,
    plantedSeen: false,
  };
  const wish = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function currentNodeTarget() {
    if (ai.pathIndex >= ai.path.length) return null;
    const node = map.nodes[ai.path[ai.pathIndex]];
    return tmp.set(node[0], 0, node[1]);
  }

  function pathTo(nodeIndex) {
    const from = map.nearestNode(actor.mover.body.position.x, actor.mover.body.position.z);
    ai.path = map.findPath(from, nodeIndex);
    ai.pathIndex = 0;
    if (ai.path.length > 1) ai.pathIndex = 1;
  }

  function advanceRoute() {
    if (ai.routeIndex >= ai.route.length) return false;
    pathTo(ai.route[ai.routeIndex]);
    ai.routeIndex += 1;
    return true;
  }

  function startRoute(route, holdYaw) {
    ai.route = route.slice();
    ai.routeIndex = 0;
    ai.state = 'route';
    ai.holdYaw = holdYaw;
    advanceRoute();
  }

  function faceToward(point, dt, maxTurn) {
    const body = actor.mover.body;
    const dx = point.x - body.position.x;
    const dz = point.z - body.position.z;
    const want = Math.atan2(-dx, -dz);
    let diff = want - body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = Math.max(-maxTurn * dt, Math.min(maxTurn * dt, diff));
    body.yaw += turn;
    return Math.abs(diff) < 0.08;
  }

  function perceive(dt, world) {
    ai.perceiveTimer -= dt;
    if (ai.perceiveTimer > 0) return;
    ai.perceiveTimer = PERCEIVE_EVERY;
    let best = null;
    let bestDist = Infinity;
    for (const enemy of world.enemies) {
      if (!enemy.alive) continue;
      const dist = actor.mover.body.position.distanceToSquared(enemy.mover.body.position);
      if (dist > 30 * 30) continue;
      if (!deps.canSee(actor, enemy)) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = enemy;
      }
    }
    if (best) {
      if (ai.target !== best) {
        ai.target = best;
        ai.reaction = range(random, 0.25, 0.45);
        ai.aimYawError = range(random, -0.05, 0.05);
        ai.aimPitchError = range(random, -0.03, 0.03);
      }
      ai.lastKnown.copy(best.mover.body.position);
      ai.lostTimer = 0;
    } else if (ai.target) {
      ai.lostTimer += PERCEIVE_EVERY;
      if (ai.lostTimer > LOST_SIGHT_TIMEOUT) {
        ai.target = null;
        decideRoute(world);
      }
    }
  }

  function hear(world) {
    if (ai.target || ai.investigate) return;
    for (const sound of world.sounds) {
      const dx = sound.x - actor.mover.body.position.x;
      const dz = sound.z - actor.mover.body.position.z;
      if (dx * dx + dz * dz < sound.radius * sound.radius) {
        ai.investigate = new THREE.Vector3(sound.x, 0, sound.z);
        ai.investigateTimer = 4;
        ai.state = 'investigate';
        pathTo(map.nearestNode(sound.x, sound.z));
        return;
      }
    }
  }

  function moveAlongPath(dt) {
    const body = actor.mover.body;
    const goal = currentNodeTarget();
    wish.set(0, 0, 0);
    if (!goal) {
      if (!advanceRoute()) {
        ai.state = 'hold';
        return wish;
      }
      return moveAlongPath(dt);
    }
    toTarget.set(goal.x - body.position.x, 0, goal.z - body.position.z);
    const dist = toTarget.length();
    if (dist < ARRIVE_DIST) {
      ai.pathIndex += 1;
      return moveAlongPath(dt);
    }
    toTarget.normalize();
    wish.copy(toTarget);
    faceToward(goal, dt, 6);
    return wish;
  }

  // Aim and fire at the current target: reaction delay, burst fire, reloads, and
  // aim error that grows while moving, like the player's spread. Movement is separate,
  // so a bot can shoot on the move while it keeps pushing a route.
  function combatFire(dt) {
    const body = actor.mover.body;
    const enemy = ai.target;
    const enemyPos = enemy.mover.body.position;
    ai.reaction -= dt;
    const facing = faceToward(enemyPos, dt, 4.5);
    const stats = WEAPONS[actor.weaponKey];
    if (ai.reloading > 0) {
      ai.reloading -= dt;
      if (ai.reloading <= 0) {
        const take = Math.min(stats.mag - ai.mag, ai.reserve);
        ai.mag += take;
        if (Number.isFinite(ai.reserve)) ai.reserve -= take;
      }
      return;
    }
    if (ai.burstPause > 0) {
      ai.burstPause -= dt;
      return;
    }
    if (ai.burstLeft <= 0) {
      ai.burstLeft = stats.kind === 'scatter' ? 1 : Math.floor(range(random, 3, 6));
      ai.aimYawError = range(random, -0.045, 0.045);
      ai.aimPitchError = range(random, -0.025, 0.025);
    }
    ai.fireCooldown -= dt;
    if (ai.reaction <= 0 && facing && ai.fireCooldown <= 0 && ai.mag > 0) {
      ai.fireCooldown = stats.gap * 1.35;
      ai.mag -= 1;
      ai.burstLeft -= 1;
      // Aim at the chest, sometimes the head; error grows while moving, like the player's.
      const headBias = random() < 0.18 ? 1 : 0;
      const aimPoint = tmp.set(
        enemyPos.x,
        enemyPos.y + (headBias ? 1.55 : 1.05) + ai.aimPitchError * 8,
        enemyPos.z,
      );
      const speed = actor.mover.groundSpeed();
      const spread = stats.spread + Math.min(1, speed / 5.2) * stats.moveSpread + 0.012;
      deps.shoot(actor, aimPoint, spread);
      if (ai.mag <= 0) {
        ai.reloading = stats.reload;
        ai.burstLeft = 0;
      } else if (ai.burstLeft <= 0) {
        ai.burstPause = range(random, 0.35, 0.65);
      }
    }
  }

  // Short lateral strafes while fighting up close; sometimes stands still to aim.
  function strafeWish(dt) {
    const body = actor.mover.body;
    const enemyPos = ai.target.mover.body.position;
    ai.strafeTimer -= dt;
    if (ai.strafeTimer <= 0) {
      ai.strafeTimer = range(random, 0.5, 1.1);
      ai.strafeDir = random() < 0.4 ? 0 : -ai.strafeDir;
    }
    toTarget.set(enemyPos.x - body.position.x, 0, enemyPos.z - body.position.z).normalize();
    wish.set(-toTarget.z * ai.strafeDir, 0, toTarget.x * ai.strafeDir);
    return wish;
  }

  function holdScan(dt, world) {
    wish.set(0, 0, 0);
    ai.scanPhase += dt * 0.5;
    const body = actor.mover.body;
    body.yaw = ai.holdYaw + Math.sin(ai.scanPhase) * 0.6;
    return wish;
  }

  function objective(dt, world) {
    // Returns a wish override when the bot is planting or defusing, else null.
    const charge = world.charge;
    const body = actor.mover.body;
    ai.channeling = null;
    if (actor.team === 'attack' && charge.holder === actor && !charge.planted && !charge.exploded) {
      const site = world.calledSite;
      const inZone = body.position.x >= site.minX && body.position.x <= site.maxX
        && body.position.z >= site.minZ && body.position.z <= site.maxZ;
      if (inZone && !ai.target) {
        ai.channeling = 'plant';
        wish.set(0, 0, 0);
        return wish;
      }
    }
    if (actor.team === 'defend' && charge.planted && !charge.exploded && !charge.defused) {
      const dx = charge.position.x - body.position.x;
      const dz = charge.position.z - body.position.z;
      if (dx * dx + dz * dz < 2.2 * 2.2 && !ai.target && world.nearestDefuser === actor) {
        ai.channeling = 'defuse';
        wish.set(0, 0, 0);
        return wish;
      }
    }
    return null;
  }

  function decideRoute(world) {
    const charge = world.charge;
    // Always re-plan from the bot's current position: a previous route may have been
    // consumed or its path replaced by an investigation, so "already on this route"
    // is never a reason to stand still.
    if (actor.team === 'attack') {
      if (charge.planted) {
        // Defend the site that actually holds the charge.
        const siteNode = charge.site === 'A' ? 6 : 15;
        startRoute([siteNode], actor.mover.body.yaw);
        return;
      }
      if (ai.role === 'site') startRoute(world.siteRoute, world.siteHoldYaw);
      else if (ai.role === 'mid') startRoute(world.midRoute, world.siteHoldYaw);
      else startRoute(world.lurkRoute, world.siteHoldYaw);
    } else {
      if (charge.planted) {
        const siteNode = charge.site === 'A' ? 6 : 15;
        startRoute([siteNode], actor.mover.body.yaw);
        return;
      }
      startRoute([ai.holdNode], ai.holdYaw);
    }
  }

  return {
    ai,
    resetForRound(role, holdNode, holdYaw) {
      ai.role = role;
      ai.holdNode = holdNode;
      ai.holdYaw = holdYaw;
      ai.state = 'route';
      ai.route = [];
      ai.path = [];
      ai.target = null;
      ai.investigate = null;
      ai.channeling = null;
      ai.burstLeft = 0;
      ai.burstPause = 0;
      ai.fireCooldown = 0;
      ai.reloading = 0;
      ai.lostTimer = 0;
      ai.plantedSeen = false;
      const stats = WEAPONS[actor.weaponKey];
      ai.mag = stats.mag;
      ai.reserve = stats.reserve;
    },
    step(dt, world) {
      const body = actor.mover.body;
      if (!actor.alive) {
        actor.soldier.die(dt);
        return;
      }
      if (world.phase === 'buy') {
        actor.soldier.animate(dt, 0, body.yaw);
        return;
      }
      perceive(dt, world);
      hear(world);
      // A fresh plan at round start, and a new one the moment the charge is planted.
      if (world.charge.planted !== ai.plantedSeen) {
        ai.plantedSeen = world.charge.planted;
        decideRoute(world);
      }
      if (ai.state === 'route' && ai.route.length === 0) decideRoute(world);
      const channelWish = objective(dt, world);
      let moveWish;
      if (channelWish) {
        moveWish = channelWish;
      } else if (ai.target) {
        // Fight: up close, strafe and stand to aim; at range, keep pushing the route
        // while firing on the move instead of stalling in the open.
        combatFire(dt);
        const dist = body.position.distanceTo(ai.target.mover.body.position);
        if (dist < 22 || ai.state === 'hold' || ai.state === 'engage') {
          ai.state = 'engage';
          moveWish = strafeWish(dt);
        } else {
          moveWish = moveAlongPath(dt);
        }
      } else if (actor.team === 'attack' && world.charge.dropped && !world.charge.planted) {
        // Fetch the dropped charge: walk straight at it until the match hands it over.
        const charge = world.charge;
        toTarget.set(charge.position.x - body.position.x, 0, charge.position.z - body.position.z);
        if (toTarget.length() > 1) {
          toTarget.normalize();
          wish.copy(toTarget);
          faceToward(charge.position, dt, 6);
          moveWish = wish;
        } else {
          moveWish = holdScan(dt, world);
        }
      } else if (ai.state === 'investigate' && ai.investigate) {
        ai.investigateTimer -= dt;
        moveWish = moveAlongPath(dt);
        // Done when the walk ends (the nearest node is the destination: the sound's
        // exact point may sit metres past it) or the timer runs out — either way the
        // bot takes a fresh plan instead of idling on a stale investigation.
        if (ai.state === 'hold' || ai.investigateTimer <= 0) {
          ai.investigate = null;
          decideRoute(world);
        }
      } else if (ai.state === 'route') {
        moveWish = moveAlongPath(dt);
      } else {
        moveWish = holdScan(dt, world);
      }
      // Gentle separation so bots do not stack on one waypoint.
      for (const ally of world.allies) {
        if (ally === actor || !ally.alive) continue;
        const dx = body.position.x - ally.mover.body.position.x;
        const dz = body.position.z - ally.mover.body.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < 0.64 && distSq > 0.0001) {
          const dist = Math.sqrt(distSq);
          moveWish.x += (dx / dist) * 0.7;
          moveWish.z += (dz / dist) * 0.7;
        }
      }
      if (moveWish.lengthSq() > 1) moveWish.normalize();
      actor.mover.step(dt, moveWish, { speed: 4.6 });
      actor.soldier.group.position.copy(body.position);
      const moving = Math.min(1, actor.mover.groundSpeed() / 4.6);
      actor.soldier.animate(dt, moving, body.yaw);
      // Unstick: if routing but barely moving for a while, re-path.
      ai.repathTimer += dt;
      if (ai.state === 'route' && ai.repathTimer > 1.2) {
        ai.repathTimer = 0;
        if (actor.mover.groundSpeed() < 0.4 && ai.path.length > 0) {
          pathTo(ai.path[ai.path.length - 1]);
        }
      }
    },
  };
}
