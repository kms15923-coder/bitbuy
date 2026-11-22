// /api/news — 구글 뉴스에서 '비트코인' 기사를 모아 JSON으로 돌려줍니다.
// Vercel이 결과를 5분 동안 저장(캐시)하므로 방문자가 많아도 부담이 적어요.

export const FEEDS = [
  "https://news.google.com/rss/search?q=%EB%B9%84%ED%8A%B8%EC%BD%94%EC%9D%B8+when:2d&hl=ko&gl=KR&ceid=KR:ko",
];

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}
const tag = (xml, name) => {
  const m = xml.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">"));
  return m ? decode(m[1]) : "";
};

export function parseRss(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const it = m[1];
    const source = tag(it, "source");
    let title = tag(it, "title");
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    const link = tag(it, "link");
    const pub = tag(it, "pubDate");
    if (!title || !/^https?:\/\//.test(link)) continue;
    items.push({ title, link, source, date: pub ? new Date(pub).toISOString() : null });
  }
  return items;
}

export default async function handler(req, res) {
  try {
    const results = await Promise.allSettled(
      FEEDS.map((u) => fetch(u, { headers: { "User-Agent": "Mozilla/5.0 BitbuyNewsBot" } }).then((r) => r.text()))
    );
    let items = [];
    for (const r of results) if (r.status === "fulfilled") items = items.concat(parseRss(r.value));
    // 같은 제목 제거 + 최신순
    const seen = new Set();
    items = items.filter((i) => (seen.has(i.title) ? false : seen.add(i.title)))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 30);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ items, updated: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ items: [], error: "news_fetch_failed" });
  }
}
