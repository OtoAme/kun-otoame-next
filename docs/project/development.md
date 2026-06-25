# OtoAme Development Guide

本文档说明本地开发和常见变更流程。更完整的项目结构见 [overview.md](overview.md)。
按模块理解代码请读 [../modules/index.md](../modules/index.md)。

## 环境准备

需要：

- Node.js 22.15+
- pnpm
- PostgreSQL
- Redis

推荐先确认版本：

```bash
node -v
pnpm -v
psql --version
redis-cli --version
```

Node 必须使用 22.15 或更高的 22.x 版本。GitHub Actions 使用同一主版本线，本地版本偏差会让 Prisma、Next.js、Vitest mock hoisting 或 native dependency 行为不一致。

## 从零启动

初始化：

```bash
pnpm install
cp .env.example .env
pnpm prisma:push
pnpm dev
```

本地默认访问：

```text
http://127.0.0.1:3000
```

不要把真实 `.env` 内容写入 issue、文档、测试 fixture 或 prompt。示例值只来自 [.env.example](../../.env.example)。

### 1. 准备 PostgreSQL

创建本地数据库和用户的方式可以按自己的 PostgreSQL 安装调整。最小目标是让 `.env` 中的 `KUN_DATABASE_URL` 能连上一个空库，例如：

```bash
createdb otoame
```

`.env` 示例：

```env
KUN_DATABASE_URL="postgresql://user:password@localhost:5432/otoame?schema=public"
```

如果使用默认本地超级用户，也可以临时写成自己的本机连接串。不要在提交中保留真实密码。

### 2. 准备 Redis

本地 Redis 默认配置：

```env
REDIS_HOST='127.0.0.1'
REDIS_PORT='6379'
REDIS_PASSWORD=''
```

如果 Redis 设置了密码，必须同步填写 `REDIS_PASSWORD`。生产环境不建议空密码。

### 3. 配置 `.env`

从 `.env.example` 复制后，最少需要确认：

| 变量 | 本地开发说明 |
| --- | --- |
| `KUN_DATABASE_URL` | PostgreSQL 连接串。 |
| `KUN_VISUAL_NOVEL_SITE_URL` | 站点规范 URL，本地可保留示例生产域名，涉及 sitemap/SEO 时再按环境调整。 |
| `NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV` | 本地前端/API 地址，默认 `http://127.0.0.1:3000`。 |
| `NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD` | 生产公开地址。 |
| `REDIS_HOST`、`REDIS_PORT`、`REDIS_PASSWORD` | Redis 连接信息。 |
| `JWT_ISS`、`JWT_AUD`、`JWT_SECRET` | 登录 token 配置。本地也建议改掉默认 secret。 |
| `NODE_ENV` | 本地为 `development`。 |
| `BANGUMI_ACCESS_TOKEN` | Bangumi 标签/开发商匹配需要；不使用相关功能时可保留占位值，但调用外部接口会失败。 |
| `KUN_VISUAL_NOVEL_EMAIL_*` | 邮件发送相关；注册验证码/邮件通知需要真实配置。 |
| `KUN_VISUAL_NOVEL_S3_*`、`NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL` | 上传资源和图片访问需要真实配置。 |
| `KUN_VISUAL_NOVEL_IMAGE_BED_*` | Next image 远程域名和图片 URL 拼接依赖。 |
| `KUN_CF_CACHE_*` | Cloudflare 缓存清理；本地通常不会用到。 |
| `KUN_VISUAL_NOVEL_INDEX_NOW_KEY` | IndexNow key；生产需要在 `public` 放同名 txt。 |
| `KUN_VISUAL_NOVEL_TEST_SITE_LABEL` | 测试站 noindex 标记；生产必须删除或注释。 |
| `GITHUB_REPO`、`GITHUB_TOKEN` | 只影响 `deploy:pull`。 |

`validations/dotenv-check.ts` 只校验构建/运行强依赖。`REDIS_PASSWORD`、`BANGUMI_ACCESS_TOKEN`、`GITHUB_REPO`、`GITHUB_TOKEN` 等变量由具体使用点读取；如果你启用相关功能，仍要在 `.env` 中补齐。

### 4. 初始化数据库 schema

```bash
pnpm prisma:push
```

这个脚本实际执行：

```bash
pnpm migration:resource-links
pnpm prisma db push
pnpm prisma generate
```

如果 Prisma 提示需要 reset database，开发空库可以接受；有数据的库必须先停下确认，不能直接按 `y`。

### 5. 启动开发服务

```bash
pnpm dev
```

默认监听 `127.0.0.1:3000`。如果 Turbopack 行为异常，用 webpack 模式复查：

```bash
pnpm dev:webpack
```

### 6. 创建管理员账号

1. 打开 `http://127.0.0.1:3000/register` 注册第一个用户。
2. 打开 Prisma Studio：

   ```bash
   pnpm prisma studio
   ```

3. 找到 `user` 表中 `id = 1` 的用户，把 `role` 改为 `4`。
4. 刷新站点后，该用户就是超级管理员。

