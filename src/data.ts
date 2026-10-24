// Loads the manifest and per-step PNG textures written by ingest/gfs.py, and
// samples them on the CPU for the point picker.

export interface LayerSpec {
  min: number;
  max: number;
  unit: string;
  sqrt?: boolean;
  bits?: 16;
}

export interface Manifest {
  model: string;
  source: string;
  run: string;
  width: number;
  height: number;
  steps: { hour: number; time: string; dir: string }[];
  layers: Record<string, LayerSpec>;
}

export interface Field {
  key: string;
  bitmap: ImageBitmap;
  pixels?: Uint8ClampedArray;
}

const BASE = "data";
/** Decoded images kept in memory: two layers x 40 steps, plus a few spares. */
const MAX_FIELDS = 100;

export async function loadManifest(): Promise<Manifest> {
  const r = await fetch(`${BASE}/manifest.json`);
  if (!r.ok) throw new Error("No weather data yet. Run `npm run ingest` first.");
  return r.json();
}

export class FieldStore {
  private fields = new Map<string, Field>();
  private pending = new Map<string, Promise<Field>>();
  onLoad: () => void = () => {};

  constructor(readonly manifest: Manifest) {}

  peek(step: number, layer: string): Field | undefined {
    return this.fields.get(`${step}/${layer}`);
  }

  get(step: number, layer: string): Promise<Field> {
    const key = `${step}/${layer}`;
    const have = this.fields.get(key);
    if (have) {
      // Refresh LRU order.
      this.fields.delete(key);
      this.fields.set(key, have);
      return Promise.resolve(have);
    }
    let p = this.pending.get(key);
    if (!p) {
      const url = `${BASE}/${this.manifest.steps[step].dir}/${layer}.png`;
      p = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
          return r.blob();
        })
        // Data, not imagery: never let the browser colour-manage or premultiply it.
        .then((b) => createImageBitmap(b, { premultiplyAlpha: "none", colorSpaceConversion: "none" }))
        .then((bitmap) => {
          const f = { key, bitmap };
          this.fields.set(key, f);
          this.pending.delete(key);
          for (const [k, old] of this.fields) {
            if (this.fields.size <= MAX_FIELDS) break;
            old.bitmap.close();
            this.fields.delete(k);
          }
          this.onLoad();
          return f;
        })
        .catch((e) => {
          // Forget the failure so the next request retries.
          this.pending.delete(key);
          throw e;
        });
      this.pending.set(key, p);
    }
    return p;
  }

  /** Fetch every step of the given layers, nearest-to-`from` first, a few at a time. */
  async preload(layers: string[], from: number) {
    const order = this.manifest.steps
      .map((_, i) => i)
      .sort((a, b) => Math.abs(a - from) - Math.abs(b - from));
    const jobs = order.flatMap((i) => layers.map((l) => () => this.get(i, l)));
    const worker = async () => {
      for (let job = jobs.shift(); job; job = jobs.shift()) await job().catch(() => {});
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  private pixels(f: Field): Uint8ClampedArray {
    if (!f.pixels) {
      const c = new OffscreenCanvas(f.bitmap.width, f.bitmap.height);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(f.bitmap, 0, 0);
      f.pixels = ctx.getImageData(0, 0, c.width, c.height).data;
    }
    return f.pixels;
  }

  /** Bilinear sample at lon/lat of `texel(r, g)`, applied to each texel's 0..1 channels. */
  private bilinear(f: Field, lon: number, lat: number, texel: (r: number, g: number) => number): number {
    const { width: w, height: h } = this.manifest;
    const px = this.pixels(f);
    const x = ((((lon + 180) / 360) * w) % w + w) % w;
    const y = Math.min(h - 1, Math.max(0, ((90 - lat) / 180) * (h - 1)));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = (x0 + 1) % w, y1 = Math.min(h - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const at = (xx: number, yy: number) => {
      const i = (yy * w + xx) * 4;
      return texel(px[i] / 255, px[i + 1] / 255);
    };
    return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
  }

  decode(layer: string, t: number): number {
    const s = this.manifest.layers[layer];
    return s.min + (s.sqrt ? t * t : t) * (s.max - s.min);
  }

  /** Scalar value, or [u, v] for the wind layer, in ingest units. */
  sample(f: Field, layer: string, lon: number, lat: number): number | [number, number] {
    if (layer === "wind")
      return [this.bilinear(f, lon, lat, (r) => this.decode(layer, r)), this.bilinear(f, lon, lat, (_, g) => this.decode(layer, g))];
    const bits16 = this.manifest.layers[layer].bits === 16;
    return this.bilinear(f, lon, lat, (r, g) => this.decode(layer, bits16 ? (r * 65280 + g * 255) / 65535 : r));
  }
}
