// /api/bot?secret=…  — 비트바이봇
// Supabase 예약 실행(pg_cron)이 10분마다 이 주소를 부릅니다.
// 한 번 실행될 때마다 시세·뉴스를 확인해서 필요한 글과 댓글을 올려요.
//   · 정시 브리핑 (매시간)
//   · 아침 리포트 (09:00) / 미국장 개장 리포트 (23:30)
//   · 급등락 속보 (코인이 1시간에 ±5% 이상 움직이면)
//   · 뉴스 토론 글 (30분마다 새 기사 1건, 제목+원문 링크만)
//   · 댓글: 회원 글에 "작성 시점 시세", 봇 글에 "1시간 뒤 업데이트"
// 같은 글이 두 번 올라가지 않도록 글마다 고유 키(bot_key)를 붙여요.
// 글쓰기는 비밀키를 아는 경우에만 되도록 DB 함수(bot_post, bot_comment)가 막고 있어요.

import { parseRss, FEEDS } from "./news.js";
import { yahoo } from "./stock.js";

const COINS = [
  ["BTC", "비트코인"], ["ETH", "이더리움"], ["XRP", "리플"], ["SOL", "솔라나"],
  ["DOGE", "도지코인"], ["ADA", "에이다"], ["SUI", "수이"], ["LINK", "체인링크"],
];
const NAME = Object.fromEntries(COINS);
const SURGE_PCT = 5;
const BOT_NAME = "비트바이봇";

