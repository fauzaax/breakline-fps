// Pooled combat effects: tracer lines, impact sparks and the explosion flash. Everything
// is allocated once at startup and reused; step() only moves numbers, never new objects.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_COUNT = 24;
const SPARK_COUNT = 40;
const TRACER_LIFE = 0.09;

export function createEffects(scene) {
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0 });
    const line = new THREE.Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerNext = 0;

  const sparks = [];
  const sparkGeo = new THREE.SphereGeometry(0.045, 6, 5);
  const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.hazard) });
  const dustMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.muted) });
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    const mesh = new THREE.Mesh(sparkGeo, i % 2 ? sparkMat : dustMat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, velocity: new THREE.Vector3(), life: 0 });
  }
  let sparkNext = 0;

  // One reusable explosion: a light plus an expanding additive shell.
  const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.charge), 0, 26);
  scene.add(boomLight);
  const boomShell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.charge), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  boomShell.visible = false;
  scene.add(boomShell);
  let boomLife = 0;
  const BOOM_TIME = 0.7;

  return {
    tracer(from, to, enemy) {
      const slot = tracers[tracerNext];
      tracerNext = (tracerNext + 1) % TRACER_COUNT;
      const positions = slot.line.geometry.attributes.position;
      positions.setXYZ(0, from.x, from.y, from.z);
      positions.setXYZ(1, to.x, to.y, to.z);
      positions.needsUpdate = true;
      slot.line.material.color.setHex(enemy ? 0xff6a55 : 0xffd27a);
      slot.line.material.opacity = 0.9;
      slot.line.visible = true;
      slot.life = TRACER_LIFE;
    },
    impact(point, normal, count = 5) {
      for (let i = 0; i < count; i += 1) {
        const slot = sparks[sparkNext];
        sparkNext = (sparkNext + 1) % SPARK_COUNT;
        slot.mesh.position.copy(point);
        slot.velocity.set(
          normal.x + (Math.random() * 2 - 1) * 1.6,
          Math.abs(normal.y) + Math.random() * 2.2,
          normal.z + (Math.random() * 2 - 1) * 1.6,
        );
        slot.mesh.visible = true;
        slot.mesh.scale.setScalar(1);
        slot.life = 0.35 + Math.random() * 0.2;
      }
    },
    explosion(point) {
      boomLight.position.set(point.x, point.y + 1, point.z);
      boomShell.position.copy(point);
      boomShell.position.y += 0.6;
      boomLife = BOOM_TIME;
      boomShell.visible = true;
    },
    step(dt) {
      for (const slot of tracers) {
        if (slot.life <= 0) continue;
        slot.life -= dt;
        slot.line.material.opacity = Math.max(0, slot.life / TRACER_LIFE) * 0.9;
        if (slot.life <= 0) slot.line.visible = false;
      }
      for (const slot of sparks) {
        if (slot.life <= 0) continue;
        slot.life -= dt;
        slot.velocity.y -= 9 * dt;
        slot.mesh.position.addScaledVector(slot.velocity, dt);
        slot.mesh.scale.setScalar(Math.max(0.1, slot.life * 2.4));
        if (slot.life <= 0) slot.mesh.visible = false;
      }
      if (boomLife > 0) {
        boomLife -= dt;
        const t = 1 - Math.max(0, boomLife) / BOOM_TIME;
        boomShell.scale.setScalar(0.5 + t * 7);
        boomShell.material.opacity = 0.75 * (1 - t);
        boomLight.intensity = 60 * (1 - t);
        if (boomLife <= 0) {
          boomShell.visible = false;
          boomLight.intensity = 0;
        }
      }
    },
  };
}
