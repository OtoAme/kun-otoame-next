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
- `pnpm deploy:pull:pinned`
- `pnpm deploy:rollback`
- `pnpm gallery:ffmpeg:install`
- `pnpm start`
- `pnpm stop`

详见 `docs/project/deployment.md`。

### 维护脚本

- `maintenance:resource-attributes:*`
- `maintenance:dirty-tags:*`
- `maintenance:tags:*`
- `maintenance:companies:inventory` / `maintenance:companies:plan`
- `maintenance:companies:dirty:dry` / `maintenance:companies:dirty:apply` / `maintenance:companies:dirty:cache`
- `maintenance:conversation-images:*`
- `maintenance:submission-assets:*`
- `stickers:sync`：校验并同步内置 Sticker Pack 资源。默认 dry-run；加 `--apply` 后才会上传 WebP/WebM、生成动态 poster 并 upsert 数据库目录。静态 WebP 最大 512 KB，动态 WebM 必须为带透明通道、无音频的 VP9，最大 300 KB，超限直接拒绝；poster 使用内容哈希 key，避免 immutable CDN 复用旧图。
- Sticker 管理后台位于 `/admin/stickers`，服务端导入支持单张、多文件和 ZIP；ZIP 导入会检查路径穿越、符号链接、加密条目、ZIP Bomb、重复内容和解压大小，失败时清理已上传对象。
- 生产数据库变更按顺序执行 `migration/production-private-chat-stickers-preflight-2026-08-14.sql`、对应 sync，再执行 `migration/production-sticker-admin-preflight-2026-08-14.sql`、对应 sync。preflight 只读，sync 前必须审核重复 hash、封面引用和外键定义检查结果。已经执行过旧版 Sticker sync 的数据库，还要在备份后执行 `migration/production-stickers-prisma-alignment-2026-08-15.sql`，再运行 `pnpm prisma:deploy-safe`；该纠正脚本不触碰 `patch_released_idx`。
- `maintenance:gallery-thumbnails:*`
- `migration:resource-type:*`
- `migration:patch-counters`

### 验证脚本

- `pnpm e2e:db:prepare --reset --backup=<绝对且不存在的文件>`：只对显式 `KUN_E2E_DATABASE_URL` 的 `*_e2e` PostgreSQL 建立并验证备份后重置；`KUN_E2E_PG_CONTAINER` 启用 Docker 内 `pg_dump` / `psql`，此模式额外要求 loopback URL。
- `pnpm e2e:company-server --resolver=off|on`：唯一的 3100 company E2E server launcher，拒绝共享 `.next` 的 3000/3100 并发 dev server。
- `pnpm e2e:company-identity --expect-resolver=off|on`：在 server 两次重启之间分别验证两种运行时语义；只连接 `_e2e`，不走 S3 写入或删除。
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

`maintenance:tags:auto-alias:dry` 会在生产库里扫描“某个 tag 的 name 命中另一个主 tag 的 alias”的历史重复数据，并生成合并计划。dry-run 只做计划校验和关系数量预览，不加载所有受影响 patch 的 `unique_id`，避免生产数据量大时预览过慢。确认输出无误后再运行 `maintenance:tags:auto-alias:apply`；apply 会移动 patch 关系、合并 alias、迁移用户 blocked tag，并失效 tag/list/受影响 patch 内容缓存。`patch_tag.count` 随关系变化由数据库触发器维护，脚本不得修正。多主 tag 共用同一 alias 时会跳过并输出 warning，需要人工计划。

手工合并仍使用 `maintenance:tags:merge:* -- --plan=path/to/merge-plan.json`。本地库没有生产 tag 数据时，不要用本地 dry-run 结果判断生产影响面，应在生产备份后对生产库 dry-run。

生产会社清理使用**冻结计划**，不再由 dry/apply 每次重新联网和重新规划。完整顺序是 inventory → 人工 decisions → plan → dry → apply → cache：

