# OtoAme Deployment Guide

本文档记录当前仓库的部署路径、构建产物和发布检查点。

## 部署模型

项目使用 Next.js standalone output、不可变 release 槽与 PM2：

- [next.config.ts](../../next.config.ts)：`output: 'standalone'`。
- [scripts/postbuild.ts](../../scripts/postbuild.ts)：把 runtime assets 复制进 `.next/standalone`。
- [scripts/deploySlots.ts](../../scripts/deploySlots.ts)：把已验证 runtime 保存到 `.deploy/releases/<commit>-<tag>`，以 `.deploy/current` / `.deploy/previous` 原子切换。
- [ecosystem.config.cjs](../../ecosystem.config.cjs)：优先从 `.deploy/current` 启动 `server.mjs` 或 `server.js`，兼容首次迁移前的 `.next/standalone`，固定 3 个实例。

standalone 运行时需要这些额外资源：

- `public`
- `.next/static`
- `.next/server` 和 `.next/BUILD_ID`（release artifact 会显式复制）
- `server/image`
- `posts`
- `config/redirect.json`
- Prisma Client 和 schema

Next standalone output 不会自动复制 `public` 和 `.next/static`，所以本仓库用 `scripts/postbuild.ts` 和 release packaging 显式补齐。`.next/standalone` 在受管部署后只是指向 `.deploy/current` 的兼容链接；`.deploy` 位于 `.next` 外，Next 清理构建目录不会删除当前和上一版可回滚 runtime。

## 服务器前置条件

部署机器需要：

- Node.js 22.15+
- pnpm
- Git
- PostgreSQL
- Redis
- PM2
- 可选但通常需要：Nginx、1Panel 或其他反向代理
- 可选：系统 `ffmpeg` 且支持 `libaom-av1`，作为 bundled `ffmpeg-static` 失效时的 animated AVIF gallery 缩略图兜底；两者都不可用时上传仍会保留原图并把 `thumbnailUrl` 回退为 `null`。

应用监听 `127.0.0.1:3000`，反向代理负责对外提供 HTTPS 域名。PM2 进程名固定为 `kun-touchgal-next`。

## 首次上线顺序

1. clone 仓库并进入目录：

   ```bash
   git clone https://github.com/OtoAme/kun-otoame-next.git
   cd kun-otoame-next
   ```

2. 复制并编辑环境变量：

   ```bash
   cp .env.example .env
   ```

3. 创建 PostgreSQL 数据库，并让 `KUN_DATABASE_URL` 指向该库。
4. 启动 Redis，并填写 `REDIS_HOST`、`REDIS_PORT`、`REDIS_PASSWORD`。
5. 填写生产域名、S3/image bed、邮件、Cloudflare、IndexNow 等生产配置。只有自备 FFmpeg 时才填写 `KUN_GALLERY_FFMPEG_PATH`。
6. 确认生产 `.env` 删除或注释 `KUN_VISUAL_NOVEL_TEST_SITE_LABEL`。
7. 初次安装：

   ```bash
   pnpm deploy:install
   ```

8. 构建并启动：

   ```bash
   pnpm typecheck
   pnpm build
   pnpm start
   ```

9. 配置反向代理到 `http://127.0.0.1:3000`。
10. 注册第一个用户，并把 UID 1 的 `role` 设置为 `4`。

`pnpm deploy:install` 只安装依赖、同步数据库并创建 `uploads`，不会启动 PM2。

animated AVIF gallery 缩略图通过 FFmpeg adapter 尝试生成。默认部署只使用项目依赖 `ffmpeg-static` 和系统 `ffmpeg`，避免安装阶段额外下载大型二进制；没有可用 animated AVIF encoder 时，上传仍保留原图并把 `thumbnailUrl` 回退为 `null`。

生产环境必须满足：

- `ffmpeg-static` 保持在 `dependencies` 中。
- `package.json` 的 `pnpm.onlyBuiltDependencies` 包含 `ffmpeg-static`，否则 pnpm 会阻止 install script，binary 可能不会下载。
- [next.config.ts](../../next.config.ts) 保持 `serverExternalPackages: ['ffmpeg-static']`，让 Route Handler 用原生 Node require 解析二进制路径。
- 使用 `pnpm deploy:pull` 时，目标服务器必须先跑过 `pnpm install` 或 `pnpm deploy:install`，保证根目录 `node_modules/ffmpeg-static` 是目标机器架构。`deployPull.ts` 会把目标机的 `ffmpeg-static` 注入 release standalone，避免 GitHub artifact 里的二进制架构和生产服务器不一致。
- 使用 `pnpm deploy:build` 时，依赖在服务器本机安装，通常会自动下载匹配目标 Linux x64/arm64 的 bundled binary。
- 如果手工移动 `.next/standalone`，不能只复制 standalone 目录；要同时确保 standalone 运行时能解析到 `node_modules/ffmpeg-static` 和其中的 `ffmpeg` 可执行文件，或安装系统 `ffmpeg` 作为兜底。

