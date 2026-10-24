"""Download a GFS 0.5° run from the NOAA Open Data bucket on AWS and encode
each forecast step as equirectangular PNG textures for the web client.

Only the GRIB messages we need are fetched, using HTTP range requests driven
by the .idx sidecar files.

    python ingest/gfs.py [--hours 120] [--step 3] [--out public/data]
"""

import argparse
import datetime as dt
import json
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor

import eccodes
import numpy as np
import requests
from PIL import Image

BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"

# (GRIB short name, level string in the .idx) for every field we read.
FIELDS = {
    "u": ("UGRD", "10 m above ground"),
    "v": ("VGRD", "10 m above ground"),
    "gust": ("GUST", "surface"),
    "temp": ("TMP", "2 m above ground"),
    "rh": ("RH", "2 m above ground"),
    "pressure": ("PRMSL", "mean sea level"),
    "rain": ("PRATE", "surface"),
    "clouds": ("TCDC", "entire atmosphere"),
    "cape": ("CAPE", "surface"),
}

# Output layers. Each value is packed into 0..255 between min and max (after
# an optional sqrt so small values like drizzle keep some resolution).
# "wind" packs u into R and v into G; "bits": 16 layers split a 16-bit value
# into R (high byte) and G (low byte); the rest are greyscale.
LAYERS = {
    # Asymmetric so that 0 m/s packs exactly to 128 (calm air must not drift).
    "wind": {"min": -50.0, "max": 49.609375, "unit": "m/s"},
    "gust": {"min": 0.0, "max": 60.0, "unit": "m/s"},
    "temp": {"min": -50.0, "max": 50.0, "unit": "°C"},
    "rh": {"min": 0.0, "max": 100.0, "unit": "%"},
    "pressure": {"min": 920.0, "max": 1060.0, "unit": "hPa", "bits": 16},
    "rain": {"min": 0.0, "max": 30.0, "unit": "mm/h", "sqrt": True},
    "clouds": {"min": 0.0, "max": 100.0, "unit": "%"},
    "cape": {"min": 0.0, "max": 5000.0, "unit": "J/kg", "sqrt": True},
}

session = requests.Session()


def run_exists(date: str, cycle: str, last_hour: int) -> bool:
    url = f"{BUCKET}/gfs.{date}/{cycle}/atmos/gfs.t{cycle}z.pgrb2.0p50.f{last_hour:03d}.idx"
    return session.head(url, timeout=20).status_code == 200


def latest_run(last_hour: int) -> tuple[str, str]:
    """Newest cycle whose final forecast step has been published."""
    now = dt.datetime.now(dt.timezone.utc)
    for back in range(0, 48, 6):
        t = now - dt.timedelta(hours=back)
        date, cycle = t.strftime("%Y%m%d"), f"{t.hour // 6 * 6:02d}"
        if run_exists(date, cycle, last_hour):
            return date, cycle
    sys.exit("no complete GFS run found in the last 48 h")


def byte_ranges(idx_text: str) -> dict[str, tuple[int, int | None]]:
    """Map our field keys to (start, end) byte ranges from a .idx file.

    Lines look like `588:126283361:d=2026102400:UGRD:10 m above ground:3 hour fcst:`.
    Only instantaneous messages are used (not `0-3 hour ave` etc.).
    """
    lines = [l.split(":") for l in idx_text.strip().splitlines()]
    offsets = [int(l[1]) for l in lines]
    wanted = {v: k for k, v in FIELDS.items()}
    out = {}
    for i, l in enumerate(lines):
        key = wanted.get((l[3], l[4]))
        if key and key not in out and l[5].endswith("hour fcst"):
            end = offsets[i + 1] - 1 if i + 1 < len(lines) else None
            out[key] = (offsets[i], end)
    return out


