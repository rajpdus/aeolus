<h1 align="center">Aeolus</h1>

<p align="center">
  An open-source animated weather map in the spirit of windy.com:<br>
  WebGL wind particles, colour overlays, a 5-day timeline and point forecasts, built only on open data.
</p>

<p align="center">
  <a href="https://rajpdus.github.io/aeolus/"><img alt="Live demo" src="https://img.shields.io/badge/live%20demo-rajpdus.github.io%2Faeolus-e5484d?style=flat-square"></a>
  <a href="https://github.com/rajpdus/aeolus/actions/workflows/deploy.yml"><img alt="Deploy" src="https://img.shields.io/github/actions/workflow/status/rajpdus/aeolus/deploy.yml?branch=main&label=deploy&style=flat-square"></a>
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-3d8bd9?style=flat-square"></a>
  <img alt="Data: NOAA GFS" src="https://img.shields.io/badge/data-NOAA%20GFS%200.5%C2%B0-2a9d8f?style=flat-square">
  <img alt="Updated every 6 hours" src="https://img.shields.io/badge/updates-every%206%20h-6c5ce7?style=flat-square">
  <br>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="MapLibre GL" src="https://img.shields.io/badge/MapLibre%20GL-5-396cb2?style=flat-square&logo=maplibre&logoColor=white">
  <img alt="WebGL2" src="https://img.shields.io/badge/WebGL2-990000?style=flat-square&logo=webgl&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-646cff?style=flat-square&logo=vite&logoColor=white">
  <img alt="Python ingest" src="https://img.shields.io/badge/ingest-Python%20%2B%20ecCodes-3776ab?style=flat-square&logo=python&logoColor=white">
</p>

<p align="center">
  <a href="https://rajpdus.github.io/aeolus/"><img src="docs/screenshots/demo.gif" alt="Wind particles over the Bay of Bengal, timeline playback, then switching to temperature and rain" width="720"></a>
</p>

## Features

- **Eight layers:** wind (with animated particles), gusts, temperature, rain, clouds, pressure (with isobars), humidity and thunderstorm potential (CAPE)
- **Timeline:** 5 days in 3-hour steps; playback blends smoothly between steps
- **Point forecast:** click anywhere, or search a place, for a 6-day table of temperature, rain, wind, gusts, direction, clouds and pressure
- **Light and dark themes:** the default follows your system; switch with the ☀/☾ button
- **Shareable links:** the map position is kept in the URL (`#map=zoom/lat/lon`), and `?layer=temp&theme=light` pins the layer and theme
- **Units:** click the legend to cycle km/h, m/s, kt and Beaufort, or °C and °F

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/wind-dark.jpg" alt="Wind layer, dark theme: cyclone in the Bay of Bengal"><br><sub><b>Wind</b>, dark theme: a cyclone in the Bay of Bengal</sub></td>
    <td width="50%"><img src="docs/screenshots/temperature-light.jpg" alt="Temperature layer, light theme"><br><sub><b>Temperature</b>, light theme</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/pressure-light.jpg" alt="Pressure layer with isobars around a typhoon near Taiwan"><br><sub><b>Pressure</b> with 4 hPa isobars around a typhoon near Taiwan</sub></td>
    <td><img src="docs/screenshots/rain-dark.jpg" alt="Rain layer, dark theme"><br><sub><b>Rain</b>, dark theme</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/screenshots/forecast-dark.jpg" alt="Point forecast table for Mumbai"><br><sub><b>Point forecast</b> for Mumbai: search a place or click the map</sub></td>
  </tr>
</table>

## Data sources

| What | Source | Licence |
|---|---|---|
| Map layers | NOAA GFS 0.5°, from the [NOAA Open Data bucket on AWS](https://registry.opendata.aws/noaa-gfs-bdp-pds/) | US public domain |
| Basemap | [OpenFreeMap](https://openfreemap.org/) (OpenMapTiles) | © OpenStreetMap contributors |
| Point forecasts and search | [Open-Meteo](https://open-meteo.com/) | CC BY 4.0. The free API is non-commercial only; self-host it (AGPL) or buy a plan for commercial use |

## Run

```sh
uv venv .venv && uv pip install --python .venv/bin/python -r ingest/requirements.txt
npm install
npm run ingest   # newest complete GFS run -> public/data (~40 MB, about 3 min)
npm run dev      # http://localhost:5173
```

## Deploy

`.github/workflows/deploy.yml` builds the app, runs the ingest and publishes both to GitHub Pages
on every push to `main` and every 6 hours (about 5.5 h after each GFS cycle). Weather data is
never committed; each deploy fetches it fresh. To host a fork, enable Pages with source "GitHub
Actions" in the repository settings.

GitHub disables scheduled workflows after 60 days without repository activity. If the live data
goes stale, re-enable the workflow or push a commit.

## How it works

```
ingest/gfs.py   .idx byte ranges -> only the needed GRIB2 messages -> eccodes -> PNG textures
public/data/    manifest.json + NNN/{wind,temp,rain,...}.png   (720x361, equirectangular)
src/weatherLayer.ts  MapLibre custom layer (WebGL2)
src/data.ts     texture loading + CPU sampling for the picker
src/forecast.ts point-forecast table (Open-Meteo, GFS model)
```

- **Encoding:** each value is packed into 8 bits between fixed min/max limits listed in the
  manifest (rain and CAPE are sqrt-scaled). Wind keeps u in R and v in G. Pressure is 16-bit
  (R holds the high byte, G the low byte) so the isobars are smooth.
- **Overlay:** a full-screen fragment shader turns each pixel into Web Mercator, then lon/lat,
  then a texture coordinate. It filters manually on decoded values, blends the two neighbouring
  forecast steps, looks up a 256-entry colour ramp, and draws isolines with `fwidth`.
- **Particles:** positions live in an RGBA32F texture in screen space. Each frame they are
  advected by the wind in a ping-pong pass and drawn as line segments into a trail texture that
  fades over time. Particles reset when the map stops moving.

See `docs/RECON.md` for what we learned about how windy.com works, and
`docs/DATA_SOURCES.md` for other open feeds to plug in next.

## Licence

MIT. Weather data and basemap carry their own attribution terms (shown in the map's attribution).
"Windy" is a trademark of Windyty SE; this project is unaffiliated and uses none of its code,
assets or data.
