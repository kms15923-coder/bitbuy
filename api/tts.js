// /api/tts?text=비트코인 2퍼센트 급등
// 한국어 문장을 여성 음성(mp3)으로 바꿔 돌려줍니다. 같은 문장은 하루 동안 저장(캐시)돼요.
//  1순위: 마이크로소프트 엣지 '선희'(SunHi) 여성 음성  — 자연스러운 젊은 여성 목소리
//  2순위: 구글 번역 음성
// 둘 다 공식 API가 아닌 무료 읽어주기 기능이라 막힐 수 있어요. 그럴 땐 화면에서 다른 방법으로 대신 읽어요.
// 어떤 음성이 쓰였는지는 응답 헤더 x-tts-engine 에 적어 보냅니다.

import WebSocket from "ws";
import crypto from "node:crypto";

const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const GEC_VERSION = "1-130.0.2849.68";
const VOICE = "Microsoft Server Speech Text to Speech Voice (ko-KR, SunHiNeural)";

function secMsGec() {
  let ticks = Math.floor(Date.now() / 1000) + 11644473600; // 1601년 기준 초
  ticks -= ticks % 300;                                    // 5분 단위
  const s = (BigInt(ticks) * 10000000n).toString() + TOKEN;
  return crypto.createHash("sha256").update(s, "ascii").digest("hex").toUpperCase();
}
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function edgeTTS(text, { pitch = "+6Hz", rate = "+4%" } = {}) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID().replace(/-/g, "");
    const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${GEC_VERSION}&ConnectionId=${id}`;
    const ws = new WebSocket(url, {
      headers: {
        Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
        Pragma: "no-cache", "Cache-Control": "no-cache", "Accept-Language": "ko-KR,ko;q=0.9",
      },
    });
    const chunks = [];
    const timer = setTimeout(() => { try { ws.terminate(); } catch (_) {} reject(new Error("edge timeout")); }, 9000);
    const date = new Date().toString();
    ws.on("open", () => {
      ws.send(`X-Timestamp:${date}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`);
      ws.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${date}Z\r\nPath:ssml\r\n\r\n` +
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ko-KR'><voice name='${VOICE}'>` +
        `<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${esc(text)}</prosody></voice></speak>`);
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.from(data);
        const hlen = buf.readUInt16BE(0);
        const head = buf.subarray(2, 2 + hlen).toString();
        if (head.includes("Path:audio")) chunks.push(buf.subarray(2 + hlen));
      } else if (String(data).includes("Path:turn.end")) {
        clearTimeout(timer);
        try { ws.close(); } catch (_) {}
        const out = Buffer.concat(chunks);
        out.length > 500 ? resolve(out) : reject(new Error("edge empty"));
      }
    });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
    ws.on("unexpected-response", (_req, res) => { clearTimeout(timer); reject(new Error("edge " + res.statusCode)); });
  });
}

async function googleTTS(text) {
  const url = "https://translate.google.com/translate_tts?ie=UTF-8&tl=ko&client=tw-ob&ttsspeed=1&q=" + encodeURIComponent(text);
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Referer: "https://translate.google.com/",
    },
  });
  if (!r.ok) throw new Error("google " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 500) throw new Error("google empty");
  return buf;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const text = String(q.text || "").trim();
  const engine = String(q.engine || "auto");
  if (!/^[가-힣A-Za-z0-9\s%.\-]{1,60}$/.test(text)) {
    res.status(400).json({ error: "bad_text" });
    return;
  }
  const tries = engine === "google" ? [["google", googleTTS]] : engine === "edge" ? [["edge", edgeTTS]] : [["edge", edgeTTS], ["google", googleTTS]];
  const errs = [];
  for (const [name, fn] of tries) {
    try {
      const buf = await fn(text);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("x-tts-engine", name);
      res.setHeader("Access-Control-Expose-Headers", "x-tts-engine");
      res.setHeader("Cache-Control", "public, s-maxage=86400, max-age=86400, stale-while-revalidate=604800");
      res.status(200).send(buf);
      return;
    } catch (e) { errs.push(name + ": " + e.message); }
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(502).json({ error: "tts_failed", detail: errs });
}