```bash
pnpm maintenance:companies:inventory --out=/var/lib/kun-otoame/maintenance/company/<run-id>/company-inventory.json
pnpm maintenance:companies:plan --manual-only --inventory=/var/lib/kun-otoame/maintenance/company/<run-id>/company-inventory.json --decisions=/var/lib/kun-otoame/maintenance/company/<run-id>/company-decisions.json --out=/var/lib/kun-otoame/maintenance/company/<run-id>/company-cleanup-plan.json
pnpm maintenance:companies:dirty:dry --plan=/var/lib/kun-otoame/maintenance/company/<run-id>/company-cleanup-plan.json
pnpm maintenance:companies:dirty:apply --plan=/var/lib/kun-otoame/maintenance/company/<run-id>/company-cleanup-plan.json --confirm-sha256=<审核过的计划摘要>
pnpm maintenance:companies:dirty:cache --plan=/var/lib/kun-otoame/maintenance/company/<run-id>/company-cleanup-plan.json
```

`inventory` 只读生产数据库并写出带 SHA-256 sidecar 的 canonical JSON；人工 decisions 只能用 inventory 中的 opaque company ref 表达合并、删除、owner / introduction 保留策略与理由。**零作品关系不是删除指令**：任何公司删除都必须显式写入 decisions，并再次出现在审核过的冻结 plan 中；没有明确裁决的空公司、仅名称相近、`legacy` alias、共享 alias 或歧义证据一律保留。

生产已人工确认的少量重复会社使用 `plan --manual-only`：只消费 decisions 中明确列出的合并和删除，不访问 VNDB，也不生成 automatic merge。它仍连续读取实时数据库快照 A/B，并在任一 normalized name、external ID、identity 或 relation digest 变化时拒绝产出计划。省略 `--manual-only` 才会在两次快照之间读取 VNDB、补充 authoritative evidence 并提出 automatic merge。两种模式都会冻结动作、完整前后状态、缓存目标、工具/规范化版本和生成 commit，并写出独立 SHA sidecar。inventory、decisions、plan、sidecar、receipt、日志与数据库备份应放在仓库和所有 worktree 之外的 `0700` 持久目录，文件使用 `0600`，不得提交或跟随部署清理。

`dirty:dry` 与 `dirty:apply` 不访问 VNDB、Redis 或 Cloudflare，只接受同一个严格 plan。apply 还要求 `--confirm-sha256` 精确匹配，按固定顺序锁住 company relation/company/external ID/name identity 四张表，再核对计数触发器、计数不变量和完整前置快照；任何漂移均在零写入状态失败，整份计划在一个事务里提交或整体回滚。`dirty:cache` 不再写数据库或访问 VNDB，只按 receipt 重试 Redis 与 Cloudflare。`patch_company.count` 只由数据库触发器维护，脚本不增减也不重算。

apply 提交后写 receipt。若 Redis / Cloudflare 失效失败，只在数据库仍等于计划完整后置状态时重跑 `dirty:cache`，不要重新生成计划或重写数据库。合并没有自动 unmerge；恢复依赖执行前验证过的数据库备份和本次审计物。

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
- 生成包含秒、workflow run number 与短 commit SHA 的唯一 CalVer tag，并创建 GitHub Release。
- 在 artifact 根目录写入 `release-manifest.json`，绑定 manifest version、tag 与精确 commit SHA。

release packaging 还会删除包内 `package.json` 的 `"type": "module"`，并把 `server.js` 改名为 `server.mjs`。`ecosystem.config.cjs` 和 `deployPull.ts` 都支持优先启动 `server.mjs`，本地 standalone 则回退到 `server.js`。

`release.yml` 是仓库唯一的 workflow，CI 不运行测试或类型检查；同步上游带回的 `lint-check.yml`（监听 `master`，在本仓库永不触发）保持删除。

## Deploy Pull

`pnpm deploy:pull` 是 latest 模式：部署锁内先要求工作区干净并执行 `git pull --ff-only`，再取得 GitHub latest Release。高风险维护窗口使用 pinned 模式：

```bash
KUN_DEPLOY_RELEASE_TAG='<审核过的 tag>' pnpm deploy:pull:pinned
```

pinned 模式只 fetch 指定 tag 到临时 ref，不执行 pull、merge 或 checkout。两种模式都要求当前 `HEAD`、fetch 后剥离到 commit 的 tag 与 artifact manifest 三者的 commit 完全相同，并校验 manifest tag；旧版没有 manifest 的 R1/R3 artifact 只能按历史人工快照流程保留，不能交给当前 deploy pull。

