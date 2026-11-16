// Grenades: frags arc with gravity, bounce off the map and detonate for area damage;
// smokes bloom into a particle cloud that blocks bot line-of-sight. A throw is one
// object from a small pool; step() returns detonation events for the match to resolve.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const GRAVITY = 18;
const RESTITUTION = 0.45;
const FRAG_FUSE = 2.1;
const FRAG_RADIUS = 6.5;
const FRAG_DAMAGE = 115;
const SMOKE_FUSE = 1.1;
const SMOKE_RADIUS = 3.1;
const SMOKE_LIFE = 12;
const POOL = 6;

function puffTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  gradient.addColorStop(0, 'rgba(235, 230, 220, 0.85)');
  gradient.addColorStop(0.55, 'rgba(210, 205, 195, 0.5)');
  gradient.addColorStop(1, 'rgba(200, 195, 185, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createGrenades(scene, colliders) {
  const texture = puffTexture();
  const fragGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const fragMat = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.5, metalness: 0.5 });
  const smokeGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.22, 10);
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.6, metalness: 0.3 });
  const probe = new THREE.Box3();
  const items = [];
  const smokes = [];
  const events = [];

  for (let i = 0; i < POOL; i += 1) {
    const frag = new THREE.Mesh(fragGeo, fragMat);
    const can = new THREE.Mesh(smokeGeo, smokeMat);
    frag.visible = false;
    can.visible = false;
    scene.add(frag, can);
    items.push({ active: false, type: 'frag', mesh: frag, can, position: new THREE.Vector3(), velocity: new THREE.Vector3(), fuse: 0, team: 'attack', restTime: 0 });
  }

  function makeCloud(center) {
    const count = 46;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const r = SMOKE_RADIUS * (0.35 + Math.random() * 0.65);
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      positions[i * 3 + 1] = Math.abs(Math.cos(phi)) * r * 0.75 + 0.3;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      map: texture, size: 2.6, transparent: true, opacity: 0,
      depthWrite: false, color: new THREE.Color(PALETTE.ink), sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.position.copy(center);
    points.position.y = Math.max(0.4, center.y);
    scene.add(points);
    return { points, material, center: points.position.clone(), radius: SMOKE_RADIUS, life: SMOKE_LIFE, age: 0 };
  }

  function overlaps(x, y, z) {
    probe.min.set(x - 0.12, y - 0.12, z - 0.12);
    probe.max.set(x + 0.12, y + 0.12, z + 0.12);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  return {
    events,
    fragRadius: FRAG_RADIUS,
    fragDamage: FRAG_DAMAGE,
    throw(origin, direction, type, team) {
      const slot = items.find((item) => !item.active);
      if (!slot) return false;
      slot.active = true;
      slot.type = type;
      slot.team = team;
      slot.position.copy(origin);
      slot.velocity.copy(direction).multiplyScalar(14);
      slot.velocity.y += 3.2;
      slot.fuse = type === 'frag' ? FRAG_FUSE : SMOKE_FUSE;
      slot.restTime = 0;
      slot.mesh.visible = type === 'frag';
      slot.can.visible = type === 'smoke';
      slot.mesh.position.copy(origin);
      slot.can.position.copy(origin);
      return true;
    },
    blocksSight(a, b) {
      // Segment-sphere test against every live smoke cloud.
      for (const smoke of smokes) {
        if (smoke.age < 0.4 || smoke.life <= 0) continue;
        const cx = smoke.center.x;
        const cy = smoke.center.y + 1;
        const cz = smoke.center.z;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const lengthSq = dx * dx + dy * dy + dz * dz || 1;
        let t = ((cx - a.x) * dx + (cy - a.y) * dy + (cz - a.z) * dz) / lengthSq;
        t = Math.max(0, Math.min(1, t));
        const px = a.x + dx * t - cx;
        const py = a.y + dy * t - cy;
        const pz = a.z + dz * t - cz;
        if (px * px + py * py + pz * pz < smoke.radius * smoke.radius) return true;
      }
      return false;
    },
    step(dt) {
      for (const slot of items) {
        if (!slot.active) continue;
        slot.fuse -= dt;
        slot.velocity.y -= GRAVITY * dt;
        const pos = slot.position;
        const vel = slot.velocity;
        // Axis-separated bounce against the map.
        pos.x += vel.x * dt;
        if (overlaps(pos.x, pos.y, pos.z)) {
          pos.x -= vel.x * dt;
          vel.x *= -RESTITUTION;
          vel.y *= 0.8;
          vel.z *= 0.8;
        }
        pos.z += vel.z * dt;
        if (overlaps(pos.x, pos.y, pos.z)) {
          pos.z -= vel.z * dt;
          vel.z *= -RESTITUTION;
          vel.x *= 0.8;
          vel.y *= 0.8;
        }
        pos.y += vel.y * dt;
        if (pos.y < 0.12) {
          pos.y = 0.12;
          if (Math.abs(vel.y) > 1.2) vel.y *= -RESTITUTION;
          else vel.y = 0;
          vel.x *= 0.7;
          vel.z *= 0.7;
        } else if (overlaps(pos.x, pos.y, pos.z)) {
          pos.y -= vel.y * dt;
          vel.y *= -RESTITUTION;
          vel.x *= 0.8;
          vel.z *= 0.8;
        }
        if (vel.lengthSq() < 0.64) slot.restTime += dt;
        else slot.restTime = 0;
        slot.mesh.position.copy(pos);
        slot.can.position.copy(pos);
        if (slot.type === 'frag' && slot.fuse <= 0) {
          slot.active = false;
          slot.mesh.visible = false;
          events.push({ type: 'explode', position: pos.clone(), team: slot.team });
        } else if (slot.type === 'smoke' && (slot.fuse <= 0 || slot.restTime > 0.25)) {
          slot.active = false;
          slot.can.visible = false;
          smokes.push(makeCloud(pos));
          events.push({ type: 'smoke', position: pos.clone(), team: slot.team });
        }
      }
      for (let i = smokes.length - 1; i >= 0; i -= 1) {
        const smoke = smokes[i];
        smoke.age += dt;
        smoke.life -= dt;
        const grow = Math.min(1, smoke.age / 1.1);
        smoke.material.opacity = 0.85 * grow * Math.min(1, Math.max(0, smoke.life) / 2);
        smoke.points.scale.setScalar(0.4 + 0.6 * grow);
        if (smoke.life <= 0) {
          scene.remove(smoke.points);
          smoke.points.geometry.dispose();
          smoke.material.dispose();
          smokes.splice(i, 1);
        }
      }
    },
    reset() {
      for (const slot of items) {
        slot.active = false;
        slot.mesh.visible = false;
        slot.can.visible = false;
      }
      for (const smoke of smokes) {
        scene.remove(smoke.points);
        smoke.points.geometry.dispose();
        smoke.material.dispose();
      }
      smokes.length = 0;
      events.length = 0;
    },
  };
}
