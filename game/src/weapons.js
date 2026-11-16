// Weapons: one stats table, one view-model builder, one runtime. Every gun is hitscan;
// grenades live in grenades.js. Bots read the same stats table, so a bot's KR-7 and the
// player's KR-7 are the same weapon. Spread punishes moving and rewards stopping to aim:
// base spread is tiny standing still, grows with speed and with each shot (bloom), and
// shrinks while crouched or scoped.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const HEADSHOT_MULT = 2.5;

export const WEAPONS = {
  P9: {
    name: 'P9', kind: 'sidearm', price: 0, auto: false, damage: 26, pellets: 1,
    mag: 12, reserve: Infinity, gap: 0.16, reload: 1.25, spread: 0.004, moveSpread: 0.02,
    bloom: 0.003, falloffNear: 14, falloffFar: 34, falloffMin: 0.6, kick: 0.008, zoom: 1,
  },
  KR7: {
    name: 'KR-7', kind: 'rifle', price: 2200, auto: true, damage: 30, pellets: 1,
    mag: 30, reserve: 90, gap: 0.096, reload: 1.9, spread: 0.0022, moveSpread: 0.028,
    bloom: 0.0022, falloffNear: 18, falloffFar: 40, falloffMin: 0.65, kick: 0.011, zoom: 1,
  },
  VEX9: {
    name: 'Vex-9', kind: 'smg', price: 900, auto: true, damage: 20, pellets: 1,
    mag: 40, reserve: 120, gap: 0.07, reload: 1.6, spread: 0.006, moveSpread: 0.026,
    bloom: 0.0018, falloffNear: 12, falloffFar: 30, falloffMin: 0.55, kick: 0.007, zoom: 1,
  },
  BREACHER: {
    name: 'Breacher', kind: 'scatter', price: 1100, auto: false, damage: 9, pellets: 8,
    mag: 6, reserve: 24, gap: 0.8, reload: 2.3, spread: 0.045, moveSpread: 0.02,
    bloom: 0.004, falloffNear: 6, falloffFar: 20, falloffMin: 0.25, kick: 0.03, zoom: 1,
  },
  LONGSHOT: {
    name: 'Longshot', kind: 'marksman', price: 3200, auto: false, damage: 95, pellets: 1,
    mag: 5, reserve: 15, gap: 0.9, reload: 2.4, spread: 0.0012, moveSpread: 0.05,
    bloom: 0.01, falloffNear: 30, falloffFar: 60, falloffMin: 0.85, kick: 0.035, zoom: 2.6,
  },
};

export const BUY_ORDER = ['VEX9', 'BREACHER', 'KR7', 'LONGSHOT'];

// Falloff: full damage inside falloffNear, linear down to falloffMin at falloffFar.
export function damageAt(stats, distance) {
  if (distance <= stats.falloffNear) return stats.damage;
  if (distance >= stats.falloffFar) return stats.damage * stats.falloffMin;
  const t = (distance - stats.falloffNear) / (stats.falloffFar - stats.falloffNear);
  return stats.damage * (1 - t * (1 - stats.falloffMin));
}

const GRIP = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.75, metalness: 0.15 });
const BODY = new THREE.MeshStandardMaterial({ color: 0x4c4f55, roughness: 0.45, metalness: 0.5 });
const ACCENT = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.amber), roughness: 0.5, metalness: 0.3 });
const TEAL = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.5, metalness: 0.3 });

function part(width, height, depth, x, y, z, material, parent) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// Box-built view models, one per weapon. Each returns { group, muzzle } where muzzle is
// the local offset the flash and tracer start from.
function buildModel(key) {
  const group = new THREE.Group();
  let muzzle = new THREE.Vector3(0, 0.02, -0.6);
  if (key === 'P9') {
    part(0.05, 0.06, 0.24, 0, 0, 0, BODY, group);
    part(0.045, 0.1, 0.07, 0, -0.07, 0.08, GRIP, group);
    part(0.02, 0.02, 0.06, 0, 0.04, -0.1, ACCENT, group);
    muzzle = new THREE.Vector3(0, 0.01, -0.16);
  } else if (key === 'KR7') {
    part(0.09, 0.1, 0.42, 0, 0, 0, BODY, group);
    part(0.045, 0.045, 0.4, 0, 0.025, -0.38, GRIP, group);
    part(0.075, 0.08, 0.22, 0, -0.02, 0.3, GRIP, group);
    part(0.03, 0.05, 0.12, 0, -0.07, -0.12, GRIP, group);
    part(0.02, 0.02, 0.1, 0, 0.06, -0.05, ACCENT, group);
    muzzle = new THREE.Vector3(0, 0.025, -0.6);
  } else if (key === 'VEX9') {
    part(0.08, 0.09, 0.3, 0, 0, 0, BODY, group);
    part(0.04, 0.04, 0.22, 0, 0.02, -0.24, GRIP, group);
    part(0.05, 0.14, 0.06, 0, -0.1, -0.02, GRIP, group);
    part(0.06, 0.06, 0.16, 0, -0.01, 0.22, GRIP, group);
    muzzle = new THREE.Vector3(0, 0.02, -0.38);
  } else if (key === 'BREACHER') {
    part(0.1, 0.09, 0.34, 0, 0, 0, BODY, group);
    part(0.07, 0.07, 0.3, 0, 0.01, -0.3, GRIP, group);
    part(0.05, 0.05, 0.3, 0, -0.05, -0.28, BODY, group);
    part(0.08, 0.07, 0.2, 0, -0.02, 0.26, GRIP, group);
    muzzle = new THREE.Vector3(0, 0.01, -0.48);
  } else {
    part(0.08, 0.09, 0.5, 0, 0, 0, BODY, group);
    part(0.04, 0.04, 0.5, 0, 0.02, -0.48, GRIP, group);
    part(0.05, 0.06, 0.16, 0, 0.08, -0.05, TEAL, group);
    part(0.07, 0.07, 0.24, 0, -0.02, 0.34, GRIP, group);
    part(0.04, 0.1, 0.05, 0, -0.08, 0.05, GRIP, group);
    muzzle = new THREE.Vector3(0, 0.02, -0.75);
  }
  return { group, muzzle };
}

