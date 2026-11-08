"""Build the dashboard data file from the CSVs written by update_fx.py.

Usage
    python scripts/analyze_fx.py

Reads data/*.csv and data/metadata.json and writes docs/data/dashboard.json.
The output contains no run timestamp, so it changes only when the data change.

Conventions
    per_usd   foreign currency units per 1 USD (as in data/daily_per_usd.csv)
    value change of a currency against the USD = per_usd(base) / per_usd(now) - 1
                (positive means the currency gained value against the USD)
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "docs" / "data" / "dashboard.json"

WEEKLY_START = "2000-01-01"
INDEX_START = "2006-01-01"
HEATMAP_FIRST_YEAR = 2006

# Display order groups related currencies together (used by heatmaps and tables).
ORDER = [
    "KRW", "JPY", "CNY", "TWD", "HKD", "SGD", "MYR", "THB", "INR", "LKR",
    "EUR", "GBP", "CHF", "DKK", "SEK", "NOK",
    "AUD", "NZD", "CAD", "MXN", "BRL", "ZAR",
]
NAMES_KO = {
    "KRW": "한국 원", "JPY": "일본 엔", "CNY": "중국 위안", "TWD": "대만 달러", "HKD": "홍콩 달러",
    "SGD": "싱가포르 달러", "MYR": "말레이시아 링깃", "THB": "태국 바트", "INR": "인도 루피",
    "LKR": "스리랑카 루피", "EUR": "유로", "GBP": "영국 파운드", "CHF": "스위스 프랑",
    "DKK": "덴마크 크로네", "SEK": "스웨덴 크로나", "NOK": "노르웨이 크로네", "AUD": "호주 달러",
    "NZD": "뉴질랜드 달러", "CAD": "캐나다 달러", "MXN": "멕시코 페소", "BRL": "브라질 헤알",
    "ZAR": "남아공 랜드",
}
REGION = {c: "아시아" for c in ORDER[:10]}
REGION.update({c: "유럽" for c in ORDER[10:16]})
REGION.update({c: "미주·오세아니아·아프리카" for c in ORDER[16:]})

# Line-chart groups. Each currency keeps the same colour slot wherever it reappears.
GROUPS = [
    {"id": "asia", "label": "아시아",
     "members": [["KRW", 1], ["JPY", 2], ["CNY", 3], ["TWD", 4], ["SGD", 5], ["INR", 6], ["THB", 7], ["MYR", 8]]},
    {"id": "major", "label": "주요 선진국",
     "members": [["EUR", 1], ["JPY", 2], ["GBP", 3], ["CHF", 4], ["CAD", 5], ["AUD", 6], ["NZD", 7], ["SEK", 8]]},
    {"id": "em", "label": "신흥국",
     "members": [["KRW", 1], ["BRL", 2], ["CNY", 3], ["MXN", 4], ["ZAR", 5], ["INR", 6], ["THB", 7], ["MYR", 8]]},
]
INDEXES = [
    ["DTWEXBGS", "Broad", "전체 교역 상대국"],
    ["DTWEXAFEGS", "AFE", "선진국 통화"],
    ["DTWEXEMEGS", "EME", "신흥국 통화"],
]


def sig(x: float, digits: int = 6):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    return float(f"{x:.{digits}g}")


def series_list(s: pd.Series, digits: int = 6) -> list:
    return [sig(v, digits) if pd.notna(v) else None for v in s.to_numpy(dtype=float)]


def value_on_or_before(s: pd.Series, when: pd.Timestamp):
    s = s.dropna()
    s = s[s.index <= when]
    return (s.index[-1], float(s.iloc[-1])) if len(s) else (None, None)


def pct(a, b):
    return None if a is None or b is None or b == 0 else round((a / b - 1) * 100, 3)


def kpi(name: str, unit: str, s: pd.Series, last: pd.Timestamp, digits: int = 2) -> dict:
    s = s.dropna()
    now_date, now = s.index[-1], float(s.iloc[-1])
    _, week = value_on_or_before(s, now_date - pd.Timedelta(days=7))
    _, ytd = value_on_or_before(s, pd.Timestamp(year=now_date.year - 1, month=12, day=31))
    _, year = value_on_or_before(s, now_date - pd.DateOffset(years=1))
    window = s[s.index > now_date - pd.DateOffset(years=1)]
    spark = s[s.index > now_date - pd.DateOffset(weeks=52)].resample("W-FRI").last().dropna()
    return {
        "name": name, "unit": unit, "date": f"{now_date:%Y-%m-%d}",
        "value": round(now, digits),
        "chg_1w": pct(now, week), "chg_ytd": pct(now, ytd), "chg_1y": pct(now, year),
        "high_52w": round(float(window.max()), digits), "low_52w": round(float(window.min()), digits),
        "spark": [round(float(v), digits) for v in spark],
    }


def main() -> None:
    meta = json.loads((DATA / "metadata.json").read_text(encoding="utf-8"))
    per = pd.read_csv(DATA / "daily_per_usd.csv", index_col="date", parse_dates=["date"])
    raw = pd.read_csv(DATA / "daily.csv", index_col="date", parse_dates=["date"])
    annual_raw = pd.read_csv(DATA / "annual.csv", index_col="year")
    annual_per = pd.read_csv(DATA / "annual_per_usd.csv", index_col="year")
    last = per.index.max()

    # ---- KPI tiles (daily data)
    krw = per["KRW"]
    kpis = [
        kpi("원/달러", "원", krw, last),
        kpi("원/100엔", "원", krw / per["JPY"] * 100, last),
        kpi("원/위안", "원", krw / per["CNY"], last),
        kpi("원/유로", "원", krw / per["EUR"], last),
        kpi("미 달러지수 (Broad)", "2006년 1월=100", raw["DTWEXBGS"], last, digits=3),
    ]

    # ---- weekly per_usd since 2000 (basis for every windowed analysis on the page)
    weekly = per.loc[WEEKLY_START:, ORDER].resample("W-FRI").last().dropna(how="all")
    weekly_dates = [f"{d:%Y-%m-%d}" for d in weekly.index]
    # The last bucket is labelled with its Friday even if the latest observation is earlier.
    weekly_dates[-1] = f"{min(weekly.index[-1], last):%Y-%m-%d}"

    dollar = raw.loc[INDEX_START:, [i[0] for i in INDEXES]].resample("W-FRI").last().dropna(how="all")
    dollar_dates = [f"{d:%Y-%m-%d}" for d in dollar.index]
    dollar_dates[-1] = f"{min(dollar.index[-1], last):%Y-%m-%d}"

    # ---- KRW daily, full history
    krw_daily = krw.dropna()

    # ---- annual KRW average and annual value change heatmap
    krw_annual = [
        {"year": int(y), "value": round(float(v), 2), "partial": bool(p)}
        for y, v, p in zip(annual_raw.index, annual_raw["DEXKOUS"], annual_raw["partial"])
        if pd.notna(v)
    ]
    years = [y for y in annual_per.index if y >= HEATMAP_FIRST_YEAR]
    heat = []
    for y in years:
        row = []
        for c in ORDER:
            prev, cur = annual_per.at[y - 1, c], annual_per.at[y, c]
            row.append(round((prev / cur - 1) * 100, 2) if pd.notna(prev) and pd.notna(cur) else None)
        heat.append(row)

    # ---- headline observations (fixed horizons, written as associations only)
    prev_end = pd.Timestamp(year=last.year - 1, month=12, day=31)
    ytd = {}
    for c in ORDER:
        _, base = value_on_or_before(per[c], prev_end)
        _, now = value_on_or_before(per[c], last)
        ytd[c] = (base / now - 1) * 100 if base and now else np.nan
    ytd = pd.Series(ytd).dropna().sort_values(ascending=False)
    rank = int(list(ytd.index).index("KRW")) + 1

    rets = np.log(per[ORDER]).diff()
    vol_1y = rets[rets.index > last - pd.DateOffset(years=1)].std() * math.sqrt(252) * 100
    broad_ytd = kpis[4]["chg_ytd"]
    krw_kpi = kpis[0]
    direction = "올랐습니다" if krw_kpi["chg_ytd"] > 0 else "내렸습니다"
    notes = [
        f"원/달러 환율은 {krw_kpi['date']} 기준 {krw_kpi['value']:,.2f}원으로, 지난해 말보다 "
        f"{abs(krw_kpi['chg_ytd']):.1f}% {direction}. 원화 가치로 보면 미 달러 대비 {ytd['KRW']:+.1f}% 변화입니다.",
        f"연초 이후 미 달러 대비 가치 변화율에서 원화는 22개 통화 중 {rank}번째입니다. "
        f"가장 크게 오른 통화는 {NAMES_KO[ytd.index[0]]}({ytd.iloc[0]:+.1f}%), "
        f"가장 크게 내린 통화는 {NAMES_KO[ytd.index[-1]]}({ytd.iloc[-1]:+.1f}%)입니다.",
        f"최근 1년 원화의 연율화 변동성(일별 로그수익률 기준)은 {vol_1y['KRW']:.1f}%이며, "
        f"22개 통화의 중앙값은 {vol_1y.median():.1f}%입니다.",
        f"미 달러지수(Broad)는 연초 이후 {broad_ytd:+.1f}% 변했습니다. "
        f"같은 기간 22개 통화 가운데 미 달러 대비 가치가 오른 통화는 {int((ytd > 0).sum())}개입니다.",
    ]

    out = {
        "meta": {
            "last_observation": f"{last:%Y-%m-%d}",
            "data_updated_utc": meta.get("updated_utc"),
            "source": meta.get("source"),
            "repo": "https://github.com/jinawinwin/FRED_Exchange",
        },
        "currencies": [{"code": c, "name": NAMES_KO[c], "region": REGION[c]} for c in ORDER],
        "groups": GROUPS,
        "kpis": kpis,
        "notes": notes,
        "weekly": {"dates": weekly_dates, "per_usd": {c: series_list(weekly[c]) for c in ORDER}},
        "dollar_index": {
            "dates": dollar_dates,
            "series": [{"id": sid, "short": short, "name": name, "values": series_list(dollar[sid])}
                       for sid, short, name in INDEXES],
        },
        "krw_daily": {
            "start": f"{krw_daily.index[0]:%Y-%m-%d}",
            "dates": [f"{d:%Y-%m-%d}" for d in krw_daily.index],
            "values": [round(float(v), 2) for v in krw_daily],
        },
        "krw_annual": krw_annual,
        "annual_change": {"years": [int(y) for y in years], "codes": ORDER, "values": heat,
                          "partial_year": int(annual_per.index[annual_per["partial"]].max())
                          if annual_per["partial"].any() else None},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB), last observation {last:%Y-%m-%d}")
    for n in notes:
        print(" -", n)


if __name__ == "__main__":
    main()