角色约定：

- `1`：普通用户。
- `2`：创作者。
- `3`：管理员。
- `4`：超级管理员。

## 常用脚本

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 使用 Turbopack 启动 Next dev server。 |
| `pnpm dev:webpack` | 使用 webpack dev server，排查 Turbopack 差异时用。 |
| `pnpm build` | 生产构建，触发 `postbuild`。 |
| `pnpm typecheck` | TypeScript 检查。 |
| `pnpm lint` | Next lint。注意当前依赖为 Next 15，若命令失效需迁移 lint 脚本。 |
| `pnpm test` | 运行 Vitest 单元测试。 |
| `pnpm prisma:push` | 跑资源链接迁移、同步 schema、重新生成 Prisma Client。 |
| `pnpm prisma:generate` | 只生成 Prisma Client。 |
| `pnpm build:sitemap` | 生成 sitemap。 |
| `pnpm deploy:build` | 服务器本地构建部署。 |
| `pnpm deploy:pull` | 拉取 GitHub latest release 产物部署。 |

## 开发工作流

1. 先定位业务域：页面在 `app/<route>`，组件在 `components/<domain>`，API 在 `app/api/<domain>`，校验在 `validations`。
2. 如果是行为变更或 bugfix，先写或更新 Vitest 测试。项目约定见 [testing.md](testing.md)。
3. 改 API 时先看 route handler 的鉴权、角色和 CSRF 是否符合现有模式。
4. 改 DB 写入时检查事务边界、缓存失效和审计日志。
5. 改上传/资源时检查 Redis upload lock、S3 补偿、finalize 和本地清理。
6. 改 schema 后运行 `pnpm prisma:push` 或至少 `pnpm prisma:generate`，按风险选择是否需要生产 preflight SQL。
7. 完成前运行最小相关测试，再运行 `pnpm typecheck`；涉及共享工具、缓存、schema、部署时加跑 `pnpm test`。
8. 每个代码提交后都要检查并同步对应的 `docs/project/*`、`docs/modules/*` 和 `.codex/skills/*/SKILL.md`。重大行为、API、数据、缓存、部署、测试或工作流变更必须同步文档和 skill。
9. 文档 / skill 同步必须作为独立提交，不能和业务代码、测试或迁移改动混在同一个 commit 中。

## 常见变更路径

### 新增或修改页面

相关路径：

- `app/<route>/page.tsx`
- `app/<route>/metadata.ts`
- `app/<route>/actions.ts`
- `components/<domain>/*`

注意：

- Server component 默认不使用 client hooks；需要交互时在组件顶部加 `'use client'`。
- 页面 metadata 独立维护。
- 有权限要求的页面应确认 `middleware.ts` 是否覆盖路径。

### 新增或修改 API

推荐结构：

```text
app/api/<domain>/route.ts
app/api/<domain>/service.ts
validations/<domain>.ts
tests/unit/api/<domain>.test.ts
```

route handler 负责：

- 使用 `kunParse*` 解析和校验输入。
- 使用 `verifyHeaderCookie` 或 JWT helper 校验登录态。
- 校验角色。
- 调用 service。
- 返回 `NextResponse.json`。

service 负责：

- Prisma 查询和事务。
- Redis cache 读写或失效。
- 外部 API 调用。
- 审计日志和副作用。

CSRF 细节：

- 非 upload API 由 `middleware.ts` 校验状态变更请求。
- 客户端请求应通过 `utils/kunFetch.ts` 或等价方式带上 `x-requested-with: kun-fetch`。
- `origin` / `referer` host 必须匹配 `NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV` 或 `NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD`。
- `/api/upload/*` 不走 middleware，handler 必须自行调用 `verifyKunCsrf`。

### 修改 Prisma schema

Schema 在 `prisma/schema` 拆分维护：

- 用户：`user.prisma`
- 游戏主体：`patch.prisma`
- 资源：`patch-resource.prisma`
- 评论：`patch-comment.prisma`
- 标签：`patch-tag.prisma`
- 公司：`patch-company.prisma`
- 评分：`patch-rating.prisma`
- 管理：`admin.prisma`
- 会话：`conversation.prisma`

改动后：

```bash
pnpm prisma:push
pnpm typecheck
pnpm test
```

生产表结构变更要优先写 preflight/sync SQL 或 dry-run 脚本，参考 `migration/production-schema-preflight-2026-05-03.sql` 与 `migration/production-schema-sync-2026-05-03.sql`。

### 修改缓存行为

先读：

- `lib/redis.ts`
- `app/api/patch/cache.ts`
- `config/cache.ts`

要求：

- 新 key 必须有明确前缀和 TTL。
- 列表缓存和详情缓存分开失效。
- 需要批量删除时用 `delKvs` 或 `delKvPattern`，避免手写未加前缀的 Redis key。
- 写入路径必须靠近业务写入点调用失效函数，不要只依赖后台任务修复。
- 直接使用 `redis` / `runRedisCommand` 时要显式写完整 key 前缀，并说明为什么不能用 `setKv` / `getKv`。

