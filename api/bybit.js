// /api/bybit?category=linear&symbol=BTCUSDT&interval=1&limit=200
// 바이비트 봉 데이터 중계. 브라우저에서 바이비트로 바로 연결이 안 될 때만 쓰입니다.
// 바이비트는 미국 IP를 막기 때문에 vercel.json에서 서버 위치를 서울(icn1)로 정해 두었어요.

const IVS = new Set(["1", "3", "5", "15", "30", "60", "120", "240", "360", "720", "D", "W", "M"]);

export default async function handler(req, res) {
  const q = req.query || {};
  const category = String(q.category || "linear");
  const symbol = String(q.symbol || "BTCUSDT").toUpperCase();
  const interval = String(q.interval || "1").toUpperCase();
  const limit = Math.min(1000, Math.max(1, parseInt(q.limit || "200", 10) || 200));
  if (!["linear", "spot", "inverse"].includes(category) || !/^[A-Z0-9]{2,20}$/.test(symbol) || !IVS.has(interval)) {
    res.status(400).json({ retCode: -1, retMsg: "bad_params" });
    return;
  }
  const qs = `category=${category}&symbol=${symbol}&interval=${interval}&limit=${limit}`;
  let lastErr;
  for (const host of ["api.bybit.com", "api.bytick.com"]) {
    try {
      const r = await fetch(`https://${host}/v5/market/kline?${qs}`, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(host + " " + r.status);
      const j = await r.json();
      res.setHeader("Cache-Control", interval === "1" ? "s-maxage=5, stale-while-revalidate=30" : "s-maxage=30, stale-while-revalidate=120");
      res.status(200).json(j);
      return;
    } catch (e) { lastErr = e; }
  }
  res.status(502).json({ retCode: -1, retMsg: "bybit_fetch_failed", detail: String(lastErr && lastErr.message) });
}
