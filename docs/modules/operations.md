# Operations, Scripts, Migrations, Tasks

本模块覆盖脚本、部署、迁移、定时任务和 CI。

## 脚本分类

`package.json` 是命令入口。

### 开发与构建

- `pnpm dev`
- `pnpm dev:webpack`
- `pnpm build`
- `pnpm build:sitemap`
- `pnpm postbuild`
- `pnpm typecheck`
- `pnpm test`

### Prisma

- `pnpm prisma:push`
- `pnpm prisma:generate`

`prisma:push` 实际会先跑 `migration:resource-links`，再 `prisma db push` 和 `prisma generate`。

### 部署

- `pnpm deploy:install`
- `pnpm deploy:build`
- `pnpm deploy:pull`
- `pnpm gallery:ffmpeg:install`
- `pnpm start`
- `pnpm stop`

详见 `docs/project/deployment.md`。

### 维护脚本

- `maintenance:resource-attributes:*`
- `maintenance:dirty-tags:*`
- `maintenance:tags:*`
- `maintenance:companies:dirty:*`
- `migration:resource-type:*`
- `migration:patch-counters`

### 验证脚本

- `pnpm gallery:ffmpeg:install`：可选安装 Linux x64/arm64 BtbN FFmpeg 到 `node_modules/.ffmpeg/ffmpeg`，用于强 animated AVIF gallery 缩略图；普通安装不自动运行，保持部署较轻。自备 FFmpeg 时也可以改用 `.env` 的 `KUN_GALLERY_FFMPEG_PATH` 指向绝对路径，修改后需要重启 PM2。
- `pnpm exec esno scripts/verifyGalleryAnimatedAvifThumbnail.ts <animated.avif> [output.avif]`：验证当前机器的 `KUN_GALLERY_FFMPEG_PATH`、standalone `.ffmpeg/ffmpeg`、`ffmpeg-static` 或系统 `ffmpeg/libaom-av1` 能否生成 animated AVIF gallery 缩略图；只读写本地文件，不访问数据库或 S3。脚本会列出各候选 FFmpeg 对输入样本和输出缩略图解析到的帧数，包括 Linux FFmpeg 暴露出的非默认多帧 video stream，避免把静态首帧误判为 animated AVIF。生产运行前应在目标服务器执行，建议使用 `pnpm exec esno scripts/verifyGalleryAnimatedAvifThumbnail.ts ./public/images/animated-sample.avif ./public/images/tmp/animated-sample-thumb.avif`，确认输出 `Wrote animated AVIF thumbnail: ... frames ...`。

带 `dry` 的脚本先 dry-run，确认输出后再 apply。

`maintenance:tags:auto-alias:dry` 会在生产库里扫描“某个 tag 的 name 命中另一个主 tag 的 alias”的历史重复数据，并生成合并计划。dry-run 只做计划校验和关系数量预览，不加载所有受影响 patch 的 `unique_id`，避免生产数据量大时预览过慢。确认输出无误后再运行 `maintenance:tags:auto-alias:apply`；apply 会移动 patch 关系、合并 alias、修正 count、迁移用户 blocked tag，并失效 tag/list/受影响 patch 内容缓存。多主 tag 共用同一 alias 时会跳过并输出 warning，需要人工计划。

手工合并仍使用 `maintenance:tags:merge:* -- --plan=path/to/merge-plan.json`。本地库没有生产 tag 数据时，不要用本地 dry-run 结果判断生产影响面，应在生产备份后对生产库 dry-run。

`maintenance:companies:dirty:dry` 会扫描公司历史脏数据：某个公司的 `name` 命中另一个公司的 `alias`、多个公司共享 alias，以及 `patch_company.count` 与实际关系数不一致。dry-run 只输出自动合并计划、warning 和 count 修复预览，不写库。确认输出后再运行 `maintenance:companies:dirty:apply`；apply 会迁移 `patch_company_relation`、合并 alias / primary_language / official_website / parent_brand、删除重复公司、重算 count，并失效 company/list/受影响 patch 内容缓存。多个候选主公司或无法确定 canonical 的共享 alias 会跳过并输出 warning，需要人工计划。

生产公司清理流程：

1. 先备份数据库。
2. 在生产备份或生产库上运行 `pnpm maintenance:companies:dirty:dry`。
3. 核对每个 `merge into` 和 warning；有歧义时先人工决定 canonical 公司，不要直接 apply。
4. 确认 dry-run 输出后运行 `pnpm maintenance:companies:dirty:apply`。
5. 复查公司详情页、游戏详情页和公司游戏列表缓存是否已刷新。

## Postbuild

`scripts/postbuild.ts` 在 `next build` 后执行：

1. 运行 `pnpm build:sitemap`。
2. 复制 `public`。
3. 复制 `.next/static`。
4. 复制 `server/image`。
5. 复制 `posts`。
6. 复制 `config/redirect.json`。
7. assert 关键 runtime 文件存在。

