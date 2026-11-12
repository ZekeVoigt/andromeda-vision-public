// core.js -- the renderer. Real triangle meshes every frame (pass A, into 4 RGBA8 targets + depth), then a
// screen-space halftone with crisp outlines (pass B), then notes as sharp text on top, depth-tested.
// Every pixel a surface covers is drawn every frame: no sampled points, so no holes at any angle or zoom.
function makeCore(THREE, canvas) {
  THREE.ColorManagement.enabled = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.autoClear = false; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr());
  const TW = 1024; // table width, in texels

  // ---------- pass A ----------
  const VS_A = `
precision highp float; precision highp int;
in vec3 position; in vec3 normal; in vec4 color; in float part; in float along; in vec3 center; in float sub;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform highp sampler2D uTable; uniform float uTime, uMinPx, uViewH, uScatter, uStrokePx;
out vec3 vN; out vec3 vW; out vec4 vCol; out float vAlong; out float vStroke;
flat out vec4 vT1; flat out vec4 vT2; flat out vec4 vT3; flat out float vPart; flat out float vPresence; flat out float vAsm;
vec4 T(int i, int k) { int x = i * 4 + k; return texelFetch(uTable, ivec2(x % ${TW}, x / ${TW}), 0); }
vec3 hash3(float n) { return fract(sin(vec3(n * 12.9898, n * 78.233, n * 37.719)) * 43758.5453) * 2. - 1.; }
void main() {
  int i = int(part + .5);
  vec4 t0 = T(i, 0), t1 = T(i, 1), t2 = T(i, 2), t3 = T(i, 3);
  vec3 c = center + t0.xyz, p = c + (position - center) * t1.w;
  // a part assembles: it flies in from a scattered spot and grows, while its dots fill in (pass A's fragment)
  float a = clamp((uTime - t3.y) / 1.1, 0., 1.), e = 1. - pow(1. - a, 3.);
  vec3 sc = hash3(part + 1.) * uScatter;
  p = c + (p - c) * (0.55 + 0.45 * e) + sc * (1. - e);
  c = c + sc * (1. - e);
  vec4 wc = modelMatrix * vec4(c, 1.);
  vec4 w = modelMatrix * vec4(p, 1.);
  // a path never thins below a stroke: push its surface out from its axis to uMinPx on screen
  vStroke = 0.;
  float rw = length(w.xyz - wc.xyz);
  if (rw > 1e-7 && length(position - center) > 1e-7) {
    vec4 cc = projectionMatrix * viewMatrix * wc;
    float px = rw * projectionMatrix[1][1] * uViewH * .5 / max(cc.w, 1e-4);
    if (px < uMinPx) { w.xyz = wc.xyz + (w.xyz - wc.xyz) * (uMinPx / px); }
    if (px < uStrokePx) vStroke = 1.;
  }
  vW = w.xyz; vN = mat3(modelMatrix) * normal; vCol = color; vAlong = along;
  vT1 = t1; vT2 = t2; vT3 = t3; vPart = part; vPresence = t0.w; vAsm = a;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
  const FS_A = `
