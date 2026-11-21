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
  const krw = (n) => n == null ? "—" : (n >= 100 ? Math.round(n).toLocaleString("ko-KR") : n.toLocaleString("ko-KR", { maximumFractionDigits: 2 }));
  const usd = (n) => n == null ? "—" : (n >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
  const pct = (r) => r == null ? "—" : (r >= 0 ? "+" : "") + (r * 100).toFixed(2) + "%";
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

  // =====================================================
  //  1. 실시간 시세 (업비트 + 바이낸스 WebSocket)
  // =====================================================
  const COINS = [
    { sym: "BTC", name: "비트코인" },
    { sym: "ETH", name: "이더리움" },
    { sym: "XRP", name: "리플" },
    { sym: "SOL", name: "솔라나" },
  ];
  const mk = {}; // sym -> { krw, rate, usd }
  let usdtKrw = null;
  COINS.forEach((c) => { mk[c.sym] = { krw: null, rate: null, usd: null }; });

  const rows = $("#coinRows");
  COINS.forEach((c) => {
    const tr = el("tr");
    const td = el("td"); const d = el("div", "coin"); d.append(el("span", null, c.name), el("em", null, c.sym)); td.append(d);
    c.krwEl = el("td", "mono", "—"); c.usdEl = el("td", "mono", "—"); c.chgEl = el("td", "mono", "—");
    tr.append(td, c.krwEl, c.usdEl, c.chgEl); rows.append(tr);
  });

  let renderQueued = false;
  function queueRender() {
    if (renderQueued) return; renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; renderMarket(); });
  }

  function kimchi() {
    const b = mk.BTC;
    if (!b.krw || !b.usd || !usdtKrw) return null;
    return b.krw / (b.usd * usdtKrw) - 1;
  }

  let lastBtc = null;
  function renderMarket() {
    COINS.forEach((c) => {
      const m = mk[c.sym];
      c.krwEl.textContent = krw(m.krw);
      c.usdEl.textContent = m.usd == null ? "—" : "$" + usd(m.usd);
      c.chgEl.textContent = pct(m.rate);
      c.chgEl.className = "mono " + cls(m.rate);
    });
    const b = mk.BTC;
    if (b.krw != null) {
      const big = $("#btcKrw");
      big.textContent = "₩" + krw(b.krw);
      big.className = "big mono " + cls(b.rate);
      if (lastBtc != null && lastBtc !== b.krw) { big.classList.remove("flash"); void big.offsetWidth; big.classList.add("flash"); }
      lastBtc = b.krw;
    }
    $("#btcUsd").textContent = b.usd == null ? "—" : "$" + usd(b.usd);
    const ch = $("#btcChg"); ch.textContent = pct(b.rate) + " (전일대비)"; ch.className = "mono " + cls(b.rate);
    const k = kimchi(); const ke = $("#kimp"); ke.textContent = k == null ? "—" : pct(k); ke.className = "mono " + cls(k);

    const tk = $("#ticker"); tk.textContent = "";
    COINS.forEach((c) => {
      const m = mk[c.sym]; if (m.krw == null) return;
      const s = el("span", null, c.sym);
      s.append(el("strong", "mono " + cls(m.rate), "₩" + krw(m.krw) + " " + pct(m.rate)));
      tk.append(s);
    });
    if (k != null) { const s = el("span", null, "김프"); s.append(el("strong", "mono " + cls(k), pct(k))); tk.append(s); }
    if (usdtKrw) { const s = el("span", null, "USDT"); s.append(el("strong", "mono", "₩" + krw(usdtKrw))); tk.append(s); }
    if (!tk.children.length) tk.append(el("span", null, "시세 연결 중…"));

    if (b.krw != null) pushLive(b.krw);
  }

  const live = { upbit: false, binance: false };
  function renderLiveState() {
    const s = $("#liveState");
    if (live.upbit && live.binance) s.textContent = "● 실시간";
    else if (live.upbit || live.binance) s.textContent = "● 일부 연결됨";
    else s.textContent = "재연결 중…";
  }

  // 끊기면 자동으로 다시 연결
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

  // 업비트: 원화 가격 + 전일대비
  connectWS("upbit", "wss://api.upbit.com/websocket/v1",
    (ws) => ws.send(JSON.stringify([
      { ticket: "bitbuy-" + Math.random().toString(36).slice(2) },
      { type: "ticker", codes: COINS.map((c) => "KRW-" + c.sym).concat("KRW-USDT") },
      { format: "SIMPLE" },
    ])),
    async (ev) => {
      try {
        const txt = typeof ev.data === "string" ? ev.data : await ev.data.text();
        const d = JSON.parse(txt);
        const code = d.cd || d.code, price = d.tp ?? d.trade_price, rate = d.scr ?? d.signed_change_rate;
        if (!code) return;
        if (code === "KRW-USDT") usdtKrw = price;
        else { const sym = code.slice(4); if (mk[sym]) { mk[sym].krw = price; mk[sym].rate = rate; } }
        queueRender();
      } catch (_) {}
    });

  // 바이낸스: 달러(USDT) 가격
  connectWS("binance",
    "wss://stream.binance.com:9443/stream?streams=" + COINS.map((c) => c.sym.toLowerCase() + "usdt@miniTicker").join("/"),
    null,
    (ev) => {
      try {
        const d = JSON.parse(ev.data).data;
        const sym = d.s.replace("USDT", "");
        if (mk[sym]) { mk[sym].usd = parseFloat(d.c); queueRender(); }
      } catch (_) {}
    });

  // ---------- 차트 (5분봉 + 실시간 반영) ----------
  let candles = []; // [{t, c}]
  async function loadCandles() {
    try {
      const r = await fetch("/api/candles");
      if (!r.ok) throw 0;
      const j = await r.json();
      if (Array.isArray(j.candles) && j.candles.length) { candles = j.candles; drawSpark(); }
    } catch (_) {}
  }
  function pushLive(price) {
    if (!candles.length) return;
    const bucket = Math.floor(Date.now() / 300000) * 300000;
    const last = candles[candles.length - 1];
    if (last.t >= bucket) last.c = price;
    else { candles.push({ t: bucket, c: price }); if (candles.length > 120) candles.shift(); }
    drawSpark();
  }
  function drawSpark() {
    const cv = $("#spark"); const ctx = cv.getContext("2d");
    const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w) return;
    cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (candles.length < 2) return;
    const v = candles.map((c) => c.c);
    const min = Math.min(...v), max = Math.max(...v), pad = 16;
    const x = (i) => (i / (v.length - 1)) * (w - 8);
    const y = (p) => pad + (1 - (p - min) / (max - min || 1)) * (h - pad * 2);
    const up = v[v.length - 1] >= v[0];
    const col = up ? "#f0505a" : "#3b82f6";
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, up ? "rgba(240,80,90,.22)" : "rgba(59,130,246,.22)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath(); v.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p)) : ctx.moveTo(x(i), y(p))));
    ctx.lineTo(x(v.length - 1), h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); v.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p)) : ctx.moveTo(x(i), y(p))));
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x(v.length - 1), y(v[v.length - 1]), 3.5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    ctx.fillStyle = "#5d6876"; ctx.font = "11px JetBrains Mono, monospace";
    ctx.fillText(krw(max), 6, 12); ctx.fillText(krw(min), 6, h - 4);
  }
  loadCandles(); setInterval(loadCandles, 5 * 60 * 1000);
  window.addEventListener("resize", drawSpark);

  // =====================================================
  //  2. 뉴스 (서버 함수 /api/news 가 5분마다 수집)
  // =====================================================
  async function loadNews() {
    const ul = $("#newsList");
    try {
      const r = await fetch("/api/news");
      if (!r.ok) throw 0;
      const j = await r.json();
      ul.textContent = "";
      (j.items || []).slice(0, 12).forEach((n) => {
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