export function createWeaponSet(camera) {
  const models = {};
  for (const key of Object.keys(WEAPONS)) {
    const built = buildModel(key);
    built.group.position.set(0.24, -0.2, -0.42);
    built.group.visible = false;
    camera.add(built.group);
    models[key] = built;
  }
  models.P9.group.visible = true;

  // A dim warm light at the camera so the view model reads against the dusk scene.
  const viewLight = new THREE.PointLight(new THREE.Color(0xffd9a8), 1.6, 3.5);
  viewLight.position.set(0.1, 0.1, -0.4);
  camera.add(viewLight);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.amber), 0, 6);
  camera.add(flashLight);

  const owned = { P9: { key: 'P9', mag: WEAPONS.P9.mag, reserve: WEAPONS.P9.reserve } };
  const state = {
    current: 'P9', cooldown: 0, reloadLeft: 0, reloadTime: 1, flash: 0, kick: 0,
    bloom: 0, scoped: false, switching: 0,
  };

  function currentStats() {
    return WEAPONS[state.current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bloom = Math.max(0, state.bloom - dt * 0.03);
    state.switching = Math.max(0, state.switching - dt);
    const model = models[state.current].group;
    const baseZ = -0.42 + state.kick;
    if (state.scoped && state.current === 'LONGSHOT') {
      model.position.set(0, -0.148, -0.34 + state.kick);
    } else {
      model.position.set(0.24, -0.2 + (state.switching > 0 ? -0.08 * state.switching * 4 : 0), baseZ);
    }
    model.rotation.x = state.kick * 2.2;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const progress = 1 - state.reloadLeft / state.reloadTime;
      model.rotation.x = -0.6 * Math.sin(progress * Math.PI);
      model.position.y -= 0.06 * Math.sin(progress * Math.PI);
      if (state.reloadLeft === 0) {
        const slot = owned[state.current];
        const need = currentStats().mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        if (Number.isFinite(slot.reserve)) slot.reserve -= take;
      }
    }
    const muzzle = models[state.current].muzzle;
    flash.position.set(model.position.x + muzzle.x, model.position.y + muzzle.y, model.position.z + muzzle.z);
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.position.copy(flash.position);
    flashLight.intensity = state.flash > 0 ? 16 : 0;
  }

  return {
    state,
    owned,
    step,
    stats() {
      return currentStats();
    },
    slot() {
      return owned[state.current];
    },
    has(key) {
      return Boolean(owned[key]);
    },
    give(key) {
      owned[key] = { key, mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
    },
    refillAll() {
      for (const key of Object.keys(owned)) {
        owned[key].mag = WEAPONS[key].mag;
        owned[key].reserve = WEAPONS[key].reserve;
      }
      state.reloadLeft = 0;
      state.cooldown = 0;
      state.bloom = 0;
    },
    resetToSidearm() {
      for (const key of Object.keys(owned)) if (key !== 'P9') delete owned[key];
      owned.P9 = { key: 'P9', mag: WEAPONS.P9.mag, reserve: WEAPONS.P9.reserve };
      this.switchTo('P9');
      state.reloadLeft = 0;
      state.cooldown = 0;
    },
    switchTo(key) {
      if (!owned[key] || key === state.current) return false;
      models[state.current].group.visible = false;
      state.current = key;
      models[key].group.visible = true;
      state.reloadLeft = 0;
      state.scoped = false;
      state.switching = 0.22;
      return true;
    },
    ready() {
      return owned[state.current].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.switching === 0;
    },
    dryFire() {
      return owned[state.current].mag === 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      const slot = owned[state.current];
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      state.cooldown = currentStats().gap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(0.05, state.bloom + currentStats().bloom);
      return true;
    },
    reload() {
      const slot = owned[state.current];
      const stats = currentStats();
      if (state.reloadLeft > 0 || slot.mag === stats.mag || slot.reserve === 0) return false;
      state.reloadLeft = stats.reload;
      state.reloadTime = stats.reload;
      state.scoped = false;
      return true;
    },
    spread(speed, airborne, crouching) {
      const stats = currentStats();
      let value = stats.spread + state.bloom;
      value += Math.min(1, speed / 5.2) * stats.moveSpread;
      if (airborne) value += 0.02;
      if (crouching) value *= 0.7;
      if (state.scoped) value *= 0.25;
      return value;
    },
    muzzleWorld(out) {
      const model = models[state.current].group;
      const muzzle = models[state.current].muzzle;
      out.set(model.position.x + muzzle.x, model.position.y + muzzle.y, model.position.z + muzzle.z);
      return camera.localToWorld(out);
    },
  };
}