precision highp float; precision highp int;
in vec3 vN; in vec3 vW; in vec4 vCol; in float vAlong; in float vStroke;
flat in vec4 vT1; flat in vec4 vT2; flat in vec4 vT3; flat in float vPart; flat in float vPresence; flat in float vAsm;
uniform vec3 uKey, uCam; uniform float uPitch, uTime, uVisual, uStrokeK;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2; layout(location = 3) out vec4 o3;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 oct(vec3 n) { n /= abs(n.x) + abs(n.y) + abs(n.z); vec2 r = n.z >= 0. ? n.xy : (1. - abs(n.yx)) * vec2(n.x >= 0. ? 1. : -1., n.y >= 0. ? 1. : -1.); return r * .5 + .5; }
float anim(vec4 an, float along, float t) {
  if (an.x < .5) return 0.;
  float q = (t - an.z) / max(an.y, .05), f = 0.;
  if (q < 0.) return 0.;
  if (an.x < 1.5) f = .5 - .5 * cos(6.2831853 * q);
  else if (an.x < 2.5) { float r = fract(q); f = r < .3 ? sin(3.14159265 * r / .3) : 0.; }
  else { float r = fract(q - (an.w < 0. ? 1. - along : along)); f = r < .22 ? sin(3.14159265 * r / .22) : 0.; }
  return f * abs(an.w);
}
void main() {
  // presence (hide/show, a zoom level opening) and assembly both fill in dot cell by dot cell
  float h = h21(floor(gl_FragCoord.xy / uPitch) + vPart * .137);
  if (h > min(vPresence, vAsm * 1.02) || vPresence <= 0.) discard;
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(uCam - vW);
  float lit = .1 + .62 * max(dot(n, uKey), 0.) + .3 * max(dot(n, v), 0.);
  float glow = clamp(vT1.y + anim(vT2, vAlong, uTime), 0., 1.);
  int flags = int(vT1.z + .5);
  float edge = vT3.x;
  o0 = vec4(vCol.a > .5 ? vCol.rgb : vec3(1.), vCol.a > .5 ? 1. : .6);
  o1 = vec4(uVisual / 255., floor(vPart / 256.) / 255., mod(vPart, 256.) / 255., mod(edge, 256.) / 255.);
  o2 = vec4(oct(n), clamp(lit, 0., 1.), float(flags) / 255.);
  o3 = vec4(clamp(vT1.x / 3. + .5, 0., 1.), glow, vStroke * max(uStrokeK, glow), floor(edge / 256.) / 255.);
}`;

  // ---------- pass B: halftone + outlines ----------
  const VS_B = `in vec3 position; out vec2 vUv; void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`;
  const FS_B = `
