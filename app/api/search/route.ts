import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { searchHasData } from "@/lib/hasdata";
import { analyzeText } from "@/lib/scoring";
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
  const result = await searchHasData(campaign, apiKey);
  const qualifiedResults = result.results.filter((item) => {
    const analysis = analyzeText(
      item.publicationText,
      campaign,
      item.publishedAt ?? undefined,
      item.profileName
    );
    return analysis.score >= campaign.minimumScore;
  });

  return NextResponse.json({
    queryCount: result.queries.length,
    found: result.results.length,
    qualified: qualifiedResults.length,
    results: qualifiedResults,
    warnings: result.warnings,
    elapsedMs: Date.now() - startedAt,
  });
}
