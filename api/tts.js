// /api/tts?text=비트코인 2퍼센트 급등
// 한국어 문장을 음성(mp3)으로 바꿔 돌려줍니다. 같은 문장은 하루 동안 저장(캐시)돼요.
// (구글 번역의 비공식 음성 기능을 사용합니다. 막히면 화면에서 기기 내장 음성으로 대신 읽어요.)

export default async function handler(req, res) {
  const text = String((req.query || {}).text || "").trim();
  if (!/^[가-힣A-Za-z0-9\s%.]{1,60}$/.test(text)) {
    res.status(400).json({ error: "bad_text" });
    return;
  }
  try {
    const url = "https://translate.google.com/translate_tts?ie=UTF-8&tl=ko&client=tw-ob&ttsspeed=1&q=" + encodeURIComponent(text);
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Referer: "https://translate.google.com/",
      },
    });
    if (!r.ok) throw new Error("tts " + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 500) throw new Error("too_small");
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, s-maxage=86400, max-age=86400, stale-while-revalidate=604800");
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).json({ error: "tts_failed" });
  }
}
