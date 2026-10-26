# V3 实施契约（并行开发唯一口径）

> 2026-10-27 ｜ 所有并行工作共享本文件。**接口不一致时以本文为准**，改接口先改本文。
> 上游：[30-nextgen-v3-plan.md](./30-nextgen-v3-plan.md) · [31-boot-sequence-spec.md](./31-boot-sequence-spec.md) · [32-delivery-and-access.md](./32-delivery-and-access.md)

---

## 0. 已定决策（不可再讨论）

| 项 | 结论 |
|---|---|
| 构建器 | **完全弃用 Hugo**，自有 Node 构建（markdown-it + highlight.js + lightningcss + esbuild） |
| 内容源 | **独立仓库** `K-Blaaaack/articles`，站点构建期读取（不是运行时拉取） |
| 渲染形态 | 静态 MPA + 渐进增强；URL 与现状 1:1 |
| 视觉 | 令牌与类名不变；只允许新增覆盖层与启动失败态 |
| 运行时 | 原生 ESM，esbuild 打包 + 动态分包；启动序列 6 个真实检查点 |

---

## 1. 目录与写入边界（并行时严格不越界）

| 路径 | 归属 | 说明 |
|---|---|---|
| `build/`、`templates/` | builder | 构建内核与模板 |
| `src/styles/`、`scripts/build-css.mjs` | stylist | 样式分层与 CSS 打包 |
| `src/js/`、`scripts/build-js.mjs` | kernel | 运行时内核与 JS 打包 |
| `/home/kb/github/articles/` | content | 独立内容仓库（站点仓库之外） |
| `package.json`、`scripts/build-all.mjs`、`scripts/fetch-content.mjs`、`scripts/check-*.mjs`、`docs/` | lead | 编排、门禁、文档 |
| `dist/` | 全部（只写自己子目录） | builder 写 HTML/XML/media；stylist 写 `dist/css`；kernel 写 `dist/js` |

**硬规则**：不许 `rm -rf dist`；不许改 `package.json`；不许 `git commit` / `git push`；不许改别人的目录。

---

## 2. 内容仓库契约（content 负责）

仓库：`https://github.com/K-Blaaaack/articles`（public）

```
articles/
├── posts/<slug>/index.md        # front matter 见 §2.1；媒体与 md 同目录
├── posts/<slug>/<media>         # 图片等，相对路径引用：![alt](x.webp)
├── pages/info.md                # → /info/
├── pages/stack/index.md         # → /stack/
├── pages/wip.md                 # → /wip/
├── pages/测试.md                 # → /测试/
├── meta.json                    # GitHub Actions 生成，构建期不依赖（可用作校验）
└── .github/workflows/meta.yml   # push 时重算 meta.json
```

### 2.1 front matter schema

```yaml
title: string          # 必填
date: ISO8601          # 必填
updated: ISO8601       # 可选
draft: bool            # 默认 false
tags: [string]         # 统一为数组；旧文件里的 tag: 单值迁移为 tags
categories: [string]   # 可选
summary: string        # 可选，列表页与 SEO 使用
cover: string          # 可选，相对路径
```

### 2.2 媒体

- 相对路径引用，构建期重写为 `/media/<slug>/<name>.<hash8>.<ext>`；子目录（shots/、screenshots/）**摊平**到 `/media/<slug>/`，同名冲突时前缀父目录名。
- 正文里的相对链接（如 `[下载](./fanctl.sh)`）同样重写，不只图片。
- 不允许外链图片作为正文主图（可保留外链，但需显式 http(s)）。

---

## 3. 构建契约（builder）

### 3.1 入口与命令

```bash
node build/index.mjs            # 读取 CONTENT_DIR，输出 dist/
CONTENT_DIR=../articles node build/index.mjs
```

- `CONTENT_DIR` 默认：若 `./content` 存在用它，否则用 `.cache/content`。
- 退出码非 0 = 构建失败；禁止静默跳过坏文章。

### 3.2 产物（必须逐项存在）