Next standalone 默认不会自动带上 `public` 和 `.next/static`，这是 Next 官方 standalone output 的约束；本仓库通过 `postbuild` 补齐运行时资源。

新增 runtime asset 目录时，必须同步：

- `scripts/postbuild.ts`
- `.github/workflows/release.yml` 的 release packaging
- `docs/project/deployment.md`

## Release Workflow

`.github/workflows/release.yml`：

- 监听 `main` 和 `workflow_dispatch`。
- 启动 PostgreSQL 15 和 Redis。
- 写构建用 `.env`。
- 运行 `pnpm prisma:push`。
- 运行 `pnpm build`，并设置 `KUN_DEPLOY_BUILD_SKIP_CHECKS=true`。
- 打包 `release.tar.gz`，内容包括 standalone、`.next/static`、`.next/server`、`.next/BUILD_ID`、`public`、`server/image`、`posts`、`config/redirect.json` 和 `prisma`。
- 创建 CalVer GitHub Release。

release packaging 还会删除包内 `package.json` 的 `"type": "module"`，并把 `server.js` 改名为 `server.mjs`。`ecosystem.config.cjs` 和 `deployPull.ts` 都支持优先启动 `server.mjs`，本地 standalone 则回退到 `server.js`。

`.github/workflows/lint-check.yml` 当前监听 `master` 的 push/PR，而不是 `main`。如果主分支是 `main`，这个 workflow 不会在 main push 上自动跑。

## Deploy Pull

`scripts/deployPull.ts`：

- 读取 `.env`。
- 查询 GitHub latest release。
- 下载 `release.tar.gz`。
- 解压到 `.next_temp`。
- 用 release 内的 `prisma` 替换根目录 schema。
- 在目标服务器重新 `pnpm prisma generate`。
- 注入 `.prisma` 和 `@prisma` 到 standalone node_modules。
- 注入目标服务器 `node_modules/ffmpeg-static` 到 standalone node_modules，避免 release artifact 中 bundled ffmpeg 的平台架构和生产服务器不一致。
- 如果目标服务器存在可选 `node_modules/.ffmpeg/ffmpeg`，同步注入 standalone `.ffmpeg/ffmpeg`。
- 如果 `.env` 设置了 `KUN_GALLERY_FFMPEG_PATH`，运行时会优先使用该绝对路径；deploy artifact 不会复制这个外部路径，目标服务器必须自行保留该可执行文件。
- 原子替换 `.next/standalone`。
- 运行 `pnpm prisma:push`。
- 生成 sitemap 并复制到 standalone public。
- 删除旧 PM2 进程，再从新 standalone cwd 启动。

`pnpm deploy:pull` 已经包含 `git pull`。

私有仓库需要 `GITHUB_TOKEN`。下载时脚本会处理 GitHub/S3 跳转，并且跨域跳转不会继续携带 Authorization header。

## Deploy Build

`scripts/deployBuild.ts`：

- 校验 `.env` 是否存在。
- 加载并验证环境变量。
- 如果存在 `KUN_VISUAL_NOVEL_TEST_SITE_LABEL`，输出测试站 noindex 警告。
- 执行 `git pull && pnpm i && pnpm prisma:push && pnpm build && pm2 startOrReload ecosystem.config.cjs`。
- build 时注入 `KUN_DEPLOY_BUILD_SKIP_CHECKS=true`。

这个路径会在服务器上完整构建，比 `deploy:pull` 消耗更多 CPU/内存，但不依赖 GitHub Release 产物。

## 定时任务

入口：

- `server/cron.ts`
- `server/tasks/resetDailyTask.ts`
- `server/tasks/setCleanupTask.ts`
- `server/tasks/flushPatchViewsTask.ts`
- `server/tasks/syncKunPatchTypeTask.ts`
- `server/tasks/withTaskLock.ts`

`setKUNGalgameTask` 防止同一进程重复 start。多实例部署时，任务实现应使用 `withTaskLock` 防止多实例重复执行。

任务职责：

- 重置每日状态。
- 清理临时上传。
- 每 2 分钟刷新 patch 浏览量缓冲。
- 同步资源类型。

## 迁移策略

`migration/*` 包含生产辅助 SQL 和脚本，`migration/backup/*` 是历史脚本。

生产变更要求：

- 先备份。
- 先 dry-run 或 preflight。
- 不在生产 `prisma db push` reset database。
- 大表数据修复要分批、可重入、可观测。

严重提示：

```text
To apply this change we need to reset the database
```

生产看到该提示必须取消。

## 验证

脚本/部署改动：

```bash
pnpm typecheck
pnpm test
pnpm build
```

不能运行 `pnpm build` 时，要至少说明原因，并静态检查 `postbuild.ts` 和 release packaging 是否同步。

CI/workflow 改动还要静态确认：

- workflow 分支是否覆盖当前主分支。
- 构建期 `.env` 是否满足 `validations/dotenv-check.ts`。
- 新增 `NEXT_PUBLIC_*` 是否同步 GitHub Environment secrets。
- release artifact 是否包含 standalone 运行时实际读取的目录或文件。
