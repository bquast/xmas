// Snow Village - a calm Christmas world for small kids
// WebXR for Meta Quest 3, three.js r187 classic build, no other dependencies.
(function () {
"use strict";

const T = THREE;
const PI = Math.PI, TAU = PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const angTo = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const raw = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
let seed = 11;
const srnd = (a, b) => { seed = (seed * 16807) % 2147483647; return a + (seed / 2147483647) * (b - a); };
const spick = (a) => a[Math.floor(srnd(0, a.length - 0.0001))];
const polar = (deg, r) => [r * Math.sin(deg * PI / 180), r * Math.cos(deg * PI / 180)];

// ---------- settings ----------
const WALK = 1.4;          // m/s, slow for small kids
const SNAP = PI / 6;       // 30 degree snap turn
const EDGE = 38.5;         // you can not walk past the fence

// ---------- state ----------
let renderer, scene, camera, rig;
const ents = [];           // update(dt, t)
const solids = [];         // {x, z, r} the player can not walk into
const targets = [];        // {p: Vector3, r, hit(pos)} for snowballs
const walls = [];          // {x, z, r, h} houses for snowballs
const smokers = [];        // chimney tops
const head = new T.Vector3();
const PSCALE = { value: 900 };
let musicOn = true;
let desk = null;           // desktop test mode state

// ---------- geometry and materials ----------
function prismGeo() {
	const s = new T.Shape();
	s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.lineTo(-0.5, 0);
	const g = new T.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
	g.translate(0, 0, -0.5);
	return g;
}
function starGeo(r1, r2, depth) {
	const s = new T.Shape();
	for (let i = 0; i < 10; i++) {
		const a = i / 10 * TAU + PI / 2, r = i % 2 ? r2 : r1;
		const x = Math.cos(a) * r, y = Math.sin(a) * r;
		if (i) s.lineTo(x, y); else s.moveTo(x, y);
	}
	s.closePath();
	const g = new T.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: depth * 0.5, bevelSize: r2 * 0.2, bevelSegments: 1 });
	g.center();
	return g;
}
const G = {
	box: new T.BoxGeometry(1, 1, 1),
	sph: new T.SphereGeometry(0.5, 16, 12),
	sphLo: new T.SphereGeometry(0.5, 10, 7),
	cyl: new T.CylinderGeometry(0.5, 0.5, 1, 16),
	cylLo: new T.CylinderGeometry(0.5, 0.5, 1, 8),
	cone: new T.ConeGeometry(0.5, 1, 14),
	coneLo: new T.ConeGeometry(0.5, 1, 9),
	prism: prismGeo(),
	torus: new T.TorusGeometry(0.5, 0.12, 8, 22),
	arc: new T.TorusGeometry(0.16, 0.05, 8, 4, PI / 5),
	star: starGeo(0.5, 0.21, 0.14),
};
const LIT = new T.MeshLambertMaterial({ vertexColors: true });
const GLOW = new T.MeshBasicMaterial({ vertexColors: true });

const _q = new T.Quaternion(), _e = new T.Euler();
function M(x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) {
	return new T.Matrix4().compose(new T.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), new T.Vector3(sx, sy, sz));
}
const UP = new T.Vector3(0, 1, 0);
function rodM(ax, ay, az, bx, by, bz, r) {
	const a = new T.Vector3(ax, ay, az), b = new T.Vector3(bx, by, bz);
	const d = b.clone().sub(a), len = d.length();
	const q = new T.Quaternion().setFromUnitVectors(UP, d.normalize());
	return new T.Matrix4().compose(a.add(b).multiplyScalar(0.5), q, new T.Vector3(r * 2, len, r * 2));
}
const part = (geo, color, m) => ({ geo, color, m });
const under = (pm, parts) => parts.map(p => part(p.geo, p.color, pm.clone().multiply(p.m)));

// merge many parts into one geometry with vertex colors (one draw call)
function merge(parts) {
	let n = 0;
	const gs = parts.map(p => {
		const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
		g.applyMatrix4(p.m);
		n += g.attributes.position.count;
		return [g, p.color];
	});
	const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
	const c = new T.Color();
	let o = 0;
	for (const [g, hex] of gs) {
		const k = g.attributes.position.count;
		pos.set(g.attributes.position.array, o * 3);
		nor.set(g.attributes.normal.array, o * 3);
		c.set(hex);
		for (let i = 0; i < k; i++) {
			col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b;
		}
		o += k;
		g.dispose();
	}
	const out = new T.BufferGeometry();
	out.setAttribute('position', new T.BufferAttribute(pos, 3));
	out.setAttribute('normal', new T.BufferAttribute(nor, 3));
	out.setAttribute('color', new T.BufferAttribute(col, 3));
	out.computeBoundingSphere();
	return out;
}
const mesh = (parts, glow) => new T.Mesh(merge(parts), glow ? GLOW : LIT);

// static world buckets, baked into two meshes at the end
const ST = { lit: [], glow: [] };
const st = (geo, color, m, glow) => (glow ? ST.glow : ST.lit).push(part(geo, color, m));
const halos = [];          // [x, y, z, size, hex, alpha]
const bulbs = [];          // {p: Vector3, c: hex}
const BULBC = [0xff3b3b, 0xffd23b, 0x3bb4ff, 0x4cff6a, 0xff5bd6, 0xffffff];
let bulbN = 0;
const addBulb = (v, c) => bulbs.push({ p: v, c: c === undefined ? BULBC[bulbN++ % BULBC.length] : c });

// ---------- particles ----------
const PVS = `
attribute vec3 pcolor; attribute float psize; attribute float palpha;
uniform float scale; varying vec3 vC; varying float vA;
void main() {
	vC = pcolor; vA = palpha;
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	gl_PointSize = min(256.0, psize * scale / max(0.1, -mv.z));
	gl_Position = projectionMatrix * mv;
}`;
const PFS = `
varying vec3 vC; varying float vA;
void main() {
	vec2 d = gl_PointCoord - 0.5;
	float r = length(d);
	if (r > 0.5 || vA < 0.005) discard;
	gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.12, r));
}`;
function pmat(additive) {
	return new T.ShaderMaterial({
		uniforms: { scale: PSCALE }, vertexShader: PVS, fragmentShader: PFS,
		transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending,
	});
}
function makePS(n, additive) {
	const P = {
		n, next: 0, dirty: false,
		pos: new Float32Array(n * 3), col: new Float32Array(n * 3), size: new Float32Array(n), alpha: new Float32Array(n),
		vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n),
		s0: new Float32Array(n), s1: new Float32Array(n), a0: new Float32Array(n), grav: new Float32Array(n), drag: new Float32Array(n),
	};
	const geo = new T.BufferGeometry();
	geo.setAttribute('position', new T.BufferAttribute(P.pos, 3).setUsage(T.DynamicDrawUsage));
	geo.setAttribute('pcolor', new T.BufferAttribute(P.col, 3).setUsage(T.DynamicDrawUsage));
	geo.setAttribute('psize', new T.BufferAttribute(P.size, 1).setUsage(T.DynamicDrawUsage));
	geo.setAttribute('palpha', new T.BufferAttribute(P.alpha, 1).setUsage(T.DynamicDrawUsage));
	P.geo = geo;
	P.obj = new T.Points(geo, pmat(additive));
	P.obj.frustumCulled = false;
	scene.add(P.obj);
	return P;
}
function emit(P, x, y, z, vx, vy, vz, life, s0, s1, rgb, a, grav, drag) {
	const i = P.next;
	P.next = (i + 1) % P.n;
	P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
	P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz;
	P.col[i * 3] = rgb[0]; P.col[i * 3 + 1] = rgb[1]; P.col[i * 3 + 2] = rgb[2];
	P.life[i] = P.max[i] = life; P.s0[i] = s0; P.s1[i] = s1; P.a0[i] = a; P.grav[i] = grav || 0; P.drag[i] = drag || 0;
	P.size[i] = s0; P.alpha[i] = 0;
	P.dirty = true;
}
function pstep(P, dt) {
	for (let i = 0; i < P.n; i++) {
		if (P.life[i] <= 0) { P.alpha[i] = 0; continue; }
		P.life[i] -= dt;
		const u = 1 - P.life[i] / P.max[i], k = 1 - P.drag[i] * dt;
		P.vel[i * 3] *= k; P.vel[i * 3 + 2] *= k;
		P.vel[i * 3 + 1] = P.vel[i * 3 + 1] * k - P.grav[i] * dt;
		P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
		P.size[i] = P.s0[i] + (P.s1[i] - P.s0[i]) * u;
		P.alpha[i] = P.life[i] <= 0 ? 0 : P.a0[i] * Math.min(1, u * 8) * (1 - u);
	}
	const a = P.geo.attributes;
	a.position.needsUpdate = true; a.psize.needsUpdate = true; a.palpha.needsUpdate = true;
	if (P.dirty) { a.pcolor.needsUpdate = true; P.dirty = false; }
}
function staticPoints(list, additive) {
	const n = list.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n);
	list.forEach((h, i) => {
		pos.set([h[0], h[1], h[2]], i * 3); col.set(raw(h[4]), i * 3); size[i] = h[3]; alpha[i] = h[5];
	});
	const geo = new T.BufferGeometry();
	geo.setAttribute('position', new T.BufferAttribute(pos, 3));
	geo.setAttribute('pcolor', new T.BufferAttribute(col, 3));
	geo.setAttribute('psize', new T.BufferAttribute(size, 1));
	geo.setAttribute('palpha', new T.BufferAttribute(alpha, 1));
	const p = new T.Points(geo, pmat(additive));
	p.frustumCulled = false;
	scene.add(p);
	return p;
}
let SMOKE, SPARK;

