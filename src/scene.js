// three.js helpers: the field, the bat model, and the ball. Coordinates match the drill frame (+Y up, bowler along -Z).
import * as THREE from 'three';
import { BLADE_LEN } from './drill.js';
import { cross, norm, sub } from './math.js';

export function makeField() {
  const g = new THREE.Group();
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshLambertMaterial({ color: 0x3f6b3a }));
  grass.rotation.x = -Math.PI / 2; g.add(grass);
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(3.05, 25), new THREE.MeshLambertMaterial({ color: 0xc9b27c }));
  pitch.rotation.x = -Math.PI / 2; pitch.position.set(0, 0.002, -10.5); g.add(pitch);
  const line = (z, w = 3.05) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.05), new THREE.MeshBasicMaterial({ color: 0xf4f1e8 })); m.rotation.x = -Math.PI / 2; m.position.set(0, 0.004, z); g.add(m); };
  line(0); line(-19.2);
  const stumps = (z) => { for (const x of [-0.1, 0, 0.1]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.71, 10), new THREE.MeshLambertMaterial({ color: 0xf2e6c4 })); s.position.set(x, 0.355, z); g.add(s); } };
  stumps(0.9); stumps(-19.2);
  const machine = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.55), new THREE.MeshLambertMaterial({ color: 0x23302a }));
  body.position.y = 1.0; machine.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 16), new THREE.MeshLambertMaterial({ color: 0x151d19 }));
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.45, 0.3); machine.add(barrel);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 10), new THREE.MeshLambertMaterial({ color: 0x151d19 }));
  stand.position.y = 0.45; machine.add(stand);
  machine.position.set(0, 0.55, -14.4); g.add(machine);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.215, 48), new THREE.MeshBasicMaterial({ color: 0xe8b27a, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  ring.position.set(0, 0.8, -0.6); g.add(ring);
  g.add(new THREE.HemisphereLight(0xdfe9ff, 0x3a4a33, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(4, 9, 6); g.add(sun);
  return g;
}

export function makeBat(length = 0.8) {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.108, BLADE_LEN, 0.045), new THREE.MeshLambertMaterial({ color: 0xd8b878 }));
  blade.position.y = BLADE_LEN / 2; g.add(blade);
  const spot = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), new THREE.MeshBasicMaterial({ color: 0xb4561b, transparent: true, opacity: 0.7 }));
  spot.position.set(0, 0.18, 0.024); g.add(spot);
  const handleLen = Math.max(0.1, length - BLADE_LEN);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, handleLen, 14), new THREE.MeshLambertMaterial({ color: 0x1c1f1d }));
  handle.position.y = BLADE_LEN + handleLen / 2; g.add(handle);
  g.userData.length = length;
  return g;
}

/** Place a bat model from calibrated geometry: origin at the toe, Y toward the hands, Z along the face normal. */
export function poseBat(bat, geom) {
  const y = norm(sub(geom.top, geom.tip));
  let z = geom.face && Math.hypot(...geom.face) > 0.5 ? norm(geom.face) : norm(cross(y, Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const x = norm(cross(y, z));
  z = norm(cross(x, y));
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z));
  m.setPosition(...geom.tip);
  bat.matrixAutoUpdate = false; bat.matrix.copy(m); bat.matrixWorldNeedsUpdate = true;
}

export function makeBall() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 14), new THREE.MeshStandardMaterial({ color: 0xc41e2a, roughness: 0.5, emissive: 0x330508 }));
  m.visible = false; return m;
}

/** A polyline whose points can be replaced, optionally coloured by a per-point value. */
export function makeTrail(max = 600, color = 0xe8b27a) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
  geo.setDrawRange(0, 0);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 }));
  line.frustumCulled = false;
  line.userData.set = (pts, vals, vmax = 30) => {
    const n = Math.min(pts.length, max), pos = geo.attributes.position.array, col = geo.attributes.color.array;
    for (let i = 0; i < n; i++) {
      pos.set(pts[i], i * 3);
      const k = vals ? Math.min(1, vals[i] / vmax) : 0.7;
      col.set([0.35 + 0.65 * k, 0.55 + 0.1 * (1 - k) - 0.25 * k, 0.9 - 0.75 * k], i * 3);   // blue (slow) to orange (fast)
    }
    geo.setDrawRange(0, n); geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
  };
  return line;
}