```
dist/
├── index.html
├── posts/index.html
├── posts/<slug>/index.html
├── tags/index.html
├── tags/<slug>/index.html
├── info/index.html
├── stack/index.html
├── wip/index.html
├── 测试/index.html
├── 404.html
├── sitemap.xml
├── robots.txt
├── index.xml                    # 站点 RSS
├── posts/index.xml              # 文章 RSS
├── meta.json                    # §3.3
├── search/index.json            # §3.4
├── media/<slug>/<name>.<hash8>.<ext>
└── img/**  static/**            # 静态直通
```

### 3.3 meta.json（运行时唯一数据契约）

```json
{
  "version": 1,
  "generated_at": "2026-10-27T00:00:00.000Z",
  "site": { "title": "K-BLACK", "base": "https://k-black.top/", "description": "K-Black 个人主页" },
  "counts": { "articles": 16, "tags": 58, "pages": 4 },
  "articles": [{
    "slug": "hyps-hub",
    "title": "Hyps Hub：…",
    "date": "2026-10-17T15:00:00+08:00",
    "updated": null,
    "tags": ["Linux"],
    "categories": ["技术笔记"],
    "summary": "…",
    "url": "/posts/hyps-hub/",
    "reading_minutes": 12,
    "words": 5400,
    "cover": null
  }],
  "pages": [{ "slug": "info", "title": "关于本站", "url": "/info/" }],
  "tags": [{ "name": "Linux", "slug": "linux", "count": 3, "url": "/tags/linux/" }]
}
```

- `articles` 只含 `draft: false`，按 date 倒序。
- **pages 的 tags 只作角标，不参与 tag 聚合**（否则多出 `/tags/about|stack|status/`，破坏 80 条 URL parity）；聚合只来自 posts。
- **date/updated 必须是带偏移的字符串**（如 `2026-10-17T15:00:00+08:00`），禁止 `toISOString()` 转 UTC；解析用 Date，序列化时还原偏移。
- slug：目录名；单文件 `foo.md` → slug `foo`。
- tag slug 规则：小写、空格转 `-`、保留中文（与现状 URL 一致）。

### 3.4 search/index.json

```json
{ "version": 1, "docs": [{ "u": "/posts/hyps-hub/", "t": "标题", "g": ["Linux"], "s": "摘要", "b": "正文纯文本前 1200 字" }] }
```

### 3.5 HTML 骨架契约（kernel 依赖）

```html
<!DOCTYPE html>
<html lang="zh-cn" class="no-js" data-page="home|list|post|page|404">
<head>
  <!-- charset / viewport（禁止 maximum-scale、user-scalable=no） -->
  <!-- title / description / canonical / og:* / twitter:card / JSON-LD -->
  <link rel="preload" as="fetch" href="/meta.json" crossorigin>
  <link rel="stylesheet" href="/css/main.<hash8>.css">
  <!-- 内联：no-js → js 切换 + boot 冷却判定（sessionStorage） -->
</head>
<body>
  <!-- 首页才有：#loader（.loader/.loader-terminal/.loader-term-bar/.loader-term-dot/.loader-term-title/.loader-term-body#termBody/.loader-progress/.loader-pbar/.loader-pbar-fill#pFill/.loader-ptxt#pTxt） -->
  <div class="main-wrap" id="mainWrap"><main id="main">…</main>…footer…</div>
  <script type="module" src="/js/main.<hash8>.js"></script>
</body>
</html>
```

- 类名必须沿用现有 `assets/css/main.css` 里的选择器，**不得改名**。
- `<main id="main">`、`<header>`/`<footer>`、skip link 必填。
- 文章页 `data-page="post"`，列表 `data-page="list"`。
- 无 JS 时：`.no-js .loader{display:none}`、`.no-js .main-wrap{opacity:1}`（由 CSS 层提供）。

### 3.6 模板来源

从 `layouts/`（20 文件 / 392 行）移植，保留 DOM 结构与类名；删除 Hugo 语法与重复内联。文案硬编码迁到 `data/*.toml` 或 `content/pages/*.md`。