下载的候选先在临时目录接受 candidate Prisma guard：兼容迁移先运行，schema guard 通过显式 `--schema` 校验候选 schema，随后才为候选生成并注入目标服务器架构的 Prisma Client、`@prisma`、`ffmpeg-static` 与可选 `.ffmpeg/ffmpeg`。guard 失败不会先替换根 schema 或当前 runtime。

已验证 runtime 以 `<commit>-<tag>` 保存到 `.deploy/releases/`。`.deploy/current` 和 `.deploy/previous` 是原子切换的符号链接；`.next/standalone` 只保留指向 `.deploy/current` 的兼容链接，构建清理 `.next` 不会删除可回滚 release。部署操作由 `.deploy/operation.lock` 串行化，切换前写 `.deploy/activation-journal.json`；中断后先恢复 journal 指向的旧 release。

激活后必须同时满足：恰好 3 个 `kun-touchgal-next` PM2 实例 online、cwd/script 指向候选 release，以及 loopback `KUN_DEPLOY_SMOKE_URL`（默认 `http://127.0.0.1:3000/`）返回 2xx/3xx。`KUN_DEPLOY_READINESS_TIMEOUT_MS` 可设为 5000–120000 毫秒。候选未就绪时自动恢复并验证旧 release；旧 release 也无法恢复时命令以聚合错误退出。

离线应用回滚使用：

```bash
pnpm deploy:rollback
```

它只恢复中断激活或切到 `.deploy/previous`，重新校验 PM2/HTTP 后才完成；不访问 GitHub、不改 Git、不运行 Prisma guard，也不改数据库。数据库 schema 回滚必须另走审核过的 rollback SQL。

私有仓库需要 `GITHUB_TOKEN`。下载时脚本会处理 GitHub/S3 跳转，并且跨域跳转不会继续携带 Authorization header。

## Deploy Build

`scripts/deployBuild.ts` 使用同一部署锁与 immutable slot/readiness 机制：先 fast-forward pull、安装依赖并运行 `pnpm prisma:deploy-safe`，再在服务器构建候选、补齐 Prisma/FFmpeg/runtime assets，写本地 manifest 并激活。build 时注入 `KUN_DEPLOY_BUILD_SKIP_CHECKS=true`，但发布前仍必须单独通过类型与测试门禁。

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
`KUN_DEPLOY_RELEASE_TAG='<已审核 tag>' pnpm deploy:pull:pinned` 固定目标产物。

`migration/*` 包含生产辅助 SQL 和脚本，`migration/backup/*` 是历史脚本。

投稿域生产迁移依次使用 VNDB Release ID unique、patch submission、submission
orphan cleanup 三组 preflight/sync。`production-patch-submission-preflight-2026-08-24.sql`
在主表或画廊表缺失时只输出 `skipped_missing_table`，不会查询不存在的表；两张表
分别加栅栏，以便识别只完成一半的中断部署。Prisma `@updatedAt` 对应列不得有数据库
默认值；preflight 会输出 `updated_default`，sync 可重跑地删除历史错误默认值。
Docker PostgreSQL 的逐条命令、备份、postflight 和固定 Release tag 流程见
`docs/project/deployment.md` 的“投稿域上线顺序”。

会社身份解析的 Phase A 结构使用独立的三份 SQL，必须先于任何读取新列或新表的
应用代码部署：

1. `production-company-identity-bootstrap-preflight-2026-08-30.sql` 只读盘点；首次
   上线时目标列、表和索引显示 `ready_to_create` 是预期结果，既有对象显示
   `definition_mismatch` 会直接阻断。
2. `production-company-identity-bootstrap-sync-2026-08-30.sql` 在单事务中增加可空
   `normalized_name`、投稿 `company_candidates` 快照列和两张身份表。该阶段只建普通
   全局查询索引；`normalized_name` 与 `(source, external_id)` 的最终唯一约束尚未启用。
3. `production-company-identity-bootstrap-postflight-2026-08-30.sql` 独立核对列类型、
   Prisma `@updatedAt` 默认值、外键动作、索引定义及 Phase A 不含最终全局唯一约束。
4. postflight 通过后运行 `pnpm prisma:deploy-safe`，再部署依赖该结构的应用版本。

