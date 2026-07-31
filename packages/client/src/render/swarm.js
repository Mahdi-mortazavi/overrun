/*
 * Copyright 2026 Mohammad Mahdi Mortazavi
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* ============================== THE SWARM ==============================

   Two hundred and sixty enemies, each visibly walking, bobbing, winding up
   and flinching — in one draw call per archetype.

   The trick: skinning happens in the vertex shader, driven by instance
   attributes, with the "skeleton" baked into the geometry as a per-vertex
   part index and pivot. Each part is rotated around its own pivot by an angle
   derived from the instance's gait phase. No bones, no skeleton uniforms, no
   per-object CPU work — the entire crowd animates for the cost of a few extra
   attributes and about twenty lines of GLSL.

   It is not as expressive as the real rig used for players, and it does not
   need to be: at the distance and scale a rusher is seen, an articulated
   silhouette with correct timing is indistinguishable from a skinned one.  */

import * as THREE from 'three';
import { ENEMY_TYPES, COL } from '@overrun/shared/defs.js';

/* Part indices understood by the shader. */
const PART = { BODY: 0, LEG_L: 1, LEG_R: 2, HEAD: 3, ARM_L: 4, ARM_R: 5, SHELL: 6 };

const vertexPatch = /* glsl */`
  attribute float aPart;
  attribute vec3  aPivot;
  attribute float aPhase;
  attribute vec4  aState;   // x: gait speed, y: windup 0..1, z: flash 0..1, w: spawn/scale pop
  varying float vFlash;
  varying float vWind;
  varying float vAO;

  mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }
  mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,s, 0.,1.,0., -s,0.,c); }
  mat3 rotZ(float a){ float c=cos(a), s=sin(a); return mat3(c,-s,0., s,c,0., 0.,0.,1.); }
`;

const transformPatch = /* glsl */`
  float gait   = aState.x;
  float wind   = aState.y;
  float spawnK = aState.w;
  vFlash = aState.z;
  vWind  = wind;

  float ph = aPhase;
  vec3 p = transformed;
  vec3 local = p - aPivot;

  if (aPart == 1.0 || aPart == 2.0) {
    // Legs. Opposite phase, knee-free single-segment swing — at this scale a
    // straight limb swinging correctly reads better than a bent one that is
    // one pixel tall.
    float side = (aPart == 1.0) ? 0.0 : 3.14159265;
    float sw = sin(ph + side) * gait * 0.85;
    float lift = max(0.0, sin(ph + side + 0.5)) * gait * 0.5;
    local = rotX(sw) * local;
    local.y += lift * 0.12;
  } else if (aPart == 3.0) {
    // Head: counter-rotates slightly against the body sway, which is what
    // makes a walk look like it has weight.
    local = rotY(sin(ph * 0.5) * gait * -0.25) * local;
    local = rotX(wind * -0.35) * local;
  } else if (aPart == 4.0 || aPart == 5.0) {
    float side = (aPart == 4.0) ? 3.14159265 : 0.0;
    float sw = sin(ph + side) * gait * 0.6;
    local = rotX(sw) * local;
    // Wind-up raises both arms — the telegraph is in the pose, not only in
    // the ring on the floor.
    local = rotZ((aPart == 4.0 ? 1.0 : -1.0) * wind * 0.9) * local;
  } else if (aPart == 6.0) {
    // Shell/carapace: squash-and-stretch on the wind-up, then a snap.
    local.y *= 1.0 + wind * 0.22;
    local.xz *= 1.0 - wind * 0.10;
  } else {
    // Body: vertical bob and a roll, both from the same phase as the legs.
    local = rotZ(sin(ph) * gait * 0.07) * local;
    local.y += abs(sin(ph)) * gait * 0.07;
    local = rotX(gait * 0.10) * local;
  }

  transformed = aPivot + local;

  // Spawn pop: scale in from nothing with a slight overshoot.
  float pop = 1.0 - spawnK;
  transformed *= mix(1.0, 1.0 + sin(pop * 3.14159) * 0.18, step(0.001, spawnK)) * mix(0.05, 1.0, pop);

  // Cheap vertical AO term so the underside of a body is not lit like the top.
  vAO = clamp(transformed.y * 1.4 + 0.35, 0.25, 1.0);
`;

