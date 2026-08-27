# Operations, Scripts, Migrations, Tasks

本模块覆盖脚本、部署、迁移、定时任务和 CI。

## 脚本分类

`package.json` 是命令入口。

### 开发与构建

- `pnpm dev`
- `pnpm dev:webpack`
- `pnpm dev:lan`
- `pnpm build`
- `pnpm build:sitemap`
- `pnpm postbuild`
- `pnpm typecheck`
- `pnpm test`

### Prisma

- `pnpm prisma:push`
- `pnpm prisma:deploy-safe`
- `pnpm prisma:generate`

`prisma:push` 实际会先跑 `migration:resource-links`，再 `prisma db push` 和 `prisma generate`；它保留给本地开发、`deploy:install` 首次安装和 disposable CI 初始化。生产 `deploy:pull` / `deploy:build` 使用 `prisma:deploy-safe`：先运行既有的 `migration:resource-links`（可能执行兼容性 schema/data 写入），再运行只读 schema guard/diff，最后运行 `prisma generate`。该命令不运行 `prisma db push`，也不应用 diff SQL。

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
- `maintenance:conversation-images:*`
- `maintenance:submission-assets:*`
- `stickers:sync`：校验并同步内置 Sticker Pack 资源。默认 dry-run；加 `--apply` 后才会上传 WebP/WebM、生成动态 poster 并 upsert 数据库目录。静态 WebP 最大 512 KB，动态 WebM 必须为带透明通道、无音频的 VP9，最大 300 KB，超限直接拒绝；poster 使用内容哈希 key，避免 immutable CDN 复用旧图。
- Sticker 管理后台位于 `/admin/stickers`，服务端导入支持单张、多文件和 ZIP；ZIP 导入会检查路径穿越、符号链接、加密条目、ZIP Bomb、重复内容和解压大小，失败时清理已上传对象。
- 生产数据库变更按顺序执行 `migration/production-private-chat-stickers-preflight-2026-08-14.sql`、对应 sync，再执行 `migration/production-sticker-admin-preflight-2026-08-14.sql`、对应 sync。preflight 只读，sync 前必须审核重复 hash、封面引用和外键定义检查结果。已经执行过旧版 Sticker sync 的数据库，还要在备份后执行 `migration/production-stickers-prisma-alignment-2026-08-15.sql`，再运行 `pnpm prisma:deploy-safe`；该纠正脚本不触碰 `patch_released_idx`。
- `maintenance:gallery-thumbnails:*`
- `migration:resource-type:*`
- `migration:patch-counters`

### 验证脚本

- `pnpm gallery:ffmpeg:install`：可选安装 Linux x64/arm64 BtbN FFmpeg 到 `node_modules/.ffmpeg/ffmpeg`，用于强 animated AVIF gallery 缩略图；普通安装不自动运行，保持部署较轻。自备 FFmpeg 时也可以改用 `.env` 的 `KUN_GALLERY_FFMPEG_PATH` 指向绝对路径，修改后需要重启 PM2。
- `pnpm exec esno scripts/verifyGalleryAnimatedAvifThumbnail.ts <animated.avif> [output.avif]`：验证当前机器的 `KUN_GALLERY_FFMPEG_PATH`、standalone `.ffmpeg/ffmpeg`、`ffmpeg-static` 或系统 `ffmpeg/libaom-av1` 能否生成 animated AVIF gallery 缩略图；只读写本地文件，不访问数据库或 S3。脚本会列出各候选 FFmpeg 对输入样本和输出缩略图解析到的帧数，包括 Linux FFmpeg 暴露出的非默认多帧 video stream，避免把静态首帧误判为 animated AVIF。生产运行前应在目标服务器执行，建议使用 `pnpm exec esno scripts/verifyGalleryAnimatedAvifThumbnail.ts ./public/images/animated-sample.avif ./public/images/tmp/animated-sample-thumb.avif`，确认输出 `Wrote animated AVIF thumbnail: ... frames ...`。

带 `dry` 的脚本先 dry-run，确认输出后再 apply。

Steam ID 软查重上线时，先备份数据库，再运行 `migration/production-steam-id-soft-duplicate-preflight-2026-07-09.sql` 查看生产库里旧唯一约束/索引和重复 Steam ID 预览；确认后运行 `migration/production-steam-id-soft-duplicate-sync-2026-07-09.sql`。该 sync 使用 `CREATE INDEX CONCURRENTLY`，不要包在显式事务中执行；它会移除旧 `steam_id` 唯一约束/索引并创建普通 `patch_steam_id_idx`。