三份 SQL 都在一次性 PostgreSQL 18 上验证过首次安装和重复执行。生产仍禁止用
`prisma db push` 代替这组迁移；后续身份回填和最终约束有各自独立的迁移阶段。

Phase A postflight 和 `pnpm prisma:deploy-safe` 通过、且包含会社身份双写的应用版本部署
完成后，使用 `pnpm maintenance:companies:identity:dry` 盘点身份回填。dry-run 只按 ID
分批读取，不写数据库；它会报告需要补写的 `normalized_name`、身份行更新、创建和删除
数量。确认结果后运行 `pnpm maintenance:companies:identity:apply`，完成后必须再次运行
dry-run，所有变更计数都应为 0。两条命令都支持例如 `-- --batch-size 200`，批大小会被
限制在 1–1000。

回填规则固定为：会社主名身份记为 `authoritative`；首次从历史 alias 数组生成的身份只能
记为 `legacy`，已经有依据的 `authoritative` 身份不得被回填降级；本阶段不回填外部 ID。
同一会社内部按 kind + 规范化值去重；不同会社共享同一别名是合法现状，不得因此自动
合并。若历史主名或别名本身、或其 NFKC 规范化结果无法放入 107 字符身份列，dry-run 会
中止；应先人工核对并修正该会社，不能截断后继续。apply 为每家公司使用短事务，并复用
在线写入的同一投影函数；维护进程使用独立 Prisma/pg 连接池并在退出时关闭，不影响常驻
应用的共享客户端。

会社 resolver 代码可以随 Phase A 应用提前部署，但
`KUN_COMPANY_IDENTITY_RESOLVER_ENABLED` 必须保持未配置或 `false`。该变量是仅服务端读取
的运行时开关，不得改成 `NEXT_PUBLIC_*`；只有完成历史盘点/清理、标签与会社计数触发器
迁移、Phase B 两个最终唯一约束及 postflight，并仍处于既定停写窗口时，才允许将其设为
`true` 并重启进程。启用会同时切换 `/edit` 公司来源、作者/管理员投稿预览和投稿批准，
不能只切其中一条。

若启用烟雾测试失败，把开关恢复为 `false` 并重启即可让预览与来源选择回到旧行为；已经
部署的目标唯一约束兼容层仍会从事务外重试并读取规范化胜者，所以无需回滚身份表或约束。
只有兼容层本身也失败时才重新暂停会社关系写入。当前阶段只安装代码，**不要提前打开
开关**。

标签与会社的 `count` 是关系表行数的数据库派生值。生产迁移由以下四份文件组成：

- `production-tag-company-count-preflight-2026-08-30.sql`
- `production-tag-company-count-sync-2026-08-30.sql`
- `production-tag-company-count-postflight-2026-08-30.sql`
- `production-tag-company-count-rollback-2026-08-30.sql`

上线必须保持以下顺序，不能先装触发器再部署旧应用，否则同一条关系会被应用和触发器各计一次：

1. 备份数据库，运行只读 preflight，并留存两张表的偏差行数和最大偏差。偏差只报告；缺表、`count` / ID 列类型不符、目标函数或触发器无法安全替换才阻断。
2. 部署“已删除所有 tag/company 手工增减、但仍保留旧绝对修复”的应用版本。这个短窗口可能漏计，sync 的全量回填会修正。
3. 在低峰维护窗口运行 sync。它在同一事务内安装 INSERT / DELETE / UPDATE 六个 statement-level transition-table 触发器，对两张关系表取得 `SHARE` 锁，再绝对重算全部计数。
4. 运行独立 postflight；六个函数、六个触发器的 catalog 定义和两张表的计数不变量必须全部通过。再次运行 sync 应显示两个 backfill 都是 `UPDATE 0`。
5. postflight 通过后，才部署删除 `patch/delete.ts`、会社清理和标签合并脚本中旧绝对修复的后续应用版本。

```bash
psql -X --set ON_ERROR_STOP=on -d "$KUN_DATABASE_URL" -f migration/production-tag-company-count-preflight-2026-08-30.sql
psql -X --set ON_ERROR_STOP=on -d "$KUN_DATABASE_URL" -f migration/production-tag-company-count-sync-2026-08-30.sql
psql -X --set ON_ERROR_STOP=on -d "$KUN_DATABASE_URL" -f migration/production-tag-company-count-postflight-2026-08-30.sql
```

