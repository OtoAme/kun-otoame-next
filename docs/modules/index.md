# Module Documentation Index

本文档是 OtoAme 的模块级导航。`docs/project/*` 说明如何运行、测试、部署和 review；`docs/modules/*` 说明代码按模块如何协作。

## 模块地图

| 模块 | 文档 | 主要路径 |
| --- | --- | --- |
| App Router 与页面 | [app-router.md](./app-router.md) | `app/*`, `components/*`, `store/*` |
| API 与业务服务 | [api-services.md](./api-services.md) | `app/api/*`, `validations/*`, `types/api/*` |
| 数据、缓存与上传 | [data-cache-upload.md](./data-cache-upload.md) | `prisma/*`, `lib/redis.ts`, `lib/s3.ts`, `app/api/upload/*` |
| 前端组件、主题与内容 | [frontend-content.md](./frontend-content.md) | `components/*`, `styles/*`, `lib/mdx/*`, `posts/*` |
| 运维、脚本、迁移与任务 | [operations.md](./operations.md) | `scripts/*`, `migration/*`, `server/tasks/*`, `.github/workflows/*` |
| 测试、验证与审阅 | [quality.md](./quality.md) | `tests/*`, `vitest.config.ts`, `.codex/skills/*` |

## 贡献者阅读路径

1. 新贡献者先读 [../project/development.md](../project/development.md)，完成本地启动。
2. 想改页面或组件，读 [app-router.md](./app-router.md) 和 [frontend-content.md](./frontend-content.md)。
3. 想改接口或业务规则，读 [api-services.md](./api-services.md)。
4. 想改 schema、缓存、上传、资源，读 [data-cache-upload.md](./data-cache-upload.md)。
5. 想改部署、脚本、迁移、定时任务，读 [operations.md](./operations.md)。
6. 提交前读 [quality.md](./quality.md) 和 [../project/review.md](../project/review.md)。

## 跨模块契约

- API 状态变更请求受 CSRF header + origin/referer host 校验；`/api/upload/*` 必须在 handler 内自行校验。
- Prisma schema 位于 `prisma/schema`，生产 schema 变更不能直接确认 reset database。
- Redis helper 会自动补 `kun:touchgal` 前缀；直接用 `redis` 的低层代码必须显式写完整 key 并说明原子性需求。
- Patch/resource/tag/company/favorite 写入后要同步缓存失效。
- Next standalone 运行时资源要同时出现在 `scripts/postbuild.ts` 和 release packaging。
- 新环境变量要同步 `validations/dotenv-check.ts`、`.env.example`、README、CI 或说明它只在可选功能中使用。

## Codex Skills

项目本地 skills 位于 `.codex/skills`：

- `otoame-development`：通用开发入口。
- `otoame-api`：API、route handler、service、validation、业务规则。
- `otoame-data-cache`：Prisma、Redis、缓存、上传、S3。
- `otoame-frontend`：页面、组件、stores、主题、MDX。
- `otoame-operations`：部署、脚本、迁移、任务、CI。
- `otoame-testing`：Vitest 测试。
- `otoame-review`：代码审阅。
- `otoame-deployment`：部署专项。

Skill 只保留触发条件、必读文档、关键规则和验证命令；具体业务细节以本目录和 `docs/project/*` 为准。