运行时按下面顺序查找 FFmpeg：

1. `KUN_GALLERY_FFMPEG_PATH` 指向的可执行文件。
2. `.next/standalone/.ffmpeg/ffmpeg`。
3. 项目根目录 `node_modules/.ffmpeg/ffmpeg`。
4. `ffmpeg-static`。
5. 系统 `ffmpeg`。

`KUN_GALLERY_FFMPEG_PATH` 是 `.env` 中的可选最高优先级覆盖项，适合指向生产服务器上自备的 FFmpeg，例如 `/opt/ffmpeg/bin/ffmpeg`。该路径必须是实际运行 PM2/Node 服务的机器上的可执行文件，运行用户需要有 execute 权限；修改后重启 PM2 才会生效。使用 `pnpm gallery:ffmpeg:install` 安装的 `node_modules/.ffmpeg/ffmpeg` 会被自动发现，通常不需要同时设置这个变量。

如果 Linux 服务器必须输出 animated AVIF，而默认 `ffmpeg-static` 只能降级为静图首帧，可以显式安装 BtbN 静态构建：

```bash
pnpm gallery:ffmpeg:install
pnpm build
pm2 restart kun-touchgal-next
```

脚本支持 Linux x64 和 arm64，会把二进制放到 `node_modules/.ffmpeg/ffmpeg`。`postbuild.ts` 会复制到 standalone 的 `.ffmpeg/ffmpeg`，`deploy:pull` 路径则可以依赖目标服务器根目录 `node_modules/.ffmpeg/ffmpeg` 或 `KUN_GALLERY_FFMPEG_PATH`。

如果 bundled binary 不可用，运行时会回退到系统 `ffmpeg`。部署后先确认 Node 能解析 bundled binary：

```bash
node -e "console.log(require('ffmpeg-static'))"
```

再用内置测试动图验证缩略图生成：

```bash
pnpm exec esno scripts/verifyGalleryAnimatedAvifThumbnail.ts ./public/images/animated-sample.avif ./public/images/tmp/animated-sample-thumb.avif
```

验证脚本会列出每个候选 FFmpeg 对输入样本和输出缩略图解析到的帧数。部分 Linux FFmpeg 会把 AVIF 的默认 stream 解析为 1 帧 still item，但后续 video stream 才是真正动画；脚本会继续探测并显示类似 `0:2: 61 frame(s)` 的 stream 结果，避免把静态首帧误判为 animated AVIF 缩略图。验证成功会输出 `Wrote animated AVIF thumbnail: ... bytes, ... frames to ...`。验证失败不会影响普通上传，但 animated AVIF 会没有动态缩略图。

线上上传后用 PM2 日志确认：

```bash
pm2 logs kun-touchgal-next
```

成功时应出现 `Animated AVIF thumbnail generated: ... bytes`；失败时看 `Animated AVIF thumbnail generation failed for all commands:` 的详细原因。常见原因是 install script 没运行、standalone 缺少 `ffmpeg-static`、目标机器架构不匹配、系统 `ffmpeg` 不存在或不支持 `libaom-av1`。

可选安装系统 fallback：

```bash
# Ubuntu / Debian
sudo apt-get update
sudo apt-get install -y ffmpeg
ffmpeg -hide_banner -encoders | grep -i libaom-av1
```

系统 `ffmpeg` 只是兜底；轻量部署优先依赖 `ffmpeg-static`，强 animated AVIF 输出再启用 BtbN 或自备 encoder。

## 发布路径一：GitHub Release artifact

> 临时状态：生产环境暂不使用 `pnpm deploy:pull` 或 `pnpm deploy:pull:pinned`。当前候选 artifact 的 Prisma Client 生成路径尚未通过真实生产布局的端到端验证；修复并完成验证前，生产更新统一使用后文的 `pnpm deploy:build`。已有 Release 仍可用于审计，不应据此直接激活 artifact。

触发：

- push 到 `main`
- 手动 `workflow_dispatch`

同一 `release-main` concurrency group 不取消正在运行的构建，避免并发 push 互相覆盖 release 状态；需要 R1/R3/R4 三个中间 Release 时仍应等待上一轮完成后再推下一节点。

CI 文件：[.github/workflows/release.yml](../../.github/workflows/release.yml)。

流程：

1. 启动 PostgreSQL 15 和 Redis 服务。
2. 安装依赖。
3. 写入构建用 `.env`。
4. `pnpm prisma:push`。
5. `pnpm build`，并设置 `KUN_DEPLOY_BUILD_SKIP_CHECKS=true`。
6. 打包 `.next/standalone`、`.next/static`、`.next/server`、`.next/BUILD_ID`、`public`、`server/image`、`posts`、`config/redirect.json`、`prisma`。
7. 生成不会在并发 workflow 中碰撞的 tag：秒级 CalVer + GitHub run number + 短 commit SHA。
8. 在 artifact 写入 `release-manifest.json`，严格绑定 manifest version、tag 与本次精确 commit SHA。
9. 上传 `release.tar.gz` 到 GitHub Release。

