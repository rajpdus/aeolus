# How windy.com delivers its map (observed 2026-10-24)

Observed from browser network traffic on the public site only. We used none of its code, assets
or data endpoints.

| What | Request shape | Notes |
|---|---|---|
| Weather data tiles | `ims.windy.com/im/v3.0/forecast/{model}/{runYYYYMMDDHH}/{validYYYYMMDDHH}/wm_grid_257/{z}/{x}/{y}/wind-surface.jpg` | 257×265 JPEG: a 257×257 data grid plus 8 header rows (likely the value scale). For wind, R holds u and G holds v. Tiles carry a `token2` auth parameter. |
| Model metadata | `node.windy.com/metadata/v1.0/forecast/{model}/minifest.json` | Lists the available runs and timesteps |
| Basemap | `tiles.windy.com/tiles/v11.2/{region}/darkmap-retina/{z}/{x}/{y}.png` | Raster tiles |
| Labels | `tiles.windy.com/labels/v2.1/en/{z}/{x}/{y}.json` | Rendered on the client so they sit above the overlay |
| Colour ramps / particles | `wind.jpg`, `temp.jpg`, `rain.jpg` … | Image assets per layer |

How this project maps to the same approach:
- **Data images:** global equirectangular PNGs (720×361) instead of tiled JPEGs. At 0.5° the
  whole globe is about 230 KB per field, so tiling isn't needed yet. PNG is lossless, so the
  values aren't damaged by JPEG compression.
- **Scale metadata:** goes in `manifest.json` instead of header rows in the image.
- **Labels:** vector-tile symbol layers drawn above the custom WebGL layer.
- **Model metadata:** `manifest.json` (the equivalent of Windy's `minifest`).

Next step if resolution increases (0.25° GFS or 0.1° ECMWF): cut the textures into per-zoom
tiles so we keep loading only what's on screen.
