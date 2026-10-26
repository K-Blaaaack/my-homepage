#!/usr/bin/env node
// serve.mjs —— 本地预览 dist/：正确 MIME + 目录索引 + 404 兜底。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const root = join(process.cwd(), 'dist');
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.sh': 'text/plain; charset=utf-8',
};

async function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, clean);
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
  } catch {
    if (!extname(file)) file = join(root, '404.html');
  }
  return file;
}

createServer(async (req, res) => {
  try {
    const file = await resolve(req.url || '/');
    const body = await readFile(file);
    const ext = extname(file);
    res.writeHead(ext === '.html' && file.endsWith('404.html') ? 404 : 200, {
      'content-type': types[ext] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}).listen(port, () => console.log(`[serve] http://127.0.0.1:${port}/ (dist/)`));
