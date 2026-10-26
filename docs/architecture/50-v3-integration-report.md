# V3 集成验收报告

> 2026-10-27 ｜ 从 Hugo 切到自有 Node 构建 + 运行时内核，一次性完成 S0–S2。
> 上游：[30-nextgen-v3-plan.md](./30-nextgen-v3-plan.md) · [40-implementation-contract.md](./40-implementation-contract.md)

---

## 1. 结论

**可以替换线上构建。** 81 页 / 80 条 URL 零差异；六道门禁全绿；真实浏览器端到端通过；Hugo 相关目录已从工作树移除。

| 维度 | 迁移前（Hugo 0.147.7） | 现在（V3） |
|---|---|---|
| 构建 | `hugo --gc --minify` | `npm run build`（css → js → site） |
| 构建耗时 | 42 ms（本地，未含资源管线） | 320 ms（含 CSS/JS/站点三段） |
| 页面 | 81 | 81 |
| URL | 80 | 80（0 缺失 / 0 新增） |
| CSS | 36,278 B / gzip 9,878 B | 33,147 B / **gzip 6,993 B**（−29.2%） |
| JS | 5,105 B / gzip 3,105 B（单个 IIFE） | 14,065 B / **gzip 5,890 B** + 分包 4,804 B（按需） |
| 首页 HTML | 15,677 B / gzip 4,249 B | 15,500 B / gzip 4,240 B |
| 内容源 | 站点仓库内 `content/` | 独立仓库 `K-Blaaaack/articles` |
| 启动动画 | 17 行硬编码 + `setTimeout` 假进度 | 6 个真实检查点，失败可重试 |

---

## 2. 交付物

| 模块 | 文件 | 规模 |
|---|---|---|
| 构建内核 | `build/` | 12 模块 / 1,379 行 |
| 模板 | `templates/` | 22 文件 / 550 行 |
| 样式 | `src/styles/` | 8 文件 / 689 行（7 层 + 入口） |
| 运行时 | `src/js/` | 5 模块 / 1,230 行 |
| 编排与门禁 | `scripts/` | 11 脚本 |
| 文案数据 | `data/{site,home}.toml` | 2 文件 |
| 内容仓库 | `K-Blaaaack/articles` | 21 md + 9 媒体 + meta.json + Actions |

**删除**：`layouts/`（20 文件）、`content/`（21 md + 媒体）、`assets/`、`hugo.toml`、`public/`、`nextgen/`（原型）。
CSS 基线另存 `docs/architecture/metrics/v2-main.css`，供 parity 门禁长期比对。

---

## 3. 门禁结果（`npm run check`）

| 门禁 | 检查内容 | 结果 |
|---|---|---|
| `check:tokens` | `:root` 唯一、hex 只在 tokens.css | ok |
| `check:boot` | 6 个 stage、权重、run 内含真实异步、无 setTimeout | ok |
| `check:css-parity` | 旧选择器 100% 存在、1,159 条声明值一致、130 组层叠顺序、@keyframes 6/6 | PASS |
| `check:links` | 81 页 596 条引用，0 死链 | ok |
| `check:budget` | CSS 7.17 / JS 5.75 / 首页 4.24 / 最大页 34.5 KB | ok |
| `check:parity` | 基线 80 vs 产物 80 | 缺 0 / 多 0 |
| `html-validate` | 81 页（`no-inline-style` 关闭、`valid-id: relaxed`） | exit 0 |

---

## 4. 端到端验证（真实 Firefox 158 / WebDriver BiDi，1440×1000）

**首页（`?boot=1` 强制重放）**

```
> P.R.T.S. NATIVE RHODES ISLAND TERMINAL SERVICE
> [  OK  ] 运行时内核 26 KB · 5 ms
> [  OK  ] 文章清单 16 篇 · 3 ms
> [  OK  ] 搜索索引 16 条 · 30 KB
> [  OK  ] 首屏媒体 1 张 · decode 0 ms
> [  OK  ] 视图挂载 搜索 / 目录 / 标签 · 2 ms
```

loader display:none · main-wrap opacity:1 · 进度 100% · 6 条 `boot:*` measure · 0 条 console 错误。

**搜索**：`/` 唤起 → `.ovl-search` display:flex、焦点落 `.ovl-input` → 输入「终端」→ 1 条结果、`aria-selected` 1 条、状态「1 条结果」→ Esc 关闭（`hidden:true`，title 复原）。

**文章页**：`data-page="post"`、无 `#loader`、TOC 17 条链接且 display:block、19 个 hljs token、0 张破图。

**404**：正文「ERROR 404 / 页面不存在 / 返回首页」可见，无遮罩。

**`?boot=debug`**：14 行输出，末行纯 JSON：

```json
{"total_ms":29,"degraded":false,"stages":{"shell":{"ms":15,"weight":5},"core":{"ms":2,"weight":20},"manifest":{"ms":1,"weight":25},"index":{"ms":1,"weight":15},"media":{"ms":0,"weight":20},"views":{"ms":5,"weight":15}},"errors":{},"connection":null}
```

**失败路径**（kernel 用删掉 meta.json 的 fixture 验证）：`[ FAIL ] 文章清单 · HTTP 404` 红行 + `cut loader-retry`「点击重试」+ 遮罩 `pointer-events:none` + 正文 `opacity:1` + 进度冻结在 25%（= shell 5 + core 20 的真实权重）。

---

## 5. 关键设计决定（与契约的偏差记录）