release 打包阶段还会删除包内 `package.json` 的 `"type": "module"`，并把 `server.js` 改名为 `server.mjs`。这是为了避免 standalone 中的 CommonJS 依赖受根包 ESM 设置影响。`ecosystem.config.cjs` 和 `deployPull.ts` 会优先启动 `server.mjs`，没有时回退到 `server.js`。

服务器更新最新 Release：

```bash
pnpm deploy:pull
```

`deploy:pull` 在整个操作锁内要求工作区干净，先执行 `git pull --ff-only`，再调用核心部署脚本。若 source 无法 fast-forward，命令在下载和切换 runtime 前终止。

部署经过审核的固定 Release：

```bash
KUN_DEPLOY_RELEASE_TAG='<已审核 tag>' pnpm deploy:pull:pinned
```

pinned 模式只 fetch 目标 tag 到临时 ref，不执行 `git pull`、merge 或 checkout。执行前应让服务器工作区以正常 fast-forward 方式到达该 tag 的精确 commit；脚本会再次要求 `HEAD = tag commit = manifest commit`。

[scripts/deployPull.ts](../../scripts/deployPull.ts) 会：

- 验证 `.env`、工作区、Release tag 与 artifact 的 `release-manifest.json`。
- 对 latest 与 pinned 都先 fetch 实际 tag，再核对 `HEAD`、tag peeled commit 和 manifest commit；任一不一致即失败。
- 下载候选到临时目录，先运行资源链接兼容迁移，再以显式 `--schema=<候选>/prisma/schema` 执行只读 Prisma guard。候选 guard 通过前不替换根 schema、生成客户端或切换 runtime。
- 用候选 schema 在目标服务器生成 Prisma Client，并把 `.prisma`、`@prisma`、`ffmpeg-static` 和可选 `.ffmpeg/ffmpeg` 注入候选。
- 验证 runtime 完整性、生成 sitemap，再把候选安装为 `.deploy/releases/<commit>-<tag>`。
- 写 activation journal，把 `.deploy/previous` 指向旧 current、`.deploy/current` 指向候选，并让 `.next/standalone` 保持兼容链接。
- 重启 PM2 后确认恰好 3 个实例均从候选 cwd/script online，再请求 loopback readiness URL；只有 2xx/3xx 才完成 journal。
- 候选启动或 readiness 失败时自动恢复旧 current，并再次验证旧版本；两边都失败时保留聚合错误供人工处理。

适用场景：

- 服务器不想执行完整 Next build。
- GitHub Release 已经成功生成 `release.tar.gz`。
- 生产服务器有 `node_modules`，可在目标架构重新生成 Prisma Client。
- release 包内会带 `prisma` schema 与 manifest，但 Prisma Client 仍在目标服务器按候选 schema 重新生成并注入 standalone。
- R1 / R3 等没有 manifest 的历史 artifact 不能交给当前 `deploy:pull` 或 `deploy:pull:pinned`；它们只作为已有人工快照，在明确的旧流程边界内恢复。

## 发布路径二：服务器本地构建

命令：

```bash
pnpm deploy:build
```

[scripts/deployBuild.ts](../../scripts/deployBuild.ts) 会：

- 取得与 Release 部署共用的 `.deploy/operation.lock`，校验工作区并 fast-forward pull。
- 安装锁文件依赖、运行 `pnpm prisma:deploy-safe`，再以 `KUN_DEPLOY_BUILD_SKIP_CHECKS=true` 本机构建。
- 给候选补齐 Prisma Client、schema 与 runtime assets，写入绑定当前 commit 的本地 manifest。
- 把候选安装进 `.deploy/releases`，经同一 activation journal、PM2 3 实例与 loopback HTTP readiness 后切换；失败时恢复旧 current。

适用场景：

- 服务器资源足够。
- 不依赖 GitHub Release。
- 需要在服务器环境直接构建。

这个脚本内部也会执行 fast-forward pull。服务器上有未提交本地修改时会 fail-closed；先人工处理工作区，不要让部署脚本覆盖预期外状态。

## 初次部署

```bash
pnpm deploy:install
```

[scripts/deployInstall.ts](../../scripts/deployInstall.ts) 会：

- `pnpm install`
- `pnpm prisma:push`
- 创建 `uploads`
- `chmod 777 uploads`

初次部署后还需要：

- 配置反向代理。
- 配置 DNS。
- 注册第一个用户。
- 把 UID 1 用户 role 设置为 `4`。
- 确认 PM2 进程和日志。

## 反向代理要点

Nginx 或面板反代应指向：