// ---------- audio (all made with WebAudio, no files) ----------
let AC = null, master = null, mgain = null, nbuf = null;
function audioStart() {
	if (!AC) {
		AC = new (window.AudioContext || window.webkitAudioContext)();
		master = AC.createGain(); master.gain.value = 0.9; master.connect(AC.destination);
		mgain = AC.createGain(); mgain.gain.value = musicOn ? 0.22 : 0; mgain.connect(master);
		nbuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
		const d = nbuf.getChannelData(0);
		for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
	}
	AC.resume();
}
function out(p, ref) {
	if (!p) return master;
	const n = AC.createPanner();
	n.panningModel = 'HRTF'; n.distanceModel = 'inverse';
	n.refDistance = ref || 2; n.rolloffFactor = 1; n.maxDistance = 400;
	if (n.positionX) { n.positionX.value = p.x; n.positionY.value = p.y; n.positionZ.value = p.z; }
	else n.setPosition(p.x, p.y, p.z);
	n.connect(master);
	return n;
}
function tone(dst, type, f0, f1, t0, dur, vol, att) {
	const o = AC.createOscillator(), g = AC.createGain();
	o.type = type;
	o.frequency.setValueAtTime(f0, t0);
	if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
	g.gain.setValueAtTime(0.0001, t0);
	g.gain.exponentialRampToValueAtTime(vol, t0 + (att || 0.005));
	g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
	o.connect(g); g.connect(dst);
	o.start(t0); o.stop(t0 + dur + 0.05);
}
function noise(dst, t0, dur, vol, ft, fq, q) {
	const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
	s.buffer = nbuf; s.loop = true;
	f.type = ft; f.frequency.value = fq; f.Q.value = q || 0.7;
	g.gain.setValueAtTime(0.0001, t0);
	g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
	g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
	s.connect(f); f.connect(g); g.connect(dst);
	s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.05);
}
const mf = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SFX = {
	fire(p) { const d = out(p, 1), t = AC.currentTime; tone(d, 'sine', 320, 110, t, 0.12, 0.45); noise(d, t, 0.07, 0.2, 'bandpass', 1800, 1); },
	splat(p) { const d = out(p, 2), t = AC.currentTime; noise(d, t, 0.16, 0.6, 'lowpass', 1100, 0.8); noise(d, t, 0.05, 0.25, 'highpass', 3000); },
	thud(p) { const d = out(p, 2), t = AC.currentTime; tone(d, 'sine', 130, 60, t, 0.16, 0.5); noise(d, t, 0.12, 0.4, 'lowpass', 500); },
	jingle(p, v, ref) {
		const d = out(p, ref || 3), t = AC.currentTime;
		for (let i = 0; i < 5; i++) {
			const f = rnd(2600, 4200), s = t + rnd(0, 0.12);
			tone(d, 'sine', f, f, s, 0.25, v * 0.3); tone(d, 'sine', f * 1.5, f * 1.5, s, 0.12, v * 0.12);
		}
		noise(d, t, 0.15, v * 0.2, 'highpass', 7000);
	},
	chime(p) {
		const d = out(p, 3), t = AC.currentTime;
		[72, 76, 79, 84, 88].forEach((n, i) => { const f = mf(n); tone(d, 'sine', f, f, t + i * 0.08, 0.9, 0.3); tone(d, 'sine', f * 2, f * 2, t + i * 0.08, 0.4, 0.08); });
	},
	giggle(p) {
		const d = out(p, 2.5), t = AC.currentTime, b = rnd(650, 850);
		for (let i = 0; i < 4; i++) tone(d, 'triangle', b * (1 + i * 0.05), b * 1.5 * (1 + i * 0.05), t + i * 0.13, 0.1, 0.35, 0.02);
	},
	squeak(p) { const d = out(p, 2), t = AC.currentTime; tone(d, 'triangle', 900, 1700, t, 0.1, 0.35, 0.01); tone(d, 'triangle', 1000, 1900, t + 0.14, 0.12, 0.3, 0.01); },
	boing(p) { const d = out(p, 2), t = AC.currentTime; tone(d, 'sine', 180, 520, t, 0.16, 0.4); tone(d, 'sine', 520, 260, t + 0.16, 0.14, 0.25); },
	pop(p) { const d = out(p, 2), t = AC.currentTime; tone(d, 'sine', 900, 200, t, 0.09, 0.5); noise(d, t, 0.05, 0.3, 'bandpass', 2000, 1); },
	whistle(p) {
		const d = out(p, 4), t = AC.currentTime;
		for (const [s, l] of [[0, 0.35], [0.45, 0.7]]) {
			tone(d, 'sine', 740, 760, t + s, l, 0.22, 0.04); tone(d, 'sine', 932, 950, t + s, l, 0.16, 0.04);
			noise(d, t + s, l, 0.06, 'bandpass', 2500, 3);
		}
	},
	hoho(p) {
		const d = out(p, 14), t = AC.currentTime;
		for (let i = 0; i < 3; i++) {
			const s = t + i * 0.38, o = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain();
			o.type = 'sawtooth';
			o.frequency.setValueAtTime(150, s); o.frequency.exponentialRampToValueAtTime(105, s + 0.28);
			f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 1.4;
			g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.7, s + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3);
			o.connect(f); f.connect(g); g.connect(d); o.start(s); o.stop(s + 0.35);
		}
	},
};
const sfx = (name, ...a) => { if (AC) SFX[name](...a); };

// Jingle Bells (1857, public domain) as a soft music box
const MEL = [
	[64, 1], [64, 1], [64, 2], [64, 1], [64, 1], [64, 2], [64, 1], [67, 1], [60, 1.5], [62, 0.5], [64, 4],
	[65, 1], [65, 1], [65, 1.5], [65, 0.5], [65, 1], [64, 1], [64, 1], [64, 0.5], [64, 0.5], [64, 1], [62, 1], [62, 1], [64, 1], [62, 2], [67, 2],
	[64, 1], [64, 1], [64, 2], [64, 1], [64, 1], [64, 2], [64, 1], [67, 1], [60, 1.5], [62, 0.5], [64, 4],
	[65, 1], [65, 1], [65, 1.5], [65, 0.5], [65, 1], [64, 1], [64, 1], [64, 0.5], [64, 0.5], [67, 1], [67, 1], [65, 1], [62, 1], [60, 4],
];
const BASS = [48, 48, 48, 48, 53, 48, 50, 55, 48, 48, 48, 48, 53, 48, 55, 48];
const LOOPB = 80, BEAT = 60 / 132;
const EVENTS = (() => {
	const ev = [];
	let b = 0;
	for (const [n, l] of MEL) { ev.push({ b, k: 'm', n }); b += l; }
	BASS.forEach((n, i) => { ev.push({ b: i * 4, k: 'b', n }); ev.push({ b: i * 4 + 2, k: 'b', n: n + 7 }); });
	for (let i = 0; i < 64; i++) if (i % 2) ev.push({ b: i, k: 's' });
	return ev.sort((a, c) => a.b - c.b);
})();
let mStart = 0, mIdx = 0, mLoop = 0;
function musicTick() {
	if (!AC) return;
	const now = AC.currentTime;
	if (!mStart) mStart = now + 1.0;
	for (;;) {
		const ev = EVENTS[mIdx], at = mStart + (mLoop * LOOPB + ev.b) * BEAT;
		if (at > now + 0.5) break;
		if (at > now - 0.05) {
			if (ev.k === 'm') {
				const f = mf(ev.n + 12);
				tone(mgain, 'sine', f, f, at, 1.1, 0.35); tone(mgain, 'sine', f * 2, f * 2, at, 0.5, 0.08); tone(mgain, 'sine', f * 3, f * 3, at, 0.25, 0.03);
			} else if (ev.k === 'b') {
				const f = mf(ev.n);
				tone(mgain, 'triangle', f, f, at, 0.8, 0.25, 0.01);
			} else noise(mgain, at, 0.06, 0.08, 'highpass', 6500);
		}
		mIdx++;
		if (mIdx >= EVENTS.length) { mIdx = 0; mLoop++; }
	}
}
const _lv = new T.Vector3(), _lf = new T.Vector3(), _lu = new T.Vector3(), _lq = new T.Quaternion();
function listen() {
	if (!AC) return;
	camera.getWorldPosition(_lv); camera.getWorldDirection(_lf); camera.getWorldQuaternion(_lq);
	_lu.set(0, 1, 0).applyQuaternion(_lq);
	const L = AC.listener;
	if (L.positionX) {
		L.positionX.value = _lv.x; L.positionY.value = _lv.y; L.positionZ.value = _lv.z;
		L.forwardX.value = _lf.x; L.forwardY.value = _lf.y; L.forwardZ.value = _lf.z;
		L.upX.value = _lu.x; L.upY.value = _lu.y; L.upZ.value = _lu.z;
	} else {
		L.setPosition(_lv.x, _lv.y, _lv.z);
		L.setOrientation(_lf.x, _lf.y, _lf.z, _lu.x, _lu.y, _lu.z);
	}
}

// ---------- terrain ----------
function groundH(x, z) {
	const r = Math.hypot(x, z);
	if (r < 43) return 0;
	const k = smooth(43, 110, r);
	const n = 0.5 + 0.25 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05) + 0.25 * Math.sin(x * 0.013 + z * 0.021);
	return k * (6 + 22 * n);
}
function snowTex() {
	const c = document.createElement('canvas');
	c.width = c.height = 128;
	const x = c.getContext('2d');
	x.fillStyle = '#eef3fb'; x.fillRect(0, 0, 128, 128);
	for (let i = 0; i < 900; i++) {
		const v = 220 + (Math.random() * 35) | 0;
		x.fillStyle = `rgb(${v},${v + 3 > 255 ? 255 : v + 3},255)`;
		x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
	}
	const t = new T.CanvasTexture(c);
	t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(90, 90);
	t.colorSpace = T.SRGBColorSpace;
	t.anisotropy = 4;
	return t;
}
function buildGround() {
	const g = new T.PlaneGeometry(700, 700, 100, 100);
	g.rotateX(-PI / 2);
	const p = g.attributes.position;
	for (let i = 0; i < p.count; i++) p.setY(i, groundH(p.getX(i), p.getZ(i)));
	g.computeVertexNormals();
	const m = new T.Mesh(g, new T.MeshLambertMaterial({ color: 0xffffff, map: snowTex() }));
	scene.add(m);
	// stone plaza and paths
	const plaza = new T.Mesh(new T.CircleGeometry(8.6, 48).rotateX(-PI / 2), new T.MeshLambertMaterial({ color: 0xa4afc6, polygonOffset: true, polygonOffsetFactor: -2 }));
	plaza.position.y = 0.01;
	scene.add(plaza);
}