const fragmentPatch = /* glsl */`
  // Hit flash blows out to white; wind-up pushes toward the danger colour.
  // Colour carries state, and rose always means "this can kill you".
  vec3 warn = vec3(1.0, 0.18, 0.42);
  diffuseColor.rgb = mix(diffuseColor.rgb * vAO, warn, vWind * 0.55);
  diffuseColor.rgb += vec3(vFlash * 1.6);
`;

/* ------------------------------------------------------- GEOMETRY BUILDERS */

function tagged(geo, part, pivot, translate) {
  if (translate) geo.translate(translate[0], translate[1], translate[2]);
  // Everything is flattened to non-indexed before merging. three's primitives
  // are inconsistent about this — icosahedra come out non-indexed, cylinders
  // and spheres come out indexed — and concatenating the two without dropping
  // the index buffer produces a mesh made of scrambled triangles. This one
  // line is the difference between a walking drone and confetti.
  if (geo.index) {
    const flat = geo.toNonIndexed();
    geo.dispose();
    geo = flat;
  }
  const n = geo.attributes.position.count;
  const parts = new Float32Array(n);
  const pivots = new Float32Array(n * 3);
  parts.fill(part);
  for (let i = 0; i < n; i++) {
    pivots[i * 3] = pivot[0];
    pivots[i * 3 + 1] = pivot[1];
    pivots[i * 3 + 2] = pivot[2];
  }
  geo.setAttribute('aPart', new THREE.BufferAttribute(parts, 1));
  geo.setAttribute('aPivot', new THREE.BufferAttribute(pivots, 3));
  return geo;
}

function mergeTagged(list) {
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const part = new Float32Array(total);
  const piv = new Float32Array(total * 3);
  let o = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), o * 3);
    nor.set(g.attributes.normal.array.subarray(0, n * 3), o * 3);
    if (g.attributes.color) col.set(g.attributes.color.array.subarray(0, n * 3), o * 3);
    else col.fill(1, o * 3, (o + n) * 3);
    part.set(g.attributes.aPart.array.subarray(0, n), o);
    piv.set(g.attributes.aPivot.array.subarray(0, n * 3), o * 3);
    o += n;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  geo.setAttribute('aPivot', new THREE.Float32BufferAttribute(piv, 3));
  geo.computeBoundingSphere();
  return geo;
}

