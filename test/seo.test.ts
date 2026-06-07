import { describe, expect, it } from "vitest";
import { metaTags, renderRobotsTxt, renderSitemapXml, xmlEscape } from "../src/seo.js";

describe("SEO helpers", () => {
  it("renders sitemap and robots text", () => {
    expect(xmlEscape(`https://e.com/?a=1&b="x"`)).toContain("&amp;");
    const sitemap = renderSitemapXml([{ loc: "https://example.com/", priority: 2, changefreq: "daily" }]);
    expect(sitemap).toContain("<priority>1.0</priority>");
    expect(renderRobotsTxt({ disallow: ["/admin"], sitemap: "https://example.com/sitemap.xml" })).toBe(
      "User-agent: *\nDisallow: /admin\nSitemap: https://example.com/sitemap.xml\n",
    );
  });

  it("creates metadata tags", () => {
    expect(metaTags({
      title: "Title",
      description: "Desc",
      canonical: "https://example.com/",
      image: "https://example.com/og.png",
      type: "website",
      noindex: true,
    })).toMatchObject({
      title: "Title",
      description: "Desc",
      canonical: "https://example.com/",
      "og:image": "https://example.com/og.png",
      robots: "noindex,nofollow",
    });
  });
});
