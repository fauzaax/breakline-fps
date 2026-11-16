// Soldier meshes for the bots: box-built humanoids in team colours with a head sphere
// (the headshot hitbox), a gun box, a leg-swing walk animation, a muzzle flash plane and
// a fall-over death pose. Each soldier owns its materials so a hit flash touches one bot.
// The player gets an invisible twin of the same hitboxes so bots can shoot at them with
// the same raycast.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TORSO_GEO = new THREE.BoxGeometry(0.52, 0.72, 0.3);
const HEAD_GEO = new THREE.SphereGeometry(0.16, 14, 10);
const LEG_GEO = new THREE.BoxGeometry(0.18, 0.62, 0.18);
const ARM_GEO = new THREE.BoxGeometry(0.13, 0.5, 0.13);
const GUN_GEO = new THREE.BoxGeometry(0.09, 0.11, 0.62);
const PAD_GEO = new THREE.BoxGeometry(0.58, 0.1, 0.34);
const VISOR_GEO = new THREE.BoxGeometry(0.22, 0.07, 0.05);

export function createSoldier(scene, team) {
  const teamColor = team === 'attack' ? PALETTE.amber : PALETTE.teal;
  const suit = new THREE.MeshStandardMaterial({ color: team === 'attack' ? 0x5a4632 : 0x2e4a48, roughness: 0.8, metalness: 0.05 });
  const cloth = new THREE.MeshStandardMaterial({ color: team === 'attack' ? 0x3c2f22 : 0x24393a, roughness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.5, metalness: 0.2, emissive: new THREE.Color(teamColor), emissiveIntensity: 0.25 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.7 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.5, metalness: 0.4 });

  const group = new THREE.Group();
  const torso = new THREE.Mesh(TORSO_GEO, suit);
  torso.position.y = 1.06;
  const pads = new THREE.Mesh(PAD_GEO, accent);
  pads.position.y = 1.42;
  const head = new THREE.Mesh(HEAD_GEO, skin);
  head.position.y = 1.6;
  const visor = new THREE.Mesh(VISOR_GEO, accent);
  visor.position.set(0, 1.62, -0.14);
  const legL = new THREE.Mesh(LEG_GEO, cloth);
  legL.geometry = LEG_GEO;
  legL.position.set(-0.14, 0.31, 0);
  const legR = new THREE.Mesh(LEG_GEO, cloth);
  legR.position.set(0.14, 0.31, 0);
  const armL = new THREE.Mesh(ARM_GEO, suit);
  armL.position.set(-0.32, 1.1, -0.12);
  armL.rotation.x = -0.9;
  const armR = new THREE.Mesh(ARM_GEO, suit);
  armR.position.set(0.32, 1.1, -0.12);
  armR.rotation.x = -0.9;
  const gun = new THREE.Mesh(GUN_GEO, gunMat);
  gun.position.set(0.16, 1.18, -0.34);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.16, 1.18, -0.7);
  flash.visible = false;
  group.add(torso, pads, head, visor, legL, legR, armL, armR, gun, flash);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  scene.add(group);

  const hitMeshes = [torso, head];
  torso.userData.part = 'torso';
  head.userData.part = 'head';

  const soldier = {
    group, torso, head, flash, hitMeshes,
    walkPhase: 0, flashLeft: 0, hitLeft: 0, fall: 0,
    setActor(actor) {
      torso.userData.actor = actor;
      head.userData.actor = actor;
    },
    // moving: 0..1 stride strength. The legs swing around the hip line.
    animate(dt, moving, yaw) {
      soldier.walkPhase += dt * (4 + moving * 7);
      const swing = Math.sin(soldier.walkPhase) * 0.55 * moving;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -0.9 - swing * 0.25;
      armR.rotation.x = -0.9 + swing * 0.25;
      group.rotation.y = yaw;
      if (soldier.flashLeft > 0) {
        soldier.flashLeft -= dt;
        flash.visible = soldier.flashLeft > 0;
        flash.rotation.z = soldier.flashLeft * 40;
      }
      if (soldier.hitLeft > 0) {
        soldier.hitLeft -= dt;
        const on = soldier.hitLeft > 0;
        suit.emissive.setHex(on ? 0x8a2020 : 0x000000);
        suit.emissiveIntensity = on ? 0.9 : 0;
      }
    },
    showFlash() {
      soldier.flashLeft = 0.06;
      flash.visible = true;
    },
    showHit() {
      soldier.hitLeft = 0.09;
    },
    die(dt) {
      soldier.fall = Math.min(1, soldier.fall + dt / 0.4);
      group.rotation.x = -soldier.fall * 1.5;
      group.position.y = -soldier.fall * 0.1;
    },
    reset() {
      soldier.fall = 0;
      soldier.flashLeft = 0;
      soldier.hitLeft = 0;
      group.rotation.set(0, 0, 0);
      group.position.y = 0;
      suit.emissive.setHex(0x000000);
      suit.emissiveIntensity = 0;
      group.visible = true;
    },
  };
  return soldier;
}

// The player's hitboxes: same torso/head shapes, rendered as nothing (colour and depth
// writes off) so bot raycasts can hit the player with the same code path as bots.
export function createPlayerHitbox(scene) {
  const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true });
  const group = new THREE.Group();
  const torso = new THREE.Mesh(TORSO_GEO, material);
  torso.position.y = 1.06;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(HEAD_GEO, material);
  head.position.y = 1.6;
  head.userData.part = 'head';
  group.add(torso, head);
  scene.add(group);
  return {
    group,
    hitMeshes: [torso, head],
    setActor(actor) {
      torso.userData.actor = actor;
      head.userData.actor = actor;
    },
    sync(position, heightScale) {
      group.position.copy(position);
      const scale = heightScale;
      torso.scale.y = scale;
      torso.position.y = 1.06 * scale;
      head.position.y = 1.6 * scale;
    },
  };
}
