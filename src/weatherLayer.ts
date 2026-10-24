// MapLibre custom layer that draws the colour overlay and the wind particles.
//
// Weather grids are equirectangular textures. Every pass works in screen
// space: a fragment's screen position is turned into Web Mercator, then
// lon/lat, then a texture coordinate. Particles live in a float texture
// of screen positions and are advected by the wind each frame (ping-pong),
// drawn as line segments into a trail texture that fades over time.

import maplibregl, { type CustomLayerInterface, type Map as MlMap } from "maplibre-gl";
import type { Field, FieldStore } from "./data";
import { rampOf, rampPixels, type Overlay, type Stop, type Theme } from "./layers";

const COMMON = /* glsl */ `#version 300 es
precision highp float;
const float PI = 3.141592653589793;
uniform vec2 u_mercCenter;
uniform vec2 u_mercSize;
uniform vec2 u_grid;

// p in 0..1 with origin bottom-left -> (lon, lat, mercator y)
vec3 screenToLonLat(vec2 p) {
  vec2 m = u_mercCenter + (vec2(p.x, 1.0 - p.y) - 0.5) * u_mercSize;
  return vec3(m.x * 360.0 - 180.0, degrees(atan(sinh(PI * (1.0 - 2.0 * m.y)))), m.y);
}

// Texel centres sit on the grid points (lon -180 + i/2, lat 90 - j/2).
vec2 lonLatToTex(vec2 ll) {
  return vec2((ll.x + 180.0) / 360.0 + 0.5 / u_grid.x,
              ((90.0 - ll.y) / 180.0 * (u_grid.y - 1.0) + 0.5) / u_grid.y);
}
`;

const QUAD_VS = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos; gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0); }
`;

const OVERLAY_FS = COMMON + /* glsl */ `
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform sampler2D u_ramp;
uniform float u_mix;
uniform vec2 u_range;      // decode range of the texture
uniform vec2 u_rampRange;  // physical range covered by the ramp
uniform bool u_sqrt;
uniform bool u_bits16;
uniform bool u_vector;
uniform float u_iso;
uniform float u_opacity;
uniform float u_lighten;

// Texel -> (u, v) for vector layers, (value, 0) for scalars.
vec2 decode(vec4 t) {
  if (u_vector) return mix(vec2(u_range.x), vec2(u_range.y), t.rg);
  float x = u_bits16 ? (t.r * 65280.0 + t.g * 255.0) / 65535.0 : t.r;
  if (u_sqrt) x *= x;
  return vec2(mix(u_range.x, u_range.y, x), 0.0);
}

// Manual bilinear filter on decoded values: hardware filtering of 8-bit
// textures is quantised, and 16-bit values must be decoded before mixing.
float valueAt(sampler2D s, vec2 tc) {
  ivec2 n = ivec2(u_grid);
  vec2 p = tc * u_grid - 0.5;
  vec2 f = fract(p);
  ivec2 i = ivec2(floor(p));
  // GLSL leaves % of negative ints undefined, so wrap with mod() on floats.
  int x0 = int(mod(floor(p.x), u_grid.x)), x1 = (x0 + 1) % n.x;
  int y0 = clamp(i.y, 0, n.y - 1), y1 = clamp(i.y + 1, 0, n.y - 1);
  vec2 v = mix(mix(decode(texelFetch(s, ivec2(x0, y0), 0)), decode(texelFetch(s, ivec2(x1, y0), 0)), f.x),
               mix(decode(texelFetch(s, ivec2(x0, y1), 0)), decode(texelFetch(s, ivec2(x1, y1), 0)), f.x), f.y);
  return u_vector ? length(v) : v.x;
}

