import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { searchHasData } from "@/lib/hasdata";
import { searchPublicComments } from "@/lib/comments";
import { analyzeText } from "@/lib/scoring";
import { applyAttributionGuard } from "@/lib/source-quality";
import type { Campaign, Source } from "@/lib/types";

const ALLOWED_SOURCES = new Set<Source>(["Facebook", "Instagram", "TikTok", "Reddit", "Web"]);

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
  const publicationSearch = await searchHasData(campaign, apiKey);
  const commentSearch = await searchPublicComments(campaign, apiKey, publicationSearch.results);

  const combined = [
    ...publicationSearch.results.map((item) => ({ ...item, kind: "publication" as const })),
    ...commentSearch.results,
  ];

  const seen = new Set<string>();
  const uniqueResults = combined.filter((item) => {
    const key = `${item.source}|${item.publicationUrl.toLowerCase()}|${item.profileName.toLowerCase()}|${item.publicationText.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const qualifiedResults = uniqueResults.filter((item) => {
    const rawAnalysis = analyzeText(
      item.publicationText,
      campaign,
      item.publishedAt ?? undefined,
      item.profileName
    );
    const analysis = applyAttributionGuard(rawAnalysis, item.profileName, item.publicationText);
    return analysis.score >= campaign.minimumScore;
  });

  const warnings = [...publicationSearch.warnings, ...commentSearch.warnings];
  return NextResponse.json({
    queryCount: publicationSearch.queries.length + commentSearch.apiCalls,
    found: uniqueResults.length,
    qualified: qualifiedResults.length,
    commentsFound: commentSearch.results.length,
    commentPagesChecked: commentSearch.pagesChecked,
    results: qualifiedResults,
    warnings,
    elapsedMs: Date.now() - startedAt,
  });
}
