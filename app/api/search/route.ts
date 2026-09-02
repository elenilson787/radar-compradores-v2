import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { searchHasData } from "@/lib/hasdata";
import { searchPublicComments } from "@/lib/comments";
import { searchFacebookPublicComments } from "@/lib/facebook-comments";
import { searchFacebookCommentSeeds } from "@/lib/facebook-seeds";
import { analyzeText } from "@/lib/scoring";
import { applyAttributionGuard } from "@/lib/source-quality";
import type { Campaign, Source } from "@/lib/types";

const ALLOWED_SOURCES = new Set<Source>(["Facebook", "Instagram", "TikTok", "Reddit", "Web"]);
const SOURCE_PRIORITY: Record<Source, number> = {
  Facebook: 0,
  Instagram: 1,
  TikTok: 2,
  Reddit: 3,
  Web: 4,
};

function validCampaign(value: unknown): value is Campaign {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Campaign>;
  return typeof item.id === "string"
    && typeof item.name === "string"
    && typeof item.location === "string"
    && Array.isArray(item.products)
    && item.products.length > 0
    && item.products.length <= 20
    && item.products.every((x) => typeof x === "string" && x.length <= 120)
    && Array.isArray(item.intentPhrases)
    && item.intentPhrases.length <= 30
    && item.intentPhrases.every((x) => typeof x === "string" && x.length <= 160)
    && Array.isArray(item.negativeKeywords)
    && item.negativeKeywords.length <= 30
    && item.negativeKeywords.every((x) => typeof x === "string" && x.length <= 120)
    && Array.isArray(item.sources)
    && item.sources.length <= 5
    && item.sources.every((x) => ALLOWED_SOURCES.has(x as Source));
}

async function authenticatedUser(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const header = request.headers.get("authorization") ?? "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!url || !key || !token) return null;

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

function dedupeSearchResults<T extends { source: Source; publicationUrl: string; profileName: string; publicationText: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.publicationUrl.toLowerCase().replace(/[?#].*$/, "")}|${item.profileName.toLowerCase()}|${item.publicationText.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function POST(request: NextRequest) {
  const user = await authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const apiKey = process.env.HASDATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Busca automática ainda não configurada: falta HASDATA_API_KEY na Vercel." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const campaign = (body as { campaign?: unknown })?.campaign;
  if (!validCampaign(campaign)) {
    return NextResponse.json({ error: "Campanha inválida ou sem produtos." }, { status: 400 });
  }

  const startedAt = Date.now();

  // Estratégia Facebook-first:
  // 1) a busca principal usa Facebook + Instagram;
  // 2) uma consulta extra encontra posts do Facebook adequados para ler comentários públicos;
  // 3) TikTok/Reddit/Web só entram como fallback quando Facebook/Instagram retornam pouco material.
  const primarySources = campaign.sources.filter((source) => source === "Facebook" || source === "Instagram");
  const primaryCampaign: Campaign = {
    ...campaign,
    sources: primarySources.length ? primarySources : campaign.sources.slice(0, 2),
  };

  const [primarySearch, facebookSeedSearch] = await Promise.all([
    searchHasData(primaryCampaign, apiKey),
    searchFacebookCommentSeeds(campaign, apiKey),
  ]);

  const fallbackSources = campaign.sources
    .filter((source) => source !== "Facebook" && source !== "Instagram")
    .sort((a, b) => SOURCE_PRIORITY[a] - SOURCE_PRIORITY[b])
    .slice(0, 2);

  const shouldUseFallback = primarySearch.results.length < 8 && fallbackSources.length > 0;
  const fallbackSearch = shouldUseFallback
    ? await searchHasData({ ...campaign, sources: fallbackSources }, apiKey)
    : { queries: [] as string[], results: [], warnings: [] as string[] };

  const publicationResults = dedupeSearchResults([
    ...primarySearch.results,
    ...fallbackSearch.results,
  ]).sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]);

  const facebookSeeds = dedupeSearchResults([
    ...facebookSeedSearch.results,
    ...publicationResults.filter((item) => item.source === "Facebook"),
  ]);

  // Comentários fora do Facebook ficam concentrados no Instagram, que é a segunda prioridade.
  const instagramCommentCampaign: Campaign = {
    ...campaign,
    sources: campaign.sources.includes("Instagram") ? ["Instagram"] : [],
  };

  const [commentSearch, facebookCommentSearch] = await Promise.all([
    searchPublicComments(
      instagramCommentCampaign,
      apiKey,
      publicationResults.filter((item) => item.source === "Instagram")
    ),
    searchFacebookPublicComments(campaign, apiKey, facebookSeeds),
  ]);

  const combined = [
    ...publicationResults.map((item) => ({ ...item, kind: "publication" as const })),
    ...facebookCommentSearch.results,
    ...commentSearch.results,
  ];

  const uniqueResults = dedupeSearchResults(combined);

  const qualifiedResults = uniqueResults.filter((item) => {
    const rawAnalysis = analyzeText(
      item.publicationText,
      campaign,
      item.publishedAt ?? undefined,
      item.profileName
    );
    const analysis = applyAttributionGuard(rawAnalysis, item.profileName, item.publicationText);
    return analysis.score >= campaign.minimumScore;
  }).sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]);

  const warnings = [
    ...primarySearch.warnings,
    ...facebookSeedSearch.warnings,
    ...fallbackSearch.warnings,
    ...facebookCommentSearch.warnings,
    ...commentSearch.warnings,
  ];
  const commentsFound = facebookCommentSearch.results.length + commentSearch.results.length;
  const commentPagesChecked = facebookCommentSearch.pagesChecked + commentSearch.pagesChecked;

  return NextResponse.json({
    queryCount:
      primarySearch.queries.length
      + facebookSeedSearch.apiCalls
      + fallbackSearch.queries.length
      + facebookCommentSearch.apiCalls
      + commentSearch.apiCalls,
    found: uniqueResults.length,
    qualified: qualifiedResults.length,
    commentsFound,
    commentPagesChecked,
    results: qualifiedResults,
    warnings,
    sourceStrategy: "Facebook > Instagram > fallback",
    elapsedMs: Date.now() - startedAt,
  });
}