1. **CSS 分层**：§11 Content 与 §10 同放 `pages.css`，不进 `components.css` —— 两者共享大量「同属性 + 同特异性」选择器，换层会反转层叠顺序。由 130 组顺序校验证明。
2. **单阶段超时**：3s 为上限，media 2s / views 1s（31 号规格细化），契约 §5.2 已按此理解执行。
3. **非首页的 `.main-wrap`**：模板给非首页内联 `opacity:1`，因为只有首页有启动序列；避免 `.main-wrap{opacity:0}` 把静态页压黑。**技术债**：应改为 `html.js[data-page="home"] .main-wrap{opacity:0}`，S3 处理。
4. **JS 加载失败三层兜底**：module `onerror` 回退 `no-js` + head 4s watchdog 检查 `window.__kb` + `<noscript>`。
5. **媒体摊平**：`/media/<slug>/<name>.<hash8>.<ext>`，子目录摊平，同名冲突加父目录前缀；正文相对链接与图片同规则重写。
6. **pages 的 tags 不聚合**：否则会多出 `/tags/about|stack|status/`，破坏 80 条 parity。
7. **日期**：全程保留 `+08:00` 偏移（`isoShanghai()`），不经过 `toISOString()`。

---

## 6. 遗留与下一步

| # | 项 | 影响 | 计划 |
|---|---|---|---|
| 1 | 旧媒体路径（`/posts/<slug>/screenshots/x.webp`）不再存在 | 外站热链会 404 | S3：加 `_redirects` 或兼容副本（9 个文件） |
| 2 | 代码高亮 token 粒度：hljs 双类名复用 chroma 配色 | 少数 token 颜色微差 | S3：写 `.hljs-*` 主题或换等价 tokenizer（约 0.5 人日） |
| 3 | `/tags/` 与 `/tags/<slug>/` 仍是 0 链接空壳 | 与线上一致，但无价值 | S5：真实列表 |
| 4 | `<1280` 无目录入口 | 移动端只能靠浏览器查找 | S5：贴边极简入口（stylist 已留配方） |
| 5 | 非首页内联 `opacity:1` | 技术债 | S3 |
| 6 | `layouts/posts/{list,single}.html` 为 root 所有，无法删除 | 仅剩 2 个空文件，不参与构建 | 需 `sudo rm -rf layouts` |
| 7 | 文章仓库 push 不触发站点重建 | 新文章要手动 Retry deployment | S6：`repository_dispatch` |
| 8 | 无像素级 diff（本机无 playwright） | 零回归是「声明级 + 层叠级」证明 | S3：装 playwright 后补 `check:visual` |
| 9 | Cloudflare Pages 构建参数仍是 Hugo | 现在 push main 会用旧命令构建 | 切换前先在面板改成 `npm ci && node scripts/fetch-content.mjs && npm run build` + 输出 `dist` |

---

## 7. 回滚

1. 代码：`git revert` 本次提交（Hugo 目录在历史里，可 `git checkout <commit> -- layouts content assets hugo.toml` 恢复）。
2. 部署：Cloudflare Pages → Deployments → 上一个成功部署 → Rollback。
3. 内容：文章仓库 revert 后重新构建站点。

---

## 8. 未提交状态

本次改动**尚未 commit / push**（按约定，提交需要明确指令）。工作树状态：

- 删除 50 项（Hugo 目录）
- 修改 1 项（`.gitignore`）
- 新增 13 项（`build/` `templates/` `src/` `scripts/` `data/*.toml` `docs/` `.github/` `package*.json` `static/_headers` `.htmlvalidate.json`）


---

## 9. 运行时同步（实时更新，第二轮追加）

**问题**：第一版把内容同步放在构建期，push 文章仓库后必须重建站点才生效——不符合「实时更新」的原始需求。

**修正**：静态页保留（SEO / 无 JS / URL parity），另加运行时层。

| 能力 | 实现 | 证据（Firefox BiDi，本地 16 篇 / 模拟远端 17 篇） |
|---|---|---|
| 清单比对 | 远端 `meta.json`（jsDelivr → raw 双源，各 2s）与本地基线比 | 启动行：`[  OK  ] 文章清单 16 篇 · 远端 17 篇 · 9 ms` |
| 列表热更新 | 只替换 `[data-remote-list]` 子容器，静态新闻保留 | 列表 5 条，首条为新文章；`.remote-note`「已同步 1 篇更新」 |
| 新文章直达 | 404 页识别 `/posts/<slug>/` → 拉 md → marked 渲染 → 注入 | `#remoteArticle` 显示正文、`title` 与 canonical 更新、`pre.chroma` 高亮生效 |
| 离线降级 | 双源都失败 → WARN 行，不动列表 | `[ WARN ] 文章清单 离线缓存 · 16 篇`，列表仍 5 条，正文可读 |
| 可访问性 | 克隆模板后 `aria-label` 用标题覆盖 | `aria-label="实时同步验证：这篇文章没有重新构建过"` |

**体积代价**：入口 gzip 5,890 → 6,109 B（预算 6.5 KB）；`marked`（14.4 KB gz）只在 404 渲染时加载，`hljs` 按需注册 bash/ini/cpp（整包 53.9 → 13.1 KB gz）。

**顺带修掉的构建 bug**：chunk 互相引用时旧构建只回写入口的 chunk 名，导致 overlay 动态 import 404（内核阶段 FAIL）。现在引用先归一化再算哈希、全局回写。

**门禁**：新增 `check:remote`（`data-content-base` / `#postItemTpl` / `[data-remote-list]` / 404 容器 / 动态 import / 超时与 catch），已并入 `npm run check`。
