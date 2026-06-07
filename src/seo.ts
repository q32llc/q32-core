export type SitemapUrl = {
  loc: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
};

export type PageMeta = {
  title: string;
  description?: string;
  canonical?: string;
  image?: string;
  type?: string;
  noindex?: boolean;
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

export function renderRobotsTxt(options: { allow?: string[]; disallow?: string[]; sitemap?: string | string[] } = {}): string {
  const lines = ["User-agent: *"];
  for (const path of options.allow ?? []) lines.push(`Allow: ${path}`);
  for (const path of options.disallow ?? []) lines.push(`Disallow: ${path}`);
  for (const sitemap of Array.isArray(options.sitemap) ? options.sitemap : options.sitemap ? [options.sitemap] : []) {
    lines.push(`Sitemap: ${sitemap}`);
  }
  return `${lines.join("\n")}\n`;
}

export function metaTags(meta: PageMeta): Record<string, string> {
  const tags: Record<string, string> = {
    title: meta.title,
    "og:title": meta.title,
  };
  if (meta.description) {
    tags.description = meta.description;
    tags["og:description"] = meta.description;
  }
  if (meta.canonical) {
    tags.canonical = meta.canonical;
    tags["og:url"] = meta.canonical;
  }
  if (meta.image) tags["og:image"] = meta.image;
  if (meta.type) tags["og:type"] = meta.type;
  if (meta.noindex) tags.robots = "noindex,nofollow";
  return tags;
}

function clampPriority(priority: number): number {
  if (!Number.isFinite(priority)) return 0.5;
  return Math.max(0, Math.min(1, priority));
}
