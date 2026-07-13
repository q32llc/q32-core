export type SitemapUrl = {
  loc: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
};

export type SocialImage = {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
};

export type TwitterMeta = {
  card?: "summary" | "summary_large_image" | "app" | "player";
  site?: string;
  creator?: string;
};

export type PageMeta = {
  title: string;
  description?: string;
  canonical?: string;
  image?: string | SocialImage;
  type?: string;
  siteName?: string;
  locale?: string;
  twitter?: boolean | TwitterMeta;
  noindex?: boolean;
};

export type ResolvedPageMeta = {
  title: string;
  description?: string;
  canonical?: string;
  robots?: string;
  openGraph: {
    title: string;
    description?: string;
    url?: string;
    image?: SocialImage;
    type?: string;
    siteName?: string;
    locale?: string;
  };
  twitter?: {
    card: "summary" | "summary_large_image" | "app" | "player";
    title: string;
    description?: string;
    image?: SocialImage;
    site?: string;
    creator?: string;
  };
};

export type JsonLdNode = Record<string, unknown>;

export type BreadcrumbItem = {
  name: string;
  item: string;
};

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderSitemapXml(urls: SitemapUrl[]): string {
  const body = urls
    .map((url) => {
      const fields = [
        `<loc>${xmlEscape(url.loc)}</loc>`,
        url.lastmod ? `<lastmod>${xmlEscape(url.lastmod)}</lastmod>` : "",
        url.changefreq ? `<changefreq>${url.changefreq}</changefreq>` : "",
        url.priority === undefined ? "" : `<priority>${clampPriority(url.priority).toFixed(1)}</priority>`,
      ].filter(Boolean);
      return `  <url>\n    ${fields.join("\n    ")}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function renderRobotsTxt(options: { allow?: string[]; disallow?: string[]; sitemap?: string | string[]; host?: string } = {}): string {
  const lines = ["User-agent: *"];
  for (const path of options.allow ?? []) lines.push(`Allow: ${path}`);
  for (const path of options.disallow ?? []) lines.push(`Disallow: ${path}`);
  for (const sitemap of Array.isArray(options.sitemap) ? options.sitemap : options.sitemap ? [options.sitemap] : []) {
    lines.push(`Sitemap: ${sitemap}`);
  }
  if (options.host) lines.push(`Host: ${options.host}`);
  return `${lines.join("\n")}\n`;
}

export function resolvePageMeta(meta: PageMeta): ResolvedPageMeta {
  const image = resolveImage(meta.image);
  const openGraph: ResolvedPageMeta["openGraph"] = {
    title: meta.title,
    description: meta.description,
    url: meta.canonical,
    image,
    type: meta.type,
    siteName: meta.siteName,
    locale: meta.locale,
  };
  const twitterOptions = typeof meta.twitter === "object" ? meta.twitter : {};
  const twitter = meta.twitter ? {
    card: twitterOptions.card ?? (image ? "summary_large_image" : "summary"),
    title: meta.title,
    description: meta.description,
    image,
    site: twitterOptions.site,
    creator: twitterOptions.creator,
  } : undefined;
  return {
    title: meta.title,
    description: meta.description,
    canonical: meta.canonical,
    robots: meta.noindex ? "noindex,nofollow" : undefined,
    openGraph,
    twitter,
  };
}

export function metaTags(meta: PageMeta): Record<string, string> {
  const resolved = resolvePageMeta(meta);
  const tags: Record<string, string> = {
    title: resolved.title,
    "og:title": resolved.openGraph.title,
  };
  set(tags, "description", resolved.description);
  set(tags, "canonical", resolved.canonical);
  set(tags, "robots", resolved.robots);
  set(tags, "og:description", resolved.openGraph.description);
  set(tags, "og:url", resolved.openGraph.url);
  set(tags, "og:image", resolved.openGraph.image?.url);
  set(tags, "og:image:alt", resolved.openGraph.image?.alt);
  set(tags, "og:image:width", numberString(resolved.openGraph.image?.width));
  set(tags, "og:image:height", numberString(resolved.openGraph.image?.height));
  set(tags, "og:type", resolved.openGraph.type);
  set(tags, "og:site_name", resolved.openGraph.siteName);
  set(tags, "og:locale", resolved.openGraph.locale);
  set(tags, "twitter:card", resolved.twitter?.card);
  set(tags, "twitter:title", resolved.twitter?.title);
  set(tags, "twitter:description", resolved.twitter?.description);
  set(tags, "twitter:image", resolved.twitter?.image?.url);
  set(tags, "twitter:image:alt", resolved.twitter?.image?.alt);
  set(tags, "twitter:site", resolved.twitter?.site);
  set(tags, "twitter:creator", resolved.twitter?.creator);
  return tags;
}

export function jsonLdGraph(nodes: readonly JsonLdNode[]): JsonLdNode {
  return { "@context": "https://schema.org", "@graph": [...nodes] };
}

export function webPageJsonLd(input: {
  id?: string;
  url: string;
  name: string;
  description?: string;
  isPartOf?: string;
  about?: string;
  inLanguage?: string;
}): JsonLdNode {
  return compact({
    "@type": "WebPage",
    "@id": input.id,
    url: input.url,
    name: input.name,
    description: input.description,
    isPartOf: input.isPartOf ? { "@id": input.isPartOf } : undefined,
    about: input.about ? { "@id": input.about } : undefined,
    inLanguage: input.inLanguage,
  });
}

export function breadcrumbListJsonLd(items: readonly BreadcrumbItem[], id?: string): JsonLdNode {
  return compact({
    "@type": "BreadcrumbList",
    "@id": id,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.item,
    })),
  });
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function resolveImage(image: PageMeta["image"]): SocialImage | undefined {
  if (!image) return undefined;
  return typeof image === "string" ? { url: image } : { ...image };
}

function compact(input: JsonLdNode): JsonLdNode {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function set(tags: Record<string, string>, key: string, value: string | undefined): void {
  if (value !== undefined) tags[key] = value;
}

function numberString(value: number | undefined): string | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : String(value);
}

function clampPriority(priority: number): number {
  if (!Number.isFinite(priority)) return 0.5;
  return Math.max(0, Math.min(1, priority));
}
