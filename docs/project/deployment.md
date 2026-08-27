# OtoAme Deployment Guide

本文档记录当前仓库的部署路径、构建产物和发布检查点。

## 部署模型

项目使用 Next.js standalone output 和 PM2：

- [next.config.ts](../../next.config.ts)：`output: 'standalone'`。
- [scripts/postbuild.ts](../../scripts/postbuild.ts)：把 runtime assets 复制进 `.next/standalone`。
- [ecosystem.config.cjs](../../ecosystem.config.cjs)：PM2 从 `.next/standalone` 启动 `server.mjs` 或 `server.js`，3 个实例。

standalone 运行时需要这些额外资源：

- `public`
- `.next/static`
- `.next/server` 和 `.next/BUILD_ID`（release artifact 会显式复制）
- `server/image`
- `posts`
- `config/redirect.json`
- Prisma Client 和 schema

Next standalone output 不会自动复制 `public` 和 `.next/static`，所以本仓库用 `scripts/postbuild.ts` 和 release packaging 显式补齐。

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

触发：

- push 到 `main`
- 手动 `workflow_dispatch`

CI 文件：[.github/workflows/release.yml](../../.github/workflows/release.yml)。

流程：

1. 启动 PostgreSQL 15 和 Redis 服务。
2. 安装依赖。
3. 写入构建用 `.env`。
4. `pnpm prisma:push`。
5. `pnpm build`，并设置 `KUN_DEPLOY_BUILD_SKIP_CHECKS=true`。
6. 打包 `.next/standalone`、`.next/static`、`.next/server`、`.next/BUILD_ID`、`public`、`server/image`、`posts`、`config/redirect.json`、`prisma`。
7. 生成 CalVer tag，例如 `v2026.06.09.1200`。
8. 上传 `release.tar.gz` 到 GitHub Release。

release 打包阶段还会删除包内 `package.json` 的 `"type": "module"`，并把 `server.js` 改名为 `server.mjs`。这是为了避免 standalone 中的 CommonJS 依赖受根包 ESM 设置影响。`ecosystem.config.cjs` 和 `deployPull.ts` 会优先启动 `server.mjs`，没有时回退到 `server.js`。

服务器更新：

```bash
pnpm deploy:pull
```

`package.json` 中的 `deploy:pull` 已经包含 `git pull`，不要在文档或自动化里重复写两次，除非你明确要先手动处理冲突。

[scripts/deployPull.ts](../../scripts/deployPull.ts) 会：

- 读取 `.env`。
- 从 GitHub latest release 下载 `release.tar.gz`。
- 解压到 `.next_temp`。
- 替换根目录 `prisma` schema。
- 运行 `pnpm prisma:deploy-safe`：先执行可能写入 schema/data 的资源链接兼容迁移，再只读校验生产 schema，最后在服务器架构上生成 Prisma Client。
- 把生成的 Prisma Client 注入 standalone node_modules。
- 把目标服务器 `node_modules/ffmpeg-static` 注入 standalone node_modules，确保 animated AVIF gallery 缩略图使用目标架构的 bundled ffmpeg。
- 如果目标服务器存在可选 `node_modules/.ffmpeg/ffmpeg`，同步注入 standalone `.ffmpeg/ffmpeg`。
- 原子替换 `.next/standalone`。
- 生成生产 sitemap 并复制进 standalone。
- 删除旧 PM2 进程并从新 cwd 启动 3 实例。

适用场景：

- 服务器不想执行完整 Next build。
- GitHub Release 已经成功生成 `release.tar.gz`。
- 生产服务器有 `node_modules`，可在目标架构重新生成 Prisma Client。
- release 包内会带 `prisma` schema，但 Prisma Client 仍在目标服务器重新生成并注入 standalone。

## 发布路径二：服务器本地构建

命令：

```bash
pnpm deploy:build
```

[scripts/deployBuild.ts](../../scripts/deployBuild.ts) 会：

- 校验 `.env`。
- 提醒测试站 noindex。
- 运行 `git pull && pnpm i && pnpm prisma:deploy-safe && pnpm build && pm2 startOrReload ecosystem.config.cjs`。
- build 时注入 `KUN_DEPLOY_BUILD_SKIP_CHECKS=true`。

适用场景：

- 服务器资源足够。
- 不依赖 GitHub Release。
- 需要在服务器环境直接构建。

这个脚本内部也会执行 `git pull`。如果服务器上有未提交本地修改，先处理工作区，否则 pull/build 可能失败或覆盖预期外状态。

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
- CSRF origin/referer 校验依赖 `NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV` 和 `NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD`，生产域名变更时必须同步。

