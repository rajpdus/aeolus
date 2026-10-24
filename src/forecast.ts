// Point forecast table for a picked location, from the Open-Meteo API using
// its GFS model so it agrees with the map.

import { OVERLAYS, format, rampColor, unitLabel, type Quantity } from "./layers";

const $ = (id: string) => document.getElementById(id)!;
const ramp = (id: string) => OVERLAYS.find((o) => o.id === id)!.ramp;

interface Hourly {
  time: string[];
  temperature_2m: number[];
  precipitation: number[];
  wind_speed_10m: number[];
  wind_gusts_10m: number[];
  wind_direction_10m: number[];
  cloud_cover: number[];
  pressure_msl: number[];
}

let cache: { key: string; data: { hourly: Hourly; utc_offset_seconds: number } } | undefined;
let latest = 0;

export async function showForecast(
lat: number, lon: number, name: string | undefined, start: Date, current: Date) {
  const panel = $("detail");
  panel.hidden = false;
  $("detail-name").textContent = name ?? "Forecast";
  $("detail-coords").textContent = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
  $("detail-src").textContent = "GFS via Open-Meteo";

  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const request = ++latest;
  if (cache?.key !== key) {
    $("detail-body").innerHTML = `<div class="loading">Loading forecast…</div>`;
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&hourly=temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloud_cover,pressure_msl` +
      `&wind_speed_unit=ms&models=gfs_seamless&forecast_days=6&timezone=GMT`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
      const data = await r.json();
      if (request !== latest) return; // a newer pick superseded this one
      cache = { key, data };
    } catch (e) {
      if (request !== latest) return;
      $("detail-body").innerHTML = `<div class="loading">Couldn't load forecast: ${(e as Error).message}</div>`;
      return;
    }
  }
  const h = cache.data.hourly;

  // Every 3 h from the start of the map's run, to match the timeline.
  const cols: number[] = [];
  h.time.forEach((t, i) => {
    const d = new Date(t + "Z");
    if (d >= start && d.getUTCHours() % 3 === 0) cols.push(i);
  });

  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric" });
  // Columns are whole UTC hours; in half-hour zones (e.g. India) show the minutes too.
  const halfHourZone = new Date().getTimezoneOffset() % 60 !== 0;
  const hourFmt = new Intl.DateTimeFormat(undefined, halfHourZone ? { hour: "2-digit", minute: "2-digit" } : { hour: "2-digit" });
  const cell = (q: Quantity, v: number, rampId: string, extra = "") =>
    `<td style="--c:${rampColor(ramp(rampId), v)}"${extra}>${format(q, v)}</td>`;

  let dayRow = "", hourRow = "", temp = "", rain = "", wind = "", gust = "", dir = "", cloud = "", pres = "";
  let lastDay = "";
  let span = 0, dayCell = "";
  const flushDay = () => { if (span) dayRow += `<th colspan="${span}">${dayCell}</th>`; };
  for (const i of cols) {
    const d = new Date(h.time[i] + "Z");
    const label = dayFmt.format(d);
    if (label !== lastDay) { flushDay(); lastDay = label; dayCell = label; span = 0; }
    span++;
    const now = Math.abs(d.getTime() - current.getTime()) < 1.5 * 3600e3 ? ' class="now"' : "";
    hourRow += `<th${now}>${hourFmt.format(d)}</th>`;
    temp += cell("temp", h.temperature_2m[i], "temp");
    // 3-hour precipitation total ending at this hour.
    const p3 = (h.precipitation[i] ?? 0) + (h.precipitation[i - 1] ?? 0) + (h.precipitation[i - 2] ?? 0);
    rain += p3 >= 0.1 ? `<td style="--c:${rampColor(ramp("rain"), p3 / 3)}">${p3.toFixed(1)}</td>` : `<td class="dim">·</td>`;
    wind += cell("speed", h.wind_speed_10m[i], "wind");
    gust += cell("speed", h.wind_gusts_10m[i], "wind");
    dir += `<td><span class="arrow" style="transform:rotate(${h.wind_direction_10m[i] + 180}deg)">↑</span></td>`;
    cloud += `<td><span class="cloud" style="opacity:${0.15 + (h.cloud_cover[i] / 100) * 0.85}">●</span></td>`;
    pres += `<td class="dim">${Math.round(h.pressure_msl[i])}</td>`;
  }
  flushDay();

  $("detail-body").innerHTML = `
    <table class="fc">
      <tr class="day"><td class="lbl"></td>${dayRow}</tr>
      <tr class="hour"><td class="lbl"></td>${hourRow}</tr>
      <tr><td class="lbl">Clouds</td>${cloud}</tr>
      <tr class="val"><td class="lbl">Temp ${unitLabel("temp")}</td>${temp}</tr>
      <tr class="val"><td class="lbl">Rain mm/3h</td>${rain}</tr>
      <tr class="val"><td class="lbl">Wind ${unitLabel("speed")}</td>${wind}</tr>
      <tr class="val"><td class="lbl">Gusts</td>${gust}</tr>
      <tr><td class="lbl">Direction</td>${dir}</tr>
      <tr><td class="lbl">Pressure</td>${pres}</tr>
    </table>`;
  $("detail-body").querySelector(".now")?.scrollIntoView({ inline: "center", block: "nearest" });
}
