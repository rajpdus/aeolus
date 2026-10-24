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

// Ramps are multi-hue on purpose: weather maps are read as absolute bands
// (breeze vs. gale, drizzle vs. downpour). Colours are saturated so they hold
// up under the particles and on both basemaps.

const windRamp: Stop[] = [
  [0, [36, 48, 140, A]],
  [2, [30, 80, 190, A]],
  [4, [20, 130, 220, A]],
  [6, [0, 170, 200, A]],
  [8, [20, 180, 120, A]],
  [11, [90, 190, 40, A]],
  [14, [220, 200, 20, A]],
  [17, [245, 150, 20, A]],
  [20, [235, 90, 30, A]],
  [25, [210, 30, 60, A]],
  [30, [190, 20, 130, A]],
  [40, [130, 40, 190, A]],
  [50, [230, 210, 255, A]],
];

// 24x24 stroke icons (stroke = currentColor), drawn for this project.
const ICONS = {
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
  gust: '<path d="M3 9h9a3 3 0 1 0-3-3"/><path d="M3 15h12a3 3 0 1 1-3 3"/><path d="M17 4l2-1.5M19 9h2.5M18 12.5l2 1"/>',
  temp: '<path d="M14 14.8V4.5a2 2 0 0 0-4 0v10.3a4 4 0 1 0 4 0z"/><path d="M12 10v6"/>',
  rain: '<path d="M7 15a4 4 0 0 1-.6-7.95A5 5 0 0 1 16 6a4 4 0 0 1 1 7.9"/><path d="M8 18l-1 2.5M12 17l-1.2 3.5M16 18l-1 2.5"/>',
  clouds: '<path d="M7 18a4.5 4.5 0 0 1-.8-8.93A6 6 0 0 1 17.6 8.5 4.75 4.75 0 0 1 17 18z"/>',
  pressure: '<path d="M4.6 18a9 9 0 1 1 14.8 0"/><path d="M12 14l3.5-4.5"/><circle cx="12" cy="14" r="1.2"/>',
  rh: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9.5 14.5A2.5 2.5 0 0 0 12 17"/>',
  cape: '<path d="M13 2 5 13h6l-1 9 8-11h-6z"/>',
};

export function icon(id: keyof typeof ICONS): string {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id]}</svg>`;
}

export const OVERLAYS: Overlay[] = [
  { id: "wind", label: "Wind", data: "wind", vector: true, ramp: windRamp, quantity: "speed" },
  { id: "gust", label: "Wind gusts", data: "gust", vector: false, ramp: windRamp, quantity: "speed" },
  {
    id: "temp", label: "Temperature", data: "temp", vector: false, quantity: "temp",
    ramp: [
      [-50, [60, 0, 90, A]],
      [-35, [110, 40, 180, A]],
      [-20, [60, 80, 220, A]],
      [-10, [40, 140, 240, A]],
      [0, [80, 200, 235, A]],
      [5, [60, 190, 170, A]],
      [10, [70, 190, 90, A]],
      [15, [170, 210, 50, A]],
      [20, [250, 220, 40, A]],
      [25, [250, 165, 30, A]],
      [30, [240, 100, 30, A]],
      [35, [215, 40, 40, A]],
      [40, [160, 10, 60, A]],
      [50, [90, 0, 40, A]],
    ],
  },
  {
    id: "rain", label: "Rain", data: "rain", vector: false, quantity: "rain",
    ramp: [
      [0, [120, 180, 255, 0]],
      [0.1, [120, 180, 255, 110]],
      [0.5, [60, 140, 255, 200]],
      [1.5, [20, 100, 240, 240]],
      [3, [0, 190, 190, A]],
      [6, [40, 210, 70, A]],
      [10, [250, 230, 30, A]],
      [16, [250, 140, 10, A]],
      [25, [235, 30, 30, A]],
      [30, [210, 0, 190, A]],
    ],
  },
  {
    id: "clouds", label: "Clouds", data: "clouds", vector: false, quantity: "percent",
    ramp: [
      [0, [200, 205, 215, 0]],
      [20, [200, 205, 215, 80]],
      [60, [230, 232, 238, 180]],
      [100, [250, 250, 252, 235]],
    ],
    rampLight: [
      [0, [80, 95, 125, 0]],
      [20, [80, 95, 125, 45]],
      [60, [70, 84, 112, 120]],
      [100, [60, 72, 98, 180]],
    ],
  },
  {
    id: "pressure", label: "Pressure", data: "pressure", vector: false, quantity: "pressure", isolines: 4,
    ramp: [
      [960, [100, 20, 150, A]],
      [985, [50, 60, 200, A]],
      [1000, [30, 140, 230, A]],
      [1010, [40, 190, 150, A]],
      [1016, [150, 210, 60, A]],
      [1022, [245, 210, 40, A]],
      [1032, [245, 120, 30, A]],
      [1045, [200, 30, 50, A]],
    ],
  },
  {
    id: "rh", label: "Humidity", data: "rh", vector: false, quantity: "percent",
    ramp: [
      [0, [150, 70, 20, A]],
      [20, [220, 140, 40, A]],
      [40, [240, 210, 90, A]],
      [60, [120, 210, 120, A]],
      [75, [30, 180, 190, A]],
      [90, [30, 110, 230, A]],
      [100, [50, 40, 180, A]],
    ],
  },
  {
    id: "cape", label: "Thunder (CAPE)", data: "cape", vector: false, quantity: "cape",
    ramp: [
      [0, [80, 150, 255, 0]],
      [200, [80, 150, 255, 120]],
      [600, [40, 200, 120, 220]],
      [1200, [240, 230, 40, A]],
      [2000, [250, 150, 20, A]],
      [3000, [235, 40, 40, A]],
      [5000, [210, 0, 200, A]],
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
