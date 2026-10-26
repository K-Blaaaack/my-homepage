# Runbook：构建、预览、发布、回滚

> 2026-10-27 ｜ 对应 V3 架构（无 Hugo）｜ 上游：docs/architecture/40-implementation-contract.md

## 1. 本地构建

```bash
npm ci
node scripts/fetch-content.mjs     # 首次：把 K-Blaaaack/articles 克隆到 .cache/content
npm run build                      # css → js → site，产物在 dist/
npm run serve                      # http://127.0.0.1:4173
npm run check                      # 全部门禁
```

内容仓库已在本地时（`CONTENT_DIR=/path/to/articles`）：

```bash
CONTENT_DIR=/home/kb/github/articles npm run build
```

## 2. 发布

- 托管：Cloudflare Pages，Git 集成，**push 到 main 自动构建**。
- 构建命令（面板）：`npm ci && node scripts/fetch-content.mjs && npm run build`
- 输出目录（面板）：`dist`
- 环境变量（面板）：`NODE_VERSION=20`、`CONTENT_REPO=K-Blaaaack/articles`

> 迁移窗口期：面板参数切换前，main 仍按旧 Hugo 配置构建。切换时先发一版 preview 验证。

## 3. 预览

- PR / 非 main 分支 → CF Pages 预览部署（需在面板确认项目子域）。
- 无面板权限时，本地 `npm run serve` 等价验证。

## 4. 回滚

1. CF Pages 控制台 → Deployments → 选上一个成功部署 → **Rollback**。
2. 代码侧：`git revert <commit>` 后 push，触发新构建。
3. 内容侧：文章仓库 revert 后，站点需重新构建才生效（内容在构建期固化）。

## 5. 内容发布流程

```bash
git clone https://github.com/K-Blaaaack/articles
cd articles && mkdir posts/my-post && $EDITOR posts/my-post/index.md
# front matter：title / date / tags / categories / summary（见契约 §2.1）
git add . && git commit -m "post: my-post" && git push
```

push 后：
1. 文章仓库 Actions 重算 `meta.json`（约 10s）。
2. 站点仓库无变化时**不会自动重建** → 需要触发一次构建：
   - 面板 → Deployments → Retry deployment，或
   - 在站点仓库 push 一个空提交，或
   - 后续接入 repository_dispatch（待做）。

> 这是双仓的已知代价，记在 §6。

## 6. 已知限制

| 限制 | 影响 | 计划 |
|---|---|---|
| 文章仓库 push 不触发站点重建 | 新文章要手动触发一次 | S6 接 `repository_dispatch` + 站点侧 workflow |
| CF 构建版本不受仓库控制 | 本地/线上行为可能漂移 | 面板固定 `NODE_VERSION`；构建产物哈希写进部署日志 |
| 无 delete_repo 权限 | 测试仓库无法清理 | 需要时 `gh auth refresh -s delete_repo` |

## 7. 故障排查

| 现象 | 检查 |
|---|---|
| 构建失败 | `npm run build` 本地复现；看 `build/index.mjs` 的报错行 |
| 页面 404 | `npm run check:parity` 看缺失 URL |
| 样式丢失 | `dist/css/main.*.css` 是否存在；HTML 引用哈希是否一致 |
| 启动动画卡住 | `?boot=debug` 看 stage 计时；`check:boot` 是否通过 |
| 内容没更新 | 文章仓库 `meta.json` 是否已更新；站点是否重新构建 |
