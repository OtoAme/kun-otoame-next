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

验证成功会输出 `Wrote ... bytes to ./public/images/tmp/animated-sample-thumb.avif`。验证失败不会影响普通上传，但 animated AVIF 会没有缩略图。

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
- 在服务器架构上重新 `pnpm prisma generate`。
- 把生成的 Prisma Client 注入 standalone node_modules。
- 把目标服务器 `node_modules/ffmpeg-static` 注入 standalone node_modules，确保 animated AVIF gallery 缩略图使用目标架构的 bundled ffmpeg。
- 如果目标服务器存在可选 `node_modules/.ffmpeg/ffmpeg`，同步注入 standalone `.ffmpeg/ffmpeg`。
- 原子替换 `.next/standalone`。
- `pnpm prisma:push`。
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
- 运行 `git pull && pnpm i && pnpm prisma:push && pnpm build && pm2 startOrReload ecosystem.config.cjs`。
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

当前部署脚本使用 `pnpm prisma:push`，不是 Prisma migrate deploy。生产 schema 变更应额外准备：

- preflight SQL：确认字段、索引、数据形态。
- sync SQL 或 dry-run 脚本：大数据变更先 dry-run。
- 回滚或补偿说明。

参考：

- `migration/production-schema-preflight-2026-05-03.sql`
- `migration/production-schema-sync-2026-05-03.sql`
- `migration/reclassify-resource-types.ts`
- `scripts/rebuildPatchResourceAttributes.ts`

严重警告：如果 `pnpm prisma:push` 或部署脚本出现类似下面的提示，必须取消：

```text
We found changes that cannot be executed:
To apply this change we need to reset the database, do you want to continue?
```

生产环境不要按 `y`，也不要回车确认。先备份数据库并写明确迁移/补偿方案。

## 回滚思路

Release artifact 路径：

1. 到 GitHub Releases 找到上一版 `release.tar.gz`。
2. 临时修改 `deployPull` 下载目标或手动下载旧产物。
3. 解压替换 `.next/standalone`。
4. 确认 Prisma schema 是否向后兼容；如果 DB 已经做破坏性变更，先处理数据回滚。
5. 重启 PM2。

本地构建路径：

1. `git checkout` 到上一个可用 commit。
2. `pnpm install`，如果 lockfile 有变化。
3. 按风险运行 `pnpm prisma:push`。
4. `pnpm build`。
5. `pm2 delete kun-touchgal-next && pnpm start`。

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
