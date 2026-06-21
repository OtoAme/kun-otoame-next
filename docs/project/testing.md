# OtoAme Testing Guide

本文档记录当前项目测试策略和新增测试约定。

## 当前测试栈

- Runner：Vitest 4。
- 配置：[vitest.config.ts](../../vitest.config.ts)。
- 环境：`node`。
- 全局 API：`globals: true`。
- 路径别名：`~` 指向仓库根目录。
- Node：使用 22.15+，以匹配 Vitest 对 `vi.mock` / `vi.hoisted` 的 Node loader 要求和 CI 主版本环境。

运行：

```bash
pnpm test
pnpm test tests/unit/resource-link.test.ts
pnpm test tests/unit/api/batch-tag.test.ts
```

## 测试目录

```text
tests/unit/
  api/
  *.test.ts
```

现有覆盖重点：

- API service 逻辑：`tests/unit/api/*`。
- JWT session：`tests/unit/jwt-session.test.ts`。
- Redis 封装：`tests/unit/redis.test.ts`。
- 创建/重写 store 合并：`tests/unit/edit-store.test.ts`。
- 公司脏数据合并计划：`tests/unit/company-merge-plan.test.ts`。
- 搜索 store：`tests/unit/search-store.test.ts`。
- CAPTCHA：`tests/unit/captcha.test.ts`。
- 资源链接解析和资源分类：`tests/unit/resource-link.test.ts`、`resource-classification.test.ts`。
- 外部 ID、主题、标签等纯逻辑。

## 何时新增测试

必须新增或更新测试：

- API service 行为变更。
- 纯工具函数变更。
- Prisma 写入规则、计数器、缓存失效、权限判断变更。
- 资源链接、上传、下载、提取码、S3 补偿相关变更。
- CSRF、角色、资源归属、每日上传配额、用户设置权限相关变更。
- 主题 token、语义颜色、过滤器、排序、外部 ID 解析变更。
- 编辑页外部数据合并规则变更，包括 VNDB/Bangumi/Steam 字段保留、公司来源优先级、alias 公司匹配和 store 函数式合并。
- 维护脚本的自动合并计划变更，尤其是公司/tag 的 alias 冲突、歧义跳过、关系迁移和 count 预览。
- 修 bug 时要加能在修复前失败的 regression test。

可以暂不新增测试但要手动验证：

- 只改静态文案。
- 只改 README 或项目文档。
- 视觉微调且没有逻辑分支。

## 测试优先级

1. 纯函数优先：`utils/*`、`constants/*`、`validations/*`。
2. Service 次之：mock Prisma、Redis、外部 API，验证业务行为。
3. Route handler 最后：只有当 HTTP 解析、header、cookie、status 行为本身是风险点时再测。

## Vitest mock 模式

项目已有模式：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    patch_tag: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn()
    }
  }

  return {
    patch_tag: {
      findMany: vi.fn()
    },
    $transaction: vi.fn((fn) => fn(tx)),
    _tx: tx
  }
})

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))
```

使用 `vi.hoisted` 的原因是 `vi.mock` 会被 Vitest 提升，mock factory 不能依赖尚未初始化的普通变量。

## API service 测试约定

测试 service 时优先验证：

- 返回值。
- Prisma 查询条件和事务写入。
- 缓存失效函数是否被调用。
- 权限和边界条件。
- 输入去重、normalize、alias 匹配等业务规则。
- 外部数据合并优先级，例如 VNDB 公司优先、Bangumi 公司兜底、Bangumi 标签仍保留。
- 用户身份、角色阈值和 owner mismatch。

避免：

- 只验证 mock 被调用，没验证行为结果。
- mock 过深导致测试复制实现。
- 在单元测试里真实连接 PostgreSQL、Redis、S3、GitHub、Bangumi、VNDB。
- 为了让测试好写而把 API 权限判断移到前端。

## Redis 测试约定

Redis 相关逻辑分两类：

- key 生成、envelope、stale 逻辑：可单测纯逻辑或 mock `redis`。
- 真实 Redis 集成：只在明确需要时加集成测试，并隔离 key 前缀和 cleanup。

写缓存失效测试时，优先断言调用的是 `delKvPattern('业务前缀:*')` 或公开失效函数，而不是散落的低层 key。

直接使用 `redis` / `runRedisCommand` 的模块要单独检查 key 前缀和原子性，例如浏览量 buffer 使用 Redis hash 和 Lua，不能简单套 `setKv` 测试模式。

## Prisma/事务测试约定

mock transaction 需要模拟真实 Prisma transaction callback：

```ts
prismaMocks.$transaction.mockImplementation((fn) => fn(prismaMocks._tx))
```

事务测试要覆盖：

- create/update/delete 的顺序敏感行为。
- 计数器 increment/decrement。
- `skipDuplicates`。
- rollback 前的外部副作用补偿策略，尤其是上传和 S3。

## 上传和资源测试

资源相关至少覆盖：

- 链接解析和提取码合并。
- 上传 owner mismatch、already consuming、not found。
- S3 URL key 提取拒绝非本站 URL。
- DB 写失败后的 compensation。
- audit log 脱敏。
- 每日上传配额和创作者 CAPTCHA / 萌萌点限制。

已存在基础测试：[tests/unit/resource-link.test.ts](../../tests/unit/resource-link.test.ts)。

## 修 bug 的红绿流程

1. 写一个最小失败测试，名称描述用户可见行为。
2. 运行目标测试，确认失败原因是 bug，而不是测试拼写或 mock 缺失。
3. 写最小修复。
4. 运行目标测试确认通过。
5. 运行相关测试文件或全量 `pnpm test`。

示例命令：

```bash
pnpm test tests/unit/api/batch-tag.test.ts
pnpm test
pnpm typecheck
```

## 发布前验证矩阵

| 改动 | 最小验证 |
| --- | --- |
| 纯 utils | 目标测试 + `pnpm typecheck` |
| API service | 目标 API 测试 + `pnpm typecheck` |
| Prisma schema | `pnpm prisma:generate` 或 `pnpm prisma:push` + `pnpm typecheck` + `pnpm test` |
| Redis/cache | 目标测试 + 相关 API 测试 + `pnpm typecheck` |
| 上传/S3 | 目标测试 + 手动上传流程说明 + `pnpm typecheck` |
| Auth/CSRF/role | 目标 API/service 测试 + `pnpm typecheck` |
| Next config/postbuild/deploy | `pnpm typecheck` + 可行时 `pnpm build` |
| UI-only | `pnpm typecheck`，复杂交互加手动验证 |

## 已知缺口

- 当前没有 Playwright/E2E 配置。
- 多数 API route handler 没有 HTTP 层测试。
- 真实 PostgreSQL/Redis/S3 集成测试缺少统一 harness。
- `pnpm lint` 依赖 Next lint 命令；Next 15 项目如果命令不可用，需要迁移到 ESLint CLI 后再纳入强制验证。
