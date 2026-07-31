/* =============================== ARENA =================================
   Visual body for the shared World. The simulation owns where cover is; this
   file owns what it looks like and how it arrives.

   Everything is instanced. A full arena — floor, wall, thirty-four props,
   railings, floodlight masts and painted markings — costs eight draw calls,
   which is what makes 60fps on a mid-range phone possible at all. */

import * as THREE from 'three';
import { concreteSet, steelSet, blobShadow, scorchDecal } from './textures.js';

const TYPE_ORDER = ['block', 'pillar', 'crate', 'ramp'];

export class Arena {
  constructor(stage, world) {
    this.stage = stage;
    this.world = world;
    this.group = new THREE.Group();
    stage.scene.add(this.group);
    this.dummy = new THREE.Object3D();
    this.build();
  }

  build() {
    const R = this.world.radius;
    const scene = this.group;

    /* ---- floor ---- */
    const con = concreteSet(1024, { repeat: Math.round(R / 4) });
    const floorMat = new THREE.MeshStandardMaterial({
      map: con.map, roughnessMap: con.roughnessMap, normalMap: con.normalMap,
      roughness: 1.0, metalness: 0.0, color: 0xFFFFFF
    });
    floorMat.normalScale.set(0.9, 0.9);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 4, 96), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    this.floor = floor;

    // Arena markings live on their own non-tiling decal. Painting them into
    // the concrete texture would repeat them once per tile — a dozen centre
    // circles is a very quick way to make a floor look like wallpaper.
    const marks = new THREE.Mesh(
      new THREE.CircleGeometry(R + 1, 96),
      new THREE.MeshBasicMaterial({ map: markingsTexture(), transparent: true, depthWrite: false, opacity: 0.55 })
    );
    marks.rotation.x = -Math.PI / 2;
    marks.position.y = 0.012;
    marks.renderOrder = 1;
    scene.add(marks);

    /* ---- ground beyond the arena, so the horizon reads as a place ---- */
    const outerMat = new THREE.MeshStandardMaterial({ color: 0x6E7364, roughness: 1, metalness: 0 });
    const outer = new THREE.Mesh(new THREE.RingGeometry(R + 3.6, 260, 72, 1), outerMat);
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.35;
    scene.add(outer);

