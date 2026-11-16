// The match: one state object for the whole game. Rounds, the buy phase, the round timer,
// the Surge Charge (carry, drop, pick up, plant, defuse, detonate), money, win conditions
// and the sound events bots hear. Damage and death also live here, so every kill — player
// or bot, bullet or grenade — goes through the same armour, kill-feed and economy rules.
import * as THREE from 'three';

export const BUY_SECONDS = 15;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 4;
export const DEFUSE_SECONDS = 5;
export const CHARGE_SECONDS = 30;
export const WINS_NEEDED = 5;
export const MAX_ROUNDS = 9;
export const KILL_REWARD = 300;
export const WIN_REWARD = 1400;
export const LOSS_REWARD = 1000;
export const START_MONEY = 800;

export function createMatch(scene, map, random) {
  // The Surge Charge: a dark case with a blinking lamp, hidden while carried.
  const chargeGroup = new THREE.Group();
  const caseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.24, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.5, metalness: 0.5 }),
  );
  caseMesh.position.y = 0.12;
  caseMesh.castShadow = true;
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff5a3c }),
  );
  lamp.position.set(0.12, 0.28, 0);
  chargeGroup.add(caseMesh, lamp);
  chargeGroup.visible = false;
  scene.add(chargeGroup);

  const state = {
    phase: 'lobby',
    round: 1,
    winsA: 0,
    winsD: 0,
    timer: 0,
    calledSite: 'A',
    plantProgress: 0,
    defuseProgress: 0,
    shake: 0,
    nearestDefuser: null,
    charge: {
      holder: null,
      planted: false,
      defused: false,
      exploded: false,
      dropped: false,
      site: null,
      position: new THREE.Vector3(),
      timer: 0,
    },
    sounds: [],
    events: [],
  };
  let nextBeep = 0;
  let blinkPhase = 0;

  function resetCharge(holder) {
    const charge = state.charge;
    charge.holder = holder;
    charge.planted = false;
    charge.defused = false;
    charge.exploded = false;
    charge.dropped = false;
    charge.site = null;
    charge.timer = 0;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    chargeGroup.visible = false;
  }

  function siteAt(position) {
    for (const id of ['A', 'B']) {
      const site = map.sites[id];
      if (position.x >= site.minX && position.x <= site.maxX && position.z >= site.minZ && position.z <= site.maxZ) return site;
    }
    return null;
  }

  function aliveCount(actors, team) {
    let count = 0;
    for (const actor of actors) if (actor.team === team && actor.alive) count += 1;
    return count;
  }

  function endRound(actors, winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.phase = 'roundEnd';
    state.timer = 4;
    if (winner === 'attack') state.winsA += 1;
    else state.winsD += 1;
    const player = actors.find((actor) => actor.isPlayer);
    if (player) {
      player.money += winner === 'attack' ? WIN_REWARD : LOSS_REWARD;
    }
    state.events.push({ type: 'roundEnd', winner, reason, winsA: state.winsA, winsD: state.winsD });
  }

  function checkWinConditions(actors) {
    if (state.phase !== 'live') return;
    const attackers = aliveCount(actors, 'attack');
    const defenders = aliveCount(actors, 'defend');
    if (defenders === 0) {
      endRound(actors, 'attack', 'Sentinels eliminated');
      return;
    }
    if (attackers === 0 && !state.charge.planted) {
      endRound(actors, 'defend', 'Vanguard eliminated');
    }
  }

  const match = {
    state,
    siteAt,
    addSound(x, z, radius) {
      state.sounds.push({ x, z, radius, age: 0 });
    },
    startMatch(actors, player) {
      state.winsA = 0;
      state.winsD = 0;
      state.round = 1;
      player.money = START_MONEY;
      match.startRound(actors, player);
    },
    startRound(actors, player) {
      state.calledSite = random() < 0.5 ? 'A' : 'B';
      state.phase = 'buy';
      state.timer = BUY_SECONDS;
      state.sounds.length = 0;
      state.shake = 0;
      resetCharge(player);
      for (const actor of actors) {
        actor.alive = true;
        actor.health = 100;
        const spawns = map.spawns[actor.team];
        const spawn = spawns[actor.slot % spawns.length];
        actor.mover.teleport(spawn.x, spawn.y, spawn.z, actor.team === 'attack' ? 0 : Math.PI);
        if (actor.soldier) {
          actor.soldier.reset();
          actor.soldier.group.position.copy(spawn);
        }
        if (actor.ai) actor.ai.resetForRound(actor.role, actor.holdNode, actor.holdYaw);
      }
      state.events.push({ type: 'roundStart', round: state.round, site: state.calledSite });
    },
    applyDamage(target, amount, attacker, info = {}) {
      if (!target.alive || state.phase === 'lobby' || state.phase === 'matchEnd') return 0;
      let dealt = amount;
      if (target.armor > 0) {
        const absorbed = Math.min(target.armor, dealt * 0.5);
        target.armor -= absorbed;
        dealt -= absorbed;
      }
      target.health -= dealt;
      if (target.isPlayer) {
        state.events.push({ type: 'hurt', from: attacker ? attacker.mover.body.position.clone() : null, amount: dealt });
      }
      if (attacker && attacker.isPlayer) {
        state.events.push({ type: 'hitConfirm', kill: target.health <= 0, headshot: Boolean(info.headshot) });
      }
      if (target.health <= 0) {
        target.alive = false;
        target.health = 0;
        if (state.charge.holder === target && !state.charge.planted) {
          state.charge.holder = null;
          state.charge.dropped = true;
          state.charge.position.copy(target.mover.body.position);
          chargeGroup.visible = true;
          chargeGroup.position.copy(state.charge.position);
        }
        if (attacker && attacker.isPlayer && attacker.team !== target.team) {
          attacker.money += KILL_REWARD;
        }
        state.events.push({
          type: 'kill', killer: attacker, victim: target,
          weapon: info.weapon || 'KR-7', headshot: Boolean(info.headshot),
        });
        if (target.soldier) {
          target.soldier.group.rotation.x = 0;
          target.soldier.fall = 0;
        }
      }
      return dealt;
    },
    applyExplosion(position, team, radius, baseDamage, actors) {
      for (const actor of actors) {
        if (!actor.alive || actor.team === team) continue;
        const dist = actor.mover.body.position.distanceTo(position);
        if (dist > radius) continue;
        const falloff = 1 - (dist / radius) * 0.7;
        match.applyDamage(actor, baseDamage * falloff, null, { weapon: 'Frag' });
      }
    },
    step(dt, actors, player, channels) {
      // channels: { plant: boolean, defuse: boolean } — the player's held channels; bot
      // channels are read from their AI state.
      state.shake = Math.max(0, state.shake - dt * 2.2);
      for (let i = state.sounds.length - 1; i >= 0; i -= 1) {
        state.sounds[i].age += dt;
        if (state.sounds[i].age > 3) state.sounds.splice(i, 1);
      }

      if (state.phase === 'buy') {
        state.timer -= dt;
        if (state.timer <= 0) {
          state.phase = 'live';
          state.timer = ROUND_SECONDS;
          state.events.push({ type: 'live' });
        }
        return;
      }
      if (state.phase === 'roundEnd') {
        state.timer -= dt;
        if (state.timer <= 0) {
          if (state.winsA >= WINS_NEEDED || state.winsD >= WINS_NEEDED || state.round >= MAX_ROUNDS) {
            state.phase = 'matchEnd';
            state.events.push({ type: 'matchEnd', winner: state.winsA > state.winsD ? 'attack' : 'defend' });
          } else {
            state.round += 1;
            match.startRound(actors, player);
          }
        }
        return;
      }
      if (state.phase !== 'live') return;

      const charge = state.charge;

      // Dropped charge pickup: any living attacker walking over it takes it.
      if (charge.dropped && !charge.planted) {
        for (const actor of actors) {
          if (actor.team !== 'attack' || !actor.alive) continue;
          const dx = actor.mover.body.position.x - charge.position.x;
          const dz = actor.mover.body.position.z - charge.position.z;
          if (dx * dx + dz * dz < 1.6 * 1.6) {
            charge.holder = actor;
            charge.dropped = false;
            chargeGroup.visible = false;
            state.events.push({ type: 'pickup', actor });
            break;
          }
        }
      }

      // Plant channel: the holder standing in a site, uninterrupted.
      let planting = false;
      if (!charge.planted && charge.holder && charge.holder.alive) {
        const holder = charge.holder;
        const site = siteAt(holder.mover.body.position);
        const wants = holder.isPlayer ? channels.plant : holder.ai && holder.ai.ai.channeling === 'plant';
        if (site && wants) {
          planting = true;
          state.plantProgress += dt / PLANT_SECONDS;
          if (state.plantProgress >= 1) {
            charge.planted = true;
            charge.site = site.id;
            charge.position.copy(holder.mover.body.position);
            charge.timer = CHARGE_SECONDS;
            charge.holder = null;
            state.plantProgress = 0;
            nextBeep = 0;
            chargeGroup.visible = true;
            chargeGroup.position.copy(charge.position);
            state.events.push({ type: 'planted', site: site.id, actor: holder });
          }
        }
      }
      if (!planting) state.plantProgress = 0;

      // Defuse channel: the nearest living defender beside the planted charge.
      let defusing = false;
      if (charge.planted && !charge.defused && !charge.exploded) {
        let nearest = null;
        let nearestDist = Infinity;
        for (const actor of actors) {
          if (actor.team !== 'defend' || !actor.alive) continue;
          const dist = actor.mover.body.position.distanceToSquared(charge.position);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = actor;
          }
        }
        state.nearestDefuser = nearest;
        if (nearest && nearestDist < 2.2 * 2.2) {
          const wants = nearest.isPlayer ? channels.defuse : nearest.ai && nearest.ai.ai.channeling === 'defuse';
          if (wants) {
            defusing = true;
            state.defuseProgress += dt / DEFUSE_SECONDS;
            if (state.defuseProgress >= 1) {
              charge.defused = true;
              state.defuseProgress = 0;
              state.events.push({ type: 'defused', actor: nearest });
              endRound(actors, 'defend', 'Charge defused');
            }
          }
        }
      }
      if (!defusing) state.defuseProgress = 0;

      // Charge countdown, accelerating beeps, detonation.
      if (charge.planted && !charge.defused && !charge.exploded) {
        charge.timer -= dt;
        nextBeep -= dt;
        if (nextBeep <= 0) {
          const urgency = 1 - charge.timer / CHARGE_SECONDS;
          nextBeep = 0.9 - urgency * 0.78;
          state.events.push({ type: 'beep', fast: urgency > 0.6 });
        }
        blinkPhase += dt * (4 + (1 - charge.timer / CHARGE_SECONDS) * 14);
        lamp.material.color.setHex(Math.sin(blinkPhase) > 0 ? 0xff5a3c : 0x571512);
        if (charge.timer <= 0) {
          charge.exploded = true;
          state.shake = 1;
          chargeGroup.visible = false;
          state.events.push({ type: 'detonated', position: charge.position.clone() });
          endRound(actors, 'attack', 'Charge detonated');
        }
      } else if (charge.dropped) {
        blinkPhase += dt * 2;
        lamp.material.color.setHex(Math.sin(blinkPhase) > 0 ? 0xff5a3c : 0x571512);
      }

      // Round clock (only while nothing is planted).
      if (!charge.planted) {
        state.timer -= dt;
        if (state.timer <= 0) {
          state.timer = 0;
          endRound(actors, 'defend', 'Time expired');
        }
      }

      checkWinConditions(actors);
    },
  };
  return match;
}
