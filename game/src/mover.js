// Shared movement for the player and the bots: acceleration, friction, gravity, crouch,
// jump and step-up, resolved as a box against the world's colliders one axis at a time.
// One body shape, one collision routine, so bots and the player obey the same map.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 7;
const STEP_UP = 0.55;

export function createMover(colliders, options = {}) {
  const walkSpeed = options.walkSpeed ?? 5.2;
  const crouchSpeed = options.crouchSpeed ?? 2.4;
  const body = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };
  const probe = new THREE.Box3();

  // lift keeps the feet and the crown out of the horizontal tests, so standing on a floor
  // is not read as walking into a wall.
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  // Try a horizontal move on one axis; step up onto a low ledge when blocked by one.
  function moveAxis(axis, next) {
    const pos = body.position;
    const before = pos[axis];
    pos[axis] = next;
    const hit = overlaps(pos.x, pos.y, pos.z, body.height, 0.04);
    if (!hit) return;
    const stepHeight = hit.max.y - pos.y;
    if (body.onGround && stepHeight > 0 && stepHeight <= STEP_UP && !overlaps(pos.x, hit.max.y, pos.z, body.height, 0.04)) {
      pos.y = hit.max.y;
      body.velocity.y = 0;
      return;
    }
    pos[axis] = before;
    body.velocity[axis] = 0;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  // wish: world-space desired direction (length 0..1). controls: { jump, crouch, speed }.
  function step(dt, wish, controls = {}) {
    const wantCrouch = Boolean(controls.crouch);
    if (wantCrouch && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!wantCrouch && body.crouching && !overlaps(body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const speed = controls.speed ?? (body.crouching ? crouchSpeed : walkSpeed);
    const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && wish.lengthSq() === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }

    if (controls.jump && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    moveAxis('x', body.position.x + body.velocity.x * dt);
    moveAxis('z', body.position.z + body.velocity.z * dt);

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  return {
    body,
    step,
    look,
    recoil,
    teleport(x, y, z, yaw) {
      body.position.set(x, y, z);
      body.velocity.set(0, 0, 0);
      body.yaw = yaw;
      body.pitch = 0;
      body.onGround = true;
    },
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    eyePosition(out) {
      out.set(body.position.x, body.position.y + body.eye, body.position.z);
      return out;
    },
  };
}
