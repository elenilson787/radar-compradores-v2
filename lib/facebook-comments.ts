import type { Campaign } from "./types";
import type { PublicSearchResult } from "./hasdata";
import { profileLooksLikeNonBuyer } from "./source-quality";

export type FacebookCommentResult = PublicSearchResult & {
  kind: "comment";
};

type FacebookCommentSearch = {
  results: FacebookCommentResult[];
  warnings: string[];
  apiCalls: number;
  pagesChecked: number;
};

const COMMENT_INTENT_PATTERNS = [
  "eu quero",
  "quero comprar",
  "quero uma",
  "quero um",
  "manda o link",
  "manda link",
  "me manda o link",
  "tem link",
  "qual o link",
  "onde compra",
  "onde comprar",
  "onde encontro",
  "qual o preço",
  "qual o preco",
  "qual o valor",
  "quanto custa",
  "também quero",
  "tambem quero",
  "preciso de uma",
  "preciso de um",
];

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function hasIntent(text: string) {
  const value = normalize(text);
  return COMMENT_INTENT_PATTERNS.some((pattern) => value.includes(normalize(pattern)));
}

function isFacebookUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes("facebook.com");
  } catch {
    return false;
  }
}

function parseComment(item: unknown) {
  if (typeof item === "string") {
    const [author, ...parts] = item.split("|||");
    const text = parts.join("|||").trim();
    if (author?.trim() && text) return { author: author.trim(), text };
    return null;
  }

  if (!item || typeof item !== "object") return null;
  const value = item as Record<string, unknown>;
  const author = [value.author, value.username, value.user, value.profile]
    .find((entry) => typeof entry === "string") as string | undefined;
  const text = [value.text, value.comment, value.body, value.content]
    .find((entry) => typeof entry === "string") as string | undefined;
  if (!author?.trim() || !text?.trim()) return null;
  return { author: author.trim(), text: text.trim() };
}

function contextualText(comment: string, campaign: Campaign) {
  const product = campaign.products.slice(0, 3).join(", ");
  return `Comentário público em publicação sobre ${product}: ${comment.trim()}`;
}

async function scanFacebookSeed(seed: PublicSearchResult, campaign: Campaign, apiKey: string) {
  try {
    const response = await fetch("https://api.hasdata.com/scrape/web", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        url: seed.publicationUrl,
        jsRendering: true,
        wait: 2200,
        blockResources: true,
        blockAds: true,
        outputFormat: ["json", "text"],
        aiExtractRules: {
          comments: {
            type: "list",
            description: "Extract only real comments that are visibly rendered to an unauthenticated visitor in the Facebook comments area. Each item must be COMMENT_AUTHOR|||EXACT_COMMENT_TEXT. The COMMENT_AUTHOR must be the person who wrote that comment, never the Page/post publisher. Ignore the post caption, Page name, Page replies, buttons, login banners, UI labels, suggested content and hidden comments. If a login banner is visible but some comments are still visible, return only those visible comments. Never infer or invent an author or comment. Maximum 20 items.",
          },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(35_000),
    });

    if (!response.ok) {
      return {
        results: [] as FacebookCommentResult[],
        warning: `Facebook comentários: página pública respondeu ${response.status}.`,
      };
    }

    const data = await response.json() as { aiResponse?: { comments?: unknown[] } };
    const rawComments = Array.isArray(data.aiResponse?.comments) ? data.aiResponse?.comments ?? [] : [];
    const results: FacebookCommentResult[] = [];

    for (const raw of rawComments) {
      const parsed = parseComment(raw);
      if (!parsed || !hasIntent(parsed.text)) continue;

      const profileName = `Facebook · ${parsed.author}`;
      if (profileLooksLikeNonBuyer(profileName)) continue;

      results.push({
        source: "Facebook",
        profileName,
        publicationUrl: seed.publicationUrl,
        publicationText: contextualText(parsed.text, campaign),
        publishedAt: null,
        kind: "comment",
      });

      if (results.length >= 12) break;
    }

    return {
      results,
      warning: rawComments.length && !results.length
        ? "Facebook comentários: comentários estavam visíveis, mas nenhum tinha autoria segura + intenção de compra suficiente."
        : "",
    };
  } catch (error) {
    return {
      results: [] as FacebookCommentResult[],
      warning: error instanceof Error ? `Facebook comentários: ${error.message}` : "Facebook comentários: falha ao ler a página pública.",
    };
  }
}

export async function searchFacebookPublicComments(
  campaign: Campaign,
  apiKey: string,
  seeds: PublicSearchResult[]
): Promise<FacebookCommentSearch> {
  if (!campaign.sources.includes("Facebook")) {
    return { results: [], warnings: [], apiCalls: 0, pagesChecked: 0 };
  }

  const seenUrls = new Set<string>();
  const eligibleSeeds = seeds.filter((item) => {
    if (item.source !== "Facebook" || !isFacebookUrl(item.publicationUrl)) return false;
    const key = item.publicationUrl.toLowerCase().replace(/[?#].*$/, "");
    if (seenUrls.has(key)) return false;
    seenUrls.add(key);
    return true;
  }).slice(0, 2);

  if (!eligibleSeeds.length) {
    return {
      results: [],
      warnings: ["Facebook comentários: nenhuma publicação pública elegível foi encontrada nesta execução."],
      apiCalls: 0,
      pagesChecked: 0,
    };
  }

  const batches = await Promise.all(
    eligibleSeeds.map((seed) => scanFacebookSeed(seed, campaign, apiKey))
  );

  const results: FacebookCommentResult[] = [];
  const warnings: string[] = [];
  const seenComments = new Set<string>();

  for (const batch of batches) {
    if (batch.warning) warnings.push(batch.warning);
    for (const item of batch.results) {
      const key = `${normalize(item.profileName)}|${normalize(item.publicationText)}`;
      if (seenComments.has(key)) continue;
      seenComments.add(key);
      results.push(item);
      if (results.length >= 20) break;
    }
    if (results.length >= 20) break;
  }

  return {
    results,
    warnings,
    apiCalls: eligibleSeeds.length,
    pagesChecked: eligibleSeeds.length,
  };
}
