// /api/candles — 업비트 비트코인 5분봉 120개(약 10시간)를 가져옵니다.
// 1분 동안 캐시합니다.

export default async function handler(req, res) {
  try {
    const r = await fetch("https://api.upbit.com/v1/candles/minutes/5?market=KRW-BTC&count=120", {
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error("upbit " + r.status);
    const data = await r.json();
    const candles = data
      .map((c) => ({ t: Date.parse(c.candle_date_time_utc + "Z"), c: c.trade_price }))
      .sort((a, b) => a.t - b.t);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json({ candles });
  } catch (e) {
    res.status(502).json({ candles: [], error: "candles_fetch_failed" });
  }
}
