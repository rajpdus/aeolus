import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { FieldStore, loadManifest, type Manifest } from "./data";
import { OVERLAYS, cycleUnit, format, rampColor, rampCss, rampOf, unitLabel, type Overlay, type Theme } from "./layers";
import { WeatherLayer } from "./weatherLayer";
import { showForecast } from "./forecast";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function saved(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* private mode */ }
}

const STYLES: Record<Theme, string> = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
};

let theme: Theme =
  (saved("theme") as Theme | null) ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
document.documentElement.dataset.theme = theme;

async function start() {
  let manifest: Manifest;
  try {
    manifest = await loadManifest();
  } catch (e) {
    $("error").hidden = false;
    $("error").textContent = (e as Error).message;
    return;
  }
  const store = new FieldStore(manifest);
  const steps = manifest.steps.map((s) => new Date(s.time));

  let overlay: Overlay = OVERLAYS.find((o) => o.id === saved("overlay")) ?? OVERLAYS[0];
  const layer = new WeatherLayer(store, overlay);
  layer.theme = theme;

  // Start at the step closest to now.
  const now = Date.now();
  layer.time = Math.max(0, steps.findIndex((t) => t.getTime() >= now));

  const map = new maplibregl.Map({
    container: "map",
    style: STYLES[theme],
    center: [78, 22],
    zoom: 3.6,
    minZoom: 1.5,
    maxZoom: 11,
    // The weather shader assumes a flat, north-up map.
    maxPitch: 0,
    hash: "map",
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: false,
  });
  map.once("load", () => map.setBearing(0));
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibregl.AttributionControl({
    compact: true,
    customAttribution: `Weather: <a href="https://www.nco.ncep.noaa.gov/pmb/products/gfs/">NOAA GFS</a> · Forecasts: <a href="https://open-meteo.com/">Open-Meteo</a>`,
  }), "top-right");
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

  map.on("style.load", () => {
    const light = theme === "light";
    const layers = map.getStyle().layers;
    // Draw weather above land/water fills but below roads, borders and labels.
    const before = map.getLayer("waterway") ? "waterway" : layers.find((l) => l.type === "symbol")?.id;
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
    if (!map.getLayer("coastline"))
      map.addLayer({
        id: "coastline",
        type: "line",
        source: "openmaptiles",
        "source-layer": "water",
        paint: { "line-color": light ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.35)", "line-width": 0.6 },
      }, before);
    for (const l of layers) {
      if (l.type === "line" && "source-layer" in l && l["source-layer"] === "boundary")
        map.setPaintProperty(l.id, "line-color", light ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.45)");
      // Labels with a contrasting halo stay readable on any overlay colour.
      if (l.type === "symbol" && l.layout?.["text-field"]) {
        map.setPaintProperty(l.id, "text-color", light ? "#1b1f27" : "#f4f5f7");
        map.setPaintProperty(l.id, "text-halo-color", light ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.75)");
        map.setPaintProperty(l.id, "text-halo-width", 1.2);
      }
    }
  });

  // ---- theme ----
  const themeBtn = $("theme");
  const showTheme = () => {
    themeBtn.textContent = theme === "dark" ? "☀" : "☾";
    themeBtn.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  };
  showTheme();
  themeBtn.onclick = () => {
    theme = theme === "dark" ? "light" : "dark";
    save("theme", theme);
    document.documentElement.dataset.theme = theme;
    layer.theme = theme;
    showTheme();
    renderLegend();
    map.setStyle(STYLES[theme], { diff: false });
  };

  store.onLoad = () => {
    map.triggerRepaint();
    updatePicker();
  };
  store.preload([overlay.data, "wind"], layer.time);

  // ---- overlay menu ----
  const nav = $("overlays");
  for (const o of OVERLAYS) {
    const b = document.createElement("button");
    b.textContent = o.label;
    b.dataset.id = o.id;
    b.onclick = () => setOverlay(o);
    nav.append(b);
  }

  function setOverlay(o: Overlay) {
    overlay = o;
    layer.overlay = o;
    save("overlay", o.id);
    for (const b of nav.querySelectorAll("button")) b.classList.toggle("on", b.dataset.id === o.id);
    store.preload([o.data, "wind"], layer.time);
    renderLegend();
    updatePicker();
    map.triggerRepaint();
  }

  // ---- legend ----
  function renderLegend() {
    const r = rampOf(overlay, theme);
    $("legend-unit").textContent = unitLabel(overlay.quantity);
    $("legend-bar").style.background = rampCss(r);
    const lo = r[0][0], hi = r[r.length - 1][0];
    const ticks = r.filter((_, i) => i % Math.ceil(r.length / 6) === 0 || i === r.length - 1);
    $("legend-ticks").innerHTML = ticks
      .map(([v]) => `<span style="left:${((v - lo) / (hi - lo)) * 100}%">${format(overlay.quantity, v)}</span>`)
      .join("");
  }
  $("legend").onclick = () => {
    cycleUnit(overlay.quantity);
    renderLegend();
    updatePicker();
    refreshForecast?.();
  };

  // ---- timeline ----
  const slider = $<HTMLInputElement>("time");
  slider.max = String(steps.length - 1);
  slider.value = String(layer.time);
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });
  const bubbleFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const t0 = steps[0].getTime(), t1 = Math.max(t0 + 1, steps[steps.length - 1].getTime());
  const days: string[] = [];
  for (let d = new Date(t0); d.getTime() <= t1; d.setDate(d.getDate() + 1)) {
    const mid = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
    if (mid >= t0 && mid <= t1) days.push(`<span style="left:${((mid - t0) / (t1 - t0)) * 100}%">${dayFmt.format(mid)}</span>`);
  }
  $("days").innerHTML = days.join("");
  $("run").textContent = `${manifest.model} · run ${new Date(manifest.run).toISOString().slice(0, 13).replace("T", " ")}Z`;

  function timeAt(t: number): Date {
    if (steps.length < 2) return steps[0];
    const i = Math.min(steps.length - 2, Math.floor(t));
    return new Date(steps[i].getTime() + (steps[i + 1].getTime() - steps[i].getTime()) * (t - i));
  }

  function setTime(t: number) {
    layer.time = t;
    slider.value = String(t);
    const pct = steps.length > 1 ? t / (steps.length - 1) : 0;
    const bubble = $("bubble");
    bubble.textContent = bubbleFmt.format(timeAt(t));
    bubble.style.left = `${pct * 100}%`;
    updatePicker();
    map.triggerRepaint();
  }
  slider.oninput = () => setTime(Number(slider.value));
  slider.onchange = () => setTime(Math.round(Number(slider.value)));

  let playing = false;
  let playFrame = 0;
  $("play").onclick = () => {
    playing = !playing;
    $("play").textContent = playing ? "❚❚" : "▶";
    cancelAnimationFrame(playFrame);
    if (!playing) return;
    let last = performance.now();
    const step = (now: number) => {
      // ~2 forecast steps (6 h) per second
      let t = layer.time + ((now - last) / 1000) * 2;
      last = now;
      if (t > steps.length - 1) t = 0;
      setTime(t);
      playFrame = requestAnimationFrame(step);
    };
    playFrame = requestAnimationFrame(step);
  };

  // ---- point picker ----
  const pickerEl = document.createElement("div");
  pickerEl.className = "picker";
  const picker = new maplibregl.Marker({ element: pickerEl, draggable: true, anchor: "bottom-left" });
  let pickerOn = false;

  /** Value at the picker, blended between steps like the map. */
  function sampleNow(layerName: string, lng: number, lat: number): number | [number, number] | undefined {
    const i0 = Math.min(steps.length - 1, Math.floor(layer.time)), i1 = Math.min(steps.length - 1, i0 + 1);
    const a = store.peek(i0, layerName), b = store.peek(i1, layerName);
    if (!a || !b) return (a ?? b) && store.sample((a ?? b)!, layerName, lng, lat);
    const k = layer.time - i0;
    const va = store.sample(a, layerName, lng, lat), vb = store.sample(b, layerName, lng, lat);
    if (Array.isArray(va) && Array.isArray(vb)) return [va[0] + (vb[0] - va[0]) * k, va[1] + (vb[1] - va[1]) * k];
    return (va as number) + ((vb as number) - (va as number)) * k;
  }

  function updatePicker() {
    if (!pickerOn) return;
    const { lng, lat } = picker.getLngLat();
    const v = sampleNow(overlay.data, lng, lat);
    const w = sampleNow("wind", lng, lat) as [number, number] | undefined;
    let html = "";
    if (v !== undefined) {
      const val = Array.isArray(v) ? Math.hypot(v[0], v[1]) : v;
      html += `<b style="color:${rampColor(rampOf(overlay, theme), val)}">${format(overlay.quantity, val)}</b> <small>${unitLabel(overlay.quantity)}</small>`;
    }
    if (w && overlay.id !== "wind") {
      html += `<br><small>wind ${format("speed", Math.hypot(w[0], w[1]))} ${unitLabel("speed")}</small>`;
    } else if (w) {
      const [u, v] = w;
      const from = (Math.atan2(-u, -v) * 180) / Math.PI;
      html += ` <span class="arrow" style="transform:rotate(${from + 180}deg)">↑</span>`;
    }
    pickerEl.innerHTML = `<div class="bubble">${html || "…"}</div>`;
  }

  let refreshForecast: (() => void) | undefined;
  function pick(lng: number, lat: number, name?: string) {
    pickerOn = true;
    picker.setLngLat([lng, lat]).addTo(map);
    updatePicker();
    refreshForecast = () => showForecast(lat, lng, name, steps[0], timeAt(layer.time));
    refreshForecast();
  }
  map.on("click", (e) => pick(e.lngLat.lng, e.lngLat.lat));
  picker.on("dragend", () => { const p = picker.getLngLat(); pick(p.lng, p.lat); });
  $("detail-close").onclick = () => {
    $("detail").hidden = true;
    picker.remove();
    pickerOn = false;
  };

  // ---- search (Open-Meteo geocoding) ----
  const q = $<HTMLInputElement>("q");
  const results = $("results");
  let timer = 0;
  let searchSeq = 0;
  q.oninput = () => {
    clearTimeout(timer);
    const seq = ++searchSeq;
    timer = window.setTimeout(async () => {
      const term = q.value.trim();
      if (term.length < 2) { results.innerHTML = ""; return; }
      let j: { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] };
      try {
        const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=6&name=${encodeURIComponent(term)}`);
        if (!r.ok) throw new Error(String(r.status));
        j = await r.json();
      } catch {
        if (seq === searchSeq) results.innerHTML = `<li class="dim">Search unavailable</li>`;
        return;
      }
      if (seq !== searchSeq) return; // typed again since
      results.innerHTML = "";
      for (const p of j.results ?? []) {
        const li = document.createElement("li");
        li.textContent = [p.name, p.admin1, p.country].filter(Boolean).join(", ");
        li.onclick = () => {
          results.innerHTML = "";
          q.value = p.name;
          map.flyTo({ center: [p.longitude, p.latitude], zoom: Math.max(map.getZoom(), 7) });
          pick(p.longitude, p.latitude, p.name);
        };
        results.append(li);
      }
    }, 250);
  };

  setOverlay(overlay);
  setTime(layer.time);
}

start();
