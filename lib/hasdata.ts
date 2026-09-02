import type { Campaign, Source } from "./types";

export type PublicSearchResult = {
  source: Source;
  profileName: string;
  publicationUrl: string;
  publicationText: string;
};

type PlannedQuery = {
  source: Source;
  query: string;
};

const SITE_BY_SOURCE: Partial<Record<Source, string>> = {
  Facebook: "facebook.com",
  Instagram: "instagram.com",
  TikTok: "tiktok.com",
  Reddit: "reddit.com",
};

const DEFAULT_INTENT = ["quero comprar", "onde comprar", "alguém recomenda"];

function quote(value: string) {
  return `"${value.replace(/"/g, "").trim()}"`;
}

export function buildHasDataQueries(campaign: Campaign): PlannedQuery[] {
  const products = campaign.products.map((item) => item.trim()).filter(Boolean).slice(0, 3);
  if (!products.length) return [];

  const intents = (campaign.intentPhrases.length ? campaign.intentPhrases : DEFAULT_INTENT)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
  const negative = campaign.negativeKeywords
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((item) => `-${quote(item)}`)
    .join(" ");

  const productExpr = products.length === 1 ? quote(products[0]) : `(${products.map(quote).join(" OR ")})`;
  const intentExpr = intents.length === 1 ? quote(intents[0]) : `(${intents.map(quote).join(" OR ")})`;
  const location = campaign.location?.trim() ? quote(campaign.location.trim()) : "";
  const sources = (campaign.sources.length ? campaign.sources : ["Web" as Source]).slice(0, 5);

  return sources.map((source) => {
    const site = SITE_BY_SOURCE[source];
    const siteFilter = site ? `site:${site}` : "";
    return {
      source,
      query: [productExpr, intentExpr, location, siteFilter, negative].filter(Boolean).join(" ").slice(0, 700),
    };
  });
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export async function searchHasData(campaign: Campaign, apiKey: string) {
  const planned = buildHasDataQueries(campaign);
  const warnings: string[] = [];

  const batches = await Promise.all(planned.map(async ({ source, query }) => {
    try {
      const params = new URLSearchParams({ q: query, start: "0" });
      const response = await fetch(`https://api.hasdata.com/scrape/google/serp?${params.toString()}`, {
        headers: { "x-api-key": apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });

      if (!response.ok) {
        const text = await response.text();
        warnings.push(`${source}: HasData respondeu ${response.status}${text ? ` — ${text.slice(0, 120)}` : ""}`);
        return [] as PublicSearchResult[];
      }

      const data = await response.json() as { organicResults?: Array<Record<string, unknown>> };
      return (data.organicResults ?? []).map((result) => {
        const title = cleanText(result.title);
        const snippet = cleanText(result.snippet);
        const publicationUrl = cleanText(result.link);
        const profileName = cleanText(result.source) || cleanText(result.displayedLink) || title || "Resultado público";
        const publicationText = [title, snippet].filter(Boolean).join(" — ");
        if (!publicationUrl || !publicationText) return null;
        return { source, profileName, publicationUrl, publicationText } satisfies PublicSearchResult;
      }).filter((item): item is PublicSearchResult => Boolean(item));
    } catch (error) {
      warnings.push(`${source}: ${error instanceof Error ? error.message : "falha de consulta"}`);
      return [] as PublicSearchResult[];
    }
  }));

  const seen = new Set<string>();
  const results = batches.flat().filter((item) => {
    const key = item.publicationUrl.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 50);

  return { queries: planned.map((item) => item.query), results, warnings };
}
