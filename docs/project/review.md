# OtoAme Review Guide

本文档用于代码 review。重点不是格式，而是防止项目特定风险进入生产。

## 快速检查

Review 前先确认改动类型：

- 页面/UI
- API/service
- Prisma schema/data migration
- Redis/cache
- 上传/S3/resource
- 鉴权/CSRF/角色
- 部署/CI/build
- 文档/技能

按类型套用下面的检查项。模块细节见 [../modules/index.md](../modules/index.md)。

## 通用检查

- 改动是否集中在相关业务域，没有无关格式化或大范围重排。
- TypeScript 类型是否表达了真实数据形态，而不是靠 `any` 绕过。
- 新增环境变量是否同步 `.env.example`、README、CI。
- 构建期公开变量是否仅使用 `NEXT_PUBLIC_*`，服务端 secret 是否没有进入前端 bundle。
- 新增外部调用是否有超时、错误处理和服务端私密变量隔离。
- 用户输入是否走 Zod schema 或明确 normalize。
- 用户可见错误是否不会泄漏 token、资源链接、密码、提取码、hash。
- 测试是否覆盖新规则和 bug regression。

## API 和 service

- Route handler 是否只负责解析、鉴权、角色和响应。
- Service 是否封装业务写入、事务和副作用。
- `kunParse*` 返回字符串错误时是否立即返回。
- `verifyHeaderCookie` 或 JWT 校验是否存在。
- 管理功能是否校验 `role >= 3` 或 `role >= 4`。
- 非 upload API 是否受 middleware CSRF 覆盖；upload API 是否在 handler 内自行处理安全校验。
- 状态变更请求是否满足 `x-requested-with: kun-fetch` 和 origin/referer host 校验，新增豁免是否足够窄。
- `NextResponse.json` 返回语义是否符合现有调用端预期。

## Prisma 和数据

- 事务是否覆盖必须原子化的写入。
- `createMany` 是否需要 `skipDuplicates`。
- 计数器 increment/decrement 是否和关系增删一致。
- 删除前是否检查引用，尤其是 S3 object、资源链接、评论、收藏。
- `prisma:push` 是否足够；生产数据变更是否需要 preflight/sync SQL 或 dry-run。
- Prisma Client 生成是否纳入验证。

## Redis 和缓存

- 新 cache key 是否使用 `lib/redis.ts`，没有裸写未加前缀的 key。
- 如果直接用 `redis` / `runRedisCommand`，是否需要 Redis hash/Lua/multi 等低层能力，并显式写完整 key 前缀。
- TTL 是否合理，是否需要 jitter/stale 策略。
- 写入 patch、resource、tag、company、favorite 后是否调用对应失效函数。
- 批量删除是否控制数量，避免危险 scan 或阻塞。
- 锁是否用 token 释放，避免误删他人锁。

## 上传、资源和 S3

- 上传消费是否必须经过 `consumeUpload`。
- 上传 handler 是否保留角色、萌萌点、CAPTCHA、每日 5GB 配额和待审核资源限制。
- S3 上传成功后 DB 写失败是否补偿删除。
- 完成后是否 `finalizeUpload`，失败时是否记录足够上下文。
- 本地临时目录清理失败是否可由 cron 后续处理。
- 删除 S3 object 前是否确认没有其他 `patch_resource_link` 引用。
- 审计日志是否用 `sanitizeResourceForAuditLog` 或等价脱敏。

## 前端和组件

- Client component 是否只在确实需要 hook、事件或浏览器 API 时使用。
- Server action/API 调用是否处理 loading、错误和权限失败。
- 文案是否和 OtoAme 当前命名一致，避免回退到 TouchGal/GalGame 除非路径兼容需要。
- 移动端是否不会遮挡核心操作。
- 新图标优先用 lucide-react 或项目已有图标系统。

## 部署和 CI

- `KUN_DEPLOY_BUILD_SKIP_CHECKS=true` 是否只用于部署构建加速，不替代 `pnpm typecheck`。
- `postbuild.ts` 是否复制所有 standalone 运行时资源，并有 assert。
- Release packaging 是否同步复制新增 runtime 目录，并处理 `.next/server`、`.next/BUILD_ID`、Prisma schema 和 `server.mjs`。
- PM2 cwd、server.mjs/server.js 逻辑是否和产物一致。
- GitHub Actions 中的 `NEXT_PUBLIC_*` 是否只有公开变量。
- workflow 分支是否覆盖当前主分支和 PR。

## 文档和 skill

- 文档是否引用当前存在的源码路径、脚本名和命令。
- README、`docs/project/*`、`docs/modules/*` 是否对同一部署/API/cache 规则说法一致。
- `.codex/skills/*/SKILL.md` 的 frontmatter description 是否是触发条件，不是长流程摘要。
- Skill 是否只保留入口、规则和验证命令，详细知识是否回链到 docs。
- 新模块是否先更新现有 skill；只有出现新的独立工作流时才新增 skill。
- 每个代码提交后是否检查并同步了对应文档和 skill；重大行为、API、数据、缓存、部署、测试或工作流变更必须有同步更新。
- 文档 / skill 同步是否作为独立提交出现，没有和业务代码、测试或迁移改动混在同一个 commit 中。

## 测试要求

最低期待：

- Bugfix 有先失败后通过的 regression test。
- 纯函数有直接单元测试。
- API service 有 Prisma/cache mock 断言。
- Schema/cache/upload/deploy 类改动至少有说明为何不能自动测试，以及手动验证步骤。

常用命令：

```bash
pnpm test tests/unit/<target>.test.ts
pnpm test
pnpm typecheck
pnpm build
```

## Review 输出格式

建议按严重程度输出：

```text
Critical
- [file:line] 会导致数据丢失、权限绕过、生产不可启动的问题。

Important
- [file:line] 可能导致错误结果、缓存脏读、部署失败、缺测试。

Minor
- [file:line] 可维护性、命名、局部重复。

Questions
- 需要作者确认的假设。
```

如果没有发现问题，也要明确说明剩余风险，例如“未运行 `pnpm build`”或“上传流程只做了静态 review”。
