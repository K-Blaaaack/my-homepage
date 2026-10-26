/** build/media.mjs — 内容媒体内容哈希命名 + static/ 直通 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import fg from 'fast-glob';

export function hash8(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

/**
 * 文章包（posts/<slug>/index.md 同级）里的非 md 文件 → dist/media/<slug>/<name>.<hash8>.<ext>
 * 返回 Map<绝对源路径, {url, out, bytes, hash, name}>
 */
export function buildMediaIndex({ posts }) {
  const index = new Map();
  const used = new Map(); // slug -> Set<文件名>

  for (const post of posts) {
    if (!post.bundle) continue;
    const files = fg
      .sync(['**/*'], { cwd: post.dir, absolute: true, dot: false, onlyFiles: true })
      .filter((abs) => !abs.endsWith('.md'))
      .sort();

    const taken = used.get(post.slug) || new Set();
    used.set(post.slug, taken);

    for (const abs of files) {
      const buf = fs.readFileSync(abs);
      const hash = hash8(buf);
      const base = path.basename(abs);
      const ext = path.extname(base);
      const stem = base.slice(0, base.length - ext.length);
      let name = `${stem}.${hash}${ext}`;

      if (taken.has(name)) {
        // 同目录同名（不同子目录）时带上父目录名，避免互相覆盖
        const parent = path.basename(path.dirname(abs));
        name = `${parent}-${stem}.${hash}${ext}`;
        if (taken.has(name)) throw new Error(`媒体命名冲突: ${abs}`);
      }
      taken.add(name);

      index.set(abs, {
        url: `/media/${post.slug}/${name}`,
        out: path.join('media', post.slug, name),
        bytes: buf.length,
        hash,
        name,
      });
    }
  }

  return index;
}

export function emitMedia({ mediaIndex, distDir }) {
  const dir = path.join(distDir, 'media');
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [abs, info] of mediaIndex) {
    const dest = path.join(distDir, info.out);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
  }
  return mediaIndex.size;
}

/** static/ 原样直通 dist/（契约 §3.2） */
export function emitStatic({ staticDir, distDir }) {
  if (!fs.existsSync(staticDir)) return 0;
  const files = fg.sync(['**/*'], { cwd: staticDir, absolute: true, dot: true, onlyFiles: true });
  for (const abs of files) {
    const rel = path.relative(staticDir, abs);
    const dest = path.join(distDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
  }
  return files.length;
}
