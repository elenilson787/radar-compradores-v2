import type { Campaign, Source } from "./types";

export type PublicSearchResult = {
  source: Source;
  profileName: string;
  publicationUrl: string;
  publicationText: string;
  publishedAt: string | null;
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
const AUTOMATIC_COMMERCIAL_EXCLUSIONS = ["promoção", "oferta", "cupom", "compre agora", "enquanto durarem os estoques"];
const WEB_RETAIL_EXCLUSIONS = [
  "amazon.com.br", "mercadolivre.com.br", "shopee.com.br", "magazineluiza.com.br",
  "reclameaqui.com.br", "zoom.com.br", "buscape.com.br", "promobit.com.br", "pelando.com.br"
];
const NON_BUYER_PROFILE_PATTERNS = [
  "loja", "store", "shop", "shopping", "oficial", "eletrodomesticos", "eletrodomésticos",
  "magazine", "varejo", "revenda", "distribuidora", "fabricante", "receitas", "almanaque",
  "portal", "blog", "revista", "canal", "dicas", "achadinhos", "ofertas", "promoções", "promocoes",
  "review", "reviews", "comparativo", "custo benefício", "custo beneficio", "rainha da", "rei da",
  "reclame aqui", "havan", "britania", "britânia", "elgin", "philco", "mondial", "electrolux",
  "oster", "arno", "midea", "amazon", "mercado livre", "shopee", "magalu", "magazine luiza",
  "casas bahia", "carrefour", "fast shop"
];
const ACCESSORY_PATTERNS = [
  "borracha", "borrachas", "grelha", "grelhas", "cesto", "cestos", "grade", "grades",
  "peça", "peca", "peças", "pecas", "acessório", "acessorio", "acessórios", "acessorios",
  "resistência", "resistencia", "cabo", "cabos", "bandeja", "bandejas"
];
const INDEXED_COMMENT_MARKERS = [
  "responder", "respondeu", "comments", "comment", "comentários", "comentarios", "likes", "curtidas"
];
const BUY_CONTEXT_TERMS = [
  "quero comprar", "preciso comprar", "estou procurando", "onde comprar", "onde consigo",
  "alguém recomenda", "alguem recomenda", "qual comprar", "me recomendam", "eu quero"
];

function quote(value: string) {
  return `"${value.replace(/"/g, "").trim()}"`;
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function profileLooksLikeNonBuyer(profileName: string) {
  const profile = normalize(profileName);
  return NON_BUYER_PROFILE_PATTERNS.some((pattern) => profile.includes(normalize(pattern)));
}

function looksLikeAccessoryPurchase(text: string) {
  const t = normalize(text);
  const accessory = ACCESSORY_PATTERNS.map(normalize).join("|");
  const purchase = "comprar|procurando|preciso de|onde encontro|onde comprar|quero comprar";
  return new RegExp(`(?:${purchase}).{0,45}(?:${accessory})`).test(t)
    || new RegExp(`(?:${accessory}).{0,45}(?:${purchase})`).test(t);
}

function ambiguousIndexedComment(text: string, campaign: Campaign) {
  const t = normalize(text);
  const markerIndexes = INDEXED_COMMENT_MARKERS
    .map((marker) => t.indexOf(normalize(marker)))
    .filter((index) => index >= 0);
  if (!markerIndexes.length) return false;
  const firstMarker = Math.min(...markerIndexes);
  const terms = [...new Set([...BUY_CONTEXT_TERMS, ...campaign.intentPhrases])];
  const intentIndexes = terms
    .map((term) => t.indexOf(normalize(term)))
    .filter((index) => index >= 0);
  if (!intentIndexes.length) return false;
  return Math.min(...intentIndexes) > firstMarker;
}

function inferSource(plannedSource: Source, url: string): Source {
  const lower = url.toLowerCase();
  if (lower.includes("facebook.com")) return "Facebook";
  if (lower.includes("instagram.com")) return "Instagram";
  if (lower.includes("tiktok.com")) return "TikTok";
  if (lower.includes("reddit.com")) return "Reddit";
  return plannedSource;
}

export function buildHasDataQueries(campaign: Campaign): PlannedQuery[] {
  const products = campaign.products.map((item) => item.trim()).filter(Boolean).slice(0, 3);
  if (!products.length) return [];

  const intents = (campaign.intentPhrases.length ? campaign.intentPhrases : DEFAULT_INTENT)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);

  const userNegative = campaign.negativeKeywords
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
  const allNegative = [...new Set([...userNegative, ...AUTOMATIC_COMMERCIAL_EXCLUSIONS])]
    .map((item) => `-${quote(item)}`)
    .join(" ");

  const productExpr = products.length === 1 ? quote(products[0]) : `(${products.map(quote).join(" OR ")})`;
  const intentExpr = intents.length === 1 ? quote(intents[0]) : `(${intents.map(quote).join(" OR ")})`;
  const location = campaign.location?.trim() ? quote(campaign.location.trim()) : "";
  const sources = (campaign.sources.length ? campaign.sources : ["Web" as Source]).slice(0, 5);

  return sources.map((source) => {
    const site = SITE_BY_SOURCE[source];
    const siteFilter = site ? `site:${site}` : "";
    const retailExclusions = source === "Web"
      ? WEB_RETAIL_EXCLUSIONS.map((domain) => `-site:${domain}`).join(" ")
      : "";
    return {
      source,
      query: [productExpr, intentExpr, location, siteFilter, allNegative, retailExclusions]
        .filter(Boolean)
        .join(" ")
        .slice(0, 900),
    };
  });
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function validIsoFromDate(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (date.getTime() > Date.now() + 86_400_000) return null;
  return date.toISOString();
}

function parseRelativeDate(value: string) {
  const t = normalize(value.trim());
  const english = t.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/);
  const portuguese = t.match(/^ha\s+(\d+)\s+(minuto|hora|dia|semana|mes|ano)s?$/);
  const match = english ?? portuguese;
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2];
  const unitMs = unit.startsWith("minute") || unit.startsWith("minuto") ? 60_000
    : unit.startsWith("hour") || unit.startsWith("hora") ? 3_600_000
    : unit.startsWith("day") || unit.startsWith("dia") ? 86_400_000
    : unit.startsWith("week") || unit.startsWith("semana") ? 7 * 86_400_000
    : unit.startsWith("month") || unit.startsWith("mes") ? 30 * 86_400_000
    : 365 * 86_400_000;
  return new Date(Date.now() - amount * unitMs).toISOString();
}

