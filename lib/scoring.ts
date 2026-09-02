import { Analysis, Campaign, LeadBand } from "./types";

const BUY_PATTERNS = [
  "quero comprar", "onde comprar", "onde consigo", "alguém recomenda", "alguem recomenda",
  "manda link", "tem link", "qual comprar", "qual é melhor", "qual e melhor", "quanto custa",
  "onde está barato", "onde esta barato", "estou procurando", "preciso comprar", "vou comprar",
  "alguém sabe", "alguem sabe", "estou pensando em comprar", "preciso de"
];

const WEAK_BUY_PATTERNS = ["onde comprar", "onde consigo", "onde está barato", "onde esta barato"];
const STRONG_SELL_PATTERNS = [
  "estou vendendo", "vendo ", "minha loja", "revendedor", "chama no direct", "faço entrega", "faco entrega",
  "compre agora", "loja oficial", "enquanto durarem os estoques", "estoque limitado", "últimas unidades", "ultimas unidades"
];
const COMMERCIAL_PATTERNS = [
  "promoção", "promocao", "oferta", "cupom", "frete grátis", "frete gratis", "parcelas de",
  "em até 10x", "em ate 10x", "preço da época", "preco da epoca", "aproveite", "estoque"
];
const CONVERSATIONAL_PATTERNS = [
  "eu quero", "quero comprar", "estou procurando", "estou pensando", "preciso comprar", "preciso de",
  "alguém sabe", "alguem sabe", "alguém recomenda", "alguem recomenda", "vocês recomendam", "voces recomendam",
  "me recomendam", "manda link", "tem link"
];
const DIRECT_COMMENT_BUY_PATTERNS = [
  "eu quero", "quero um", "quero uma", "manda link", "manda o link", "me manda o link", "tem link",
  "qual o link", "onde compra", "onde comprar", "onde acho", "onde encontro", "qual o preço", "qual o preco",
  "qual o valor", "quanto custa", "preciso de um", "preciso de uma", "também quero", "tambem quero",
  "eu preciso", "compraria"
];
const TRUSTED_PUBLIC_COMMENT_MARKER = "comentario publico em publicacao sobre";
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
  "resistência", "resistencia", "cabo", "cabos", "bandeja", "bandejas", "forma", "formas"
];
const INDEXED_COMMENT_MARKERS = [
  "responder", "respondeu", "comments", "comment", "comentários", "comentarios", "likes", "curtidas"
];
const URGENT_PATTERNS = ["hoje", "agora", "urgente", "preciso hoje", "comprar hoje"];

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function band(score: number): LeadBand {
  if (score >= 80) return "Alta intenção";
  if (score >= 55) return "Possível comprador";
  return "Sinal fraco";
}

function parseMoney(raw: string) {
  const cleaned = raw.replace(/\s+/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 20 || value > 100000) return null;
  if (value >= 1900 && value <= 2099) return null;
  return value;
}

function extractBudget(text: string): number | null {
  const candidates: string[] = [];
  for (const match of text.matchAll(/r\$\s*(\d{2,6}(?:\.\d{3})*(?:,\d{1,2})?)/gi)) candidates.push(match[1]);
  for (const match of text.matchAll(/\b(\d{2,6}(?:\.\d{3})*(?:,\d{1,2})?)\s*reais\b/gi)) candidates.push(match[1]);
  for (const match of text.matchAll(/(?:até|ate|orçamento(?:\s+de)?|orcamento(?:\s+de)?|posso gastar|tenho até|tenho ate)\s*(?:r\$\s*)?(\d{2,6}(?:\.\d{3})*(?:,\d{1,2})?)/gi)) candidates.push(match[1]);
  for (const candidate of candidates) {
    const value = parseMoney(candidate);
    if (value != null) return value;
  }
  return null;
}