`maintenance:resource-attributes:dry` 会按已发布资源（`patch_resource.status = 0`）重算每个游戏卡片/详情页使用的 `type`、`language` 和 `platform` 派生标签，预览历史脏数据中哪些 patch 会变化，不写 DB。确认输出后运行 `maintenance:resource-attributes:apply`，脚本会更新派生字段并失效受影响的详情和列表缓存。待审核、封禁或已删除资源不能进入这些派生标签。

`migration:resource-type:*` 在迁移单条资源类型/平台后，也必须按同一已发布资源口径重算 patch 派生属性。`migration:patch-counters` 安装和回填的 `resource_count` 只统计已发布资源，并监听 `patch_resource.status` 变化；运行旧触发器的环境修复卡片资源数时，应重新执行 `pnpm migration:patch-counters`。

`maintenance:submission-assets:dry` 只读展示三类积压：终态投稿行 outbox、已经持久化的 orphan cleanup jobs、以及超过宽限期的新 S3 orphan；它不写 job、不删对象、不 purge。确认后用 `maintenance:submission-assets:apply`，处理顺序固定为“投稿行 outbox → 已有 orphan jobs → 新 orphan”。新 orphan 必须先写入 `patch_submission_orphan_cleanup`，保存 object key 和当时所有公开 URL，才允许执行 S3 删除与 Cloudflare purge；两者都确认成功后才删除 job。每次 apply 都重新检查活动投稿和正式 `patch` / `patch_game_image` 引用，被引用对象会取消 job。`published` 投稿行只保留溯源，不保护对象；真正的线上引用以正式条目行为准。新 S3 orphan 仍只处理过了默认 24 小时宽限期的对象，可用 `--grace-hours` 与 `--limit` 调整。

submission assets summary 中，`cleanup submissions` 是 `rejected` / `violation` / `deleted` 行上仍有 key 的结算积压；`persisted orphan jobs` 是已具备 durable retry credential 的无所属对象；`new S3 orphans` 是本轮扫描发现、尚未持久化的候选。任一 apply 后仍非零都需要查看 `owed` / `bookkeepingFailed` 日志，不要通过手工删行来“清空”积压。

`maintenance:gallery-thumbnails:dry` 扫描历史 gallery 中 `thumbnail_url IS NULL` 的本站原图，输出待回填数量，不下载原图、不写 S3、不写 DB。确认 dry-run 后用 `maintenance:gallery-thumbnails:apply` 分批回填真实缩略图；apply 默认 `--limit=50 --batch=20 --concurrency=1 --delay=1000`，适合生产 3c 服务器低负载执行，并会逐张打印当前处理的游戏、gallery 图片 ID、完成状态和耗时。常用生产命令是 `pnpm maintenance:gallery-thumbnails:apply -- --limit=50 --batch=20 --concurrency=1 --delay=1000`，重复执行直到 dry-run 无候选；如果 FFmpeg 性能或可用性不确定，先加 `--skip-animated-avif`。

gallery thumbnails summary 字段含义：`galleryTotal` 是当前范围内 URL 非空的 gallery 图片总数；`alreadyWithThumbnail` 是已有 `thumbnail_url`、无需回填压缩的图片数；`missingThumbnail` 是仍缺 `thumbnail_url` 的图片数；`scanned` 是本次从数据库查出并检查的缺缩略图候选图片数，受 `--limit` 限制；`eligible` 是符合回填规则的图片数，dry-run 中表示 apply 会处理的数量；`updated` 是 apply 实际写入 `thumbnail_url` 的图片数，dry-run 中应为 `0`；`skipped` 是查到候选但因 URL 非本站、路径不规范、原图过大、缩略图生成不可用等原因跳过的数量；`failed` 是处理过程中出现未恢复错误的数量。`scanned=0` 且 `missingThumbnail=0` 表示当前范围没有缺 `thumbnail_url` 的 gallery 候选项，不代表数据库里没有 gallery 图片。

`maintenance:conversation-images:dry` 扫描私聊上传产生的 `conversation/` S3 前缀，查找上传后未发送、且已经超过 Redis metadata TTL 安全窗口的孤儿图片。dry-run 默认 `--limit=200 --batch=50 --older-than-hours=2`，只输出 summary 和候选 key，不删除对象。确认候选无误后运行 `maintenance:conversation-images:apply`；apply 默认 `--limit=100 --batch=50 --concurrency=1 --delay=1000`，删除前会检查非删除 `user_private_message` 的 `image_url`、`image_group` 和 `reply_image` 是否仍引用该 key，引用中的对象不会删除，tombstone 行遗留字段不会阻止清理。常用生产命令是 `pnpm maintenance:conversation-images:apply -- --limit=100 --batch=50 --concurrency=1 --delay=1000`；需要缩小影响面时可加 `--conversation-id=123`，需要更保守时加大 `--older-than-hours=6`。