Docker 中的 PostgreSQL 使用既有的 `docker exec -i ... psql ... < migration/...sql` 形式逐份执行。回滚必须暂停所有标签 / 会社关系写入：先运行 rollback（它只删除这六个目标触发器与函数，并在同一事务加锁重算两类计数），再部署带手工计数的旧应用；确认 preflight 只报告对象待创建且计数无偏差后才恢复写入。不要只回滚应用，也不要在写入仍开放时只删除触发器。

会社身份 Phase B 把 Phase A 的可空 / 普通索引升级为 `normalized_name NOT NULL UNIQUE` 与 `(source, external_id) UNIQUE`。交付物同时包含数据库回退和回退后检查：

- `production-company-identity-constraint-preflight-2026-08-30.sql`
- `production-company-identity-constraint-sync-2026-08-30.sql`
- `production-company-identity-constraint-postflight-2026-08-30.sql`
- `production-company-identity-constraint-rollback-2026-08-30.sql`
- `production-company-identity-constraint-rollback-postflight-2026-08-30.sql`

这一步开始连续停写窗口。先暂停创建游戏、重写游戏和投稿批准等会社关系写入，再运行身份 backfill dry-run，并按本节前述冻结流程重新生成生产 inventory、人工 decisions 与 plan。生产计划必须在停写后的实时快照上生成和审核，不能复用本地 ID 或停写前已漂移的 plan；跨会社共享 alias 是合法 warning，不要求清零。确认后依次运行：

```bash
pnpm maintenance:companies:identity:dry
pnpm maintenance:companies:inventory --out=<审计目录>/company-inventory.json
pnpm maintenance:companies:plan --manual-only --inventory=<审计目录>/company-inventory.json --decisions=<审计目录>/company-decisions.json --out=<审计目录>/company-cleanup-plan.json
pnpm maintenance:companies:dirty:dry --plan=<审计目录>/company-cleanup-plan.json
pnpm maintenance:companies:dirty:apply --plan=<审计目录>/company-cleanup-plan.json --confirm-sha256=<审核过的计划摘要>
pnpm maintenance:companies:dirty:cache --plan=<审计目录>/company-cleanup-plan.json
psql -X --set ON_ERROR_STOP=on -d "$KUN_DATABASE_URL" -f migration/production-company-identity-constraint-preflight-2026-08-30.sql
psql -X --set ON_ERROR_STOP=on -d "$KUN_DATABASE_URL" -f migration/production-company-identity-constraint-sync-2026-08-30.sql
psql -X --set ON_ERROR_STOP=on -d "$KUN_DATABASE_URL" -f migration/production-company-identity-constraint-postflight-2026-08-30.sql
pnpm prisma:deploy-safe
```

sync 会删除 Phase A 的两个普通索引并创建 Prisma 原生可表达的两个唯一索引；不要用 `prisma db push` 代替。postflight 通过后，用 R4 artifact 的**候选 schema**执行 guard/Client 生成并部署，resolver 先保持 `false`，再改为 `true` 并重启受控实例。此开关会同时切换 `/edit`、作者 / 管理员投稿预览和投稿批准，不能分开启用。

恢复外部写入前，必须在 flag 已开启的实例完成三条烟雾测试：创建一条游戏、重写一条游戏、批准一条投稿；逐条核对预览 canonical 会社与正式关系一致，Bangumi 独有发行 / 制作会社没有被丢弃，并且没有唯一冲突残留。若失败，把 flag 恢复为 `false` 并重启；Phase B 兼容层可承接 flag-off 流量，此时可以恢复写入后再排查。只有兼容层也失败才需要继续停写。

Phase B 后应用失败时，先在 resolver=false 下运行 `pnpm deploy:rollback` 恢复 `.deploy/previous`，并做 flag-off 兼容烟雾；这一步不改数据库。只有 previous release 的兼容层也无法在 Phase B 上运行时，才继续保持停写并执行 constraint rollback SQL，随后运行 rollback postflight。rollback 只移除两个最终唯一索引、恢复 Phase A 普通索引并取消 `normalized_name NOT NULL`，不删除 company、identity、external ID 或投稿快照数据；数据库回到 Phase A 后才能启动只兼容 Phase A 的旧应用。

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
