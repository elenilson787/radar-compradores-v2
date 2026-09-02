function normalizeText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "rdc", "rdt"].forEach((p) => parsed.searchParams.delete(p));

    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.hostname = host;

    if (host.endsWith("reddit.com")) {
      parsed.hostname = "reddit.com";
      const thread = parsed.pathname.match(/\/r\/[^/]+\/comments\/([^/]+)/i);
      if (thread?.[1]) {
        return `https://reddit.com/comments/${thread[1].toLowerCase()}`;
      }
    }

    if (host.endsWith("facebook.com")) {
      parsed.hostname = "facebook.com";
    }

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

export function createFingerprint(_source: string, url: string, text: string) {
  // Source is intentionally excluded. The same Reddit/Facebook result can first be
  // discovered as Web and later be identified by its actual network.
  const normalized = `${normalizeUrl(url)}|${normalizeText(text)}`;
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fp_${(hash >>> 0).toString(16)}`;
}
