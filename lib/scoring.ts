import { Analysis, Campaign, LeadBand } from "./types";

const BUY_PATTERNS = [
  "quero comprar", "onde comprar", "onde consigo", "alguém recomenda", "alguem recomenda",
  "manda link", "tem link", "qual comprar", "qual é melhor", "qual e melhor", "quanto custa",
  "onde está barato", "onde esta barato", "estou procurando", "preciso comprar", "vou comprar"
];
const SELL_PATTERNS = ["estou vendendo", "vendo ", "minha loja", "revendedor", "chama no direct", "faço entrega", "faco entrega"];
const URGENT_PATTERNS = ["hoje", "agora", "urgente", "preciso hoje", "comprar hoje"];

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function band(score: number): LeadBand {
  if (score >= 80) return "Alta intenção";
  if (score >= 55) return "Possível comprador";
  return "Sinal fraco";
}

function extractBudget(text: string): number | null {
  const matches = text.match(/(?:r\$\s*)?(\d{2,5})(?:[.,](\d{2}))?/gi);
  if (!matches) return null;
  const values = matches
    .map((raw) => Number(raw.replace(/r\$\s*/i, "").replace(".", "").replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n >= 20 && n <= 100000);
  return values[0] ?? null;
}

function recencyWeight(publishedAt?: string) {
  if (!publishedAt) return 100;
  const ms = Date.now() - new Date(publishedAt).getTime();
  const days = ms / 86_400_000;
  if (days <= 1) return 100;
  if (days <= 3) return 90;
  if (days <= 7) return 75;
  if (days <= 30) return 50;
  return 20;
}

export function analyzeText(text: string, campaign?: Campaign, publishedAt?: string): Analysis {
  const t = normalize(text);
  const signals: string[] = [];
  let intentScore = 15;
  const customBuyPatterns = campaign?.intentPhrases ?? [];
  const buyPatterns = [...new Set([...BUY_PATTERNS, ...customBuyPatterns])];

  const sellHit = SELL_PATTERNS.find((p) => t.includes(normalize(p)));
  if (sellHit) {
    signals.push("Parece ser oferta de vendedor");
    intentScore = 8;
  } else {
    const hits = buyPatterns.filter((p) => t.includes(normalize(p)));
    if (hits.length) {
      intentScore += Math.min(60, hits.length * 24);
      signals.push("Intenção explícita ou pedido de recomendação");
    }
    if (/\?|recomenda|melhor|vale a pena|preco|preço|frete|link/.test(t)) {
      intentScore += 15;
      signals.push("Pesquisa preço, recomendação, frete ou link");
    }
    if (URGENT_PATTERNS.some((p) => t.includes(normalize(p)))) {
      intentScore += 10;
      signals.push("Indício de urgência");
    }
  }

  const products = campaign?.products ?? [];
  const matchedProduct = products.find((p) => t.includes(normalize(p))) ?? null;
  const relevance = products.length === 0 ? 100 : matchedProduct ? 100 : 25;
  if (matchedProduct) signals.push(`Produto da campanha identificado: ${matchedProduct}`);

  if (campaign?.negativeKeywords.some((k) => t.includes(normalize(k)))) {
    intentScore -= 35;
    signals.push("Palavra negativa da campanha encontrada");
  }

  intentScore = Math.max(0, Math.min(100, intentScore));
  const recency = recencyWeight(publishedAt);
  const combined = Math.round(intentScore * 0.68 + relevance * 0.22 + recency * 0.10);
  const score = sellHit ? Math.min(combined, 25) : Math.max(0, Math.min(100, combined));
  const budget = extractBudget(text);
  if (budget) signals.push(`Orçamento/valor detectado: R$ ${budget.toLocaleString("pt-BR")}`);

  const urgency = URGENT_PATTERNS.some((p) => t.includes(normalize(p))) ? "alta" : /essa semana|em breve/.test(t) ? "média" : null;
  const intent = sellHit ? "sell" : score >= 80 ? "buy" : score >= 55 ? "research" : "weak";

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
