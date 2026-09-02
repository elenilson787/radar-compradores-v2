import type { Analysis, LeadBand } from "./types";

const NON_BUYER_PROFILE_PATTERNS = [
  "loja", "store", "shop", "shopping", "oficial", "eletrodomesticos", "eletrodomésticos",
  "magazine", "varejo", "revenda", "distribuidora", "fabricante", "receitas", "receita",
  "almanaque", "portal", "blog", "revista", "canal", "dicas", "achadinhos", "ofertas",
  "promoções", "promocoes", "review", "reviews", "comparativo", "custo benefício", "custo beneficio",
  "rainha da", "rei da", "cozinha", "chef", "gastronomia", "airfryer", "air fryer",
  "reclame aqui", "havan", "britania", "britânia", "elgin", "philco", "mondial", "electrolux",
  "oster", "arno", "midea", "walita", "black+decker", "black & decker", "black decker",
  "amazon", "mercado livre", "shopee", "magalu", "magazine luiza", "casas bahia", "carrefour", "fast shop"
];

const GENERIC_SOCIAL_PROFILES = new Set([
  "facebook", "instagram", "tiktok", "reddit", "web",
  "resultado publico", "resultado público", "perfil publico", "perfil público"
]);

export function normalizeSourceText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function containsNonBuyerPattern(value: string) {
  const normalized = normalizeSourceText(value);
  return NON_BUYER_PROFILE_PATTERNS.some((pattern) => normalized.includes(normalizeSourceText(pattern)));
}

function structuredSocialAuthor(profileName: string) {
  const profile = normalizeSourceText(profileName);
  const match = profile.match(/^(facebook|instagram|tiktok|reddit)\s*[·|-]\s*(.+)$/);
  if (!match?.[2]?.trim()) return null;
  return { network: match[1], author: match[2].trim() };
}

export function profileLooksLikeNonBuyer(profileName: string) {
  const profile = normalizeSourceText(profileName);
  if (!profile) return true;
  if (GENERIC_SOCIAL_PROFILES.has(profile)) return true;

  const structured = structuredSocialAuthor(profileName);
  if (structured) {
    if (GENERIC_SOCIAL_PROFILES.has(structured.author)) return true;
    return containsNonBuyerPattern(structured.author);
  }

  return containsNonBuyerPattern(profile);
}

function weakBand(): LeadBand {
  return "Sinal fraco";
}

export function applyAttributionGuard(analysis: Analysis, profileName: string, _publicationText: string): Analysis {
  if (!profileLooksLikeNonBuyer(profileName)) return analysis;

  const score = Math.min(analysis.score, 40);
  const signal = "Origem parece ser marca, página temática ou rede sem autor comprador identificável; atribuição rebaixada";
  return {
    ...analysis,
    score,
    band: weakBand(),
    intent: "weak",
    signals: analysis.signals.includes(signal) ? analysis.signals : [...analysis.signals, signal],
    reason: signal,
  };
}
