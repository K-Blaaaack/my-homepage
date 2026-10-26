#!/usr/bin/env node
// fetch-content.mjs —— CI/本地：内容仓库缺失时克隆到 .cache/content。
// 用法：node scripts/fetch-content.mjs [owner/repo] [branch]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2] || process.env.CONTENT_REPO || 'K-Blaaaack/articles';
const branch = process.argv[3] || process.env.CONTENT_BRANCH || 'main';
const target = process.env.CONTENT_DIR || join(process.cwd(), '.cache', 'content');

if (existsSync(join(target, 'meta.json'))) {
  console.log(`[content] 已存在：${target}`);
  process.exit(0);
}

if (existsSync(target)) rmSync(target, { recursive: true, force: true });
mkdirSync(join(process.cwd(), '.cache'), { recursive: true });

const url = `https://github.com/${repo}.git`;
console.log(`[content] clone ${url} → ${target}`);
const res = spawnSync('git', ['clone', '--depth', '1', '--branch', branch, url, target], { stdio: 'inherit' });
if (res.status !== 0) {
  console.error('[content] clone 失败');
  process.exit(1);
}
console.log('[content] ok');
