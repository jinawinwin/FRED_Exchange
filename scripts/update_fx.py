"""Download H.10 daily exchange rates from FRED and build daily, monthly and annual files.

Usage
    python scripts/update_fx.py

If the environment variable FRED_API_KEY is set, the official FRED API is used.
Otherwise the public fredgraph.csv download is used (no key required).

Outputs (in data/)
    daily.csv            as published by FRED, columns are FRED series IDs
    daily_per_usd.csv    rates only, all expressed as foreign currency units per 1 USD, columns are ISO codes
    monthly.csv          monthly averages of daily.csv
    monthly_per_usd.csv  monthly averages of daily_per_usd.csv
    annual.csv           annual averages of daily.csv
    annual_per_usd.csv   annual averages of daily_per_usd.csv
    metadata.json        update time, last observation date, per-series coverage

Files are rewritten only when the daily data differ from what is already stored,
so the scheduled workflow commits only when FRED has published new values.
"""

from __future__ import annotations

import io
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config" / "series.csv"
DATA = ROOT / "data"

API_URL = "https://api.stlouisfed.org/fred/series/observations"
CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
HEADERS = {"User-Agent": "FRED_Exchange-updater/1.0 (+https://github.com/jinawinwin/FRED_Exchange)"}

DECIMALS = 6          # rounding for derived values (inversions and averages)
RETRIES = 4
TIMEOUT = 60
PAUSE = 0.6           # seconds between requests, well within FRED API limits
MAX_DROP = 5          # abort if a series loses more than this many observations


# ---------------------------------------------------------------- download

def parse_api_json(payload: dict, series_id: str) -> pd.Series:
    obs = payload.get("observations", [])
    if not obs:
        raise ValueError(f"{series_id}: no observations in API response")
    frame = pd.DataFrame(obs)[["date", "value"]]
    values = pd.to_numeric(frame["value"], errors="coerce")  # "." marks missing values
    return pd.Series(values.values, index=pd.to_datetime(frame["date"]), name=series_id)


def parse_fredgraph_csv(text: str, series_id: str) -> pd.Series:
    frame = pd.read_csv(io.StringIO(text), dtype=str)
    if frame.shape[1] < 2:
        raise ValueError(f"{series_id}: unexpected CSV layout {list(frame.columns)}")
    # First column is the date (header has been DATE or observation_date), second is the value.
    dates = pd.to_datetime(frame.iloc[:, 0], errors="coerce")
    values = pd.to_numeric(frame.iloc[:, 1], errors="coerce")
    out = pd.Series(values.values, index=dates, name=series_id)
    out = out[out.index.notna()]
    if out.empty:
        raise ValueError(f"{series_id}: empty CSV response")
    return out