// ---------- sky ----------
function buildSky() {
	const sky = new T.Mesh(new T.SphereGeometry(450, 32, 16), new T.ShaderMaterial({
		side: T.BackSide, depthWrite: false, fog: false,
		vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
		fragmentShader: `varying vec3 vP; void main(){
			float h = vP.y;
			vec3 top = vec3(0.03, 0.05, 0.16), mid = vec3(0.11, 0.15, 0.34), hor = vec3(0.30, 0.30, 0.52);
			vec3 c = mix(hor, mid, smoothstep(0.0, 0.25, h));
			c = mix(c, top, smoothstep(0.25, 0.9, h));
			gl_FragColor = vec4(c, 1.0); }`,
	}));
	sky.renderOrder = -10;
	scene.add(sky);
	// stars
	const s = [];
	for (let i = 0; i < 1400; i++) {
		const a = rnd(0, TAU), y = rnd(0.08, 1), r = Math.sqrt(1 - y * y);
		s.push([Math.cos(a) * r * 420, y * 420, Math.sin(a) * r * 420, rnd(0.9, 2.6), pick([0xffffff, 0xdfe8ff, 0xfff3d8]), rnd(0.4, 1)]);
	}
	staticPoints(s, true);
	// moon
	const moon = new T.Mesh(new T.CircleGeometry(13, 32), new T.MeshBasicMaterial({ color: 0xfff4d6, fog: false }));
	moon.position.set(190, 160, -250);
	moon.lookAt(0, 0, 0);
	scene.add(moon);
	staticPoints([[190, 160, -250, 150, 0x8090c0, 0.35]], true);
	// northern lights
	const aur = new T.ShaderMaterial({
		uniforms: { t: { value: 0 } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false,
		vertexShader: `uniform float t; varying vec2 vU;
			void main(){ vU = uv; vec3 p = position;
				p.z += 35.0 * sin(p.x * 0.012 + t * 0.07) + 12.0 * sin(p.x * 0.031 - t * 0.11);
				p.y += 8.0 * sin(p.x * 0.02 + t * 0.15) * uv.y;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
		fragmentShader: `uniform float t; varying vec2 vU;
			void main(){
				float a = smoothstep(0.0, 0.25, vU.y) * pow(1.0 - vU.y, 1.5);
				a *= 0.55 + 0.45 * sin(vU.x * 40.0 + t * 0.6 + sin(vU.x * 13.0 - t * 0.3) * 3.0);
				a *= smoothstep(0.0, 0.15, vU.x) * smoothstep(1.0, 0.85, vU.x);
				vec3 c = mix(vec3(0.15, 0.95, 0.55), vec3(0.55, 0.35, 0.95), smoothstep(0.35, 1.0, vU.y));
				gl_FragColor = vec4(c, a * 0.45); }`,
	});
	for (const [x, z, ry, y] of [[-40, -270, 0.15, 90], [-170, -200, 0.75, 110]]) {
		const a = new T.Mesh(new T.PlaneGeometry(420, 70, 120, 1), aur);
		a.position.set(x, y, z); a.rotation.y = ry;
		scene.add(a);
	}
	ents.push((dt, t) => { aur.uniforms.t.value = t; });
	// far mountains
	for (let i = 0; i < 18; i++) {
		const a = i / 18 * TAU + srnd(-0.1, 0.1), r = srnd(250, 300), h = srnd(60, 120), w = srnd(70, 120);
		const x = Math.sin(a) * r, z = Math.cos(a) * r;
		st(G.coneLo, 0x7d8db0, M(x, h * 0.5 - 5, z, w * 2, h, w * 2, 0, srnd(0, 3), 0));
		st(G.coneLo, 0xeef3ff, M(x, h * 0.75 - 5 + 0.5, z, w * 1.02, h * 0.5 + 0.5, w * 1.02, 0, srnd(0, 3), 0));
	}
}

// ---------- props ----------
function pineParts() {
	return [
		part(G.cylLo, 0x4a3220, M(0, 0.3, 0, 0.3, 0.6, 0.3)),
		part(G.coneLo, 0x1d4a2c, M(0, 1.3, 0, 2.4, 1.8, 2.4)),
		part(G.coneLo, 0x225433, M(0, 2.2, 0, 1.9, 1.6, 1.9)),
		part(G.coneLo, 0x275e39, M(0, 3.0, 0, 1.3, 1.4, 1.3)),
		part(G.coneLo, 0xf4f8ff, M(0, 1.91, 0, 0.84, 0.62, 0.84)),
		part(G.coneLo, 0xf4f8ff, M(0, 2.76, 0, 0.62, 0.52, 0.62)),
		part(G.coneLo, 0xf4f8ff, M(0, 3.46, 0, 0.47, 0.52, 0.47)),
	];
}
function cane(m) {
	for (let i = 0; i < 7; i++) st(G.cylLo, i % 2 ? 0xffffff : 0xe0262c, m.clone().multiply(M(0, 0.08 + i * 0.16, 0, 0.1, 0.16, 0.1)));
	for (let k = 0; k < 5; k++) st(G.arc, k % 2 ? 0xe0262c : 0xffffff, m.clone().multiply(M(-0.16, 1.12, 0, 1, 1, 1, 0, 0, k * PI / 5)));
}
function lamp(x, z) {
	const C = 0x23402e;
	st(G.cylLo, C, M(x, 0.1, z, 0.36, 0.2, 0.36));
	st(G.cylLo, C, M(x, 1.35, z, 0.12, 2.6, 0.12));
	st(G.box, C, M(x, 2.66, z, 0.4, 0.08, 0.4));
	st(G.sphLo, 0xffe3a0, M(x, 2.88, z, 0.38), true);
	st(G.coneLo, C, M(x, 3.14, z, 0.52, 0.22, 0.52));
	st(G.coneLo, 0xf4f8ff, M(x, 3.24, z, 0.42, 0.14, 0.42));
	st(G.sphLo, 0xe8343a, M(x, 2.35, z + 0.07, 0.16), true);
	halos.push([x, 2.88, z, 1.8, 0xffc870, 0.3]);
}
function fence() {
	const n = 120, R = 40, W = 0x6b4a2e, S = 0xf4f8ff;
	for (let i = 0; i < n; i++) {
		const a = i / n * TAU, b = (i + 1) / n * TAU;
		const x = Math.sin(a) * R, z = Math.cos(a) * R, x2 = Math.sin(b) * R, z2 = Math.cos(b) * R;
		st(G.box, W, M(x, 0.5, z, 0.14, 1.0, 0.14, 0, a, 0));
		st(G.box, S, M(x, 1.04, z, 0.18, 0.08, 0.18, 0, a, 0));
		st(G.cylLo, W, rodM(x, 0.35, z, x2, 0.35, z2, 0.04));
		st(G.cylLo, W, rodM(x, 0.8, z, x2, 0.8, z2, 0.04));
		st(G.cylLo, S, rodM(x, 0.86, z, x2, 0.86, z2, 0.035));
	}
}
function forest() {
	const geo = merge(pineParts());
	const N = 300, im = new T.InstancedMesh(geo, LIT, N);
	let k = 0;
	for (let tries = 0; k < N && tries < 4000; tries++) {
		const a = srnd(0, TAU), r = 45 + Math.pow(srnd(0, 1), 0.8) * 85;
		const x = Math.sin(a) * r, z = Math.cos(a) * r, s = srnd(0.9, 2.1);
		im.setMatrixAt(k++, M(x, groundH(x, z) - 0.2, z, s, s * srnd(0.9, 1.25), s, 0, srnd(0, TAU), 0));
	}
	im.count = k;
	im.frustumCulled = false;
	scene.add(im);
}
function blocked(x, z, pad) {
	for (const s of solids) if (Math.hypot(x - s.x, z - s.z) < s.r + pad) return true;
	return false;
}
function innerTrees() {
	for (let i = 0, n = 0; i < 400 && n < 22; i++) {
		const a = srnd(0, TAU), r = srnd(29, 37), x = Math.sin(a) * r, z = Math.cos(a) * r;
		if (blocked(x, z, 2.2)) continue;
		const s = srnd(0.7, 1.2), m = M(x, 0, z, s, s, s, 0, srnd(0, TAU), 0);
		ST.lit.push(...under(m, pineParts()));
		solids.push({ x, z, r: 1.0 * s });
		walls.push({ x, z, r: 0.9 * s, h: 3.8 * s });
		if (n % 2 === 0) {
			for (let j = 0; j < 14; j++) {
				const y = srnd(0.7, 3.2), rr = Math.max(0.15, (1.25 - (y - 0.4) * 0.31) * 0.95), aa = srnd(0, TAU);
				addBulb(new T.Vector3(Math.sin(aa) * rr, y, Math.cos(aa) * rr).applyMatrix4(m));
			}
		}
		n++;
	}
	// snow piles
	for (let i = 0; i < 30; i++) {
		const a = srnd(0, TAU), r = srnd(9, 38), x = Math.sin(a) * r, z = Math.cos(a) * r;
		if (blocked(x, z, 0.8)) continue;
		const s = srnd(0.6, 1.6);
		st(G.sphLo, 0xf4f8ff, M(x, 0, z, s * 1.6, s * 0.7, s * 1.3, 0, srnd(0, 3), 0));
	}
}

// ---------- houses ----------
const WALLC = [0xb8413c, 0x3f6fae, 0x3f8a5c, 0xe2b64c, 0xe9dcc2, 0x8a5aa8, 0x4fa3a5];
const GUM = [0xff3b3b, 0x3bd16a, 0xffd23b, 0x9b5bff, 0xff8a2b, 0x3bb4ff];
function house(x, z, ry, wall, ginger) {
	const HM = M(x, 0, z, 1, 1, 1, 0, ry, 0);
	const w = 5, d = 4.5, h = 3.2, SN = 0xf4f8ff;
	if (ginger) wall = 0xa0612f;
	const roof = ginger ? 0x5c3317 : spick([0x5a3b2e, 0x3b3f4a, 0x7a2e2a]);
	const L = [], Gl = [];
	L.push(part(G.box, wall, M(0, h / 2, 0, w, h, d)));
	L.push(part(G.box, 0x75727c, M(0, 0.2, 0, w + 0.12, 0.4, d + 0.12)));
	L.push(part(G.prism, roof, M(0, h, 0, d + 1.0, 2.2, w + 0.8, 0, PI / 2, 0)));
	L.push(part(G.prism, SN, M(0, h + 0.13, 0, d + 1.15, 2.15, w + 0.4, 0, PI / 2, 0)));
	// door, wreath, step
	L.push(part(G.box, ginger ? 0xf2f2f2 : 0x5a3a22, M(0, 1.0, d / 2 + 0.05, 1.1, 2.0, 0.1)));
	L.push(part(G.box, 0xf0f0f0, M(0, 2.05, d / 2 + 0.06, 1.3, 0.15, 0.12)));
	L.push(part(G.sphLo, 0xe8c050, M(0.38, 1.0, d / 2 + 0.13, 0.1)));
	L.push(part(G.box, 0x8d8d98, M(0, 0.1, d / 2 + 0.45, 1.7, 0.2, 0.8)));
	L.push(part(G.torus, 0x2f6b34, M(0, 1.5, d / 2 + 0.14, 0.6)));
	Gl.push(part(G.sphLo, 0xe8343a, M(0, 1.24, d / 2 + 0.2, 0.16)));
	const win = (m) => {
		L.push(...under(m, [
			part(G.box, ginger ? 0xffffff : 0xf2f2f2, M(0, 0, 0, 1.1, 1.1, 0.1)),
			part(G.box, 0x3a2a20, M(0, 0, 0.07, 0.06, 0.9, 0.04)),
			part(G.box, 0x3a2a20, M(0, 0, 0.07, 0.9, 0.06, 0.04)),
			part(G.box, SN, M(0, -0.6, 0.1, 1.25, 0.1, 0.25)),
		]));
		Gl.push(...under(m, [part(G.box, 0xffcf73, M(0, 0, 0.03, 0.9, 0.9, 0.06))]));
	};
	win(M(-1.65, 1.75, d / 2)); win(M(1.65, 1.75, d / 2));
	win(M(w / 2, 1.75, 0, 1, 1, 1, 0, PI / 2, 0)); win(M(-w / 2, 1.75, 0, 1, 1, 1, 0, -PI / 2, 0));
	win(M(-1.2, 1.75, -d / 2, 1, 1, 1, 0, PI, 0)); win(M(1.2, 1.75, -d / 2, 1, 1, 1, 0, PI, 0));
	// chimney
	L.push(part(G.box, ginger ? 0xf2f2f2 : 0x8a3b2b, M(1.4, h + 1.6, -0.6, 0.6, 1.8, 0.6)));
	L.push(part(G.box, SN, M(1.4, h + 2.55, -0.6, 0.72, 0.14, 0.72)));
	if (ginger) {
		for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.push(part(G.box, 0xffffff, M(sx * w / 2, h / 2, sz * d / 2, 0.2, h, 0.2)));
		for (let i = 0; i < 11; i++) L.push(part(G.sphLo, GUM[i % GUM.length], M(-w / 2 - 0.3 + i * (w + 0.6) / 10, h + 0.02, (d + 1) / 2 + 0.1, 0.32, 0.26, 0.32)));
		for (const px of [-1.65, 1.65]) {
			L.push(part(G.cyl, 0xffffff, M(px, 0.72, d / 2 + 0.04, 0.62, 0.06, 0.62, PI / 2, 0, 0)));
			for (let k = 0; k < 4; k++) L.push(part(G.box, 0xe0262c, M(px, 0.72, d / 2 + 0.08, 0.56, 0.08, 0.03, 0, 0, k * PI / 4)));
		}
		L.push(part(G.box, 0xffffff, M(0, h - 0.1, d / 2 + 0.02, w + 0.1, 0.12, 0.06)));
	}
	ST.lit.push(...under(HM, L));
	ST.glow.push(...under(HM, Gl));
	if (ginger) {
		cane(HM.clone().multiply(M(-0.95, 0, d / 2 + 0.4, 1.1)));
		cane(HM.clone().multiply(M(0.95, 0, d / 2 + 0.4, 1.1, 1.1, 1.1, 0, PI, 0)));
	}
	// lights along both eaves
	const ez = (d + 1.0) / 2 + 0.03, L2 = w + 0.8;
	for (let i = 0; i <= 14; i++) for (const s of [1, -1]) addBulb(new T.Vector3(-L2 / 2 + i * L2 / 14, h - 0.07, s * ez).applyMatrix4(HM));
	solids.push({ x, z, r: 3.5 });
	walls.push({ x, z, r: 3.1, h: 5.6 });
	smokers.push(new T.Vector3(1.4, h + 2.7, -0.6).applyMatrix4(HM));
}

// ---------- the big tree ----------
const TL = [];
for (let i = 0; i < 6; i++) TL.push({ y0: 0.9 + i * 1.15, r: 3.1 * (1 - i / 6.6), h: 2.4 });
function treeR(y) {
	let r = 0;
	for (const l of TL) if (y >= l.y0 && y <= l.y0 + l.h) r = Math.max(r, l.r * (1 - (y - l.y0) / l.h));
	return r;
}
let treeBulb0 = 0, treeBulb1 = 0;
function bigTree() {
	st(G.cylLo, 0x5b3a1e, M(0, 0.6, 0, 0.7, 1.2, 0.7));
	TL.forEach((l, i) => st(G.cone, i % 2 ? 0x24683a : 0x1f5a32, M(0, l.y0 + l.h / 2, 0, l.r * 2, l.h, l.r * 2, 0, i * 0.4, 0)));
	st(G.cyl, 0xb02a30, M(0, 0.03, 0, 7.6, 0.04, 7.6));
	st(new T.TorusGeometry(3.8, 0.12, 6, 48), 0xffffff, M(0, 0.05, 0, 1, 1, 0.6, PI / 2, 0, 0));
	// bulbs in a spiral
	treeBulb0 = bulbs.length;
	for (let k = 0; k < 280; k++) {
		const s = k / 280, y = 1.0 + s * 7.8, r = treeR(y), a = s * TAU * 11;
		if (r < 0.12) continue;
		addBulb(new T.Vector3(Math.sin(a) * (r + 0.03), y, Math.cos(a) * (r + 0.03)));
	}
	treeBulb1 = bulbs.length;
	// baubles
	for (let k = 0; k < 46; k++) {
		const y = srnd(1.1, 8.0), r = treeR(y), a = srnd(0, TAU);
		if (r < 0.3) continue;
		st(G.sph, spick([0xd8262c, 0xf0c030, 0x2a7fe0, 0xe0e0f0, 0xb040d0]), M(Math.sin(a) * (r + 0.08), y - 0.1, Math.cos(a) * (r + 0.08), 0.28));
	}
	// garland
	const pts = [];
	for (let s = 0; s <= 1; s += 0.004) {
		const y = 1.2 + s * 7.4, r = treeR(y) + 0.06, a = s * TAU * 5 + 1;
		pts.push(new T.Vector3(Math.sin(a) * r, y, Math.cos(a) * r));
	}
	st(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 500, 0.035, 5, false), 0xffd24a, M(), true);
	// star on top
	const star = new T.Mesh(G.star, new T.MeshBasicMaterial({ color: 0xffd84a }));
	star.position.y = 9.45; star.scale.setScalar(1.3);
	scene.add(star);
	const halo = staticPoints([[0, 9.45, 0, 4.5, 0xffd070, 0.5]], true);
	const light = new T.PointLight(0xffb060, 6, 22, 1);
	light.position.set(0, 4, 0);
	scene.add(light);
	solids.push({ x: 0, z: 0, r: 3.3 });
	ents.push((dt, t) => {
		star.rotation.y = t * 0.6;
		halo.geometry.attributes.palpha.array[0] = 0.4 + 0.2 * Math.sin(t * 2.2);
		halo.geometry.attributes.palpha.needsUpdate = true;
		light.intensity = 6 + Math.sin(t * 3.1) * 0.6;
		// magic sparkles around the tree
		if (Math.random() < dt * 14) {
			const a = rnd(0, TAU), y = rnd(0.5, 8.5), r = treeR(y) + rnd(0.2, 1.2);
			emit(SPARK, Math.sin(a) * r, y, Math.cos(a) * r, 0, rnd(0.1, 0.3), 0, rnd(2, 3.5), 0.12, 0.05, pick([raw(0xffe08a), raw(0xffffff), raw(0xffb0e0)]), 0.9, -0.02, 0);
		}
	});
}

// ---------- bulbs (one instanced mesh, they twinkle) ----------
let BULB, bulbOn, bulbFlash = 0;
function bakeBulbs() {
	const n = bulbs.length;
	BULB = new T.InstancedMesh(new T.SphereGeometry(0.065, 6, 4), new T.MeshBasicMaterial({ color: 0xffffff }), n);
	const c = new T.Color();
	bulbOn = new Uint8Array(n).fill(1);
	bulbs.forEach((b, i) => {
		BULB.setMatrixAt(i, M(b.p.x, b.p.y, b.p.z));
		BULB.setColorAt(i, c.set(b.c));
	});
	BULB.frustumCulled = false;
	scene.add(BULB);
	let acc = 0;
	ents.push((dt) => {
		acc += dt;
		if (acc < 0.12) return;
		acc = 0;
		bulbFlash -= 0.12;
		const k = Math.max(1, (n * 0.06) | 0);
		for (let j = 0; j < k; j++) {
			const i = (Math.random() * n) | 0;
			bulbOn[i] = bulbFlash > 0 ? 1 : Math.random() < 0.7 ? 1 : 0;
			c.set(bulbs[i].c);
			if (!bulbOn[i]) c.multiplyScalar(0.18);
			BULB.setColorAt(i, c);
		}
		if (bulbFlash > 0) for (let i = treeBulb0; i < treeBulb1; i++) { bulbOn[i] = 1; BULB.setColorAt(i, c.set(0xffffff)); }
		if (bulbFlash > -0.12 && bulbFlash <= 0) for (let i = treeBulb0; i < treeBulb1; i++) BULB.setColorAt(i, c.set(bulbs[i].c));
		BULB.instanceColor.needsUpdate = true;
	});
}

// ---------- presents ----------
const PRESC = [0xd8262c, 0x2a7fe0, 0x2fa354, 0xf0c030, 0xb040d0, 0xffffff, 0xff7a2b];
const RIBC = [0xffd24a, 0xffffff, 0xe0262c, 0x3bd16a];
const toys = [];
function makeToys() {
	for (let i = 0; i < 8; i++) {
		const m = new T.Mesh(G.star, new T.MeshBasicMaterial({ color: 0xffffff }));
		m.visible = false; m.userData.life = 0;
		scene.add(m); toys.push(m);
	}
	ents.push((dt) => {
		for (const m of toys) {
			if (m.userData.life <= 0) continue;
			const u = m.userData;
			u.life -= dt;
			m.position.y += 0.9 * dt;
			m.position.x += Math.sin(u.life * 3) * 0.3 * dt;
			m.rotation.y += 3 * dt;
			m.scale.setScalar(0.35 * Math.min(1, u.life));
			if (Math.random() < dt * 20) emit(SPARK, m.position.x, m.position.y, m.position.z, rnd(-0.2, 0.2), rnd(-0.2, 0), rnd(-0.2, 0.2), 1.2, 0.1, 0.03, raw(u.hex), 0.9, 0, 0);
			if (u.life <= 0) m.visible = false;
		}
	});
}
function toy(x, y, z) {
	const m = toys.find(m => m.userData.life <= 0);
	if (!m) return;
	const hex = pick([0xffd84a, 0xff6bd0, 0x6bd8ff, 0x8aff6b]);
	m.material.color.set(hex);
	m.userData.hex = hex; m.userData.life = 4.5;
	m.position.set(x, y, z);
	m.visible = true;
}
function present(x, z) {
	const s = srnd(0.45, 0.7), hg = s * srnd(0.7, 1.0), col = spick(PRESC), rib = spick(RIBC.filter(r => r !== col));
	const g = new T.Group();
	g.position.set(x, 0, z); g.rotation.y = srnd(0, TAU);
	g.add(mesh([
		part(G.box, col, M(0, hg / 2, 0, s, hg, s)),
		part(G.box, rib, M(0, hg / 2, 0, s + 0.01, hg, 0.08)),
		part(G.box, rib, M(0, hg / 2, 0, 0.08, hg, s + 0.01)),
	]));
	const lid = new T.Group();
	lid.position.y = hg;
	lid.add(mesh([
		part(G.box, col, M(0, 0.05, 0, s + 0.06, 0.1, s + 0.06)),
		part(G.box, rib, M(0, 0.05, 0, s + 0.07, 0.11, 0.09)),
		part(G.box, rib, M(0, 0.05, 0, 0.09, 0.11, s + 0.07)),
		part(G.torus, rib, M(-0.08, 0.16, 0, 0.22, 0.22, 0.22, 0, 0, 0.7)),
		part(G.torus, rib, M(0.08, 0.16, 0, 0.22, 0.22, 0.22, 0, 0, -0.7)),
	]));
	g.add(lid);
	scene.add(g);
	const S = { t: 0, armed: true };
	const open = () => {
		if (S.t > 0) return;
		S.t = 0.0001; S.armed = false;
		sfx('pop', g.position); sfx('chime', g.position);
		for (let i = 0; i < 45; i++) emit(SPARK, x, hg + 0.1, z, rnd(-1.2, 1.2), rnd(1.5, 3.5), rnd(-1.2, 1.2), rnd(1.2, 2.2), 0.08, 0.05, raw(pick(GUM)), 1, 2.5, 0.6);
		toy(x, hg + 0.3, z);
	};
	const tg = { p: new T.Vector3(x, hg / 2, z), r: s * 0.7, hit: open };
	targets.push(tg);
	ents.push((dt) => {
		const d = Math.hypot(head.x - x, head.z - z);
		if (S.armed && d < 1.4) open();
		if (!S.armed && S.t === 0 && d > 2.6) S.armed = true;
		if (S.t > 0) {
			S.t += dt;
			const u = Math.min(1, S.t / 1.8);
			lid.position.y = hg + 1.6 * 4 * u * (1 - u);
			lid.rotation.y = u * 4 * PI;
			lid.rotation.x = Math.sin(u * PI) * 0.5;
			if (u >= 1) { S.t = 0; lid.position.y = hg; lid.rotation.set(0, 0, 0); }
		}
	});
}

// ---------- snowmen ----------
function snowman(x, z, style, sc) {
	const g = new T.Group();
	g.position.set(x, 0, z); g.rotation.y = Math.atan2(-x, -z); g.scale.setScalar(sc);
	const W = 0xf6f9ff, K = 0x1b1b22, B = 0x6b4a2e;
	const scarf = spick([0xd8262c, 0x2a7fe0, 0x2fa354, 0xb040d0]);
	const ra = 1.1, rx = Math.sin(ra) * 0.35, ry = Math.cos(ra) * 0.35;
	const body = [
		part(G.sph, W, M(0, 0.5, 0, 1.1, 1.0, 1.1)),
		part(G.sph, W, M(0, 1.25, 0, 0.82)),
		part(G.sphLo, K, M(0, 1.42, 0.37, 0.07)), part(G.sphLo, K, M(0, 1.25, 0.41, 0.07)), part(G.sphLo, K, M(0, 1.08, 0.38, 0.07)),
		part(G.torus, scarf, M(0, 1.62, 0, 0.62, 0.62, 0.62, PI / 2, 0, 0)),
		part(G.box, scarf, M(0.16, 1.4, 0.3, 0.12, 0.4, 0.05, 0.2, 0, 0.15)),
		part(G.cylLo, B, M(-0.38 - rx, 1.35 + ry, 0, 0.05, 0.7, 0.05, 0, 0, ra)),
		part(G.cylLo, B, rodM(-0.38 - rx * 1.8, 1.35 + ry * 1.8, 0, -0.38 - rx * 2.2, 1.35 + ry * 2.5, 0, 0.02)),
	];
	g.add(mesh(body));
	// waving arm
	const arm = new T.Group();
	arm.position.set(0.38, 1.35, 0); arm.rotation.z = -ra;
	arm.add(mesh([part(G.cylLo, B, M(0, 0.35, 0, 0.05, 0.7, 0.05)), part(G.cylLo, B, rodM(0, 0.6, 0, 0.12, 0.8, 0, 0.02)), part(G.cylLo, B, rodM(0, 0.62, 0, -0.08, 0.82, 0, 0.02))]));
	g.add(arm);
	// head
	const hd = new T.Group();
	hd.position.y = 1.62;
	const face = [part(G.sph, W, M(0, 0.3, 0, 0.6)),
		part(G.sphLo, K, M(-0.1, 0.38, 0.25, 0.07)), part(G.sphLo, K, M(0.1, 0.38, 0.25, 0.07)),
		part(G.cone, 0xff8a2b, M(0, 0.3, 0.42, 0.08, 0.3, 0.08, PI / 2, 0, 0))];
	for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.32; face.push(part(G.sphLo, K, M(Math.sin(a) * 0.15, 0.2 - Math.cos(a) * 0.04 + 0.04, 0.27 - Math.abs(a) * 0.03, 0.045))); }
	hd.add(mesh(face));
	const hat = new T.Group();
	hat.position.y = 0.52;
	if (style === 0) hat.add(mesh([part(G.cyl, K, M(0, 0, 0, 0.6, 0.04, 0.6)), part(G.cyl, K, M(0, 0.2, 0, 0.4, 0.38, 0.4)), part(G.cyl, 0xd8262c, M(0, 0.06, 0, 0.41, 0.07, 0.41))]));
	else hat.add(mesh([part(G.sph, scarf, M(0, -0.06, 0, 0.56, 0.4, 0.56)), part(G.cone, scarf, M(0, 0.16, 0, 0.42, 0.34, 0.42)), part(G.sph, 0xffffff, M(0, 0.34, 0, 0.16)), part(G.cyl, 0xffffff, M(0, -0.04, 0, 0.6, 0.08, 0.6))]));
	hd.add(hat);
	g.add(hd);
	scene.add(g);
	solids.push({ x, z, r: 0.7 * sc });
	const S = { wob: 0, hat: 0, hop: 0, cool: rnd(0, 3), yaw: 0 };
	const lp = new T.Vector3();
	targets.push({ p: new T.Vector3(x, 1.1 * sc, z), r: 0.75 * sc, hit: () => {
		S.wob = 1; if (S.hat <= 0) S.hat = 0.0001;
		sfx('giggle', g.position);
	} });
	ents.push((dt, t) => {
		const d = Math.hypot(head.x - x, head.z - z);
		lp.copy(head); g.worldToLocal(lp);
		const want = d < 9 ? clamp(Math.atan2(lp.x, lp.z), -1.3, 1.3) : Math.sin(t * 0.3 + x) * 0.4;
		S.yaw = angTo(S.yaw, want, Math.min(1, dt * 3));
		hd.rotation.y = S.yaw;
		hd.rotation.x = d < 9 ? clamp(-Math.atan2(lp.y - 1.9, Math.max(0.5, d)) * 0.5, -0.3, 0.3) : 0;
		arm.rotation.z = d < 6 ? -0.55 + Math.sin(t * 7) * 0.45 : angTo(arm.rotation.z, -ra, dt * 2);
		S.cool -= dt;
		if (d < 2.4 && S.cool <= 0) { S.hop = 0.0001; S.cool = 8; sfx('giggle', g.position); }
		if (S.hop > 0) { S.hop += dt; const u = Math.min(1, S.hop / 0.6); g.position.y = 0.25 * Math.sin(u * PI); if (u >= 1) { S.hop = 0; g.position.y = 0; } }
		S.wob *= Math.exp(-2.5 * dt);
		g.rotation.z = Math.sin(t * 13) * 0.22 * S.wob;
		if (S.hat > 0) {
			S.hat += dt;
			const u = Math.min(1, S.hat / 1.3);
			hat.position.y = 0.52 + 1.6 * 4 * u * (1 - u);
			hat.rotation.y = u * 4 * PI; hat.rotation.x = Math.sin(u * PI) * 0.6;
			if (u >= 1) { S.hat = 0; hat.position.y = 0.52; hat.rotation.set(0, 0, 0); }
		}
	});
}

// ---------- penguins on the ice rink ----------
function rink(cx, cz, R) {
	const ice = new T.Mesh(new T.CircleGeometry(R, 48).rotateX(-PI / 2), new T.MeshPhongMaterial({ color: 0xbfe2ff, shininess: 90, specular: 0x8fb0d0, polygonOffset: true, polygonOffsetFactor: -2 }));
	ice.position.set(cx, 0.02, cz);
	scene.add(ice);
	st(new T.TorusGeometry(R + 0.2, 0.4, 6, 48), 0xf4f8ff, M(cx, 0.05, cz, 1, 1, 0.5, PI / 2, 0, 0));
	for (let i = 0; i < 4; i++) penguin(cx, cz, R - 1);
}
function penguin(cx, cz, R) {
	const g = new T.Group();
	g.rotation.order = 'YXZ';
	const K = 0x1c1e26, W = 0xf6f6f6, O = 0xff9a1f;
	const body = mesh([
		part(G.sph, K, M(0, 0.38, 0, 0.5, 0.72, 0.46)),
		part(G.sph, W, M(0, 0.36, 0.13, 0.38, 0.56, 0.24)),
		part(G.sph, K, M(0, 0.8, 0, 0.34)),
		part(G.sph, W, M(0, 0.8, 0.1, 0.24, 0.2, 0.16)),
		part(G.sphLo, 0x000000, M(-0.06, 0.85, 0.15, 0.05)), part(G.sphLo, 0x000000, M(0.06, 0.85, 0.15, 0.05)),
		part(G.sphLo, 0xffffff, M(-0.055, 0.865, 0.17, 0.018)), part(G.sphLo, 0xffffff, M(0.065, 0.865, 0.17, 0.018)),
		part(G.cone, O, M(0, 0.78, 0.21, 0.07, 0.12, 0.07, PI / 2, 0, 0)),
		part(G.sphLo, O, M(-0.1, 0.03, 0.08, 0.14, 0.05, 0.2)), part(G.sphLo, O, M(0.1, 0.03, 0.08, 0.14, 0.05, 0.2)),
		part(G.sph, spick([0xd8262c, 0x2fa354, 0x2a7fe0]), M(0, 0.98, -0.02, 0.24, 0.16, 0.24)),
		part(G.sphLo, 0xffffff, M(0, 1.06, -0.02, 0.09)),
	]);
	g.add(body);
	const fl = [-1, 1].map(s => {
		const f = new T.Group();
		f.position.set(s * 0.24, 0.55, 0);
		f.add(mesh([part(G.sphLo, K, M(s * 0.03, -0.16, 0, 0.06, 0.34, 0.14))]));
		g.add(f);
		return f;
	});
	g.scale.setScalar(0.85);
	const S = { mode: 'idle', timer: rnd(0, 2), tx: cx, tz: cz, yaw: rnd(0, TAU), tilt: 0, v: 0, y: 0, vy: 0, ph: rnd(0, 6) };
	g.position.set(cx + rnd(-2, 2), 0, cz + rnd(-2, 2));
	const newT = () => { const a = rnd(0, TAU), r = rnd(0, R); S.tx = cx + Math.sin(a) * r; S.tz = cz + Math.cos(a) * r; };
	const tg = { p: new T.Vector3(), r: 0.4, hit: () => { S.vy = 3.2; S.y = 0.001; S.mode = 'idle'; S.timer = 1; sfx('squeak', g.position); } };
	targets.push(tg);
	scene.add(g);
	ents.push((dt, t) => {
		const P = g.position, dx = S.tx - P.x, dz = S.tz - P.z, d = Math.hypot(dx, dz);
		const dp = Math.hypot(head.x - P.x, head.z - P.z);
		let flap = 0.15 + Math.sin(t * 2 + S.ph) * 0.05, roll = 0;
		if (S.mode === 'walk') {
			S.yaw = angTo(S.yaw, Math.atan2(dx, dz), Math.min(1, dt * 4));
			S.tilt = angTo(S.tilt, 0, dt * 4);
			P.x += Math.sin(S.yaw) * 0.45 * dt; P.z += Math.cos(S.yaw) * 0.45 * dt;
			roll = Math.sin(t * 9 + S.ph) * 0.15;
			flap = 0.3 + Math.sin(t * 9 + S.ph) * 0.15;
			if (d < 0.25) { S.mode = 'idle'; S.timer = rnd(1, 3); }
		} else if (S.mode === 'slide') {
			S.tilt = angTo(S.tilt, 1.35, Math.min(1, dt * 6));
			P.x += Math.sin(S.yaw) * S.v * dt; P.z += Math.cos(S.yaw) * S.v * dt;
			S.v -= 1.0 * dt;
			flap = 1.2;
			if (Math.hypot(P.x - cx, P.z - cz) > R + 0.6) S.v = 0;
			if (S.v <= 0) { S.mode = 'up'; S.timer = 0.7; }
		} else if (S.mode === 'up') {
			S.tilt = angTo(S.tilt, 0, Math.min(1, dt * 4));
			S.timer -= dt;
			if (S.timer <= 0) { S.mode = 'idle'; S.timer = rnd(1, 2); }
		} else {
			S.tilt = angTo(S.tilt, 0, dt * 4);
			if (dp < 3) { S.yaw = angTo(S.yaw, Math.atan2(head.x - P.x, head.z - P.z), Math.min(1, dt * 3)); flap = 0.6 + Math.sin(t * 14) * 0.5; }
			S.timer -= dt;
			if (S.timer <= 0 && S.y <= 0) {
				newT();
				if (Math.random() < 0.45) { S.mode = 'slide'; S.v = rnd(2.2, 3.2); S.yaw = Math.atan2(S.tx - P.x, S.tz - P.z); }
				else S.mode = 'walk';
			}
		}
		if (S.y > 0 || S.vy > 0) {
			S.vy -= 9 * dt; S.y += S.vy * dt; flap = 1.3 + Math.sin(t * 30) * 0.4;
			if (S.y <= 0) { S.y = 0; S.vy = 0; }
		}
		P.y = S.y + 0.2 * Math.sin(S.tilt);
		g.rotation.set(S.tilt, S.yaw, roll);
		fl[0].rotation.z = -flap; fl[1].rotation.z = flap;
		tg.p.set(P.x, P.y + 0.4, P.z);
	});
}

// ---------- bunnies ----------
function bunny(x, z) {
	const g = new T.Group();
	const C = Math.random() < 0.7 ? 0xf6f6f6 : 0xc8a27a, PK = 0xffa6c0;
	g.add(mesh([
		part(G.sph, C, M(0, 0.2, 0, 0.36, 0.32, 0.46)),
		part(G.sph, C, M(0, 0.38, 0.2, 0.24)),
		part(G.sph, C, M(-0.05, 0.58, 0.16, 0.07, 0.26, 0.05, -0.15, 0, 0.15)),
		part(G.sph, C, M(0.05, 0.58, 0.16, 0.07, 0.26, 0.05, -0.15, 0, -0.15)),
		part(G.sph, PK, M(-0.05, 0.58, 0.18, 0.035, 0.18, 0.02, -0.15, 0, 0.15)),
		part(G.sph, PK, M(0.05, 0.58, 0.18, 0.035, 0.18, 0.02, -0.15, 0, -0.15)),
		part(G.sphLo, 0x111111, M(-0.08, 0.42, 0.29, 0.045)), part(G.sphLo, 0x111111, M(0.08, 0.42, 0.29, 0.045)),
		part(G.sphLo, PK, M(0, 0.36, 0.32, 0.04)),
		part(G.sph, 0xffffff, M(0, 0.24, -0.24, 0.12)),
	]));
	g.position.set(x, 0, z);
	g.scale.setScalar(0.85);
	scene.add(g);
	const S = { u: -1, x0: x, z0: z, x1: x, z1: z, hgt: 0.3, hops: 0, timer: rnd(0, 3), yaw: rnd(0, TAU) };
	const tg = { p: new T.Vector3(), r: 0.3, hit: () => { hopTo(1.4, 0.9, true); sfx('boing', g.position); } };
	targets.push(tg);
	function hopTo(dist, hgt, away) {
		const P = g.position;
		for (let k = 0; k < 6; k++) {
			let a = S.yaw + rnd(-0.8, 0.8);
			if (away) a = Math.atan2(P.x - head.x, P.z - head.z) + rnd(-0.6, 0.6);
			if (k > 2) a = rnd(0, TAU);
			const nx = P.x + Math.sin(a) * dist, nz = P.z + Math.cos(a) * dist;
			if (Math.hypot(nx, nz) > 37 || blocked(nx, nz, 0.3)) continue;
			S.x0 = P.x; S.z0 = P.z; S.x1 = nx; S.z1 = nz; S.yaw = a; S.u = 0; S.hgt = hgt;
			return;
		}
	}
	ents.push((dt, t) => {
		const P = g.position;
		if (S.u >= 0) {
			S.u += dt / 0.38;
			const u = Math.min(1, S.u);
			P.x = S.x0 + (S.x1 - S.x0) * u; P.z = S.z0 + (S.z1 - S.z0) * u;
			P.y = S.hgt * 4 * u * (1 - u);
			g.scale.set(0.85, 0.85 * (1 + 0.15 * Math.sin(u * PI)), 0.85);
			if (u >= 1) { S.u = -1; P.y = 0; S.timer = S.hops > 0 ? 0.08 : rnd(1.5, 4); }
		} else {
			g.scale.y = 0.85 * (1 - 0.04 * Math.pow(Math.sin(t * 9 + x), 2));
			S.timer -= dt;
			const dp = Math.hypot(head.x - P.x, head.z - P.z);
			if (dp < 1.8) { S.hops = 3; S.timer = 0; }
			if (S.timer <= 0) {
				if (S.hops <= 0) S.hops = 1 + ((Math.random() * 4) | 0);
				S.hops--;
				hopTo(rnd(0.5, 0.9), 0.28, dp < 2.5);
			}
		}
		g.rotation.y = angTo(g.rotation.y, S.yaw, Math.min(1, dt * 10));
		tg.p.set(P.x, P.y + 0.25, P.z);
	});
}

// ---------- reindeer ----------
function reindeer(splitHead) {
	const g = new T.Group();
	const B = 0x7b5434, D = 0x4a3020, L2 = 0xd9c49a, Wh = 0xf2efe6;
	const body = [
		part(G.box, B, M(0, 1.0, 0, 0.5, 0.48, 0.9)),
		part(G.sphLo, B, M(0, 1.0, 0.45, 0.52, 0.5, 0.5)),
		part(G.sphLo, B, M(0, 1.0, -0.45, 0.52, 0.5, 0.5)),
		part(G.sphLo, Wh, M(0, 1.15, -0.68, 0.16)),
		part(G.box, 0xc0302e, M(0, 1.0, 0.32, 0.54, 0.52, 0.12)),
		part(G.sphLo, 0xe8c050, M(0, 0.76, 0.34, 0.12)),
	];
	const headParts = [
		part(G.cylLo, B, rodM(0, 0, 0, 0, 0.42, 0.22, 0.11)),
		part(G.box, B, M(0, 0.52, 0.32, 0.26, 0.28, 0.4)),
		part(G.box, 0x9a6e48, M(0, 0.47, 0.54, 0.2, 0.18, 0.16)),
		part(G.sphLo, 0x111111, M(0, 0.5, 0.63, 0.08)),
		part(G.sphLo, 0x111111, M(-0.11, 0.6, 0.4, 0.05)), part(G.sphLo, 0x111111, M(0.11, 0.6, 0.4, 0.05)),
		part(G.sphLo, B, M(-0.17, 0.64, 0.22, 0.07, 0.15, 0.04, 0, 0, 0.8)), part(G.sphLo, B, M(0.17, 0.64, 0.22, 0.07, 0.15, 0.04, 0, 0, -0.8)),
	];
	for (const s of [-1, 1]) {
		headParts.push(part(G.cylLo, L2, rodM(s * 0.07, 0.65, 0.25, s * 0.24, 1.0, 0.16, 0.025)));
		headParts.push(part(G.cylLo, L2, rodM(s * 0.16, 0.82, 0.21, s * 0.3, 0.9, 0.36, 0.02)));
		headParts.push(part(G.cylLo, L2, rodM(s * 0.21, 0.93, 0.18, s * 0.14, 1.12, 0.26, 0.02)));
		headParts.push(part(G.cylLo, L2, rodM(s * 0.24, 1.0, 0.16, s * 0.36, 1.12, 0.1, 0.02)));
	}
	let hd = null;
	if (splitHead) {
		g.add(mesh(body));
		hd = new T.Group();
		hd.position.set(0, 1.15, 0.55);
		hd.add(mesh(headParts));
		g.add(hd);
	} else g.add(mesh(body.concat(under(M(0, 1.15, 0.55), headParts))));
	const legs = [];
	for (const [lx, lz] of [[-0.17, 0.45], [0.17, 0.45], [-0.17, -0.45], [0.17, -0.45]]) {
		const l = new T.Group();
		l.position.set(lx, 0.85, lz);
		l.add(mesh([part(G.cylLo, B, M(0, -0.38, 0, 0.1, 0.76, 0.1)), part(G.box, D, M(0, -0.8, 0.02, 0.11, 0.1, 0.14))]));
		g.add(l);
		legs.push(l);
	}
	return { g, legs, hd };
}
function pen(cx, cz) {
	const R = 3.5, W = 0x6b4a2e, n = 16;
	for (let i = 0; i < n; i++) {
		const a = i / n * TAU, b = (i + 1) / n * TAU;
		const x = cx + Math.sin(a) * R, z = cz + Math.cos(a) * R, x2 = cx + Math.sin(b) * R, z2 = cz + Math.cos(b) * R;
		st(G.box, W, M(x, 0.42, z, 0.14, 0.84, 0.14, 0, a, 0));
		st(G.box, 0xf4f8ff, M(x, 0.87, z, 0.18, 0.07, 0.18, 0, a, 0));
		st(G.cylLo, W, rodM(x, 0.3, z, x2, 0.3, z2, 0.04));
		st(G.cylLo, W, rodM(x, 0.7, z, x2, 0.7, z2, 0.04));
	}
	st(G.box, 0xd8b54a, M(cx + 0.8, 0.3, cz - 0.6, 1.1, 0.6, 0.7, 0, 0.4, 0));
	st(G.box, 0xc9a43a, M(cx + 0.8, 0.61, cz - 0.6, 1.0, 0.04, 0.6, 0, 0.4, 0));
	solids.push({ x: cx, z: cz, r: R + 0.4 });
	for (const [ox, oz, ry] of [[-1.0, 0.6, 0.6], [1.2, 1.0, -2.2]]) {
		const r = reindeer(true);
		r.g.position.set(cx + ox, 0, cz + oz); r.g.rotation.y = ry; r.g.scale.setScalar(0.85);
		scene.add(r.g);
		const S = { eat: rnd(0, 5), look: 0 }, lp = new T.Vector3();
		targets.push({ p: new T.Vector3(cx + ox, 0.9, cz + oz), r: 0.6, hit: () => { S.eat = 2; sfx('jingle', r.g.position, 1); } });
		ents.push((dt, t) => {
			const d = Math.hypot(head.x - r.g.position.x, head.z - r.g.position.z);
			lp.copy(head); r.g.worldToLocal(lp);
			S.eat -= dt;
			if (S.eat < -6) S.eat = rnd(3, 7);
			const eating = S.eat > 0 && d > 6;
			const wy = d < 8 && !eating ? clamp(Math.atan2(lp.x, lp.z), -1, 1) : 0;
			r.hd.rotation.y = angTo(r.hd.rotation.y, wy, Math.min(1, dt * 3));
			r.hd.rotation.x = angTo(r.hd.rotation.x, eating ? 1.3 + Math.sin(t * 5) * 0.08 : -0.1, Math.min(1, dt * 2));
		});
	}
}

// ---------- Santa's sleigh ----------
function sleigh() {
	const g = new T.Group();
	const R = 0xc42a2a, Au = 0xe8c050, Sk = 0xf2c6a0, Wh = 0xffffff;
	const parts = [
		part(G.box, R, M(0, 0.55, 0, 1.2, 0.5, 1.7)),
		part(G.box, R, M(0, 1.0, -0.65, 1.2, 0.7, 0.45)),
		part(G.box, R, M(0, 0.85, 0.75, 1.2, 0.25, 0.3, -0.5, 0, 0)),
		part(G.box, Au, M(0, 0.8, 0, 1.24, 0.06, 1.74)),
		part(G.box, Au, M(-0.5, 0.12, 0, 0.06, 0.06, 2.0)), part(G.box, Au, M(0.5, 0.12, 0, 0.06, 0.06, 2.0)),
		part(G.torus, Au, M(-0.5, 0.42, 1.0, 0.65, 0.65, 0.4, 0, PI / 2, 0)), part(G.torus, Au, M(0.5, 0.42, 1.0, 0.65, 0.65, 0.4, 0, PI / 2, 0)),
		part(G.cylLo, Au, M(-0.5, 0.3, -0.3, 0.05, 0.4, 0.05)), part(G.cylLo, Au, M(0.5, 0.3, -0.3, 0.05, 0.4, 0.05)),
		part(G.cylLo, Au, M(-0.5, 0.3, 0.4, 0.05, 0.4, 0.05)), part(G.cylLo, Au, M(0.5, 0.3, 0.4, 0.05, 0.4, 0.05)),
		// Santa
		part(G.cyl, R, M(0, 1.15, -0.2, 0.75, 0.8, 0.65)),
		part(G.cyl, 0x222222, M(0, 1.0, -0.2, 0.77, 0.1, 0.67)),
		part(G.box, Au, M(0, 1.0, 0.13, 0.14, 0.12, 0.04)),
		part(G.sph, Sk, M(0, 1.78, -0.2, 0.42)),
		part(G.sph, Wh, M(0, 1.66, -0.06, 0.44, 0.42, 0.3)),
		part(G.sphLo, 0x222222, M(-0.08, 1.84, -0.01, 0.05)), part(G.sphLo, 0x222222, M(0.08, 1.84, -0.01, 0.05)),
		part(G.sphLo, 0xe88a8a, M(0, 1.78, 0.02, 0.08)),
		part(G.cone, R, M(0, 2.15, -0.25, 0.4, 0.5, 0.4, -0.3, 0, 0)),
		part(G.torus, Wh, M(0, 1.97, -0.2, 0.42, 0.42, 0.6, PI / 2, 0, 0)),
		part(G.sphLo, Wh, M(0, 2.38, -0.36, 0.14)),
		part(G.cylLo, R, rodM(-0.3, 1.4, -0.2, -0.28, 1.15, 0.25, 0.08)),
		part(G.sphLo, Wh, M(-0.28, 1.15, 0.27, 0.13)),
		part(G.sph, 0x7a5a3a, M(0, 1.35, -0.75, 0.85, 0.8, 0.6)),
		part(G.box, PRESC[1], M(0.25, 1.75, -0.75, 0.3, 0.3, 0.3, 0.3, 0.4, 0)),
		part(G.box, PRESC[3], M(-0.2, 1.72, -0.8, 0.26, 0.26, 0.26, -0.2, 0.2, 0.3)),
		// reins
		part(G.cylLo, 0x6b2a1a, rodM(-0.28, 1.15, 0.3, -0.45, 1.0, 2.2, 0.012)),
		part(G.cylLo, 0x6b2a1a, rodM(-0.28, 1.15, 0.3, 0.45, 1.0, 2.2, 0.012)),
	];
	g.add(mesh(parts));
	const arm = new T.Group();
	arm.position.set(0.3, 1.4, -0.2);
	arm.add(mesh([part(G.cylLo, R, M(0, 0.25, 0, 0.16, 0.5, 0.16)), part(G.sphLo, Wh, M(0, 0.52, 0, 0.15))]));
	g.add(arm);
	const deer = [];
	for (const [x, z] of [[-0.5, 2.6], [0.5, 2.6], [-0.5, 4.2], [0.5, 4.2]]) {
		const r = reindeer(false);
		r.g.position.set(x, -0.1, z); r.g.scale.setScalar(0.85);
		g.add(r.g);
		deer.push(r);
	}
	scene.add(g);
	const p = new T.Vector3(), q = new T.Vector3();
	const path = (s, v) => {
		const R = 34 + 6 * Math.sin(s * 2);
		return v.set(Math.sin(s) * R, 19 + 7 * Math.sin(s * 1.7), Math.cos(s) * R);
	};
	let bell = 0, ho = 8;
	ents.push((dt, t) => {
		const s = t * 0.11;
		path(s, p); path(s + 0.02, q);
		g.position.copy(p);
		g.lookAt(q);
		g.rotateZ(-0.22);
		deer.forEach((r, i) => r.legs.forEach((l, j) => { l.rotation.x = Math.sin(t * 9 + i * 0.7 + (j < 2 ? 0 : PI)) * 0.6; }));
		const d = p.distanceTo(head);
		arm.rotation.z = d < 30 ? -0.4 + Math.sin(t * 6) * 0.35 : -2.6;
		if (Math.random() < dt * 30) emit(SPARK, p.x + rnd(-0.5, 0.5), p.y + 0.1, p.z + rnd(-0.5, 0.5), rnd(-0.3, 0.3), rnd(-0.6, -0.2), rnd(-0.3, 0.3), rnd(1.8, 3), 0.35, 0.12, pick([raw(0xffe08a), raw(0xffffff), raw(0xffc0f0)]), 1, 0.1, 0.2);
		bell -= dt; ho -= dt;
		if (bell <= 0) { bell = 0.55; sfx('jingle', p, 0.8, 10); }
		if (ho <= 0) { ho = rnd(18, 28); if (d < 50) sfx('hoho', p); }
	});
}

// ---------- toy train around the tree ----------
function train() {
	const R = 7.0;
	st(new T.TorusGeometry(R - 0.3, 0.035, 4, 120), 0x8a8a94, M(0, 0.07, 0, 1, 1, 1, PI / 2, 0, 0));
	st(new T.TorusGeometry(R + 0.3, 0.035, 4, 120), 0x8a8a94, M(0, 0.07, 0, 1, 1, 1, PI / 2, 0, 0));
	for (let i = 0; i < 80; i++) {
		const a = i / 80 * TAU;
		st(G.box, 0x5a3a22, M(Math.sin(a) * R, 0.02, Math.cos(a) * R, 0.18, 0.05, 0.9, 0, a + PI / 2, 0));
	}
	const RR = 0xc0282d, K = 0x222228, Au = 0xe8c050;
	const wheels = (len) => {
		const w = [];
		for (const s of [-1, 1]) for (let i = 0; i < 3; i++) w.push(part(G.cyl, K, M(s * 0.34, 0.18, -len / 2 + 0.25 + i * (len - 0.5) / 2, 0.34, 0.06, 0.34, 0, 0, PI / 2)));
		return w;
	};
	const cars = [];
	const eng = new T.Group();
	eng.add(mesh([
		part(G.box, K, M(0, 0.3, 0, 0.7, 0.15, 1.6)),
		part(G.cyl, RR, M(0, 0.62, 0.25, 0.6, 1.0, 0.6, PI / 2, 0, 0)),
		part(G.torus, Au, M(0, 0.62, 0.0, 0.64, 0.64, 0.3)), part(G.torus, Au, M(0, 0.62, 0.5, 0.64, 0.64, 0.3)),
		part(G.cyl, K, M(0, 0.62, 0.76, 0.5, 0.04, 0.5, PI / 2, 0, 0)),
		part(G.cyl, K, M(0, 1.05, 0.55, 0.2, 0.36, 0.2)), part(G.cone, K, M(0, 1.28, 0.55, 0.32, 0.14, 0.32, PI, 0, 0)),
		part(G.sph, Au, M(0, 0.95, 0.15, 0.22)),
		part(G.box, RR, M(0, 0.78, -0.45, 0.72, 0.8, 0.6)),
		part(G.box, K, M(0, 1.22, -0.45, 0.82, 0.08, 0.72)),
		part(G.box, 0x9fd4ff, M(0, 0.92, -0.45, 0.74, 0.22, 0.4)),
		part(G.box, K, M(0, 0.22, 0.88, 0.6, 0.2, 0.2, 0.5, 0, 0)),
	].concat(wheels(1.5))));
	eng.add(mesh([part(G.sphLo, 0xfff0a0, M(0, 0.62, 0.8, 0.18))], true));
	cars.push(eng);
	for (const c of [0x2fa354, 0x2a7fe0, 0xf0c030]) {
		const w = new T.Group();
		const p = [
			part(G.box, K, M(0, 0.3, 0, 0.7, 0.12, 1.3)),
			part(G.box, c, M(0, 0.45, 0, 0.72, 0.2, 1.3)),
			part(G.box, c, M(-0.34, 0.65, 0, 0.05, 0.3, 1.3)), part(G.box, c, M(0.34, 0.65, 0, 0.05, 0.3, 1.3)),
			part(G.box, c, M(0, 0.65, 0.63, 0.7, 0.3, 0.05)), part(G.box, c, M(0, 0.65, -0.63, 0.7, 0.3, 0.05)),
			part(G.box, spick(PRESC), M(0, 0.7, 0.25, 0.42, 0.42, 0.42, 0, 0.3, 0)),
			part(G.box, spick(PRESC), M(0.05, 0.68, -0.3, 0.38, 0.38, 0.38, 0, -0.4, 0)),
		].concat(wheels(1.2));
		w.add(mesh(p));
		cars.push(w);
	}
	cars.forEach(c => scene.add(c));
	const tgs = cars.map(() => ({ p: new T.Vector3(), r: 0.6, hit: () => { whistle = 0; } }));
	tgs.forEach(t => targets.push(t));
	let whistle = 4, puff = 0;
	const smoke = new T.Vector3();
	ents.push((dt, t) => {
		const a0 = t * 0.22;
		cars.forEach((c, i) => {
			const a = a0 - i * 1.6 / R;
			c.position.set(Math.sin(a) * R, 0.04, Math.cos(a) * R);
			c.rotation.y = Math.atan2(Math.cos(a), -Math.sin(a));
			c.position.y = 0.04 + Math.abs(Math.sin(t * 9 + i)) * 0.015;
			tgs[i].p.set(c.position.x, 0.6, c.position.z);
		});
		puff -= dt;
		if (puff <= 0) {
			puff = 0.14;
			smoke.set(0, 1.35, 0.55).applyMatrix4(eng.matrixWorld);
			emit(SMOKE, smoke.x, smoke.y, smoke.z, rnd(-0.1, 0.1), rnd(0.5, 0.8), rnd(-0.1, 0.1), 2.5, 0.15, 0.7, raw(0xe8ecf5), 0.6, -0.05, 0.5);
		}
		whistle -= dt;
		if (whistle <= 0) { whistle = rnd(12, 22); sfx('whistle', eng.position); }
	});
}

// ---------- falling snow ----------
function snowfall() {
	const N = 1800, B = 14;
	const pos = new Float32Array(N * 3), col = new Float32Array(N * 3).fill(1), size = new Float32Array(N), alpha = new Float32Array(N);
	const sp = new Float32Array(N), ph = new Float32Array(N);
	for (let i = 0; i < N; i++) {
		pos[i * 3] = rnd(-B, B); pos[i * 3 + 1] = rnd(0, B); pos[i * 3 + 2] = rnd(-B, B);
		size[i] = rnd(0.025, 0.05); alpha[i] = rnd(0.6, 0.95); sp[i] = rnd(0.5, 1.1); ph[i] = rnd(0, TAU);
	}
	const geo = new T.BufferGeometry();
	geo.setAttribute('position', new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
	geo.setAttribute('pcolor', new T.BufferAttribute(col, 3));
	geo.setAttribute('psize', new T.BufferAttribute(size, 1));
	geo.setAttribute('palpha', new T.BufferAttribute(alpha, 1));
	const p = new T.Points(geo, pmat(false));
	p.frustumCulled = false;
	scene.add(p);
	ents.push((dt, t) => {
		for (let i = 0; i < N; i++) {
			let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
			y -= sp[i] * dt;
			x += Math.sin(t * 0.7 + ph[i]) * 0.25 * dt + 0.12 * dt;
			z += Math.cos(t * 0.5 + ph[i]) * 0.2 * dt;
			if (y < 0) y += B;
			if (x - head.x > B) x -= 2 * B; else if (x - head.x < -B) x += 2 * B;
			if (z - head.z > B) z -= 2 * B; else if (z - head.z < -B) z += 2 * B;
			pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
		}
		geo.attributes.position.needsUpdate = true;
	});
}

// ---------- chimney smoke ----------
function chimneys() {
	let acc = 0;
	ents.push((dt) => {
		acc += dt;
		if (acc < 0.3) return;
		acc = 0;
		for (const s of smokers) emit(SMOKE, s.x + rnd(-0.1, 0.1), s.y, s.z + rnd(-0.1, 0.1), rnd(0.05, 0.2), rnd(0.4, 0.6), rnd(-0.05, 0.1), 6, 0.3, 1.6, raw(0xb8c0d4), 0.35, -0.02, 0.1);
	});
}

// ---------- footprints and snow splats on the ground ----------
let FOOT, footI = 0, footN = 0;
const lastFoot = new T.Vector3(1e9, 0, 0);
let SPLAT, splatI = 0;
function decals() {
	FOOT = new T.InstancedMesh(new T.CircleGeometry(0.5, 12).rotateX(-PI / 2), new T.MeshBasicMaterial({ color: 0x9fb0cc, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), 160);
	SPLAT = new T.InstancedMesh(new T.CircleGeometry(0.5, 10).rotateX(-PI / 2), new T.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -4 }), 50);
	const z = M(0, -100, 0, 0.0001);
	for (let i = 0; i < 160; i++) FOOT.setMatrixAt(i, z);
	for (let i = 0; i < 50; i++) SPLAT.setMatrixAt(i, z);
	FOOT.frustumCulled = SPLAT.frustumCulled = false;
	scene.add(FOOT, SPLAT);
}
function footstep() {
	const dx = head.x - lastFoot.x, dz = head.z - lastFoot.z, d = Math.hypot(dx, dz);
	if (d < 0.42) return;
	if (d > 3) { lastFoot.set(head.x, 0, head.z); return; }
	const a = Math.atan2(dx, dz), s = footN++ % 2 ? 1 : -1;
	const x = head.x + Math.cos(a) * 0.09 * s, z = head.z - Math.sin(a) * 0.09 * s;
	FOOT.setMatrixAt(footI, M(x, 0.02, z, 0.11, 1, 0.19, 0, a, 0));
	footI = (footI + 1) % 160;
	FOOT.instanceMatrix.needsUpdate = true;
	lastFoot.set(head.x, 0, head.z);
}
function groundSplat(x, y, z) {
	SPLAT.setMatrixAt(splatI, M(x, y + 0.02, z, rnd(0.25, 0.4), 1, rnd(0.25, 0.4), 0, rnd(0, TAU), 0));
	splatI = (splatI + 1) % 50;
	SPLAT.instanceMatrix.needsUpdate = true;
}

// ---------- snowball gun ----------
const BALLN = 40, balls = [];
let BALLS;
function snowballs() {
	BALLS = new T.InstancedMesh(new T.SphereGeometry(0.07, 10, 8), new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0x30384a }), BALLN);
	for (let i = 0; i < BALLN; i++) { balls.push({ p: new T.Vector3(), v: new T.Vector3(), life: -1 }); BALLS.setMatrixAt(i, M(0, -100, 0, 0.0001)); }
	BALLS.frustumCulled = false;
	scene.add(BALLS);
}
let ballI = 0;
function shoot(p, d) {
	const b = balls[ballI];
	ballI = (ballI + 1) % BALLN;
	b.p.copy(p); b.v.copy(d).multiplyScalar(11); b.v.y += 1.0; b.life = 0;
}
function puffAt(p, n) {
	for (let i = 0; i < n; i++) emit(SMOKE, p.x, p.y, p.z, rnd(-1.5, 1.5), rnd(0, 2.2), rnd(-1.5, 1.5), rnd(0.35, 0.6), 0.07, 0.04, raw(0xffffff), 0.95, 6, 1);
}
const _m = new T.Matrix4();
function stepBalls(dt) {
	for (let i = 0; i < BALLN; i++) {
		const b = balls[i];
		if (b.life < 0) continue;
		b.life += dt;
		b.v.y -= 7 * dt;
		b.p.addScaledVector(b.v, dt);
		let hit = false;
		for (const tg of targets) {
			const rr = tg.r + 0.08;
			if (b.p.distanceToSquared(tg.p) < rr * rr) { tg.hit(b.p); hit = true; sfx('splat', b.p); break; }
		}
		if (!hit) for (const w of walls) {
			const dx = b.p.x - w.x, dz = b.p.z - w.z;
			if (dx * dx + dz * dz < w.r * w.r && b.p.y < w.h) { hit = true; sfx('thud', b.p); break; }
		}
		if (!hit) {
			const r = Math.hypot(b.p.x, b.p.z);
			if (b.p.y < 9.4 && (r < treeR(b.p.y) + 0.1 || (r < 0.5 && b.p.y < 1.2))) {
				hit = true; bulbFlash = 0.7; sfx('jingle', b.p, 1.2, 4);
			}
		}
		if (!hit) {
			const gy = groundH(b.p.x, b.p.z);
			if (b.p.y < gy + 0.07) { hit = true; groundSplat(b.p.x, gy, b.p.z); sfx('splat', b.p); }
		}
		if (hit || b.life > 5) {
			if (hit) puffAt(b.p, 14);
			b.life = -1;
			BALLS.setMatrixAt(i, M(0, -100, 0, 0.0001));
		} else BALLS.setMatrixAt(i, _m.makeTranslation(b.p.x, b.p.y, b.p.z));
	}
	BALLS.instanceMatrix.needsUpdate = true;
}
function gunModel() {
	const g = new T.Group();
	const Bl = 0x6cc4f0, Rd = 0xe23b3b, Wh = 0xf6f9ff;
	g.add(mesh([
		part(G.box, Bl, M(0, 0, 0.03, 0.07, 0.09, 0.2)),
		part(G.cyl, Wh, M(0, 0.005, -0.12, 0.06, 0.16, 0.06, PI / 2, 0, 0)),
		part(G.torus, Rd, M(0, 0.005, -0.2, 0.13, 0.13, 0.3)),
		part(G.box, Rd, M(0, -0.08, 0.09, 0.05, 0.13, 0.06, 0.35, 0, 0)),
		part(G.box, Rd, M(0, -0.045, 0.03, 0.02, 0.03, 0.07)),
		part(G.sph, 0xbfe6ff, M(0, 0.065, 0.04, 0.1, 0.08, 0.12)),
		part(G.sphLo, Wh, M(-0.02, 0.09, 0.03, 0.04)), part(G.sphLo, Wh, M(0.02, 0.085, 0.06, 0.04)), part(G.sphLo, Wh, M(0.005, 0.1, 0.0, 0.035)),
		part(G.sphLo, 0xffd24a, M(0, 0.03, 0.135, 0.035)),
	]));
	g.position.set(0, -0.02, 0.06);
	return g;
}
const _mz = new T.Vector3(), _mq = new T.Quaternion(), _md = new T.Vector3();
function fireFrom(obj, gun, src) {
	_mz.set(0, 0.005, -0.21);
	gun.localToWorld(_mz);
	obj.getWorldQuaternion(_mq);
	_md.set(0, 0, -1).applyQuaternion(_mq);
	shoot(_mz, _md);
	sfx('fire', _mz);
	gun.position.z = 0.1;
	const h = src && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
	if (h && h.pulse) h.pulse(0.5, 40);
}

// ---------- player ----------
const ctrls = [];
function setupControllers() {
	for (let i = 0; i < 2; i++) {
		const c = renderer.xr.getController(i);
		c.userData = { src: null, cool: 0, gun: null, turnReady: true };
		c.addEventListener('connected', (e) => {
			c.userData.src = e.data;
			if (!c.userData.gun && e.data.gamepad) { const g = gunModel(); c.add(g); c.userData.gun = g; }
		});
		c.addEventListener('disconnected', () => {
			c.userData.src = null;
			if (c.userData.gun) { c.remove(c.userData.gun); c.userData.gun = null; }
		});
		rig.add(c);
		ctrls.push(c);
	}
}
const _hp = new T.Vector3(), _hf = new T.Vector3();
function snapTurn(a) {
	camera.getWorldPosition(_hp);
	rig.rotation.y += a;
	rig.updateMatrixWorld(true);
	camera.getWorldPosition(_hf);
	rig.position.x += _hp.x - _hf.x; rig.position.z += _hp.z - _hf.z;
}
function moveRig(mx, my, dt) {
	const len = Math.hypot(mx, my);
	if (len < 0.01) return;
	if (len > 1) { mx /= len; my /= len; }
	camera.getWorldDirection(_hf);
	_hf.y = 0;
	if (_hf.lengthSq() < 1e-6) return;
	_hf.normalize();
	const fx = _hf.x, fz = _hf.z, rx = -fz, rz = fx;
	rig.position.x += (rx * mx - fx * my) * WALK * dt;
	rig.position.z += (rz * mx - fz * my) * WALK * dt;
}
function resolve() {
	rig.updateMatrixWorld(true);
	camera.getWorldPosition(head);
	let x = head.x, z = head.z;
	for (let k = 0; k < 2; k++) for (const s of solids) {
		const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
		if (d < s.r && d > 1e-4) { x = s.x + dx / d * s.r; z = s.z + dz / d * s.r; }
	}
	const r = Math.hypot(x, z);
	if (r > EDGE) { x *= EDGE / r; z *= EDGE / r; }
	rig.position.x += x - head.x; rig.position.z += z - head.z;
	head.x = x; head.z = z;
}
function xrInput(dt) {
	let mx = 0, my = 0;
	for (const c of ctrls) {
		const u = c.userData, s = u.src;
		if (u.gun) u.gun.position.z += (0.06 - u.gun.position.z) * Math.min(1, dt * 12);
		if (!s || !s.gamepad) continue;
		const b = s.gamepad.buttons, ax = s.gamepad.axes;
		const sx = ax.length >= 4 ? ax[2] : (ax[0] || 0), sy = ax.length >= 4 ? ax[3] : (ax[1] || 0);
		const press = (i) => b[i] && b[i].pressed;
		u.cool -= dt;
		if ((press(0) || press(1) || press(4) || press(5)) && u.cool <= 0 && u.gun) { fireFrom(c, u.gun, s); u.cool = 0.25; }
		if (s.handedness === 'right') {
			if (Math.abs(sx) > 0.7 && u.turnReady) { snapTurn(sx > 0 ? -SNAP : SNAP); u.turnReady = false; }
			else if (Math.abs(sx) < 0.3) u.turnReady = true;
			if (Math.abs(sy) > 0.25) my += sy;
		} else {
			if (Math.abs(sx) > 0.2) mx += sx;
			if (Math.abs(sy) > 0.2) my += sy;
		}
	}
	moveRig(mx, my, dt);
}

// ---------- desktop test mode (mouse + WASD, click to throw) ----------
function deskInput(dt) {
	const k = desk.keys;
	const mx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), my = (k.KeyS ? 1 : 0) - (k.KeyW ? 1 : 0);
	rig.rotation.y = desk.yaw;
	camera.rotation.set(desk.pitch, 0, 0);
	moveRig(mx, my, dt);
	desk.cool -= dt;
	if (desk.fire && desk.cool <= 0) {
		desk.cool = 0.25;
		camera.getWorldPosition(_mz); camera.getWorldDirection(_md);
		_mz.y -= 0.15;
		shoot(_mz, _md);
		sfx('fire', _mz);
	}
}
function startDesk() {
	audioStart();
	desk = { keys: {}, yaw: 0, pitch: 0, fire: false, cool: 0 };
	window.__setView = (y, p) => { desk.yaw = y; desk.pitch = p; };
	ui.style.display = 'none';
	const cv = renderer.domElement;
	PSCALE.value = innerHeight / (2 * Math.tan(camera.fov * PI / 360));
	addEventListener('keydown', e => { desk.keys[e.code] = true; });
	addEventListener('keyup', e => { desk.keys[e.code] = false; });
	cv.addEventListener('mousedown', () => { if (document.pointerLockElement !== cv && cv.requestPointerLock) cv.requestPointerLock(); desk.fire = true; });
	addEventListener('mouseup', () => { desk.fire = false; });
	addEventListener('mousemove', e => {
		if (document.pointerLockElement !== cv) return;
		desk.yaw -= e.movementX * 0.0025;
		desk.pitch = clamp(desk.pitch - e.movementY * 0.0025, -1.3, 1.3);
	});
}

// ---------- build the village ----------
function buildWorld() {
	scene.fog = new T.FogExp2(0x4d4d85, 0.005);
	scene.add(new T.HemisphereLight(0xa8c0ff, 0x5a6a8a, 1.5));
	const moon = new T.DirectionalLight(0xc8d8ff, 1.1);
	moon.position.set(190, 160, -250);
	scene.add(moon);
	SMOKE = makePS(700, false);
	SPARK = makePS(1400, true);
	buildSky();
	buildGround();
	bigTree();
	// houses around the plaza (degrees from +z)
	const HA = [20, 60, 100, 140, 200, 240, 280];
	HA.forEach((a, i) => {
		const [x, z] = polar(a, 20);
		house(x, z, a * PI / 180 + PI, WALLC[i % WALLC.length], a === 100);
		// path from plaza to the door
		const [px, pz] = polar(a, 12.6);
		const path = new T.Mesh(new T.PlaneGeometry(1.7, 9).rotateX(-PI / 2), new T.MeshLambertMaterial({ color: 0xb4c0d8, polygonOffset: true, polygonOffsetFactor: -2 }));
		path.position.set(px, 0.012, pz); path.rotation.y = a * PI / 180;
		scene.add(path);
		for (const s of [-1, 1]) {
			const [cx, cz] = polar(a + s * 6, 9.3);
			cane(M(cx, 0, cz, 1.15, 1.15, 1.15, 0, a * PI / 180 + (s > 0 ? 0 : PI), 0));
		}
	});
	for (let a = 0; a < 360; a += 45) { const [x, z] = polar(a + 22.5, 11.8); lamp(x, z); }
	const [rx, rz] = polar(322, 23.5); rink(rx, rz, 6);
	const [nx, nz] = polar(170, 26.5); pen(nx, nz);
	train();
	for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + 0.2; present(Math.sin(a) * 4.1, Math.cos(a) * 4.1); }
	[[345, 13, 0], [40, 14, 1], [120, 14, 0], [185, 15, 1], [222, 13.5, 0], [262, 14, 1], [300, 14.5, 0], [75, 31, 1]].forEach(([a, r, s], i) => {
		const [x, z] = polar(a, r);
		snowman(x, z, s, 0.85 + (i % 3) * 0.07);
	});
	fence();
	innerTrees();
	forest();
	for (let i = 0; i < 7; i++) {
		for (let k = 0; k < 50; k++) {
			const a = rnd(0, TAU), r = rnd(10, 36), x = Math.sin(a) * r, z = Math.cos(a) * r;
			if (!blocked(x, z, 0.6)) { bunny(x, z); break; }
		}
	}
	sleigh();
	chimneys();
	snowfall();
	decals();
	snowballs();
	makeToys();
	// bake the static world into two meshes
	scene.add(mesh(ST.lit), mesh(ST.glow, true));
	staticPoints(halos, true);
	bakeBulbs();
}

// ---------- main loop ----------
let last = 0;
function loop(time) {
	const t = time / 1000;
	const dt = Math.min(0.05, last ? t - last : 0.016);
	last = t;
	if (renderer.xr.isPresenting) xrInput(dt);
	else if (desk) deskInput(dt);
	resolve();
	footstep();
	for (const f of ents) f(dt, t);
	stepBalls(dt);
	pstep(SMOKE, dt);
	pstep(SPARK, dt);
	musicTick();
	listen();
	renderer.render(scene, camera);
}

// ---------- start ----------
const ui = document.getElementById('ui');
const msg = document.getElementById('msg');
function init() {
	renderer = new T.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	renderer.setSize(innerWidth, innerHeight);
	renderer.xr.enabled = true;
	renderer.xr.setReferenceSpaceType('local-floor');
	renderer.xr.setFoveation(1);
	document.body.appendChild(renderer.domElement);
	scene = new T.Scene();
	camera = new T.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 1000);
	camera.position.y = 1.15;
	rig = new T.Group();
	rig.position.set(0, 0, 10.5);
	rig.add(camera);
	scene.add(rig);
	buildWorld();
	setupControllers();
	addEventListener('resize', () => {
		camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
		renderer.setSize(innerWidth, innerHeight);
		if (desk) PSCALE.value = innerHeight / (2 * Math.tan(camera.fov * PI / 360));
	});
	renderer.setAnimationLoop(loop);
	const mus = document.getElementById('music');
	mus.addEventListener('change', () => { musicOn = mus.checked; if (mgain) mgain.gain.value = musicOn ? 0.22 : 0; });
	document.getElementById('desk').addEventListener('click', startDesk);
	const vr = document.getElementById('vr');
	if (!navigator.xr) { vr.disabled = true; msg.textContent = 'No VR here. Open this page in the Meta Quest browser.'; return; }
	navigator.xr.isSessionSupported('immersive-vr').then(ok => {
		if (!ok) { vr.disabled = true; msg.textContent = 'No VR here. Open this page in the Meta Quest browser.'; }
	});
	vr.addEventListener('click', async () => {
		audioStart();
		try {
			const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
			desk = null;
			camera.rotation.set(0, 0, 0);
			rig.rotation.y = 0;
			PSCALE.value = 900;
			await renderer.xr.setSession(s);
			ui.style.display = 'none';
			s.addEventListener('end', () => { ui.style.display = 'flex'; });
		} catch (e) { msg.textContent = 'Could not start VR: ' + e.message; }
	});
	window.__snow = { scene, renderer, camera, rig, solids, targets };
}
init();
})();
