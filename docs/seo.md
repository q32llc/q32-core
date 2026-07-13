# SEO primitives

The SEO module provides framework-neutral sitemap, robots, social metadata, and JSON-LD helpers.

## Social metadata

Use `resolvePageMeta` when a framework has its own metadata model. It normalizes canonical, Open Graph, Twitter, image, and robots values without rendering HTML.

```ts
import { resolvePageMeta } from "@q32/core/seo";

const metadata = resolvePageMeta({
  title: "Example page",
  description: "A page-specific description.",
  canonical: "https://example.com/page",
  image: {
    url: "https://example.com/social/page.png",
    alt: "Example page preview",
    width: 1200,
    height: 630,
  },
  type: "website",
  siteName: "Example",
  locale: "en_US",
  twitter: true,
});
```

Use `metaTags` for a flat tag map. Existing string-valued `image` inputs remain supported. Set `twitter` to `true` for defaults or pass card, site, and creator options.

## JSON-LD

`webPageJsonLd` and `breadcrumbListJsonLd` create individual schema nodes. `jsonLdGraph` combines nodes under the Schema.org context. `serializeJsonLd` escapes characters that can terminate or alter an inline script.

```ts
import { breadcrumbListJsonLd, jsonLdGraph, serializeJsonLd, webPageJsonLd } from "@q32/core/seo";

const graph = jsonLdGraph([
  webPageJsonLd({
    id: "https://example.com/page#webpage",
    url: "https://example.com/page",
    name: "Example page",
    isPartOf: "https://example.com/#website",
    inLanguage: "en-US",
  }),
  breadcrumbListJsonLd([
    { name: "Home", item: "https://example.com/" },
    { name: "Example page", item: "https://example.com/page" },
  ]),
]);

const scriptBody = serializeJsonLd(graph);
```

Application-specific schema nodes, offer data, page registries, and social-image providers stay in the consuming application.
