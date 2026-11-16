// Helios Relay: a decommissioned solar relay station at dusk, 48 x 36 m. Attackers spawn
// south, defenders north, Site A west, Site B east, a mid lane with a doored connector.
// Everything is procedural boxes, cylinders and planes; solar panels, towers, barrels and
// hazard barriers are styled geometry, no external assets. Every solid box is a collider
// for movement and a surface bullets stop on. A hand-placed waypoint graph covers spawns,
// lanes, sites and hold positions; bots path along it with BFS.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const HALF_X = 24;
const HALF_Z = 18;

// Waypoint nodes: [x, z]. Edges are bidirectional; every edge is a straight line clear
// of solid blocks, so a bot walking node to node never stalls on a wall.
const NODES = [
  [0, 13.5], [-8, 12], [8, 12], [-18, 10], [-20, 3], [-19, -6], [-15.5, -11],
  [0, 8], [0, 2], [0, -4], [0, -9], [0, -15.5], [18, 10], [20, 3], [19, -6],
  [15.5, -11], [-9, -15.5], [9, -15.5], [-13, -13], [13, -13], [-4, -14.5],
  [4, -14.5], [-20, -15.5], [20, -15.5], [-9, 7.5], [9, 7.5],
];
const EDGES = [
  [0, 1], [0, 2], [0, 7], [1, 3], [1, 24], [2, 12], [2, 25], [3, 4], [4, 5],
  [5, 6], [5, 22], [6, 18], [6, 22], [18, 16], [16, 11], [16, 20], [11, 17],
  [11, 10], [17, 21], [17, 19], [19, 15], [15, 23], [15, 14], [14, 13], [13, 12],
  [12, 25], [25, 8], [8, 7], [8, 9], [9, 10], [9, 24], [9, 25], [24, 8], [24, 3],
  [20, 11], [21, 11], [18, 22], [19, 23], [16, 22], [17, 23],
];