---

## 4. 样式契约（stylist）

- 文件：`src/styles/{main,tokens,base,components,pages,motion,platform-desktop,platform-mobile}.css`；`main.css` 只做 ```import`。
- `:root` 只允许出现在 `tokens.css`；其余文件只消费 `var(--x)`。
- 类名与 `assets/css/main.css` **逐字一致**；只允许新增：`.loader-line.warn`、`.loader-retry`、`.no-js .loader`、`.no-js .main-wrap`、覆盖层（`.ovl-*`）。
- 产物：`dist/css/main.<hash8>.css`（lightningcss，minify，targets: chrome100/safari15/firefox100）。
- 验收：与旧 CSS 对同一 DOM 的渲染像素 diff = 0（6 模板 × 3 视口）；字节 gzip ≤ 9.9 KB。

---

## 5. 运行时契约（kernel）

### 5.1 模块

```
src/js/
├── main.js        # 入口：boot 编排 + store + 平台探测（~4 KB gzip）
├── overlay.js     # 动态 import：搜索覆盖层 + 目录 + 快捷键（分包）
├── store.js       # 纯逻辑：{overlays[], search, prefs} + 发布订阅，零 DOM
├── boot.js        # 启动状态机（见 31 号规格）
└── platform.js    # pointer:coarse 优先
```

- 产物：`dist/js/main.<hash8>.js` + `dist/js/chunk-*.js`（esbuild splitting，format esm，target es2020，minify）。
- 入口必须是 `<script type="module">`；不得依赖 CDN。

### 5.2 启动检查点（6 个，权重 5/20/25/15/20/15）

| id | 真实工作 | 行文案 |
|---|---|---|
| shell | rAF 后确认样式表已应用 | `> P.R.T.S. NATIVE RHODES ISLAND TERMINAL SERVICE` |
| kernel | `await import('./overlay.js')` | `> [  OK  ] 运行时内核 <KB> KB · <ms> ms` |
| manifest | `fetch('/meta.json')` + 校验 | `> [  OK  ] 文章清单 <n> 篇 · <ms> ms` |
| index | `fetch('/search/index.json')` | `> [  OK  ] 搜索索引 <n> 条 · <KB> KB` |
| media | `img.decode()`（首屏图） | `> [  OK  ] 首屏媒体 <n> 张 · decode <ms> ms` |
| views | 挂载覆盖层 + rAF | `> [  OK  ] 视图挂载 搜索 / 目录 / 标签` |

- 单阶段超时 3s；全局 2.5s 强制放行（`[ WARN ] 启动超时，先行放行`）。
- 失败：红行 + `点击重试`，只重跑失败阶段；连续失败 2 次本会话不再自动播放。
- 冷却：`sessionStorage['boot:seen']`；`?boot=1` 强制重放；`?boot=debug` 显示计时。
- `prefers-reduced-motion`：不播终端，150ms 交接。
- 彩蛋（博士/普瑞赛斯）只在 ready 之后，且不阻塞遮罩消失。

### 5.3 覆盖层

- 搜索：`/` 唤起、输入即搜（标题 10 / 标签 5 / 摘要 3 / 正文 1）、`↑↓` 选择、`Enter` 跳转、`Esc` 关闭。
- 目录：文章页右侧浮动 TOC，滚动高亮。
- 全部无 JS 时不可用但**不得遮挡内容**。

---

## 6. 验收（lead 统一执行）

```bash
npm run build          # css → js → site
npm run check          # links + budget + tokens + boot + html
node scripts/check-parity.mjs   # 新旧 URL 集合 diff
```

- URL 集合与线上 sitemap（80 条）一致。
- 首页 HTML gzip ≤ 4.5 KB；CSS gzip ≤ 9.9 KB；JS gzip ≤ 6 KB。
- 断网首页：红行 + 可重试 + 正文可读。
- 禁用 JS：正文立即可见，无遮罩。