```text
http://127.0.0.1:3000
```

需要保留常见代理头：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

匿名高频读取接口可以按响应头做共享缓存：

- `/api/tag/otomegame`
- `/api/company/otomegame`

这两个接口的匿名响应会输出 `Cache-Control: public, s-maxage=30, stale-while-revalidate=300`。带登录 token、NSFW 设置、屏蔽标签设置等 cookie 的请求会输出 `private, no-store`，反向代理或 CDN 不能缓存这类个性化响应。

站点公开域名要与 `.env` 中这些值一致：

- `KUN_VISUAL_NOVEL_SITE_URL`
- `NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD`
- `NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL`
- `KUN_VISUAL_NOVEL_IMAGE_BED_URL`

## 环境变量

生产 `.env` 必需满足 [validations/dotenv-check.ts](../../validations/dotenv-check.ts)。

特别注意：

- `NODE_ENV=production`。
- `HOSTNAME=127.0.0.1`，由反向代理对外服务。
- `KUN_VISUAL_NOVEL_TEST_SITE_LABEL` 在生产应删除或注释，否则会 noindex。
- `NEXT_PUBLIC_*` 会进入前端 bundle，不能放私密值。
- GitHub artifact 部署需要 `GITHUB_REPO`，私有仓库需要 `GITHUB_TOKEN`。
- `KUN_DEPLOY_SMOKE_URL` 可覆盖激活后的 HTTP 探针，必须是 loopback `http:` URL；默认 `http://127.0.0.1:3000/`。
- `KUN_DEPLOY_READINESS_TIMEOUT_MS` 可把 PM2 + HTTP readiness 总超时设为 5000–120000 毫秒，默认 30000。
- CSRF origin/referer 校验依赖 `NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV` 和 `NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD`，生产域名变更时必须同步。

GitHub Actions 只需要构建期公开变量：

- `NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV`
- `NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD`
- `NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL`

当前 CI 分支配置：

- `.github/workflows/release.yml` 监听 `main` 和手动触发，是仓库唯一的 workflow。

CI 只负责构建发布产物，不运行 lint、类型检查或测试；发布前验证由本地按 `docs/modules/quality.md` 的分层约定执行。同步上游时若带回 `lint-check.yml`（上游主分支是 `master`，该 workflow 在本仓库永不触发，且 `next lint` 在 Next 15 已是弃用路径），保持删除。

## 发布前检查

本地或 CI 至少要有一次：

```bash
pnpm typecheck
pnpm test
```

涉及这些区域时建议再跑 `pnpm build`：

- `next.config.ts`
- `scripts/postbuild.ts`
- `.github/workflows/release.yml`
- `ecosystem.config.cjs`
- `prisma/schema/*`
- `posts`
- `server/image`
- runtime asset 路径

注意：部署构建中 `KUN_DEPLOY_BUILD_SKIP_CHECKS=true` 只跳过 Next 内置 lint/type validation，不代表类型已经安全。发布前仍需单独运行 `pnpm typecheck`。

workflow 改动还应检查：

- release workflow 是否仍监听当前主分支。
- 若引入检查类 workflow，覆盖 PR 和主分支，运行 `pnpm typecheck` + `pnpm test` 而不是已弃用的 `next lint`。
- GitHub Environment `buildPublicEnv` 是否包含所有构建期 `NEXT_PUBLIC_*`。
- release packaging 和 `scripts/postbuild.ts` 的 runtime asset 列表是否同步。

## 数据库变更

缺少 `public.patch_resource_access` 的生产环境必须先运行
`migration/production-resource-access-bootstrap-preflight-2026-07-12.sql` 和对应
bootstrap sync，再运行现有 resource-access grant preflight/sync。进入资源访问
维护窗口前先完成加固后的 Steam ID preflight/sync/postflight；随后停止全部 PM2
实例、dump、bootstrap、固定实际 max ID/cutover、运行两次 grant sync、postflight
和 Prisma Guard。任一步中止都不得重启旧 Release。

本次部署必须冻结并固定已审核的 Release tag：

```bash
KUN_DEPLOY_RELEASE_TAG='vYYYY.MM.DD.HHMMSS.<run>.<sha>' pnpm deploy:pull:pinned
```

该变量为当前命令的临时环境变量，不写入长期 `.env`。tag 不匹配、Release 不存在、
缺少 `release.tar.gz` / manifest，或 HEAD、tag commit、manifest commit 任一不一致时，
部署必须在安装候选 release 和启动 PM2 前失败。

数据库命令按环境分工：