void main() {
  vec3 ll = screenToLonLat(v_uv);
  if (ll.z < 0.0 || ll.z > 1.0) discard;
  vec2 tc = lonLatToTex(ll.xy);
  float v = mix(valueAt(u_a, tc), valueAt(u_b, tc), u_mix);
  vec4 c = texture(u_ramp, vec2((v - u_rampRange.x) / (u_rampRange.y - u_rampRange.x), 0.5));
  if (u_iso > 0.0) {
    float k = v / u_iso;
    float d = abs(fract(k - 0.5) - 0.5) / max(fwidth(k), 1e-5);
    c = mix(c, vec4(1.0, 1.0, 1.0, c.a), (1.0 - smoothstep(0.8, 1.8, d)) * 0.9);
  }
  c.rgb = mix(c.rgb, vec3(1.0), u_lighten);
  c.rgb *= c.a;
  o = c * u_opacity;
}
`;

const UPDATE_FS = COMMON + /* glsl */ `
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_particles;
uniform sampler2D u_windA;
uniform sampler2D u_windB;
uniform float u_mix;
uniform vec2 u_range;
uniform vec2 u_step;     // particle displacement per (m/s) per frame, in 0..1 screen units
uniform float u_seed;
uniform float u_drop;
uniform float u_dropBump;

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 p = texture(u_particles, v_uv).xy;
  vec3 ll = screenToLonLat(p);
  vec2 tc = lonLatToTex(ll.xy);
  vec2 w = mix(vec2(u_range.x), vec2(u_range.y), mix(texture(u_windA, tc).rg, texture(u_windB, tc).rg, u_mix));
  vec2 np = p + w * u_step;

  vec2 seed = (p + v_uv) * u_seed;
  float drop = step(1.0 - u_drop - length(w) / 40.0 * u_dropBump, rand(seed));
  if (np.x < 0.0 || np.x > 1.0 || np.y < 0.0 || np.y > 1.0 || ll.z < 0.0 || ll.z > 1.0) drop = 1.0;
  vec2 rp = vec2(rand(seed + 1.3), rand(seed + 2.1));
  o = vec4(mix(np, rp, drop), 0.0, 1.0);
}
`;

const DRAW_VS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_prev;
uniform sampler2D u_curr;
uniform int u_texW;
uniform vec2 u_size;  // trail texture size in px
out float v_alpha;
void main() {
  int id = gl_VertexID / 2;
  ivec2 c = ivec2(id % u_texW, id / u_texW);
  vec2 a = texelFetch(u_prev, c, 0).xy;
  vec2 b = texelFetch(u_curr, c, 0).xy;
  // A long jump means the particle was respawned: don't draw that segment.
  // Slow particles overlap themselves, so fade them to avoid bright smears.
  float px = length((b - a) * u_size);
  v_alpha = distance(a, b) < 0.02 ? clamp(px, 0.08, 1.0) : 0.0;
  gl_Position = vec4((gl_VertexID % 2 == 0 ? a : b) * 2.0 - 1.0, 0.0, 1.0);
}
`;

const DRAW_FS = /* glsl */ `#version 300 es
precision mediump float;
in float v_alpha;
out vec4 o;
uniform float u_opacity;
uniform vec3 u_color;
void main() { o = vec4(u_color, 1.0) * v_alpha * u_opacity; }
`;

const FADE_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_screen;
uniform float u_fade;
// floor() so faint pixels keep decreasing instead of sticking at 1/255.
void main() { o = floor(255.0 * texture(u_screen, v_uv) * u_fade) / 255.0; }
`;

const COPY_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_screen;
void main() { o = texture(u_screen, v_uv); }
`;

type Gl = WebGL2RenderingContext;

interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation>;
}

function compile(gl: Gl, vs: string, fs: string): Program {
  const prog = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
    gl.attachShader(prog, s);
  }
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link error");
  const u: Record<string, WebGLUniformLocation> = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(prog, i)!.name;
    u[name] = gl.getUniformLocation(prog, name)!;
  }
  return { prog, u };
}

function texture(gl: Gl, w: number, h: number, opts: { float?: boolean; data?: ArrayBufferView | null; filter?: number }) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  const f = opts.filter ?? gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (opts.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, opts.data ?? null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, opts.data ?? null);
  return t;
}

export class WeatherLayer implements CustomLayerInterface {
  readonly id = "weather";
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;

  overlay: Overlay;
  /** fractional index into manifest.steps */
  time = 0;
  particles = true;
  theme: Theme = "dark";

  private map!: MlMap;
  private gl!: Gl;
  private ready = false;
  private moving = false;
  private progs!: Record<"overlay" | "update" | "draw" | "fade" | "copy", Program>;
  private quadVao!: WebGLVertexArrayObject;
  private emptyVao!: WebGLVertexArrayObject;
  private fieldTex = new Map<string, WebGLTexture>();
  private rampTex!: WebGLTexture;
  private rampFor?: Stop[];
  private particleTex: WebGLTexture[] = [];
  private particleRes = 0;
  private trailTex: WebGLTexture[] = [];
  private trailSize = [0, 0];
  private fbo!: WebGLFramebuffer;
  private needsReset = true;
  private lastFrame = 0;

  constructor(private store: FieldStore, overlay: Overlay) {
    this.overlay = overlay;
  }

