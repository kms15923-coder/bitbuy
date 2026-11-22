// /api/candles?market=KRW-BTC&unit=1|15|60|240|D
// 업비트 원화 마켓 봉(캔들) 200개를 가져옵니다.

const UNITS = { "1": "minutes/1", "15": "minutes/15", "60": "minutes/60", "240": "minutes/240", "D": "days" };

export function mapUpbit(data) {
  return data
    .map((c) => ({
      time: Math.floor(Date.parse(c.candle_date_time_utc + "Z") / 1000),
      open: c.opening_price,
      high: c.high_price,
      low: c.low_price,
      close: c.trade_price,
      volume: c.candle_acc_trade_volume,
    }))
    .sort((a, b) => a.time - b.time);
}

export default async function handler(req, res) {
  const q = req.query || {};
  const market = String(q.market || "KRW-BTC").toUpperCase();
  const unit = String(q.unit || "1").toUpperCase();
  if (!/^KRW-[A-Z0-9]{1,12}$/.test(market) || !UNITS[unit]) {
    res.status(400).json({ candles: [], error: "bad_params" });
    return;
  }
  try {
    const r = await fetch(`https://api.upbit.com/v1/candles/${UNITS[unit]}?market=${market}&count=200`, {
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error("upbit " + r.status);
    const candles = mapUpbit(await r.json());
    res.setHeader("Cache-Control", unit === "1" ? "s-maxage=5, stale-while-revalidate=30" : "s-maxage=30, stale-while-revalidate=120");
    res.status(200).json({ candles });
  } catch (e) {
    res.status(502).json({ candles: [], error: "candles_fetch_failed" });
  }
}