### 修改资源上传或下载

先读：

- `app/api/upload/resource/route.ts`
- `app/api/upload/resourceUtils.ts`
- `app/api/patch/resource/_helper.ts`
- `utils/resourceLink.ts`
- `tests/unit/resource-link.test.ts`

要求：

- 不要绕过 `consumeUpload` 和 `finalizeUpload`。
- S3 上传成功但 DB 写入失败时必须补偿删除。
- 审计日志使用脱敏 helper。
- 解析提取码或资源链接要补充 `utils/resourceLink.ts` 的单元测试。
- 上传配额会在 upload handler 中更新 `daily_upload_size`，改失败补偿或重试逻辑时必须考虑是否要回退配额。

### 修改主题或样式

先读：

- `docs/theme-color-system.md`
- `styles/themes.css`
- `styles/theme-tokens/*`
- `constants/theme.ts`
- `utils/semanticColor.ts`
- `components/kun/theme/SiteThemeScript.tsx`
- `components/kun/theme/SiteThemeRouteSync.tsx`
- `hooks/useKunSiteTheme.ts`
- `tests/unit/theme.test.ts`

注意：

- 首页和部分公开页面是 `force-static`，生产环境不能依赖服务端 `cookies()` 获取主题；主题 cookie 只用于可读取 cookie 的首屏兜底。
- 实际主题以 `html[data-kun-theme]` 为准。改主题持久化时，要同时检查 `SiteThemeScript`、`SiteThemeRouteSync`、`useKunSiteTheme`、cookie 和 `localStorage` 是否会在硬加载、服务重启后首屏、以及客户端导航后重新对齐。
- 浏览器端以 `localStorage` 为权威来源，cookie 不能覆盖更新的 `localStorage`。如果出现“选项显示 Pink 但页面显示 Classic”，优先检查 `html[data-kun-theme]` 是否被静态页面恢复成 `touchgal`，以及 soft navigation 后 `SiteThemeRouteSync` 是否运行。

修改后至少运行：

```bash
pnpm test tests/unit/theme.test.ts
pnpm typecheck
```

## 环境变量

[validations/dotenv-check.ts](../../validations/dotenv-check.ts) 是运行时校验来源。新增必需环境变量时：

1. 更新 `envSchema`。
2. 更新 `.env.example`。
3. 更新 `README.md` 的环境变量说明。
4. 如果 GitHub Actions build 需要该变量，更新 `.github/workflows/release.yml`。
5. 如果只有服务端使用，不要加 `NEXT_PUBLIC_`。

## 本地数据库和管理员

初始化数据库后，注册第一个用户，再用 Prisma Studio 或 SQL 把用户 `role` 设为 `4`。角色约定：

- `1`：普通用户。
- `2`：创作者。
- `3`：管理员。
- `4`：超级管理员。

## 代码风格

- TypeScript strict 已开启。
- 路径别名使用 `~/`。
- Prettier 使用项目默认配置；不要在无关文件做格式化 churn。
- 中文用户文案保留现有语气；代码和技能 frontmatter 使用英文触发描述更利于 agent 检索。
- 兼容性名称可以保留 `touchgal` / `galgame`，例如 cookie、Redis key、PM2 名称、旧 type helper；新用户可见文案优先使用 OtoAme / OtomeGame。
- 新共享逻辑优先写成可单测的纯函数，再接入 API 或组件。

## 完成前检查

按改动风险选择：

```bash
pnpm test tests/unit/<target>.test.ts
pnpm test
pnpm typecheck
pnpm build
```

涉及部署脚本、Next config、postbuild、runtime assets 时，必须至少运行 `pnpm typecheck`，并在可行时运行 `pnpm build`。

提交顺序：

1. 先提交业务代码、测试和迁移。
2. 再检查并更新对应文档和 skill。
3. 最后单独提交文档 / skill 变更，提交信息使用 `docs(...)` 或 `chore(skills)` 等约定式提交。

严禁把 `.codex/skills/*` 或 `docs/*` 的同步修改混入业务代码提交。

## 常见本地问题

| 症状 | 处理 |
| --- | --- |
| 启动时报 `.env file not found` | 确认项目根目录存在 `.env`，文件名末尾没有空格。 |
| `pnpm install` 后 Prisma Client 缺失 | 运行 `pnpm prisma:generate`。`postinstall` 正常会自动执行。 |
| `pnpm prisma:push` 要 reset database | 如果不是空开发库，立刻取消并先备份/写迁移方案。 |
| Redis 连接失败 | 确认 Redis 服务已启动，`REDIS_HOST`、`REDIS_PORT`、`REDIS_PASSWORD` 与本机一致。 |
| 图片域名无法加载 | 确认 `KUN_VISUAL_NOVEL_IMAGE_BED_HOST` 与 `next.config.ts` 的 remote pattern 一致。 |
| `pnpm lint` 不可用 | 当前脚本是 `next lint`；Next 15 项目可能需要迁移到 ESLint CLI。不要把 lint 通过当作发布唯一门槛。 |