- 本地开发、`pnpm deploy:install` 首次安装和 disposable CI 初始化继续使用 `pnpm prisma:push`，它会实际同步 schema。
- `pnpm deploy:pull` 和 `pnpm deploy:build` 生产部署使用 `pnpm prisma:deploy-safe`。执行部署前，review 通过的 preflight/sync SQL 必须已经在目标数据库运行完成。
- 整个 `pnpm prisma:deploy-safe` 不是纯只读命令：它先运行既有的 `migration:resource-links`，该兼容迁移可能执行 schema/data 写入；随后运行只读 schema guard/diff；最后运行 `prisma generate`。它不运行 `prisma db push`，也不会应用 `migrate diff` 生成的 SQL。只读 guard 只接受空 diff，或 Prisma 7.8 对 `public.patch_released_idx` 的精确 operator-class 假漂移，并且后者必须通过 PostgreSQL catalog 验证。
- 任何其他 drift 都会在 build 或 standalone 替换前终止部署。不能扩大例外去忽略其他 Prisma diff 输出。
- 不要执行假漂移提出的 `DROP INDEX "patch_released_idx"` / `CREATE INDEX "patch_released_idx" ... text_pattern_ops` SQL；下一次 introspection 后它仍会出现，而且 DROP/CREATE 索引可能阻塞生产写入。

生产 schema 变更应准备：

- preflight SQL：确认字段、索引、数据形态。
- sync SQL 或 dry-run 脚本：同步真实 schema 变更，大数据变更先 dry-run。
- 回滚或补偿说明。

参考：

- `migration/production-schema-preflight-2026-05-03.sql`
- `migration/production-schema-sync-2026-05-03.sql`
- 萌萌点账务：先备份并执行只读 `migration/production-moemoepoint-ledger-preflight-2026-08-17.sql`，确认后执行对应 sync；sync 会在单事务中添加待结算列、明细/暂扣表和索引，并为既有用户建立幂等初始余额明细。随后运行 `pnpm prisma:deploy-safe`，通过后才能启动依赖新 schema 的版本。旧版本仍会直接改总额而不写明细，不能在有写流量时把应用单独回滚到旧版本。
- 私聊 Sticker 目录：先执行 `migration/production-private-chat-stickers-preflight-2026-08-14.sql`，审核后执行对应 sync；再执行 `migration/production-sticker-admin-preflight-2026-08-14.sql`，审核重复 hash、封面引用和外键定义后执行对应 sync。已经执行过旧版 Sticker sync 的数据库，在备份后追加执行 `migration/production-stickers-prisma-alignment-2026-08-15.sql`，再运行 `pnpm prisma:deploy-safe`。该纠正脚本不处理 `patch_released_idx`，也不能用来替代生产 guard。
- `migration/reclassify-resource-types.ts`
- `scripts/rebuildPatchResourceAttributes.ts`

严重警告：如果手工在有数据的数据库运行 `pnpm prisma:push` 时出现类似下面的提示，必须取消：

```text
We found changes that cannot be executed:
To apply this change we need to reset the database, do you want to continue?
```

生产环境不要按 `y`，也不要回车确认。先备份数据库并写明确迁移/补偿方案。

### 会社身份与关系计数上线

会社身份分两次 schema 发布，计数触发器位于两者之间：

1. Phase A 依次执行 `production-company-identity-bootstrap-preflight-2026-08-30.sql`、sync、postflight。它增加可空 `normalized_name`、投稿可信候选快照和身份表，只建普通查询索引；postflight 后运行 `pnpm prisma:deploy-safe`，再部署依赖新结构且 resolver=false 的版本。
2. 运行 identity backfill，完成后 dry-run 必须为零变更。历史 alias 只写为 `legacy`，不能冒充 authoritative 外部证据。
3. 部署不再手工修改 tag/company count 的版本，再执行 `production-tag-company-count-{preflight,sync,postflight}-2026-08-30.sql`。sync 在一个事务内安装两张关系表各 INSERT/DELETE/UPDATE 的六个 statement-level transition-table 触发器，取得 `SHARE` 锁后全量修正计数。此后应用和维护脚本都不得增减或重算 `patch_tag.count` / `patch_company.count`。
4. Phase B 停写窗口中，按 `docs/modules/operations.md` 重新生成并审核生产 frozen cleanup plan，执行 dry/apply/cache，再运行 `production-company-identity-constraint-{preflight,sync,postflight}-2026-08-30.sql`。它安装 `normalized_name` 和 `(source, external_id)` 两个最终唯一约束。
5. 通过 R4 候选 schema guard 部署 resolver=false，随后打开同一个 server-only flag 并重启；创建、重写、投稿预览/批准烟雾测试通过后才恢复会社关系写入。

Phase B 应用失败先关闭 resolver 并执行 `pnpm deploy:rollback`，验证 previous release 能否兼容 Phase B。只有 previous 兼容层也失败时才在持续停写下执行 `production-company-identity-constraint-rollback-2026-08-30.sql` 和 `production-company-identity-constraint-rollback-postflight-2026-08-30.sql`；这组 SQL 保留所有业务数据，只恢复 Phase A 索引与 nullable 形态。计数触发器的数据库回滚使用独立 `production-tag-company-count-rollback-2026-08-30.sql`，并且必须先恢复匹配的手工计数应用版本再开放关系写入。

