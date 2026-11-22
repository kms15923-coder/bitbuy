// 비트바이 — 화면 동작 코드
(() => {
  "use strict";

  // ---------- 공통 도우미 ----------
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // 사용자 입력은 항상 textContent로 (XSS 방지)
    return e;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };
  const fmt = (n, dp) => n == null || !isFinite(n) ? "—" : n.toLocaleString("ko-KR", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const krwDp = (p) => p >= 1000 ? 0 : p >= 100 ? 1 : p >= 1 ? 2 : 4;
  const krw = (n) => n == null ? "—" : fmt(n, krwDp(n));
  const usd = (n) => n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: n >= 1000 ? 2 : n >= 1 ? 2 : 4, maximumFractionDigits: n >= 1000 ? 2 : n >= 1 ? 2 : 4 });
  const pct = (r) => r == null || !isFinite(r) ? "—" : (r >= 0 ? "+" : "") + (r * 100).toFixed(2) + "%";
  const cls = (r) => r == null ? "" : r > 0 ? "up" : r < 0 ? "down" : "";
  const ago = (iso) => {
    const ts = typeof iso === "number" ? iso : Date.parse(iso);
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return "방금";
    if (s < 3600) return Math.floor(s / 60) + "분 전";
    if (s < 86400) return Math.floor(s / 3600) + "시간 전";
    const d = new Date(ts); return (d.getMonth() + 1) + "/" + d.getDate();
  };
  const hhmm = (iso) => { const d = new Date(iso); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  const hhmmss = (ts) => { const d = new Date(ts); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, "0")).join(":"); };

  const KST = 9 * 3600; // 차트 시간을 한국 시간으로 보이게
  const IVS = [["1", "1분"], ["15", "15분"], ["60", "1시간"], ["240", "4시간"], ["D", "일"]];
  const IV_SEC = { "1": 60, "15": 900, "60": 3600, "240": 14400, "D": 86400 };
  const IV_NAME = Object.fromEntries(IVS);

  const COINS = [
    ["BTC", "비트코인"], ["ETH", "이더리움"], ["XRP", "리플"], ["SOL", "솔라나"],
    ["DOGE", "도지코인"], ["ADA", "에이다"], ["SUI", "수이"], ["LINK", "체인링크"],
  ];
  const COIN_NAME = Object.fromEntries(COINS);
  const STOCKS = [
    ["^IXIC", "나스닥"], ["NQ=F", "나스닥 선물"], ["NVDA", "엔비디아"], ["TSLA", "테슬라"],
    ["AAPL", "애플"], ["MSFT", "마이크로소프트"], ["AMZN", "아마존"], ["GOOGL", "구글"],
    ["META", "메타"], ["COIN", "코인베이스"], ["MSTR", "스트래티지"],
  ];
  const STOCK_NAME = Object.fromEntries(STOCKS);

  // =====================================================
  //  급등락 알림 (소리 · 음성 · 화면)
  // =====================================================
  const ALL_TH = [1, 2, 5, 10, 15, 20, 25, 30];
  const S = Object.assign({
    th: ALL_TH.slice(), ref: "bar", targets: { coin: true, stock: true }, voice: true, vol: 85, vvol: 100, soundOn: false,
  }, store.get("bitbuy.alerts", {}));
  S.soundOn = false; // 브라우저 정책상 매번 클릭으로 켜야 함
  const saveS = () => store.set("bitbuy.alerts", { th: S.th, ref: S.ref, targets: S.targets, voice: S.voice, vol: S.vol, vvol: S.vvol });

  // 소리 출력: 오실레이터 → 압축기(찢어지지 않게 크게) → 마스터 볼륨
  let audio = null, master = null;
  function ensureAudio() {
    if (!audio) {
      try {
        audio = new (window.AudioContext || window.webkitAudioContext)();
        const comp = audio.createDynamicsCompressor();
        comp.threshold.value = -18; comp.knee.value = 6; comp.ratio.value = 8;
        comp.attack.value = 0.002; comp.release.value = 0.12;
        master = audio.createGain();
        comp.connect(master).connect(audio.destination);
        master._in = comp;
      } catch (_) { audio = null; }
    }
    if (audio && audio.state === "suspended") audio.resume();
    if (master) master.gain.value = (S.vol / 100) * 3; // 최대 3배 증폭
    return audio;
  }
  function beep(freq, start, dur) {
    if (!audio) return;
    // 사각파 + 톱니파를 겹쳐 경보음처럼 크고 또렷하게
    ["square", "sawtooth"].forEach((type, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = type; o.frequency.value = freq * (i ? 1.005 : 1);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(i ? 0.35 : 0.6, start + 0.01);
      g.gain.setValueAtTime(i ? 0.35 : 0.6, start + dur - 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(g).connect(master._in);
      o.start(start); o.stop(start + dur + 0.02);
    });
  }
  // 1% → 1번, 2% → 2번, 5% → 3번 … 30% → 8번 울림 (급등: 올라가는 소리 / 급락: 내려가는 소리)
  // 다 울린 뒤 걸리는 시간(ms)을 돌려줌
  function playAlert(dir, t) {
    if (!ensureAudio()) return 0;
    const rounds = Math.max(0, ALL_TH.indexOf(t)) + 1;
    const notes = dir === "up" ? [700, 950, 1250] : [1250, 950, 700];
    const nd = 0.12, gap = 0.22;
    let at = audio.currentTime + 0.03;
    for (let r = 0; r < rounds; r++) {
      notes.forEach((f, i) => beep(f, at + i * nd, nd - 0.01));
      at += notes.length * nd + gap;
    }
    return Math.round((at - audio.currentTime) * 1000);
  }
  function speak(text) {
    if (!S.voice || !("speechSynthesis" in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ko-KR"; u.volume = S.vvol / 100; u.rate = 1.0;
      const ko = speechSynthesis.getVoices().find((v) => /ko/i.test(v.lang));
      if (ko) u.voice = ko;
      speechSynthesis.speak(u);
    } catch (_) {}
  }
  // 소리 → (다 울린 뒤) 멘트
  let speakTimer = null;
  function announce(dir, t, name) {
    const ms = playAlert(dir, t);
    clearTimeout(speakTimer);
    speakTimer = setTimeout(() => speak(`${name} ${t}퍼센트 ${dir === "up" ? "급등" : "급락"}`), ms + 100);
  }
  if ("speechSynthesis" in window) { try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); } catch (_) {} }

  const logEl = $("#alertLog");
  function fire(target, name, dir, t, pctNow, price, refName) {
    const word = dir === "up" ? "급등" : "급락";
    const li = el("li");
    li.append(el("span", "t", hhmmss(Date.now())), el("span", dir === "up" ? "up" : "down",
      `${dir === "up" ? "▲" : "▼"} ${name} ${t}% ${word}`), el("span", "muted", `(${refName} ${pctNow >= 0 ? "+" : ""}${pctNow.toFixed(2)}%)`));
    if (logEl.firstChild && logEl.firstChild.classList.contains("muted")) logEl.textContent = "";
    logEl.prepend(li);
    while (logEl.children.length > 30) logEl.lastChild.remove();

    const box = $("#toasts");
    const tst = el("div", "toast " + dir, `${dir === "up" ? "▲" : "▼"} ${name} ${t}% ${word}`);
    tst.append(el("small", null, `${refName} 대비 ${pctNow >= 0 ? "+" : ""}${pctNow.toFixed(2)}% · ${price}`));
    box.prepend(tst); setTimeout(() => tst.remove(), 6000);
    while (box.children.length > 4) box.lastChild.remove();

    const panel = target === "coin" ? $("#cryptoPanel") : $("#stockPanel");
    panel.classList.remove("flash-up", "flash-down"); void panel.offsetWidth;
    panel.classList.add(dir === "up" ? "flash-up" : "flash-down");
    setTimeout(() => panel.classList.remove("flash-up", "flash-down"), 2500);

    if (S.soundOn) announce(dir, t, name);
  }

  const alertState = { coin: { key: null, fired: new Set(), primed: false }, stock: { key: null, fired: new Set(), primed: false } };
  // price: 현재가, base: 기준가격, periodKey: 기준이 바뀌면 달라지는 값
  function checkAlert(target, name, price, base, periodKey, priceText, refName) {
    if (!S.targets[target] || !base || !price) return;
    const st = alertState[target];
    const key = [S.ref, name, periodKey, S.th.join(",")].join("|");
    if (st.key !== key) { st.key = key; st.fired = new Set(); st.primed = false; }
    const p = (price / base - 1) * 100;
    const ths = S.th.slice().sort((a, b) => a - b);
    const crossed = [];
    ths.forEach((t) => { if (p >= t) crossed.push(["up", t]); if (p <= -t) crossed.push(["down", t]); });
    if (!st.primed) { crossed.forEach(([d, t]) => st.fired.add(d + t)); st.primed = true; return; } // 처음 켰을 때 이미 넘은 건 울리지 않음
    const fresh = crossed.filter(([d, t]) => !st.fired.has(d + t));
    if (!fresh.length) return;
    fresh.forEach(([d, t]) => st.fired.add(d + t));
    ["up", "down"].forEach((d) => {
      const f = fresh.filter((x) => x[0] === d);
      if (f.length) fire(target, name, d, Math.max(...f.map((x) => x[1])), p, priceText, refName);
    });
  }

  // ---- 알림 설정 화면 ----
  function chipGroup(box, items, isOn, onClick) {
    box.textContent = "";
    items.forEach(([v, label]) => {
      const b = el("button", "chip" + (isOn(v) ? " on" : ""), label);
      b.onclick = () => { onClick(v); chipGroup(box, items, isOn, onClick); };
      box.append(b);
    });
  }
  chipGroup($("#thChips"), ALL_TH.map((t) => [t, t + "%"]), (t) => S.th.includes(t), (t) => {
    S.th = S.th.includes(t) ? S.th.filter((x) => x !== t) : S.th.concat(t); saveS();
  });
  chipGroup($("#refChips"), [["bar", "현재 봉 시가 대비"], ["day", "전일 종가 대비"]], (v) => S.ref === v, (v) => { S.ref = v; saveS(); });
  chipGroup($("#targetChips"), [["coin", "코인 차트"], ["stock", "나스닥 차트"]], (v) => S.targets[v], (v) => { S.targets[v] = !S.targets[v]; saveS(); });
  const voiceChip = $("#voiceChip");
  const syncVoice = () => { voiceChip.classList.toggle("on", S.voice); voiceChip.textContent = S.voice ? "🗣 멘트 켜짐" : "🗣 멘트 꺼짐"; };
  voiceChip.onclick = () => { S.voice = !S.voice; saveS(); syncVoice(); };
  syncVoice();
  const volEl = $("#vol"), volNum = $("#volNum");
  const vvolEl = $("#vvol"), vvolNum = $("#vvolNum");
  volEl.value = S.vol; volNum.textContent = S.vol;
  vvolEl.value = S.vvol; vvolNum.textContent = S.vvol;
  volEl.oninput = () => { S.vol = Number(volEl.value); volNum.textContent = S.vol; if (master) master.gain.value = (S.vol / 100) * 3; saveS(); };
  volEl.onchange = () => { ensureAudio(); beep(950, audio.currentTime + 0.02, 0.15); }; // 손을 떼면 미리 듣기
  vvolEl.oninput = () => { S.vvol = Number(vvolEl.value); vvolNum.textContent = S.vvol; saveS(); };
  vvolEl.onchange = () => speak("음성 안내 크기");
  const soundBtn = $("#soundBtn");
  const syncSound = () => { soundBtn.classList.toggle("on", S.soundOn); soundBtn.textContent = S.soundOn ? "🔔 소리 켜짐" : "🔇 소리 꺼짐"; };
  soundBtn.onclick = () => {
    S.soundOn = !S.soundOn; syncSound();
    if (S.soundOn) { ensureAudio(); beep(950, audio.currentTime + 0.02, 0.15); }
  };
  // 테스트: 선택한 %로 실제와 똑같이 울림
  const testTh = $("#testTh");
  ALL_TH.forEach((t) => { const o = el("option", null, t + "% (" + (ALL_TH.indexOf(t) + 1) + "번)"); o.value = t; testTh.append(o); });
  testTh.value = "2";
  const test = (dir) => { const nm = COIN_NAME[C.coin] || C.coin; announce(dir, Number(testTh.value), nm); };
  $("#testUp").onclick = () => test("up");
  $("#testDown").onclick = () => test("down");

  // =====================================================
  //  차트 공통
  // =====================================================
  const LWC = window.LightweightCharts;
  function overlay(box, text) {
    let o = box.querySelector(".msg-over");
    if (!text) { if (o) o.remove(); return; }
    if (!o) { o = el("div", "msg-over"); box.append(o); }
    o.textContent = text;
  }
  function makeChart(box) {
    if (!LWC) { overlay(box, "차트 프로그램을 불러오지 못했어요. 새로고침해 주세요."); return null; }
    const chart = LWC.createChart(box, {
      autoSize: true,
      layout: { background: { type: "solid", color: "#12161b" }, textColor: "#8a96a6", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      grid: { vertLines: { color: "#1a2028" }, horzLines: { color: "#1a2028" } },
      rightPriceScale: { borderColor: "#232a33" },
      timeScale: { borderColor: "#232a33", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: LWC.CrosshairMode ? LWC.CrosshairMode.Normal : 0 },
    });
    const candle = chart.addCandlestickSeries({
      upColor: "#f0505a", downColor: "#3b82f6", borderUpColor: "#f0505a", borderDownColor: "#3b82f6",
      wickUpColor: "#f0505a", wickDownColor: "#3b82f6",
    });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    const vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    return { chart, candle, vol };
  }
  const volBar = (b) => ({ time: b.time, value: b.volume || 0, color: b.close >= b.open ? "rgba(240,80,90,.35)" : "rgba(59,130,246,.35)" });
  const toKst = (list) => list.map((b) => ({ ...b, time: b.time + KST }));
  function setPrecision(series, price, isUsd) {
    const dp = isUsd ? (price >= 1 ? 2 : 4) : krwDp(price);
    series.applyOptions({ priceFormat: { type: "price", precision: dp, minMove: 1 / Math.pow(10, dp) } });
  }
  function ivButtons(box, cur, onPick) {
    box.textContent = "";
    IVS.forEach(([v, label]) => {
      const b = el("button", v === cur ? "on" : "", label);
      b.onclick = () => onPick(v);
      box.append(b);
    });
  }

  // =====================================================
  //  코인 차트 (업비트)
  // =====================================================
  const C = Object.assign({ coin: "BTC", unit: "1" }, store.get("bitbuy.coinView", {}));
  if (!COIN_NAME[C.coin]) C.coin = "BTC";
  if (!IV_SEC[C.unit]) C.unit = "1";
  const cBox = $("#cChart");
  const cCh = makeChart(cBox);
  let cLast = null, cSeq = 0;

  function renderCoinButtons() {
    const box = $("#coinBtns"); box.textContent = "";
    COINS.forEach(([sym, nm]) => {
      const b = el("button", sym === C.coin ? "on" : "", nm);
      b.onclick = () => { C.coin = sym; store.set("bitbuy.coinView", C); renderCoinButtons(); loadCoin(); renderCoinHead(); };
      box.append(b);
    });
    ivButtons($("#cIvs"), C.unit, (v) => { C.unit = v; store.set("bitbuy.coinView", C); renderCoinButtons(); loadCoin(); });
  }

  async function loadCoin() {
    if (!cCh) return;
    const seq = ++cSeq;
    overlay(cBox, "차트 불러오는 중…");
    try {
      const r = await fetch(`/api/candles?market=KRW-${C.coin}&unit=${C.unit}`);
      const j = await r.json();
      if (seq !== cSeq) return;
      if (!j.candles || !j.candles.length) throw 0;
      const bars = toKst(j.candles);
      setPrecision(cCh.candle, bars[bars.length - 1].close, false);
      cCh.candle.setData(bars);
      cCh.vol.setData(bars.map(volBar));
      cCh.chart.timeScale().fitContent();
      cLast = { ...bars[bars.length - 1] };
      overlay(cBox, null);
      $("#cStatus").textContent = `업비트 KRW-${C.coin} · ${IV_NAME[C.unit]}봉 · 실시간`;
    } catch (_) {
      if (seq === cSeq) overlay(cBox, "차트를 불러오지 못했어요. 잠시 후 다시 시도합니다.");
    }
  }
  // 서버에서 최신 봉을 주기적으로 다시 받아 거래량 등을 보정
  async function refreshCoin() {
    if (!cCh || !cLast) return;
    const seq = cSeq;
    try {
      const r = await fetch(`/api/candles?market=KRW-${C.coin}&unit=${C.unit}`);
      const j = await r.json();
      if (seq !== cSeq || !j.candles || !j.candles.length) return;
      toKst(j.candles).slice(-3).forEach((b) => {
        if (b.time >= cLast.time) {
          if (b.time === cLast.time && mk[C.coin].krw) { b.close = mk[C.coin].krw; b.high = Math.max(b.high, b.close); b.low = Math.min(b.low, b.close); }
          cCh.candle.update(b); cCh.vol.update(volBar(b)); cLast = { ...b };
        }
      });
    } catch (_) {}
  }
  setInterval(refreshCoin, 20000);

  // 실시간 체결가로 마지막 봉 움직이기
  function liveCoin(price) {
    if (!cCh || !cLast) return;
    const step = IV_SEC[C.unit];
    const bucket = Math.floor(Date.now() / 1000 / step) * step + KST;
    if (bucket > cLast.time) cLast = { time: bucket, open: price, high: price, low: price, close: price, volume: 0 };
    else { cLast.close = price; cLast.high = Math.max(cLast.high, price); cLast.low = Math.min(cLast.low, price); }
    cCh.candle.update({ time: cLast.time, open: cLast.open, high: cLast.high, low: cLast.low, close: cLast.close });
  }

  // =====================================================
  //  나스닥 차트 (야후 파이낸스, 서버 함수 경유)
  // =====================================================
  const ST = Object.assign({ sym: "^IXIC", iv: "1" }, store.get("bitbuy.stockView", {}));
  if (!IV_SEC[ST.iv]) ST.iv = "1";
  const sBox = $("#sChart");
  const sCh = makeChart(sBox);
  let sLast = null, sSeq = 0, sData = null, sTimer = null;
  const stockLabel = (sym) => STOCK_NAME[sym] || sym;

  function renderStockButtons() {
    const box = $("#stockBtns"); box.textContent = "";
    const list = STOCKS.slice();
    if (!STOCK_NAME[ST.sym]) list.push([ST.sym, ST.sym]);
    list.forEach(([sym, nm]) => {
      const b = el("button", sym === ST.sym ? "on" : "", nm);
      b.onclick = () => pickStock(sym);
      box.append(b);
    });
    const f = el("form"); const inp = el("input"); inp.placeholder = "종목코드"; inp.maxLength = 12;
    f.append(inp);
    f.onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim().toUpperCase(); if (/^[A-Z0-9.^=\-]{1,12}$/.test(v)) pickStock(v); };
    box.append(f);
    ivButtons($("#sIvs"), ST.iv, (v) => { ST.iv = v; store.set("bitbuy.stockView", ST); renderStockButtons(); loadStock(); });
  }
  function pickStock(sym) { ST.sym = sym; store.set("bitbuy.stockView", ST); renderStockButtons(); loadStock(); }

  function renderStockHead() {
    const d = sData;
    $("#sName").textContent = d ? `${stockLabel(d.symbol)} · ${d.symbol}${d.name && d.name !== d.symbol ? " · " + d.name : ""}` : `${stockLabel(ST.sym)} · ${ST.sym}`;
    if (!d || d.price == null) { $("#sPrice").textContent = "—"; $("#sChg").textContent = "—"; return; }
    const r = d.prevClose ? d.price / d.prevClose - 1 : null;
    const pe = $("#sPrice"); pe.textContent = (d.currency === "USD" && !d.symbol.startsWith("^") ? "$" : "") + usd(d.price); pe.className = "big mono " + cls(r);
    const ce = $("#sChg"); ce.textContent = pct(r); ce.className = "mono chg " + cls(r);
    $("#sSub").textContent = d.prevClose ? `전일 종가 ${usd(d.prevClose)} · ${d.currency}` : d.currency;
    $("#sState").textContent = d.state ? "● " + d.state : "";
    queueTicker();
  }

  async function fetchStock() {
    const r = await fetch(`/api/stock?symbol=${encodeURIComponent(ST.sym)}&interval=${ST.iv}`);
    const j = await r.json();
    if (!r.ok || !j.candles) throw new Error(j.error || "fail");
    return j;
  }
  async function loadStock() {
    if (!sCh) return;
    const seq = ++sSeq;
    sData = null; renderStockHead();
    overlay(sBox, "차트 불러오는 중…");
    clearInterval(sTimer);
    try {
      const j = await fetchStock();
      if (seq !== sSeq) return;
      sData = j; renderStockHead();
      if (!j.candles.length) { overlay(sBox, "표시할 데이터가 없어요. (장 시작 전이거나 종목코드를 확인해 주세요)"); return; }
      const bars = toKst(j.candles);
      setPrecision(sCh.candle, bars[bars.length - 1].close, true);
      sCh.candle.setData(bars);
      sCh.vol.setData(bars.map(volBar));
      sCh.chart.timeScale().fitContent();
      sLast = { ...bars[bars.length - 1] };
      overlay(sBox, null);
      $("#sStatus").textContent = `야후 파이낸스 · ${IV_NAME[ST.iv]}봉 · ${ST.iv === "1" ? "15초" : "1분"}마다 갱신 · 약간 지연될 수 있음`;
      stockAlert();
    } catch (_) {
      if (seq === sSeq) overlay(sBox, "주식 데이터를 불러오지 못했어요.\n종목코드를 확인하거나 잠시 후 다시 시도해 주세요.");
    }
    sTimer = setInterval(pollStock, ST.iv === "1" ? 15000 : 60000);
  }
  async function pollStock() {
    if (!sCh) return;
    const seq = sSeq;
    try {
      const j = await fetchStock();
      if (seq !== sSeq) return;
      sData = j; renderStockHead();
      if (!j.candles.length) return;
      if (!sLast) { loadStock(); return; }
      toKst(j.candles).slice(-3).forEach((b) => {
        if (b.time >= sLast.time) { sCh.candle.update(b); sCh.vol.update(volBar(b)); sLast = { ...b }; }
      });
      stockAlert();
    } catch (_) {}
  }
  function stockAlert() {
    if (!sData || sData.price == null) return;
    const name = stockLabel(sData.symbol);
    const priceText = usd(sData.price);
    if (S.ref === "day") checkAlert("stock", name, sData.price, sData.prevClose, "day" + sData.prevClose, priceText, "전일 종가");
    else if (sLast) checkAlert("stock", name, sData.price, sLast.open, `${ST.iv}@${sLast.time}`, priceText, `${IV_NAME[ST.iv]}봉 시가`);
  }

  // =====================================================
  //  실시간 시세 연결 (업비트 + 바이낸스 WebSocket)
  // =====================================================
  const mk = {};
  COINS.forEach(([s]) => { mk[s] = { krw: null, rate: null, usd: null }; });
  let usdtKrw = null;
  const kimchi = (s) => { const m = mk[s]; return m && m.krw && m.usd && usdtKrw ? m.krw / (m.usd * usdtKrw) - 1 : null; };

  function renderCoinHead() {
    const m = mk[C.coin], nm = COIN_NAME[C.coin];
    $("#cName").textContent = `${nm} · ${C.coin}/KRW · 업비트`;
    const pe = $("#cPrice"); pe.textContent = m.krw == null ? "—" : "₩" + krw(m.krw); pe.className = "big mono " + cls(m.rate);
    const ce = $("#cChg"); ce.textContent = m.rate == null ? "—" : pct(m.rate) + " 전일대비"; ce.className = "mono chg " + cls(m.rate);
    const k = kimchi(C.coin);
    $("#cSub").textContent = `바이낸스 ${m.usd == null ? "—" : "$" + usd(m.usd)} · 김프 ${k == null ? "—" : pct(k)}`;
  }

  let tq = false;
  function queueTicker() { if (tq) return; tq = true; requestAnimationFrame(() => { tq = false; renderTicker(); }); }
  function renderTicker() {
    const tk = $("#ticker"); tk.textContent = "";
    COINS.forEach(([s]) => {
      const m = mk[s]; if (m.krw == null) return;
      const sp = el("span", null, s); sp.append(el("strong", "mono " + cls(m.rate), "₩" + krw(m.krw) + " " + pct(m.rate))); tk.append(sp);
    });
    const k = kimchi("BTC");
    if (k != null) { const sp = el("span", null, "김프"); sp.append(el("strong", "mono " + cls(k), pct(k))); tk.append(sp); }
    if (usdtKrw) { const sp = el("span", null, "USDT"); sp.append(el("strong", "mono", "₩" + krw(usdtKrw))); tk.append(sp); }
    if (sData && sData.price != null) {
      const r = sData.prevClose ? sData.price / sData.prevClose - 1 : null;
      const sp = el("span", null, stockLabel(sData.symbol)); sp.append(el("strong", "mono " + cls(r), usd(sData.price) + " " + pct(r))); tk.append(sp);
    }
    if (!tk.children.length) tk.append(el("span", null, "시세 연결 중…"));
  }

  const live = { upbit: false, binance: false };
  function renderLiveState() {
    $("#liveState").textContent = live.upbit ? "● 실시간" : "재연결 중…";
  }
  function connectWS(name, url, onOpen, onMessage) {
    let delay = 1000;
    const go = () => {
      let ws;
      try { ws = new WebSocket(url); } catch (_) { setTimeout(go, delay); return; }
      ws.binaryType = "blob";
      ws.onopen = () => { delay = 1000; live[name] = true; renderLiveState(); onOpen && onOpen(ws); };
      ws.onmessage = onMessage;
      ws.onclose = () => { live[name] = false; renderLiveState(); setTimeout(go, delay); delay = Math.min(delay * 2, 30000); };
      ws.onerror = () => { try { ws.close(); } catch (_) {} };
    };
    go();
  }

  connectWS("upbit", "wss://api.upbit.com/websocket/v1",
    (ws) => ws.send(JSON.stringify([
      { ticket: "bitbuy-" + Math.random().toString(36).slice(2) },
      { type: "ticker", codes: COINS.map(([s]) => "KRW-" + s).concat("KRW-USDT") },
      { format: "SIMPLE" },
    ])),
    async (ev) => {
      try {
        const txt = typeof ev.data === "string" ? ev.data : await ev.data.text();
        const d = JSON.parse(txt);
        const code = d.cd || d.code, price = d.tp ?? d.trade_price, rate = d.scr ?? d.signed_change_rate;
        if (!code || price == null) return;
        if (code === "KRW-USDT") { usdtKrw = price; queueTicker(); return; }
        const sym = code.slice(4); if (!mk[sym]) return;
        mk[sym].krw = price; mk[sym].rate = rate;
        queueTicker();
        if (sym === C.coin) {
          renderCoinHead();
          liveCoin(price);
          const nm = COIN_NAME[sym], priceText = "₩" + krw(price);
          if (S.ref === "day") { const base = price / (1 + rate); checkAlert("coin", nm, price, base, "day" + Math.round(base * 1e4), priceText, "전일 종가"); }
          else if (cLast) checkAlert("coin", nm, price, cLast.open, `${C.unit}@${cLast.time}`, priceText, `${IV_NAME[C.unit]}봉 시가`);
        }
      } catch (_) {}
    });

  connectWS("binance",
    "wss://stream.binance.com:9443/stream?streams=" + COINS.map(([s]) => s.toLowerCase() + "usdt@miniTicker").join("/"),
    null,
    (ev) => {
      try {
        const d = JSON.parse(ev.data).data;
        const sym = d.s.replace(/USDT$/, "");
        if (mk[sym]) { mk[sym].usd = parseFloat(d.c); if (sym === C.coin) renderCoinHead(); queueTicker(); }
      } catch (_) {}
    });

  renderCoinButtons(); renderCoinHead(); loadCoin();
  renderStockButtons(); loadStock();

  // =====================================================
  //  뉴스 (서버 함수 /api/news 가 5분마다 수집)
  // =====================================================
  async function loadNews() {
    const ul = $("#newsList");
    try {
      const r = await fetch("/api/news");
      if (!r.ok) throw 0;
      const j = await r.json();
      ul.textContent = "";
      (j.items || []).slice(0, 15).forEach((n) => {
        const li = el("li");
        const a = el("a", "t", n.title); a.href = n.link; a.target = "_blank"; a.rel = "noopener noreferrer";
        li.append(a, el("div", "m", [n.source, n.date ? ago(n.date) : ""].filter(Boolean).join(" · ")));
        ul.append(li);
      });
      if (!ul.children.length) ul.append(el("li", "status", "표시할 뉴스가 없어요."));
      $("#newsTime").textContent = hhmm(Date.now()) + " 갱신";
    } catch (_) {
      if (!ul.querySelector("a")) { ul.textContent = ""; ul.append(el("li", "status", "뉴스를 불러오지 못했어요. 잠시 후 다시 시도합니다.")); }
    }
  }
  loadNews(); setInterval(loadNews, 5 * 60 * 1000);

  // =====================================================
  //  3. 게시판 + 4. 채팅 (Supabase)
  // =====================================================
  const cfg = window.BITBUY_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_URL.startsWith("https://") && !cfg.SUPABASE_URL.includes("여기에") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("여기에");
  const sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  // 닉네임
  const nickInput = $("#nickInput");
  nickInput.value = store.get("bitbuy.nick", "");
  nickInput.addEventListener("change", () => store.set("bitbuy.nick", nickInput.value.trim()));
  const myNick = () => nickInput.value.trim();
  function needNick() {
    if (myNick().length >= 2) return false;
    nickInput.focus(); nickInput.placeholder = "닉네임을 2자 이상 입력해 주세요"; nickInput.style.borderColor = "#f0505a";
    setTimeout(() => (nickInput.style.borderColor = ""), 2500);
    return true;
  }

  if (!sb) {
    const msg = "게시판과 채팅을 쓰려면 config.js에 Supabase 주소와 키를 넣어 주세요.\n(설치 안내서 3단계 참고)";
    $("#boardView").textContent = ""; $("#boardView").append(el("div", "empty", msg));
    $("#msgs").textContent = ""; $("#msgs").append(el("div", "status", msg));
    $("#chatState").textContent = "설정 필요"; $("#writeBtn").disabled = true; $("#chatSend").disabled = true;
    return;
  }

  // ---------- 게시판 ----------
  const CATS = ["전체", "자유", "시황분석", "질문", "뉴스토론"];
  const PAGE = 20;
  let curCat = "전체", view = "list", openId = null, posts = [], hasMore = false;
  let liked = store.get("bitbuy.liked", []);

  const tabs = $("#tabs");
  CATS.forEach((c) => {
    const b = el("button", c === curCat ? "on" : "", c);
    b.onclick = () => { curCat = c; [...tabs.children].forEach((x) => x.classList.toggle("on", x === b)); showList(true); };
    tabs.append(b);
  });
  $("#writeBtn").onclick = () => showWrite();

  const boardView = $("#boardView");
  function boardMsg(text) { boardView.textContent = ""; boardView.append(el("div", "empty", text)); }

  async function fetchPosts(reset) {
    const from = reset ? 0 : posts.length;
    let q = sb.from("posts").select("id,cat,title,nickname,likes,created_at,comments(count)")
      .order("created_at", { ascending: false }).range(from, from + PAGE - 1);
    if (curCat !== "전체") q = q.eq("cat", curCat);
    const { data, error } = await q;
    if (error) throw error;
    posts = reset ? data : posts.concat(data);
    hasMore = data.length === PAGE;
  }

  async function showList(reset) {
    view = "list"; openId = null;
    if (reset) boardMsg("불러오는 중…");
    try { await fetchPosts(reset); } catch (_) { boardMsg("게시판을 불러오지 못했어요."); return; }
    if (view !== "list") return;
    renderList();
  }

  function renderList() {
    boardView.textContent = "";
    if (!posts.length) { boardMsg("아직 글이 없어요.\n첫 글을 남겨 보세요!"); return; }
    posts.forEach((p) => {
      const row = el("div", "post");
      row.append(el("span", "cat", p.cat));
      const box = el("div");
      box.append(el("div", "ti", p.title));
      const cnt = (p.comments && p.comments[0] && p.comments[0].count) || 0;
      const mt = el("div", "mt");
      mt.append(el("span", null, p.nickname), el("span", null, ago(p.created_at)), el("span", null, "♥ " + p.likes), el("span", null, "💬 " + cnt));
      box.append(mt); row.append(box);
      row.onclick = () => showDetail(p.id);
      boardView.append(row);
    });
    if (hasMore) {
      const more = el("button", "btn ghost more", "더 보기");
      more.onclick = async () => { more.disabled = true; try { await fetchPosts(false); renderList(); } catch (_) { more.disabled = false; } };
      boardView.append(more);
    }
  }

  function showWrite() {
    view = "write";
    boardView.textContent = "";
    const f = el("form", "form");
    const sel = el("select"); CATS.slice(1).forEach((c) => { const o = el("option", null, c); o.value = c; sel.append(o); });
    if (curCat !== "전체") sel.value = curCat;
    const ti = el("input"); ti.placeholder = "제목 (2~80자)"; ti.maxLength = 80;
    const bd = el("textarea"); bd.placeholder = "내용을 입력하세요.\n투자 권유·리딩방 홍보·개인정보 게시는 삭제됩니다."; bd.maxLength = 5000;
    const err = el("div", "err");
    const row = el("div", "row");
    const ok = el("button", "btn", "등록"); ok.type = "submit";
    const cancel = el("button", "btn ghost", "취소"); cancel.type = "button"; cancel.onclick = () => showList(true);
    row.append(ok, cancel);
    f.append(el("div", "mt", "작성자: " + (myNick() || "(오른쪽 채팅창에서 닉네임을 정해 주세요)")), sel, ti, bd, err, row);
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (needNick()) { err.textContent = "먼저 채팅창 위에서 닉네임을 정해 주세요."; return; }
      const title = ti.value.trim(), body = bd.value.trim();
      if (title.length < 2 || body.length < 2) { err.textContent = "제목과 내용을 2자 이상 입력해 주세요."; return; }
      const last = store.get("bitbuy.lastPost", 0);
      if (Date.now() - last < 30000) { err.textContent = "글은 30초에 한 번만 쓸 수 있어요."; return; }
      ok.disabled = true;
      const { data, error } = await sb.from("posts").insert({ cat: sel.value, title, body, nickname: myNick() }).select("id").single();
      if (error) { ok.disabled = false; err.textContent = "저장하지 못했어요: " + error.message; return; }
      store.set("bitbuy.lastPost", Date.now());
      showDetail(data.id);
    };
    boardView.append(f); ti.focus();
  }

  async function showDetail(id) {
    view = "detail"; openId = id;
    boardMsg("불러오는 중…");
    const { data: p, error } = await sb.from("posts").select("*").eq("id", id).single();
    if (openId !== id) return;
    if (error || !p) { boardMsg("글을 찾을 수 없어요."); return; }
    boardView.textContent = "";
    const d = el("div", "detail");
    const back = el("button", "btn ghost", "← 목록"); back.onclick = () => showList(true);
    d.append(back, el("h3", null, p.title), el("div", "mt", p.cat + " · " + p.nickname + " · " + ago(p.created_at)), el("div", "body", p.body));

    const acts = el("div", "actions");
    const isLiked = liked.includes(id);
    const like = el("button", "btn ghost", (isLiked ? "♥ " : "♡ ") + "추천 " + p.likes);
    like.disabled = isLiked;
    like.onclick = async () => {
      like.disabled = true;
      const { data: n, error: e2 } = await sb.rpc("like_post", { pid: id });
      if (e2) { like.disabled = false; return; }
      liked.push(id); store.set("bitbuy.liked", liked.slice(-500));
      like.textContent = "♥ 추천 " + n;
    };
    acts.append(like);
    const share = el("button", "btn ghost", "링크 복사");
    share.onclick = async () => { try { await navigator.clipboard.writeText(location.origin + "/#post-" + id); share.textContent = "복사됨!"; } catch (_) {} };
    acts.append(share);
    d.append(acts);

    const cw = el("div", "cmts"); cw.append(el("h2", null, "댓글"));
    const list = el("div"); cw.append(list);
    const cf = el("form", "row");
    const ci = el("input"); ci.placeholder = "댓글 달기"; ci.maxLength = 500;
    const cb = el("button", "btn", "등록");
    cf.append(ci, cb);
    cf.onsubmit = async (e) => {
      e.preventDefault();
      if (needNick()) return;
      const t = ci.value.trim(); if (!t) return;
      cb.disabled = true;
      const { error: e3 } = await sb.from("comments").insert({ post_id: id, body: t, nickname: myNick() });
      cb.disabled = false;
      if (!e3) { ci.value = ""; loadComments(); }
    };
    cw.append(cf); d.append(cw); boardView.append(d);

    async function loadComments() {
      const { data: cs } = await sb.from("comments").select("*").eq("post_id", id).order("created_at", { ascending: true }).limit(300);
      list.textContent = "";
      if (!cs || !cs.length) { list.append(el("div", "status", "첫 댓글을 남겨 보세요.")); return; }
      cs.forEach((c) => {
        const r = el("div", "cmt");
        r.append(el("div", "who", c.nickname + " · " + ago(c.created_at)), el("div", "tx", c.body));
        list.append(r);
      });
    }
    loadComments();
    history.replaceState(null, "", "#post-" + id);
  }

  // 링크로 들어오면 그 글을 바로 열기
  const m = location.hash.match(/^#post-(\d+)$/);
  if (m) showDetail(Number(m[1])); else showList(true);

  // 새 글이 올라오면 목록 자동 갱신
  sb.channel("posts-feed")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, () => { if (view === "list") showList(true); })
    .subscribe();

  // ---------- 채팅 ----------
  const msgsEl = $("#msgs");
  let chat = [];
  function renderChat() {
    const atBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 80;
    msgsEl.textContent = "";
    if (!chat.length) msgsEl.append(el("div", "status", "아직 대화가 없어요. 먼저 인사해 보세요 👋"));
    const me = myNick();
    chat.forEach((c) => {
      const mine = me && c.nickname === me && c.mine;
      const r = el("div", "msg" + (mine ? " me" : ""));
      const b = el("div", "bub");
      if (!mine) b.append(el("div", "nm", c.nickname));
      b.append(el("div", "tx", c.body), el("div", "tm", hhmm(c.created_at)));
      r.append(b); msgsEl.append(r);
    });
    if (atBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  const myMsgIds = new Set(store.get("bitbuy.myMsgs", []));
  function addMsg(row) {
    if (chat.some((c) => c.id === row.id)) return;
    row.mine = myMsgIds.has(row.id);
    chat.push(row); if (chat.length > 150) chat.shift();
  }

  (async () => {
    const { data, error } = await sb.from("chat").select("*").order("created_at", { ascending: false }).limit(60);
    if (error) { $("#chatState").textContent = "불러오기 실패"; return; }
    data.reverse().forEach(addMsg);
    renderChat(); msgsEl.scrollTop = msgsEl.scrollHeight;
  })();

  sb.channel("chat-feed")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat" }, (payload) => { addMsg(payload.new); renderChat(); })
    .subscribe((s) => { $("#chatState").textContent = s === "SUBSCRIBED" ? "● 실시간" : "연결 중…"; });

  let lastSend = 0;
  $("#chatForm").onsubmit = async (e) => {
    e.preventDefault();
    if (needNick()) return;
    const inp = $("#chatInput"); const t = inp.value.trim();
    if (!t) return;
    if (Date.now() - lastSend < 2000) { $("#chatState").textContent = "천천히 입력해 주세요"; return; }
    lastSend = Date.now();
    const btn = $("#chatSend"); btn.disabled = true;
    const { data, error } = await sb.from("chat").insert({ nickname: myNick(), body: t }).select().single();
    btn.disabled = false;
    if (error) { $("#chatState").textContent = "전송 실패"; return; }
    myMsgIds.add(data.id); store.set("bitbuy.myMsgs", [...myMsgIds].slice(-300));
    addMsg(data); chat.forEach((c) => { if (c.id === data.id) c.mine = true; });
    inp.value = ""; renderChat(); msgsEl.scrollTop = msgsEl.scrollHeight; inp.focus();
  };

  // ---------- 접속자 수 ----------
  const presence = sb.channel("online", { config: { presence: { key: Math.random().toString(36).slice(2) } } });
  presence
    .on("presence", { event: "sync" }, () => {
      const n = Object.keys(presence.presenceState()).length;
      $("#onlineCount").textContent = n + "명 접속 중";
    })
    .subscribe(async (s) => { if (s === "SUBSCRIBED") await presence.track({ at: Date.now() }); });

  // "n분 전" 표시 갱신
  setInterval(() => { if (view === "list" && posts.length) renderList(); }, 60000);
})();
