// /api/stock?symbol=^IXIC&interval=1|15|60|240|D
// 야후 파이낸스에서 나스닥 지수·미국 주식 봉 데이터를 가져옵니다.
// (야후의 비공식 무료 데이터라 가끔 막히거나 지연될 수 있어요.)

const MAP = {
  "1":   { interval: "1m",  range: "1d",  prepost: true },
  "15":  { interval: "15m", range: "5d",  prepost: true },
  "60":  { interval: "60m", range: "1mo", prepost: false },
  "240": { interval: "60m", range: "6mo", prepost: false, group: 4 },
  "D":   { interval: "1d",  range: "1y",  prepost: false },
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function yahoo(symbol, interval, range, prepost) {
  const qs = `interval=${interval}&range=${range}&includePrePost=${prepost ? "true" : "false"}`;
  let lastErr;
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${qs}`, {
        headers: { "User-Agent": UA, accept: "application/json" },
      });
      if (!r.ok) throw new Error("yahoo " + r.status);
      const j = await r.json();
      const res = j && j.chart && j.chart.result && j.chart.result[0];
      if (!res) throw new Error("no_result");
      return res;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

export function toCandles(res) {
  const ts = res.timestamp || [];
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if ([o, h, l, c].some((v) => v == null || Number.isNaN(v))) continue;
    out.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: q.volume?.[i] || 0 });
  }
  return out;
}

// 1시간봉 4개를 묶어 4시간봉 만들기
export function group(candles, n) {
  const size = 3600 * n, out = [];
  for (const c of candles) {
    const t = Math.floor(c.time / size) * size;
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else out.push({ ...c, time: t });
  }
  return out;
}

// 전일(직전 거래일) 종가 찾기
export function prevCloseFrom(daily, meta) {
  const d = toCandles(daily);
  if (!d.length) return meta.chartPreviousClose ?? null;
  const off = meta.gmtoffset || 0;
  const day = (t) => Math.floor((t + off) / 86400);
  const lastDay = day(d[d.length - 1].time);
  const nowDay = day(meta.regularMarketTime || d[d.length - 1].time);
  if (lastDay === nowDay && d.length >= 2) return d[d.length - 2].close;
  return d[d.length - 1].close;
}

function marketState(meta) {
  const p = meta.currentTradingPeriod;
  if (meta.instrumentType === "FUTURE") return "선물";
  if (!p) return "";
  const now = Math.floor(Date.now() / 1000);
  const inR = (x) => x && now >= x.start && now < x.end;
  if (inR(p.regular)) return "정규장";
  if (inR(p.pre)) return "프리마켓";
  if (inR(p.post)) return "애프터마켓";
  return "장 마감";
}

export default async function handler(req, res) {
  const q = req.query || {};
  const symbol = String(q.symbol || "^IXIC").toUpperCase();
  const key = String(q.interval || "1").toUpperCase();
  const cfg = MAP[key];
  if (!/^[A-Z0-9.^=\-]{1,15}$/.test(symbol) || !cfg) {
    res.status(400).json({ error: "bad_params", candles: [] });
    return;
  }
  try {
    const [main, daily] = await Promise.all([
      yahoo(symbol, cfg.interval, cfg.range, cfg.prepost),
      yahoo(symbol, "1d", "5d", false).catch(() => null),
    ]);
    let candles = toCandles(main);
    if (cfg.group) candles = group(candles, cfg.group);
    const meta = main.meta || {};
    const price = meta.regularMarketPrice ?? (candles.length ? candles[candles.length - 1].close : null);
    const prevClose = daily ? prevCloseFrom(daily, daily.meta || meta) : (meta.chartPreviousClose ?? null);
    // 프리/애프터마켓 가격이 더 최신이면 그 가격을 사용
    const lastBar = candles[candles.length - 1];
    const live = lastBar && lastBar.time > (meta.regularMarketTime || 0) ? lastBar.close : price;
    res.setHeader("Cache-Control", key === "1" ? "s-maxage=10, stale-while-revalidate=30" : "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({
      symbol,
      name: meta.shortName || meta.longName || symbol,
      currency: meta.currency || "USD",
      price: live,
      prevClose,
      state: marketState(meta),
      candles,
    });
  } catch (e) {
    res.status(502).json({ error: "stock_fetch_failed", candles: [] });
  }
}
