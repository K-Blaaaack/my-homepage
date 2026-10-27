/**
 * Pages Function：/posts/* 的兜底路由
 *
 * 静态托管上没有 /posts/<新 slug>/ 这个文件，CDN 会直接给 404。
 * 这里先让静态资源照常命中；只有 404 时，把 404 外壳以 200 返回，
 * 由前端运行时去 GitHub 拉那篇 md 渲染。
 *
 * 效果：新文章不用重建站点也能拿到 200 状态码。
 */
export async function onRequest(context) {
  const { request, env, next } = context;

  // 1. 先走静态资源：已构建的文章、列表页原样返回
  const res = await next();
  if (res.status !== 404) return res;

  // 2. 静态没有 → 拿 404 外壳，改 200
  let shell = null;
  try {
    shell = await env.ASSETS.fetch(new URL('/404.html', request.url));
  } catch (e) {
    shell = null;
  }
  if (!shell || !shell.ok) return res;

  const html = await shell.text();
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-kb-shell': 'runtime',
    },
  });
}
