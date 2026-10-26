# 交付链路与权限核查（实测）

> 核查时间：2026-10-27 00:20–00:32 +08:00 ｜ 核查人：lead
> 结论口径：只记录**实测到的事实**，面板里的配置项标为「待面板确认」。

---

## 1. GitHub 权限

| 能力 | 结论 | 证据 |
|---|---|---|
| 身份 | `K-Blaaaack`（OAuth token `gho_***`） | `gh auth status` |
| Token scope | `gist, read:org, repo, workflow` | `X-Oauth-Scopes` 响应头 |
| 拉取 | **可用** | `git ls-remote origin` / `git fetch` 成功 |
| 推送 | **可用** | 实测创建临时分支 `arch-probe` 推送到远端，随后删除；远端现仅剩 `main` |
| 本仓库管理权 | `admin: true` | `GET /repos/K-Blaaaack/my-homepage` |
| 创建仓库 | **可用**（未实际创建） | `POST /user/repos` 传空名返回 422 校验错误而非 403，说明授权通过 |
| 删除仓库 | **不可用** | scope 缺 `delete_repo`；需要时执行 `gh auth refresh -s delete_repo` |
| Actions | 可用（`enabled: true`，`allowed_actions: all`） | `GET /repos/.../actions/permissions` |
| API 配额 | 5000/h（已用 12） | `gh api rate_limit` |
| main 分支保护 | **无** | `GET /branches/main/protection` → 404 Branch not protected |

**风险**：`main` 无保护 + Cloudflare 自动构建 = 任何一次直推都会立刻上生产，没有 CI 拦截。V3 迁移期必须先走分支/PR。

---

## 2. 部署链路（Cloudflare Pages）

| 事实 | 证据 |
|---|---|
| 线上域名 | `https://k-black.top/` → 200，`server: cloudflare`，`cf-cache-status: DYNAMIC` |
| 托管形态 | Cloudflare Pages（自定义 404 页由站点自己的 `404.html` 返回） |
| 自动构建 | **生效**：线上 CSS/JS 指纹与本地构建 HEAD 完全一致（`main.e4295677….css` / `main.aa85e153….js`），sitemap 80 条，`/posts/hyps-hub/`、`/posts/ai-dev-brief/` 均在线 |
| 构建版本 | **Hugo 0.147.7**（`<meta name="generator" content="Hugo 0.147.7">`），本地为 **0.168.0** |
| 是否 minify | **否**：线上 HTML 未压缩（首页 15,677 B / gzip 4,249 B；本地 `--minify` 为 12,819 B / gzip 3,857 B） |
| 额外注入 | Cloudflare Email Obfuscation：`/cdn-cgi/scripts/…/email-decode.min.js` |
| 仓库内构建配置 | **无**：没有 `.hugo-version` / `HUGO_VERSION` / `wrangler.toml` / `_headers` / `_redirects` / `netlify.toml` |
| 本地 CF 凭证 | 无 `CLOUDFLARE_*` 环境变量，无 wrangler 配置，未安装 wrangler |
| 项目子域 | 未知：`my-homepage.pages.dev` 属于他人项目（返回另一站点），无法从外部推断本项目预览域名 |

---

## 3. 对 V3 的硬约束

1. **构建参数必须落进仓库**：现在版本漂移已经发生（CF 0.147.7 vs 本地 0.168.0），且线上未 minify。S0 就要把版本、构建命令、输出目录写进仓库与 runbook。
2. **迁移期禁止直推 main**：开分支保护或至少约定「PR + 预览」。V3 换构建命令（`npm ci && npm run build` → `dist`）属于面板操作，需要一次窗口期。
3. **视觉回归要先剔除 CF 注入**：`email-decode.min.js` 会改变 HTML 字节；对比时以去注入后的 DOM 为准，或关闭该功能。
4. **预览环境需要确认**：项目名/子域在面板里；若开启分支预览，`<branch>.<project>.pages.dev` 可用于 V3 的分阶段验收。
5. **不建一次性测试仓库**：token 不能删仓库，创建测试仓库会留下垃圾；需要时先补 `delete_repo`。

---

## 4. 待面板确认（需要 YG 或 CF 账号）

- [ ] Pages 项目名与 `*.pages.dev` 子域
- [ ] Build command / Build output directory / Root directory
- [ ] 环境变量（`HUGO_VERSION` / `NODE_VERSION`）
- [ ] 是否启用分支预览（Preview deployments）
- [ ] Email Obfuscation 开关位置
- [ ] 自定义域与 DNS 记录（当前解析到 Cloudflare 任播地址，CNAME 被扁平化）