  onAdd(map: MlMap) {
    // Re-added after every setStyle(); listeners and the GL resources survive.
    if (this.map) return;
    this.map = map;
    map.on("movestart", () => { this.moving = true; });
    map.on("moveend", () => { this.moving = false; this.needsReset = true; });
    map.on("resize", () => { this.needsReset = true; });
    const tick = () => {
      if (this.particles && !this.moving) map.triggerRepaint();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** All GL work happens inside prerender/render, where MapLibre resets its state cache afterwards. */
  private init(gl: Gl) {
    this.gl = gl;
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("WebGL2 float render targets are not supported");
    this.progs = {
      overlay: compile(gl, QUAD_VS, OVERLAY_FS),
      update: compile(gl, QUAD_VS, UPDATE_FS),
      draw: compile(gl, DRAW_VS, DRAW_FS),
      fade: compile(gl, QUAD_VS, FADE_FS),
      copy: compile(gl, QUAD_VS, COPY_FS),
    };
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.emptyVao = gl.createVertexArray()!;
    gl.bindVertexArray(null);
    this.fbo = gl.createFramebuffer()!;
    this.rampTex = texture(gl, 256, 1, { filter: gl.LINEAR });
    this.ready = true;
  }

  private fieldTexture(f: Field): WebGLTexture {
    let t = this.fieldTex.get(f.key);
    if (!t) {
      const gl = this.gl;
      t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, f.bitmap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.fieldTex.set(f.key, t);
    }
    return t;
  }

  /** Two bracketing fields for the current time (falls back to whichever is loaded). */
  private pair(layer: string): [Field, Field, number] | null {
    const n = this.store.manifest.steps.length;
    const i0 = Math.min(n - 1, Math.floor(this.time)), i1 = Math.min(n - 1, i0 + 1);
    const a = this.store.peek(i0, layer), b = this.store.peek(i1, layer);
    if (!a && !b) {
      this.store.get(i0, layer).catch(() => {});
      return null;
    }
    return [a ?? b!, b ?? a!, a && b ? this.time - i0 : 0];
  }

  /** Free GPU textures for steps far from the current time. */
  private evict() {
    const keep = new Set<string>();
    const i = Math.floor(this.time);
    for (const l of new Set([this.overlay.data, "wind"]))
      for (let s = i - 1; s <= i + 2; s++) keep.add(`${s}/${l}`);
    for (const [k, t] of this.fieldTex) if (!keep.has(k)) { this.gl.deleteTexture(t); this.fieldTex.delete(k); }
  }

  private setView(p: Program) {
    const gl = this.gl, map = this.map;
    const c = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter());
    const world = 512 * Math.pow(2, map.getZoom());
    const canvas = map.getCanvas();
    gl.uniform2f(p.u.u_mercCenter, c.x, c.y);
    gl.uniform2f(p.u.u_mercSize, canvas.clientWidth / world, canvas.clientHeight / world);
    gl.uniform2f(p.u.u_grid, this.store.manifest.width, this.store.manifest.height);
  }

  private bindTex(p: Program, name: string, unit: number, t: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(p.u[name], unit);
  }

  private resetParticles() {
    const gl = this.gl, canvas = this.map.getCanvas();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    // Roughly one particle per 70 CSS px², capped.
    const res = Math.min(256, Math.max(32, Math.ceil(Math.sqrt((w * h) / 70))));
    const data = new Float32Array(res * res * 4);
    for (let i = 0; i < data.length; i++) data[i] = Math.random();
    for (const t of this.particleTex) gl.deleteTexture(t);
    this.particleTex = [0, 1].map(() => texture(gl, res, res, { float: true, data }));
    this.particleRes = res;
    if (this.trailSize[0] !== w || this.trailSize[1] !== h) {
      for (const t of this.trailTex) gl.deleteTexture(t);
      this.trailTex = [0, 1].map(() => texture(gl, w, h, {}));
      this.trailSize = [w, h];
    }
    for (const t of this.trailTex) this.clearTex(t);
    this.needsReset = false;
  }

  private clearTex(t: WebGLTexture) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private target(t: WebGLTexture, w: number, h: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.viewport(0, 0, w, h);
  }

  prerender(glCtx: WebGLRenderingContext | WebGL2RenderingContext) {
    const gl = glCtx as Gl;
    if (!this.ready) this.init(gl);
    this.evict();
    if (!this.particles) return;
    const wind = this.pair("wind");
    if (!wind) return;
    if (this.needsReset) this.resetParticles();
    if (this.moving) return;
    // Advection and fading are tuned for 60 fps; scale by real frame time.
    const now = performance.now();
    const frames = this.lastFrame ? Math.min(3, (now - this.lastFrame) / (1000 / 60)) : 1;
    this.lastFrame = now;

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.quadVao);

    // 1. advect particles: particleTex[0] -> particleTex[1]
    const res = this.particleRes;
    const [w, h] = this.trailSize;
    const up = this.progs.update;
    gl.useProgram(up.prog);
    this.setView(up);
    this.bindTex(up, "u_particles", 0, this.particleTex[0]);
    this.bindTex(up, "u_windA", 1, this.fieldTexture(wind[0]));
    this.bindTex(up, "u_windB", 2, this.fieldTexture(wind[1]));
    const spec = this.store.manifest.layers.wind;
    gl.uniform1f(up.u.u_mix, wind[2]);
    gl.uniform2f(up.u.u_range, spec.min, spec.max);
    const pxPerMs = 0.12; // CSS px per frame for 1 m/s
    gl.uniform2f(up.u.u_step, (pxPerMs * frames) / w, (pxPerMs * frames) / h);
    gl.uniform1f(up.u.u_seed, Math.random() + 1);
    gl.uniform1f(up.u.u_drop, 0.004);
    gl.uniform1f(up.u.u_dropBump, 0.01);
    this.target(this.particleTex[1], res, res);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 2. fade previous trails into trailTex[1]
    const fade = this.progs.fade;
    gl.useProgram(fade.prog);
    this.bindTex(fade, "u_screen", 0, this.trailTex[0]);
    gl.uniform1f(fade.u.u_fade, Math.pow(0.95, frames));
    this.target(this.trailTex[1], w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 3. draw this frame's segments on top
    const draw = this.progs.draw;
    gl.useProgram(draw.prog);
    gl.bindVertexArray(this.emptyVao);
    this.bindTex(draw, "u_prev", 0, this.particleTex[0]);
    this.bindTex(draw, "u_curr", 1, this.particleTex[1]);
    gl.uniform1i(draw.u.u_texW, res);
    gl.uniform2f(draw.u.u_size, w, h);
    // Particles are the point of the wind layers; elsewhere they shouldn't drown the overlay.
    gl.uniform1f(draw.u.u_opacity, this.overlay.quantity === "speed" ? 0.75 : 0.4);
    // White trails vanish on the light basemap wherever the overlay is transparent.
    if (this.theme === "light") gl.uniform3f(draw.u.u_color, 0.1, 0.12, 0.16);
    else gl.uniform3f(draw.u.u_color, 1, 1, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.LINES, 0, res * res * 2);

    this.particleTex.reverse();
    this.trailTex.reverse();
    this.cleanup();
  }

  render(glCtx: WebGLRenderingContext | WebGL2RenderingContext) {
    const gl = glCtx as Gl;
    if (!this.ready) return;
    const ov = this.overlay;
    const field = this.pair(ov.data);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindVertexArray(this.quadVao);

    if (field) {
      const ramp = rampOf(ov, this.theme);
      if (this.rampFor !== ramp) {
        gl.bindTexture(gl.TEXTURE_2D, this.rampTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, rampPixels(ramp));
        this.rampFor = ramp;
      }
      const p = this.progs.overlay;
      const spec = this.store.manifest.layers[ov.data];
      gl.useProgram(p.prog);
      this.setView(p);
      this.bindTex(p, "u_a", 0, this.fieldTexture(field[0]));
      this.bindTex(p, "u_b", 1, this.fieldTexture(field[1]));
      this.bindTex(p, "u_ramp", 2, this.rampTex);
      gl.uniform1f(p.u.u_mix, field[2]);
      gl.uniform2f(p.u.u_range, spec.min, spec.max);
      gl.uniform2f(p.u.u_rampRange, ramp[0][0], ramp[ramp.length - 1][0]);
      gl.uniform1i(p.u.u_sqrt, spec.sqrt ? 1 : 0);
      gl.uniform1i(p.u.u_bits16, spec.bits === 16 ? 1 : 0);
      gl.uniform1i(p.u.u_vector, ov.vector ? 1 : 0);
      gl.uniform1f(p.u.u_iso, ov.isolines ?? 0);
      gl.uniform1f(p.u.u_opacity, 1);
      gl.uniform1f(p.u.u_lighten, this.theme === "light" ? 0.05 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    if (this.particles && !this.moving && this.trailTex.length) {
      const p = this.progs.copy;
      gl.useProgram(p.prog);
      this.bindTex(p, "u_screen", 0, this.trailTex[0]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    this.cleanup();
  }

  private cleanup() {
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (let i = 2; i >= 0; i--) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }
}