precision highp float; precision highp int;
uniform highp sampler2D t0, t1, t2, t3; uniform highp sampler2D tD;
uniform float uPitch, uLine, uDark, uNear, uFar, uTime; uniform vec3 uInk, uBg, uAcc;
out vec4 o;
float lin(float d) { float z = d * 2. - 1.; return 2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
float idOf(vec4 a1) { return a1.r * 255. * 65536. + a1.g * 255. * 256. + a1.b * 255.; }
float edgeOf(vec4 a1, vec4 a3) { return a1.r * 255. * 65536. + (a3.a * 255. * 256. + a1.a * 255.); }
vec3 dec(vec2 e) { e = e * 2. - 1.; vec3 n = vec3(e, 1. - abs(e.x) - abs(e.y)); float t = max(-n.z, 0.); n.xy += vec2(n.x >= 0. ? -t : t, n.y >= 0. ? -t : t); return normalize(n); }
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy), sz = textureSize(t0, 0);
  vec4 a0 = texelFetch(t0, px, 0);
  float d = texelFetch(tD, px, 0).r;
  gl_FragDepth = d;
  if (a0.a <= 0.) { o = vec4(uBg, 1.); return; }
  vec4 a1 = texelFetch(t1, px, 0), a2 = texelFetch(t2, px, 0), a3 = texelFetch(t3, px, 0);
  float myId = idOf(a1), myEdge = edgeOf(a1, a3), zl = lin(d);
  vec3 myN = dec(a2.xy);
  int flags = int(a2.a * 255. + .5);
  bool hi = (flags & 1) != 0, dim = (flags & 2) != 0, quiet = (flags & 4) != 0, sel = (flags & 8) != 0, hov = (flags & 16) != 0, faint = (flags & 32) != 0;
  // outlines: where the part, the depth or (softer) the surface's direction changes; drawn on both sides
  float edge = 0., crease = 0.;
  int L = int(uLine + .5);
  for (int k = 0; k < 8; k++) {
    ivec2 off = k == 0 ? ivec2(L, 0) : k == 1 ? ivec2(-L, 0) : k == 2 ? ivec2(0, L) : k == 3 ? ivec2(0, -L)
              : k == 4 ? ivec2(L, L) : k == 5 ? ivec2(-L, L) : k == 6 ? ivec2(L, -L) : ivec2(-L, -L);
    ivec2 q = clamp(px + off, ivec2(0), sz - 1);
    vec4 b0 = texelFetch(t0, q, 0);
    if (b0.a <= 0.) { edge = 1.; continue; }
    vec4 b1 = texelFetch(t1, q, 0), b3 = texelFetch(t3, q, 0);
    float zq = lin(texelFetch(tD, q, 0).r);
    if (abs(edgeOf(b1, b3) - myEdge) > .5) { if (zl <= zq + zl * .004) edge = 1.; else edge = max(edge, .55); }
    else if (zq - zl > zl * .035 * float(L)) edge = 1.;
    else if (k < 4 && dot(myN, dec(texelFetch(t2, q, 0).xy)) < .55) crease = 1.;
  }
  // halftone: one round dot per screen cell, its size how much ink the surface carries there
  vec2 cell = floor(gl_FragCoord.xy / uPitch), cc = (cell + .5) * uPitch;
  ivec2 cp = clamp(ivec2(cc), ivec2(0), sz - 1);
  vec4 c0 = texelFetch(t0, cp, 0), c1 = texelFetch(t1, cp, 0), c2 = texelFetch(t2, cp, 0), c3 = texelFetch(t3, cp, 0);
  if (c0.a <= 0. || abs(idOf(c1) - myId) > .5) { c0 = a0; c1 = a1; c2 = a2; c3 = a3; } // a cell split between parts: each its own
  float lit = c2.z, band = floor(lit * 4. + .35) / 4.;
  float tone = (c3.r - .5) * 3.;
  float m = uDark > .5 ? .18 + .8 * band : .9 - .8 * band;
  bool colored = c0.a > .8;
  float lum = dot(c0.rgb, vec3(.3, .59, .11));
  if (colored) m *= uDark > .5 ? .55 + .7 * lum : 1.35 - .75 * lum;
  m = clamp(m + tone * .22, .04, 1.);
  float glow = c3.g;
  vec3 inkC = colored ? mix(uInk, clamp(c0.rgb * (uDark > .5 ? 1.25 : .8), 0., 1.), .72) : uInk;
  if (hi) inkC = uAcc;
  inkC = mix(inkC, uAcc, glow);
  m = clamp(m + glow * .25, 0., 1.);
  float fade = faint ? .2 : dim ? .3 : quiet ? .45 : 1.;
  float r = sqrt(m) * uPitch * .64, dd = length(gl_FragCoord.xy - cc);
  float dotA = clamp(r - dd + .5, 0., 1.);
  vec3 col = mix(uBg, uInk, (uDark > .5 ? .07 : .045) * fade);       // the surface itself, faintly: solid, not empty
  col = mix(col, inkC, dotA * fade);
  float sk = max(c3.b, a3.b); if (sk > .01) col = mix(col, inkC, .95 * sk * fade); // a stroke: crisp at the pixel; a dense bundle reads as a tone
  vec3 lineC = hi ? uAcc : sel ? uAcc : mix(uInk, inkC, .35);
  col = mix(col, lineC, max(edge * (faint ? .2 : dim ? .4 : quiet ? .6 : .95), crease * .35 * fade));
  if (sel || hov) col = mix(col, uAcc, edge * (sel ? 1. : .7));
  o = vec4(col, 1.);
}`;

  const tA = new THREE.WebGLRenderTarget(4, 4, { count: 4, type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  tA.depthTexture = new THREE.DepthTexture(4, 4, THREE.FloatType);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VS_B, fragmentShader: FS_B, depthTest: false, depthWrite: true,
    uniforms: { t0: { value: tA.textures[0] }, t1: { value: tA.textures[1] }, t2: { value: tA.textures[2] }, t3: { value: tA.textures[3] }, tD: { value: tA.depthTexture },
      uPitch: { value: 6 }, uLine: { value: 2 }, uDark: { value: 1 }, uNear: { value: 0.1 }, uFar: { value: 100 }, uTime: { value: 0 },
      uInk: { value: new THREE.Color() }, uBg: { value: new THREE.Color() }, uAcc: { value: new THREE.Color() } } }));
  quad.frustumCulled = false;
  const postScene = new THREE.Scene(); postScene.add(quad);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const scene = new THREE.Scene();   // visuals (pass A)
  const noteScene = new THREE.Scene(); // notes (sharp, after the halftone)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);

  const shared = { uTime: { value: 0 }, uMinPx: { value: 1.2 }, uViewH: { value: 800 }, uPitch: { value: 6 }, uStrokePx: { value: 4 },
    uKey: { value: new THREE.Vector3(-0.45, 0.8, 0.5).normalize() }, uCam: { value: new THREE.Vector3() } };
  function materialFor(table, visualIndex, scatter) {
    return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS_A, fragmentShader: FS_A, side: THREE.DoubleSide,
      uniforms: Object.assign({}, shared, { uTable: { value: table }, uVisual: { value: visualIndex }, uScatter: { value: scatter }, uStrokeK: { value: 1 } }) });
  }
  function makeTable(nParts) {
    const rows = Math.max(1, Math.ceil(nParts * 4 / TW));
    const data = new Float32Array(TW * rows * 4);
    const tex = new THREE.DataTexture(data, TW, rows, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
    return { tex, data };
  }

  let W = 1, H = 1;
  function resize(w, h) {
    W = Math.max(1, w); H = Math.max(1, h);
    renderer.setPixelRatio(dpr()); renderer.setSize(W, H, false);
    const r = dpr(); tA.setSize(Math.round(W * r), Math.round(H * r));
    camera.aspect = W / H; camera.updateProjectionMatrix();
  }
  const theme = { dark: true, ink: new THREE.Color(), bg: new THREE.Color(), acc: new THREE.Color() };
  function setTheme(dark, ink, bg, acc) {
    theme.dark = dark; theme.ink.set(ink); theme.bg.set(bg); theme.acc.set(acc);
  }
  function render(t) {
    const r = dpr(), u = quad.material.uniforms;
    shared.uTime.value = t; shared.uViewH.value = H * r;
    shared.uPitch.value = Math.round(3 * r * 10) / 10; shared.uMinPx.value = 0.75 * r; shared.uStrokePx.value = 1.3 * r;
    shared.uCam.value.copy(camera.position);
    renderer.setRenderTarget(tA); renderer.setClearColor(0x000000, 0); renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.setClearColor(theme.bg, 1); renderer.clear(true, true, true);
    u.uPitch.value = shared.uPitch.value; u.uLine.value = Math.max(1, Math.round(r * 0.75)); u.uDark.value = theme.dark ? 1 : 0;
    u.uNear.value = camera.near; u.uFar.value = camera.far; u.uTime.value = t;
    u.uInk.value.copy(theme.ink); u.uBg.value.copy(theme.bg); u.uAcc.value.copy(theme.acc);
    renderer.render(postScene, postCam);
    renderer.render(noteScene, camera);
  }
  // what is under a screen point: {visual, part} or null (reads one pixel of pass A's id target)
  const px4 = new Uint8Array(4);
  function pick(x, y) {
    const r = dpr(), X = Math.round(x * r), Y = Math.round((H - y) * r);
    if (X < 0 || Y < 0 || X >= tA.width || Y >= tA.height) return null;
    const gl = renderer.getContext(), fb = renderer.properties.get(tA).__webglFramebuffer;
    if (!fb) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(X, Y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px4);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    renderer.state.reset?.();
    const vis = px4[0], part = px4[1] * 256 + px4[2];
    if (!vis) return null;
    return { visual: vis, part };
  }
  // what is actually visible: the id target, blitted down 4x and read back -> per part: pixel count, screen box, top point
  const small = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  let smallBuf = new Uint8Array(16);
  function visibility(scale = 4) {
    const gl = renderer.getContext(), r = dpr(), w = Math.max(1, Math.round(W * r / scale)), h = Math.max(1, Math.round(H * r / scale));
    if (small.width !== w || small.height !== h) { small.setSize(w, h); smallBuf = new Uint8Array(w * h * 4); }
    renderer.setRenderTarget(small); renderer.setRenderTarget(null); // makes sure its framebuffer exists
    const fa = renderer.properties.get(tA).__webglFramebuffer, fs = renderer.properties.get(small).__webglFramebuffer;
    if (!fa || !fs) return null;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fa); gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fs);
    gl.blitFramebuffer(0, 0, tA.width, tA.height, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fs); gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, smallBuf);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    renderer.resetState();
    const map = new Map(), sx = W / w, sy = H / h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4, vis = smallBuf[k]; if (!vis) continue;
      const key = vis * 65536 + smallBuf[k + 1] * 256 + smallBuf[k + 2];
      const X = (x + 0.5) * sx, Y = H - (y + 0.5) * sy;
      let e = map.get(key); if (!e) map.set(key, (e = { n: 0, x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, tx: 0 }));
      e.n++; if (Y < e.y0) { e.y0 = Y; e.tx = X; } e.x0 = Math.min(e.x0, X); e.x1 = Math.max(e.x1, X); e.y1 = Math.max(e.y1, Y);
    }
    return { map, cell: sx * sy, buf: smallBuf, w, h, sx, sy };
  }
  return { visibility, passA: tA, THREE, renderer, scene, noteScene, camera, render, resize, pick, materialFor, makeTable, setTheme, theme, TW, size: () => [W, H] };
}
