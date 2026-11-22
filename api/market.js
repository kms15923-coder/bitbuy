// /api/market — 매매 판단용 보조 지표 묶음 (2분 캐시)
//   fng       공포·탐욕 지수 (alternative.me)
//   dominance 비트코인 도미넌스 % (CoinGecko → 실패 시 CoinPaprika)
//   usdkrw    원/달러 환율 (야후 파이낸스 KRW=X)
//   ls        BTC 롱/숏 계정 비율 (바이비트 → 실패 시 바이낸스 선물)
// 하나가 실패해도 나머지는 그대로 돌려줘요.

import { yahoo } from "./stock.js";

const T = (p, ms = 6000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);
async function getJSON(url) {
  const r = await T(fetch(url, { headers: { accept: "application/json", "User-Agent": "Mozilla/5.0 BitbuyBot" } }));
  if (!r.ok) throw new Error(url.split("?")[0] + " " + r.status);
  return r.json();
}
const FNG_KO = { "Extreme Fear": "극단적 공포", Fear: "공포", Neutral: "중립", Greed: "탐욕", "Extreme Greed": "극단적 탐욕" };

async function fng() {
  const j = await getJSON("https://api.alternative.me/fng/?limit=2");
  const [a, b] = j.data || [];
  if (!a) throw new Error("fng empty");
  return { value: +a.value, label: FNG_KO[a.value_classification] || a.value_classification, prev: b ? +b.value : null };
}
async function dominance() {
  try {
    const j = await getJSON("https://api.coingecko.com/api/v3/global");
    const v = j.data && j.data.market_cap_percentage && j.data.market_cap_percentage.btc;
    if (v) return { btc: +v, eth: +(j.data.market_cap_percentage.eth || 0), src: "CoinGecko" };
  } catch (_) {}
  const j = await getJSON("https://api.coinpaprika.com/v1/global");
  return { btc: +j.bitcoin_dominance_percentage, eth: null, src: "CoinPaprika" };
}
async function usdkrw() {
  const r = await T(yahoo("KRW=X", "1d", "5d", false));
  const m = r.meta || {};
  return { price: m.regularMarketPrice, prev: m.chartPreviousClose ?? null };
}
async function longShort() {
  for (const host of ["api.bybit.com", "api.bytick.com"]) {
    try {
      const j = await getJSON(`https://${host}/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1`);
      const x = j.result && j.result.list && j.result.list[0];
      if (x) return { long: +x.buyRatio, short: +x.sellRatio, src: "바이비트" };
    } catch (_) {}
  }
  const j = await getJSON("https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1");
  const x = j[0];
  if (!x) throw new Error("ls empty");
  return { long: +x.longAccount, short: +x.shortAccount, src: "바이낸스" };
}

export default async function handler(req, res) {
  const [a, b, c, d] = await Promise.allSettled([fng(), dominance(), usdkrw(), longShort()]);
  const v = (x) => (x.status === "fulfilled" ? x.value : null);
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
  res.status(200).json({ fng: v(a), dominance: v(b), usdkrw: v(c), ls: v(d), at: new Date().toISOString() });
}
