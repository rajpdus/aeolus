# Open data feeds to plug in

Researched 2026-10-24. "CORS ✓" means the browser can call the source directly. Everything else
needs a backend ingest step, which you need anyway for GRIB or NetCDF data.

## Plug in next (value vs. effort)

| # | Feed | What it adds | Effort | Licence |
|---|---|---|---|---|
| 1 | **ECMWF Open Data, IFS 0.25° (0.1° directory now live) + AIFS** | A second model and a model switcher (Windy's headline feature). 4 runs a day, to 360 h. `data.ecmwf.int/forecasts/YYYYMMDD/HHz/ifs/0p25/oper/…grib2` with `.index` files for byte-range reads, the same trick `ingest/gfs.py` uses. | Low: same pipeline | CC-BY-4.0 |
| 2 | **GFS-Wave 0.16°** (same AWS bucket, `…/wave/gridded/gfswave.tHHz.global.0p16.fFFF.grib2`) | Waves and swell layer (height, period, direction) | Low | Public domain |
| 3 | **NASA GIBS WMTS**: `Himawari_AHI_Band13_Clean_Infrared`, `…Air_Mass`, `GOES-East/West_ABI_GeoColor`, `VIIRS_SNPP_CorrectedReflectance_TrueColor`, `IMERG_Precipitation_Rate_30min` | Satellite layer. Himawari covers India. | Very low: raster tiles, CORS ✓, no key | Open, credit NASA GIBS |
| 4 | **GEFS 0.5°** (`noaa-gefs-pds`) / ECMWF ENS | Ensemble spread and probability of rain | Medium | Public domain / CC-BY |
| 5 | **Cyclone tracks**: GDACS API (CORS ✓), NHC GIS, ECMWF/AIFS TC BUFR | Storm tracks and forecast cones, including the Bay of Bengal and Arabian Sea | Medium | Free with attribution |
| 6 | **CAMS global (Copernicus ADS)** | Air quality overlay: PM2.5, dust, AOD, O3, NO2 | Medium: needs a free ADS key | CC-BY since Jul 2025 |
| 7 | **HRRR 3 km** (US), **ICON-EU 6.5 km**, **HRDPS 2.5 km**, **AROME** | High-resolution regional models | Medium (ICON-global needs remapping from its icosahedral grid) | Public domain / CC BY 4.0 / OGL-Canada / Licence Ouverte |
| 8 | **Copernicus Marine** | Ocean currents and SST (WMTS is CORS ✓; bulk download needs a free account) | Medium | Free, mandatory credit |

## Observations and radar

- **RainViewer** (`api.rainviewer.com/public/weather-maps.json`): global radar, past 2 h, max zoom 7. **Non-commercial only.**
- **NOAA MRMS** (US) and **IEM NEXRAD** tiles; **DWD radar** (Germany). All open.
- **METAR** via aviationweather.gov: no CORS, so proxy it (100 requests/min).
- **Avoid without permission:** Blitzortung lightning, JMA GSM, the IMD API (IP-whitelisted, non-commercial), and scraping JTWC.

## Point forecasts, basemap, search

- **Open-Meteo** (already used): forecast, ensemble, marine and air-quality APIs. The free API is **non-commercial**, limited to 10k calls/day per IP. Self-host the AGPL server (e.g. on the DGX Spark) for commercial use.
- **OpenFreeMap** (already used): no key and commercial use is OK. Self-hostable.
- **Search:** Open-Meteo geocoding (in use). Self-hosted **Photon** is the robust option. Public Nominatim forbids autocomplete.

## Not yet verified

- The RainViewer rate limit
- The Protomaps hosted-tier terms
- The Météo-France bulk download paths
- The EUMETSAT per-product licences
- The current CAMS ADS dataset ID
