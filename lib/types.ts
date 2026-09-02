export type Source = "Facebook" | "Instagram" | "TikTok" | "Reddit" | "Web";
export type LeadStatus = "Novo" | "Revisado" | "Contatado" | "Convertido" | "Descartado";
export type LeadBand = "Alta intenção" | "Possível comprador" | "Sinal fraco";

export type Campaign = {
  id: string;
  name: string;
  location: string;
  products: string[];
  intentPhrases: string[];
  negativeKeywords: string[];
  sources: Source[];
  minimumScore: number;
  active: boolean;
};

export type Analysis = {
  score: number;
  band: LeadBand;
  intent: "buy" | "research" | "weak" | "sell";
  product: string | null;
  budget: number | null;
  urgency: "alta" | "média" | "baixa" | null;
  relevance: number;
  recencyWeight: number;
  signals: string[];
  reason: string;
};

export type Lead = {
  id: string;
  campaignId: string;
  source: Source;
  profileName: string;
  profileUrl?: string;
  publicationUrl: string;
  publicationText: string;
  publishedAt: string;
  createdAt: string;
  status: LeadStatus;
  analysis: Analysis;
  fingerprint: string;
  note?: string;
};

export type SearchRun = {
  id: string;
  campaignId: string;
  startedAt: string;
  queries: number;
  found: number;
  saved: number;
  status: "Concluída" | "Executando" | "Falhou";
};