def fetch_step(date: str, cycle: str, hour: int) -> dict[str, np.ndarray]:
    base = f"{BUCKET}/gfs.{date}/{cycle}/atmos/gfs.t{cycle}z.pgrb2.0p50.f{hour:03d}"
    ranges = byte_ranges(session.get(base + ".idx", timeout=60).text)
    missing = set(FIELDS) - set(ranges)
    if missing:
        raise RuntimeError(f"f{hour:03d}: missing {sorted(missing)}")
    grids = {}
    for key, (start, end) in ranges.items():
        r = session.get(base, headers={"Range": f"bytes={start}-{'' if end is None else end}"}, timeout=120)
        r.raise_for_status()
        gid = eccodes.codes_new_from_message(r.content)
        try:
            ni, nj = eccodes.codes_get(gid, "Ni"), eccodes.codes_get(gid, "Nj")
            grid = eccodes.codes_get_values(gid).reshape(nj, ni)
        finally:
            eccodes.codes_release(gid)
        # GFS runs lon 0..359.5; roll so column 0 is lon -180.
        grids[key] = np.roll(grid, ni // 2, axis=1)
    return grids


def pack(values: np.ndarray, spec: dict) -> np.ndarray:
    lo, hi = spec["min"], spec["max"]
    t = np.clip((values - lo) / (hi - lo), 0, 1)
    if spec.get("sqrt"):
        t = np.sqrt(t)
    return np.round(t * 255).astype(np.uint8)


def pack16(values: np.ndarray, spec: dict) -> np.ndarray:
    lo, hi = spec["min"], spec["max"]
    q = np.round(np.clip((values - lo) / (hi - lo), 0, 1) * 65535).astype(np.uint16)
    return np.dstack([(q >> 8).astype(np.uint8), (q & 255).astype(np.uint8), np.zeros(q.shape, np.uint8)])


def to_layers(g: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    w = LAYERS["wind"]
    return {
        "wind": np.dstack([pack(g["u"], w), pack(g["v"], w), np.zeros_like(g["u"], np.uint8)]),
        "gust": pack(g["gust"], LAYERS["gust"]),
        "temp": pack(g["temp"] - 273.15, LAYERS["temp"]),
        "rh": pack(g["rh"], LAYERS["rh"]),
        "pressure": pack16(g["pressure"] / 100, LAYERS["pressure"]),
        "rain": pack(g["rain"] * 3600, LAYERS["rain"]),
        "clouds": pack(g["clouds"], LAYERS["clouds"]),
        "cape": pack(g["cape"], LAYERS["cape"]),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=120)
    ap.add_argument("--step", type=int, default=3)
    ap.add_argument("--out", default="public/data")
    args = ap.parse_args()

    date, cycle = latest_run(args.hours)
    run_time = dt.datetime.strptime(date + cycle, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)
    out = pathlib.Path(args.out)
    hours = list(range(args.step, args.hours + 1, args.step))
    print(f"GFS {date} {cycle}z, {len(hours)} steps -> {out}")

    def work(hour):
        step_dir = out / f"{hour:03d}"
        step_dir.mkdir(parents=True, exist_ok=True)
        for name, arr in to_layers(fetch_step(date, cycle, hour)).items():
            Image.fromarray(arr).save(step_dir / f"{name}.png", optimize=True)
        print(f"  f{hour:03d} done", flush=True)

    with ThreadPoolExecutor(4) as pool:
        list(pool.map(work, hours))

    manifest = {
        "model": "GFS 0.5°",
        "source": "NOAA/NCEP Global Forecast System via NOAA Open Data Dissemination (AWS)",
        "run": run_time.isoformat(),
        "width": 720,
        "height": 361,
        # Grid cell centres: lon -180..179.5, lat 90..-90.
        "bounds": [-180, -90, 180, 90],
        "steps": [
            {"hour": h, "time": (run_time + dt.timedelta(hours=h)).isoformat(), "dir": f"{h:03d}"}
            for h in hours
        ],
        "layers": LAYERS,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print("manifest written")


if __name__ == "__main__":
    main()
