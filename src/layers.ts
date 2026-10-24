// Overlay definitions: which data texture each overlay reads, its colour ramp
// (stops in physical units, RGBA 0-255) and how values are shown to people.

export type Stop = [number, [number, number, number, number]];

export interface Overlay {
  id: string;
  label: string;
  /** name of the PNG in each step directory */
  data: string;
  /** u/v packed in R/G (shown as speed) vs. a single scalar in R */
  vector: boolean;
  ramp: Stop[];
  /** replacement ramp on the light basemap, where white-ish colours vanish */
  rampLight?: Stop[];
  /** spacing of contour lines in physical units, if any */
  isolines?: number;
  quantity: Quantity;
}

export type Theme = "dark" | "light";

export type Quantity = "speed" | "temp" | "percent" | "pressure" | "rain" | "cape";

const A = 255;

const windRamp: Stop[] = [
  [0, [98, 113, 183, A]],
  [2, [57, 97, 159, A]],
  [4, [74, 148, 169, A]],
  [6, [77, 141, 123, A]],
  [8, [83, 165, 83, A]],
  [11, [53, 159, 53, A]],
  [14, [167, 157, 81, A]],
  [17, [159, 127, 58, A]],
  [20, [161, 108, 92, A]],
  [25, [129, 58, 78, A]],
  [30, [175, 80, 136, A]],
  [40, [117, 74, 147, A]],
  [50, [190, 190, 220, A]],
];

export const OVERLAYS: Overlay[] = [
  { id: "wind", label: "Wind", data: "wind", vector: true, ramp: windRamp, quantity: "speed" },
  { id: "gust", label: "Wind gusts", data: "gust", vector: false, ramp: windRamp, quantity: "speed" },
  {
    id: "temp", label: "Temperature", data: "temp", vector: false, quantity: "temp",
    ramp: [
      [-50, [115, 70, 105, A]],
      [-30, [170, 135, 210, A]],
      [-20, [90, 90, 190, A]],
      [-10, [65, 140, 200, A]],
      [0, [120, 200, 220, A]],
      [5, [80, 175, 140, A]],
      [10, [90, 170, 70, A]],
      [18, [200, 200, 70, A]],
      [24, [225, 170, 60, A]],
      [30, [210, 100, 55, A]],
      [36, [175, 50, 55, A]],
      [42, [125, 25, 60, A]],
      [50, [80, 10, 40, A]],
    ],
  },
  {
    id: "rain", label: "Rain", data: "rain", vector: false, quantity: "rain",
    ramp: [
      [0, [40, 50, 70, 0]],
      [0.1, [60, 90, 150, 90]],
      [0.5, [70, 130, 200, 200]],
      [1.5, [60, 170, 170, 230]],
      [3, [80, 190, 80, A]],
      [6, [220, 210, 60, A]],
      [10, [230, 140, 50, A]],
      [20, [210, 50, 60, A]],
      [30, [190, 60, 190, A]],
    ],
  },
  {
    id: "clouds", label: "Clouds", data: "clouds", vector: false, quantity: "percent",
    ramp: [
      [0, [30, 45, 75, 0]],
      [10, [60, 70, 95, 60]],
      [50, [140, 145, 160, 170]],
      [90, [215, 215, 220, 225]],
      [100, [240, 240, 245, 240]],
    ],
    rampLight: [
      [0, [90, 100, 120, 0]],
      [10, [90, 100, 120, 40]],
      [50, [80, 90, 110, 130]],
      [90, [60, 68, 85, 200]],
      [100, [50, 56, 72, 220]],
    ],
  },
  {
    id: "pressure", label: "Pressure", data: "pressure", vector: false, quantity: "pressure", isolines: 4,
    ramp: [
      [960, [120, 50, 120, A]],
      [985, [70, 80, 170, A]],
      [1000, [70, 140, 190, A]],
      [1010, [80, 160, 120, A]],
      [1018, [170, 175, 90, A]],
      [1030, [200, 120, 70, A]],
      [1045, [160, 60, 60, A]],
    ],
  },
  {
    id: "rh", label: "Humidity", data: "rh", vector: false, quantity: "percent",
    ramp: [
      [0, [160, 100, 50, A]],
      [30, [190, 160, 90, A]],
      [50, [120, 160, 100, A]],
      [70, [60, 140, 150, A]],
      [90, [50, 90, 170, A]],
      [100, [40, 60, 140, A]],
    ],
  },
  {
    id: "cape", label: "Thunder (CAPE)", data: "cape", vector: false, quantity: "cape",
    ramp: [
      [0, [40, 50, 70, 0]],
      [200, [70, 110, 150, 120]],
      [800, [80, 170, 90, 220]],
      [1500, [220, 210, 60, A]],
      [2500, [230, 120, 50, A]],
      [4000, [200, 40, 60, A]],
      [5000, [190, 60, 190, A]],
    ],
  },
];

