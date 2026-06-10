# OtoAme Project Overview

本文档记录当前仓库的实际结构和运行模型，用于新维护者或 Codex agent 快速建立上下文。命令和路径以仓库根目录为准。

## 项目定位

OtoAme 是基于 `kun-touchgal-next` fork 的一站式乙女游戏文化社区。当前仓库保留上游历史，但主线已经围绕 OtoAme 做了路由、文案、资源类型、画廊、缓存、部署和管理后台能力的改造。

关键入口：

- [README.md](../../README.md)：面向部署者的运行、环境变量和部署说明。
- [package.json](../../package.json)：所有常用脚本和依赖版本。
- [next.config.ts](../../next.config.ts)：Next.js build、MDX、standalone 输出、图片域名和部署跳过检查开关。
- [prisma.config.ts](../../prisma.config.ts)：Prisma schema 目录与数据源配置。
- [vitest.config.ts](../../vitest.config.ts)：单元测试环境与 `~/*` 路径别名。
- [docs/project/development.md](development.md)：本地从零启动、环境变量、管理员初始化和常见开发路径。
- [docs/project/deployment.md](deployment.md)：服务器上线、CI/CD release、PM2、反向代理和回滚。
- [docs/modules/index.md](../modules/index.md)：按代码模块组织的详细文档导航。

## 技术栈

- Runtime：Node.js 22.15+、pnpm、Next.js 15 App Router、React 19。
- UI：HeroUI、Tailwind CSS 4、lucide-react、framer-motion、Recharts/Nivo。
- 内容：MDX posts、Milkdown/CodeMirror 编辑器、Markdown/HTML 渲染与 sanitize 管线。
- 数据：PostgreSQL、Prisma 7、`@prisma/adapter-pg`、`pg` 连接池。
- 缓存和锁：Redis/ioredis，统一 key 前缀为 `kun:touchgal`。
- 测试：Vitest 4，当前以 Node 环境单元测试为主。
- 部署：Next standalone output、PM2、GitHub Actions release artifact、服务器本地构建脚本。

## 新用户阅读顺序

1. 只想本地跑起来：读 [development.md](development.md) 的“从零启动”。
2. 要理解代码结构：读本文档“目录地图”和“运行时架构”。
3. 要按模块理解源码：读 [docs/modules/index.md](../modules/index.md)。
4. 要上线服务器：读 [deployment.md](deployment.md)。
5. 要改代码：读 [development.md](development.md) 和 [testing.md](testing.md)。
6. 要审 PR：读 [review.md](review.md)。

上游文档核对点：

- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)：`output: 'standalone'` 会生成可独立运行的 `.next/standalone`。
- [Next.js TypeScript build check](https://nextjs.org/docs/app/api-reference/config/next-config-js/typescript)：`typescript.ignoreBuildErrors` 会跳过 build 内置类型检查，只应在部署流程另行运行 `pnpm typecheck` 时使用。
- [Prisma schema location](https://www.prisma.io/docs/orm/prisma-schema/overview/location)：本仓库使用 `prisma.config.ts` 指向 `prisma/schema`，并按业务域拆分 schema 文件。
- [Vitest vi.mock/vi.hoisted](https://vitest.dev/api/vi.html#vi-hoisted)：现有测试使用 `vi.mock` 与 `vi.hoisted`，符合 Vitest 对提升 mock 的要求。

## 命名兼容性

仓库内仍保留部分上游历史命名，这是兼容成本，不代表业务语义回退：

- `package.json` 包名、PM2 进程名和部分 Redis key 仍是 `kun-touchgal-next` / `kun:touchgal`。
- 旧 cookie、token、type helper 和部分 internal type 仍含 `galgame`，例如 `kun-galgame-patch-moe-token`、`GalgameCardSelectField`。
- 用户可见文案和新增业务文档应使用 OtoAme / OtomeGame，除非引用现有路径、key、类型或兼容字段。
- 改名类变更风险较高，会影响 cookie、缓存、部署、SEO 和第三方链接；不要在功能 PR 中顺手大范围改名。

## 目录地图

| 路径 | 责任 |
| --- | --- |
| `app/` | Next.js App Router 页面、layout、metadata、server actions 与 API route handlers。 |
| `app/api/*` | API 层。常见形态是 `route.ts` 负责 HTTP/校验/鉴权，`service.ts` 或同目录函数负责业务。 |
| `components/` | 按页面或业务域组织的 React 组件。共享 UI 多在 `components/kun`。 |
| `config/` | 站点、缓存、Redis、外部 API、重定向、友链和水印等配置。 |
| `constants/` | 前后端共享枚举、选项、路由和业务常量。 |
| `docs/` | 维护文档。`docs/project` 是项目工程手册，`docs/theme-color-system.md` 是主题系统文档。 |
| `lib/` | 外部服务和基础设施封装，如 Redis、S3、OneDrive、VNDB/DLSite/Steam。 |
| `middleware/` | Next middleware 使用的认证、CSRF、header cookie 校验。 |
| `migration/` | 一次性或生产辅助数据修复脚本，部分脚本有 dry/apply 模式。 |
| `posts/` | MDX 内容源。构建时会复制进 standalone 产物。 |
| `prisma/schema/` | Prisma schema 拆分文件。`schema.prisma` 只包含 generator/datasource，模型分散在相邻文件。 |
| `scripts/` | 构建、部署、维护、sitemap、标签治理等运维脚本。 |
| `server/` | cron 任务和验证码图片等运行时资源。 |
| `store/` | Zustand stores。 |
| `tests/unit/` | Vitest 单元测试。 |
| `utils/` | 纯工具、server action helpers、URL/markdown/resource/rating 等通用逻辑。 |
| `validations/` | Zod schema，API 和表单输入校验。 |

## 运行时架构

### App Router 与 API 分层

页面和 API 都在 `app/` 下。页面路径使用 `page.tsx`、`layout.tsx`、`metadata.ts` 和 `actions.ts`。API route handler 使用 `route.ts` 导出 `GET`、`POST`、`PUT`、`DELETE` 等方法。

推荐结构：

- HTTP 层：解析 request、调用 Zod schema、验证登录/角色、返回 `NextResponse.json`。
- Service 层：业务事务、Prisma 查询、缓存失效、外部 API 调用。
- Utility 层：纯函数、格式化、解析、跨域复用逻辑。

示例：

- [app/api/edit/route.ts](../../app/api/edit/route.ts) 解析 form data、校验登录和角色。
- [app/api/edit/create.ts](../../app/api/edit/create.ts) 创建游戏、上传 banner、写入 rating stat、处理外部标签并失效缓存。
- [app/api/patch/resource/_helper.ts](../../app/api/patch/resource/_helper.ts) 处理资源上传消费、S3 补偿、缓存失效和审计日志脱敏。

### 数据访问

[prisma/index.ts](../../prisma/index.ts) 使用 `pg.Pool` 和 `PrismaPg` adapter 创建 Prisma Client：

- 连接池 `max: 30`。
- `connectionTimeoutMillis: 5000`，`idleTimeoutMillis: 30000`。
- 自定义 prepared statement name cache，最多 1000 条。

Schema 放在 `prisma/schema` 目录，使用 Prisma 7 的配置文件 [prisma.config.ts](../../prisma.config.ts) 指向该目录。改 schema 后应运行：

```bash
pnpm prisma:push
```

这个脚本会先运行 `migration:resource-links`，再 `prisma db push` 和 `prisma generate`。

### 输入校验

Zod schema 集中在 `validations/`。API 工具函数在 [app/api/utils/parseQuery.ts](../../app/api/utils/parseQuery.ts)：

- `kunParseGetQuery`
- `kunParsePostBody`
- `kunParsePutBody`
- `kunParseDeleteQuery`
- `kunParseFormData`

这些函数失败时返回字符串，成功时返回 schema data。调用处必须先判断 `typeof input === 'string'`。

[validations/dotenv-check.ts](../../validations/dotenv-check.ts) 会读取项目根目录 `.env` 并校验构建/运行必需变量。部分可选变量只在 [.env.example](../../.env.example) 和使用点体现，例如 `REDIS_PASSWORD`、`BANGUMI_ACCESS_TOKEN`、`GITHUB_REPO`、`GITHUB_TOKEN`。不要在测试、文档、issue 或 prompt 中复制真实 `.env` 值。

### 鉴权、CSRF 和角色

[middleware.ts](../../middleware.ts) 匹配：

- `/admin/:path*`
- `/user/:path*`
- `/comment/:path*`
- `/edit/:path*`
- `/api/((?!upload/).*)`

非 upload API 先过 `verifyKunCsrf`。状态变更请求必须带 `x-requested-with: kun-fetch`，并且 `origin` 或 `referer` 的 host 必须匹配 `NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV` / `NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD`。上传 API 在 handler 内自行校验，避免 middleware 缓冲大 body。页面路由使用 [middleware/auth.ts](../../middleware/auth.ts) 校验 `kun-galgame-patch-moe-token`，未登录跳转 `/login`。

常见角色约束：

- `role >= 3`：管理员。
- `role >= 4`：超级管理员。

### Redis、缓存和锁

[lib/redis.ts](../../lib/redis.ts) 统一封装 Redis：

- key 前缀：`kun:touchgal`。
- command timeout：2000ms。
- 支持单 key、多 key、pattern 删除、分布式锁、上传元数据消费锁。
- `getOrSet` 提供 envelope、fresh/stale、single-flight、refresh lock 和 TTL jitter。

[app/api/patch/cache.ts](../../app/api/patch/cache.ts) 定义 patch 相关 key 与失效函数：

- 内容：`patch:*`、`patch:introduction:*`。
- 列表：首页、游戏列表、排行、资源列表、标签游戏、公司游戏。
- 收藏状态：按用户和游戏缓存，并通过 version key 批量失效。

改动写入逻辑时必须同步检查缓存失效。常见写入后调用：

- `invalidatePatchContentCache(uniqueId)`
- `invalidatePatchListCaches()`
- `invalidateCompanyCaches(companyId)`
- `invalidateTagCaches()`
- `deletePatchResourceCache(uniqueId)`

### 上传和资源

上传分两步：

1. 上传 handler 写本地临时文件和 Redis metadata。
2. 业务提交时通过 `consumeUpload` 获取锁，上传 S3，事务完成后 `finalizeUpload`，失败时释放锁或补偿删除 S3。

关键文件：

- `app/api/upload/resource/route.ts`
- `app/api/upload/resourceUtils.ts`
- `app/api/patch/resource/_helper.ts`
- `lib/s3.ts`

审计日志必须脱敏资源链接、提取码、密码和 hash，可复用 `sanitizeResourceForAuditLog` / `sanitizeResourceLinksForAuditLog`。

### 内容和 MDX

`posts/` 是 MDX 内容源，`lib/mdx` 提供读取、目录树和自定义元素。`next.config.ts` 使用 `@next/mdx`，并允许 `.md`、`.mdx` page extensions。`postbuild` 会把 `posts` 复制到 standalone 产物。

### Cron 和任务

[server/cron.ts](../../server/cron.ts) 只负责启动任务并防止重复启动：

- `resetDailyTask`
- `setCleanupTask`
- `flushPatchViewsTask`

任务实现位于 `server/tasks/`。多个实例部署时需注意任务锁，已有 `withTaskLock.ts`。浏览量写入是 Redis buffer + 定时 flush：请求侧写 `app/api/patch/views/buffer.ts`，任务侧由 `flushPatchViewsTask` 每 2 分钟批量落库。

## 外部服务

| 服务 | 配置 |
| --- | --- |
| PostgreSQL | `KUN_DATABASE_URL` |
| Redis | `REDIS_HOST`、`REDIS_PORT`、`REDIS_PASSWORD` |
| Email | `KUN_VISUAL_NOVEL_EMAIL_*` |
| S3/image bed | `KUN_VISUAL_NOVEL_S3_*`、`NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL`、`KUN_VISUAL_NOVEL_IMAGE_BED_*` |
| Cloudflare cache purge | `KUN_CF_CACHE_ZONE_ID`、`KUN_CF_CACHE_PURGE_API_TOKEN` |
| IndexNow | `KUN_VISUAL_NOVEL_INDEX_NOW_KEY` |
| Bangumi | `BANGUMI_ACCESS_TOKEN` |
| GitHub release deploy | `GITHUB_REPO`、可选 `GITHUB_TOKEN` |

## 维护原则

- 新 API 先定义/复用 Zod schema，再写 route handler。
- DB 写入优先放到 service/helper，route handler 保持薄。
- 写入 patch、tag、company、resource 后必须明确缓存失效。
- 上传资源必须保留 Redis lock、S3 compensation、finalize/cleanup 语义。
- 角色和 CSRF 不能只依赖前端按钮隐藏。
- 部署构建允许跳过 Next 内置 lint/type validation，但发布前必须单独运行 `pnpm typecheck`，必要时运行 `pnpm test`。