function dateFromText(text: string) {
  const english = text.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+(?:19|20)\d{2}\b/i)?.[0];
  if (english) {
    const parsed = Date.parse(english);
    if (Number.isFinite(parsed) && parsed <= Date.now() + 86_400_000) return new Date(parsed).toISOString();
  }

  const months: Record<string, number> = {
    janeiro: 0, fevereiro: 1, marco: 2, abril: 3, maio: 4, junho: 5,
    julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
  };
  const normalized = normalize(text);
  const pt = normalized.match(/\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+((?:19|20)\d{2})\b/);
  if (pt) {
    const date = new Date(Date.UTC(Number(pt[3]), months[pt[2]], Number(pt[1]), 12));
    if (date.getTime() <= Date.now() + 86_400_000) return date.toISOString();
  }
  return undefined;
}

function recencyWeight(publishedAt?: string, text?: string) {
  const explicitTextDate = text ? dateFromText(text) : undefined;
  const effectiveDate = explicitTextDate ?? publishedAt;
  if (!effectiveDate) return 45;
  const timestamp = new Date(effectiveDate).getTime();
  if (!Number.isFinite(timestamp)) return 45;
  const ms = Date.now() - timestamp;
  if (ms < -86_400_000) return 45;
  const days = Math.max(0, ms / 86_400_000);
  if (days <= 1) return 100;
  if (days <= 3) return 90;
  if (days <= 7) return 75;
  if (days <= 30) return 50;
  if (days <= 180) return 35;
  return 20;
}

function accessoryPurchaseTarget(text: string) {
  const t = normalize(text);
  const accessory = ACCESSORY_PATTERNS.map(normalize).join("|");
  const purchase = "comprar|procurando|preciso de|onde encontro|onde comprar|quero comprar";
  return new RegExp(`(?:${purchase}).{0,45}(?:${accessory})`).test(t)
    || new RegExp(`(?:${accessory}).{0,45}(?:${purchase})`).test(t);
}

function indexedCommentAttributionIsAmbiguous(text: string, patterns: string[]) {
  const t = normalize(text);
  const markerIndexes = INDEXED_COMMENT_MARKERS
    .map((marker) => t.indexOf(normalize(marker)))
    .filter((index) => index >= 0);
  if (!markerIndexes.length) return false;
  const firstMarker = Math.min(...markerIndexes);
  const intentIndexes = patterns
    .map((pattern) => t.indexOf(normalize(pattern)))
    .filter((index) => index >= 0);
  if (!intentIndexes.length) return false;
  const firstIntent = Math.min(...intentIndexes);
  return firstIntent > firstMarker;
}