export function rampOf(o: Overlay, theme: Theme): Stop[] {
  return theme === "light" && o.rampLight ? o.rampLight : o.ramp;
}

/** 256x1 RGBA ramp spanning the first..last stop. */
export function rampPixels(ramp: Stop[]): Uint8Array {
  const out = new Uint8Array(256 * 4);
  const lo = ramp[0][0], hi = ramp[ramp.length - 1][0];
  for (let i = 0; i < 256; i++) {
    const v = lo + ((hi - lo) * i) / 255;
    let j = 0;
    while (j < ramp.length - 2 && v > ramp[j + 1][0]) j++;
    const [v0, c0] = ramp[j], [v1, c1] = ramp[j + 1];
    const t = Math.min(1, Math.max(0, (v - v0) / (v1 - v0)));
    for (let k = 0; k < 4; k++) out[i * 4 + k] = Math.round(c0[k] + (c1[k] - c0[k]) * t);
  }
  return out;
}

export function rampCss(ramp: Stop[]): string {
  const lo = ramp[0][0], hi = ramp[ramp.length - 1][0];
  const stops = ramp.map(([v, [r, g, b, a]]) => `rgba(${r},${g},${b},${Math.max(a, 120) / 255}) ${((v - lo) / (hi - lo)) * 100}%`);
  return `linear-gradient(to right, ${stops.join(",")})`;
}

export function rampColor(ramp: Stop[], v: number): string {
  const px = rampPixels(ramp);
  const lo = ramp[0][0], hi = ramp[ramp.length - 1][0];
  const i = Math.round(Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * 255) * 4;
  // Mostly transparent ramp ends (no rain, clear sky) would read as black text.
  if (px[i + 3] < 100) return "#e8eaee";
  return `rgb(${px[i]},${px[i + 1]},${px[i + 2]})`;
}

// ---- units ----

export const units = {
  speed: "km/h" as "m/s" | "km/h" | "kt" | "bft",
  temp: "°C" as "°C" | "°F",
};

const SPEED_UNITS = ["km/h", "m/s", "kt", "bft"] as const;
const BEAUFORT = [0.5, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];

export function cycleUnit(q: Quantity) {
  if (q === "speed") units.speed = SPEED_UNITS[(SPEED_UNITS.indexOf(units.speed) + 1) % SPEED_UNITS.length];
  if (q === "temp") units.temp = units.temp === "°C" ? "°F" : "°C";
}

export function unitLabel(q: Quantity): string {
  return { speed: units.speed, temp: units.temp, percent: "%", pressure: "hPa", rain: "mm/h", cape: "J/kg" }[q];
}

/** Convert a value in ingest units (m/s, °C, ...) to the display unit, as a number. */
export function convert(q: Quantity, v: number): number {
  if (q === "speed") {
    if (units.speed === "km/h") return v * 3.6;
    if (units.speed === "kt") return v * 1.94384;
    if (units.speed === "bft") return BEAUFORT.findIndex((b) => v < b) === -1 ? 12 : BEAUFORT.findIndex((b) => v < b);
  }
  if (q === "temp" && units.temp === "°F") return v * 1.8 + 32;
  return v;
}

export function format(q: Quantity, v: number): string {
  const c = convert(q, v);
  if (q === "rain") return c < 0.05 ? "0" : c < 10 ? c.toFixed(1) : c.toFixed(0);
  return Math.round(c).toString();
}