// ---------- 도우미 ----------
const withTimeout = (p, ms = 7000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);
async function getJSON(url, opt = {}) {
  const r = await withTimeout(fetch(url, { headers: { accept: "application/json", ...(opt.headers || {}) }, ...opt }));
  if (!r.ok) throw new Error(url.split("?")[0] + " " + r.status);
  return r.json();
}
const sign = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + "%";
const arrow = (x) => (x > 0 ? "🔺" : x < 0 ? "🔻" : "▪️");
function won(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1e8) { const e = Math.floor(n / 1e8), m = Math.round((n % 1e8) / 1e4); return `${e}억${m ? " " + m.toLocaleString("ko-KR") + "만" : ""}`; }
  if (n >= 1e6) return Math.round(n / 1e4).toLocaleString("ko-KR") + "만";
  if (n >= 100) return Math.round(n).toLocaleString("ko-KR");
  return n.toLocaleString("ko-KR", { maximumFractionDigits: n >= 1 ? 2 : 4 });
}
const num = (n, dp = 2) => (n == null || !isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
function kstParts(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (x) => String(x).padStart(2, "0");
  return { y: k.getUTCFullYear(), mo: p(k.getUTCMonth() + 1), d: p(k.getUTCDate()), h: k.getUTCHours(), mi: k.getUTCMinutes(), hh: p(k.getUTCHours()), mm: p(k.getUTCMinutes()) };
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

// ---------- Supabase 연결 (사이트의 config.js에서 주소와 공개키를 읽음) ----------
async function supaConfig(host) {
  const r = await withTimeout(fetch(`https://${host}/config.js`));
  const t = await r.text();
  const url = (t.match(/SUPABASE_URL\s*:\s*"([^"]+)"/) || [])[1];
  const key = (t.match(/SUPABASE_ANON_KEY\s*:\s*"([^"]+)"/) || [])[1];
  if (!url || !key) throw new Error("config.js 읽기 실패");
  return { url, key };
}
function supa(cfg) {
  const h = { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" };
  return {
    async rpc(fn, args) {
      const r = await withTimeout(fetch(`${cfg.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: h, body: JSON.stringify(args) }));
      const t = await r.text();
      if (!r.ok) throw new Error(`${fn}: ${r.status} ${t.slice(0, 200)}`);
      return t ? JSON.parse(t) : null;
    },
    async select(table, qs) {
      const r = await withTimeout(fetch(`${cfg.url}/rest/v1/${table}?${qs}`, { headers: h }));
      if (!r.ok) throw new Error(`${table}: ${r.status}`);
      return r.json();
    },
  };
}

// ---------- 시세 모으기 ----------
async function gatherMarket() {
  const m = { coins: {}, usdt: null, stocks: {} };
  const tasks = [];
  // 업비트 원화 시세
  tasks.push(getJSON("https://api.upbit.com/v1/ticker?markets=" + COINS.map(([s]) => "KRW-" + s).concat("KRW-USDT").join(",")).then((list) => {
    for (const t of list) {
      const sym = t.market.slice(4);
      if (sym === "USDT") m.usdt = t.trade_price;
      else m.coins[sym] = { ...(m.coins[sym] || {}), krw: t.trade_price, day: t.signed_change_rate };
    }
  }).catch(() => {}));
  // 업비트 5분봉 13개 → 1시간 변동
  for (const [sym] of COINS) {
    tasks.push(getJSON(`https://api.upbit.com/v1/candles/minutes/5?market=KRW-${sym}&count=13`).then((c) => {
      if (Array.isArray(c) && c.length >= 13) m.coins[sym] = { ...(m.coins[sym] || {}), h1base: c[12].trade_price, h1now: c[0].trade_price };
    }).catch(() => {}));
  }
  // 바이비트 달러 시세 (막히면 건너뜀)
  tasks.push((async () => {
    for (const host of ["api.bybit.com", "api.bytick.com"]) {
      try {
        const j = await getJSON(`https://${host}/v5/market/tickers?category=linear`);
        for (const t of (j.result && j.result.list) || []) {
          const sym = t.symbol.replace(/USDT$/, "");
          if (NAME[sym] && t.symbol.endsWith("USDT")) m.coins[sym] = { ...(m.coins[sym] || {}), usd: +t.lastPrice, usd24: +t.price24hPcnt };
        }
        return;
      } catch (_) {}
    }
  })());
  // 주식 지수
  for (const sym of ["NQ=F", "^IXIC", "^KS11"]) {
    tasks.push(withTimeout(yahoo(sym, "5m", "1d", false)).then((r) => {
      const meta = r.meta || {};
      const price = meta.regularMarketPrice, prev = meta.chartPreviousClose ?? meta.previousClose;
      if (price != null) m.stocks[sym] = { price, prev, chg: prev ? price / prev - 1 : null };
    }).catch(() => {}));
  }
  await Promise.all(tasks);
  for (const c of Object.values(m.coins)) {
    if (c.h1base && c.krw) c.h1 = c.krw / c.h1base - 1;
    if (c.krw && c.usd && m.usdt) c.kimp = c.krw / (c.usd * m.usdt) - 1;
  }
  return m;
}

function marketLines(m, { withStocks = true } = {}) {
  const L = [];
  for (const [sym, nm] of COINS) {
    const c = m.coins[sym]; if (!c || !c.krw) continue;
    L.push(`${arrow(c.day)} ${nm} ₩${won(c.krw)}  (전일 ${sign(c.day)}${c.h1 != null ? ` · 1시간 ${sign(c.h1)}` : ""})`);
  }
  const b = m.coins.BTC || {};
  if (b.usd) L.push(`💵 바이비트 BTC $${num(b.usd, 0)}${b.kimp != null ? ` · 김프 ${sign(b.kimp)}` : ""}`);
  if (withStocks) {
    const S = [["NQ=F", "나스닥 선물"], ["^IXIC", "나스닥"], ["^KS11", "코스피"]];
    const s = S.filter(([k]) => m.stocks[k]).map(([k, nm]) => `${nm} ${num(m.stocks[k].price)} (${m.stocks[k].chg != null ? sign(m.stocks[k].chg) : "—"})`);
    if (s.length) L.push("📈 " + s.join(" · "));
  }
  return L;
}
function movers(m) {
  const arr = COINS.map(([s, nm]) => ({ s, nm, ...(m.coins[s] || {}) })).filter((c) => c.day != null);
  arr.sort((a, b) => b.day - a.day);
  return { top: arr.slice(0, 3), bottom: arr.slice(-3).reverse() };
}
const DISCLAIMER = "\n\n※ 비트바이봇이 자동으로 작성한 글입니다. 투자 권유가 아니며, 시세는 작성 시점 기준입니다.";

// ---------- 채팅 급등락 알림 (1분마다 실행) ----------
// 1분 / 5분 사이에 아래 % 이상 움직이면 채팅창에 시스템 메시지
const CHAT_TH = { BTC: 0.8, ETH: 1.2 }; const CHAT_TH_DEFAULT = 2.0; // 1분 기준(%), 5분은 2배
async function chatSurge(chatPost) {
  const t = kstParts();
  const bucket = `${t.y}${t.mo}${t.d}${t.hh}${String(Math.floor(t.mi / 10))}`; // 같은 코인·방향은 10분에 1번만
  const results = await Promise.all(COINS.map(async ([sym, nm]) => {
    try {
      const c = await getJSON(`https://api.upbit.com/v1/candles/minutes/1?market=KRW-${sym}&count=6`);
      if (!Array.isArray(c) || c.length < 6) return null;
      const now = c[0].trade_price;
      const m1 = now / c[1].trade_price - 1, m5 = now / c[5].trade_price - 1;
      const th = (CHAT_TH[sym] || CHAT_TH_DEFAULT) / 100;
      let hit = null;
      if (Math.abs(m1) >= th) hit = { win: "1분", ch: m1 };
      else if (Math.abs(m5) >= th * 2) hit = { win: "5분", ch: m5 };
      if (!hit) return null;
      const up = hit.ch > 0;
      const body = `⚡ ${nm} ${hit.win} 만에 ${sign(hit.ch)} ${up ? "급등" : "급락"}! ₩${won(now)}`;
      return chatPost(`cs-${sym}-${up ? "u" : "d"}-${bucket}`, body);
    } catch (_) { return null; }
  }));
  return results.filter(Boolean);
}

// ---------- 메인 ----------
export default async function handler(req, res) {
  const q = req.query || {};
  const secret = String(q.secret || "");
  const first = q.first === "1"; // 설정 직후 첫 실행: 시간과 상관없이 브리핑·뉴스 1건씩
  const out = { posted: [], commented: [], skipped: [], errors: [] };
  if (!secret) { res.status(401).json({ error: "secret 필요" }); return; }

  let db;
  try { db = supa(await supaConfig(req.headers.host)); } catch (e) { res.status(500).json({ error: String(e.message) }); return; }

  const post = async (key, cat, title, body, meta) => {
    try {
      const id = await db.rpc("bot_post", { p_secret: secret, p_key: key, p_cat: cat, p_title: title.slice(0, 80), p_body: (body + DISCLAIMER).slice(0, 5000), p_meta: meta || null });
      if (id) out.posted.push(key); else out.skipped.push(key);
      return id;
    } catch (e) { out.errors.push(String(e.message)); return null; }
  };
  const comment = async (key, postId, body) => {
    try {
      const id = await db.rpc("bot_comment", { p_secret: secret, p_key: key, p_post: postId, p_body: body.slice(0, 500) });
      if (id) out.commented.push(key); else out.skipped.push(key);
    } catch (e) { out.errors.push(String(e.message)); }
  };

  const chatPost = async (key, body) => {
    try {
      const id = await db.rpc("bot_chat", { p_secret: secret, p_key: key, p_body: body.slice(0, 300) });
      if (id) { (out.chatted = out.chatted || []).push(key); return key; }
      out.skipped.push(key); return null;
    } catch (e) { out.errors.push(String(e.message)); return null; }
  };
  if (q.mode === "chat") {
    await chatSurge(chatPost);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(out);
    return;
  }

  const t = kstParts();
  const ymd = `${t.y}${t.mo}${t.d}`, ymdh = `${ymd}${t.hh}`;
  const m = await gatherMarket();
  const btc = m.coins.BTC || {};
  const metaBtc = btc.krw ? { sym: "BTC", price: btc.krw } : null;

  // 1) 아침 리포트 09:00 / 미국장 개장 리포트 23:30
  if (t.h === 9 && t.mi < 20 && btc.krw) {
    const mv = movers(m);
    const body = [
      `☀️ ${t.mo}월 ${t.d}일 아침 시장 정리`, "",
      ...marketLines(m), "",
      "🔥 전일 대비 상승 TOP3: " + mv.top.map((c) => `${c.nm} ${sign(c.day)}`).join(", "),
      "🧊 전일 대비 하락 TOP3: " + mv.bottom.map((c) => `${c.nm} ${sign(c.day)}`).join(", "), "",
      "오늘 비트코인 방향, 어떻게 보세요? 댓글로 예상 남겨 주세요 👇",
    ].join("\n");
    await post(`morning-${ymd}`, "시황분석", `[아침 리포트] ${t.mo}/${t.d} BTC ₩${won(btc.krw)} (${sign(btc.day)})`, body, metaBtc);
  }
  if (t.h === 23 && t.mi >= 30 && t.mi < 50 && btc.krw) {
    const nq = m.stocks["NQ=F"];
    const body = [
      "🇺🇸 미국 정규장 개장 (한국시간 23:30)", "",
      ...marketLines(m), "",
      nq ? `나스닥 선물은 전일 대비 ${nq.chg != null ? sign(nq.chg) : "—"}로 출발합니다.` : "",
      "미국장 개장 후 코인 변동성이 커질 수 있어요. 오늘 밤 전략 공유해 주세요 🌙",
    ].filter((x) => x !== "").join("\n");
    await post(`evening-${ymd}`, "시황분석", `[미국장 개장] BTC ₩${won(btc.krw)} · 나스닥선물 ${nq && nq.chg != null ? sign(nq.chg) : "—"}`, body, metaBtc);
  }

  // 2) 정시 브리핑 (09시는 아침 리포트로 대신)
  if ((t.mi < 20 || first) && (t.h !== 9 || first) && btc.krw) {
    const body = [`⏰ ${t.hh}시 정시 브리핑`, "", ...marketLines(m)].join("\n");
    const bid = await post(`brief-${ymdh}`, "시황분석", `[정시 브리핑] ${t.hh}시 · BTC ₩${won(btc.krw)} (${sign(btc.day)})`, body, metaBtc);
    if (bid) await chatPost(`chatbrief-${ymdh}`, `📊 ${t.hh}시 정시 브리핑 · BTC ₩${won(btc.krw)} (${sign(btc.day)})${btc.kimp != null ? " · 김프 " + sign(btc.kimp) : ""} — 게시판에서 자세히 보기`);
  }

  // 3) 급등락 속보 (1시간 ±5%)
  for (const [sym, nm] of COINS) {
    const c = m.coins[sym];
    if (!c || c.h1 == null || Math.abs(c.h1) < SURGE_PCT / 100) continue;
    const up = c.h1 > 0;
    const body = [
      `${up ? "🚀" : "⚠️"} ${nm}(${sym})이(가) 최근 1시간 동안 ${sign(c.h1)} ${up ? "급등" : "급락"}했습니다.`, "",
      `현재가 ₩${won(c.krw)} (1시간 전 ₩${won(c.h1base)})`,
      `전일 대비 ${sign(c.day)}${c.usd ? ` · 바이비트 $${num(c.usd, c.usd >= 1 ? 2 : 4)}` : ""}${c.kimp != null ? ` · 김프 ${sign(c.kimp)}` : ""}`, "",
      `${up ? "추격 매수 vs 차익 실현" : "저점 매수 vs 추가 하락"}, 여러분 생각은? 👇`,
    ].join("\n");
    const sid = await post(`surge-${sym}-${up ? "u" : "d"}-${ymdh}`, "시황분석", `[속보] ${nm} 1시간 ${sign(c.h1)} ${up ? "급등" : "급락"} · ₩${won(c.krw)}`, body, { sym, price: c.krw });
    if (sid) await chatPost(`chatsurge-${sym}-${up ? "u" : "d"}-${ymdh}`, `${up ? "🚀" : "⚠️"} [속보] ${nm} 1시간 ${sign(c.h1)} ${up ? "급등" : "급락"} — 게시판에 토론 글이 올라왔어요`);
  }

  // 4) 뉴스 토론 (30분마다 새 기사 1건)
  if (t.mi % 30 < 10 || first) {
    try {
      const r = await withTimeout(fetch(FEEDS[0], { headers: { "User-Agent": "Mozilla/5.0 BitbuyBot" } }));
      const items = parseRss(await r.text()).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 6);
      for (const n of items) {
        const body = [
          `📰 ${n.source || "뉴스"}${n.date ? " · " + kstParts(new Date(n.date)).mo + "/" + kstParts(new Date(n.date)).d + " " + kstParts(new Date(n.date)).hh + ":" + kstParts(new Date(n.date)).mm : ""}`,
          n.link, "",
          btc.krw ? `현재 BTC ₩${won(btc.krw)} (전일 ${sign(btc.day)})` : "",
          "", "이 뉴스, 호재일까요 악재일까요? 의견 남겨 주세요 👇",
        ].join("\n");
        const id = await post(`news-${hash(n.link)}`, "뉴스토론", `[뉴스토론] ${n.title}`, body, metaBtc);
        if (id) break; // 한 번에 1건만
      }
    } catch (e) { out.errors.push("news: " + e.message); }
  }

  // 5) 댓글
  try {
    const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    // 5-a) 회원 글: 작성 시점 시세
    const userPosts = await db.select("posts", `select=id&is_bot=eq.false&created_at=gte.${since}&order=created_at.desc&limit=15`);
    const snap = marketLines(m, { withStocks: false }).slice(0, 4).join("\n");
    if (snap) for (const p of userPosts) await comment(`csnap-${p.id}`, p.id, `📊 글 작성 무렵 시세\n${snap}`);

    // 5-b) 봇 글: 1시간 뒤 업데이트
    const from = new Date(Date.now() - 4 * 3600 * 1000).toISOString(), to = new Date(Date.now() - 55 * 60 * 1000).toISOString();
    const botPosts = await db.select("posts", `select=id,meta&is_bot=eq.true&created_at=gte.${from}&created_at=lte.${to}&order=created_at.desc&limit=20`);
    for (const p of botPosts) {
      const meta = p.meta || {};
      const c = m.coins[meta.sym];
      if (!c || !c.krw || !meta.price) continue;
      const ch = c.krw / meta.price - 1;
      await comment(`cfollow-${p.id}`, p.id, `⏱ 1시간 뒤 업데이트: ${NAME[meta.sym] || meta.sym} ₩${won(c.krw)} (글 작성 때 ₩${won(meta.price)} 대비 ${sign(ch)} ${arrow(ch)})`);
    }
  } catch (e) { out.errors.push("comments: " + e.message); }

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ at: `${t.y}-${t.mo}-${t.d} ${t.hh}:${t.mm} KST`, ...out });
}
