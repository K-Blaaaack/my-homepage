/** build/routes.mjs — 路由表：URL ↔ 输出路径 ↔ 渲染器（URL 与线上 1:1） */

export function buildRoutes({ posts, pages, tags }) {
  const routes = [];

  routes.push({ kind: 'home', url: '/', out: 'index.html', dataPage: 'home', activeKey: 'home' });
  routes.push({ kind: 'posts-list', url: '/posts/', out: 'posts/index.html', dataPage: 'list', activeKey: 'posts' });

  for (const post of posts) {
    routes.push({ kind: 'post', url: post.url, out: post.out, dataPage: 'post', activeKey: 'posts', post });
  }

  routes.push({ kind: 'tags-index', url: '/tags/', out: 'tags/index.html', dataPage: 'list', title: 'Tags' });
  for (const tag of tags) {
    routes.push({ kind: 'tag', url: tag.url, out: `tags/${tag.slug}/index.html`, dataPage: 'list', tag, title: tag.name });
  }

  for (const page of pages) {
    routes.push({
      kind: 'page',
      url: page.url,
      out: page.out,
      dataPage: 'page',
      activeKey: page.slug === 'stack' ? 'stack' : '',
      page,
    });
  }

  routes.push({ kind: '404', url: '/404.html', out: '404.html', dataPage: '404' });

  // 输出路径唯一性：任何重复都是构建错误
  const seen = new Map();
  for (const route of routes) {
    if (seen.has(route.out)) {
      throw new Error(`路由冲突: ${route.url} 与 ${seen.get(route.out)} 都输出 ${route.out}`);
    }
    seen.set(route.out, route.url);
  }

  return routes;
}

/** sitemap 收录的 URL：除 404 外的全部 HTML 页 */
export function sitemapRoutes(routes) {
  return routes.filter((r) => r.kind !== '404');
}