GitHub Actions 只需要构建期公开变量：

- `NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV`
- `NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD`
- `NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL`

当前 CI 分支配置：

- `.github/workflows/release.yml` 监听 `main` 和手动触发。
- `.github/workflows/lint-check.yml` 监听 `master` 的 push 和 PR。

这意味着推送到 `main` 会发 release，但不会触发当前 lint workflow；如果项目主分支长期是 `main`，应考虑把 lint workflow 也改到 `main`。

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
- lint/typecheck workflow 是否覆盖 PR 和主分支。
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
KUN_DEPLOY_RELEASE_TAG='vYYYY.MM.DD.HHMM' pnpm deploy:pull
```

该变量为当前命令的临时环境变量，不写入长期 `.env`。tag 不匹配、Release 不存在
或缺少 `release.tar.gz` 时，部署必须在替换 standalone 和启动 PM2 前失败。

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

## 回滚思路

应用回滚和数据库回滚必须分开计划。生产回滚禁止使用 `db push` 类命令把 schema 推回旧状态，也不要假设目标旧版本包含当前的安全部署脚本。若目标版本需要回退 schema/data，先备份数据库并执行 review 通过的专用 preflight SQL，确认结果后再执行对应的 rollback/sync SQL；切换应用前还要使用目标版本的 schema 和依赖运行 `pnpm prisma generate`，生成匹配该版本的 Prisma Client。

Release artifact 路径：

1. 到 GitHub Releases 找到上一版 `release.tar.gz`。
2. 临时修改 `deployPull` 下载目标或手动下载旧产物。
3. 解压到临时目录，确认目标版本 Prisma schema 的向后兼容性，并按上述专用 SQL 流程处理必要的数据库回滚。
4. 安装目标版本依赖，运行 `pnpm prisma generate`，把生成的目标版本 Prisma Client 注入待切换的 standalone。
5. 替换 `.next/standalone` 并重启 PM2。

本地构建路径：

1. `git checkout` 到上一个可用 commit。
2. `pnpm install`，如果 lockfile 有变化。
3. 确认目标版本 Prisma schema 的向后兼容性，并按上述专用 SQL 流程处理必要的数据库回滚。
4. 针对目标版本运行 `pnpm prisma generate`。
5. `pnpm build`。
6. `pm2 delete kun-touchgal-next && pnpm start`。

禁止把 `git reset --hard` 当成默认回滚步骤，除非明确确认不会丢失服务器上的本地修改。

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
| PM2 报 cwd deleted 或找不到 server | 使用 `deployPull` 的 delete+start 流程，确认 `.next/standalone/server.mjs` 或 `server.js` 存在。               |
| 图片加载失败                       | `KUN_VISUAL_NOVEL_IMAGE_BED_HOST`、`KUN_VISUAL_NOVEL_IMAGE_BED_URL`、Next image `remotePatterns`。             |
| Prisma Client 架构不匹配           | 在目标服务器重新 `pnpm prisma generate`，确认 standalone 内 `.prisma` 和 `@prisma` 已更新。                    |
| sitemap 缺失                       | 跑 `pnpm build:sitemap`，确认 `scripts/postbuild.ts` 或 `deployPull` 复制到 standalone public。                |
| build 成功但运行缺资源             | 检查 `postbuild.ts` 的 assert 路径和 release packaging 的复制列表。                                            |
| 生产站被 noindex                   | 删除 `.env` 中 `KUN_VISUAL_NOVEL_TEST_SITE_LABEL`。                                                            |
| `deploy:pull` 找不到 release       | 确认 GitHub latest release 有 `release.tar.gz`，`.env` 中 `GITHUB_REPO` 正确，私有仓库配置 `GITHUB_TOKEN`。    |
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
   export OTOAME_RELEASE_TAG='<已审核的 Release tag，例如 v2026.08.28.1200>'
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

   这里提前 `git pull` 是为了取得与已审核 Release 相同版本的迁移 SQL；后面的
   `deploy:pull` 自带的 `git pull` 应当成为无变更操作。上面的 commit 比对失败时
   不得把当前分支的 SQL 与另一个 tag 的 artifact 混用。

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

10. 用固定 tag 部署 artifact。`deploy:pull` 内部会再次运行同一 guard，只有通过后
    才替换 standalone 并启动 PM2：

    ```bash
    KUN_DEPLOY_RELEASE_TAG="$OTOAME_RELEASE_TAG" pnpm deploy:pull
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