conversation images summary 字段含义：`scanned` 是本次从 S3 列出的对象数；`eligible` 是符合 key 规范、超过时间阈值且未被消息引用的候选数；`deleted` 是 apply 实际删除的对象数；`referenced` 是仍被消息字段引用而跳过的对象数；`tooNew` 是未超过安全时间阈值的对象数；`invalidKey` 是不符合私聊图片 key 规范的对象数；`failed` 是删除失败数量。dry-run 的 `Candidates` 列表只是预览，不代表已删除。

`maintenance:tags:auto-alias:dry` 会在生产库里扫描“某个 tag 的 name 命中另一个主 tag 的 alias”的历史重复数据，并生成合并计划。dry-run 只做计划校验和关系数量预览，不加载所有受影响 patch 的 `unique_id`，避免生产数据量大时预览过慢。确认输出无误后再运行 `maintenance:tags:auto-alias:apply`；apply 会移动 patch 关系、合并 alias、修正 count、迁移用户 blocked tag，并失效 tag/list/受影响 patch 内容缓存。多主 tag 共用同一 alias 时会跳过并输出 warning，需要人工计划。

手工合并仍使用 `maintenance:tags:merge:* -- --plan=path/to/merge-plan.json`。本地库没有生产 tag 数据时，不要用本地 dry-run 结果判断生产影响面，应在生产备份后对生产库 dry-run。

`maintenance:companies:dirty:dry` 会扫描公司历史脏数据：某个公司的 `name` 命中另一个公司的 `alias`、多个公司共享 alias、没有任何游戏关系的空公司，以及 `patch_company.count` 与实际关系数不一致。dry-run 只输出自动合并计划、warning、空公司删除预览和 count 修复预览，不写库。确认输出后再运行 `maintenance:companies:dirty:apply`；apply 会迁移 `patch_company_relation`、合并 alias / primary_language / official_website / parent_brand、删除重复公司和空公司、重算 count，并失效 company/list/受影响 patch 内容缓存。多个候选主公司或无法确定 canonical 的共享 alias 会跳过并输出 warning，需要人工计划。

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
- 运行 `pnpm prisma:deploy-safe`：先执行可能写入 schema/data 的资源链接兼容迁移，再只读校验生产 schema，最后在目标服务器生成 Prisma Client。
- 注入 `.prisma` 和 `@prisma` 到 standalone node_modules。
- 注入目标服务器 `node_modules/ffmpeg-static` 到 standalone node_modules，避免 release artifact 中 bundled ffmpeg 的平台架构和生产服务器不一致。
- 如果目标服务器存在可选 `node_modules/.ffmpeg/ffmpeg`，同步注入 standalone `.ffmpeg/ffmpeg`。
- 如果 `.env` 设置了 `KUN_GALLERY_FFMPEG_PATH`，运行时会优先使用该绝对路径；deploy artifact 不会复制这个外部路径，目标服务器必须自行保留该可执行文件。
- 原子替换 `.next/standalone`。
- 生成 sitemap 并复制到 standalone public。
- 删除旧 PM2 进程，再从新 standalone cwd 启动。

`pnpm deploy:pull` 已经包含 `git pull`。

私有仓库需要 `GITHUB_TOKEN`。下载时脚本会处理 GitHub/S3 跳转，并且跨域跳转不会继续携带 Authorization header。

## Deploy Build

`scripts/deployBuild.ts`：

- 校验 `.env` 是否存在。
- 加载并验证环境变量。
- 如果存在 `KUN_VISUAL_NOVEL_TEST_SITE_LABEL`，输出测试站 noindex 警告。
- 执行 `git pull && pnpm i && pnpm prisma:deploy-safe && pnpm build && pm2 startOrReload ecosystem.config.cjs`。
- build 时注入 `KUN_DEPLOY_BUILD_SKIP_CHECKS=true`。

这个路径会在服务器上完整构建，比 `deploy:pull` 消耗更多 CPU/内存，但不依赖 GitHub Release 产物。

## 定时任务

入口：