export function analyzeText(text: string, campaign?: Campaign, publishedAt?: string, profileName?: string): Analysis {
  const t = normalize(text);
  const profile = normalize(profileName ?? "");
  const signals: string[] = [];
  let intentScore = 15;
  const customBuyPatterns = campaign?.intentPhrases ?? [];
  const buyPatterns = [...new Set([...BUY_PATTERNS, ...customBuyPatterns])];

  const trustedPublicComment = t.includes(TRUSTED_PUBLIC_COMMENT_MARKER);
  const directCommentHit = trustedPublicComment && DIRECT_COMMENT_BUY_PATTERNS.some((p) => t.includes(normalize(p)));
  const hits = buyPatterns.filter((p) => t.includes(normalize(p)));
  const weakHits = hits.filter((p) => WEAK_BUY_PATTERNS.some((weak) => normalize(weak) === normalize(p)));
  const strongHits = hits.filter((p) => !weakHits.includes(p));
  const strongSellHit = STRONG_SELL_PATTERNS.find((p) => t.includes(normalize(p)));
  const commercialHits = COMMERCIAL_PATTERNS.filter((p) => t.includes(normalize(p)));
  const conversational = CONVERSATIONAL_PATTERNS.some((p) => t.includes(normalize(p)));
  const profileLooksNonBuyer = Boolean(profile) && NON_BUYER_PROFILE_PATTERNS.some((p) => profile.includes(normalize(p)));
  const accessoryTarget = accessoryPurchaseTarget(text);
  const ambiguousIndexedComment = !trustedPublicComment && indexedCommentAttributionIsAmbiguous(text, [...buyPatterns, ...CONVERSATIONAL_PATTERNS]);
  const clearlyCommercial = Boolean(strongSellHit) || commercialHits.length >= 2;

  if (strongHits.length) {
    intentScore += Math.min(56, strongHits.length * 28);
    signals.push("Intenção pessoal de compra ou pedido direto de recomendação");
  }
  if (weakHits.length) {
    intentScore += Math.min(16, weakHits.length * 8);
    signals.push("Sinal genérico de pesquisa de compra");
  }
  if (conversational) {
    intentScore += 12;
    signals.push("Linguagem conversacional compatível com potencial comprador");
  }
  if (directCommentHit) {
    intentScore += 48;
    signals.push("Comentário público curto demonstra intenção direta dentro de uma publicação sobre o produto");
  }
  if (/\?|recomenda|melhor|vale a pena|preco|frete|link/.test(t)) {
    intentScore += strongHits.length || conversational || directCommentHit ? 10 : 5;
    signals.push("Pesquisa preço, recomendação, frete ou link");
  }
  if (URGENT_PATTERNS.some((p) => t.includes(normalize(p)))) {
    intentScore += 10;
    signals.push("Indício de urgência");
  }

  if (clearlyCommercial) {
    if (strongHits.length || conversational || directCommentHit) {
      intentScore -= 30;
      signals.push("Conteúdo mistura sinal de comprador com linguagem comercial; score reduzido");
    } else {
      intentScore = Math.min(intentScore, 8);
      signals.push("Parece ser anúncio, oferta ou conteúdo de vendedor");
    }
  }

  if (profileLooksNonBuyer) {
    intentScore -= 35;
    signals.push("O perfil de origem parece ser marca, loja, mídia ou página temática; não identifica diretamente o comprador");
  }

  if (ambiguousIndexedComment) {
    intentScore -= 35;
    signals.push("A intenção de compra aparece somente após marcador de comentário; não é seguro atribuí-la ao perfil exibido");
  }

  const products = campaign?.products ?? [];
  const matchedProduct = products.find((p) => t.includes(normalize(p))) ?? null;
  let relevance = products.length === 0 ? 100 : matchedProduct ? 100 : 25;
  if (matchedProduct) signals.push(`Produto da campanha identificado: ${matchedProduct}`);

  if (accessoryTarget && matchedProduct) {
    relevance = Math.min(relevance, 45);
    signals.push("A intenção parece direcionada a peça ou acessório, não ao produto principal");
  }

  if (campaign?.negativeKeywords.some((k) => t.includes(normalize(k)))) {
    intentScore -= 35;
    signals.push("Palavra negativa da campanha encontrada");
  }

  intentScore = Math.max(0, Math.min(100, intentScore));
  const explicitTextDate = dateFromText(text);
  const recency = recencyWeight(publishedAt, text);
  if (!publishedAt && !explicitTextDate) signals.push("Data da publicação não confirmada; recência recebeu peso neutro");
  if (explicitTextDate) signals.push("Data da publicação identificada no resultado público");
  const combined = Math.round(intentScore * 0.68 + relevance * 0.22 + recency * 0.10);

  let score = Math.max(0, Math.min(100, combined));
  if (profileLooksNonBuyer) score = Math.min(score, 40);
  else if (ambiguousIndexedComment) score = Math.min(score, 45);
  else if (accessoryTarget && matchedProduct) score = Math.min(score, 50);
  else if (strongSellHit) score = Math.min(score, 35);
  else if (clearlyCommercial && !strongHits.length && !conversational && !directCommentHit) score = Math.min(score, 25);

  const budget = extractBudget(text);
  if (budget) signals.push(`Orçamento em reais detectado: R$ ${budget.toLocaleString("pt-BR")}`);

  const urgency = URGENT_PATTERNS.some((p) => t.includes(normalize(p))) ? "alta" : /essa semana|em breve/.test(t) ? "média" : null;
  const intent = profileLooksNonBuyer || ambiguousIndexedComment || accessoryTarget || (clearlyCommercial && score < 55)
    ? "weak"
    : score >= 80 ? "buy" : score >= 55 ? "research" : "weak";

  return {
    score,
    band: band(score),
    intent,
    product: matchedProduct,
    budget,
    urgency,
    relevance,
    recencyWeight: recency,
    signals,
    reason: signals[0] ?? "Menção sem sinal explícito de compra",
  };
}
