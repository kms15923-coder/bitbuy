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
  const MARKETS = {
    nasdaq: { name: "나스닥", list: [
      ["^IXIC", "나스닥"], ["NQ=F", "나스닥 선물"], ["NVDA", "엔비디아"], ["TSLA", "테슬라"],
      ["AAPL", "애플"], ["MSFT", "마이크로소프트"], ["AMZN", "아마존"], ["GOOGL", "구글"],
      ["META", "메타"], ["COIN", "코인베이스"], ["MSTR", "스트래티지"],
    ] },
    kospi: { name: "코스피", list: [
      ["^KS11", "코스피"], ["^KQ11", "코스닥"], ["005930.KS", "삼성전자"], ["000660.KS", "SK하이닉스"],
      ["373220.KS", "LG에너지솔루션"], ["207940.KS", "삼성바이오"], ["005380.KS", "현대차"],
      ["068270.KS", "셀트리온"], ["035420.KS", "NAVER"], ["035720.KS", "카카오"], ["012450.KS", "한화에어로"],
    ] },
  };
  const STOCK_NAME = Object.fromEntries(Object.values(MARKETS).flatMap((m) => m.list));
  const marketOf = (sym) => /\.(KS|KQ)$|^\^K(S|Q)11$/.test(sym) ? "kospi" : "nasdaq";

  // ---------- 접속자 수 표시 (유령 인원 포함) ----------
  // 실제 접속자 + 아래 범위의 표시용 인원. 실제 이용자가 늘면 on: false 로 끄세요.
  const GHOST = { on: true, min: 50, max: 100 };
  let realOnline = 0;
  function ghostCount() {
    if (!GHOST.on) return 0;
    const t = Date.now() / 1000;
    // 모든 방문자에게 비슷한 숫자가 보이도록 시간에 따라 천천히 변하는 값
    const wave = 0.5 + 0.35 * Math.sin(t / 1700) + 0.15 * Math.sin(t / 310 + 1.3);
    const jitter = Math.sin(Math.floor(t / 20) * 12.9898) * 0.5 + 0.5; // 20초마다 살짝 변동
    const span = GHOST.max - GHOST.min;
    return Math.round(GHOST.min + Math.min(1, Math.max(0, wave * 0.92 + jitter * 0.08)) * span);
  }
  function renderOnline() {
    const n = realOnline + ghostCount();
    const e = document.querySelector("#onlineCount");
    if (e) e.textContent = (n || 1) + "명 접속 중";
    const c = document.querySelector("#chatOnline");
    if (c) c.textContent = (n || 1) + "명 참여 중";
  }
  setInterval(renderOnline, 5000);

  // =====================================================
  //  급등락 알림 (소리 · 음성 · 화면)
  // =====================================================
  const ALL_TH = [1, 2, 5, 10, 15, 20, 25, 30];
  const S = Object.assign({
    th: ALL_TH.slice(), ref: "bar", targets: { coin: true, stock: true }, voice: true, vol: 85, vvol: 100, voiceName: "google", soundOn: false,
  }, store.get("bitbuy.alerts", {}));
  S.soundOn = false; // 브라우저 정책상 매번 클릭으로 켜야 함
  const saveS = () => store.set("bitbuy.alerts", { th: S.th, ref: S.ref, targets: S.targets, voice: S.voice, vol: S.vol, vvol: S.vvol, voiceName: S.voiceName });

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
  // 멘트: 서버(/api/tts)에서 한국어 여성 음성 파일을 받아 크게 증폭해서 재생
  //       (증폭 → 압축 → 보정 증폭 → 부드러운 클리핑: 찢어지지 않으면서 최대한 크게)
  //       실패하면 기기에 내장된 한국어 여성 음성으로 대신 읽음
  const ttsCache = new Map();
  let vPre = null, vSrc = null, lastVoiceInfo = "";
  function voiceOut() {
    if (!ensureAudio()) return null;
    if (!vPre) {
      vPre = audio.createGain();
      const comp = audio.createDynamicsCompressor();
      comp.threshold.value = -32; comp.knee.value = 4; comp.ratio.value = 20;
      comp.attack.value = 0.001; comp.release.value = 0.08;
      const makeup = audio.createGain(); makeup.gain.value = 5;
      const clip = audio.createWaveShaper();
      const curve = new Float32Array(2048);
      for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2); }
      clip.curve = curve; clip.oversample = "4x";
      vPre.connect(comp).connect(makeup).connect(clip).connect(audio.destination);
    }
    vPre.gain.value = (S.vvol / 100) * 12; // 이전보다 약 3배 크게
    return vPre;
  }
  // 서버 음성: { buf, engine } — engine: "edge"(선희 여성) 또는 "google"
  async function ttsBuffer(text) {
    if (ttsCache.has(text)) return ttsCache.get(text);
    const p = (async () => {
      const r = await fetch("/api/tts?text=" + encodeURIComponent(text));
      if (!r.ok) throw new Error("tts " + r.status);
      const engine = r.headers.get("x-tts-engine") || "google";
      const ab = await r.arrayBuffer();
      const buf = await new Promise((ok, no) => audio.decodeAudioData(ab, ok, no));
      return { buf, engine };
    })();
    ttsCache.set(text, p);
    p.catch(() => ttsCache.delete(text));
    return p;
  }
  const ENGINE_NAME = { edge: "선희 여성 음성 (증폭)", google: "구글 음성 (증폭)" };
  function playServer(res, out) {
    try { vSrc && vSrc.stop(); } catch (_) {}
    vSrc = audio.createBufferSource(); vSrc.buffer = res.buf;
    vSrc.playbackRate.value = res.engine === "edge" ? 1.0 : 1.1;
    vSrc.connect(out); vSrc.start();
    lastVoiceInfo = ENGINE_NAME[res.engine] || res.engine;
  }
  // 기기 내장 한국어 음성 중 여성 음성을 우선으로
  const FEMALE = /(SunHi|Sun-Hi|Heami|Yuna|Sora|Jiyoung|JiMin|Seoyeon|Google 한국|female|여성|여자)/i;
  const MALE = /(InJoon|Hyunsu|BongJin|GookMin|Minsu|male|남성|남자)/i;
  function koVoices() {
    if (!("speechSynthesis" in window)) return [];
    const vs = speechSynthesis.getVoices().filter((v) => /^ko/i.test(v.lang));
    const score = (v) => (FEMALE.test(v.name) ? 0 : MALE.test(v.name) ? 2 : 1);
    return vs.sort((a, b) => score(a) - score(b));
  }
  function speakDevice(text, name) {
    if (!("speechSynthesis" in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const vs = koVoices();
      const v = (name && vs.find((x) => x.name === name)) || vs.find((x) => FEMALE.test(x.name)) || vs.find((x) => !MALE.test(x.name)) || null;
      if (v) u.voice = v;
      const female = v && FEMALE.test(v.name);
      u.lang = "ko-KR"; u.volume = 1; u.rate = 1.05;
      u.pitch = female ? 1.25 : 1.6; // 여성 음성이 없으면 목소리를 최대한 높여서 여성 톤으로
      lastVoiceInfo = "기기 음성" + (v ? ": " + v.name : "");
      speechSynthesis.speak(u);
    } catch (_) {}
  }
  async function speak(text) {
    if (!S.voice) return;
    if (S.voiceName && S.voiceName !== "google") { speakDevice(text, S.voiceName); showVoiceInfo(); return; }
    const out = voiceOut();
    if (out) {
      for (let i = 0; i < 2; i++) { // 서버 음성 2번까지 시도
        try { playServer(await ttsBuffer(text), out); showVoiceInfo(); return; }
        catch (_) { ttsCache.delete(text); }
      }
    }
    // 서버 음성이 안 되면: 기기의 여성 음성 → 없으면 목소리를 높여서 읽기
    speakDevice(text);
    lastVoiceInfo += " — 서버 음성 연결 실패로 대신 재생";
    showVoiceInfo();
  }
  function showVoiceInfo() { const e = document.querySelector("#voiceInfo"); if (e) e.textContent = lastVoiceInfo ? "재생: " + lastVoiceInfo : ""; }
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
  chipGroup($("#targetChips"), [["coin", "코인 차트"], ["stock", "주식 차트"]], (v) => S.targets[v], (v) => { S.targets[v] = !S.targets[v]; saveS(); });
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
  vvolEl.oninput = () => { S.vvol = Number(vvolEl.value); vvolNum.textContent = S.vvol; if (vPre) vPre.gain.value = (S.vvol / 100) * 12; saveS(); };
  vvolEl.onchange = () => speak("비트코인 1퍼센트 급등");
  const soundBtn = $("#soundBtn");
  const syncSound = () => { soundBtn.classList.toggle("on", S.soundOn); soundBtn.textContent = S.soundOn ? "🔔 소리 켜짐" : "🔇 소리 꺼짐"; };
  soundBtn.onclick = () => {
    S.soundOn = !S.soundOn; syncSound();
    if (S.soundOn) { ensureAudio(); beep(950, audio.currentTime + 0.02, 0.15); }
  };
  // 테스트: 선택한 %로 실제와 똑같이 울림
  const voiceSel = $("#voiceSel");
  function fillVoices() {
    voiceSel.textContent = "";
    const g = el("option", null, "선희 여성 음성 (크게, 추천)"); g.value = "google"; voiceSel.append(g);
    koVoices().forEach((v) => { const o = el("option", null, "기기 음성: " + v.name + (MALE.test(v.name) ? " (남성)" : FEMALE.test(v.name) ? " (여성)" : "")); o.value = v.name; voiceSel.append(o); });
    voiceSel.value = [...voiceSel.options].some((o) => o.value === S.voiceName) ? S.voiceName : "google";
  }
  fillVoices();
  if ("speechSynthesis" in window) speechSynthesis.addEventListener ? speechSynthesis.addEventListener("voiceschanged", fillVoices) : (speechSynthesis.onvoiceschanged = fillVoices);
  voiceSel.onchange = () => { S.voiceName = voiceSel.value; saveS(); speak("비트코인 1퍼센트 급등"); };
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
  //  코인 차트 (바이비트 USDT 무기한 / 업비트 원화)
  // =====================================================
  const EXS = [["bybit", "바이비트"], ["upbit", "업비트"]];
  const C = Object.assign({ ex: "bybit", coin: "BTC", unit: "1" }, store.get("bitbuy.coinView", {}));
  if (!COIN_NAME[C.coin]) C.coin = "BTC";
  if (!IV_SEC[C.unit]) C.unit = "1";
  if (!EXS.some(([v]) => v === C.ex)) C.ex = "bybit";
  const saveC = () => store.set("bitbuy.coinView", C);
  const cBox = $("#cChart");
  const cCh = makeChart(cBox);
  let cLast = null, cSeq = 0, dayOpen = null;
  const isBybit = () => C.ex === "bybit";

  function renderCoinButtons() {
    const box = $("#coinBtns"); box.textContent = "";
    EXS.forEach(([v, nm]) => {
      const b = el("button", "ex" + (v === C.ex ? " on" : ""), nm);
      b.onclick = () => { if (C.ex === v) return; C.ex = v; saveC(); renderCoinButtons(); renderCoinHead(); loadCoin(); };
      box.append(b);
    });
    box.append(el("span", "sep"));
    COINS.forEach(([sym, nm]) => {
      const b = el("button", sym === C.coin ? "on" : "", nm);
      b.onclick = () => { C.coin = sym; saveC(); renderCoinButtons(); renderCoinHead(); loadCoin(); };
      box.append(b);
    });
    ivButtons($("#cIvs"), C.unit, (v) => { C.unit = v; saveC(); renderCoinButtons(); loadCoin(); });
  }

  // 바이비트 봉 데이터: 내 브라우저에서 바로 받고, 막히면 서버(서울)를 거쳐서 받음
  const BYBIT_IV = { "1": "1", "15": "15", "60": "60", "240": "240", "D": "D" };
  async function bybitKline(sym, unit, limit) {
    const qs = `category=linear&symbol=${sym}USDT&interval=${BYBIT_IV[unit]}&limit=${limit}`;
    const parse = (j) => {
      const list = j && j.result && j.result.list;
      if (!Array.isArray(list) || !list.length) throw new Error("empty");
      return list.map((r) => ({ time: Math.floor(Number(r[0]) / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }))
        .sort((a, b) => a.time - b.time);
    };
    try {
      const r = await fetch("https://api.bybit.com/v5/market/kline?" + qs);
      if (!r.ok) throw 0;
      return parse(await r.json());
    } catch (_) {
      const r = await fetch("/api/bybit?" + qs);
      if (!r.ok) throw new Error("proxy");
      return parse(await r.json());
    }
  }
  async function upbitKline(sym, unit) {
    const r = await fetch(`/api/candles?market=KRW-${sym}&unit=${unit}`);
    const j = await r.json();
    if (!j.candles || !j.candles.length) throw new Error("empty");
    return j.candles;
  }
  // 바이비트 "전일 대비" 기준 = 오늘 일봉 시가(한국시간 09:00)
  async function loadDayOpen() {
    if (!isBybit()) return;
    try { const d = await bybitKline(C.coin, "D", 1); dayOpen = { sym: C.coin, open: d[d.length - 1].open, t: d[d.length - 1].time }; } catch (_) {}
  }
  setInterval(loadDayOpen, 10 * 60 * 1000);

  async function loadCoin() {
    if (!cCh) return;
    const seq = ++cSeq;
    cLast = null; dayOpen = null;
    overlay(cBox, "차트 불러오는 중…");
    bybitSubKline();
    try {
      const raw = isBybit() ? await bybitKline(C.coin, C.unit, 200) : await upbitKline(C.coin, C.unit);
      if (seq !== cSeq) return;
      const bars = toKst(raw);
      setPrecision(cCh.candle, bars[bars.length - 1].close, isBybit());
      cCh.candle.setData(bars);
      cCh.vol.setData(bars.map(volBar));
      cCh.chart.timeScale().fitContent();
      cLast = { ...bars[bars.length - 1] };
      overlay(cBox, null);
      $("#cStatus").textContent = isBybit()
        ? `바이비트 ${C.coin}USDT 무기한 · ${IV_NAME[C.unit]}봉 · 실시간`
        : `업비트 KRW-${C.coin} · ${IV_NAME[C.unit]}봉 · 실시간`;
      loadDayOpen();
    } catch (_) {
      if (seq === cSeq) overlay(cBox, isBybit()
        ? "바이비트 차트를 불러오지 못했어요.\n잠시 후 다시 시도하거나 '업비트'를 눌러 보세요."
        : "차트를 불러오지 못했어요. 잠시 후 다시 시도합니다.");
    }
  }

  // 업비트: 서버에서 최신 봉을 주기적으로 다시 받아 거래량 등을 보정 (바이비트는 실시간 봉이 옴)
  async function refreshCoin() {
    if (!cCh || !cLast || isBybit()) return;
    const seq = cSeq;
    try {
      const raw = await upbitKline(C.coin, C.unit);
      if (seq !== cSeq || isBybit()) return;
      toKst(raw).slice(-3).forEach((b) => {
        if (b.time >= cLast.time) {
          if (b.time === cLast.time && mk[C.coin].krw) { b.close = mk[C.coin].krw; b.high = Math.max(b.high, b.close); b.low = Math.min(b.low, b.close); }
          cCh.candle.update(b); cCh.vol.update(volBar(b)); cLast = { ...b };
        }
      });
    } catch (_) {}
  }
  setInterval(refreshCoin, 20000);

  // 업비트 체결가로 마지막 봉 움직이기
  function liveUpbitBar(price) {
    if (!cCh || !cLast || isBybit()) return;
    const step = IV_SEC[C.unit];
    const bucket = Math.floor(Date.now() / 1000 / step) * step + KST;
    if (bucket > cLast.time) cLast = { time: bucket, open: price, high: price, low: price, close: price, volume: 0 };
    else { cLast.close = price; cLast.high = Math.max(cLast.high, price); cLast.low = Math.min(cLast.low, price); }
    cCh.candle.update({ time: cLast.time, open: cLast.open, high: cLast.high, low: cLast.low, close: cLast.close });
  }
  // 바이비트 실시간 봉
  function liveBybitBar(k) {
    if (!cCh || !cLast || !isBybit()) return;
    const b = { time: Math.floor(Number(k.start) / 1000) + KST, open: +k.open, high: +k.high, low: +k.low, close: +k.close, volume: +k.volume };
    if (b.time < cLast.time) return;
    cCh.candle.update(b); cCh.vol.update(volBar(b)); cLast = b;
  }

  // 선택한 코인 알림 검사
  function coinAlert(price) {
    const nm = COIN_NAME[C.coin];
    const priceText = isBybit() ? "$" + usd(price) : "₩" + krw(price);
    if (S.ref === "day") {
      if (isBybit()) { if (dayOpen && dayOpen.sym === C.coin) checkAlert("coin", nm, price, dayOpen.open, "day" + dayOpen.t, priceText, "오늘 09시 시가"); }
      else { const m = mk[C.coin]; if (m.rate != null) { const base = price / (1 + m.rate); checkAlert("coin", nm, price, base, "day" + Math.round(base * 1e4), priceText, "전일 종가"); } }
    } else if (cLast) checkAlert("coin", nm, price, cLast.open, `${C.ex}${C.unit}@${cLast.time}`, priceText, `${IV_NAME[C.unit]}봉 시가`);
  }

  // =====================================================
  //  주식 차트: 나스닥 / 코스피 (야후 파이낸스, 서버 함수 경유)
  // =====================================================
  const ST = Object.assign({ sym: "^IXIC", iv: "1" }, store.get("bitbuy.stockView", {}));
  ST.mkt = marketOf(ST.sym);
  if (!IV_SEC[ST.iv]) ST.iv = "1";
  const sBox = $("#sChart");
  const sCh = makeChart(sBox);
  let sLast = null, sSeq = 0, sData = null, sTimer = null;
  const stockLabel = (sym) => STOCK_NAME[sym] || sym;
  const sfmt = (n, d) => n == null ? "—" : d && d.currency === "KRW" ? fmt(n, d.symbol.startsWith("^") ? 2 : 0) : usd(n);

  function renderStockButtons() {
    const box = $("#stockBtns"); box.textContent = "";
    Object.entries(MARKETS).forEach(([k, m]) => {
      const b = el("button", "ex" + (k === ST.mkt ? " on" : ""), m.name);
      b.onclick = () => { if (ST.mkt === k) return; pickStock(m.list[0][0]); };
      box.append(b);
    });
    box.append(el("span", "sep"));
    const list = MARKETS[ST.mkt].list.slice();
    if (!STOCK_NAME[ST.sym]) list.push([ST.sym, ST.sym]);
    list.forEach(([sym, nm]) => {
      const b = el("button", sym === ST.sym ? "on" : "", nm);
      b.onclick = () => pickStock(sym);
      box.append(b);
    });
    const f = el("form"); const inp = el("input"); inp.placeholder = ST.mkt === "kospi" ? "6자리 코드" : "종목코드"; inp.maxLength = 12;
    f.append(inp);
    f.onsubmit = (e) => {
      e.preventDefault();
      let v = inp.value.trim().toUpperCase();
      if (/^\d{6}$/.test(v)) v += ".KS"; // 예: 005930 → 005930.KS
      if (/^[A-Z0-9.^=\-]{1,12}$/.test(v)) pickStock(v);
    };
    box.append(f);
    ivButtons($("#sIvs"), ST.iv, (v) => { ST.iv = v; store.set("bitbuy.stockView", ST); renderStockButtons(); loadStock(); });
  }
  function pickStock(sym) { ST.sym = sym; ST.mkt = marketOf(sym); store.set("bitbuy.stockView", ST); renderStockButtons(); loadStock(); }

  function renderStockHead() {
    const d = sData;
    $("#sName").textContent = d ? `${stockLabel(d.symbol)} · ${d.symbol}${d.name && d.name !== d.symbol ? " · " + d.name : ""}` : `${stockLabel(ST.sym)} · ${ST.sym}`;
    if (!d || d.price == null) { $("#sPrice").textContent = "—"; $("#sChg").textContent = "—"; return; }
    const r = d.prevClose ? d.price / d.prevClose - 1 : null;
    const pe = $("#sPrice"); pe.textContent = (d.currency === "USD" && !d.symbol.startsWith("^") ? "$" : d.currency === "KRW" && !d.symbol.startsWith("^") ? "₩" : "") + sfmt(d.price, d); pe.className = "big mono " + cls(r);
    const ce = $("#sChg"); ce.textContent = pct(r); ce.className = "mono chg " + cls(r);
    $("#sSub").textContent = d.prevClose ? `전일 종가 ${sfmt(d.prevClose, d)} · ${d.currency}` : d.currency;
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
      if (j.currency === "KRW") sCh.candle.applyOptions({ priceFormat: { type: "price", precision: j.symbol.startsWith("^") ? 2 : 0, minMove: j.symbol.startsWith("^") ? 0.01 : 1 } }); else setPrecision(sCh.candle, bars[bars.length - 1].close, true);
      sCh.candle.setData(bars);
      sCh.vol.setData(bars.map(volBar));
      sCh.chart.timeScale().fitContent();
      sLast = { ...bars[bars.length - 1] };
      overlay(sBox, null);
      $("#sStatus").textContent = `야후 파이낸스 · ${IV_NAME[ST.iv]}봉 · ${ST.iv === "1" ? "15초" : "1분"}마다 갱신 · ${ST.mkt === "kospi" ? "국내 시세는 지연될 수 있음" : "약간 지연될 수 있음"}`;
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
    const priceText = sfmt(sData.price, sData);
    if (S.ref === "day") checkAlert("stock", name, sData.price, sData.prevClose, "day" + sData.prevClose, priceText, "전일 종가");
    else if (sLast) checkAlert("stock", name, sData.price, sLast.open, `${ST.iv}@${sLast.time}`, priceText, `${IV_NAME[ST.iv]}봉 시가`);
  }

  // =====================================================
  //  실시간 시세 연결 (업비트 원화 + 바이비트 USDT WebSocket)
  // =====================================================
  const mk = {};
  COINS.forEach(([s]) => { mk[s] = { krw: null, rate: null, usd: null, urate: null }; });
  let usdtKrw = null;
  const kimchi = (s) => { const m = mk[s]; return m && m.krw && m.usd && usdtKrw ? m.krw / (m.usd * usdtKrw) - 1 : null; };

  function renderCoinHead() {
    const m = mk[C.coin], nm = COIN_NAME[C.coin], k = kimchi(C.coin);
    const pe = $("#cPrice"), ce = $("#cChg");
    if (isBybit()) {
      $("#cName").textContent = `${nm} · ${C.coin}USDT 무기한 · 바이비트`;
      pe.textContent = m.usd == null ? "—" : "$" + usd(m.usd); pe.className = "big mono " + cls(m.urate);
      ce.textContent = m.urate == null ? "—" : pct(m.urate) + " 24시간"; ce.className = "mono chg " + cls(m.urate);
      $("#cSub").textContent = `업비트 ${m.krw == null ? "—" : "₩" + krw(m.krw)} · 김프 ${k == null ? "—" : pct(k)}`;
    } else {
      $("#cName").textContent = `${nm} · ${C.coin}/KRW · 업비트`;
      pe.textContent = m.krw == null ? "—" : "₩" + krw(m.krw); pe.className = "big mono " + cls(m.rate);
      ce.textContent = m.rate == null ? "—" : pct(m.rate) + " 전일대비"; ce.className = "mono chg " + cls(m.rate);
      $("#cSub").textContent = `바이비트 ${m.usd == null ? "—" : "$" + usd(m.usd)} · 김프 ${k == null ? "—" : pct(k)}`;
    }
  }

  let tq = false;
  function queueTicker() { if (tq) return; tq = true; requestAnimationFrame(() => { tq = false; renderTicker(); }); }
  function renderTicker() {
    const tk = $("#ticker"); tk.textContent = "";
    COINS.forEach(([s]) => {
      const m = mk[s]; if (m.krw == null) return;
      const sp = el("span", null, s); sp.append(el("strong", "mono " + cls(m.rate), "₩" + krw(m.krw) + " " + pct(m.rate))); tk.append(sp);
    });
    if (mk.BTC.usd != null) { const sp = el("span", null, "BTC 바이비트"); sp.append(el("strong", "mono " + cls(mk.BTC.urate), "$" + usd(mk.BTC.usd))); tk.append(sp); }
    const k = kimchi("BTC");
    if (k != null) { const sp = el("span", null, "김프"); sp.append(el("strong", "mono " + cls(k), pct(k))); tk.append(sp); }
    if (usdtKrw) { const sp = el("span", null, "USDT"); sp.append(el("strong", "mono", "₩" + krw(usdtKrw))); tk.append(sp); }
    if (sData && sData.price != null) {
      const r = sData.prevClose ? sData.price / sData.prevClose - 1 : null;
      const sp = el("span", null, stockLabel(sData.symbol)); sp.append(el("strong", "mono " + cls(r), sfmt(sData.price, sData) + " " + pct(r))); tk.append(sp);
    }
    if (!tk.children.length) tk.append(el("span", null, "시세 연결 중…"));
  }

  const live = { upbit: false, bybit: false };
  function renderLiveState() {
    const ok = isBybit() ? live.bybit : live.upbit;
    $("#liveState").textContent = ok ? "● 실시간" : "재연결 중…";
  }
  function connectWS(name, url, onOpen, onMessage) {
    let delay = 1000;
    const go = () => {
      let ws;
      try { ws = new WebSocket(url); } catch (_) { setTimeout(go, delay); return; }
      ws.binaryType = "blob";
      ws.onopen = () => { delay = 1000; live[name] = true; renderLiveState(); onOpen && onOpen(ws); };
      ws.onmessage = onMessage;
      ws.onclose = () => { live[name] = false; renderLiveState(); if (onOpen && onOpen.closed) onOpen.closed(ws); setTimeout(go, delay); delay = Math.min(delay * 2, 30000); };
      ws.onerror = () => { try { ws.close(); } catch (_) {} };
    };
    go();
  }

  // ---- 업비트 (원화 가격, 김프 계산용) ----
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
          if (!isBybit()) { liveUpbitBar(price); coinAlert(price); }
        }
      } catch (_) {}
    });

  // ---- 바이비트 (USDT 무기한: 시세 + 실시간 봉) ----
  let bybitWs = null, bybitKlineTopic = null, bybitPing = null;
  function bybitSubKline() {
    const want = isBybit() ? `kline.${BYBIT_IV[C.unit]}.${C.coin}USDT` : null;
    if (want === bybitKlineTopic) return;
    if (bybitWs && bybitWs.readyState === 1) {
      if (bybitKlineTopic) bybitWs.send(JSON.stringify({ op: "unsubscribe", args: [bybitKlineTopic] }));
      if (want) bybitWs.send(JSON.stringify({ op: "subscribe", args: [want] }));
      bybitKlineTopic = want;
    }
  }
  const bybitOpen = (ws) => {
    bybitWs = ws; bybitKlineTopic = null;
    ws.send(JSON.stringify({ op: "subscribe", args: COINS.map(([s]) => `tickers.${s}USDT`) }));
    bybitSubKline();
    clearInterval(bybitPing);
    bybitPing = setInterval(() => { try { ws.send(JSON.stringify({ op: "ping" })); } catch (_) {} }, 20000);
  };
  bybitOpen.closed = () => { bybitWs = null; bybitKlineTopic = null; clearInterval(bybitPing); };
  connectWS("bybit", "wss://stream.bybit.com/v5/public/linear", bybitOpen, (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (!m.topic) return;
      if (m.topic.startsWith("tickers.")) {
        const sym = m.topic.slice(8).replace(/USDT$/, "");
        const d = m.data || {};
        if (!mk[sym]) return;
        if (d.lastPrice != null) mk[sym].usd = +d.lastPrice;
        if (d.price24hPcnt != null) mk[sym].urate = +d.price24hPcnt;
        queueTicker();
        if (sym === C.coin) {
          renderCoinHead();
          if (isBybit() && d.lastPrice != null) coinAlert(+d.lastPrice);
        }
      } else if (m.topic === bybitKlineTopic && Array.isArray(m.data)) {
        m.data.forEach(liveBybitBar);
        const last = m.data[m.data.length - 1];
        if (last && isBybit()) { mk[C.coin].usd = +last.close; renderCoinHead(); coinAlert(+last.close); }
      }
    } catch (_) {}
  });

  renderOnline();
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
        const meta = el("div", "m", [n.source, n.date ? ago(n.date) : ""].filter(Boolean).join(" · "));
        const disc = el("button", "discuss", "💬 토론하기");
        disc.onclick = () => window.__bitbuyDiscuss && window.__bitbuyDiscuss(n);
        meta.append(disc);
        li.append(a, meta);
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
  const IMG_PREFIX = configured ? cfg.SUPABASE_URL.replace(/\/$/, "") + "/storage/v1/object/public/images/" : "";

  // ---------- 닉네임 자동 생성 + 4자리 식별코드 ----------
  // 이 브라우저만의 무작위 값에서 4자리 코드를 만들어 닉네임 뒤에 붙여요. 예) 존버고래(89c2)
  const ADJ = ["존버", "떡상", "풀매수", "단타", "새벽", "불장", "익절", "야수", "차트", "김프", "알트", "스윙"];
  const NOUN = ["고래", "개미", "러버", "도사", "요정", "장인", "헌터", "킹", "냥이", "곰", "황소", "펭귄"];
  let deviceId = store.get("bitbuy.device", null);
  if (!deviceId || !/^[0-9a-f]{16}$/.test(deviceId)) {
    deviceId = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    store.set("bitbuy.device", deviceId);
  }
  const myTag = (() => { let h = 2166136261; for (const ch of deviceId + "bitbuy") { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) & 0xffff).toString(16).padStart(4, "0"); })();
  const nickInput = $("#nickInput");
  let savedNick = store.get("bitbuy.nick", "");
  if (!savedNick || savedNick.length < 2) {
    savedNick = ADJ[Math.floor(Math.random() * ADJ.length)] + NOUN[Math.floor(Math.random() * NOUN.length)];
    store.set("bitbuy.nick", savedNick);
  }
  nickInput.value = savedNick;
  $("#nickTag").textContent = "(" + myTag + ")";
  nickInput.addEventListener("change", () => {
    const v = nickInput.value.trim().slice(0, 8);
    if (v.length >= 2) { nickInput.value = v; store.set("bitbuy.nick", v); } else nickInput.value = store.get("bitbuy.nick", savedNick);
  });
  const myNick = () => nickInput.value.trim().slice(0, 8);
  function needNick() {
    if (myNick().length >= 2) return false;
    nickInput.focus(); nickInput.style.borderColor = "#f0505a";
    setTimeout(() => (nickInput.style.borderColor = ""), 2500);
    return true;
  }
  // 이름 표시: 봇이면 BOT 배지, 사람이면 닉네임(코드)
  const who = (o) => {
    const s = el("span", o.is_bot ? "bot-name" : "nick-name", o.nickname);
    if (o.is_bot) s.prepend(el("b", "bot-badge", "BOT"));
    else if (o.tag) s.append(el("span", "tag", "(" + o.tag + ")"));
    return s;
  };

  if (!sb) {
    const msg = "게시판과 채팅을 쓰려면 config.js에 Supabase 주소와 키를 넣어 주세요.\n(설치 안내서 3단계 참고)";
    $("#boardView").textContent = ""; $("#boardView").append(el("div", "empty", msg));
    $("#msgs").textContent = ""; $("#msgs").append(el("div", "status", msg));
    $("#chatState").textContent = "설정 필요"; $("#writeBtn").disabled = true; $("#chatSend").disabled = true;
    return;
  }

  // ---------- 게시판 ----------
  // 값(DB에 저장되는 이름) → 화면 표시 이름
  const CATS = [["전체", "전체"], ["인기", "🔥 인기글"], ["시황분석", "시황/분석"], ["자유", "자유/잡담"], ["인증", "수익/손실 인증"], ["뉴스토론", "뉴스/정보"], ["질문", "질문"]];
  const CAT_LABEL = Object.fromEntries(CATS);
  const WRITE_CATS = CATS.filter(([v]) => v !== "전체" && v !== "인기");
  const POPULAR = 5;           // 추천 5개 이상이면 인기글
  const NEW_MIN = 30;          // 30분 이내 글은 NEW
  const PAGE = 20;
  let curCat = "전체", view = "list", openId = null, posts = [], pinned = [], hasMore = false;
  let liked = store.get("bitbuy.liked", []), disliked = store.get("bitbuy.disliked", []);
  let hideBot = store.get("bitbuy.hideBot", false);

  const tabs = $("#tabs");
  function renderTabs() {
    tabs.textContent = "";
    CATS.forEach(([v, label]) => {
      const b = el("button", (v === curCat ? "on" : "") + (v === "인기" ? " hot" : ""), label);
      b.onclick = () => { curCat = v; renderTabs(); showList(true); };
      tabs.append(b);
    });
    const botT = el("button", "bot-toggle" + (hideBot ? " on" : ""), hideBot ? "🤖 봇글 숨김" : "🤖 봇글 보기");
    botT.onclick = () => { hideBot = !hideBot; store.set("bitbuy.hideBot", hideBot); renderTabs(); showList(true); };
    tabs.append(botT);
  }
  renderTabs();
  $("#writeBtn").onclick = () => showWrite();

  const boardView = $("#boardView");
  function boardMsg(text) { boardView.textContent = ""; boardView.append(el("div", "empty", text)); }
  const COLS = "id,cat,title,nickname,tag,likes,dislikes,images,created_at,is_bot,comments(count)";

  async function fetchPosts(reset) {
    const from = reset ? 0 : posts.length;
    let q = sb.from("posts").select(COLS);
    if (curCat === "인기") q = q.gte("likes", POPULAR).order("likes", { ascending: false });
    else q = q.order("created_at", { ascending: false });
    q = q.range(from, from + PAGE - 1);
    if (curCat !== "전체" && curCat !== "인기") q = q.eq("cat", curCat);
    if (hideBot) q = q.eq("is_bot", false);
    const { data, error } = await q;
    if (error) throw error;
    posts = reset ? data : posts.concat(data);
    hasMore = data.length === PAGE;
    // '전체' 첫 화면에는 최근 2일 인기글 3개를 위에 고정
    if (reset && curCat === "전체") {
      const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const r = await sb.from("posts").select(COLS).gte("likes", POPULAR).gte("created_at", since).order("likes", { ascending: false }).limit(3);
      pinned = r.data || [];
    } else if (reset) pinned = [];
  }

  async function showList(reset) {
    view = "list"; openId = null;
    if (location.hash.startsWith("#post-")) history.replaceState(null, "", location.pathname);
    if (reset) boardMsg("불러오는 중…");
    try { await fetchPosts(reset); } catch (_) { boardMsg("게시판을 불러오지 못했어요."); return; }
    if (view !== "list") return;
    renderList();
  }

  function postRow(p, isPinned) {
    const row = el("div", "post" + (p.is_bot ? " is-bot" : "") + (isPinned ? " pinned" : ""));
    row.append(el("span", "cat", isPinned ? "🔥 인기" : (CAT_LABEL[p.cat] || p.cat)));
    const box = el("div", "pbox");
    const ti = el("div", "ti");
    ti.append(el("span", null, p.title));
    const cnt = (p.comments && p.comments[0] && p.comments[0].count) || 0;
    if (cnt) ti.append(el("span", "ccount", `[${cnt}]`));
    if (p.images && p.images.length) ti.append(el("span", "imgicon", "🖼"));
    if (Date.now() - Date.parse(p.created_at) < NEW_MIN * 60000) ti.append(el("b", "new-badge", "NEW"));
    if (p.likes >= POPULAR && !isPinned) ti.append(el("span", "hoticon", "🔥"));
    box.append(ti);
    const mt = el("div", "mt");
    mt.append(who(p), el("span", null, ago(p.created_at)), el("span", null, "👍 " + p.likes), el("span", null, "👎 " + (p.dislikes || 0)));
    box.append(mt); row.append(box);
    row.onclick = () => showDetail(p.id);
    return row;
  }

  function renderList() {
    boardView.textContent = "";
    pinned.forEach((p) => boardView.append(postRow(p, true)));
    if (!posts.length) {
      boardView.append(el("div", "empty", curCat === "인기" ? `아직 추천 ${POPULAR}개 이상 받은 글이 없어요.` : "아직 글이 없어요.\n첫 글을 남겨 보세요!"));
      return;
    }
    posts.forEach((p) => boardView.append(postRow(p, false)));
    if (hasMore) {
      const more = el("button", "btn ghost more", "더 보기");
      more.onclick = async () => { more.disabled = true; try { await fetchPosts(false); renderList(); } catch (_) { more.disabled = false; } };
      boardView.append(more);
    }
  }

  // ---------- 이미지 (붙여넣기·선택 → 줄여서 업로드) ----------
  async function shrinkImage(file) {
    if (file.type === "image/gif" && file.size < 3 * 1024 * 1024) return { blob: file, ext: "gif", type: "image/gif" };
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
      const max = 1600, sc = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      const blob = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.85));
      return { blob, ext: "jpg", type: "image/jpeg" };
    } finally { URL.revokeObjectURL(url); }
  }
  async function uploadImage(file) {
    const { blob, ext, type } = await shrinkImage(file);
    if (blob.size > 3 * 1024 * 1024) throw new Error("이미지가 너무 커요 (3MB 이하)");
    const path = `p/${new Date().toISOString().slice(0, 10)}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await sb.storage.from("images").upload(path, blob, { contentType: type, upsert: false });
    if (error) throw error;
    return IMG_PREFIX + path;
  }

  function showWrite(prefill) {
    view = "write";
    boardView.textContent = "";
    const f = el("form", "form");
    const sel = el("select");
    WRITE_CATS.forEach(([v, label]) => { const o = el("option", null, label); o.value = v; sel.append(o); });
    sel.value = (prefill && prefill.cat) || (WRITE_CATS.some(([v]) => v === curCat) ? curCat : "자유");
    const ti = el("input"); ti.placeholder = "제목 (2~80자)"; ti.maxLength = 80;
    const bd = el("textarea"); bd.placeholder = "내용을 입력하세요.\n📷 차트 캡처는 Ctrl+V로 바로 붙여넣을 수 있어요. (최대 4장)\n투자 권유·리딩방 홍보·개인정보 게시는 삭제됩니다."; bd.maxLength = 5000;
    if (prefill) { ti.value = (prefill.title || "").slice(0, 80); bd.value = prefill.body || ""; }
    const imgs = []; // {url}
    const thumbs = el("div", "thumbs");
    const imgBtn = el("button", "btn ghost", "📷 이미지"); imgBtn.type = "button";
    const fileIn = el("input"); fileIn.type = "file"; fileIn.accept = "image/*"; fileIn.multiple = true; fileIn.style.display = "none";
    const imgNote = el("span", "muted small", "");
    const err = el("div", "err");
    function renderThumbs() {
      thumbs.textContent = "";
      imgs.forEach((it, i) => {
        const w = el("div", "thumb");
        const im = el("img"); im.src = it.url; im.alt = "";
        const x = el("button", "x", "✕"); x.type = "button"; x.onclick = () => { imgs.splice(i, 1); renderThumbs(); };
        w.append(im, x); thumbs.append(w);
      });
      imgNote.textContent = imgs.length ? `${imgs.length}/4장` : "";
    }
    async function addFiles(files) {
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        if (imgs.length >= 4) { err.textContent = "이미지는 4장까지 올릴 수 있어요."; break; }
        imgNote.textContent = "업로드 중…";
        try { imgs.push({ url: await uploadImage(file) }); renderThumbs(); err.textContent = ""; }
        catch (e) { err.textContent = "이미지 업로드 실패: " + (e.message || e); renderThumbs(); }
      }
    }
    imgBtn.onclick = () => fileIn.click();
    fileIn.onchange = () => { addFiles([...fileIn.files]); fileIn.value = ""; };
    bd.addEventListener("paste", (e) => {
      const files = [...(e.clipboardData ? e.clipboardData.items : [])].filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
    bd.addEventListener("dragover", (e) => e.preventDefault());
    bd.addEventListener("drop", (e) => { const fs = [...e.dataTransfer.files]; if (fs.length) { e.preventDefault(); addFiles(fs); } });

    const row = el("div", "row");
    const ok = el("button", "btn", "등록"); ok.type = "submit";
    const cancel = el("button", "btn ghost", "취소"); cancel.type = "button"; cancel.onclick = () => showList(true);
    const tools = el("div", "row tools"); tools.append(imgBtn, imgNote, fileIn);
    row.append(ok, cancel);
    const by = el("div", "mt"); by.append(el("span", null, "작성자: "), who({ nickname: myNick(), tag: myTag }));
    f.append(by, sel, ti, bd, tools, thumbs, err, row);
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (needNick()) { err.textContent = "채팅창 위에서 닉네임을 정해 주세요."; return; }
      const title = ti.value.trim(), body = bd.value.trim();
      if (title.length < 2 || body.length < 2) { err.textContent = "제목과 내용을 2자 이상 입력해 주세요."; return; }
      const last = store.get("bitbuy.lastPost", 0);
      if (Date.now() - last < 30000) { err.textContent = "글은 30초에 한 번만 쓸 수 있어요."; return; }
      ok.disabled = true;
      const row = { cat: sel.value, title, body, nickname: myNick(), tag: myTag };
      if (imgs.length) row.images = imgs.map((x) => x.url);
      const { data, error } = await sb.from("posts").insert(row).select("id").single();
      if (error) { ok.disabled = false; err.textContent = "저장하지 못했어요: " + error.message; return; }
      store.set("bitbuy.lastPost", Date.now());
      showDetail(data.id);
    };
    boardView.append(f);
    (prefill ? bd : ti).focus();
  }
  // 뉴스의 [토론하기] 버튼에서 부르는 입구
  window.__bitbuyDiscuss = (n) => {
    $("#board").scrollIntoView({ behavior: "smooth", block: "start" });
    showWrite({ cat: "뉴스토론", title: "[토론] " + n.title, body: `📰 ${n.source || "뉴스"}\n${n.link}\n\n` });
  };

  function linkify(text, box) {
    String(text).split(/(https?:\/\/[^\s]+)/g).forEach((part, i) => {
      if (i % 2) { const a = el("a", null, part.length > 60 ? part.slice(0, 57) + "…" : part); a.href = part; a.target = "_blank"; a.rel = "noopener noreferrer nofollow ugc"; box.append(a); }
      else box.append(document.createTextNode(part));
    });
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
    const dm = el("div", "mt"); dm.append(el("span", null, (CAT_LABEL[p.cat] || p.cat) + " · "), who(p), el("span", null, " · " + ago(p.created_at)));
    const bodyEl = el("div", "body"); linkify(p.body, bodyEl);
    d.append(back, el("h3", null, p.title), dm, bodyEl);
    // 이미지: 우리 저장소 주소만 표시
    const pics = (p.images || []).filter((u) => typeof u === "string" && IMG_PREFIX && u.startsWith(IMG_PREFIX));
    if (pics.length) {
      const g = el("div", "pics");
      pics.forEach((u) => { const a = el("a"); a.href = u; a.target = "_blank"; a.rel = "noopener"; const im = el("img"); im.src = u; im.alt = "첨부 이미지"; im.loading = "lazy"; a.append(im); g.append(a); });
      d.append(g);
    }

    const acts = el("div", "actions");
    const up = el("button", "btn ghost", (liked.includes(id) ? "👍 " : "👍 추천 ") + p.likes);
    const down = el("button", "btn ghost", (disliked.includes(id) ? "👎 " : "👎 비추천 ") + (p.dislikes || 0));
    const voted = liked.includes(id) || disliked.includes(id);
    up.disabled = down.disabled = voted;
    up.onclick = async () => {
      up.disabled = down.disabled = true;
      const { data: n, error: e2 } = await sb.rpc("like_post", { pid: id });
      if (e2) { up.disabled = down.disabled = false; return; }
      liked.push(id); store.set("bitbuy.liked", liked.slice(-500));
      up.textContent = "👍 " + n;
      if (n === POPULAR) up.textContent += " 🔥 인기글 등극!";
    };
    down.onclick = async () => {
      up.disabled = down.disabled = true;
      const { data: n, error: e2 } = await sb.rpc("dislike_post", { pid: id });
      if (e2) { up.disabled = down.disabled = false; return; }
      disliked.push(id); store.set("bitbuy.disliked", disliked.slice(-500));
      down.textContent = "👎 " + n;
    };
    const share = el("button", "btn ghost", "링크 복사");
    share.onclick = async () => { try { await navigator.clipboard.writeText(location.origin + "/#post-" + id); share.textContent = "복사됨!"; } catch (_) {} };
    acts.append(up, down, share);
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
      const { error: e3 } = await sb.from("comments").insert({ post_id: id, body: t, nickname: myNick(), tag: myTag });
      cb.disabled = false;
      if (!e3) { ci.value = ""; loadComments(); }
    };
    cw.append(cf); d.append(cw); boardView.append(d);

    async function loadComments() {
      const { data: cs } = await sb.from("comments").select("*").eq("post_id", id).order("created_at", { ascending: true }).limit(300);
      list.textContent = "";
      if (!cs || !cs.length) { list.append(el("div", "status", "첫 댓글을 남겨 보세요.")); return; }
      cs.forEach((c) => {
        const r = el("div", "cmt" + (c.is_bot ? " is-bot" : ""));
        const w = el("div", "who"); w.append(who(c), el("span", null, " · " + ago(c.created_at)));
        const tx = el("div", "tx"); linkify(c.body, tx);
        r.append(w, tx);
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
  const newBtn = $("#newMsgBtn");
  let chat = [], unseen = 0;
  const atBottom = () => msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 60;
  function renderChat(forceBottom) {
    const stick = forceBottom || atBottom();
    const prevH = msgsEl.scrollHeight, prevTop = msgsEl.scrollTop;
    msgsEl.textContent = "";
    if (!chat.length) msgsEl.append(el("div", "status", "아직 대화가 없어요. 아래 버튼으로 먼저 인사해 보세요 👋"));
    chat.forEach((c) => {
      if (c.is_bot) {
        const r = el("div", "msg sys");
        const b = el("div", "bub"); b.append(el("div", "tx", c.body), el("div", "tm", hhmm(c.created_at)));
        r.append(b); msgsEl.append(r); return;
      }
      const mine = c.tag === myTag;
      const r = el("div", "msg" + (mine ? " me" : ""));
      const b = el("div", "bub");
      if (!mine) { const nm = el("div", "nm"); nm.append(who(c)); b.append(nm); }
      b.append(el("div", "tx", c.body), el("div", "tm", hhmm(c.created_at)));
      r.append(b); msgsEl.append(r);
    });
    if (stick) { msgsEl.scrollTop = msgsEl.scrollHeight; unseen = 0; }
    else msgsEl.scrollTop = prevTop + (msgsEl.scrollHeight - prevH > 0 ? 0 : 0);
    renderNewBtn();
  }
  function renderNewBtn() {
    newBtn.hidden = unseen === 0;
    newBtn.textContent = `↓ 새 메시지 ${unseen}개`;
  }
  newBtn.onclick = () => { unseen = 0; msgsEl.scrollTop = msgsEl.scrollHeight; renderNewBtn(); };
  msgsEl.addEventListener("scroll", () => { if (atBottom() && unseen) { unseen = 0; renderNewBtn(); } });
  function addMsg(row) {
    if (chat.some((c) => c.id === row.id)) return false;
    chat.push(row); if (chat.length > 150) chat.shift();
    return true;
  }

  (async () => {
    const { data, error } = await sb.from("chat").select("*").order("created_at", { ascending: false }).limit(60);
    if (error) { $("#chatState").textContent = "불러오기 실패"; return; }
    data.reverse().forEach(addMsg);
    renderChat(true);
  })();

  sb.channel("chat-feed")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat" }, (payload) => {
      const wasBottom = atBottom();
      if (!addMsg(payload.new)) return;
      if (!wasBottom && payload.new.tag !== myTag) unseen++;
      renderChat(payload.new.tag === myTag && !payload.new.is_bot);
      // 봇 급등락 메시지는 짧게 소리로도 알림 (소리 켠 사람만)
      if (payload.new.is_bot && S.soundOn && /급등|급락/.test(payload.new.body)) { ensureAudio(); beep(1250, audio.currentTime + 0.02, 0.12); }
    })
    .subscribe((s) => { $("#chatState").textContent = s === "SUBSCRIBED" ? "● 실시간" : "연결 중…"; });

  // 도배·링크 방지
  const LINK_RE = /(https?:\/\/|www\.|t\.me\/|open\.kakao|bit\.ly|discord\.gg|\b[a-z0-9-]+\.(com|net|io|kr|xyz|me|gg|link|site|top)\b)/i;
  let lastSend = 0, lastText = "", lastTextAt = 0;
  const chatWarn = (t) => { const s = $("#chatState"); s.textContent = t; s.classList.add("warn"); setTimeout(() => { s.textContent = "● 실시간"; s.classList.remove("warn"); }, 2500); };
  async function sendChat(text) {
    if (needNick()) return false;
    const t = text.trim();
    if (!t) return false;
    if (Date.now() - lastSend < 3000) { chatWarn("3초에 한 번만 보낼 수 있어요"); return false; }
    if (t === lastText && Date.now() - lastTextAt < 30000) { chatWarn("같은 말을 반복할 수 없어요"); return false; }
    if (LINK_RE.test(t)) { chatWarn("⚠ 링크는 채팅에 올릴 수 없어요"); return false; }
    lastSend = Date.now(); lastText = t; lastTextAt = Date.now();
    const btn = $("#chatSend"); btn.disabled = true;
    const { data, error } = await sb.from("chat").insert({ nickname: myNick(), tag: myTag, body: t }).select().single();
    btn.disabled = false;
    if (error) { chatWarn("전송 실패"); return false; }
    addMsg(data); renderChat(true);
    return true;
  }
  $("#chatForm").onsubmit = async (e) => {
    e.preventDefault();
    const inp = $("#chatInput");
    if (await sendChat(inp.value)) inp.value = "";
    inp.focus();
  };
  // 원클릭 리액션
  const REACTS = ["🚀 가즈아", "💧 돔황챠", "🔥 불장", "🐳 고래 등장", "😭 물렸다", "🙏 존버", "📉 숏 가자", "🎉 익절"];
  const rbox = $("#reacts");
  REACTS.forEach((r) => { const b = el("button", null, r); b.type = "button"; b.onclick = () => sendChat(r); rbox.append(b); });

  // ---------- 접속자 수 ----------
  const presence = sb.channel("online", { config: { presence: { key: deviceId + Math.random().toString(36).slice(2, 6) } } });
  presence
    .on("presence", { event: "sync" }, () => {
      const n = Object.keys(presence.presenceState()).length;
      realOnline = n; renderOnline();
    })
    .subscribe(async (s) => { if (s === "SUBSCRIBED") await presence.track({ at: Date.now() }); });

  // "n분 전", NEW 표시 갱신
  setInterval(() => { if (view === "list" && posts.length) renderList(); }, 60000);
})();