## 回滚思路

应用回滚和数据库回滚必须分开计划。当前受管部署保留不可变 `.deploy/current` 与 `.deploy/previous`，应用层离线回滚直接运行：

```bash
pnpm deploy:rollback
```

命令与 deploy pull/build 共用操作锁。若 activation journal 表示上一次切换中断，它先恢复 journal 记录的旧 current；否则把 current 切到 previous。目标 runtime 会在删除 PM2 前完成静态校验，切换后还必须通过 3 个 PM2 实例与 loopback HTTP readiness。previous 不可用时会恢复并验证原 current；成功回滚后 current/previous 都固定到已验证的旧 release，避免下一次误把失败版本重新切回来。

`deploy:rollback` 不访问 GitHub、不执行 Git 命令、不运行 Prisma guard，也不改数据库。它只适用于上一版应用仍兼容当前 schema 的情况。需要回退 schema/data 时，继续保持相关写入停止，先备份并执行 review 通过的专用 rollback 与 rollback postflight；生产禁止用 `prisma db push` 推回旧结构。

公司身份 Phase B 的专用退路是 `production-company-identity-constraint-rollback-2026-08-30.sql` 与 `production-company-identity-constraint-rollback-postflight-2026-08-30.sql`：只移除最终全局唯一约束、恢复 Phase A 普通索引并放宽 `normalized_name` 可空，不删除公司、identity、external ID 或投稿快照数据。R4 无法启动时先关闭 resolver 并回滚到 previous 的 R3 兼容 artifact；只有兼容层也失败时才执行这组数据库 rollback。

旧 R1/R3 artifact 没有当前 manifest。它们不能通过新 deploy pull 重新下载和激活，只能使用上线前保存并验证过的人工 snapshot；这个历史边界不应被包装成常规回滚。禁止把 `git reset --hard` 当默认回滚步骤。

若必须恢复不在 previous 槽中的其它目标版本，先审核该目标版本与当前数据库的兼容性；需要改 schema/data 时先运行 review 通过的专用 preflight，再执行对应 rollback/sync SQL。不要假设旧版本自带当前安全脚本，应在隔离目录安装目标版本依赖，以它的 schema 显式运行 `pnpm prisma generate` 并注入目标 runtime，完成静态检查和同一 PM2/HTTP readiness 后才允许切换。

## 运行后检查

```bash
pm2 status
pm2 logs kun-touchgal-next
```

还应检查：

- 首页和游戏详情页是否能打开。
- 登录、资源列表、图片域名是否正常。
- Redis 和 PostgreSQL 是否连通。
- `public/sitemap.xml` 是否更新。
- Cloudflare cache purge 相关功能是否报错。

还应在浏览器检查：

- 首页 `/`
- 注册/登录 `/register`、`/login`
- 游戏详情页 `/<unique_id>`
- 管理后台 `/admin`
- 资源列表 `/resource`
- 萌萌点中心 `/moemoepoint` 与规则页 `/moemoepoint/rules`

如果上传功能启用，做一次小文件上传和删除验证，确认 S3、Redis upload metadata、Cloudflare purge 都可用。

## 常见故障

| 症状                               | 优先检查                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| PM2 报 cwd deleted 或找不到 server | 检查 `.deploy/current` 是否指向 `.deploy/releases` 内完整 runtime；`.next/standalone` 只应是兼容链接。         |
| 图片加载失败                       | `KUN_VISUAL_NOVEL_IMAGE_BED_HOST`、`KUN_VISUAL_NOVEL_IMAGE_BED_URL`、Next image `remotePatterns`。             |
| Prisma Client 架构不匹配           | 在目标服务器重新 `pnpm prisma generate`，确认 standalone 内 `.prisma` 和 `@prisma` 已更新。                    |
| sitemap 缺失                       | 跑 `pnpm build:sitemap`，确认 `scripts/postbuild.ts` 或 `deployPull` 复制到 standalone public。                |
| build 成功但运行缺资源             | 检查 `postbuild.ts` 的 assert 路径和 release packaging 的复制列表。                                            |
| 生产站被 noindex                   | 删除 `.env` 中 `KUN_VISUAL_NOVEL_TEST_SITE_LABEL`。                                                            |
| `deploy:pull` 找不到 release       | 确认 latest/指定 tag 有 `release.tar.gz` 与 manifest，`GITHUB_REPO` 正确，私有仓库配置 `GITHUB_TOKEN`。        |
| 部署提示 tag / commit 不一致       | 停止切换；让工作区 HEAD 精确到目标 tag commit，确认 artifact manifest 来自同一 workflow 后重试。               |
| 部署锁或 activation journal 存在   | 不要手工删正在使用的锁；确认 owner 进程。中断 journal 交给下一次 deploy/rollback 自动恢复。                    |
| `deploy:build` 过程内存不足        | 增加 swap，或降低 `ecosystem.config.cjs` 的 `instances`。README 中按服务器核数调整实例数，但内存也会线性增长。 |