    /* ---- perimeter wall ---- */
    const steel = steelSet(512, { repeat: 6, base: [138, 146, 150] });
    const wallMat = new THREE.MeshStandardMaterial({
      map: steel.map, roughnessMap: steel.roughnessMap, metalnessMap: steel.metalnessMap,
      normalMap: steel.normalMap, roughness: 0.86, metalness: 0.15,
      color: 0xB6C2CC, side: THREE.DoubleSide
    });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R + 1.6, R + 1.6, 5.2, 96, 1, true), wallMat);
    wall.position.y = 2.6;
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);

    // Hazard-striped kerb at the base of the wall. Peripheral information:
    // you never look at it, but you always know where the edge is.
    const kerbTex = stripeTexture();
    const kerb = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 1.55, R + 1.9, 0.75, 96, 1, true),
      new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide })
    );
    kerb.position.y = 0.37;
    kerb.receiveShadow = true;
    scene.add(kerb);

    // Top rail, thin and bright, so the arena has a clean silhouette line.
    const rail = new THREE.Mesh(
      new THREE.TorusGeometry(R + 1.6, 0.12, 8, 128),
      new THREE.MeshStandardMaterial({ color: 0xE8B84B, roughness: 0.4, metalness: 0.6 })
    );
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 5.2;
    scene.add(rail);

    /* ---- floodlight masts, purely to give the sky something to interrupt ---- */
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x9AA6B0, roughness: 0.6, metalness: 0.2 });
    const masts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 16, 8), mastMat, 8);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.9, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xDDE4E8, roughness: 0.35, metalness: 0.3, emissive: 0xFFF0C4, emissiveIntensity: 0.35 }), 8);
    masts.castShadow = heads.castShadow = true;
    const d = this.dummy;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const x = Math.cos(a) * (R + 5.5), z = Math.sin(a) * (R + 5.5);
      d.position.set(x, 8, z); d.rotation.set(0, -a, 0); d.scale.setScalar(1);
      d.updateMatrix(); masts.setMatrixAt(i, d.matrix);
      d.position.set(x, 16.2, z); d.rotation.set(-0.5, -a, 0);
      d.updateMatrix(); heads.setMatrixAt(i, d.matrix);
    }
    scene.add(masts); scene.add(heads);

    /* ---- props: one instanced mesh per prop type ---- */
    const propSteel = steelSet(512, { repeat: 2, base: [128, 140, 146], seed: 33 });
    // Metalness 0.12, and no metalness map. Physically these are painted steel
    // and should be metallic, but a metal is lit almost entirely by its
    // environment — and with a single low-cost IBL that reads as near-black.
    // Cover has to be legible before it has to be correct, so the props are
    // treated as painted dielectrics and given their brightness back.
    const propMat = new THREE.MeshStandardMaterial({
      map: propSteel.map, roughnessMap: propSteel.roughnessMap, normalMap: propSteel.normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughness: 0.85, metalness: 0.12, color: 0xC9D3DA
    });
    // Crates are painted wood-and-composite, so no metalness map at all.
    const crateMat = new THREE.MeshStandardMaterial({
      map: propSteel.map, roughnessMap: propSteel.roughnessMap, normalMap: propSteel.normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughness: 0.88, metalness: 0.04, color: 0xF0BE7C
    });

    const geos = {
      block: new THREE.BoxGeometry(1, 1, 1),
      pillar: new THREE.CylinderGeometry(1, 1.06, 1, 12),
      crate: new THREE.BoxGeometry(1, 1, 1),
      ramp: rampGeometry()
    };
    this.propMeshes = {};
    for (const key of TYPE_ORDER) {
      const m = new THREE.InstancedMesh(geos[key], key === 'crate' ? crateMat : propMat, 64);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
      this.propMeshes[key] = m;
    }

    /* ---- ground decals: scorch marks from explosions ---- */
    const decalMat = new THREE.MeshBasicMaterial({
      map: scorchDecal(), transparent: true, depthWrite: false, opacity: 0.9
    });
    this.decals = new THREE.InstancedMesh(planeXZ(), decalMat, 48);
    this.decals.frustumCulled = false;
    this.decals.count = 0;
    this.decals.renderOrder = 1;
    scene.add(this.decals);
    this.decalList = [];
    for (let i = 0; i < 48; i++) this.decalList.push({ alive: false, x: 0, z: 0, r: 1, t: 0, life: 1, rot: 0 });

    /* ---- soft contact shadows for everything small and fast ---- */
    const blobMat = new THREE.MeshBasicMaterial({
      map: blobShadow(), transparent: true, depthWrite: false, opacity: 1, color: 0xffffff
    });
    this.blobs = new THREE.InstancedMesh(planeXZ(), blobMat, 300);
    this.blobs.frustumCulled = false;
    this.blobs.count = 0;
    this.blobs.renderOrder = 2;
    scene.add(this.blobs);
    this._blobN = 0;

    /* ---- the closing ring, for Squad Royale ---- */
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xFF4E7A, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false
    });
    this.shrinkRing = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 9, 72, 1, true), ringMat);
    this.shrinkRing.position.y = 4.5;
    this.shrinkRing.visible = false;
    scene.add(this.shrinkRing);
  }

  /* --------------------------------------------------------------- UPDATE */

  update(dt, shrinkRadius) {
    this.world.animate(dt);

    const d = this.dummy;
    for (const key of TYPE_ORDER) {
      const mesh = this.propMeshes[key];
      let n = 0;
      for (const p of this.world.props) {
        if (p.type !== key || !p.alive) continue;
        if (n >= 64) break;
        d.position.set(p.x, p.y + p.h / 2, p.z);
        d.rotation.set(0, p.rot, 0);
        if (key === 'pillar') d.scale.set(p.r, p.h, p.r);
        else if (key === 'ramp') d.scale.set(p.r * 2, p.h, p.r * 1.6);
        else d.scale.set(p.r * 1.7, p.h, p.r * 1.7);
        d.updateMatrix();
        mesh.setMatrixAt(n++, d.matrix);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }

    // decals
    let dn = 0;
    for (const s of this.decalList) {
      if (!s.alive) continue;
      s.t += dt;
      if (s.t > s.life) { s.alive = false; continue; }
      const fade = 1 - Math.max(0, (s.t - s.life * 0.7) / (s.life * 0.3));
      d.position.set(s.x, 0.028, s.z);
      d.rotation.set(0, s.rot, 0);
      d.scale.set(s.r * 2, 1, s.r * 2);
      d.updateMatrix();
      this.decals.setMatrixAt(dn, d.matrix);
      this.decals.setColorAt(dn, TMP_COL.setScalar(fade));
      dn++;
    }
    this.decals.count = dn;
    this.decals.instanceMatrix.needsUpdate = true;
    if (this.decals.instanceColor) this.decals.instanceColor.needsUpdate = true;

    // shrink ring
    if (shrinkRadius && shrinkRadius < this.world.radius - 0.5) {
      this.shrinkRing.visible = true;
      this.shrinkRing.scale.set(shrinkRadius, 1, shrinkRadius);
      this.shrinkRing.material.opacity = 0.22 + Math.sin(performance.now() * 0.004) * 0.08;
    } else this.shrinkRing.visible = false;
  }

  beginBlobs() { this._blobN = 0; }

  addBlob(x, z, r, alpha = 1) {
    if (this._blobN >= 300) return;
    const d = this.dummy;
    d.position.set(x, 0.02, z);
    d.rotation.set(0, 0, 0);
    d.scale.set(r * 2.4, 1, r * 2.4);
    d.updateMatrix();
    this.blobs.setMatrixAt(this._blobN, d.matrix);
    this.blobs.setColorAt(this._blobN, TMP_COL.setScalar(alpha));
    this._blobN++;
  }

  endBlobs() {
    this.blobs.count = this._blobN;
    this.blobs.instanceMatrix.needsUpdate = true;
    if (this.blobs.instanceColor) this.blobs.instanceColor.needsUpdate = true;
  }

  scorch(x, z, r) {
    for (const s of this.decalList) {
      if (s.alive) continue;
      s.alive = true; s.x = x; s.z = z; s.r = r; s.t = 0;
      s.life = 14; s.rot = Math.random() * Math.PI * 2;
      return;
    }
  }
}