function paint(geo, hex) {
  // Same reason as tagged(): the colour attribute has to be sized against the
  // vertex list that will actually be drawn, not the pre-index one.
  if (geo.index) {
    const flat = geo.toNonIndexed();
    geo.dispose();
    geo = flat;
  }
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Light drone: hovering core, two trailing legs, a bright sensor eye. */
function droneGeometry(kind) {
  const body = paint(new THREE.IcosahedronGeometry(0.42, 0), 0xCBD8E2);
  const shell = paint(new THREE.OctahedronGeometry(0.30, 0), 0x8FA3B2);
  const eye = paint(new THREE.SphereGeometry(0.13, 8, 6), kind === 'sapper' ? 0xFF7A3D : 0xFF2D6B);
  const legL = paint(new THREE.CylinderGeometry(0.045, 0.03, 0.44, 5), 0x55646F);
  const legR = paint(new THREE.CylinderGeometry(0.045, 0.03, 0.44, 5), 0x55646F);
  return mergeTagged([
    tagged(body, PART.BODY, [0, 0.55, 0], [0, 0.55, 0]),
    tagged(shell, PART.SHELL, [0, 0.72, -0.06], [0, 0.72, -0.06]),
    tagged(eye, PART.HEAD, [0, 0.58, 0.34], [0, 0.58, 0.34]),
    tagged(legL, PART.LEG_L, [0.16, 0.40, 0], [0.16, 0.20, 0]),
    tagged(legR, PART.LEG_R, [-0.16, 0.40, 0], [-0.16, 0.20, 0])
  ]);
}

/** Fast stalker: lower, longer, forward-raked. */
function stalkerGeometry() {
  const body = paint(new THREE.OctahedronGeometry(0.46, 0), 0xB6C7D2);
  body.scale(1, 0.7, 1.5);
  const eye = paint(new THREE.SphereGeometry(0.11, 8, 6), 0xFF2D6B);
  const legL = paint(new THREE.CylinderGeometry(0.05, 0.025, 0.52, 5), 0x4A5762);
  const legR = paint(new THREE.CylinderGeometry(0.05, 0.025, 0.52, 5), 0x4A5762);
  const armL = paint(new THREE.ConeGeometry(0.07, 0.36, 5), 0x6B7A85);
  const armR = paint(new THREE.ConeGeometry(0.07, 0.36, 5), 0x6B7A85);
  armL.rotateX(Math.PI / 2); armR.rotateX(Math.PI / 2);
  return mergeTagged([
    tagged(body, PART.BODY, [0, 0.48, 0], [0, 0.48, 0]),
    tagged(eye, PART.HEAD, [0, 0.52, 0.52], [0, 0.52, 0.52]),
    tagged(legL, PART.LEG_L, [0.20, 0.36, -0.1], [0.20, 0.16, -0.1]),
    tagged(legR, PART.LEG_R, [-0.20, 0.36, -0.1], [-0.20, 0.16, -0.1]),
    tagged(armL, PART.ARM_L, [0.24, 0.52, 0.1], [0.24, 0.52, 0.32]),
    tagged(armR, PART.ARM_R, [-0.24, 0.52, 0.1], [-0.24, 0.52, 0.32])
  ]);
}

/** Heavy walker: a slab on two thick legs, with an armour plate up front. */
function walkerGeometry(elite) {
  const c = elite ? 0xE8CFA8 : 0xA6B6C2;
  const body = paint(new THREE.BoxGeometry(1.05, 0.95, 0.85), c);
  const head = paint(new THREE.BoxGeometry(0.5, 0.34, 0.4), elite ? 0xFFD9A8 : 0x8496A2);
  const plate = paint(new THREE.BoxGeometry(1.2, 0.75, 0.16), elite ? 0xC9A46B : 0x76858F);
  const legL = paint(new THREE.CylinderGeometry(0.14, 0.11, 0.9, 6), 0x5B6A75);
  const legR = paint(new THREE.CylinderGeometry(0.14, 0.11, 0.9, 6), 0x5B6A75);
  const armL = paint(new THREE.BoxGeometry(0.20, 0.20, 0.62), 0x66757F);
  const armR = paint(new THREE.BoxGeometry(0.20, 0.20, 0.62), 0x66757F);
  return mergeTagged([
    tagged(body, PART.BODY, [0, 1.28, 0], [0, 1.28, 0]),
    tagged(head, PART.HEAD, [0, 1.82, 0.1], [0, 1.82, 0.1]),
    tagged(plate, PART.SHELL, [0, 1.30, 0.48], [0, 1.30, 0.48]),
    tagged(legL, PART.LEG_L, [0.30, 0.80, 0], [0.30, 0.42, 0]),
    tagged(legR, PART.LEG_R, [-0.30, 0.80, 0], [-0.30, 0.42, 0]),
    tagged(armL, PART.ARM_L, [0.58, 1.34, 0], [0.58, 1.34, 0.22]),
    tagged(armR, PART.ARM_R, [-0.58, 1.34, 0], [-0.58, 1.34, 0.22])
  ]);
}

const GEO_BUILDERS = {
  rusher: () => droneGeometry('rusher'),
  shard: () => droneGeometry('shard'),
  splitter: () => droneGeometry('splitter'),
  sapper: () => droneGeometry('sapper'),
  spitter: () => droneGeometry('spitter'),
  stalker: () => stalkerGeometry(),
  bruiser: () => walkerGeometry(false),
  warden: () => walkerGeometry(false),
  elite: () => walkerGeometry(true),
  boss: () => walkerGeometry(true)
};

const CAPS = {
  rusher: 200, shard: 200, splitter: 90, sapper: 60, spitter: 90,
  stalker: 70, bruiser: 60, warden: 40, elite: 22, boss: 4
};

export class Swarm {
  constructor(stage) {
    this.stage = stage;
    this.meshes = {};
    this.attrs = {};
    this.dummy = new THREE.Object3D();

    for (const key in ENEMY_TYPES) {
      const def = ENEMY_TYPES[key];
      const geo = GEO_BUILDERS[key]();
      const cap = CAPS[key] || 40;

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.58,
        metalness: 0.08,
        emissive: new THREE.Color(def.elite ? COL.amber : 0x000000),
        emissiveIntensity: def.elite ? 0.22 : 0
      });
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\n' + vertexPatch)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + transformPatch);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vFlash;\nvarying float vWind;\nvarying float vAO;')
          .replace('#include <color_fragment>', '#include <color_fragment>\n' + fragmentPatch);
      };
      // Different shader source per archetype would recompile per material;
      // a shared cache key keeps it to one program for the whole crowd.
      mat.customProgramCacheKey = () => 'swarm';

      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;

      const phase = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      const state = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      phase.setUsage(THREE.DynamicDrawUsage);
      state.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aPhase', phase);
      geo.setAttribute('aState', state);

      stage.scene.add(mesh);
      this.meshes[key] = mesh;
      this.attrs[key] = { phase, state, cap };
    }
    this._phases = new Map();
  }

  /** Feed it the list of visible enemies. Anything not in the list is gone. */
  update(list, dt, alpha, arena) {
    const counts = {};
    for (const key in this.meshes) counts[key] = 0;
    const d = this.dummy;

    for (const e of list) {
      const key = e.key;
      const mesh = this.meshes[key];
      const at = this.attrs[key];
      if (!mesh) continue;
      const n = counts[key];
      if (n >= at.cap) continue;

      // Per-entity gait phase, advanced by its own speed. Kept in a map keyed
      // by entity id so an enemy does not restart its walk cycle whenever the
      // draw order changes.
      const speed = Math.hypot(e.vx || 0, e.vz || 0);
      let ph = this._phases.get(e.eid);
      if (ph === undefined) ph = Math.random() * Math.PI * 2;
      ph += dt * (2.4 + Math.min(1, speed / 9) * 6.5);
      this._phases.set(e.eid, ph);

      const def = ENEMY_TYPES[key];
      const scale = (e.r || def.r) / def.r * (def.scale || 1);
      const x = e.rx !== undefined ? e.rx : e.x;
      const z = e.rz !== undefined ? e.rz : e.z;

      d.position.set(x, 0, z);
      d.rotation.set(0, -(e.faceA || 0) + Math.PI / 2, 0);
      d.scale.setScalar(scale);
      d.updateMatrix();
      mesh.setMatrixAt(n, d.matrix);

      // Health tint: colour dims as it dies, so a nearly-dead target is
      // readable without a health bar.
      const hp = e.hpFrac !== undefined ? e.hpFrac : 1;
      const tint = 0.55 + hp * 0.45 + (e.buffed ? 0.35 : 0);
      mesh.setColorAt(n, TMP.setScalar(tint));

      at.phase.array[n] = ph;
      const so = n * 4;
      at.state.array[so] = Math.min(1, speed / 8);
      at.state.array[so + 1] = e.windup ? 1 : 0;
      at.state.array[so + 2] = e.flash || 0;
      at.state.array[so + 3] = e.spawning ? 1 : 0;

      if (arena) arena.addBlob(x, z, (e.r || def.r) * 0.9, 0.85);
      counts[key] = n + 1;
    }

    for (const key in this.meshes) {
      const mesh = this.meshes[key];
      const at = this.attrs[key];
      mesh.count = counts[key];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      at.phase.needsUpdate = true;
      at.state.needsUpdate = true;
    }

    // Occasional prune so the phase map does not grow across a long session.
    if (this._phases.size > 900) {
      const keep = new Set(list.map(e => e.eid));
      for (const k of this._phases.keys()) if (!keep.has(k)) this._phases.delete(k);
    }
  }
}

const TMP = new THREE.Color();
