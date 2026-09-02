import { Campaign, Lead, SearchRun } from "./types";
import { analyzeText } from "./scoring";
import { createFingerprint } from "./dedupe";

export const initialCampaigns: Campaign[] = [
  {
    id: "camp_casa",
    name: "itens de casa e cozinha",
    location: "Brasil",
    products: ["air fryer", "fritadeira elétrica", "geladeira", "lavadora"],
    intentPhrases: ["quero comprar", "onde comprar", "alguém recomenda", "manda link", "qual modelo"],
    negativeKeywords: ["vendo", "minha loja", "revendedor"],
    sources: ["Facebook", "Instagram", "TikTok", "Reddit", "Web"],
    minimumScore: 55,
    active: true,
  },
];

const sampleText = "Alguém sabe onde comprar uma air fryer boa até R$ 500? Quero comprar hoje.";
const sampleUrl = "https://www.facebook.com/publicacao/exemplo";

export const initialLeads: Lead[] = [
  {
    id: "lead_1",
    campaignId: "camp_casa",
    source: "Facebook",
    profileName: "Maria S.",
    publicationUrl: sampleUrl,
    publicationText: sampleText,
    publishedAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    status: "Novo",
    analysis: analyzeText(sampleText, initialCampaigns[0], new Date(Date.now() - 40 * 60 * 1000).toISOString()),
    fingerprint: createFingerprint("Facebook", sampleUrl, sampleText),
  }
];

export const initialRuns: SearchRun[] = [
  { id: "run_1", campaignId: "camp_casa", startedAt: new Date().toISOString(), queries: 0, found: 0, saved: 0, status: "Concluída" },
];
