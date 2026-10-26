/** build/search.mjs — search/index.json（契约 §3.4） */

import { clip } from './html.mjs';

export function buildSearchIndex({ posts }) {
  return {
    version: 1,
    docs: posts.map((post) => ({
      u: post.url,
      t: post.title,
      g: post.tags,
      s: post.summaryText,
      b: clip(post.rendered.text, 1200),
    })),
  };
}
