/** head 元信息：title / description / canonical / OG / twitter / JSON-LD（契约 §3.5 + 任务书 §7） */
import { esc, jsonld } from '../../../build/html.mjs';

export function headMeta({ site, page }) {
  const desc = page.description || site.description;
  const canonical = page.canonical;
  const image = site.base + 'icon-512.png';
  const tags = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:type" content="${esc(page.ogType || 'website')}">`,
    `<meta property="og:site_name" content="${esc(site.title)}">`,
    `<meta property="og:title" content="${esc(page.title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta name="twitter:card" content="summary">`,
  ];
  if (page.jsonLd) tags.push(`<script type="application/ld+json">${jsonld(page.jsonLd)}</script>`);
  return tags.join('\n');
}
