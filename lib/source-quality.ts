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

const SELLER_CTA_PATTERNS = [
  "digite eu quero",
  "digite \"eu quero\"",
  "comente eu quero",
  "comente \"eu quero\"",
  "comenta eu quero",
  "comenta \"eu quero\"",
  "comente aqui eu quero",
  "para receber o link",
  "receber o link por dm",
  "receba o link",
  "para nossa equipe entrar em contato",
  "para a nossa equipe entrar em contato",
  "nossa equipe entrar em contato",
  "comente para receber",
  "digite para receber"
];

export function normalizeSourceText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function compact(value: string) {
  return normalizeSourceText(value).replace(/[\s_-]+/g, "");
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

function publicationLooksLikeSellerCta(publicationText: string) {
  const text = normalizeSourceText(publicationText)
    .replace(/[“”'‘’]/g, "\"")
    .replace(/[:!,.]/g, " ")
    .replace(/\s+/g, " ");
  return SELLER_CTA_PATTERNS.some((pattern) => {
    const normalizedPattern = normalizeSourceText(pattern)
      .replace(/[“”'‘’]/g, "\"")
      .replace(/[:!,.]/g, " ")
      .replace(/\s+/g, " ");
    return text.includes(normalizedPattern);
  });
}

function isTrustedPublicComment(publicationText: string) {
  return normalizeSourceText(publicationText).startsWith("comentario publico em publicacao sobre");
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

function purchaseTargetsAnotherItem(analysis: Analysis, publicationText: string) {
  const product = analysis.product;
  if (!product) return false;

  const text = normalizeSourceText(publicationText);
  const textCompact = compact(publicationText);
  const productCompact = compact(product);
  if (!productCompact || !textCompact.includes(productCompact)) return false;

  const ownershipMarkers = ["ja tenho", "eu tenho", "tenho uma", "tenho um"];
  const ownershipIndex = ownershipMarkers
    .map((marker) => text.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (ownershipIndex == null) return false;

  const ownershipWindow = text.slice(ownershipIndex, ownershipIndex + 120);
  if (!compact(ownershipWindow).includes(productCompact)) return false;

  const purchaseMarkers = ["quero comprar", "preciso comprar", "vou comprar", "estou procurando", "onde comprar"];
  for (const marker of purchaseMarkers) {
    let from = ownershipIndex + 1;
    while (from < text.length) {
      const purchaseIndex = text.indexOf(marker, from);
      if (purchaseIndex < 0) break;
      const after = text.slice(purchaseIndex, purchaseIndex + 120);
      if (!compact(after).includes(productCompact)) return true;
      from = purchaseIndex + marker.length;
    }
  }

  return false;
}

function weakBand(): LeadBand {
  return "Sinal fraco";
}

function weakAnalysis(analysis: Analysis, score: number, signal: string, relevance?: number): Analysis {
  return {
    ...analysis,
    score: Math.min(analysis.score, score),
    band: weakBand(),
    intent: "weak",
    relevance: relevance == null ? analysis.relevance : Math.min(analysis.relevance, relevance),
    signals: analysis.signals.includes(signal) ? analysis.signals : [...analysis.signals, signal],
    reason: signal,
  };
}

export function applyAttributionGuard(analysis: Analysis, profileName: string, publicationText: string): Analysis {
  if (!isTrustedPublicComment(publicationText) && publicationLooksLikeSellerCta(publicationText)) {
    return weakAnalysis(
      analysis,
      25,
      "Publicação é uma chamada de vendedor para o público comentar ou pedir o link; o lead é o comentarista, não a página que publicou"
    );
  }

  if (purchaseTargetsAnotherItem(analysis, publicationText)) {
    return weakAnalysis(
      analysis,
      45,
      "A pessoa parece já possuir o produto monitorado; a intenção de compra está direcionada a outro item",
      40
    );
  }

  if (!profileLooksLikeNonBuyer(profileName)) return analysis;

  return weakAnalysis(
    analysis,
    40,
    "Origem parece ser marca, página temática ou rede sem autor comprador identificável; atribuição rebaixada"
  );
}
