import type { Campaign, Source } from "./types";
import type { PublicSearchResult } from "./hasdata";

export type PublicCommentResult = PublicSearchResult & {
  kind: "comment";
};

type SearchSummary = {
  results: PublicCommentResult[];
  warnings: string[];
  apiCalls: number;
  pagesChecked: number;
};

const COMMENT_INTENT_PATTERNS = [
  "eu quero",
  "quero um",
  "quero uma",
  "manda link",
  "manda o link",
  "me manda o link",
  "tem link",
  "qual o link",
  "qual link",
  "onde compra",
  "onde comprar",
  "onde acho",
  "onde encontro",
  "qual o preço",
  "qual o preco",
  "qual o valor",
  "quanto custa",
  "preciso de um",
  "preciso de uma",
  "também quero",
  "tambem quero",
  "eu preciso",
  "compraria",
];

const BOT_NAMES = ["automoderator", "bot", "moderatorbot"];
const SOCIAL_SOURCES = new Set<Source>(["Facebook", "Instagram", "TikTok"]);

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function quote(value: string) {
  return `"${value.replace(/"/g, "").trim()}"`;
}

function hasCommentIntent(text: string) {
  const t = normalize(text);
  return COMMENT_INTENT_PATTERNS.some((pattern) => t.includes(normalize(pattern)));
}

function sourceFromUrl(url: string): Source | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("facebook.com")) return "Facebook";
    if (host.includes("instagram.com")) return "Instagram";
    if (host.includes("tiktok.com")) return "TikTok";
    if (host.includes("reddit.com")) return "Reddit";
    return null;
  } catch {
    return null;
  }
}

function productsMatch(text: string, campaign: Campaign) {
  const t = normalize(text);
  return campaign.products.some((product) => t.includes(normalize(product)));
}

function contextualCommentText(comment: string, campaign: Campaign) {
  const productContext = campaign.products.slice(0, 3).join(", ");
  return `Comentário público em publicação sobre ${productContext}: ${comment.trim()}`;
}

async function discoverCommentSeedUrls(campaign: Campaign, apiKey: string) {
  const sites = campaign.sources
    .filter((source) => source !== "Web")
    .map((source) => source === "Facebook" ? "facebook.com" : source === "Instagram" ? "instagram.com" : source === "TikTok" ? "tiktok.com" : "reddit.com");

  if (!sites.length) return { urls: [] as string[], warning: "" };

  const products = campaign.products.slice(0, 3).map(quote);
  const productExpr = products.length === 1 ? products[0] : `(${products.join(" OR ")})`;
  const siteExpr = sites.length === 1 ? `site:${sites[0]}` : `(${sites.map((site) => `site:${site}`).join(" OR ")})`;
  const q = [productExpr, siteExpr, campaign.location ? quote(campaign.location) : ""].filter(Boolean).join(" ");
  const params = new URLSearchParams({ q, start: "0" });
  if (normalize(campaign.location).includes("brasil")) {
    params.set("gl", "br");
    params.set("hl", "pt");
  }

  try {
    const response = await fetch(`https://api.hasdata.com/scrape/google/serp?${params.toString()}`, {
      headers: { "x-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) return { urls: [] as string[], warning: `Busca de publicações para comentários respondeu ${response.status}.` };
    const data = await response.json() as { organicResults?: Array<Record<string, unknown>> };
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const item of data.organicResults ?? []) {
      const link = typeof item.link === "string" ? item.link : "";
      const source = sourceFromUrl(link);
      if (!link || !source || !campaign.sources.includes(source) || seen.has(link)) continue;
      seen.add(link);
      urls.push(link);
      if (urls.length >= 10) break;
    }
    return { urls, warning: "" };
  } catch (error) {
    return { urls: [] as string[], warning: error instanceof Error ? `Busca de comentários: ${error.message}` : "Falha ao localizar publicações para comentários." };
  }
}

function redditJsonUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes("reddit.com")) return null;
    const match = parsed.pathname.match(/(\/r\/[^/]+\/comments\/[^/]+(?:\/[^/]+)?)/i);
    if (!match) return null;
    const path = match[1].replace(/\/$/, "");
    return `https://www.reddit.com${path}.json?limit=100&sort=new&raw_json=1`;
  } catch {
    return null;
  }
}

function collectRedditCommentNodes(node: unknown, output: Array<Record<string, unknown>>) {
  if (!node || typeof node !== "object") return;
  const value = node as Record<string, unknown>;
  if (value.kind === "t1" && value.data && typeof value.data === "object") {
    output.push(value.data as Record<string, unknown>);
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => collectRedditCommentNodes(item, output));
    else if (child && typeof child === "object") collectRedditCommentNodes(child, output);
  }
}