def fetch_series(series_id: str, api_key: str | None, session: requests.Session) -> pd.Series:
    last_error: Exception | None = None
    for attempt in range(1, RETRIES + 1):
        try:
            if api_key:
                resp = session.get(
                    API_URL,
                    params={"series_id": series_id, "api_key": api_key, "file_type": "json"},
                    headers=HEADERS,
                    timeout=TIMEOUT,
                )
                resp.raise_for_status()
                series = parse_api_json(resp.json(), series_id)
            else:
                resp = session.get(CSV_URL, params={"id": series_id}, headers=HEADERS, timeout=TIMEOUT)
                resp.raise_for_status()
                series = parse_fredgraph_csv(resp.text, series_id)
            return series.sort_index()
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            wait = 2 ** attempt
            print(f"  {series_id}: attempt {attempt} failed ({exc}); retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"{series_id}: download failed after {RETRIES} attempts") from last_error


# ---------------------------------------------------------------- transform

def build_daily(raw: dict[str, pd.Series], config: pd.DataFrame) -> pd.DataFrame:
    daily = pd.concat([raw[s] for s in config["series_id"]], axis=1)
    daily = daily.dropna(how="all")          # drop dates with no value in any series (holidays)
    daily.index.name = "date"
    return daily.sort_index()


def to_per_usd(daily: pd.DataFrame, config: pd.DataFrame) -> pd.DataFrame:
    rates = config[config["type"] == "rate"]
    out = pd.DataFrame(index=daily.index)
    for _, row in rates.iterrows():
        col = daily[row["series_id"]]
        out[row["code"]] = (1.0 / col).round(DECIMALS) if row["quote"] == "usd_per" else col
    out = out.dropna(how="all")
    out.index.name = "date"
    return out


def last_weekday(ts: pd.Timestamp) -> pd.Timestamp:
    ts = ts.normalize()
    while ts.weekday() >= 5:
        ts -= pd.Timedelta(days=1)
    return ts


def average(daily: pd.DataFrame, freq: str, last_obs: pd.Timestamp) -> pd.DataFrame:
    """Simple mean of available daily observations in each month ('M') or year ('Y')."""
    periods = daily.index.to_period(freq)
    avg = daily.groupby(periods).mean().round(DECIMALS)
    label = "month" if freq == "M" else "year"
    # A period is flagged partial while its last weekday lies after the latest observation.
    partial = [last_weekday(p.end_time) > last_obs for p in avg.index]
    avg.index = avg.index.astype(str)
    avg.index.name = label
    avg.insert(0, "partial", partial)
    return avg


# ---------------------------------------------------------------- checks and output

def check_against_existing(daily: pd.DataFrame) -> None:
    path = DATA / "daily.csv"
    if not path.exists():
        return
    old = pd.read_csv(path, index_col="date", parse_dates=["date"])
    for col in old.columns:
        if col not in daily.columns:
            continue  # series removed from config on purpose
        before, after = old[col].count(), daily[col].count()
        if after < before - MAX_DROP:
            raise RuntimeError(
                f"{col}: observation count fell from {before} to {after}. "
                "Aborting without writing, the download may be incomplete."
            )


def daily_unchanged(daily: pd.DataFrame) -> bool:
    path = DATA / "daily.csv"
    if not path.exists():
        return False
    return path.read_text(encoding="utf-8") == daily.to_csv(date_format="%Y-%m-%d", lineterminator="\n")


def write_csv(frame: pd.DataFrame, name: str) -> None:
    frame.to_csv(DATA / name, date_format="%Y-%m-%d", lineterminator="\n")


def main() -> int:
    config = pd.read_csv(CONFIG, dtype=str).fillna("")
    api_key = os.environ.get("FRED_API_KEY", "").strip() or None
    print(f"Source: {'FRED API' if api_key else 'fredgraph.csv'}; {len(config)} series")

    raw: dict[str, pd.Series] = {}
    with requests.Session() as session:
        for sid in config["series_id"]:
            raw[sid] = fetch_series(sid, api_key, session)
            s = raw[sid].dropna()
            print(f"  {sid:<11} {len(s):>6} obs  {s.index.min():%Y-%m-%d} .. {s.index.max():%Y-%m-%d}")
            time.sleep(PAUSE)

    daily = build_daily(raw, config)
    check_against_existing(daily)

    if daily_unchanged(daily):
        print("No new observations. Nothing written.")
        return 0

    DATA.mkdir(exist_ok=True)
    last_obs = daily.index.max()
    per_usd = to_per_usd(daily, config)

    write_csv(daily, "daily.csv")
    write_csv(per_usd, "daily_per_usd.csv")
    write_csv(average(daily, "M", last_obs), "monthly.csv")
    write_csv(average(per_usd, "M", last_obs), "monthly_per_usd.csv")
    write_csv(average(daily, "Y", last_obs), "annual.csv")
    write_csv(average(per_usd, "Y", last_obs), "annual_per_usd.csv")

    coverage = {}
    for _, row in config.iterrows():
        s = daily[row["series_id"]].dropna()
        coverage[row["series_id"]] = {
            "code": row["code"],
            "unit": row["unit"],
            "first": f"{s.index.min():%Y-%m-%d}" if len(s) else None,
            "last": f"{s.index.max():%Y-%m-%d}" if len(s) else None,
            "observations": int(len(s)),
        }
    meta = {
        "source": "Board of Governors of the Federal Reserve System (US), H.10 Foreign Exchange Rates, via FRED",
        "retrieved_with": "FRED API" if api_key else "fredgraph.csv",
        "updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "last_observation": f"{last_obs:%Y-%m-%d}",
        "series": coverage,
    }
    (DATA / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Written. Last observation {last_obs:%Y-%m-%d}, {len(daily)} daily rows.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
