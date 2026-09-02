import type { Campaign } from "./types";
import type { PublicSearchResult } from "./hasdata";

const COMMENT_INTENT = [
  "eu quero",
  "quero comprar",
  "manda o link",
  "tem link",
  "qual o valor",
  "quanto custa",
  "onde comprar",
];

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function quote(value: string) {
  return `"${value.replace(/"/g, "").trim()}"`;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function parseRelativeDate(value: string) {
  const text = normalize(value.trim());
  const match = text.match(/^(?:ha\s+)?(\d+)\s+(minuto|hora|dia|semana|mes|ano|minute|hour|day|week|month|year)s?(?:\s+ago)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2];
  const unitMs = unit.startsWith("min") ? 60_000
    : unit.startsWith("hora") || unit.startsWith("hour") ? 3_600_000
    : unit.startsWith("dia") || unit.startsWith("day") ? 86_400_000
    : unit.startsWith("semana") || unit.startsWith("week") ? 7 * 86_400_000
    : unit.startsWith("mes") || unit.startsWith("month") ? 30 * 86_400_000
    : 365 * 86_400_000;
  return new Date(Date.now() - amount * unitMs).toISOString();
}

function parseDisplayedDate(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const relative = parseRelativeDate(text);
  if (relative) return relative;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed) || parsed > Date.now() + 86_400_000) return null;
  return new Date(parsed).toISOString();
}

export async function searchFacebookCommentSeeds(campaign: Campaign, apiKey: string) {
  if (!campaign.sources.includes("Facebook")) {
    return { results: [] as PublicSearchResult[], warnings: [] as string[], apiCalls: 0, queries: [] as string[] };
  }

  const products = campaign.products.map((item) => item.trim()).filter(Boolean).slice(0, 3);
  if (!products.length) {
    return { results: [] as PublicSearchResult[], warnings: [] as string[], apiCalls: 0, queries: [] as string[] };
  }

  const productExpr = products.length === 1 ? quote(products[0]) : `(${products.map(quote).join(" OR ")})`;
  const intentExpr = `(${COMMENT_INTENT.map(quote).join(" OR ")})`;
  const location = campaign.location?.trim() ? quote(campaign.location.trim()) : "";
  const query = [productExpr, intentExpr, location, "site:facebook.com"]
    .filter(Boolean)
    .join(" ")
    .slice(0, 900);

  try {
    const params = new URLSearchParams({ q: query, start: "0", num: "20", tbs: "qdr:m,sbd:1" });
    if (normalize(campaign.location).includes("brasil")) {
      params.set("gl", "br");
      params.set("hl", "pt");
    }

    const response = await fetch(`https://api.hasdata.com/scrape/google/serp?${params.toString()}`, {
      headers: { "x-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });

    if (!response.ok) {
      return {
        results: [] as PublicSearchResult[],
        warnings: [`Facebook prioridade: busca de posts para comentários respondeu ${response.status}.`],
        apiCalls: 1,
        queries: [query],
      };
    }

    const data = await response.json() as { organicResults?: Array<Record<string, unknown>> };
    const seen = new Set<string>();
    const results: PublicSearchResult[] = [];

    for (const item of data.organicResults ?? []) {
      const publicationUrl = cleanText(item.link);
      if (!publicationUrl || !publicationUrl.toLowerCase().includes("facebook.com")) continue;
      const key = publicationUrl.toLowerCase().replace(/[?#].*$/, "");
      if (seen.has(key)) continue;
      seen.add(key);

      const title = cleanText(item.title);
      const snippet = cleanText(item.snippet);
      const dateLabel = cleanText(item.date);
      const rawSource = cleanText(item.source);
      const displayedLink = cleanText(item.displayedLink);
      const baseText = [title, snippet].filter(Boolean).join(" — ");
      const publicationText = dateLabel ? `${baseText} — Data exibida pelo Google: ${dateLabel}` : baseText;
      if (!publicationText) continue;

      results.push({
        source: "Facebook",
        profileName: rawSource || displayedLink || title || "Facebook",
        publicationUrl,
        publicationText,
        publishedAt: parseDisplayedDate(item.date),
      });

      if (results.length >= 12) break;
    }

    results.sort((a, b) => {
      const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return bTime - aTime;
    });

    return { results, warnings: [] as string[], apiCalls: 1, queries: [query] };
  } catch (error) {
    return {
      results: [] as PublicSearchResult[],
      warnings: [error instanceof Error ? `Facebook prioridade: ${error.message}` : "Facebook prioridade: falha ao localizar posts públicos."],
      apiCalls: 1,
      queries: [query],
    };
  }
}
