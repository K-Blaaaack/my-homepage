# K-BLACK 个人站 · V3

> 自有 Node 构建内核 + 运行时内核 + 真实启动序列。**没有 Hugo，没有前端框架。**
> 文章不在这里：[K-Blaaaack/articles](https://github.com/K-Blaaaack/articles)。

## 结构

```
build/        构建内核（12 模块）：content / markdown / media / routes / render / feeds / manifest / search
templates/    模板（22 文件）：_default / posts / stack / 404 / partials
src/styles/   样式 7 层（tokens → base → components → pages → motion → platform-*）
src/js/       运行时（store / boot / overlay / platform / main）
scripts/      编排与门禁：build-all / build-css / build-js / fetch-content / serve / check-*
data/         站点文案（site.toml / home.toml）
static/       直通资源（_headers 等）
dist/         产物（gitignore）
docs/         架构文档与 runbook
```

## 命令

> 需要 Node ≥ 22.22（html-validate 11 的硬要求；CI 与 Cloudflare Pages 均用 24）。


```bash
npm ci
node scripts/fetch-content.mjs      # 克隆内容仓库到 .cache/content（已有 ../articles 时自动用同级目录）
npm run build                       # css → js → site，产物在 dist/
npm run serve                       # http://127.0.0.1:4173
npm run check                       # tokens / boot / links / budget / parity / css / html
```

构建也可指定内容源：

```bash
CONTENT_DIR=/path/to/articles npm run build
```

## 设计要点

- **静态 MPA**：81 页，URL 与迁移前 1:1（`/posts/<slug>/`、`/tags/<slug>/`、中文路径不变）。
- **启动序列是真的**：6 个检查点各对应一次真实工作（动态 import、fetch meta.json、fetch 搜索索引、图片 decode、视图挂载），失败会红行并可重试，不是定时器演的。规格见 [31-boot-sequence-spec.md](docs/architecture/31-boot-sequence-spec.md)。
- **渐进增强**：无 JS 时正文立即可见、遮罩不出现；JS 加载失败有 `onerror` + 4s watchdog 三层兜底。
- **零框架**：运行时入口 gzip ≈ 5.8 KB，覆盖层按需分包；CSS gzip ≈ 7.2 KB。

## 体积预算（门禁强制）

| 项 | 上限 | 当前 |
|---|---|---|
| CSS | 9.9 KB | 7.17 KB |
| JS 入口 | 6.0 KB | 5.75 KB |
| 首页 HTML | 4.5 KB | 4.24 KB |
| 单页 HTML | 55 KB | 34.5 KB |

## 发布

Cloudflare Pages，Git 集成，push `main` 自动构建。
构建命令 `npm ci && node scripts/fetch-content.mjs && npm run build`，输出目录 `dist`。
详见 [docs/runbook.md](docs/runbook.md)。

## 文档

- [00-current-state.md](docs/architecture/00-current-state.md) 迁移前审计
- [30-nextgen-v3-plan.md](docs/architecture/30-nextgen-v3-plan.md) V3 规划
- [31-boot-sequence-spec.md](docs/architecture/31-boot-sequence-spec.md) 启动序列规格
- [32-delivery-and-access.md](docs/architecture/32-delivery-and-access.md) 部署与权限实测
- [40-implementation-contract.md](docs/architecture/40-implementation-contract.md) 实施契约
- [50-v3-integration-report.md](docs/architecture/50-v3-integration-report.md) 集成验收报告
