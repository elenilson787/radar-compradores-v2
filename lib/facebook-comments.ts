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

type ParsedComment = {
  author: string;
  text: string;
};

type WebScrapeResponse = {
  aiResponse?: { comments?: unknown[] };
  text?: string;
  content?: string;
  markdown?: string;
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

const UI_LINE_PATTERNS = [
  "mais relevantes",
  "mais comentarios",
  "mais comentários",
  "ver mais comentarios",
  "ver mais comentários",
  "respondeu",
  "resposta",
  "respostas",
  "curtir",
  "comentar",
  "compartilhar",
  "entrar",
  "criar nova conta",
  "entre ou cadastre-se",
  "seguir",
  "pagina inicial",
  "página inicial",
  "ao vivo",
  "reels",
  "explorar",
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

function parseComment(item: unknown): ParsedComment | null {
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
  const text = [value.comment, value.text, value.body, value.content]
    .find((entry) => typeof entry === "string") as string | undefined;
  if (!author?.trim() || !text?.trim()) return null;
  return { author: author.trim(), text: text.trim() };
}

function looksLikeTimestamp(line: string) {
  const value = normalize(line);
  return /^\d+\s*(min|minuto|minutos|h|hora|horas|d|dia|dias|sem|semana|semanas|mes|meses|ano|anos)$/.test(value)
    || /^ha\s+\d+\s+/.test(value);
}

function looksLikeUiLine(line: string) {
  const value = normalize(line);
  return UI_LINE_PATTERNS.some((pattern) => value.includes(normalize(pattern)))
    || /^\d+\s+(comentario|comentarios|visualizacao|visualizacoes)$/.test(value);
}

function looksLikeAuthor(line: string, seedProfileName: string) {
  const value = line.replace(/\s+/g, " ").trim();
  if (value.length < 2 || value.length > 80) return false;
  if (hasIntent(value) || looksLikeTimestamp(value) || looksLikeUiLine(value)) return false;
  if (/^[\d\W_]+$/u.test(value)) return false;
  if (normalize(value) === normalize(seedProfileName)) return false;
  if (profileLooksLikeNonBuyer(value)) return false;
  return /[A-Za-zÀ-ÖØ-öø-ÿА-Яа-я]/u.test(value);
}

function textFromResponse(data: WebScrapeResponse) {
  if (typeof data.text === "string") return data.text;
  if (typeof data.markdown === "string") return data.markdown;
  if (typeof data.content === "string") {
    return data.content
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"');
  }
  return "";
}

function parseCommentsFromRenderedText(rawText: string, seedProfileName: string): ParsedComment[] {
  if (!rawText.trim()) return [];
  const lines = rawText
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3000);

  const results: ParsedComment[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const comment = lines[index];
    if (!hasIntent(comment)) continue;
    if (comment.length > 220) continue;

    let author = "";
    for (let offset = 1; offset <= 5 && index - offset >= 0; offset += 1) {
      const candidate = lines[index - offset];
      if (looksLikeAuthor(candidate, seedProfileName)) {
        author = candidate;
        break;
      }
    }

    if (!author) continue;
    const key = `${normalize(author)}|${normalize(comment)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ author, text: comment });
    if (results.length >= 20) break;
  }

  return results;
}

function contextualText(comment: string, campaign: Campaign, author: string) {
  const product = campaign.products.slice(0, 3).join(", ");
  return `Comentário público em publicação sobre ${product}. Usuário: ${author}. Comentário: ${comment.trim()}`;
}

function mergeComments(aiItems: unknown[], renderedText: string, seedProfileName: string) {
  const parsed: ParsedComment[] = [];
  const seen = new Set<string>();

  const add = (item: ParsedComment | null) => {
    if (!item || !hasIntent(item.text)) return;
    if (!looksLikeAuthor(item.author, seedProfileName)) return;
    const key = `${normalize(item.author)}|${normalize(item.text)}`;
    if (seen.has(key)) return;
    seen.add(key);
    parsed.push(item);
  };

  for (const raw of aiItems) add(parseComment(raw));
  for (const item of parseCommentsFromRenderedText(renderedText, seedProfileName)) add(item);
  return parsed.slice(0, 20);
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
        proxyType: "datacenter",
        proxyCountry: "BR",
        headers: { "Accept-Language": "pt-BR,pt;q=0.9" },
        jsRendering: true,
        wait: 4500,
        blockResources: true,
        blockAds: true,
        outputFormat: ["json", "text"],
        aiExtractRules: {
          comments: {
            type: "list",
            description: "Visible Facebook comments only. Do not include the post caption, Page name, Page replies, login banners, buttons, navigation or suggested content. Never infer hidden comments.",
            output: {
              author: {
                type: "string",
                description: "Exact visible name of the person who wrote the comment. Never use the Page/post publisher as author unless that Page truly wrote the comment.",
              },
              comment: {
                type: "string",
                description: "Exact visible comment text written by that author. Keep short buyer-intent comments such as Eu quero, Qual valor, Onde comprar, Tem link, Quanto custa.",
              },
            },
          },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(40_000),
    });

    if (!response.ok) {
      return {
        results: [] as FacebookCommentResult[],
        warning: `Facebook comentários: página pública respondeu ${response.status}.`,
      };
    }

    const data = await response.json() as WebScrapeResponse;
    const aiItems = Array.isArray(data.aiResponse?.comments) ? data.aiResponse?.comments ?? [] : [];
    const renderedText = textFromResponse(data);
    const parsedComments = mergeComments(aiItems, renderedText, seed.profileName);
    const results: FacebookCommentResult[] = [];

    for (const parsed of parsedComments) {
      results.push({
        source: "Facebook",
        profileName: parsed.author,
        publicationUrl: seed.publicationUrl,
        publicationText: contextualText(parsed.text, campaign, parsed.author),
        publishedAt: seed.publishedAt,
        kind: "comment",
      });
      if (results.length >= 12) break;
    }

    const hadPageText = Boolean(renderedText.trim());
    return {
      results,
      warning: !results.length
        ? hadPageText
          ? "Facebook comentários: a página renderizou, mas nenhum par autor + comentário com intenção de compra pôde ser atribuído com segurança."
          : "Facebook comentários: a página não devolveu texto renderizado nem comentários estruturados nesta execução."
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
  const eligibleSeeds = seeds
    .filter((item) => {
      if (item.source !== "Facebook" || !isFacebookUrl(item.publicationUrl)) return false;
      const key = item.publicationUrl.toLowerCase().replace(/[?#].*$/, "");
      if (seenUrls.has(key)) return false;
      seenUrls.add(key);
      return true;
    })
    .sort((a, b) => {
      const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 2);

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
