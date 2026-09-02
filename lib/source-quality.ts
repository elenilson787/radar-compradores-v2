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

const TRUSTED_COMMENT_PREFIX = "comentario publico em publicacao sobre";

export function normalizeSourceText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

export function isTrustedAttributedComment(publicationText: string) {
  return normalizeSourceText(publicationText).startsWith(TRUSTED_COMMENT_PREFIX);
}

export function profileLooksLikeNonBuyer(profileName: string) {
  const profile = normalizeSourceText(profileName);
  if (!profile) return true;

  // Structured comment leads are named like "Facebook · Maria". The network prefix
  // alone is not a problem when a separate public author follows it.
  const structuredCommentAuthor = profile.match(/^(facebook|instagram|tiktok|reddit)\s*[·|-]\s*(.+)$/);
  if (structuredCommentAuthor?.[2]?.trim() && !GENERIC_SOCIAL_PROFILES.has(structuredCommentAuthor[2].trim())) {
    return false;
  }

  if (GENERIC_SOCIAL_PROFILES.has(profile)) return true;
  return NON_BUYER_PROFILE_PATTERNS.some((pattern) => profile.includes(normalizeSourceText(pattern)));
}

function weakBand(): LeadBand {
  return "Sinal fraco";
}

export function applyAttributionGuard(analysis: Analysis, profileName: string, publicationText: string): Analysis {
  if (isTrustedAttributedComment(publicationText)) return analysis;
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