## 投稿域上线顺序

1. 先跑 `migration/production-vndb-relation-id-unique-preflight-2026-08-24.sql`。**出现任何 `ci_duplicate_group` 行就停下人工处理**：两条游戏共用一个 Release ID 是内容决策，不能自动合并。
2. 无冲突后跑对应 sync。它会把 `vndb_relation_id` 归一为小写、加大小写无关唯一性所需的 CHECK，并 `CREATE UNIQUE INDEX CONCURRENTLY`（因此必须在显式事务之外执行）。
3. 再跑 `production-patch-submission-preflight-2026-08-24.sql` 与对应 sync，建 `patch_submission` / `patch_submission_gallery` 与状态 CHECK。preflight 在首次上线缺表时会把行检查标为 `skipped_missing_table`，也能分别识别只存在一张表的中断状态；preflight 只读，sync 可重跑。
4. 跑 `production-patch-submission-orphan-cleanup-preflight-2026-08-25.sql`，审核结果后再跑对应 sync，创建 durable orphan cleanup outbox；随后执行 `pnpm prisma:deploy-safe`。应用代码依赖该表，必须先完成 schema rollout。
5. 确认 `KUN_VISUAL_NOVEL_IMAGE_BED_URL` 与 `NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL` 中每个公开 hostname 都在 Cloudflare purge 凭据覆盖范围内。两者可以不同，但清理会对所有去重后的完整 URL purge；若某个 base 不由该 Cloudflare zone 管理，不能把失败响应当成功跳过。
6. 后端上线后再开放入口（用户主页的投稿标签与后台审核入口）。
7. 生产不跑 `prisma db push`。

### Docker PostgreSQL 可复制执行清单

以下清单用于 PostgreSQL 容器内提供 `psql` / `pg_dump` / `pg_restore`、应用由
PM2 管理、服务器使用 GitHub Release artifact 的场景。命令应在生产服务器的项目
目录中**逐条执行并检查上一条结果**，不要整段一次粘贴。尖括号内容必须先替换。

1. 开启 shell 失败保护，并进入生产项目目录：

   ```bash
   set -eu
   ```

   ```bash
   cd /srv/kun-otoame-next
   ```

2. 设置本次上线参数。备份文件保存在宿主机，不在 PostgreSQL 容器内：

   ```bash
   export OTOAME_PG_CONTAINER='<PostgreSQL 容器名>'
   ```

   ```bash
   export OTOAME_PG_USER='<数据库用户，例如 postgres>'
   ```

   ```bash
   export OTOAME_PG_DATABASE='<生产数据库名>'
   ```

   ```bash
   export OTOAME_RELEASE_TAG='<已审核的 Release tag，例如 v2026.08.28.120000.123.1a2b3c4d>'
   ```

   ```bash
   export OTOAME_SITE_URL='https://<生产域名>'
   ```

   ```bash
   export OTOAME_ROLLOUT_ID='<本次上线编号，例如 20260828-1200>'
   ```

   ```bash
   export OTOAME_BACKUP_DIR='/srv/backup/otoame'
   ```

   ```bash
   export OTOAME_BACKUP_FILE="$OTOAME_BACKUP_DIR/otoame-before-submission-$OTOAME_ROLLOUT_ID.dump"
   ```

3. 确认目标容器、当前代码和 Release。`git status --short` 有任何输出都先停下处理：

   ```bash
   docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
   ```

   ```bash
   docker inspect --format '{{.State.Status}}' "$OTOAME_PG_CONTAINER"
   ```

   ```bash
   git status --short
   ```

   ```bash
   git pull --ff-only
   ```

   ```bash
   git fetch --tags --force origin
   ```

   ```bash
   test "$(git rev-parse HEAD)" = "$(git rev-list -n 1 "$OTOAME_RELEASE_TAG")"
   ```

   这里提前 fast-forward 是为了取得与已审核 Release 相同版本的迁移 SQL；后面的
   `deploy:pull:pinned` 不会执行 pull 或 checkout。上面的 commit 比对失败时不得把
   当前分支的 SQL 与另一个 tag 的 artifact 混用。

4. 安装锁文件对应依赖并验证容器内数据库连接。若容器本地连接仍要求密码，使用
   生产环境既有的 `.pgpass` / Docker secret，不要把密码写进命令或 shell 历史：

   ```bash
   pnpm install --frozen-lockfile
   ```

   ```bash
   docker exec "$OTOAME_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" -c 'SELECT current_database(), current_user, version();'
   ```

   ```bash
   mkdir -p "$OTOAME_BACKUP_DIR"
   ```