function letterTexture(letter, fill) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(20, 16, 12, 0.72)';
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = fill;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.font = 'bold 76px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mat = {};
  for (const [name, hex] of Object.entries(PALETTE)) {
    mat[name] = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.9, metalness: 0.04 });
  }
  mat.metal.roughness = 0.45;
  mat.metal.metalness = 0.6;
  mat.panel.roughness = 0.35;
  mat.panel.metalness = 0.5;
  mat.hazard.roughness = 0.6;

  const colliders = [];
  const shootables = [];
  const tmpBox = new THREE.Box3();

  function solid(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      tmpBox.setFromObject(mesh);
      colliders.push(tmpBox.clone());
      shootables.push(mesh);
    }
    return mesh;
  }

  function visual(geometry, material, x, y, z, castShadow = false) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  // --- Ground and perimeter ---
  solid(52, 0.4, 40, 0, -0.2, 0, mat.ground);
  const apron = visual(new THREE.PlaneGeometry(400, 400), mat.darkWall, 0, -0.21, 0);
  apron.rotation.x = -Math.PI / 2;
  solid(0.6, 4.4, 37, -HALF_X - 0.3, 2.2, 0, mat.wall);
  solid(0.6, 4.4, 37, HALF_X + 0.3, 2.2, 0, mat.wall);
  solid(49, 4.4, 0.6, 0, 2.2, -HALF_Z - 0.3, mat.wall);
  solid(49, 4.4, 0.6, 0, 2.2, HALF_Z + 0.3, mat.wall);
  // Perimeter trim and corner towers.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      solid(2.2, 5.6, 2.2, sx * 23, 2.8, sz * 17, mat.darkWall);
      visual(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6), mat.metal, sx * 23, 6.2, sz * 17);
    }
  }

  // --- Lane blocks: two halls and the mid connector with a doored choke ---
  solid(8, 3.2, 8, -11, 1.6, 0, mat.sand); // west hall
  solid(8, 3.2, 8, 11, 1.6, 0, mat.sand); // east hall
  solid(4, 3.2, 5, -3, 1.6, -9, mat.sand); // mid connector, west of the door
  solid(4, 3.2, 5, 3, 1.6, -9, mat.sand); // mid connector, east of the door
  solid(2.4, 0.8, 5.4, 0, 3.6, -9, mat.darkWall); // lintel over the mid door
  // Roof dressing: vents and panel frames on the halls.
  for (const hx of [-11, 11]) {
    solid(1.4, 0.7, 1.4, hx - 2, 3.55, -2, mat.metal, false);
    solid(1.4, 0.7, 1.4, hx + 2, 3.55, 2, mat.metal, false);
    const roof = visual(new THREE.BoxGeometry(5, 0.12, 3), mat.panel, hx, 3.9, 0);
    roof.rotation.x = -0.32;
  }
  // Relay mast on the mid connector.
  visual(new THREE.CylinderGeometry(0.12, 0.2, 5, 8), mat.metal, -3, 5.6, -9, true);
  const mastLamp = visual(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.red) }), -3, 8.2, -9);
  mastLamp.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.red) });

  // --- Raised gantry across the south mid (step-up height, sightline over low crates) ---
  solid(12, 0.5, 2.4, 0, 0.25, 8, mat.metal);
  solid(0.3, 0.9, 2.4, -6, 0.95, 8, mat.rust, false);
  solid(0.3, 0.9, 2.4, 6, 0.95, 8, mat.rust, false);
  solid(1, 0.55, 1, -3, 0.78, 8, mat.hazard);
  solid(1, 0.55, 1, 3, 0.78, 8, mat.hazard);

  // --- Site containers ---
  solid(3.5, 2.6, 2.2, -20.75, 1.3, -13, mat.rust);
  solid(3.5, 2.6, 2.2, 20.75, 1.3, -13, mat.panel);
  solid(2.2, 1.1, 1.2, -20.75, 3.15, -13, mat.metal, false);
  solid(2.2, 1.1, 1.2, 20.75, 3.15, -13, mat.metal, false);

  // --- Crates, low crates and barrels (cover) ---
  const crates = [
    [-16, 8, 1.2], [-21, 6, 1.2], [-17, -1, 1.2], [-15, -14, 1.2], [-21, -9, 1.2],
    [16, 8, 1.2], [21, 6, 1.2], [17, -1, 1.2], [15, -14, 1.2], [21, -9, 1.2],
    [-2.5, 4, 1.2], [2.5, 0.5, 1.2], [3, -3, 1.2], [-2.5, 0.5, 1.2], [-3, -3, 1.2],
    [-5, 11, 1.2], [5, 11, 1.2], [-11, 14, 1.2], [11, 14, 1.2], [-6.5, -13.5, 1.2], [6.5, -13.5, 1.2],
  ];
  crates.forEach(([x, z, size], i) => {
    solid(size, size, size, x, size / 2, z, i % 3 === 0 ? mat.rust : i % 3 === 1 ? mat.wall : mat.metal);
  });
  const lowCrates = [[-13.5, -9.5], [13.5, -9.5], [-19, -15.5], [19, -15.5], [-1.8, 5.6], [1.8, 5.6]];
  for (const [x, z] of lowCrates) solid(1.1, 0.55, 1.1, x, 0.275, z, mat.hazard);
  const barrels = [[-16, 4.5], [16, 4.5], [-22, -15.5], [22, -15.5], [-6, -12.5], [6, -12.5], [-23, 14], [23, 14]];
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12);
  for (const [x, z] of barrels) {
    const barrel = visual(barrelGeo, mat.rust, x, 0.53, z, true);
    tmpBox.setFromObject(barrel);
    colliders.push(tmpBox.clone());
    shootables.push(barrel);
  }

  // --- Hazard barriers at the mid choke ---
  for (const bx of [-2.2, 2.2]) {
    solid(1.4, 0.9, 0.5, bx, 0.45, -5.4, mat.hazard);
    solid(1.4, 0.18, 0.52, bx, 0.95, -5.4, mat.darkWall, false);
  }

  // --- Solar panel arrays along the west/east walls (posts collide, tilted panels visual) ---
  const panelGeo = new THREE.BoxGeometry(0.15, 2.6, 3.4);
  const postGeo = new THREE.BoxGeometry(0.18, 1.7, 0.18);
  for (const sx of [-1, 1]) {
    for (const pz of [6, 9.5, 13]) {
      const px = sx * 22.6;
      solid(0.18, 1.7, 0.18, px, 0.85, pz - 1.2, mat.metal);
      solid(0.18, 1.7, 0.18, px, 0.85, pz + 1.2, mat.metal);
      const panel = visual(panelGeo, mat.panel, px - sx * 0.5, 2.3, pz, true);
      panel.rotation.z = sx * 0.5;
      visual(new THREE.BoxGeometry(0.2, 0.14, 3.5), mat.panelEdge, px - sx * 0.5, 2.3, pz).rotation.z = sx * 0.5;
    }
  }

  // --- Light poles with glowing lamps ---
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 4.4, 8);
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ink) });
  for (const [x, z] of [[-20, 14], [20, 14], [-20, -4], [20, -4], [-8, -16.5], [8, -16.5]]) {
    visual(poleGeo, mat.metal, x, 2.2, z, true);
    visual(new THREE.SphereGeometry(0.22, 10, 8), lampMat, x, 4.5, z);
    tmpBox.set(new THREE.Vector3(x - 0.15, 0, z - 0.15), new THREE.Vector3(x + 0.15, 4.4, z + 0.15));
    colliders.push(tmpBox.clone());
  }

  // --- Pipes along the north wall ---
  for (const py of [1.1, 1.5]) {
    const pipe = visual(new THREE.CylinderGeometry(0.16, 0.16, 44, 10), mat.metal, 0, py, -17.5);
    pipe.rotation.z = Math.PI / 2;
  }

  // --- Site zones: ground tint + beacons + floating letters ---
  const sites = {};
  const beacons = [];
  const siteDefs = [
    { id: 'A', cx: -18, cz: -12, tint: PALETTE.amber },
    { id: 'B', cx: 18, cz: -12, tint: PALETTE.teal },
  ];
  for (const def of siteDefs) {
    const tint = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.tint), transparent: true, opacity: 0.13, depthWrite: false });
    const zone = visual(new THREE.PlaneGeometry(10, 8), tint, def.cx, 0.03, def.cz);
    zone.rotation.x = -Math.PI / 2;
    const beamMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(def.tint), transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const beam = visual(new THREE.CylinderGeometry(0.7, 1.1, 9, 12, 1, true), beamMat, def.cx, 4.5, def.cz);
    beacons.push({ mesh: beam, material: beamMat, phase: def.id === 'A' ? 0 : 1.6 });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: letterTexture(def.id, def.tint), transparent: true, depthWrite: false }));
    sprite.scale.set(2.4, 2.4, 1);
    sprite.position.set(def.cx, 4.6, def.cz);
    group.add(sprite);
    sites[def.id] = {
      id: def.id,
      minX: def.cx - 5, maxX: def.cx + 5, minZ: def.cz - 4, maxZ: def.cz + 4,
      center: new THREE.Vector3(def.cx, 0, def.cz),
    };
  }

  // --- Lane guide strips on the ground (amber to A, teal to B, pale mid) ---
  const stripMat = (hex) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), transparent: true, opacity: 0.35, depthWrite: false });
  const strip = (w, d, x, z, material) => {
    const mesh = visual(new THREE.PlaneGeometry(w, d), material, x, 0.02, z);
    mesh.rotation.x = -Math.PI / 2;
  };
  strip(0.5, 16, -19, 2, stripMat(PALETTE.amber));
  strip(0.5, 16, 19, 2, stripMat(PALETTE.teal));
  strip(0.5, 12, 0, 4, stripMat(PALETTE.ink));

  // --- Sky dome, sun glow, lights ---
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(140, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(PALETTE.skyTop) },
        low: { value: new THREE.Color(PALETTE.skyLow) },
      },
      vertexShader: 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 low; varying vec3 vPos; void main() { float t = clamp(normalize(vPos).y * 1.6 + 0.12, 0.0, 1.0); gl_FragColor = vec4(mix(low, top, pow(t, 0.8)), 1.0); }',
    }),
  );
  scene.add(sky);

  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 34, 120);

  const hemi = new THREE.HemisphereLight(new THREE.Color('#7d90b5'), new THREE.Color('#4a3b2c'), 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb469'), 2.6);
  sun.position.set(-34, 26, 14);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(new THREE.Color('#6a7ba8'), 0.5);
  fill.position.set(26, 18, -10);
  scene.add(fill);

  // --- Waypoint graph ---
  const neighbors = NODES.map(() => []);
  for (const [a, b] of EDGES) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < NODES.length; i += 1) {
      const dx = NODES[i][0] - x;
      const dz = NODES[i][1] - z;
      const dist = dx * dx + dz * dz;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  // BFS over the waypoint graph; returns node indices from start to goal inclusive.
  function findPath(fromIndex, toIndex) {
    if (fromIndex === toIndex) return [fromIndex];
    const prev = new Array(NODES.length).fill(-1);
    const queue = [fromIndex];
    prev[fromIndex] = fromIndex;
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of neighbors[current]) {
        if (prev[next] !== -1) continue;
        prev[next] = current;
        if (next === toIndex) {
          const path = [next];
          let node = next;
          while (node !== fromIndex) {
            node = prev[node];
            path.push(node);
          }
          return path.reverse();
        }
        queue.push(next);
      }
    }
    return [fromIndex, toIndex];
  }

  const spawns = {
    attack: [
      new THREE.Vector3(-2.5, 0, 15.5),
      new THREE.Vector3(2.5, 0, 15.5),
      new THREE.Vector3(-5.5, 0, 14),
      new THREE.Vector3(5.5, 0, 14),
    ],
    defend: [
      new THREE.Vector3(-3, 0, -16.5),
      new THREE.Vector3(3, 0, -16.5),
      new THREE.Vector3(-7, 0, -15.5),
      new THREE.Vector3(7, 0, -15.5),
    ],
  };

  return {
    colliders,
    shootables,
    sites,
    spawns,
    nodes: NODES,
    neighbors,
    nearestNode,
    findPath,
    update(_dt, time) {
      for (const beacon of beacons) {
        beacon.material.opacity = 0.12 + 0.06 * (0.5 + 0.5 * Math.sin(time * 1.8 + beacon.phase));
      }
      mastLamp.material.color.setHex(Math.sin(time * 2.4) > 0 ? 0xe5484d : 0x57181a);
    },
  };
}
