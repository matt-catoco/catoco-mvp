import "server-only";

/**
 * Best-effort Open Graph preview for a pasted booking_link. Server-only —
 * never called from client code. Deliberately lightweight: og:title/
 * og:description/og:image are simple <meta> tags in <head>, so a regex over
 * the first chunk of HTML is enough — no need for a full DOM/HTML parser
 * dependency just for this.
 *
 * Explicitly NOT attempting price/capacity/amenities extraction — those are
 * typically JS-rendered on real inventory sites (Airbnb, Vrbo, hotel
 * platforms) and not present in the static HTML a plain fetch sees. Getting
 * them would need headless-browser rendering or real vendor API access —
 * that's the already-planned API/MCP integration phase, not this.
 */

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 100_000; // OG tags are always in <head>; no need to read further
const USER_AGENT = "Mozilla/5.0 (compatible; CatacoLinkPreview/1.0; +https://catoco.co)";

export type LinkPreviewResult = {
  title?: string;
  description?: string;
  thumbnail_url?: string;
};

const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /\.local$/i,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // link-local, also covers cloud metadata endpoints
];

/** Rejects non-http(s) schemes and obvious private/internal hosts before any fetch happens (basic SSRF guard). */
function safeUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOSTNAME_PATTERNS.some((re) => re.test(host))) return null;
  return url;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractMeta(html: string, property: string): string | undefined {
  const patterns = [
    new RegExp(
      `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1]) return decodeEntities(match[1]).trim();
  }
  return undefined;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  while (bytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    bytes += value.length;
  }
  await reader.cancel().catch(() => {});
  return html;
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreviewResult> {
  const url = safeUrl(rawUrl);
  if (!url) return {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!res.ok) return {};

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return {};

    const html = await readCapped(res, MAX_BYTES);

    const title = extractMeta(html, "og:title")?.slice(0, 300);
    const description = extractMeta(html, "og:description")?.slice(0, 500);
    const image = extractMeta(html, "og:image");
    // Skip relative image paths rather than trying to resolve them against
    // the page's base URL — simpler, and a broken/missing thumbnail is a
    // better failure mode than a wrong one.
    const thumbnail_url = image?.startsWith("http") ? image : undefined;

    return { title, description, thumbnail_url };
  } catch {
    return {}; // best-effort — a bad URL, timeout, or fetch error never blocks submission
  } finally {
    clearTimeout(timer);
  }
}