function parsePortugueseLongDate(text: string) {
  const months: Record<string, number> = {
    janeiro: 0, fevereiro: 1, marco: 2, abril: 3, maio: 4, junho: 5,
    julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
  };
  const normalized = normalize(text);
  const match = normalized.match(/\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(20\d{2}|19\d{2})\b/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[3]), months[match[2]], Number(match[1]), 12));
  return date.getTime() <= Date.now() + 86_400_000 ? date.toISOString() : null;
}

function dateFromResult(result: Record<string, unknown>, publicationText: string) {
  const direct = cleanText(result.date);
  if (direct) {
    const relative = parseRelativeDate(direct);
    if (relative) return relative;
    const parsed = validIsoFromDate(direct);
    if (parsed) return parsed;
  }

  const englishDate = publicationText.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+(?:19|20)\d{2}\b/i)?.[0];
  if (englishDate) {
    const parsed = validIsoFromDate(englishDate);
    if (parsed) return parsed;
  }

  return parsePortugueseLongDate(publicationText);
}

export async function searchHasData(campaign: Campaign, apiKey: string) {
  const planned = buildHasDataQueries(campaign);
  const warnings: string[] = [];

  const batches = await Promise.all(planned.map(async ({ source, query }) => {
    try {
      const params = new URLSearchParams({ q: query, start: "0" });
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
        const text = await response.text();
        warnings.push(`${source}: HasData respondeu ${response.status}${text ? ` — ${text.slice(0, 120)}` : ""}`);
        return [] as PublicSearchResult[];
      }

      const data = await response.json() as { organicResults?: Array<Record<string, unknown>> };
      return (data.organicResults ?? []).map((result) => {
        const title = cleanText(result.title);
        const snippet = cleanText(result.snippet);
        const dateLabel = cleanText(result.date);
        const publicationUrl = cleanText(result.link);
        const rawSource = cleanText(result.source);
        const displayedLink = cleanText(result.displayedLink);
        const profileName = rawSource || displayedLink || title || "Resultado público";
        const baseText = [title, snippet].filter(Boolean).join(" — ");
        const publicationText = dateLabel ? `${baseText} — Data exibida pelo Google: ${dateLabel}` : baseText;
        if (!publicationUrl || !publicationText) return null;
        if (profileLooksLikeNonBuyer(profileName)) return null;
        if (looksLikeAccessoryPurchase(publicationText)) return null;
        if (ambiguousIndexedComment(publicationText, campaign)) return null;
        const publishedAt = dateFromResult(result, publicationText);
        const inferredSource = inferSource(source, publicationUrl);
        return { source: inferredSource, profileName, publicationUrl, publicationText, publishedAt } satisfies PublicSearchResult;
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