async function scanRedditThread(url: string, campaign: Campaign): Promise<{ results: PublicCommentResult[]; warning: string }> {
  const jsonUrl = redditJsonUrl(url);
  if (!jsonUrl) return { results: [], warning: "" };

  try {
    const response = await fetch(jsonUrl, {
      headers: { "User-Agent": "RadarCompradoresV2/1.0 public-comment-research" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { results: [], warning: `Reddit comentários respondeu ${response.status}.` };
    const data = await response.json() as unknown;
    const nodes: Array<Record<string, unknown>> = [];
    collectRedditCommentNodes(data, nodes);

    const results: PublicCommentResult[] = [];
    for (const item of nodes) {
      const body = typeof item.body === "string" ? item.body.trim() : "";
      const author = typeof item.author === "string" ? item.author.trim() : "";
      if (!body || !author || body === "[deleted]" || body === "[removed]" || BOT_NAMES.some((name) => normalize(author).includes(name))) continue;
      if (!hasCommentIntent(body)) continue;
      const permalink = typeof item.permalink === "string" ? `https://www.reddit.com${item.permalink}` : url;
      const createdUtc = typeof item.created_utc === "number" ? new Date(item.created_utc * 1000).toISOString() : null;
      results.push({
        source: "Reddit",
        profileName: `Reddit · u/${author}`,
        publicationUrl: permalink,
        publicationText: contextualCommentText(body, campaign),
        publishedAt: createdUtc,
        kind: "comment",
      });
      if (results.length >= 25) break;
    }
    return { results, warning: "" };
  } catch (error) {
    return { results: [], warning: error instanceof Error ? `Reddit comentários: ${error.message}` : "Falha ao ler comentários públicos do Reddit." };
  }
}

function parseAiComment(item: unknown) {
  if (typeof item === "string") {
    const [author, ...rest] = item.split("|||");
    const text = rest.join("|||").trim();
    if (author?.trim() && text) return { author: author.trim(), text };
    return null;
  }
  if (item && typeof item === "object") {
    const value = item as Record<string, unknown>;
    const author = [value.author, value.username, value.user, value.profile].find((entry) => typeof entry === "string") as string | undefined;
    const text = [value.text, value.comment, value.body, value.content].find((entry) => typeof entry === "string") as string | undefined;
    if (author?.trim() && text?.trim()) return { author: author.trim(), text: text.trim() };
  }
  return null;
}

async function scanVisibleSocialComments(url: string, source: Source, campaign: Campaign, apiKey: string) {
  try {
    const response = await fetch("https://api.hasdata.com/scrape/web", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        url,
        jsRendering: true,
        wait: 1800,
        blockResources: true,
        blockAds: true,
        outputFormat: ["json", "text"],
        aiExtractRules: {
          comments: {
            type: "list",
            description: "Return only comments visibly rendered to an unauthenticated public visitor. Each item must be AUTHOR|||COMMENT_TEXT. Do not include the post caption, page-owner text, UI labels, suggested posts, hidden comments, or any item where the author is not visibly identifiable. Maximum 30 comments.",
          },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(35_000),
    });

    if (!response.ok) return { results: [] as PublicCommentResult[], warning: `${source}: página pública de comentários respondeu ${response.status}.` };
    const data = await response.json() as { aiResponse?: { comments?: unknown[] } };
    const comments = Array.isArray(data.aiResponse?.comments) ? data.aiResponse?.comments ?? [] : [];
    const results: PublicCommentResult[] = [];

    for (const raw of comments) {
      const parsed = parseAiComment(raw);
      if (!parsed || !hasCommentIntent(parsed.text)) continue;
      results.push({
        source,
        profileName: `${source} · ${parsed.author}`,
        publicationUrl: url,
        publicationText: contextualCommentText(parsed.text, campaign),
        publishedAt: null,
        kind: "comment",
      });
      if (results.length >= 20) break;
    }

    return { results, warning: "" };
  } catch (error) {
    return { results: [] as PublicCommentResult[], warning: error instanceof Error ? `${source} comentários: ${error.message}` : `${source}: falha ao ler comentários públicos.` };
  }
}

export async function searchPublicComments(
  campaign: Campaign,
  apiKey: string,
  existingSeeds: PublicSearchResult[] = []
): Promise<SearchSummary> {
  const warnings: string[] = [];
  const seedDiscovery = await discoverCommentSeedUrls(campaign, apiKey);
  if (seedDiscovery.warning) warnings.push(seedDiscovery.warning);

  const allSeedUrls = [...existingSeeds.map((item) => item.publicationUrl), ...seedDiscovery.urls];
  const seenUrls = new Set<string>();
  const uniqueSeeds = allSeedUrls.filter((url) => {
    if (!url || seenUrls.has(url)) return false;
    const source = sourceFromUrl(url);
    if (!source || !campaign.sources.includes(source)) return false;
    seenUrls.add(url);
    return true;
  });

  const redditSeeds = uniqueSeeds.filter((url) => sourceFromUrl(url) === "Reddit").slice(0, 3);
  const socialSeeds: Array<{ url: string; source: Source }> = [];
  const usedSocialSources = new Set<Source>();
  for (const url of uniqueSeeds) {
    const source = sourceFromUrl(url);
    if (!source || !SOCIAL_SOURCES.has(source) || usedSocialSources.has(source)) continue;
    usedSocialSources.add(source);
    socialSeeds.push({ url, source });
    if (socialSeeds.length >= 3) break;
  }

  const redditBatches = await Promise.all(redditSeeds.map((url) => scanRedditThread(url, campaign)));
  const socialBatches = await Promise.all(socialSeeds.map(({ url, source }) => scanVisibleSocialComments(url, source, campaign, apiKey)));
  const results: PublicCommentResult[] = [];
  const seenComments = new Set<string>();

  for (const batch of [...redditBatches, ...socialBatches]) {
    if (batch.warning) warnings.push(batch.warning);
    for (const item of batch.results) {
      const key = `${item.source}|${normalize(item.profileName)}|${normalize(item.publicationText)}`;
      if (seenComments.has(key)) continue;
      seenComments.add(key);
      if (!productsMatch(item.publicationText, campaign)) continue;
      results.push(item);
      if (results.length >= 40) break;
    }
    if (results.length >= 40) break;
  }

  return {
    results,
    warnings,
    apiCalls: 1 + socialSeeds.length,
    pagesChecked: redditSeeds.length + socialSeeds.length,
  };
}