- `server/cron.ts`
- `server/tasks/resetDailyTask.ts`
- `server/tasks/setCleanupTask.ts`
- `server/tasks/flushPatchViewsTask.ts`
- `server/tasks/cleanupSubmissionAssetsTask.ts`
- `server/tasks/syncKunPatchTypeTask.ts`
- `server/tasks/withTaskLock.ts`

`setKUNGalgameTask` 防止同一进程重复 start。多实例部署时，任务实现应使用 `withTaskLock` 防止多实例重复执行。

任务职责：

- 重置每日状态。
- 清理临时上传。
- 每 2 分钟刷新 patch 浏览量缓冲。
- 每日 04:00（`Asia/Shanghai`）只读巡检投稿素材；8 小时 task lock 覆盖全桶扫描，并启用本进程 `noOverlap`。任务固定以 `apply: false` 调用维护引擎，只记录终态投稿行积压、已持久 orphan jobs 和新 S3 orphan，不写 outbox、不删 S3、不 purge。
- 同步资源类型。

常驻任务通过 CLI dependencies 复用扫描逻辑，但不得调用 `close()`：该方法会 `$disconnect()` 共享 Prisma client，仅 CLI 退出时使用。修改 `server/cron.ts` 或 task 文件后需要重启运行进程，新的 `createTask` 才会由 `setKUNGalgameTask()` 启动。

## 迁移策略

资源访问缺表上线使用
`migration/production-resource-access-bootstrap-preflight-2026-07-12.sql` 及对应 sync，
然后复用现有 grant pair。Bootstrap 保持手工执行，不加入 deploy-safe。Steam ID
sync 已支持清理并重建 invalid/not-ready/not-live 的目标索引，并在资源访问停机
窗口前完成 postflight。维护窗口部署使用
`KUN_DEPLOY_RELEASE_TAG='<已审核 tag>' pnpm deploy:pull` 固定目标产物。

`migration/*` 包含生产辅助 SQL 和脚本，`migration/backup/*` 是历史脚本。

投稿域生产迁移依次使用 VNDB Release ID unique、patch submission、submission
orphan cleanup 三组 preflight/sync。`production-patch-submission-preflight-2026-08-24.sql`
在主表或画廊表缺失时只输出 `skipped_missing_table`，不会查询不存在的表；两张表
分别加栅栏，以便识别只完成一半的中断部署。Docker PostgreSQL 的逐条命令、备份、
postflight 和固定 Release tag 流程见 `docs/project/deployment.md` 的“投稿域上线顺序”。

生产变更要求：

- 先备份。
- 在部署前先运行 review 通过的 preflight/sync SQL；大数据操作先 dry-run。
- 不在生产 `prisma db push` reset database。
- 大表数据修复要分批、可重入、可观测。

`pnpm prisma:deploy-safe` 是生产部署命令。整个 package command 不是纯只读：既有的 `migration:resource-links` 先运行且可能执行兼容性 schema/data 写入，随后才是只读 schema guard/diff，最后运行 `prisma generate`；它不运行 `prisma db push`，也不应用 diff SQL。只读 guard 只接受空 diff，或经过 PostgreSQL catalog 验证的 Prisma 7.8 `public.patch_released_idx` operator-class 精确例外。任何其他 drift 都会在 build 或 standalone 替换前终止部署，不能把例外扩大到任意 diff 输出。不要执行该假漂移建议的 `DROP INDEX` / `CREATE INDEX` SQL：下一次 introspection 后它仍会出现，而且重建索引可能阻塞生产写入。本地开发、首次安装和 disposable CI 继续使用 `pnpm prisma:push`。

萌萌点账务上线时，先备份并运行只读 `migration/production-moemoepoint-ledger-preflight-2026-08-17.sql`，审核字段、表和余额 inventory；随后在维护窗口运行对应 sync。sync 在单事务中添加待结算列、明细/暂扣表、外键、约束与查询索引，并为每个既有用户写入幂等的迁移初始余额。成功后再运行 `pnpm prisma:deploy-safe`，确认 schema 无其他 drift 后才部署依赖新表的应用版本。旧应用不知道待结算字段和明细，sync 后回滚应用会继续产生未记账写入，因此应用回滚前必须停写并制定专用兼容/补偿方案。

私聊会话隐藏字段上线时，先执行 `migration/production-conversation-hidden-preflight-2026-07-01.sql` 查看 `user_conversation.user_a_hidden` / `user_b_hidden` 是否存在且为非空 boolean；确认后执行 `migration/production-conversation-hidden-sync-2026-07-01.sql`。该同步脚本只添加缺失列、补齐空值、设置默认值和非空约束，不删除数据。

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
