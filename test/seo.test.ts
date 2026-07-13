import { describe, expect, it } from "vitest";
import {
  breadcrumbListJsonLd,
  jsonLdGraph,
  metaTags,
  renderRobotsTxt,
  renderSitemapXml,
  resolvePageMeta,
  serializeJsonLd,
  webPageJsonLd,
  xmlEscape,
} from "../src/seo.js";

describe("SEO helpers", () => {
  it("renders sitemap and robots text", () => {
    expect(xmlEscape(`https://e.com/?a=1&b="x"`)).toContain("&amp;");
    const sitemap = renderSitemapXml([{ loc: "https://example.com/", priority: 2, changefreq: "daily" }]);
    expect(sitemap).toContain("<priority>1.0</priority>");
    expect(renderRobotsTxt({ disallow: ["/admin"], sitemap: "https://example.com/sitemap.xml", host: "https://example.com" })).toBe(
      "User-agent: *\nDisallow: /admin\nSitemap: https://example.com/sitemap.xml\nHost: https://example.com\n",
    );
  });

  it("creates metadata tags", () => {
    expect(metaTags({
      title: "Title",
      description: "Desc",
      canonical: "https://example.com/",
      image: { url: "https://example.com/og.png", alt: "Example", width: 1200, height: 630 },
      type: "website",
      siteName: "Example",
      locale: "en_US",
      twitter: { site: "@example" },
      noindex: true,
    })).toMatchObject({
      title: "Title",
      description: "Desc",
      canonical: "https://example.com/",
      "og:image": "https://example.com/og.png",
      "og:image:alt": "Example",
      "og:image:width": "1200",
      "og:site_name": "Example",
      "twitter:card": "summary_large_image",
      "twitter:site": "@example",
      robots: "noindex,nofollow",
    });
  });

  it("resolves framework-neutral social metadata", () => {
    expect(resolvePageMeta({ title: "Title", image: "https://example.com/og.png", twitter: true })).toMatchObject({
      openGraph: { title: "Title", image: { url: "https://example.com/og.png" } },
      twitter: { card: "summary_large_image", title: "Title" },
    });
    expect(resolvePageMeta({ title: "Text only", twitter: true }).twitter?.card).toBe("summary");
  });

  it("builds and safely serializes JSON-LD", () => {
    const page = webPageJsonLd({
      id: "https://example.com/about#webpage",
      url: "https://example.com/about",
      name: "About <Example>",
      isPartOf: "https://example.com/#website",
      inLanguage: "en-US",
    });
    const breadcrumb = breadcrumbListJsonLd([
      { name: "Home", item: "https://example.com/" },
      { name: "About", item: "https://example.com/about" },
    ], "https://example.com/about#breadcrumb");
    const graph = jsonLdGraph([page, breadcrumb]);
    expect(graph).toMatchObject({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, { "@type": "BreadcrumbList" }] });
    expect(serializeJsonLd(graph)).toContain("About \\u003cExample>");
    expect(serializeJsonLd({ text: "line\u2028separator" })).toContain("\\u2028");
  });
});