5. 应用仍在线时运行三份只读 preflight：

   ```bash
   docker exec -i "$OTOAME_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-vndb-relation-id-unique-preflight-2026-08-24.sql
   ```

   ```bash
   docker exec -i "$OTOAME_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-patch-submission-preflight-2026-08-24.sql
   ```

   ```bash
   docker exec -i "$OTOAME_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-patch-submission-orphan-cleanup-preflight-2026-08-25.sql
   ```

   首次上线时，投稿主表、画廊表和 orphan cleanup 表显示 `missing` 是预期结果；
   投稿行检查显示 `skipped_missing_table` 也是预期结果。以下任一情况必须停止：
   - 出现 `ci_duplicate_group` 行，或 `ci_duplicate_groups` 不为 `0`。
   - 已存在字段显示 `type_mismatch` / `nullability_mismatch`。
   - 已存在约束或索引的定义与 sync 预期不一致。
   - `patch_status_values` 中出现 `0` 以外的状态。

6. 进入维护窗口并在宿主机创建一致性备份：

   ```bash
   pm2 stop kun-touchgal-next
   ```

   ```bash
   pm2 status
   ```

   ```bash
   test ! -e "$OTOAME_BACKUP_FILE"
   ```

   ```bash
   docker exec "$OTOAME_PG_CONTAINER" pg_dump -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" --format=custom --compress=6 --no-owner --no-privileges > "$OTOAME_BACKUP_FILE"
   ```

   ```bash
   test -s "$OTOAME_BACKUP_FILE"
   ```

   ```bash
   docker exec -i "$OTOAME_PG_CONTAINER" pg_restore --list < "$OTOAME_BACKUP_FILE" > /dev/null
   ```

7. 按依赖顺序执行三份 sync。不要给 VNDB sync 外包一层显式事务，因为它使用
   `CREATE UNIQUE INDEX CONCURRENTLY`：

   ```bash
   docker exec -i "$OTOAME_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-vndb-relation-id-unique-sync-2026-08-24.sql
   ```

   ```bash
   docker exec -i "$OTOAME_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-patch-submission-sync-2026-08-24.sql
   ```

   ```bash
   docker exec -i "$OTOAME_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-patch-submission-orphan-cleanup-sync-2026-08-25.sql
   ```

8. 原样重跑三份 preflight 作为 postflight。此时 required table / column /
   index / constraint 应全部正常，两个 `updated_default` 应为 `ok`，五类非法行计数
   应为 `0`，orphan cleanup 表应为 `present`：

   ```bash
   docker exec -i "$OTOAME_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-vndb-relation-id-unique-preflight-2026-08-24.sql
   ```

   ```bash
   docker exec -i "$OTOAME_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-patch-submission-preflight-2026-08-24.sql
   ```

   ```bash
   docker exec -i "$OTOAME_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-patch-submission-orphan-cleanup-preflight-2026-08-25.sql
   ```

9. 运行生产 Prisma guard。它不会用 `db push` 应用 Prisma diff；出现除已记录的
   `patch_released_idx` 精确假漂移以外的任何 drift 都必须停止：

   ```bash
   pnpm prisma:deploy-safe
   ```

10. 用固定 tag 部署 artifact。`deploy:pull:pinned` 会 fetch 指定 tag，校验
    HEAD/tag/manifest，并以候选 schema 再次运行 guard；只有 readiness 通过后才完成
    `.deploy/current` 切换：

    ```bash
    KUN_DEPLOY_RELEASE_TAG="$OTOAME_RELEASE_TAG" pnpm deploy:pull:pinned
    ```

11. 检查进程、数据库对象和 HTTP：

    ```bash
    pm2 status
    ```

    ```bash
    pm2 logs kun-touchgal-next --lines 200 --nostream
    ```

    ```bash
    docker exec "$OTOAME_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" -c "SELECT to_regclass('public.patch_submission'), to_regclass('public.patch_submission_gallery'), to_regclass('public.patch_submission_orphan_cleanup');"
    ```

    ```bash
    curl -fsS "$OTOAME_SITE_URL/" > /dev/null
    ```

    ```bash
    curl -fsS "$OTOAME_SITE_URL/login" > /dev/null
    ```

    ```bash
    pnpm maintenance:submission-assets:dry
    ```

    最后用投稿人和审核员账号各走一次最短链路：创建草稿、上传小图、提交、打开
    审核详情并处理；同时检查 PM2、S3 和 Cloudflare purge 日志。确认无误后再开放
    站内投稿入口。

从 `pm2 stop` 开始，任一命令失败都应保持应用停止，保存终端输出和备份路径，先
判断失败发生在 sync 前、sync 中还是 artifact 切换中。不要用 `prisma db push`、
`--force-reset` 或未经审核的 `pg_restore --clean` 尝试“对齐”；数据库恢复属于单独
的破坏性操作，必须基于本次 dump 和已确认的恢复方案执行。