const TMP_COL = new THREE.Color();

function planeXZ() {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

function rampGeometry() {
  // A wedge. Cheap cover you can shoot over but not hide behind.
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
    -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
    -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
    0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,
    -0.5, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    -0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/** The painted circle, lane lines and corner marks — drawn once at arena
 *  scale so nothing repeats. */
function markingsTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2;

  g.strokeStyle = '#F2C14A';
  g.lineWidth = S / 190;
  g.setLineDash([S / 34, S / 52]);
  g.beginPath(); g.arc(cx, cy, S * 0.40, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);

  g.globalAlpha = 0.7;
  g.lineWidth = S / 300;
  g.beginPath(); g.arc(cx, cy, S * 0.20, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(cx, cy, S * 0.062, 0, Math.PI * 2); g.stroke();

  // Eight radial ticks: at a glance they tell you which way you are facing
  // when the camera has drifted.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * S * 0.205, cy + Math.sin(a) * S * 0.205);
    g.lineTo(cx + Math.cos(a) * S * 0.245, cy + Math.sin(a) * S * 0.245);
    g.stroke();
  }

  g.globalAlpha = 0.34;
  g.strokeStyle = '#5A6B75';
  g.lineWidth = S / 420;
  for (let i = -4; i <= 4; i++) {
    const o = cx + i * S * 0.09;
    g.beginPath(); g.moveTo(o, 0); g.lineTo(o, S); g.stroke();
    g.beginPath(); g.moveTo(0, o); g.lineTo(S, o); g.stroke();
  }
  g.globalAlpha = 1;

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#2C3238';
  g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#F0C64E';
  g.save();
  for (let i = -2; i < 12; i++) {
    g.beginPath();
    g.moveTo(i * 24, 0); g.lineTo(i * 24 + 12, 0);
    g.lineTo(i * 24 + 12 + 16, 32); g.lineTo(i * 24 + 16, 32);
    g.closePath(); g.fill();
  }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(28, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
