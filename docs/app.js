/* FRED exchange-rate dashboard. Reads data/dashboard.json built by scripts/analyze_fx.py. */
(function () {
  "use strict";

  var RAW = "https://raw.githubusercontent.com/jinawinwin/FRED_Exchange/main/data/";
  var WINDOWS = [
    { id: "1y", label: "1년", years: 1 },
    { id: "3y", label: "3년", years: 3 },
    { id: "5y", label: "5년", years: 5 },
    { id: "10y", label: "10년", years: 10 },
    { id: "20y", label: "20년", years: 20 },
    { id: "all", label: "2000년 이후", years: null }
  ];
  var CROSSES = [
    { code: "JPY", label: "원/100엔", mult: 100 },
    { code: "CNY", label: "원/위안", mult: 1 },
    { code: "EUR", label: "원/유로", mult: 1 },
    { code: "GBP", label: "원/파운드", mult: 1 }
  ];
  var DOWNLOADS = [
    ["daily.csv", "일별, FRED 공표 단위"],
    ["daily_per_usd.csv", "일별, 미 달러 1단위당 외화"],
    ["monthly.csv", "월평균, FRED 공표 단위"],
    ["monthly_per_usd.csv", "월평균, 미 달러 1단위당 외화"],
    ["annual.csv", "연평균, FRED 공표 단위"],
    ["annual_per_usd.csv", "연평균, 미 달러 1단위당 외화"],
    ["metadata.json", "갱신 시각과 시리즈별 관측 기간"]
  ];

  var state = { win: "5y", group: "asia" };
  var D, T, W, K, NAME = {}, R = null;
  var charts = {}, tables = {};
  var FONT = 'system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

  /* ------------------------------------------------------------------ helpers */
  function nf(d) { return new Intl.NumberFormat("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fmt(v, d) { return v == null || !isFinite(v) ? "–" : nf(d == null ? 2 : d).format(v); }
  function fmtPct(v, d) {
    if (v == null || !isFinite(v)) return "–";
    var s = nf(d == null ? 1 : d).format(Math.abs(v));
    return (v > 0 ? "+" : v < 0 ? "−" : "") + s + "%";
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function ts(d) { return Date.parse(d + "T00:00:00Z"); }
  function dstr(t) { return new Date(t).toISOString().slice(0, 10); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function tok(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function readTokens() {
    T = {};
    ["page", "surface", "text-1", "text-2", "muted", "axis-label", "grid", "axis", "border", "deemph",
     "track", "partial", "div-n3", "div-n2", "div-n1", "div-0", "div-p1", "div-p2", "div-p3"].forEach(function (k) {
      T[k] = tok("--" + k);
    });
    for (var i = 1; i <= 8; i++) T["s" + i] = tok("--s" + i);
    T.diverging = [T["div-n3"], T["div-n2"], T["div-n1"], T["div-0"], T["div-p1"], T["div-p2"], T["div-p3"]];
  }

  function isDark() {
    var t = document.documentElement.dataset.theme;
    if (t) return t === "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  /* ------------------------------------------------------------------ data prep */
  function prepare() {
    D.currencies.forEach(function (c) { NAME[c.code] = c.name; });
    W = { d: D.weekly.dates, t: D.weekly.dates.map(ts), p: D.weekly.per_usd };
    K = { t: D.krw_daily.dates.map(ts), v: D.krw_daily.values };

    // weekly log returns and 26-week rolling volatility for every currency (independent of the window)
    W.r = {}; W.roll = {};
    D.currencies.forEach(function (c) {
      var p = W.p[c.code], r = new Array(p.length).fill(null);
      for (var i = 1; i < p.length; i++) if (p[i] != null && p[i - 1] != null) r[i] = Math.log(p[i] / p[i - 1]);
      W.r[c.code] = r;
      var roll = new Array(p.length).fill(null);
      for (var j = 25; j < p.length; j++) {
        var xs = [];
        for (var k = j - 25; k <= j; k++) if (r[k] != null) xs.push(r[k]);
        if (xs.length >= 20) roll[j] = sd(xs) * Math.sqrt(52) * 100;
      }
      W.roll[c.code] = roll;
    });
    W.rollMedian = W.t.map(function (_, i) {
      var xs = [];
      D.currencies.forEach(function (c) { if (W.roll[c.code][i] != null) xs.push(W.roll[c.code][i]); });
      return xs.length >= 10 ? median(xs) : null;
    });
  }
  function mean(xs) { var s = 0; for (var i = 0; i < xs.length; i++) s += xs[i]; return s / xs.length; }
  function sd(xs) { var m = mean(xs), s = 0; for (var i = 0; i < xs.length; i++) s += (xs[i] - m) * (xs[i] - m); return Math.sqrt(s / (xs.length - 1)); }
  function median(xs) { var a = xs.slice().sort(function (x, y) { return x - y; }), n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; }

  function windowRange() {
    var w = WINDOWS.filter(function (x) { return x.id === state.win; })[0];
    var lastT = W.t[W.t.length - 1];
    if (!w.years) return { i0: 0, startT: W.t[0], lastT: lastT, label: w.label };
    var s = new Date(lastT); s.setUTCFullYear(s.getUTCFullYear() - w.years);
    var startT = s.getTime(), i0 = 0;
    for (var i = 0; i < W.t.length; i++) { if (W.t[i] <= startT) i0 = i; else break; }
    return { i0: i0, startT: W.t[i0], lastT: lastT, label: w.label };
  }

  // axis bounds padded so tip labels fit, snapped to a 1-2-5 step
  function niceAxis(lo, hi, padShare) {
    var span = (hi - lo) || 1, pad = span * padShare;
    var raw = (span + 2 * pad) / 5, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
    return { step: step, min: lo < 0 ? Math.floor((lo - pad) / step) * step : 0, max: hi > 0 ? Math.ceil((hi + pad) / step) * step : 0 };
  }
  function firstValid(arr, from) { for (var i = from; i < arr.length; i++) if (arr[i] != null) return i; return -1; }
  function lastValid(arr) { for (var i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i; return -1; }

  // indices of the last observation of each month within [from, to]
  function monthEnds(tArr, from, to) {
    var out = [];
    for (var i = from; i <= to; i++) {
      if (i === to || dstr(tArr[i]).slice(0, 7) !== dstr(tArr[i + 1]).slice(0, 7)) out.push(i);
    }
    return out;
  }

  /* ------------------------------------------------------------------ echarts plumbing */
  function getChart(id, el) {
    if (charts[id] && !charts[id].isDisposed()) return charts[id];
    var c = echarts.init(el, null, { renderer: "canvas" });
    charts[id] = c;
    if (window.ResizeObserver) new ResizeObserver(function () { c.resize(); }).observe(el);
    return c;
  }
  function draw(id, el, option) { getChart(id, el).setOption(option, { notMerge: true }); }

  function base() {
    return {
      backgroundColor: "transparent",
      animationDuration: 280,
      animationDurationUpdate: 280,
      textStyle: { fontFamily: FONT, color: T["text-2"] },
      tooltip: {
        confine: true,
        backgroundColor: T.surface,
        borderColor: T.border,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: T["text-1"], fontSize: 12, fontFamily: FONT },
        extraCssText: "border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.14);"
      }
    };
  }
  function timeAxis() {
    return {
      type: "time",
      axisLine: { lineStyle: { color: T.axis } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        color: T["axis-label"], hideOverlap: true, fontSize: 11,
        formatter: { year: "{yyyy}", month: "{M}월", day: "{M}.{d}", hour: "", minute: "", second: "", millisecond: "", none: "" }
      },
      axisPointer: { lineStyle: { color: T.axis, width: 1, type: "solid" }, label: { show: false } }
    };
  }
  function valueAxis(extra) {
    var a = {
      type: "value", scale: true,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: T["axis-label"], fontSize: 11 },
      splitLine: { lineStyle: { color: T.grid, width: 1, type: "solid" } }
    };
    return Object.assign(a, extra || {});
  }
  function legend() {
    return {
      top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 3, itemGap: 16,
      textStyle: { color: T["text-2"], fontSize: 12 }, inactiveColor: T.deemph
    };
  }
  function ttRow(color, val, name) {
    return '<div class="tt-row"><span class="tt-key" style="background:' + color + '"></span>' +
      '<span class="tt-val">' + esc(val) + '</span><span class="tt-name">' + esc(name) + "</span></div>";
  }
  function axisTooltip(valueFmt, sortDesc) {
    return {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: T.axis, width: 1 } },
      formatter: function (ps) {
        if (!ps.length) return "";
        var rows = ps.filter(function (p) { return p.value && p.value[1] != null; });
        if (sortDesc) rows.sort(function (a, b) { return b.value[1] - a.value[1]; });
        return '<div class="tt-head">' + dstr(ps[0].value[0]) + "</div>" +
          rows.map(function (p) { return ttRow(p.color, valueFmt(p.value[1]), p.seriesName); }).join("");
      }
    };
  }
  function line(name, data, color, extra) {
    return Object.assign({
      name: name, type: "line", data: data, showSymbol: false, symbolSize: 8, sampling: "lttb",
      lineStyle: { width: 2, color: color, cap: "round", join: "round" },
      itemStyle: { color: color, borderColor: T.surface, borderWidth: 2 },
      emphasis: { focus: "series", lineStyle: { width: 2.5 } },
      blur: { lineStyle: { opacity: 0.25 } }
    }, extra || {});
  }
  function endLabel(fmtFn) {
    return { show: true, color: T["text-1"], fontSize: 11.5, distance: 6, formatter: function (p) { return fmtFn(p); } };
  }
  function scaleLegend(kind, lo, mid, hi) {
    var el = document.querySelector('[data-scale="' + kind + '"]');
    if (!el) return;
    el.textContent = "";
    var a = document.createElement("span"); a.textContent = lo;
    var bar = document.createElement("span"); bar.className = "scale-bar";
    bar.style.background = "linear-gradient(90deg," + T.diverging.join(",") + ")";
    var b = document.createElement("span"); b.textContent = hi;
    var m = document.createElement("span"); m.textContent = "가운데 " + mid;
    el.append(a, bar, b, m);
  }
  function ariaLabel(fig) {
    var el = $(".chart", fig), h = $("h3", fig);
    if (el && h) { el.setAttribute("role", "img"); el.setAttribute("aria-label", h.textContent.trim() + ". 값은 표 보기에서 확인할 수 있습니다."); }
  }

  /* ------------------------------------------------------------------ KPI section */
  function spark(values, w, h) {
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values), n = values.length;
    var pad = 5, x = function (i) { return pad + (i / (n - 1)) * (w - 2 * pad); };
    var y = function (v) { return hi === lo ? h / 2 : pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad); };
    var pts = values.map(function (v, i) { return x(i).toFixed(1) + "," + y(v).toFixed(1); }).join(" ");
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true">' +
      '<polyline points="' + pts + '" fill="none" stroke="var(--axis-label)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + x(n - 1).toFixed(1) + '" cy="' + y(values[n - 1]).toFixed(1) + '" r="4" fill="var(--s1)" stroke="var(--surface)" stroke-width="2"/></svg>';
  }
  function deltaItems(k) {
    return '<li>1주 <strong>' + fmtPct(k.chg_1w, 2) + '</strong></li>' +
      '<li>연초 대비 <strong>' + fmtPct(k.chg_ytd, 2) + '</strong></li>' +
      '<li>1년 <strong>' + fmtPct(k.chg_1y, 2) + "</strong></li>";
  }
  function renderKpis() {
    var k = D.kpis[0];
    var pos = Math.max(0, Math.min(1, (k.value - k.low_52w) / (k.high_52w - k.low_52w))) * 100;
    $("#hero").innerHTML =
      '<p class="label">원/달러 환율</p>' +
      '<p class="value">' + fmt(k.value, 2) + "<small>원</small></p>" +
      '<p class="asof">' + esc(k.date) + " 뉴욕 정오 기준</p>" +
      '<ul class="deltas">' + deltaItems(k) + "</ul>" +
      '<div class="range" aria-label="최근 52주 범위">' +
      '<div class="range-track"><span class="range-dot" style="left:' + pos.toFixed(1) + '%"></span></div>' +
      '<div class="range-labels"><span>52주 저점 ' + fmt(k.low_52w, 2) + "</span><span>52주 고점 " + fmt(k.high_52w, 2) + "</span></div></div>" +
      '<div class="hero-spark">' + spark(k.spark, 460, 64) + '<span>최근 52주, 주간</span></div>' +
      '<p class="hint">환율 하락은 원화 강세, 상승은 원화 약세를 뜻합니다. 변화율은 환율 기준입니다.</p>';
    $("#tiles").innerHTML = D.kpis.slice(1).map(function (t) {
      var d = t.unit === "원" ? 2 : 2;
      return '<div class="card tile">' +
        '<p class="label">' + esc(t.name) + "</p>" +
        '<div class="tile-body"><div>' +
        '<p class="value">' + fmt(t.value, d) + (t.unit === "원" ? "<small>원</small>" : "") + "</p>" +
        '<ul class="deltas"><li>1주 <strong>' + fmtPct(t.chg_1w, 2) + "</strong></li><li>연초 대비 <strong>" + fmtPct(t.chg_ytd, 2) + "</strong></li></ul>" +
        "</div>" + spark(t.spark, 120, 40) + "</div></div>";
    }).join("");
    var ul = $("#notes"); ul.textContent = "";
    D.notes.forEach(function (n) { var li = document.createElement("li"); li.textContent = n; ul.appendChild(li); });
  }

  /* ------------------------------------------------------------------ long-run charts */
  function renderAnnual() {
    var fig = $("#fig-annual"), rows = D.krw_annual;
    var done = rows.filter(function (r) { return !r.partial; });
    var maxRow = done.reduce(function (a, b) { return b.value > a.value ? b : a; });
    var last = rows[rows.length - 1];
    var labelled = [last];
    if (rows.indexOf(maxRow) < rows.length - 2) labelled.push(maxRow);  // skip when it would collide with the last bar
    var o = base();
    o.grid = { left: 4, right: 28, top: 40, bottom: 4, containLabel: true };
    o.xAxis = { type: "category", data: rows.map(function (r) { return String(r.year); }),
      axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false },
      axisLabel: { color: T["axis-label"], fontSize: 11, hideOverlap: true } };
    o.yAxis = valueAxis({ scale: false, min: 0 });
    o.tooltip = Object.assign(o.tooltip, { trigger: "item", formatter: function (p) {
      var r = rows[p.dataIndex];
      return '<div class="tt-head">' + r.year + "년" + (r.partial ? " (연초 이후)" : "") + "</div>" + ttRow(T.s1, fmt(r.value, 2) + "원", "원/달러 연평균");
    } });
    o.series = [{
      type: "bar", barMaxWidth: 14,
      data: rows.map(function (r) {
        var it = { value: r.value, itemStyle: { color: r.partial ? T.partial : T.s1, borderRadius: [4, 4, 0, 0] } };
        if (labelled.indexOf(r) >= 0) {
          it.label = { show: true, position: "top", color: T["text-2"], fontSize: 11, lineHeight: 14,
            formatter: (r.partial ? r.year + " 연초 이후" : r.year + "년") + "\n" + fmt(r.value, 0) };
        }
        return it;
      }),
      emphasis: { itemStyle: { opacity: 0.8 } }
    }];
    draw("annual", $(".chart", fig), o);
    tables["fig-annual"] = function () {
      return { head: ["연도", "원/달러 연평균", "비고"], rows: rows.slice().reverse().map(function (r) { return [r.year, fmt(r.value, 2), r.partial ? "연초 이후" : ""]; }) };
    };
  }

  function clampHeat(v, lim) { return Math.max(-lim, Math.min(lim, v)); }

  function renderHeat() {
    var fig = $("#fig-heat"), A = D.annual_change, el = $(".chart", fig);
    var xs = A.years.map(function (y) { return y === A.partial_year ? y + "*" : String(y); });
    var data = [];
    A.values.forEach(function (row, xi) {
      row.forEach(function (v, yi) { if (v != null) data.push([xi, yi, clampHeat(v, 15), v]); });
    });
    var narrow = el.clientWidth < 720;
    var o = base();
    o.grid = { left: 4, right: 8, top: 4, bottom: 4, containLabel: true };
    o.xAxis = { type: "category", data: xs, position: "top", axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: T["axis-label"], fontSize: 10.5, rotate: narrow ? 90 : 0, interval: 0 }, splitArea: { show: false } };
    o.yAxis = { type: "category", data: A.codes, inverse: true, axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: T["text-2"], fontSize: 11, interval: 0,
        formatter: function (c) { return c === "KRW" ? "{b|KRW}" : c; }, rich: { b: { fontWeight: 700, color: T["text-1"], fontSize: 11 } } } };
    o.visualMap = { show: false, min: -15, max: 15, dimension: 2, inRange: { color: T.diverging } };
    o.tooltip = Object.assign(o.tooltip, { trigger: "item", formatter: function (p) {
      var code = A.codes[p.value[1]], yr = A.years[p.value[0]];
      return '<div class="tt-head">' + yr + "년" + (yr === A.partial_year ? " (연초 이후 평균)" : "") + "</div>" +
        ttRow(p.color, fmtPct(p.value[3], 1), NAME[code] + " (" + code + ")");
    } });
    o.series = [{ type: "heatmap", data: data,
      itemStyle: { borderColor: T.surface, borderWidth: 2, borderRadius: 2 },
      emphasis: { itemStyle: { borderColor: T["text-1"], borderWidth: 1.5 } } }];
    draw("heat", el, o);
    scaleLegend("heat", "−15% 이하 (약세)", "0%", "+15% 이상 (강세)");
    tables["fig-heat"] = function () {
      return { head: ["통화"].concat(xs), rows: A.codes.map(function (c, yi) {
        return [NAME[c] + " (" + c + ")"].concat(A.values.map(function (row) { return fmtPct(row[yi], 1); }));
      }) };
    };
  }

  /* ------------------------------------------------------------------ windowed charts */
  function renderKrw(R) {
    var fig = $("#fig-krw"), data = [], hi = null, lo = null;
    for (var i = 0; i < K.t.length; i++) {
      if (K.t[i] < R.startT) continue;
      var pt = [K.t[i], K.v[i]]; data.push(pt);
      if (!hi || pt[1] > hi[1]) hi = pt;
      if (!lo || pt[1] < lo[1]) lo = pt;
    }
    var o = base();
    o.grid = { left: 4, right: 64, top: 28, bottom: 4, containLabel: true };
    o.xAxis = timeAxis();
    o.yAxis = valueAxis();
    o.tooltip = Object.assign(o.tooltip, axisTooltip(function (v) { return fmt(v, 2) + "원"; }));
    var span = R.lastT - R.startT;
    var mp = function (pt, txt, pos) {
      var f = (pt[0] - R.startT) / span, align = f < 0.15 ? "left" : f > 0.85 ? "right" : "center";
      return { coord: pt, value: pt[1], symbol: "circle", symbolSize: 9,
        itemStyle: { color: T.s1, borderColor: T.surface, borderWidth: 2 },
        label: { show: true, position: pos, align: align, color: T["text-2"], fontSize: 11, formatter: txt + " " + fmt(pt[1], 2) + " (" + dstr(pt[0]) + ")" } };
    };
    o.series = [line("원/달러", data, T.s1, {
      endLabel: endLabel(function (p) { return fmt(p.value[1], 2); }),
      markPoint: { silent: true, animation: false, data: [mp(hi, "고점", "top"), mp(lo, "저점", "bottom")] }
    })];
    draw("krw", $(".chart", fig), o);
    tables["fig-krw"] = function () {
      var from = K.t.findIndex(function (t) { return t >= R.startT; });
      return { head: ["날짜 (월말)", "원/달러"], rows: monthEnds(K.t, from, K.t.length - 1).reverse().map(function (i) { return [dstr(K.t[i]), fmt(K.v[i], 2)]; }) };
    };
  }

  function perfData(R) {
    return D.currencies.map(function (c) {
      var p = W.p[c.code], i = firstValid(p, R.i0), j = lastValid(p);
      var chg = i >= 0 && j > i ? (p[i] / p[j] - 1) * 100 : null;
      return { code: c.code, name: c.name, base: i >= 0 ? p[i] : null, baseDate: i >= 0 ? W.d[i] : "", now: j >= 0 ? p[j] : null, chg: chg };
    }).filter(function (r) { return r.chg != null; });
  }

  function krwAxisLabel() {
    return { color: T["text-2"], fontSize: 11.5, interval: 0,
      formatter: function (n) { return n === NAME.KRW ? "{b|" + n + "}" : n; },
      rich: { b: { fontWeight: 700, color: T["text-1"], fontSize: 11.5 } } };
  }

  function renderPerf(R) {
    var fig = $("#fig-perf"), rows = perfData(R).sort(function (a, b) { return a.chg - b.chg; });
    var ax = niceAxis(Math.min(0, rows[0].chg), Math.max(0, rows[rows.length - 1].chg), 0.22);
    var o = base();
    o.grid = { left: 4, right: 12, top: 8, bottom: 4, containLabel: true };
    o.xAxis = valueAxis({ scale: false, axisLabel: { color: T["axis-label"], fontSize: 11, formatter: function (v) { return v + "%"; } },
      min: ax.min, max: ax.max, interval: ax.step });
    o.yAxis = { type: "category", data: rows.map(function (r) { return r.name; }), axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false }, axisLabel: krwAxisLabel() };
    o.tooltip = Object.assign(o.tooltip, { trigger: "item", formatter: function (p) {
      var r = rows[p.dataIndex];
      return '<div class="tt-head">' + esc(r.name) + " (" + r.code + ") · " + r.baseDate + " 이후</div>" +
        ttRow(p.color, fmtPct(r.chg, 2), "미 달러 대비 통화가치") +
        ttRow(T.axis, fmt(r.base, 4) + " → " + fmt(r.now, 4), "미 달러 1단위당 " + r.code);
    } });
    o.series = [{
      type: "bar", barMaxWidth: 14,
      data: rows.map(function (r) {
        var up = r.chg >= 0;
        return { value: r.chg,
          itemStyle: { color: up ? T.s1 : T.s8, borderRadius: up ? [0, 4, 4, 0] : [4, 0, 0, 4] },
          label: { show: true, position: up ? "right" : "left", color: T["text-2"], fontSize: 11, formatter: fmtPct(r.chg, 1) } };
      }),
      emphasis: { itemStyle: { opacity: 0.8 } }
    }];
    draw("perf", $(".chart", fig), o);
    tables["fig-perf"] = function () {
      return { head: ["통화", "코드", "기준 주", "기준 환율", "최근 환율", "통화가치 변화"],
        rows: rows.slice().reverse().map(function (r) { return [r.name, r.code, r.baseDate, fmt(r.base, 4), fmt(r.now, 4), fmtPct(r.chg, 2)]; }) };
    };
  }

  function volData(R) {
    return D.currencies.map(function (c) {
      var r = W.r[c.code], xs = [];
      for (var i = R.i0 + 1; i < r.length; i++) if (r[i] != null) xs.push(r[i]);
      return { code: c.code, name: c.name, n: xs.length, vol: xs.length >= 10 ? sd(xs) * Math.sqrt(52) * 100 : null };
    }).filter(function (r) { return r.vol != null; });
  }

  function renderVol(R) {
    var fig = $("#fig-vol"), rows = volData(R).sort(function (a, b) { return a.vol - b.vol; });
    var vax = niceAxis(0, rows[rows.length - 1].vol, 0.15);
    var o = base();
    o.grid = { left: 4, right: 12, top: 8, bottom: 4, containLabel: true };
    o.xAxis = valueAxis({ scale: false, min: 0, axisLabel: { color: T["axis-label"], fontSize: 11, formatter: function (v) { return v + "%"; } },
      max: vax.max, interval: vax.step });
    o.yAxis = { type: "category", data: rows.map(function (r) { return r.name; }), axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false }, axisLabel: krwAxisLabel() };
    o.tooltip = Object.assign(o.tooltip, { trigger: "item", formatter: function (p) {
      var r = rows[p.dataIndex];
      return '<div class="tt-head">' + esc(r.name) + " (" + r.code + ")</div>" + ttRow(p.color, fmt(r.vol, 1) + "%", "연율화 변동성, 관측 " + r.n + "주");
    } });
    o.series = [{
      type: "bar", barMaxWidth: 14,
      data: rows.map(function (r) {
        return { value: r.vol, itemStyle: { color: r.code === "KRW" ? T.s1 : T.deemph, borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: "right", color: r.code === "KRW" ? T["text-1"] : T["text-2"], fontWeight: r.code === "KRW" ? 700 : 400, fontSize: 11, formatter: fmt(r.vol, 1) } };
      }),
      emphasis: { itemStyle: { opacity: 0.8 } }
    }];
    draw("vol", $(".chart", fig), o);
    tables["fig-vol"] = function () {
      return { head: ["통화", "코드", "연율화 변동성", "관측 주 수"], rows: rows.slice().reverse().map(function (r) { return [r.name, r.code, fmt(r.vol, 2) + "%", r.n]; }) };
    };
  }

  function currentGroup() { return D.groups.filter(function (g) { return g.id === state.group; })[0]; }

  function renderIndex(R) {
    var fig = $("#fig-index"), g = currentGroup();
    $("#group-name").textContent = "· " + g.label;
    var series = [], cols = [];
    g.members.forEach(function (m) {
      var code = m[0], p = W.p[code], i = firstValid(p, R.i0);
      if (i < 0) return;
      var data = [];
      for (var k = R.i0; k < p.length; k++) if (p[k] != null && k >= i) data.push([W.t[k], (p[i] / p[k]) * 100]);
      cols.push({ code: code, data: data });
      series.push(line(NAME[code], data, T["s" + m[1]]));
    });
    if (series.length) series[0].markLine = { silent: true, symbol: "none", animation: false, label: { show: false },
      lineStyle: { color: T.axis, width: 1, type: "solid" }, data: [{ yAxis: 100 }] };
    var o = base();
    o.legend = legend();
    o.grid = { left: 4, right: 16, top: 40, bottom: 4, containLabel: true };
    o.xAxis = timeAxis();
    o.yAxis = valueAxis();
    o.tooltip = Object.assign(o.tooltip, axisTooltip(function (v) { return fmt(v, 1); }, true));
    o.series = series;
    draw("index", $(".chart", fig), o);
    tables["fig-index"] = function () {
      var idx = R.lastT - R.startT <= 400 * 864e5 ? range(R.i0, W.t.length - 1) : monthEnds(W.t, R.i0, W.t.length - 1);
      return { head: ["날짜"].concat(cols.map(function (c) { return NAME[c.code]; })),
        rows: idx.reverse().map(function (i) {
          return [W.d[i]].concat(cols.map(function (c) {
            var hit = c.data.filter(function (d) { return d[0] === W.t[i]; })[0]; return hit ? fmt(hit[1], 1) : "–";
          }));
        }) };
    };
  }
  function range(a, b) { var out = []; for (var i = a; i <= b; i++) out.push(i); return out; }

  function renderRollVol(R) {
    var fig = $("#fig-rollvol"), krw = [], med = [];
    for (var i = R.i0; i < W.t.length; i++) {
      if (W.roll.KRW[i] != null) krw.push([W.t[i], W.roll.KRW[i]]);
      if (W.rollMedian[i] != null) med.push([W.t[i], W.rollMedian[i]]);
    }
    var o = base();
    o.legend = legend();
    o.grid = { left: 4, right: 84, top: 40, bottom: 4, containLabel: true };
    o.xAxis = timeAxis();
    o.yAxis = valueAxis({ scale: false, min: 0, axisLabel: { color: T["axis-label"], fontSize: 11, formatter: function (v) { return v + "%"; } } });
    o.tooltip = Object.assign(o.tooltip, axisTooltip(function (v) { return fmt(v, 1) + "%"; }));
    o.series = [
      line("22개 통화 중앙값", med, T["axis-label"], { endLabel: endLabel(function (p) { return "중앙값 " + fmt(p.value[1], 1); }) }),
      line("한국 원", krw, T.s1, { endLabel: endLabel(function (p) { return "원 " + fmt(p.value[1], 1); }) })
    ];
    draw("rollvol", $(".chart", fig), o);
    tables["fig-rollvol"] = function () {
      return { head: ["날짜 (월말)", "한국 원", "22개 통화 중앙값"], rows: monthEnds(W.t, R.i0, W.t.length - 1).reverse().map(function (i) {
        return [W.d[i], fmt(W.roll.KRW[i], 2) + "%", fmt(W.rollMedian[i], 2) + "%"];
      }) };
    };
  }

  function renderDollar(R) {
    var fig = $("#fig-dollar"), X = D.dollar_index, t = X.dates.map(ts), from = t.findIndex(function (x) { return x >= R.startT; });
    if (from < 0) from = 0;
    var series = X.series.map(function (s, k) {
      var data = [];
      for (var i = from; i < t.length; i++) if (s.values[i] != null) data.push([t[i], s.values[i]]);
      return line(s.short + " · " + s.name, data, T["s" + (k + 1)], { endLabel: endLabel(function (p) { return s.short + " " + fmt(p.value[1], 1); }) });
    });
    var o = base();
    o.legend = legend();
    o.grid = { left: 4, right: 72, top: 40, bottom: 4, containLabel: true };
    o.xAxis = timeAxis();
    o.yAxis = valueAxis();
    o.tooltip = Object.assign(o.tooltip, axisTooltip(function (v) { return fmt(v, 2); }, true));
    o.series = series;
    draw("dollar", $(".chart", fig), o);
    tables["fig-dollar"] = function () {
      return { head: ["날짜 (월말)"].concat(X.series.map(function (s) { return s.short; })),
        rows: monthEnds(t, from, t.length - 1).reverse().map(function (i) {
          return [X.dates[i]].concat(X.series.map(function (s) { return fmt(s.values[i], 2); }));
        }) };
    };
  }

  function renderCross(R) {
    var fig = $("#fig-cross"), box = $(".multiples", fig);
    if (!box.children.length) {
      CROSSES.forEach(function (c, k) {
        var d = document.createElement("div");
        d.innerHTML = "<h4></h4><p class=\"m-val\"></p><div class=\"chart\" style=\"height:190px\"></div>";
        $("h4", d).textContent = c.label;
        box.appendChild(d);
      });
    }
    var all = [];
    CROSSES.forEach(function (c, k) {
      var cell = box.children[k], krw = W.p.KRW, x = W.p[c.code], data = [];
      for (var i = R.i0; i < W.t.length; i++) if (krw[i] != null && x[i] != null) data.push([W.t[i], (krw[i] / x[i]) * c.mult]);
      all.push(data);
      var first = data[0], last = data[data.length - 1];
      $(".m-val", cell).textContent = "최근 " + fmt(last[1], 2) + "원 · 기간 중 " + fmtPct((last[1] / first[1] - 1) * 100, 1);
      var el = $(".chart", cell);
      el.setAttribute("role", "img"); el.setAttribute("aria-label", c.label + " 주간 추이");
      var o = base();
      o.grid = { left: 2, right: 10, top: 10, bottom: 2, containLabel: true };
      o.xAxis = timeAxis();
      o.yAxis = valueAxis({ splitNumber: 3 });
      o.tooltip = Object.assign(o.tooltip, axisTooltip(function (v) { return fmt(v, 2) + "원"; }));
      o.series = [line(c.label, data, T.s1, { markPoint: { silent: true, animation: false, data: [{ coord: last, symbol: "circle", symbolSize: 8,
        itemStyle: { color: T.s1, borderColor: T.surface, borderWidth: 2 }, label: { show: false } }] } })];
      draw("cross-" + c.code, el, o);
    });
    tables["fig-cross"] = function () {
      var idx = monthEnds(W.t, R.i0, W.t.length - 1);
      return { head: ["날짜 (월말)"].concat(CROSSES.map(function (c) { return c.label; })),
        rows: idx.reverse().map(function (i) {
          return [W.d[i]].concat(CROSSES.map(function (c) {
            var a = W.p.KRW[i], b = W.p[c.code][i]; return a != null && b != null ? fmt(a / b * c.mult, 2) : "–";
          }));
        }) };
    };
  }

  function corr(a, b, from) {
    var xs = [], ys = [];
    for (var i = from; i < a.length; i++) if (a[i] != null && b[i] != null) { xs.push(a[i]); ys.push(b[i]); }
    if (xs.length < 10) return { r: null, n: xs.length };
    var mx = mean(xs), my = mean(ys), sxy = 0, sxx = 0, syy = 0;
    for (var k = 0; k < xs.length; k++) { var dx = xs[k] - mx, dy = ys[k] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return { r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : null, n: xs.length };
  }

  function renderCorr(R) {
    var fig = $("#fig-corr"), el = $(".chart", fig), codes = D.annual_change.codes, M = [], data = [];
    codes.forEach(function (a, i) {
      M.push([]);
      codes.forEach(function (b, j) {
        var c = j <= i ? corr(W.r[a], W.r[b], R.i0 + 1) : null;
        M[i].push(c);
        if (c && c.r != null) data.push([j, i, c.r, c.n]);
      });
    });
    var narrow = el.clientWidth < 720;
    var o = base();
    o.grid = { left: 4, right: 8, top: 4, bottom: 4, containLabel: true };
    o.xAxis = { type: "category", data: codes, position: "bottom", axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: T["text-2"], fontSize: 10.5, interval: 0, rotate: narrow ? 90 : 0 } };
    o.yAxis = { type: "category", data: codes, inverse: true, axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: T["text-2"], fontSize: 11, interval: 0,
        formatter: function (c) { return c === "KRW" ? "{b|KRW}" : c; }, rich: { b: { fontWeight: 700, color: T["text-1"], fontSize: 11 } } } };
    o.visualMap = { show: false, min: -1, max: 1, dimension: 2, inRange: { color: T.diverging } };
    o.tooltip = Object.assign(o.tooltip, { trigger: "item", formatter: function (p) {
      var a = codes[p.value[1]], b = codes[p.value[0]];
      return '<div class="tt-head">' + esc(NAME[a]) + " · " + esc(NAME[b]) + "</div>" + ttRow(p.color, fmt(p.value[2], 2), "상관계수, 관측 " + p.value[3] + "주");
    } });
    o.series = [{ type: "heatmap", data: data,
      itemStyle: { borderColor: T.surface, borderWidth: 2, borderRadius: 2 },
      emphasis: { itemStyle: { borderColor: T["text-1"], borderWidth: 1.5 } } }];
    draw("corr", el, o);
    scaleLegend("corr", "−1", "0", "+1");
    tables["fig-corr"] = function () {
      return { head: [""].concat(codes), rows: codes.map(function (a, i) {
        return [NAME[a] + " (" + a + ")"].concat(codes.map(function (b, j) {
          var c = j <= i ? M[i][j] : M[j][i]; return c && c.r != null ? fmt(c.r, 2) : "–";
        }));
      }) };
    };
  }

  /* ------------------------------------------------------------------ tables */
  function renderTable(fig) {
    var wrap = $(".table-wrap", fig), fn = tables[fig.id];
    if (!wrap || wrap.hidden || !fn) return;
    var spec = fn(), tbl = document.createElement("table"), thead = document.createElement("thead"), tr = document.createElement("tr");
    spec.head.forEach(function (h) { var th = document.createElement("th"); th.scope = "col"; th.textContent = h; tr.appendChild(th); });
    thead.appendChild(tr); tbl.appendChild(thead);
    var tb = document.createElement("tbody");
    spec.rows.forEach(function (r) {
      var row = document.createElement("tr");
      r.forEach(function (v, i) { var td = document.createElement(i === 0 ? "th" : "td"); if (i === 0) td.scope = "row"; td.textContent = v; row.appendChild(td); });
      tb.appendChild(row);
    });
    tbl.appendChild(tb);
    wrap.textContent = ""; wrap.appendChild(tbl);
  }
  function wireTables() {
    document.querySelectorAll("figure.fig").forEach(function (fig) {
      ariaLabel(fig);
      var btn = $(".tbl-btn", fig), wrap = $(".table-wrap", fig);
      if (!btn || !wrap) return;
      btn.addEventListener("click", function () {
        var open = wrap.hidden;
        wrap.hidden = !open;
        btn.setAttribute("aria-expanded", String(open));
        btn.textContent = open ? "표 숨기기" : "표 보기";
        if (open) renderTable(fig);
      });
    });
  }
  function refreshOpenTables() { document.querySelectorAll("figure.fig").forEach(renderTable); }

  /* ------------------------------------------------------------------ controls */
  function segmented(container, items, key) {
    container.textContent = "";
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "radio"); b.textContent = it.label;
      b.setAttribute("aria-checked", String(state[key] === it.id));
      b.addEventListener("click", function () {
        if (state[key] === it.id) return;
        state[key] = it.id;
        container.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-checked", String(x === b)); });
        renderWindowed();
      });
      container.appendChild(b);
    });
  }

  function renderWindowed() {
    R = windowRange();
    var n = W.t.length - R.i0;
    $("#window-note").textContent = "선택 기간 " + dstr(R.startT) + " ~ " + dstr(R.lastT) + " · 주간 자료 " + n + "주 · 위의 기간과 통화 묶음 선택이 이 아래 모든 차트에 적용됩니다.";
    renderKrw(R); renderPerf(R); renderVol(R); renderIndex(R); renderRollVol(R); renderDollar(R); renderCross(R); renderCorr(R);
    refreshOpenTables();
  }
  function renderAll() {
    readTokens();
    renderKpis(); renderAnnual(); renderHeat();
    renderWindowed();
    $("#theme-btn").textContent = isDark() ? "라이트 모드" : "다크 모드";
  }

  function setupTheme() {
    $("#theme-btn").addEventListener("click", function () {
      var next = isDark() ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("fx-theme", next); } catch (e) {}
      renderAll();
    });
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function () { if (!document.documentElement.dataset.theme) renderAll(); };
      if (mq.addEventListener) mq.addEventListener("change", onChange); else if (mq.addListener) mq.addListener(onChange);
    }
  }

  function downloads() {
    var ul = $("#downloads");
    DOWNLOADS.forEach(function (d) {
      var li = document.createElement("li"), a = document.createElement("a");
      a.href = RAW + d[0]; a.textContent = d[0];
      li.appendChild(a); li.appendChild(document.createTextNode(" · " + d[1]));
      ul.appendChild(li);
    });
  }

  /* ------------------------------------------------------------------ boot */
  fetch("data/dashboard.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (json) {
      D = json;
      prepare();
      var app = $("#app");
      app.textContent = "";
      app.appendChild($("#tpl-main").content.cloneNode(true));
      $("#asof").textContent = D.meta.last_observation;
      $("#updated").textContent = "자료 갱신 " + (D.meta.data_updated_utc || "").replace("T", " ").replace("Z", " UTC") + " · 최근 관측일 " + D.meta.last_observation;
      segmented($("#seg-window"), WINDOWS, "win");
      segmented($("#seg-group"), D.groups.map(function (g) { return { id: g.id, label: g.label }; }), "group");
      downloads();
      wireTables();
      setupTheme();
      renderAll();
      var timer;
      window.addEventListener("resize", function () {
        clearTimeout(timer);
        timer = setTimeout(function () { renderHeat(); renderCorr(R); }, 200);
      });
    })
    .catch(function (e) {
      $("#app").innerHTML = '<p class="loading">자료를 불러오지 못했습니다 (' + esc(e.message || e) + "). 잠시 후 다시 시도해 주세요.</p>";
    });
})();
