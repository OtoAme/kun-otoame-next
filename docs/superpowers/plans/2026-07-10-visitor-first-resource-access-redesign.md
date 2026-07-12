# 游客优先的资源获取重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 以资源条目为额度单位限制游客批量获取：一次额度换取该资源条目全部镜像的 24 小时访问权，点过的镜像刷新后自动恢复；当前不限制登录用户或创作者。

**Architecture:** 将资源条目的 24 小时授权和具体镜像的展示记录拆开。极简 patch_resource_access_grant 只保存 actor_key、resource_id、expires；现有 patch_resource_access 继续保存逐链接事件，并用 access_kind 区分首次 resource_grant 与后续 link_reveal。游客日/周额度只统计 resource_grant；Redis 只保留技术限频。资源列表只返回 obtained、obtainedExpiresAt、revealed 安全状态，刷新后通过私有 restore API 批量恢复点过的镜像，真实链接仍不进入初始页面数据。

**Tech Stack:** Next.js 15 App Router、React 19、Prisma 7/PostgreSQL、Redis/ioredis Lua（仅技术限频）、Zod、Vitest 4、HeroUI。

**Baseline:** 当前分支 `feature/resource-download-access` 已放弃未提交的旧 Phase 3 WIP，并还原到 Phase 2 提交 `0067c0e9` 的干净代码基线。旧 WIP 只作为已经完成的评审背景，不复制回实现；fiveHour、Redis 产品 quota、用户/创作者 shadow quota 与补丁 observe quota 从未进入本次实现。

## Global Constraints

- 初始页面数据、RSC payload、公开缓存和持久化客户端 store 不得包含真实 content、code 或 password；敏感字段只能存在于 private, no-store 的 access/restore 响应和组件内存状态。
- POST /api/patch/resource/download/access 的成功、业务错误、限频错误和校验错误都必须带 Cache-Control: private, no-store。
- 当前只强制限制 visitor + galgame；user、creator、owner、admin 与 patch 资源均不进入产品额度判断。
- 保留每个 actor 的 access API 技术限频：30 次/分钟；它不是产品额度，也不计入日/周次数。
- 游客产品额度固定为每日 5 个游戏资源条目、每周 20 个游戏资源条目，按 Asia/Shanghai 自然日和周一开始的自然周计算。
- 不再实现或保留 fiveHour 产品额度、用户/创作者 shadow quota、补丁资源 observe quota，或 visitor token 与 IP hash 的等额日/周双重硬限制。
- 不把旧 Phase 3 的 quota.ts、resource-access-quota.test.ts、旧 quota 响应类型或旧额度文档带入本分支；技术限频必须在测试先失败后独立实现。
- 产品层级固定为“游戏条目 → 资源条目 → 镜像链接”。首次点开资源条目的任意镜像创建 24 小时 resource grant 并消耗一次额度；期间全部镜像可访问，但只展示用户点过的镜像。
- 首次点开授权期内的另一条镜像只创建 link_reveal 事件，不消耗额度；重复点击同一镜像和刷新恢复都不写新事件。所有 link 事件的 expires 等于 resource grant 的 expires，点击镜像不延长授权。
- 刷新页面后自动恢复仍在 24 小时授权期内、且曾经点过的镜像；未点过的镜像继续隐藏。恢复走 private, no-store 的 POST API，真实 content、code、password 不进入资源列表或 RSC payload。
- visitor token 是 HTTP-only cookie 的主身份；IP hash 仅用于无 cookie 首次请求的 30 次/分钟 Redis 技术限频，不写入 DB、响应或日志，也不作为每日/每周产品配额。
- 游客额度是降低正常批量获取的摩擦，而不是对恶意访客的不可绕过身份限制：主动清除 visitor cookie 会获得一个新游客身份和新额度；不得用共享 IP 的日/周硬限额来弥补这一点。若未来确有持续绕过证据，另行设计登录门槛或风险控制。
- 成功响应仅在“游客新获取游戏资源条目”时携带 quota；新增镜像展示、重复查看、自动恢复、用户和 patch 资源均省略 quota。
- 不新增萌萌点扣费、流水、确认弹窗、刷新卡或登录用户产品限额。
- 现有 patch_resource_access 历史行不得删除；迁移后默认标记为 access_kind = link_reveal。新资源授权事件使用 resource_grant，只有它进入游客日/周额度统计。
- 生产 schema 变更必须先跑 preflight SQL；遇到 Prisma reset 提示必须取消。业务代码、测试、schema/migration 组成同一个实现变更集，不与文档和 skill 同步提交；任务中的 checkpoint commits 在合并前可按仓库约定 squash 为一个 implementation commit。

## File Map

| 路径 | 责任 |
| --- | --- |
| app/api/patch/resource/download/access/policy.ts | 纯产品策略：哪些 actor/resource 需要游客日/周额度。 |
| app/api/patch/resource/download/access/timeWindow.ts | Asia/Shanghai 日/周边界和 Retry-After 的纯时间计算。 |
| app/api/patch/resource/download/access/grant.ts | Serializable 事务、资源级授权、游客 DB 额度与并发重试。 |
| app/api/patch/resource/download/access/rateLimit.ts | 从干净 Phase 2 基线独立实现 Redis 30 次/分钟技术限频；不含产品额度。 |
| app/api/patch/resource/download/access/observability.ts | 只记录安全 outcome、actorType 与 section 的访问结果日志。 |
| app/api/patch/resource/download/access/response.ts | access/restore route 共用的 private, no-store JSON 和 visitor cookie 响应 helper。 |
| app/api/patch/resource/download/access/restore/service.ts | 只读恢复当前资源条目中已展示且仍有效的镜像。 |
| app/api/patch/resource/download/access/restore/route.ts | 私有 no-store 的批量恢复 HTTP 层，不创建 grant/event。 |
| app/api/patch/resource/download/access/actor.ts | 增加规范化 actorKey，保留 visitor token/IP hash/cookie 行为。 |
| app/api/patch/resource/download/access/service.ts | 查询可见 link，调用 grant service，返回单条敏感 link。 |
| app/api/patch/resource/download/access/route.ts | 薄 HTTP 层：解析、身份、技术限频、visibility、no-store 响应。 |
| app/api/patch/resource/get.ts | 返回资源级 obtained/expires 和逐链接 revealed 安全状态。 |
| prisma/schema/patch-resource.prisma | 新增极简 patch_resource_access_grant，并给 access event 增加 access_kind。 |
| types/api/patch.ts | 从 Phase 2 响应直接改为 access.kind、日/周游客 quota、revealed 与 restore 类型。 |
| components/patch/resource/ResourceDownload.tsx | 自动展开含已展示镜像的资源条目并批量恢复真实链接。 |
| components/patch/resource/DownloadCard.tsx | 渲染恢复/点选的单镜像和低压游客日额度提示。 |
| validations/patch.ts | 校验单链接 access 和资源级 restore 请求。 |
| tests/unit/api/resource-access-policy.test.ts | 产品策略和 Asia/Shanghai 时间边界的纯单元测试。 |
| tests/unit/api/resource-access-grant.test.ts | 授权复用、日/周额度、并发冲突重试和事件创建测试。 |
| tests/unit/api/resource-access-rate-limit.test.ts | Redis 技术限频、首个无 cookie 游客 IP 键和 Redis 故障 fail-open 回归。 |
| tests/unit/api/resource-access-restore.test.ts | 批量恢复只返回已展示镜像、无写入、no-store 与权限边界。 |
| tests/unit/api/resource-access.test.ts | route/list 的资源级 obtained、429、no-store 与技术限频回归。 |
| tests/unit/resource-download-card.test.tsx | 镜像复用说明、游客提示及错误反馈的组件测试。 |
| tests/unit/resource-download-restore.test.tsx | 刷新后自动展开、批量恢复点过镜像和失败降级。 |
| migration/production-resource-access-grant-preflight-2026-07-10.sql | 上线前检查旧 access 行、FK 和 backfill 候选。 |
| migration/production-resource-access-grant-sync-2026-07-10.sql | 可重入地新增表/列、索引、约束并回填仍有效授权。 |
| docs/modules/quality.md | 同步当前资源下载测试覆盖索引，移除 72 小时 Phase 2 现行描述。 |
| docs/modules/api-services.md、docs/modules/data-cache-upload.md、docs/modules/frontend-content.md、docs/project/testing.md | 与实际行为同步的模块文档和测试说明。 |
| posts/notice/download.mdx、posts/notice/start.mdx | 面向访客的次数、镜像复用和 FAQ 说明。 |

---

### Task 1: 固化游客优先策略与时间窗口

**Files:**

- Create: app/api/patch/resource/download/access/policy.ts
- Create: app/api/patch/resource/download/access/timeWindow.ts
- Create: tests/unit/api/resource-access-policy.test.ts

**Interfaces:**

- Produces: getResourceAccessPolicy(actorType, resourceKind)。
- Produces: getShanghaiQuotaWindows(now)，返回 dailyStart、weeklyStart、dailyResetAt、weeklyResetAt。
- Produces: 后续 grant service 可复用的 daily/weekly 常量和时区边界。
- Produces: RESOURCE_ACCESS_GRANT_MS = 24 * 60 * 60 * 1000。
- Future seam: 未来若要限制登录用户，只扩展 policy 并按 actor_type = user、user_id、section、access_kind = resource_grant 查询同一 event ledger；本次不预置用户限额或额外 Redis key。

- [ ] **Step 1: 写出失败的策略与时区测试**

~~~ts
import { describe, expect, it } from 'vitest'
import {
  getResourceAccessPolicy,
  RESOURCE_ACCESS_GRANT_MS,
  VISITOR_GAME_RESOURCE_DAILY_LIMIT,
  VISITOR_GAME_RESOURCE_WEEKLY_LIMIT
} from '~/app/api/patch/resource/download/access/policy'
import {
  getShanghaiQuotaWindows
} from '~/app/api/patch/resource/download/access/timeWindow'

describe('visitor-first resource access policy', () => {
  it('grants a resource entry for exactly 24 hours', () => {
    expect(RESOURCE_ACCESS_GRANT_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('only applies product quota to visitor galgame resources', () => {
    expect(getResourceAccessPolicy('visitor', 'galgame')).toEqual({
      productQuota: 'visitor',
      dailyLimit: VISITOR_GAME_RESOURCE_DAILY_LIMIT,
      weeklyLimit: VISITOR_GAME_RESOURCE_WEEKLY_LIMIT
    })
    expect(getResourceAccessPolicy('user', 'galgame')).toEqual({
      productQuota: 'none'
    })
    expect(getResourceAccessPolicy('visitor', 'patch')).toEqual({
      productQuota: 'none'
    })
  })

  it('uses Shanghai midnight and Monday as visitor quota boundaries', () => {
    const windows = getShanghaiQuotaWindows(
      new Date('2026-07-05T15:59:59.000Z')
    )
    expect(windows.dailyResetAt.toISOString()).toBe(
      '2026-07-05T16:00:00.000Z'
    )
    expect(windows.weeklyResetAt.toISOString()).toBe(
      '2026-07-05T16:00:00.000Z'
    )

    const newWeek = getShanghaiQuotaWindows(
      new Date('2026-07-05T16:00:00.000Z')
    )
    expect(newWeek.weeklyStart.toISOString()).toBe(
      '2026-07-05T16:00:00.000Z'
    )
    expect(newWeek.weeklyResetAt.toISOString()).toBe(
      '2026-07-12T16:00:00.000Z'
    )
  })
})
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: pnpm test tests/unit/api/resource-access-policy.test.ts

Expected: FAIL because policy.ts and timeWindow.ts do not exist.

- [ ] **Step 3: 实现无 Redis 依赖的策略和时间 helper**

~~~ts
// policy.ts
export const VISITOR_GAME_RESOURCE_DAILY_LIMIT = 5
export const VISITOR_GAME_RESOURCE_WEEKLY_LIMIT = 20
export const RESOURCE_ACCESS_GRANT_MS = 24 * 60 * 60 * 1000

export const getResourceAccessPolicy = (
  actorType: 'visitor' | 'user',
  resourceKind: 'galgame' | 'patch'
) =>
  actorType === 'visitor' && resourceKind === 'galgame'
    ? {
        productQuota: 'visitor' as const,
        dailyLimit: VISITOR_GAME_RESOURCE_DAILY_LIMIT,
        weeklyLimit: VISITOR_GAME_RESOURCE_WEEKLY_LIMIT
      }
    : { productQuota: 'none' as const }

// timeWindow.ts
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

const shanghaiUtc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day) - SHANGHAI_OFFSET_MS)

export const getShanghaiQuotaWindows = (now: Date) => {
  const shanghai = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  const day = shanghai.getUTCDay()
  const sinceMonday = day === 0 ? 6 : day - 1
  const dailyStart = shanghaiUtc(
    shanghai.getUTCFullYear(),
    shanghai.getUTCMonth(),
    shanghai.getUTCDate()
  )
  const weeklyStart = shanghaiUtc(
    shanghai.getUTCFullYear(),
    shanghai.getUTCMonth(),
    shanghai.getUTCDate() - sinceMonday
  )

  return {
    dailyStart,
    weeklyStart,
    dailyResetAt: new Date(dailyStart.getTime() + 24 * 60 * 60 * 1000),
    weeklyResetAt: new Date(weeklyStart.getTime() + 7 * 24 * 60 * 60 * 1000)
  }
}
~~~

- [ ] **Step 4: 运行策略测试和当前类型检查**

Run: pnpm test tests/unit/api/resource-access-policy.test.ts && pnpm typecheck

Expected: PASS。Phase 2 基线没有产品 quota 类型；本任务只新增纯策略与时间窗口，不引入 fiveHour、shadow、observe 或 Redis 产品额度。

- [ ] **Step 5: 提交代码和测试**

~~~bash
git add app/api/patch/resource/download/access/policy.ts app/api/patch/resource/download/access/timeWindow.ts tests/unit/api/resource-access-policy.test.ts
git commit -m "refactor(resource): define visitor-first access policy"
~~~

### Task 2: 新增资源级授权 schema 与可回滚的生产迁移

**Files:**

- Modify: prisma/schema/patch-resource.prisma
- Create: migration/production-resource-access-grant-preflight-2026-07-10.sql
- Create: migration/production-resource-access-grant-sync-2026-07-10.sql

**Interfaces:**

- Produces: patch_resource_access_grant，只保存 actor_key、resource_id、expires，并以 actor_key + resource_id 为复合主键。
- Produces: patch_resource_access.access_kind；旧行和额外镜像展示为 link_reveal，新额度事件为 resource_grant。
- Produces: 固定 cutoff/cutover 下，每个仍有效的旧 actor/resource/link 只规范化一条 canonical event 到资源 grant expires，保证迁移后刷新恢复一致。
- Produces: 不新增 revealed、revealed_link_ids、grant_id，刷新状态直接由现有 link access events 推导。

- [ ] **Step 1: 写 production preflight SQL**

~~~sql
SELECT current_setting('TimeZone') AS session_timezone;

WITH classified_access AS (
  SELECT
    *,
    CASE
      WHEN actor_type = 'visitor'
        AND user_id IS NULL
        AND visitor_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN 'valid_visitor'
      WHEN actor_type = 'user'
        AND user_id IS NOT NULL
        AND visitor_token = ''
        THEN 'valid_user'
      WHEN actor_type = 'user'
        AND user_id IS NULL
        AND visitor_token = ''
        THEN 'deleted_user'
      ELSE 'invalid'
    END AS identity_state
  FROM public.patch_resource_access
)
SELECT
  COUNT(*) FILTER (WHERE identity_state = 'invalid' AND actor_type = 'visitor') AS invalid_visitor_rows,
  COUNT(*) FILTER (WHERE identity_state = 'invalid' AND actor_type = 'user') AS invalid_user_rows,
  COUNT(*) FILTER (WHERE actor_type IS NULL OR actor_type NOT IN ('visitor', 'user')) AS invalid_actor_type_rows,
  COUNT(*) FILTER (WHERE identity_state = 'deleted_user') AS deleted_user_rows,
  COUNT(*) FILTER (
    WHERE identity_state IN ('valid_visitor', 'valid_user')
      AND expires > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
  ) AS active_legacy_rows,
  COALESCE(MAX(id), 0) AS legacy_max_id_candidate,
  CURRENT_TIMESTAMP AS legacy_cutover_at_candidate
FROM classified_access;

SELECT
  COUNT(*) AS invalid_relation_rows
FROM public.patch_resource_access pra
LEFT JOIN public.patch_resource_link link ON link.id = pra.link_id
LEFT JOIN public.patch_resource resource ON resource.id = pra.resource_id
WHERE link.id IS NULL
   OR resource.id IS NULL
   OR link.resource_id <> pra.resource_id
   OR resource.patch_id <> pra.patch_id;

WITH duplicate_event_groups AS (
  SELECT
    actor_type,
    CASE
      WHEN actor_type = 'user' AND user_id IS NOT NULL THEN 'user:' || user_id::text
      WHEN actor_type = 'visitor' THEN 'visitor:' || visitor_token
      ELSE 'deleted-user-row:' || id::text
    END AS actor_identity,
    resource_id,
    link_id,
    expires,
    COUNT(*) AS row_count
  FROM public.patch_resource_access
  GROUP BY 1, 2, 3, 4, 5
  HAVING COUNT(*) > 1
)
SELECT
  COUNT(*) AS historical_duplicate_event_groups,
  COALESCE(SUM(row_count - 1), 0) AS historical_extra_event_rows
FROM duplicate_event_groups;
~~~

preflight 必须同时盘点 schema 形态：`access_kind` 的类型、长度、nullability/default；grant 表三个字段的类型与 nullability；`actor_key + resource_id` 主键；resource FK 的 `ON DELETE CASCADE / ON UPDATE NO ACTION`；两个索引的完整定义及 `indisready / indisvalid`。首次运行未传 rollout 变量时输出当前 `legacy_max_id_candidate`、带时区的 `legacy_cutover_at_candidate`、预计需要规范化的 canonical link event 数量和最大延长量。传入固定的 `legacy_max_id` 与 `legacy_cutover_at` 后，所有数据检查必须只使用该 snapshot：grant 表存在时按合法身份聚合 cutover 时 active legacy access，统计缺失 grant 或 grant expires 短于历史最大 expires 的组数；同时按 actor/resource/link 验证至少一条 canonical event 的 expires 等于对应 grant expires。

Expected: invalid_visitor_rows = 0、invalid_user_rows = 0、invalid_actor_type_rows = 0、invalid_relation_rows = 0；否则停止上线并先修复数据。`deleted_user_rows` 是 `user_id ON DELETE SET NULL` 产生的合法审计 tombstone，只盘点、不回填，也绝不能折叠成 `visitor:` 身份。首次运行允许新 schema 对象显示 missing；sync 后再次运行时所有 schema 检查必须为 ok、索引必须 ready/valid、backfill 缺失或过短组数、canonical event 未对齐组数都必须为 0。historical_duplicate_event_groups 只做现状盘点：历史行统一归类为 link_reveal，不进入新额度，也不删除或去重；迁移只允许调整每个 active actor/resource/link 组一条 canonical event 的 expires/updated。记录 `session_timezone`；所有 active 窗口比较显式使用固定 cutover 转成的 UTC timestamp-without-time-zone 表达式，不依赖数据库会话时区。

- [ ] **Step 2: 扩展 Prisma schema**

~~~prisma
// 加到现有 patch_resource model 的 relation 列表
grants patch_resource_access_grant[] @relation("patch_resource_access_grant")

model patch_resource_access_grant {
  actor_key String   @db.VarChar(80)
  expires   DateTime

  resource_id Int
  resource    patch_resource @relation("patch_resource_access_grant", fields: [resource_id], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@id([actor_key, resource_id])
  @@index([expires], map: "resource_access_grant_expires_idx")
}

model patch_resource_access {
  // 保留现有字段
  access_kind String @default("link_reveal") @db.VarChar(20)

  @@index([actor_type, visitor_token, section, access_kind, created(sort: Desc)], map: "resource_access_visitor_kind_created_idx")
}
~~~

只在 patch_resource 模型增加 grants relation。actor_type、visitor_token、user_id、patch_id 和 section 均不复制到 grant 表：身份由 actor_key 表达，资源归属可由 resource_id 关联得到，额度审计继续以 patch_resource_access 为事实源。首轮保留既有 link-level access 索引，保证旧应用可回滚；新游客 count 只增加一条含 access_kind 的 visitor 复合索引。当前不限制登录用户，因此不预建 user quota 索引；未来若设计用户限额，再随独立方案评估。新索引在 Prisma 中显式 map 到与生产 SQL 相同的短名称，避免开发库 prisma:push 与生产 sync 产生两套索引。

- [ ] **Step 3: 编写带固定 legacy cutoff 的可重入 sync SQL 与 backfill**

~~~sql
-- 必须通过 psql 同时传入排空旧 writer 后固定的 legacy_max_id 和
-- legacy_cutover_at（带时区 ISO 时间）；sync 在变量缺失时立即失败。

\if :{?legacy_max_id}
\else
  \echo 'missing required psql variable: legacy_max_id'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif

\if :{?legacy_cutover_at}
\else
  \echo 'missing required psql variable: legacy_cutover_at'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif

SELECT
  :'legacy_cutover_at' ~* '(Z|[+-][0-9]{2}(:[0-9]{2})?)$' AS legacy_cutover_has_timezone
\gset
\if :legacy_cutover_has_timezone
\else
  \echo 'legacy_cutover_at must include Z or an explicit UTC offset'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif

SELECT :'legacy_max_id' ~ '^(0|[1-9][0-9]*)$' AS legacy_max_id_valid \gset
\if :legacy_max_id_valid
\else
  \echo 'legacy_max_id must be a non-negative integer'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif

-- 在任何 DDL/DML 前强制完成 bigint cast；溢出会因 ON_ERROR_STOP 立即退出。
SELECT :'legacy_max_id'::bigint AS validated_legacy_max_id;

-- 在任何 DDL/DML 前强制完成带时区时间解析并固定为 UTC timestamp。
SELECT
  :'legacy_cutover_at'::timestamptz AS validated_legacy_cutover_at,
  :'legacy_cutover_at'::timestamptz AT TIME ZONE 'UTC' AS legacy_cutover_at_utc;

SELECT
  COALESCE(MAX(id), 0) = :'legacy_max_id'::bigint AS legacy_cutoff_matches
FROM public.patch_resource_access \gset
\if :legacy_cutoff_matches
\else
  \echo 'legacy_max_id is stale; drain old writers and capture a new cutoff'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif

ALTER TABLE public.patch_resource_access
  ADD COLUMN IF NOT EXISTS access_kind VARCHAR(20) NOT NULL DEFAULT 'link_reveal';

CREATE TABLE IF NOT EXISTS public.patch_resource_access_grant (
  actor_key VARCHAR(80) NOT NULL,
  resource_id INTEGER NOT NULL REFERENCES public.patch_resource(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  expires TIMESTAMP(3) NOT NULL,
  PRIMARY KEY (actor_key, resource_id)
);

WITH active_access AS (
  SELECT DISTINCT ON (
    CASE
      WHEN actor_type = 'user' THEN 'user:' || user_id::text
      WHEN actor_type = 'visitor' THEN 'visitor:' || visitor_token
    END,
    resource_id
  )
    CASE
      WHEN actor_type = 'user' THEN 'user:' || user_id::text
      WHEN actor_type = 'visitor' THEN 'visitor:' || visitor_token
    END AS actor_key,
    resource_id,
    expires
  FROM public.patch_resource_access
  WHERE id <= :'legacy_max_id'::bigint
    AND expires > (:'legacy_cutover_at'::timestamptz AT TIME ZONE 'UTC')
    AND (
      (actor_type = 'user' AND user_id IS NOT NULL AND visitor_token = '')
      OR (
        actor_type = 'visitor'
        AND user_id IS NULL
        AND visitor_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    )
  ORDER BY
    CASE
      WHEN actor_type = 'user' THEN 'user:' || user_id::text
      WHEN actor_type = 'visitor' THEN 'visitor:' || visitor_token
    END,
    resource_id,
    expires DESC,
    id DESC
)
INSERT INTO public.patch_resource_access_grant (
  actor_key, resource_id, expires
)
SELECT actor_key, resource_id, expires
FROM active_access
ON CONFLICT (actor_key, resource_id)
DO UPDATE SET
  expires = EXCLUDED.expires
WHERE patch_resource_access_grant.expires < EXCLUDED.expires;

-- 对每个 cutover 时仍 active 的 actor/resource/link 组，只规范化一条
-- expires DESC、id DESC 的 canonical event，使刷新恢复覆盖完整 grant 周期。
WITH canonical_legacy_event AS (
  SELECT DISTINCT ON (actor_key, resource_id, link_id)
    id,
    grant_expires
  FROM (
    SELECT
      access.id,
      CASE
        WHEN access.actor_type = 'user' THEN 'user:' || access.user_id::text
        WHEN access.actor_type = 'visitor' THEN 'visitor:' || access.visitor_token
      END AS actor_key,
      access.resource_id,
      access.link_id,
      access.expires,
      resource_grant.expires AS grant_expires
    FROM public.patch_resource_access access
    JOIN public.patch_resource_access_grant resource_grant
      ON resource_grant.actor_key = CASE
        WHEN access.actor_type = 'user' THEN 'user:' || access.user_id::text
        WHEN access.actor_type = 'visitor' THEN 'visitor:' || access.visitor_token
      END
     AND resource_grant.resource_id = access.resource_id
    WHERE access.id <= :'legacy_max_id'::bigint
      AND access.expires > (:'legacy_cutover_at'::timestamptz AT TIME ZONE 'UTC')
      AND (
        (access.actor_type = 'user' AND access.user_id IS NOT NULL AND access.visitor_token = '')
        OR (
          access.actor_type = 'visitor'
          AND access.user_id IS NULL
          AND access.visitor_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      )
  ) eligible
  ORDER BY actor_key, resource_id, link_id, expires DESC, id DESC
)
UPDATE public.patch_resource_access access
SET
  expires = canonical.grant_expires,
  updated = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM canonical_legacy_event canonical
WHERE access.id = canonical.id
  AND access.expires < canonical.grant_expires;

CREATE INDEX CONCURRENTLY IF NOT EXISTS resource_access_grant_expires_idx
  ON public.patch_resource_access_grant (expires);

CREATE INDEX CONCURRENTLY IF NOT EXISTS resource_access_visitor_kind_created_idx
  ON public.patch_resource_access (
    actor_type,
    visitor_token,
    section,
    access_kind,
    created DESC
  );
~~~

sync 在任何写入前必须校验 `legacy_max_id` 已提供、是非负整数、可转换为 bigint，并且等于排空旧 writer 后当前的 `COALESCE(MAX(id), 0)`；`legacy_cutover_at` 必须存在、显式包含 `Z` 或 UTC offset，且可解析为带时区时间。随后断言既有同名列、表、主键和 FK 的形态与目标一致。PostgreSQL 18 的 `psql` 不支持 `\quit 3`；所有错误分支必须在 `ON_ERROR_STOP` 下触发 SQL error，使脚本可靠返回 3，并且错误必须发生在首个 DDL/DML 前。SQL 别名不得使用未引号的 `grant` 关键字。`IF NOT EXISTS` 不能掩盖类型、默认值或约束漂移。创建索引前应检测并清理同名的 invalid/not-ready index：条件判断和 `DROP INDEX CONCURRENTLY` 必须是 psql 控制下的顶层语句，不能放进 `DO`、函数或事务块；合法但定义不符的同名对象必须显式失败，不得静默跳过。索引使用单独的 `CREATE INDEX CONCURRENTLY IF NOT EXISTS`，sync 文件不得包在显式事务中。

历史 access 行通过列默认值成为 link_reveal，不需要为 access_kind 逐行 UPDATE，也不进入新游客日/周 count。backfill 只处理固定 `legacy_max_id` 以内、身份完整且在固定 `legacy_cutover_at` 仍有效的旧行；deleted-user tombstone 和非法身份不创建 grant。grant 保留同资源旧行的最晚 expires，即使长于新规则的 24 小时也不追溯缩短。为满足“grant 期内刷新恢复已点镜像”，每个 actor/resource/link 组只选择 `expires DESC, id DESC` 的一条 canonical event，把它的 expires 对齐到 grant expires，并同步 updated；created、actor、resource、link、cost、access_kind 和其他重复审计行都不修改。preflight 必须报告预计规范化行数与最大延长量，生产先备份。冲突更新和 canonical event 更新都只在现值更短时发生，因此使用同一 cutoff/cutover 重跑必须是零实际更新；同一次 rollout 进入新应用运行期后不得扩大 snapshot。若回滚到会继续写 72 小时旧 event 的 Phase 2 应用，下一次 rollout 必须重新排空旧 writer、重新 preflight，并建立新的最终 cutoff/cutover。sync 后运行 preflight/postflight，证明 schema、索引、grant backfill 和 canonical event 对齐全部达到目标形态。

本轮明确不增加逐链接 partial unique index。PostgreSQL Serializable 事务会为“先查询同 actor + resource + link 的 active event、再插入”建立谓词读依赖；同一授权周期内并发首次点开同一镜像时，其中一个正常事务会以序列化冲突失败并重试。grant 的 actor_key + resource_id 主键则负责首次资源授权竞态。额外 partial unique index 会要求先定义并清理历史重复组、用 Prisma 无法表达的 WHERE 索引维护开发/生产一致性，并扩大回滚面；当前收益不足以覆盖这些成本。

这一选择的幂等边界是：所有新 access event 必须只由 Task 3 的 Serializable 写事务创建。绕过该 service 的 SQL、脚本或未来新 writer 不受应用层保障；新增 writer 前必须复用同一事务，或另立带 preflight、历史去重和生产 sync 的 partial-index 迁移。Task 3 用冲突重试测试覆盖应用契约，Task 7 再以真实 PostgreSQL 并发验收确认 SSI 行为；restore 对历史重复行继续按 link.id 去重。

- [ ] **Step 4: 生成 Prisma Client，不执行生产 push**

Run: pnpm prisma:generate && pnpm exec prisma validate --schema prisma/schema && pnpm typecheck

Expected: PASS。开发库允许在确认没有 reset 时执行 pnpm prisma:push；生产结构变更必须先执行 preflight/sync 并确认 Prisma diff 为空，不能用裸 push 代替迁移步骤。

- [ ] **Step 5: 记录开发库的 migration 验证**

Run: pnpm prisma:push

Expected: PASS 且没有 reset 提示；若提示 reset，立即取消并检查 schema 和 sync SQL。在开发库执行 sync 后，再运行 `pnpm exec prisma migrate diff --exit-code --from-config-datasource --to-schema=prisma/schema`，必须退出 0，证明生产 SQL 与 Prisma schema 无漂移。生产部署脚本仍会调用 `pnpm prisma:push`，因此上线前必须先执行 sync 并确认该 diff 为空，让后续 push 成为严格 no-op；不能把“生产只运行 sync SQL”当成当前部署脚本已经具备的能力。

- [ ] **Step 6: 提交 schema、migration 与生成所需源码**

~~~bash
git add prisma/schema/patch-resource.prisma migration/production-resource-access-grant-preflight-2026-07-10.sql migration/production-resource-access-grant-sync-2026-07-10.sql
git commit -m "feat(resource): add resource access grants"
~~~

### Task 3: 实现资源级授权和游客 DB 额度事务

**Files:**

- Create: app/api/patch/resource/download/access/grant.ts
- Modify: app/api/patch/resource/download/access/actor.ts
- Create: tests/unit/api/resource-access-grant.test.ts

**Interfaces:**

- Produces: getResourceAccessActorKey(actor) 和 getResourceAccessViewerKey(viewer)。
- Produces: getResourceAccessActorWhere(actor) 和 getResourceAccessViewerWhere(viewer)；grant、列表和 restore 共用这套身份条件，viewer 没有用户或游客身份时返回 null。
- Produces: getResourceAccessIpHash(req)；IP hash 只供 Task 6 首次无 Cookie 的技术限频使用，不进入 grant/event、响应或日志。
- Produces: resolveResourceAccessGrant(input)，返回 resource_granted、link_revealed、reused 或 limited。
- Consumes: actor、patchId、resourceId、linkId、storage、section、now。

- [ ] **Step 1: 写失败的 grant service 测试**

~~~ts
it('records the first reveal of another mirror without product quota', async () => {
  prismaMocks.$transaction.mockImplementation(async (callback) =>
    callback(prismaMocks.tx)
  )
  prismaMocks.tx.patch_resource_access_grant.findUnique.mockResolvedValue({
    actor_key: 'visitor:123e4567-e89b-42d3-a456-426614174000',
    resource_id: 11,
    expires: new Date('2026-07-11T00:00:00.000Z')
  })
  prismaMocks.tx.patch_resource_access.findFirst.mockResolvedValue(null)

  const result = await resolveResourceAccessGrant({
    actor: visitorActor,
    patchId: 7,
    resourceId: 11,
    linkId: 22,
    storage: 'user',
    section: 'galgame',
    now: new Date('2026-07-10T00:00:00.000Z')
  })

  expect(result).toMatchObject({
    kind: 'link_revealed',
    expires: new Date('2026-07-11T00:00:00.000Z')
  })
  expect(prismaMocks.tx.patch_resource_access.count).not.toHaveBeenCalled()
  expect(prismaMocks.tx.patch_resource_access.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      link_id: 22,
      access_kind: 'link_reveal',
      expires: new Date('2026-07-11T00:00:00.000Z')
    })
  })
})

it('reuses an already revealed mirror without another write', async () => {
  prismaMocks.$transaction.mockImplementation(async (callback) =>
    callback(prismaMocks.tx)
  )
  prismaMocks.tx.patch_resource_access_grant.findUnique.mockResolvedValue({
    actor_key: 'visitor:123e4567-e89b-42d3-a456-426614174000',
    resource_id: 11,
    expires: new Date('2026-07-11T00:00:00.000Z')
  })
  prismaMocks.tx.patch_resource_access.findFirst.mockResolvedValue({ id: 31 })

  const result = await resolveResourceAccessGrant({
    actor: visitorActor,
    patchId: 7,
    resourceId: 11,
    linkId: 22,
    storage: 'user',
    section: 'galgame',
    now: new Date('2026-07-10T00:00:00.000Z')
  })

  expect(result).toMatchObject({ kind: 'reused' })
  expect(prismaMocks.tx.patch_resource_access.create).not.toHaveBeenCalled()
})

it('blocks a sixth visitor resource grant on the same Shanghai day', async () => {
  prismaMocks.$transaction.mockImplementation(async (callback) =>
    callback(prismaMocks.tx)
  )
  prismaMocks.tx.patch_resource_access_grant.findUnique.mockResolvedValue(null)
  prismaMocks.tx.patch_resource_access.count
    .mockResolvedValueOnce(5)
    .mockResolvedValueOnce(5)

  const result = await resolveResourceAccessGrant({
    actor: visitorActor,
    patchId: 7,
    resourceId: 12,
    linkId: 23,
    storage: 'user',
    section: 'galgame',
    now: new Date('2026-07-10T02:00:00.000Z')
  })

  expect(result).toMatchObject({
    kind: 'limited',
    window: 'daily',
    remaining: { daily: 0, weekly: 15 }
  })
})
~~~

再添加以下测试：新游客授权的 expires 精确等于 now + 24h 并创建 access_kind = resource_grant 的 event；游客 count 的 where 固定含 section = galgame 和 access_kind = resource_grant；登录用户创建授权但不 count；weekly 第 21 个资源条目被拦截，daily 与 weekly 同时满时 daily 优先；过期 grant 走 update 并创建新的 resource_grant event；三次可重试冲突耗尽后抛 ResourceAccessGrantBusyError；active grant 下同一新镜像的并发 link_reveal 发生 P2034 后重读并返回 reused；active grant 下不同镜像各写一条 link_reveal；无 grant 时同资源同镜像并发由一个请求创建 resource_grant、另一个重试后 reused；无 grant 时同资源不同镜像并发由一个请求创建 resource_grant、另一个重试后创建 link_reveal；legacy event 虽仍 active 但 expires 短于 grant 时不能 reused，必须补一条对齐 grant expires 的 link_reveal。

再覆盖同一游客并发获取两个不同资源的额度边界：daily 已用 4 或 weekly 已用 19 时，第一个事务允许，第二个事务注入真实 P2034 后从事务起点重试；重读 count 达到 5/20 时返回对应 limited，且重试后的 limited callback 不再调用 grant/event create。P2002/P2034 mock 必须使用真实 `Prisma.PrismaClientKnownRequestError`（含 code 与当前 clientVersion），不能用普通带 code 的 Error 冒充 `instanceof`。单元测试只证明冲突后会重新读取并给出正确分类，不用 mock create 调用次数声称事务回滚或 PostgreSQL 最终落库数量；最终唯一性由 Task 7 真实并发验收。

再用真实 NextRequest/Headers 增加四项 actor 测试：设置测试 JWT_SECRET 后，首次无 Cookie 请求从 x-forwarded-for 生成精确的 domain-separated HMAC，且不等于原始 IP；带有效 visitor cookie 的请求 ipHash 为空；登录用户 ipHash 为空；JWT_SECRET 缺失时首次游客 ipHash 也为空。测试结束恢复原环境变量。Task 6 的 rate-limit 测试再证明只有首种且 hash 非空的 actor 会使用 visitor-ip key，且 Redis 参数和日志都不含原始 IP。

- [ ] **Step 2: 运行 grant 测试确认失败**

Run: pnpm test tests/unit/api/resource-access-grant.test.ts

Expected: FAIL because grant.ts、actorKey 和 resource-level grant transaction 尚不存在。

- [ ] **Step 3: 在 Phase 2 actor 上增加 IP hash 与统一身份 helper**

~~~ts
import { createHmac, randomUUID } from 'crypto'
import { getRemoteIp } from '~/app/api/utils/getRemoteIp'
import type { Prisma } from '@prisma/client'

export type ResourceAccessActor =
  | {
      actorType: 'user'
      uid: number
      visitorToken: ''
      ipHash: string
      shouldSetVisitorCookie: false
    }
  | {
      actorType: 'visitor'
      uid: 0
      visitorToken: string
      ipHash: string
      shouldSetVisitorCookie: boolean
    }

const hashResourceAccessIp = (ip: string) => {
  const secret = process.env.JWT_SECRET
  return secret
    ? createHmac('sha256', secret).update(`resource-access:${ip}`).digest('hex')
    : ''
}

export const getResourceAccessIpHash = (req: NextRequest) => {
  const ip = getRemoteIp(req.headers)
  return ip ? hashResourceAccessIp(ip) : ''
}

export const getResourceAccessActor = (
  req: NextRequest,
  uid: number
): ResourceAccessActor => {
  if (uid > 0) {
    return {
      actorType: 'user',
      uid,
      visitorToken: '',
      ipHash: '',
      shouldSetVisitorCookie: false
    }
  }

  const existingVisitorToken = getResourceAccessVisitorToken(req)
  if (existingVisitorToken) {
    return {
      actorType: 'visitor',
      uid: 0,
      visitorToken: existingVisitorToken,
      ipHash: '',
      shouldSetVisitorCookie: false
    }
  }

  return {
    actorType: 'visitor',
    uid: 0,
    visitorToken: randomUUID(),
    ipHash: getResourceAccessIpHash(req),
    shouldSetVisitorCookie: true
  }
}

export const getResourceAccessActorKey = (actor: ResourceAccessActor) =>
  actor.actorType === 'user'
    ? 'user:' + actor.uid
    : 'visitor:' + actor.visitorToken

export const getResourceAccessViewerKey = (
  viewer: ResourceAccessViewer
) =>
  viewer.uid > 0
    ? 'user:' + viewer.uid
    : viewer.visitorToken
      ? 'visitor:' + viewer.visitorToken
      : null

export const getResourceAccessActorWhere = (
  actor: ResourceAccessActor
): Prisma.patch_resource_accessWhereInput =>
  actor.actorType === 'user'
    ? { actor_type: 'user', user_id: actor.uid }
    : { actor_type: 'visitor', visitor_token: actor.visitorToken }

export const getResourceAccessViewerWhere = (
  viewer: ResourceAccessViewer
): Prisma.patch_resource_accessWhereInput | null =>
  viewer.uid > 0
    ? { actor_type: 'user', user_id: viewer.uid }
    : viewer.visitorToken
      ? { actor_type: 'visitor', visitor_token: viewer.visitorToken }
      : null
~~~

保留 Phase 2 已有的 visitor token 校验、Cookie 读取和 Cookie 写入函数。只有“未登录且请求中没有有效 visitor cookie”的分支计算 IP hash；登录用户和已有 visitor cookie 的游客必须得到空 ipHash。JWT_SECRET 缺失时不生成 IP hash，首次请求退回新 visitor token 技术限频，不能用空 key 或无密钥 hash。不要给 actor 增加 role，也不要把 IP hash 写入 actorKey、grant 表或产品额度查询；它不是稳定的用户身份。getResourceAccessViewerKey 和 getResourceAccessViewerWhere 必须对无身份 viewer 同时返回 null，调用方不得展开 null。Task 3 使用 policy.ts 的 RESOURCE_ACCESS_GRANT_MS；actor.ts 旧的 RESOURCE_ACCESS_REUSE_MS 暂时留给尚未改造的 Phase 2 service，Task 4 切换完成后删除。

- [ ] **Step 4: 用 Serializable 事务实现 grant**

~~~ts
import { Prisma } from '@prisma/client'
import { setTimeout as wait } from 'node:timers/promises'
import { prisma } from '~/prisma/index'
import {
  getResourceAccessPolicy,
  RESOURCE_ACCESS_GRANT_MS
} from './policy'
import { getShanghaiQuotaWindows } from './timeWindow'
import {
  getResourceAccessActorKey,
  getResourceAccessActorWhere
} from './actor'
import type { ResourceAccessActor } from './actor'

const RESOURCE_ACCESS_GRANT_RETRY_COUNT = 3
const RESOURCE_ACCESS_GRANT_RETRY_BASE_DELAY_MS = 50

type GrantInput = {
  actor: ResourceAccessActor
  patchId: number
  resourceId: number
  linkId: number
  storage: string
  section: 'galgame' | 'patch'
  now: Date
}

type VisitorQuotaPayload = {
  scope: 'visitor'
  resourceKind: 'galgame'
  remaining: { daily: number; weekly: number }
  resetsAt: { daily: string; weekly: string }
}

type VisitorQuotaCheck =
  | { allowed: true; quota?: VisitorQuotaPayload }
  | {
      allowed: false
      window: 'daily' | 'weekly'
      retryAfterSeconds: number
      remaining: { daily: number; weekly: number }
      resetsAt: { daily: string; weekly: string }
    }

const buildAccessEventCreateData = (input: GrantInput) => ({
  actor_type: input.actor.actorType,
  user_id: input.actor.actorType === 'user' ? input.actor.uid : null,
  visitor_token:
    input.actor.actorType === 'visitor' ? input.actor.visitorToken : '',
  patch_id: input.patchId,
  resource_id: input.resourceId,
  link_id: input.linkId,
  section: input.section,
  storage: input.storage,
  cost: 0,
  created: input.now
})

const checkVisitorResourceQuota = async (
  tx: Prisma.TransactionClient,
  input: GrantInput
): Promise<VisitorQuotaCheck> => {
  const policy = getResourceAccessPolicy(input.actor.actorType, input.section)
  if (policy.productQuota === 'none' || input.actor.actorType !== 'visitor') {
    return { allowed: true }
  }

  const windows = getShanghaiQuotaWindows(input.now)
  const actorWhere = getResourceAccessActorWhere(input.actor)
  const baseWhere = {
    ...actorWhere,
    section: 'galgame',
    access_kind: 'resource_grant'
  } satisfies Prisma.patch_resource_accessWhereInput
  const [dailyUsed, weeklyUsed] = await Promise.all([
    tx.patch_resource_access.count({
      where: { ...baseWhere, created: { gte: windows.dailyStart } }
    }),
    tx.patch_resource_access.count({
      where: { ...baseWhere, created: { gte: windows.weeklyStart } }
    })
  ])
  const currentRemaining = {
    daily: Math.max(0, policy.dailyLimit - dailyUsed),
    weekly: Math.max(0, policy.weeklyLimit - weeklyUsed)
  }
  const resetsAt = {
    daily: windows.dailyResetAt.toISOString(),
    weekly: windows.weeklyResetAt.toISOString()
  }

  if (dailyUsed >= policy.dailyLimit) {
    return {
      allowed: false,
      window: 'daily',
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(
          (windows.dailyResetAt.getTime() - input.now.getTime()) / 1000
        )
      ),
      remaining: currentRemaining,
      resetsAt
    }
  }

  if (weeklyUsed >= policy.weeklyLimit) {
    return {
      allowed: false,
      window: 'weekly',
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(
          (windows.weeklyResetAt.getTime() - input.now.getTime()) / 1000
        )
      ),
      remaining: currentRemaining,
      resetsAt
    }
  }

  return {
    allowed: true,
    quota: {
      scope: 'visitor',
      resourceKind: 'galgame',
      remaining: {
        daily: currentRemaining.daily - 1,
        weekly: currentRemaining.weekly - 1
      },
      resetsAt
    }
  }
}

const isRetryableGrantConflict = (error: unknown) =>
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2002' || error.code === 'P2034')) ||
  (error instanceof Error &&
    error.name === 'DriverAdapterError' &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    (error.cause as { kind?: unknown }).kind === 'TransactionWriteConflict' &&
    (error.cause as { originalCode?: unknown }).originalCode === '40001')

export class ResourceAccessGrantBusyError extends Error {}

export const resolveResourceAccessGrant = async (input: GrantInput) => {
  for (let attempt = 0; attempt < RESOURCE_ACCESS_GRANT_RETRY_COUNT; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const actorKey = getResourceAccessActorKey(input.actor)
          const current = await tx.patch_resource_access_grant.findUnique({
            where: {
              actor_key_resource_id: {
                actor_key: actorKey,
                resource_id: input.resourceId
              }
            }
          })

          if (current && current.expires > input.now) {
            const revealed = await tx.patch_resource_access.findFirst({
              where: {
                ...getResourceAccessActorWhere(input.actor),
                resource_id: input.resourceId,
                link_id: input.linkId,
                expires: { gte: current.expires }
              },
              select: { id: true }
            })

            if (revealed) {
              return { kind: 'reused' as const, expires: current.expires }
            }

            await tx.patch_resource_access.create({
              data: {
                ...buildAccessEventCreateData(input),
                access_kind: 'link_reveal',
                expires: current.expires
              }
            })

            return { kind: 'link_revealed' as const, expires: current.expires }
          }

          const quotaCheck = await checkVisitorResourceQuota(tx, input)
          if (!quotaCheck.allowed) {
            const { allowed: _allowed, ...limited } = quotaCheck
            return { kind: 'limited' as const, ...limited }
          }

          const expires = new Date(input.now.getTime() + RESOURCE_ACCESS_GRANT_MS)
          const grant = current
            ? await tx.patch_resource_access_grant.update({
                where: {
                  actor_key_resource_id: {
                    actor_key: actorKey,
                    resource_id: input.resourceId
                  }
                },
                data: { expires }
              })
            : await tx.patch_resource_access_grant.create({
                data: {
                  actor_key: actorKey,
                  resource_id: input.resourceId,
                  expires
                }
              })

          await tx.patch_resource_access.create({
            data: {
              ...buildAccessEventCreateData(input),
              access_kind: 'resource_grant',
              expires
            }
          })

          return {
            kind: 'resource_granted' as const,
            expires: grant.expires,
            ...(quotaCheck.quota ? { quota: quotaCheck.quota } : {})
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    } catch (error) {
      if (!isRetryableGrantConflict(error)) {
        throw error
      }
      if (attempt === RESOURCE_ACCESS_GRANT_RETRY_COUNT - 1) {
        throw new ResourceAccessGrantBusyError()
      }
      await wait(RESOURCE_ACCESS_GRANT_RETRY_BASE_DELAY_MS * 2 ** attempt)
    }
  }

  throw new ResourceAccessGrantBusyError()
}
~~~

首次资源授权写 resource_grant；授权期内首次点开另一镜像写 link_reveal，且 expires 必须复用 current.expires，不能从镜像点击时重新计算 24 小时。已有镜像只有在至少一条 event 的 expires 覆盖完整 current grant 周期时才返回 reused；仅仅 `expires > now` 不够。若迁移遗漏、异常数据或旧短 event 未覆盖 current.expires，则写一条对齐 current.expires 的 link_reveal 并返回 link_revealed，作为 Task 2 canonical 迁移之外的运行时自愈。checkVisitorResourceQuota 只在 visitor + galgame 时运行两条 count 查询，where 固定包含 actor_type = visitor、visitor_token、section = galgame、access_kind = resource_grant、created >= dailyStart 或 weeklyStart。第 5 次允许并返回 remaining.daily = 0；第 6 次返回 daily limited；周窗口同理。两个窗口同时已满时按 daily 优先。用户（包括 creator、owner、admin）与 patch 资源返回 allowed: true 且不带 quota，也不执行产品 count。

- [ ] **Step 5: 保证并发冲突不会多扣额度**

grant 复合主键冲突 P2002 和序列化冲突 P2034 都从事务起点重试，并重新读取 grant 与当前 link event。准确语义是：

- 同资源、同镜像并发且尚无 grant：一个事务创建 resource_grant，另一个重试后发现该镜像已有 active event，返回 reused。
- 同资源、不同镜像并发且尚无 grant：一个事务创建 resource_grant，另一个重试后复用 active grant，并为自己请求的另一镜像创建 link_reveal。
- 已有 active grant 时并发首次点开同一镜像：Serializable 谓词冲突使一个事务 P2034，重试后返回 reused；不得留下两条 link_reveal。
- 已有 active grant 时并发首次点开不同镜像：两个事务可各创建一条合法的 link_reveal，不互相覆盖，也不延长 expires。
- 同一游客在日/周临界值并发获取两个不同资源：Serializable 必须使至少一个事务冲突重试；重试后重新 count，超限请求返回 limited，不能出现 daily 第 6 个或 weekly 第 21 个 resource_grant。

事务内的 quota count、grant create/update 和 access event create 必须同生同灭；刷新恢复不调用该写事务。Prisma Client 的 P2002/P2034 与 Prisma 7 adapter 直接暴露的 `DriverAdapterError`（`TransactionWriteConflict`、PostgreSQL SQLSTATE `40001`）均从事务起点重试；前两次冲突后在事务外分别退避 50 ms、100 ms，第三次仍无法完成时抛出 ResourceAccessGrantBusyError。单元测试覆盖两种错误形态和退避顺序；Task 7 在开发或预发布 PostgreSQL 上发真实并发请求，验证 SSI，而不是把 mock 测试当成数据库语义证明。

- [ ] **Step 6: 运行 grant 测试**

Run: pnpm test tests/unit/api/resource-access-grant.test.ts

Expected: PASS；测试应显式断言 24 小时固定到首次资源条目获取、额外镜像只写一次 link_reveal、只有覆盖完整 grant 周期的 event 才 reused、游客 daily/weekly 边界与优先级、过期 grant update、三次冲突耗尽、登录用户无 count，以及同/不同资源、同/不同镜像在真实 P2002/P2034 错误重试后的准确 event 分类。

- [ ] **Step 7: 提交事务服务和测试**

~~~bash
git add app/api/patch/resource/download/access/actor.ts app/api/patch/resource/download/access/grant.ts tests/unit/api/resource-access-grant.test.ts
git commit -m "feat(resource): grant access per resource"
~~~

### Task 4: 把 access service、列表 obtained 与 API 响应切换为 grant

**Files:**

- Modify: app/api/patch/resource/download/access/service.ts
- Modify: app/api/patch/resource/download/access/route.ts
- Modify: app/api/patch/resource/download/access/actor.ts
- Create: app/api/patch/resource/download/access/response.ts
- Modify: app/api/patch/resource/get.ts
- Modify: types/api/patch.ts
- Create: app/api/patch/resource/download/access/observability.ts
- Modify: tests/unit/api/resource-access.test.ts

**Interfaces:**

- Consumes: resolveResourceAccessGrant。
- Produces: 单 link 响应；同 resource 的所有 preview link 共享 obtained/obtainedExpiresAt，只有有 active access event 的 link 带 revealed: true；`PatchResourceLink` 在本任务增加 `revealed?: boolean`，列表服务端始终输出布尔值。
- Produces: 成功响应的 access.kind 明确为 resource_granted、link_revealed 或 reused；只有 `resource_granted + visitor + galgame` 才可能携带游客 quota。
- Produces: 429 JSON 字符串和 Retry-After，daily 或 weekly 原因必须不泄露资源可见性信息。
- Produces: 重试耗尽时的 503 JSON 字符串、Retry-After: 1 和 no-store，不暴露 Prisma 或资源信息。

- [ ] **Step 1: 写失败的 route/list 测试**

~~~ts
const grantMocks = vi.hoisted(() => ({
  resolveResourceAccessGrant: vi.fn()
}))

vi.mock(
  '~/app/api/patch/resource/download/access/grant',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('~/app/api/patch/resource/download/access/grant')
      >()
    return {
      ...actual,
      resolveResourceAccessGrant: grantMocks.resolveResourceAccessGrant
    }
  }
)

// 在现有 hoisted prismaMocks 中增加：
patch_resource_access_grant: {
  findMany: vi.fn()
}

it('marks every mirror of an actively granted resource as obtained', async () => {
  prismaMocks.patch_resource_access_grant.findMany.mockResolvedValue([
    {
      resource_id: 11,
      expires: new Date('2026-07-11T00:00:00.000Z')
    }
  ])
  prismaMocks.patch_resource_access.findMany.mockResolvedValue([
    { link_id: 21 }
  ])

  const resources = await getPatchResource({ patchId: 7 }, visitorViewer)

  expect(resources[0].links).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 21, obtained: true, revealed: true }),
      expect.objectContaining({ id: 22, obtained: true, revealed: false })
    ])
  )
})

it('returns weekly visitor limit with Retry-After and no-store', async () => {
  grantMocks.resolveResourceAccessGrant.mockResolvedValue({
    kind: 'limited',
    window: 'weekly',
    retryAfterSeconds: 3600,
    remaining: { daily: 2, weekly: 0 },
    resetsAt: {
      daily: '2026-07-11T16:00:00.000Z',
      weekly: '2026-07-12T16:00:00.000Z'
    }
  })

  const response = await POST(jsonRequest({ patchId: 7, resourceId: 11, linkId: 21 }))

  expect(response.status).toBe(429)
  expect(response.headers.get('retry-after')).toBe('3600')
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  await expect(response.json()).resolves.toBe(
    '本周游客获取次数已达上限，登录后可继续获取，或 1 小时后再试'
  )
})

it('returns a safe no-store 503 when the grant transaction stays busy', async () => {
  grantMocks.resolveResourceAccessGrant.mockRejectedValue(
    new ResourceAccessGrantBusyError()
  )

  const response = await POST(jsonRequest({ patchId: 7, resourceId: 11, linkId: 21 }))

  expect(response.status).toBe(503)
  expect(response.headers.get('retry-after')).toBe('1')
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  await expect(response.json()).resolves.toBe('获取下载链接繁忙，请稍后再试')
})
~~~

扩展现有 hoisted mocks：为 `patch_resource_access_grant.findMany` 和 grant resolver 提供逐例 reset/default，不能假设旧 Phase 3 fixture 存在。列表测试还要精确断言用户/游客的 actor_key、`actor_type + user_id/visitor_token`，以及无身份 viewer 时 grant/event 两个 delegate 都不调用；所有 list link 始终有安全布尔值 `revealed`，且初始响应仍不含 content/code/password。

再添加 route 契约测试：

- resource_granted 响应带 access.kind；只有 actorType=visitor 且已 guard section=galgame 时才透传 quota。故意给 user 或 patch 的 mock result 注入 quota，响应仍必须省略。
- link_revealed/reused 成功响应省略 quota。
- actor 建立前的 400 为 no-store，不创建 actor、不写 Set-Cookie。
- actor 建立后的 404 为 no-store，并给首次游客写 Cookie；grant 与 observability 都不调用。
- daily/weekly 429 含 Retry-After、安全字符串、首次游客 Cookie，响应不含输入 ID 或链接。
- busy 结构化 503、unknown exception 503 和 unknown-section 503 都是安全字符串、no-store、Retry-After: 1、首次游客 Cookie；三者各只记录一次 manual_failed，unknown section 不调用 grant，响应不含非法 section 或内部错误。
- post-actor try/catch 必须同时覆盖 visibility 查询和 service，确保这两处的未知异常都走同一 503/cookie/log 分支。

- [ ] **Step 2: 运行 route/list 测试确认失败**

Run: pnpm test tests/unit/api/resource-access.test.ts

Expected: FAIL because Phase 2 列表仍按 link_id 推导 obtained，service 仍创建单链接 72 小时 access record，且新的 grant、access.kind、quota 与 503 响应尚不存在。

- [ ] **Step 3: 在 service 中先校验可见 link，再解析资源级 grant**

保持 Phase 2 已有的 link、resource、patch、status 与 getPatchVisibilityWhere(req) 约束。Prisma 返回的 `link.resource.section` 类型是普通 string；在调用 grant 前必须显式 guard 为 `galgame | patch`，未知 DB 值作为服务端数据异常抛出并由 route 映射为不泄露详情的通用 503，不能静默归为 patch，也不能放宽 Task 3 的窄类型。随后调用 resolveResourceAccessGrant，传入 patch_id、resource_id、link_id、storage 和已 guard 的 section；resource_granted、link_revealed、reused 都只返回 input.linkId 对应的 content、code、password、hash，并原样映射为 access.kind。只有 `result.kind === 'resource_granted' && actor.actorType === 'visitor' && section === 'galgame' && result.quota` 同时成立时才把 quota 放入成功响应；不能只信任 grant result 的可选字段。link_revealed、reused、登录用户和 patch 资源响应明确省略 quota。limited 映射为 429；ResourceAccessGrantBusyError 映射为安全的 503 + Retry-After: 1。删除 Phase 2 的 link-level existingAccess/create 分支；service 不再自行计算 expires。删除 actor.ts 的 RESOURCE_ACCESS_REUSE_MS，24 小时只由 policy.ts 的 RESOURCE_ACCESS_GRANT_MS 定义。干净基线不存在 normalizeResourceKind、hasCreatorQuota、resolveQuotaScope 或 link.resource.user_id quota 查询，不得把这些旧 Phase 3 路径移入新分支。

types/api/patch.ts 先在现有 `PatchResourceLink` interface 增加 `revealed?: boolean`；服务端列表仍始终赋 boolean，可选类型仅用于兼容尚未同步的静态 fixture。随后将成功语义改为最小、明确的 kind，而不是让前端从 reused 布尔值猜测是否消耗额度：

~~~ts
export type ResourceAccessQuotaWindow = 'daily' | 'weekly'

export interface ResourceAccessQuota {
  scope: 'visitor'
  resourceKind: 'galgame'
  remaining: Record<ResourceAccessQuotaWindow, number>
  resetsAt: Record<ResourceAccessQuotaWindow, string>
}

export type PatchResourceAccessKind =
  | 'resource_granted'
  | 'link_revealed'
  | 'reused'

export interface PatchResourceAccessResponse {
  link: PatchResourceAccessLink
  access: {
    kind: PatchResourceAccessKind
    actorType: 'visitor' | 'user'
    cost: 0
    obtainedExpiresAt: string
  }
  quota?: ResourceAccessQuota
}
~~~

service 必须在运行时维持不变量：quota 存在 => access.kind === 'resource_granted'、actorType === 'visitor'、已验证 section === 'galgame'、resourceKind === 'galgame'。测试给 user/patch 的 grant mock 故意注入 quota，并断言反向场景全部省略。

service 不再返回裸字符串。新增完整的结构化错误与 guard：

~~~ts
export type ResourceAccessServiceError = {
  kind: 'resource-access-error'
  status: 404 | 429 | 503
  message: string
  retryAfterSeconds?: number
}

export const isResourceAccessServiceError = (
  value: unknown
): value is ResourceAccessServiceError =>
  Boolean(
    value &&
      typeof value === 'object' &&
      (value as { kind?: unknown }).kind === 'resource-access-error' &&
      typeof (value as { message?: unknown }).message === 'string' &&
      [404, 429, 503].includes((value as { status?: number }).status ?? 0)
  )

const createResourceAccessError = (
  status: ResourceAccessServiceError['status'],
  message: string,
  retryAfterSeconds?: number
): ResourceAccessServiceError => ({
  kind: 'resource-access-error',
  status,
  message,
  ...(retryAfterSeconds ? { retryAfterSeconds } : {})
})

const formatRetryDuration = (seconds: number) => {
  if (seconds >= 24 * 60 * 60) {
    return `${Math.ceil(seconds / (24 * 60 * 60))} 天`
  }
  if (seconds >= 60 * 60) {
    return `${Math.ceil(seconds / (60 * 60))} 小时`
  }
  if (seconds >= 60) {
    return `${Math.ceil(seconds / 60)} 分钟`
  }
  return `${Math.max(1, seconds)} 秒`
}

const formatResourceAccessLimitMessage = (
  window: 'daily' | 'weekly',
  retryAfterSeconds: number
) =>
  `${window === 'daily' ? '今日' : '本周'}游客获取次数已达上限，登录后可继续获取，或 ${formatRetryDuration(
    retryAfterSeconds
  )}后再试`
~~~

link 不存在返回结构化 404。limited 返回结构化 429 和 grant 给出的 retryAfterSeconds。service 只捕获 ResourceAccessGrantBusyError 并返回“获取下载链接繁忙，请稍后再试”的结构化 503、Retry-After: 1；其他异常继续抛给 route。route 用 isResourceAccessServiceError 映射 status/message/Retry-After，未知异常统一记录 manual_failed 并返回同一安全 503，不得把 Error.message、Prisma code 或输入 ID 返回客户端。

- [ ] **Step 4: 改造列表 obtained 查询**

~~~ts
const now = new Date()
const resourceIds = data.map((resource) => resource.id)
const linkIds = data.flatMap((resource) =>
  resource.links.map((link) => link.id)
)
const actorKey = getResourceAccessViewerKey(accessViewer)
const actorAccessWhere = getResourceAccessViewerWhere(accessViewer)
const [activeGrants, revealedAccess] = actorKey && actorAccessWhere
  ? await Promise.all([
      prisma.patch_resource_access_grant.findMany({
        where: {
          actor_key: actorKey,
          resource_id: { in: resourceIds },
          expires: { gt: now }
        },
        select: { resource_id: true, expires: true }
      }),
      prisma.patch_resource_access.findMany({
        where: {
          ...actorAccessWhere,
          link_id: { in: linkIds },
          expires: { gt: now }
        },
        select: { link_id: true }
      })
    ])
  : [[], []]

const expiresByResourceId = new Map(
  activeGrants.map((grant) => [grant.resource_id, grant.expires])
)
const revealedLinkIds = new Set(
  revealedAccess.map((access) => access.link_id)
)
~~~

映射 link 时按 resource.id 设置 obtained/obtainedExpiresAt，并始终返回安全布尔值 revealed: revealedLinkIds.has(link.id)。revealed 只表达该镜像曾被点开，不包含真实链接。getResourceAccessViewerWhere 对用户返回 user_id + actor_type，对游客返回 visitor_token + actor_type；只有 actorKey 和 actorAccessWhere 同时非 null 才执行 active grant 与 revealed event 两组查询，没有 identity 时显式返回 [[], []]，不得展开 null。

- [ ] **Step 5: 统一 route 错误和成功响应**

把 route.ts 当前私有的 JSON helper 和成功分支直接写 Cookie 的逻辑统一移入 response.ts，access route 与 Task 5 的 restore route 只能从这里复用：

~~~ts
import { NextResponse } from 'next/server'
import { setResourceAccessVisitorCookie } from './actor'
import type { ResourceAccessActor } from './actor'

const RESOURCE_ACCESS_CACHE_CONTROL = 'private, no-store'

export const resourceAccessJson = (
  body: unknown,
  status = 200,
  headers?: Record<string, string>
) =>
  NextResponse.json(body, {
    status,
    headers: {
      ...headers,
      'Cache-Control': RESOURCE_ACCESS_CACHE_CONTROL
    }
  })

export const withResourceAccessVisitorCookie = (
  response: NextResponse,
  actor: ResourceAccessActor
) => {
  if (actor.actorType === 'visitor' && actor.shouldSetVisitorCookie) {
    setResourceAccessVisitorCookie(response, actor.visitorToken)
  }

  return response
}
~~~

新增 observability.ts。resource_grant 和 link_reveal 直接由 DB event 聚合，不重复写运行日志；日志只补足 DB 无法表达的手动复用、拒绝、HTTP 失败和 Task 5 自动恢复结果：

~~~ts
export type ResourceAccessOutcome =
  | 'manual_reused'
  | 'daily_limited'
  | 'weekly_limited'
  | 'rate_limited'
  | 'manual_failed'
  | 'restore_succeeded'
  | 'restore_failed'

export const logResourceAccessOutcome = (input: {
  operation: 'access' | 'restore'
  outcome: ResourceAccessOutcome
  actorType: 'visitor' | 'user'
  section?: 'galgame' | 'patch'
}) => {
  console.info('resource-access-outcome', input)
}
~~~

service 在已验证 link 后只记录 manual_reused、daily_limited 或 weekly_limited；resource_granted 与 link_revealed 已各写一条 DB event。route 对结构化 status=503 和 caught unknown error 都各记录一次 manual_failed，并统一返回安全字符串、Retry-After: 1 与 no-store；404 不记录，避免用日志形成资源枚举侧信道。Task 6 接入技术限频时再记录 rate_limited。actor 创建后，route 的 try/catch 必须同时包住 visibility 查询与 service；404、429、结构化/未知 503 与成功响应都经过 withResourceAccessVisitorCookie，让首次游客收到 Cookie。输入解析失败发生在 actor 创建前，返回固定 no-store 400，不调用 actor helper，也不写 Set-Cookie。access route 删除本地 resourceAccessJson 和成功分支的直接 Cookie 写入，改用 response.ts 的两个导出。resourceAccessJson 的 header 合并必须把固定 `Cache-Control: private, no-store` 放在最后，调用者不能覆盖。测试断言日志 payload 只含 operation、outcome、actorType 和可选 section，不含链接、token、IP/IP hash、actorKey、Redis key、资源 ID 或完整资源名称；404 断言零日志，所有 503 断言恰好一条 manual_failed。

- [ ] **Step 6: 运行 API 测试**

Run: pnpm test tests/unit/api/resource-access.test.ts tests/unit/api/resource-access-grant.test.ts

Expected: PASS；同资源两条镜像共享 obtained，只有点过的镜像 revealed；第二条镜像首次点击写 link_reveal 但不计额度，重复点击不写；日/周 429、visibility 404 和所有 no-store header 正确。

- [ ] **Step 7: 提交 service、route、列表和测试**

~~~bash
git add app/api/patch/resource/download/access/actor.ts app/api/patch/resource/download/access/service.ts app/api/patch/resource/download/access/route.ts app/api/patch/resource/download/access/response.ts app/api/patch/resource/get.ts app/api/patch/resource/download/access/observability.ts types/api/patch.ts tests/unit/api/resource-access.test.ts
git commit -m "refactor(resource): use grants for visitor access"
~~~

### Task 5: 刷新后批量恢复点过的镜像

**Files:**

- Create: app/api/patch/resource/download/access/restore/service.ts
- Create: app/api/patch/resource/download/access/restore/route.ts
- Reuse (no change): app/api/patch/resource/download/access/response.ts
- Reuse (no change): app/api/patch/resource/download/access/observability.ts
- Modify: validations/patch.ts
- Modify: types/api/patch.ts
- Modify: components/patch/resource/ResourceDownload.tsx
- Modify: components/patch/resource/DownloadCard.tsx
- Create: tests/unit/api/resource-access-restore.test.ts
- Create: tests/unit/resource-download-restore.test.tsx
- Modify: tests/unit/resource-download-card.test.tsx

**Interfaces:**

- Produces: restorePatchResourceLinksSchema，接收 patchId、resourceId、1–50 个去重 linkIds。
- Produces: restorePatchResourceLinks(input, visibilityWhere, actor, now?)，只读返回该 actor 已展示且仍在 resource grant 有效期内的镜像。
- Consumes: Task 4 已加入的 `PatchResourceLink.revealed?: boolean`；Produces: 完整的 PatchResourceAccessRestoreResponse 类型。
- Consumes: getResourceAccessActorKey、getResourceAccessActorWhere、response.ts、observability.ts 和 getPatchVisibilityWhere；Task 6 再把共享技术限频接到 restore route。

- [ ] **Step 1: 写失败的 restore service/route 测试**

~~~ts
it('restores only requested mirrors with active reveal events', async () => {
  prismaMocks.patch_resource_access_grant.findUnique.mockResolvedValue({
    actor_key: visitorActorKey,
    resource_id: 11,
    expires: new Date('2026-07-11T00:00:00.000Z')
  })
  prismaMocks.patch_resource_access.findMany.mockResolvedValue([
    { link: sensitiveLink21 },
    { link: sensitiveLink21 }
  ])

  const result = await restorePatchResourceLinks(
    { patchId: 7, resourceId: 11, linkIds: [21, 22] },
    visibilityWhere,
    visitorActor,
    new Date('2026-07-10T12:00:00.000Z')
  )

  expect(result).toEqual({
    links: [sensitiveLink21],
    obtainedExpiresAt: '2026-07-11T00:00:00.000Z'
  })
  expect(prismaMocks.patch_resource_access.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        visitor_token: visitorActor.visitorToken,
        resource_id: 11,
        link_id: { in: [21, 22] },
        expires: { gte: new Date('2026-07-11T00:00:00.000Z') }
      })
    })
  )
  expect(prismaMocks.patch_resource_access.create).not.toHaveBeenCalled()
})

it('returns no-store and no links for an expired grant', async () => {
  prismaMocks.patch_resource_access_grant.findUnique.mockResolvedValue(null)

  const response = await POST(
    jsonRequest({ patchId: 7, resourceId: 11, linkIds: [21] })
  )

  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  await expect(response.json()).resolves.toEqual({
    links: [],
    obtainedExpiresAt: null
  })
})
~~~

再写边界测试：未点过的 link 即使属于 active grant 也不返回；短于 grant 的 legacy event 不恢复，expires 等于或晚于 grant 的 event 可恢复；其他 actor 的 event 不返回；资源/游戏不可见时不返回敏感字段。重复历史 event 必须按 link.id 去重，输出顺序跟请求 linkIds 一致。

查询断言必须分别覆盖 user/visitor：grant `findUnique` 精确使用 `actor_key_resource_id: { actor_key: getResourceAccessActorKey(actor), resource_id }`；access event 精确包含 `actor_type + user_id/visitor_token`、patch_id/resource_id/requested link_id、`link.resource_id`、resource.status、resource.patch_id、patch.status 与完整 visibilityWhere，并只 select PatchResourceAccessLink 所需字段。不能只靠 mock 返回 grant/空数组证明身份或可见性。Prisma mocks 还要断言 restore 路径没有 create/update/upsert/delete/$transaction 等写调用，并且 `resolveResourceAccessGrant` 零调用。

route 测试矩阵：400 在 actor 前完成解析，不调用 actor/visibility/service、不写 Cookie、不记日志并保持 no-store；200（包括空结果）给首次 visitor 写 Cookie、user 不写 visitor Cookie，且恰好一条 restore_succeeded；visibility 与 service 分别抛异常时都由 post-actor catch 映射为通用 JSON 字符串 503、Retry-After: 1、no-store、首次 visitor Cookie，并恰好记录一条 restore_failed。日志精确等于 operation/outcome/actorType/可选 section 的允许字段，不含请求 ID、visitor token、IP/IP hash、actorKey 或敏感链接。30/min restore 技术限频及“限频时不查询 grant/access”的 route 回归统一在 Task 6 先写失败测试后接入。

schema/route 边界还要覆盖：空 `linkIds`、原始输入 51 项、非整数 ID 均返回 400；50 项以内的重复 ID 由 transform 去重并保留首次出现顺序。`.max(50)` 在去重 transform 前执行，因此即使 51 项全部相同也必须拒绝，不能先去重再绕过请求大小上限。

- [ ] **Step 2: 运行 restore API 测试确认失败**

Run: pnpm test tests/unit/api/resource-access-restore.test.ts

Expected: FAIL because restore schema、service 和 route 尚不存在。

- [ ] **Step 3: 实现 restore schema 与只读 service**

~~~ts
// validations/patch.ts
export const restorePatchResourceLinksSchema = z.object({
  patchId: z.coerce.number().int().min(1).max(9_999_999),
  resourceId: z.coerce.number().int().min(1).max(9_999_999),
  linkIds: z
    .array(z.coerce.number().int().min(1).max(9_999_999))
    .min(1)
    .max(50)
    .transform((ids) => [...new Set(ids)])
})

// types/api/patch.ts：PatchResourceLink.revealed 已由 Task 4 提供
export interface PatchResourceAccessRestoreResponse {
  links: PatchResourceAccessLink[]
  obtainedExpiresAt: string | null
}
~~~

restore/service.ts 明确用 schema 推导输入，不另造手写 interface：

~~~ts
import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { restorePatchResourceLinksSchema } from '~/validations/patch'
import {
  getResourceAccessActorKey,
  getResourceAccessActorWhere
} from '../actor'
import type { Prisma } from '@prisma/client'
import type { ResourceAccessActor } from '../actor'
import type { PatchResourceAccessRestoreResponse } from '~/types/api/patch'

type RestoreInput = z.infer<typeof restorePatchResourceLinksSchema>

export const restorePatchResourceLinks = async (
  input: RestoreInput,
  visibilityWhere: Prisma.patchWhereInput,
  actor: ResourceAccessActor,
  now = new Date()
): Promise<PatchResourceAccessRestoreResponse> => {
  const actorKey = getResourceAccessActorKey(actor)
  const grant = await prisma.patch_resource_access_grant.findUnique({
    where: {
      actor_key_resource_id: {
        actor_key: actorKey,
        resource_id: input.resourceId
      }
    },
    select: { expires: true }
  })

  if (!grant || grant.expires <= now) {
    return { links: [], obtainedExpiresAt: null }
  }

  const access = await prisma.patch_resource_access.findMany({
    where: {
      ...getResourceAccessActorWhere(actor),
      patch_id: input.patchId,
      resource_id: input.resourceId,
      link_id: { in: input.linkIds },
      expires: { gte: grant.expires },
      link: { resource_id: input.resourceId },
      resource: {
        status: 0,
        patch_id: input.patchId,
        patch: { id: input.patchId, status: 0, ...visibilityWhere }
      }
    },
    select: {
      link: {
        select: {
          id: true,
          storage: true,
          size: true,
          content: true,
          code: true,
          password: true,
          hash: true
        }
      }
    }
  })

  const linkById = new Map(access.map(({ link }) => [link.id, link]))
  return {
    links: input.linkIds.flatMap((id) => {
      const link = linkById.get(id)
      return link ? [link] : []
    }),
    obtainedExpiresAt: grant.expires.toISOString()
  }
}
~~~

restore route 从 ../response 导入 resourceAccessJson 和 withResourceAccessVisitorCookie，不得从 access route.ts 反向导入私有函数。输入 schema 在 actor 前解析：400 不创建 actor、不查 visibility/service、不写 Cookie/日志。actor 创建后的 try/catch 同时包住 visibility 与只读 service；不得调用 resolveResourceAccessGrant、不得写 grant/access event、不得返回 quota。无 active grant 或没有可恢复镜像是正常 200 空结果；所有 200 给首次 visitor 写 Cookie并恰好记录一次 restore_succeeded。visibility/service 未知异常统一映射通用 JSON 字符串 503、Retry-After: 1、no-store，给首次 visitor 写 Cookie并恰好记录一次 restore_failed；user 不写 visitor Cookie。Task 6 接入共享技术限频后再增加 429/rate_limited 分支。以上安全日志只含 operation、outcome、actorType 和可选 section，不记录 patchId、resourceId、linkIds、visitor token、IP/IP hash、actorKey 或响应链接。

- [ ] **Step 4: 写失败的前端自动恢复测试**

~~~tsx
it('auto-expands and restores only previously revealed mirrors', async () => {
  const resourceWithReveal = {
    ...resource,
    links: [
      {
        ...link21,
        obtained: true,
        obtainedExpiresAt: '2026-07-11T00:00:00.000Z',
        revealed: true
      },
      {
        ...link22,
        obtained: true,
        obtainedExpiresAt: '2026-07-11T00:00:00.000Z',
        revealed: false
      }
    ]
  }
  fetchMock.kunFetchPost.mockResolvedValueOnce({
    links: [sensitiveLink21],
    obtainedExpiresAt: '2026-07-11T00:00:00.000Z'
  })

  const { container } = await renderResourceDownload(resourceWithReveal)

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(container.textContent).toContain(sensitiveLink21.content)
  expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
    '/patch/resource/download/access/restore',
    { patchId: 7, resourceId: 11, linkIds: [21] }
  )
  expect(container.textContent).not.toContain(sensitiveLink22.content)
})
~~~

组件测试沿用仓库现有 JSDOM/createRoot/act harness；显式 mock `@heroui/react`、DOMPurify、Markdown renderer、`KunUser` 与 `LikeButton`，并把 `DownloadCard` mock 成可观察 `restoredLink` / `restoredObtainedExpiresAt` props 的轻量组件。用 `act` 内的受控 deferred promise、root rerender、unmount 与 cleanup 验证 effect，不引入未安装的 `waitFor` 或 Testing Library。

再写五项父组件测试：没有 revealed link 时不自动展开、不发 restore 请求；相同 patch/resource/revealed IDs 的 effect 重跑只复用一次请求；同一资源条目的 revealed IDs 从 `[21]` 变成 `[21, 22]` 时必须发起新请求，而且旧 deferred promise 晚返回也不能覆盖新结果；restore 返回字符串或抛错时只显示一条资源级“已获取链接恢复失败，可点击单条链接重试”，不连续 toast，并保留每张卡片的手动获取按钮；组件切换到其他资源或卸载后，旧 restore promise 晚完成也不能写入状态。

同步更新 `resource-download-card.test.tsx`：成功响应按 `access.kind` 而不是旧 `access.reused` 判断提示；`obtained: true, revealed: false` 仍显示“获取下载链接”；`revealed: true` 但 restore 失败或漏回当前 link ID 时显示“查看已获取链接”供单条手动重试；`restoredLink.id !== link.id` 时必须忽略；卡片不得重复显示授权时长说明，并继续确保不出现 72 小时旧文案。

- [ ] **Step 5: 实现父组件一次恢复与卡片注入**

ResourceDownload 的 React import 增加 useMemo，并以 `resource.links.some((link) => link.revealed)` 初始化及同步展开状态。先把 revealed link IDs 去重并按数字升序规范化，再用 `patchId + resourceId + revealedLinkIds` 组成请求身份；相同身份的 effect 重跑复用同一个 in-flight promise，同一资源条目的 revealed 集合变化则必须发起新 restore POST。响应转成 `Map<linkId, PatchResourceAccessLink>`，每次 effect cleanup 以 stale 标记忽略旧结果：

~~~tsx
const revealedLinkIds = useMemo(
  () =>
    [...new Set(resource.links.filter((link) => link.revealed).map((link) => link.id))]
      .sort((left, right) => left - right),
  [resource.links]
)
const restoreKey = `${resource.patchId}:${resource.id}:${revealedLinkIds.join(',')}`
const restoreRequestRef = useRef<{
  key: string
  promise: Promise<PatchResourceAccessRestoreResponse | string>
} | null>(null)
const [restoredLinks, setRestoredLinks] = useState(
  new Map<number, PatchResourceAccessLink>()
)
const [restoredExpiresAt, setRestoredExpiresAt] = useState('')
const [restoreError, setRestoreError] = useState('')

useEffect(() => {
  if (revealedLinkIds.length === 0) {
    restoreRequestRef.current = null
    setRestoredLinks(new Map())
    setRestoredExpiresAt('')
    setRestoreError('')
    return
  }

  setShowLinks((current) => ({ ...current, [resource.id]: true }))
  if (restoreRequestRef.current?.key !== restoreKey) {
    setRestoredLinks(new Map())
    setRestoredExpiresAt('')
    setRestoreError('')
    restoreRequestRef.current = {
      key: restoreKey,
      promise: kunFetchPost<PatchResourceAccessRestoreResponse | string>(
        '/patch/resource/download/access/restore',
        {
          patchId: resource.patchId,
          resourceId: resource.id,
          linkIds: revealedLinkIds
        }
      )
    }
  }

  let stale = false
  const request = restoreRequestRef.current!
  void request.promise
    .then((response) => {
      if (stale || restoreRequestRef.current?.key !== restoreKey) return
      if (typeof response === 'string') {
        setRestoredLinks(new Map())
        setRestoredExpiresAt('')
        setRestoreError('已获取链接恢复失败，可点击单条链接重试')
        return
      }

      const requestedIds = new Set(revealedLinkIds)
      setRestoredLinks(
        new Map(
          response.links
            .filter((link) => requestedIds.has(link.id))
            .map((link) => [link.id, link])
        )
      )
      setRestoredExpiresAt(response.obtainedExpiresAt ?? '')
      setRestoreError('')
    })
    .catch(() => {
      if (!stale && restoreRequestRef.current?.key === restoreKey) {
        setRestoredLinks(new Map())
        setRestoredExpiresAt('')
        setRestoreError('已获取链接恢复失败，可点击单条链接重试')
      }
    })

  return () => {
    stale = true
  }
}, [restoreKey, resource.id, resource.patchId, revealedLinkIds])
~~~

资源级 `restoreError` 在卡片列表上方只渲染一次，不调用 toast。仅向 ID 命中的 `DownloadCard` 传 `restoredLink={restoredLinks.get(link.id)}` 和 `restoredObtainedExpiresAt={restoredExpiresAt}`；响应未返回的卡片不注入敏感字段，仍保留单条手动按钮。`DownloadCard` 新增 `restoredLink?: PatchResourceAccessLink` 与 `restoredObtainedExpiresAt?: string`，并且只在 `restoredLink?.id === link.id` 时通过 effect 同步 `accessedLink` 和 `obtainedExpiresAt`。

Task 4 的 `obtained` 是资源条目级 active grant 状态，不是镜像展示状态；`DownloadCard` 不得只凭 `link.obtained` 改按钮文案。ID 匹配的 `accessedLink`（来自本次手动成功或 restore 注入）存在时直接显示链接；尚无敏感链接但 `link.revealed === true` 时显示“查看已获取链接”，供自动恢复失败后的单条手动重试；`link.revealed !== true` 时显示“获取下载链接”，即使资源级 `obtained === true`。`obtained` 只表示资源级授权状态，不能直接控制镜像按钮或敏感字段，也不再驱动逐卡片授权时长说明。用户手动点开新镜像仍走单链接 access API，成功后保持该链接可见；`link_revealed` / `reused` 响应不显示新的额度提示。

- [ ] **Step 6: 运行 restore API 与组件测试**

Run: pnpm test tests/unit/api/resource-access-restore.test.ts tests/unit/resource-download-restore.test.tsx tests/unit/resource-download-card.test.tsx

Run: pnpm test

Run: pnpm typecheck

Expected: PASS；每个稳定的 patch/resource/revealed-ID 请求身份最多一项只读请求，revealed 集合变化后的新身份也只发一次；不新增 grant/event，不返回未点过镜像，失败不连续 toast，陈旧响应不覆盖新输入，真实链接仍不在初始 resource payload；全量 Vitest 与 typecheck 同时通过。

- [ ] **Step 7: 提交自动恢复功能**

~~~bash
git add app/api/patch/resource/download/access/restore/service.ts app/api/patch/resource/download/access/restore/route.ts validations/patch.ts types/api/patch.ts components/patch/resource/ResourceDownload.tsx components/patch/resource/DownloadCard.tsx tests/unit/api/resource-access-restore.test.ts tests/unit/resource-download-restore.test.tsx tests/unit/resource-download-card.test.tsx
git commit -m "feat(resource): restore revealed mirrors"
~~~

### Task 6: 接入 Redis 技术限频并收敛前端反馈

> Task 4–6 是同一 API 迁移的检查点；在本任务完成、类型收敛和 focused tests 全部通过前，不得部署中间状态。

**Files:**

- Create: app/api/patch/resource/download/access/rateLimit.ts
- Modify: app/api/patch/resource/download/access/route.ts
- Modify: app/api/patch/resource/download/access/restore/route.ts
- Modify: components/patch/resource/DownloadCard.tsx
- Create: tests/unit/api/resource-access-rate-limit.test.ts
- Modify: tests/unit/api/resource-access-grant.test.ts
- Modify: tests/unit/api/resource-access.test.ts
- Modify: tests/unit/api/resource-access-restore.test.ts
- Modify: tests/unit/resource-download-card.test.tsx

**Interfaces:**

- Produces: checkResourceAccessActionRateLimit(actor)，只做 30 次/分钟技术限频。
- Produces: UI 仅在 access.kind = resource_granted、响应确有游客 quota 且当日剩余不超过 2 时显示低压提示。

- [ ] **Step 1: 写失败测试，证明产品额度与技术限频已分离**

~~~ts
it('uses exactly one technical rate-limit key for a request', async () => {
  await checkResourceAccessActionRateLimit(visitorActor)

  expect(redisMocks.eval).toHaveBeenCalledWith(
    expect.stringContaining('resource access action rate limit'),
    1,
    expect.stringContaining('resource-access:rate-limit:v1:visitor-token:'),
    '60',
    '30'
  )
  expect(redisMocks.eval).toHaveBeenCalledTimes(1)
  expect(redisMocks.eval.mock.calls[0][1]).toBe(1)
})

it('uses an IP key only before a visitor cookie is established', async () => {
  await checkResourceAccessActionRateLimit({
    ...visitorActor,
    shouldSetVisitorCookie: true,
    visitorToken: 'new-visitor-token'
  })

  expect(redisMocks.eval).toHaveBeenCalledWith(
    expect.any(String),
    1,
    expect.stringContaining('resource-access:rate-limit:v1:visitor-ip:'),
    '60',
    '30'
  )
})

it('fails open only for the technical limiter when Redis is unavailable', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  redisMocks.eval.mockRejectedValueOnce(new Error('redis unavailable'))

  await expect(checkResourceAccessActionRateLimit(visitorActor)).resolves.toEqual({
    allowed: true
  })
  expect(consoleError).toHaveBeenCalledWith(
    'Failed to check resource access action rate limit',
    expect.objectContaining({ actorType: 'visitor' })
  )
  expect(JSON.stringify(consoleError.mock.calls)).not.toContain(visitorActor.visitorToken)
  expect(JSON.stringify(consoleError.mock.calls)).not.toContain(visitorActor.ipHash)
  consoleError.mockRestore()
})

it('does not call Redis while evaluating the product quota for a new visitor grant', async () => {
  // grant test 显式 mock ~/lib/redis；grant.ts 不得导入或调用它。
  await resolveResourceAccessGrant({
    actor: visitorActor,
    patchId: 7,
    resourceId: 11,
    linkId: 21,
    storage: 'user',
    section: 'galgame',
    now: new Date('2026-07-10T00:00:00.000Z')
  })

  expect(redisMocks.eval).not.toHaveBeenCalled()
})

it('does not repeat the grant duration on each mirror card', async () => {
  const { container } = await renderCard({
    resource,
    link: obtainedLink
  })

  expect(container.textContent).not.toContain('24 小时内无需重新获取')
})
~~~

沿用现有 JSDOM、createRoot 和 act 测试 harness，把 renderCard 扩展为接收 resource/link/restoredLink 可选参数；不要新增项目未安装的 Testing Library。Phase 2 fixture 中的 access.reused 全部改为 access.kind，并把旧“72 小时/查看已获取链接”用例改成资源级 24 小时语义。

再添加两个 route 测试：access 和 restore 各自在 actor 建立后、visibility/DB/service 之前调用一次技术限频；命中时返回 429、Retry-After、private, no-store，并为首次游客写回 visitor cookie。断言被限频请求不调用 grant、restore 或资源可见性查询。route 测试只 mock checkResourceAccessActionRateLimit 的公开结果；Lua、key 与 fail-open 细节只放在 resource-access-rate-limit.test.ts。

- [ ] **Step 2: 运行测试确认失败**

Run: pnpm test tests/unit/api/resource-access-rate-limit.test.ts tests/unit/api/resource-access-grant.test.ts tests/unit/api/resource-access.test.ts tests/unit/api/resource-access-restore.test.ts tests/unit/resource-download-card.test.tsx

Expected: FAIL because rateLimit.ts 尚不存在、access/restore route 尚未调用技术限频，DownloadCard 仍显示重复的授权时长说明。Task 3 已完成时，grant 的“未调用 Redis”断言应已通过。

- [ ] **Step 3: 独立实现并接入技术限频**

在干净 Phase 2 基线上新建 rateLimit.ts；不得创建 quota.ts、Redis 产品 quota key 或 DB fallback quota。实现内容固定为：

~~~ts
import { getPrefixedRedisKey, redis, runRedisCommand } from '~/lib/redis'
import type { ResourceAccessActor } from './actor'

export type ResourceAccessRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number; message: string }

type RedisRateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number }

const RESOURCE_ACCESS_ACTION_RATE_LIMIT_SECONDS = 60
const RESOURCE_ACCESS_ACTION_RATE_LIMIT_COUNT = 30

const RESOURCE_ACCESS_RATE_LIMIT_SCRIPT = `
  -- resource access action rate limit
  local current = redis.call("INCR", KEYS[1])
  if current == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
  end

  local ttl = redis.call("PTTL", KEYS[1])
  if ttl < 0 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1]) * 1000
  end

  local limit = tonumber(ARGV[2])
  if current > limit then
    return cjson.encode({ allowed = false, retryAfterMs = ttl })
  end

  return cjson.encode({ allowed = true, remaining = limit - current })
`

const parseRedisRateLimitResult = (value: unknown): RedisRateLimitResult => {
  if (typeof value !== 'string') {
    throw new Error('Invalid Redis resource access rate limit response')
  }

  const parsed = JSON.parse(value) as Partial<RedisRateLimitResult>
  if (parsed.allowed === true && typeof parsed.remaining === 'number') {
    return parsed as RedisRateLimitResult
  }
  if (
    parsed.allowed === false &&
    typeof parsed.retryAfterMs === 'number' &&
    Number.isFinite(parsed.retryAfterMs)
  ) {
    return parsed as RedisRateLimitResult
  }

  throw new Error('Invalid Redis resource access rate limit payload')
}

const getActorRateLimitKey = (actor: ResourceAccessActor) =>
  actor.actorType === 'user'
    ? `resource-access:rate-limit:v1:user:${actor.uid}`
    : actor.shouldSetVisitorCookie && actor.ipHash
      ? `resource-access:rate-limit:v1:visitor-ip:${actor.ipHash}`
      : `resource-access:rate-limit:v1:visitor-token:${actor.visitorToken}`

const formatRateLimitMessage = (retryAfterMs: number) =>
  `获取下载链接过于频繁，请 ${Math.max(
    1,
    Math.ceil(retryAfterMs / 1000)
  )} 秒后再试`

export const checkResourceAccessActionRateLimit = async (
  actor: ResourceAccessActor
): Promise<ResourceAccessRateLimitResult> => {
  const key = getPrefixedRedisKey(getActorRateLimitKey(actor))

  try {
    const rawResult = await runRedisCommand(() =>
      redis.eval(
        RESOURCE_ACCESS_RATE_LIMIT_SCRIPT,
        1,
        key,
        String(RESOURCE_ACCESS_ACTION_RATE_LIMIT_SECONDS),
        String(RESOURCE_ACCESS_ACTION_RATE_LIMIT_COUNT)
      )
    )
    const result = parseRedisRateLimitResult(rawResult)
    return result.allowed
      ? { allowed: true }
      : {
          allowed: false,
          retryAfterMs: result.retryAfterMs,
          message: formatRateLimitMessage(result.retryAfterMs)
        }
  } catch (error) {
    console.error('Failed to check resource access action rate limit', {
      actorType: actor.actorType,
      errorName: error instanceof Error ? error.name : 'UnknownError'
    })
    return { allowed: true }
  }
}
~~~

access route 和 restore route 都在生成 actor 后、任何 visibility/DB/service 工作前调用 checkResourceAccessActionRateLimit。命中时用 response.ts 的共享 helper 返回 429、向上取整的 Retry-After 秒数、private, no-store，并为首次游客写回 Cookie；同时记录不含身份值的 rate_limited outcome。Redis 故障只让技术限频 fail-open，产品日/周额度仍只由 grant.ts 的 Serializable DB 事务判断。Task 4 已直接定义最终 ResourceAccessQuota 和 PatchResourceAccessResponse，不再做任何旧 quota 类型清理。

- [ ] **Step 4: 更新 DownloadCard**

处理成功响应时先保持 response.link 可见，再仅在 response.access.kind === 'resource_granted' 且 response.quota 存在时写入 quota；link_revealed 或 reused 必须明确 setQuota(null)。不要再读取或推断 access.reused。quota 存在且 remaining.daily <= 2 时显示：

~~~tsx
<p className="text-sm text-default-500" role="status">
  今日游客还可获取 {quota.remaining.daily} 个游戏资源条目
</p>
~~~

quota state 的类型固定为 ResourceAccessQuota | null，初始为 null。资源级 obtained 只表示该资源条目仍有 grant，不能直接决定某条镜像的按钮文案：accessedLink 或 restoredLink 存在时直接展示链接；link.revealed === true 但尚未恢复链接时显示“查看已获取链接”供手动重试；link.revealed !== true 的镜像即使 obtained === true 也必须显示“获取下载链接”。Phase 2 fixture 的 access.reused 布尔值全部改为 access.kind。

不要在每张 DownloadCard 下重复显示“24 小时内无需重新获取”的授权时长说明；24 小时用户说明集中保留在下载公告，镜像展示和刷新恢复规则由 frontend 文档维护。

不要在 patch 资源、登录用户、link_revealed/reused/restore 响应或任何付费语境中显示产品额度文案。组件测试同时覆盖：游客新 resource_granted 成功后保持链接可见、显示低额度提示且不重复显示授权时长说明；未点过但已授权的另一条镜像仍显示获取按钮，点击得到 link_revealed 后链接保持可见、quota 状态为 null 且不出现新额度提示；reused 同样不出现额度提示。

- [ ] **Step 5: 运行前端和 Redis 单元测试**

Run: pnpm test tests/unit/api/resource-access-rate-limit.test.ts tests/unit/api/resource-access-grant.test.ts tests/unit/api/resource-access.test.ts tests/unit/api/resource-access-restore.test.ts tests/unit/resource-download-card.test.tsx

Expected: PASS；运行时代码和测试中都不存在 fiveHour、shadow、observe 或 visitor-ip 产品 quota key。visitor-ip 只允许作为“首个无 cookie 请求”的单个技术限频键出现。

- [ ] **Step 6: 提交技术限频与 UI 文案**

~~~bash
git add app/api/patch/resource/download/access/rateLimit.ts app/api/patch/resource/download/access/route.ts app/api/patch/resource/download/access/restore/route.ts components/patch/resource/DownloadCard.tsx tests/unit/api/resource-access-rate-limit.test.ts tests/unit/api/resource-access-grant.test.ts tests/unit/api/resource-access.test.ts tests/unit/api/resource-access-restore.test.ts tests/unit/resource-download-card.test.tsx
git commit -m "feat(resource): add access rate limiting"
~~~

### Task 7: 安全观测、文档同步与发布验证

**Files:**

- Modify: docs/modules/api-services.md
- Modify: docs/modules/data-cache-upload.md
- Modify: docs/modules/frontend-content.md
- Modify: docs/modules/quality.md
- Modify: docs/project/testing.md
- Modify: posts/notice/download.mdx
- Modify: posts/notice/start.mdx
- Modify: .codex/skills/otoame-api/SKILL.md
- Modify: .codex/skills/otoame-data-cache/SKILL.md
- Modify: .codex/skills/otoame-frontend/SKILL.md

**Interfaces:**

- Produces: 文档化的 visitor-first 行为、事件/授权表职责、IP 边界、回滚与观测指标。
- Produces: 可从数据库 event 聚合、且不含下载凭据或网络标识的上线观测 SQL。

- [ ] **Step 1: 写入安全的上线观测查询**

把下面只读 SQL 放入 data/cache 文档的上线观察小节；它只聚合资源级 event，不输出真实下载凭据、visitor token、IP 或 actorKey：

~~~sql
WITH rollout AS (
  SELECT MIN(created) AS started_at
  FROM patch_resource_access
  WHERE access_kind = 'resource_grant'
)
SELECT
  DATE_TRUNC(
    'day',
    (pra.created AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai'
  ) AS shanghai_day,
  pra.actor_type,
  pra.section,
  pra.access_kind,
  COUNT(*) AS event_count
FROM patch_resource_access pra
CROSS JOIN rollout
WHERE rollout.started_at IS NOT NULL
  AND pra.access_kind IN ('resource_grant', 'link_reveal')
  AND pra.created >= rollout.started_at
  AND pra.created >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '14 days'
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC, 2, 3, 4;

SELECT
  COUNT(*) FILTER (WHERE expires > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) AS active_grants,
  COUNT(*) FILTER (WHERE expires <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) AS expired_grants
FROM patch_resource_access_grant;
~~~

resource_grant 与 link_reveal 由上面的 DB event 聚合；首条 resource_grant 的 created 作为新应用开始写事件的保守下界，避免迁移时统一标记为 link_reveal 的旧行污染 14 天指标。运维若记录了更准确的应用切换时间，应以该时间替换 rollout CTE。daily_limited、weekly_limited、manual_reused、rate_limited 和 manual_failed 由 observability.ts 的 resource-access-outcome 结构化日志聚合。自动 restore 不写 event，也不混入 manual_reused：restore route 对每个完成的只读请求记录 restore_succeeded，对映射为 503 的异常记录 restore_failed；日志聚合按 operation = restore 计算成功率 = restore_succeeded / (restore_succeeded + restore_failed)，技术 429 另看 rate_limited。这样“自动恢复成功率/错误率”有明确采集路径，而不依赖 access event 猜测。

安全日志只允许 operation、outcome、actorType 和可选 section，不得记录 content、code、password、hash、visitorToken、IP/IP hash、actorKey、Redis key、资源/镜像 ID 或完整资源名称。若部署平台已有 HTTP route status 指标，可用 restore route 的 200/429/503 交叉校验上述聚合，但 DB 中仍不得为了 restore 指标新增事件。

- [ ] **Step 2: 更新模块文档**

在 API 文档写明：额度单位是资源条目；首次 resource_grant 才进入日/周限制，link_reveal 和 restore 都不计额度；restore 只返回该 actor 点过且仍有效的镜像。
在 data/cache 文档写明：grant 表只含 actor_key、resource_id、expires；access_kind 是唯一新增事件分类字段；刷新只读、不新增 revealed 字段或数组。Redis 仅做短时技术限频，清除 visitor cookie 会创建新游客身份。
在 frontend 文档写明：资源授权 24 小时；所有镜像可访问，但只展示点过的镜像；刷新后按资源条目一次批量恢复，未点过镜像继续隐藏。
在 quality 文档把资源下载测试覆盖更新为 policy、grant、rate-limit、access、restore、card 和 restore UI，不再把 72 小时 Phase 2 行为写成当前契约。
在 testing 文档列出：24 小时不延长、resource_grant/link_reveal 分类、自动恢复无写入、日/周边界、技术限频、并发冲突、无敏感字段泄露和 migration backfill。
在下载公告写明：游客每天 5 个、每周 20 个游戏资源条目；首次获取后资源条目授权有效 24 小时，同一授权期内多镜像不重复占用额度；登录用户和补丁资源当前没有产品硬限制。
在总 FAQ 将“无需注册也可以免费无限制地下载文件”改为不与游客获取额度冲突的说明，并链接下载公告；不得暗示清 cookie 或换 IP 是重置规则的方法，可如实说明当前登录用户不受产品硬限额。

- [ ] **Step 3: 运行 focused 验证**

Run:

~~~bash
pnpm test tests/unit/api/resource-access-policy.test.ts tests/unit/api/resource-access-grant.test.ts tests/unit/api/resource-access-rate-limit.test.ts tests/unit/api/resource-access.test.ts tests/unit/api/resource-access-restore.test.ts tests/unit/resource-download-card.test.tsx tests/unit/resource-download-restore.test.tsx
pnpm typecheck
~~~

Expected: 全部 PASS。

- [ ] **Step 4: 执行静态敏感字段与旧窗口扫描**

Run:

~~~bash
rg -n "5h|fiveHour|shadow|observe|resource-access:quota:v1|quota_unit|grant_id|RESOURCE_ACCESS_REUSE_MS|72h|72 小时" app components tests types docs/modules docs/project .codex/skills posts/notice docs/superpowers/plans/2026-07-10-visitor-first-resource-access-redesign.md docs/superpowers/specs/2026-07-10-visitor-first-resource-access-product-brief.md
rg -n "content: link\.content|code: link\.code|password: link\.password" app/api/patch/resource/get.ts components/patch/resource

# 若当前 shell 没有 rg，使用同范围 fallback：
grep -RInE "5h|fiveHour|shadow|observe|resource-access:quota:v1|quota_unit|grant_id|RESOURCE_ACCESS_REUSE_MS|72h|72 小时" app components tests types docs/modules docs/project .codex/skills posts/notice docs/superpowers/plans/2026-07-10-visitor-first-resource-access-redesign.md docs/superpowers/specs/2026-07-10-visitor-first-resource-access-product-brief.md
grep -RInE "content: link\.content|code: link\.code|password: link\.password" app/api/patch/resource/get.ts components/patch/resource
~~~

Expected: 第一条没有运行时代码命中；实施计划中只允许旧机制删除说明、静态扫描命令，以及 Rollout 的历史 72 小时兼容说明命中。第二条只允许 DownloadCard 在 access/restore 成功后的组件内存状态中渲染敏感字段，get.ts 必须零命中。

- [ ] **Step 5: 执行开发/生产 migration 验证**

Run:

~~~bash
pnpm prisma:generate
# 开发库：确认没有 reset 提示后运行
pnpm prisma:push
pnpm exec prisma migrate diff --exit-code --from-config-datasource --to-schema=prisma/schema

# 生产：完成数据库备份、由运维确认目标连接；首次 preflight 做盘点。
psql -X -v ON_ERROR_STOP=1 "$KUN_DATABASE_URL" -f migration/production-resource-access-grant-preflight-2026-07-10.sql

# 排空旧 access writer 后再运行一次 preflight，记录同一 snapshot 的最终
# LEGACY_MAX_ID 与带时区 LEGACY_CUTOVER_AT；示例变量必须替换，不能照抄。
psql -X -v ON_ERROR_STOP=1 "$KUN_DATABASE_URL" -f migration/production-resource-access-grant-preflight-2026-07-10.sql
psql -X -v ON_ERROR_STOP=1 -v legacy_max_id="$LEGACY_MAX_ID" -v legacy_cutover_at="$LEGACY_CUTOVER_AT" "$KUN_DATABASE_URL" -f migration/production-resource-access-grant-sync-2026-07-10.sql
psql -X -v ON_ERROR_STOP=1 -v legacy_max_id="$LEGACY_MAX_ID" -v legacy_cutover_at="$LEGACY_CUTOVER_AT" "$KUN_DATABASE_URL" -f migration/production-resource-access-grant-sync-2026-07-10.sql
psql -X -v ON_ERROR_STOP=1 -v legacy_max_id="$LEGACY_MAX_ID" -v legacy_cutover_at="$LEGACY_CUTOVER_AT" "$KUN_DATABASE_URL" -f migration/production-resource-access-grant-preflight-2026-07-10.sql
pnpm exec prisma migrate diff --exit-code --from-config-datasource --to-schema=prisma/schema
~~~

Expected: 开发库 schema 同步无 reset 且 Prisma diff 退出 0；生产前检查的 visitor 身份、user 身份、actor_type 和 relation 四类异常均为 0，deleted-user tombstone 只盘点；历史重复组只记录数量、不删除或去重。第二次相同 cutoff/cutover 的 sync 应报告零次 grant backfill 和 canonical event 实际更新；最终 preflight 中列/表/PK/FK 全部为 ok，索引 ready/valid，active legacy grant 缺失或过短组数、canonical event 未对齐组数均为 0，Prisma diff 退出 0。生产执行前必须先备份数据库、核对预计 canonical 更新行数与最大延长量，并由运维确认目标连接串；sync 含 concurrent index，命令不得增加 `-1/--single-transaction`。

- [ ] **Step 6: 手动验收**

1. 游客首次获取游戏资源条目 A 的镜像 1：允许，日剩余显示“今日游客还可获取 4 个游戏资源条目”，授权截止时间为首次获取后 24 小时。
2. 同一授权期内首次点开 A 的镜像 2：允许，不减少日/周额度，不延长 expires；未点过的镜像 3 仍隐藏。
3. 刷新页面：资源条目 A 自动展开，镜像 1/2 自动恢复，镜像 3 仍隐藏；数据库不新增 grant 或 access event。
4. 超过 24 小时后刷新不恢复；再次获取 A 会重新消耗一次当前日/周额度。
5. 游客获取五个不同游戏资源条目后再获取第六个：收到日限额 429、Retry-After 和登录引导。
6. 跨过上海零点后日额度恢复；达到二十个不同游戏资源条目后周额度仍拦截。
7. 登录用户、创作者、资源 owner、管理员和 patch 资源不显示产品限额，也不受日/周产品拦截。
8. 清除 visitor cookie 后获得新的 visitor identity 与产品额度，但仍受首次 IP 30/min 技术限频；共享 IP 不承担产品额度。
9. Network 的初始资源响应、初始页面数据、RSC payload、公开缓存和持久化客户端 store 中均无真实下载凭据；凭据只出现在 access/restore 的 private, no-store 响应和组件内存状态。
10. 在开发或预发布 PostgreSQL 上，每组先建立一个新的固定 visitor token，并让该组两个请求共享同一个 cookie；不得用两个无 cookie 请求各自生成身份。使用尚无 grant/event 的隔离资源并发发送两个“同资源、同镜像”首次请求：响应应为一个 resource_granted、一个 reused；按该组验收起始时间查询 patch_resource_access，只能有一条对应镜像 event。
11. 每组继续使用新的固定 visitor token，以及尚无 grant/event 的全新隔离资源/镜像，并发发送两个“同资源、不同镜像”首次请求：响应应为一个 resource_granted、一个 link_revealed；两条 event 的 expires 完全相同，且只有一条 access_kind = resource_grant。两类竞态各重复 20 组，不能复用上一组 token；若出现重复 event，停止发布并重新评估 partial unique index，不得把 mock P2034 测试当作通过依据。
12. 对 daily 与 weekly 使用两批新的固定 visitor token，每组两个请求共享该组 token，并使用两个从未授权的资源。daily 组预置当日已用 4、weekly < 20；weekly 组预置本周已用 19，但当日用量足够低，避免 daily 优先遮住 weekly。并发请求只能新增一个 resource_grant，另一请求重试后必须返回对应 limited；两类临界竞态各重复 20 组且每组重新预置，不能出现日第 6 个或周第 21 个 grant。

- [ ] **Step 7: 单独提交文档与 skills**

~~~bash
git add docs/modules/api-services.md docs/modules/data-cache-upload.md docs/modules/frontend-content.md docs/modules/quality.md docs/project/testing.md posts/notice/download.mdx posts/notice/start.mdx .codex/skills/otoame-api/SKILL.md .codex/skills/otoame-data-cache/SKILL.md .codex/skills/otoame-frontend/SKILL.md
git commit -m "docs(resource): document visitor-first access limits"
~~~

## Rollout and Rollback

1. 先备份并运行只读 preflight，确认身份/关系异常为 0，记录 deleted-user tombstone、历史重复组、会话时区、预计 canonical 更新行数与最大延长量；deleted-user tombstone 不回填，历史重复行不删除或去重。
2. 在切换新应用前排空旧实例的 access API 写入，再次运行 preflight 并同时取得最终 `LEGACY_MAX_ID` 与带时区 `LEGACY_CUTOVER_AT`。用这组固定 snapshot 执行 sync/backfill 两次并运行 postflight。第二次 grant/canonical 更新必须均为零；列/表/PK/FK、索引 ready/valid、grant 完整性、canonical event 对齐和 Prisma diff 必须全部通过。当前 deploy:pull/deploy:build 仍会执行 prisma:push，只有 diff 为空时才允许继续，让该 push 成为 no-op。
3. 再部署并启用全部新应用代码；同一次 rollout 的固定 cutoff/cutover 在新应用运行期间不再扩大，也不得让旧/新实现长期并行写入。旧 link-level access events 以 link_reveal 保留，不进入新日/周额度；每个 cutover 时 active 的 actor/resource/link 只有一条 canonical event 延长到该资源旧事件的最晚 expires，其余历史字段和重复行保持不变。上线时仍有效的旧授权最长可能继续 72 小时，这只是迁移兼容行为，不是新产品的第二套规则；所有新授权统一为 24 小时，产品简报只描述这条新规则。
4. 上线后 14 天观察 DB 聚合的 resource_grant/link_reveal，安全 outcome 日志聚合的 manual_reused、daily_limited、weekly_limited、rate_limited、manual_failed、restore_succeeded/restore_failed，以及对应 route 的错误率；不根据 IP 做产品封禁。
5. 若 grant/restore 服务或 migration 出现异常，回滚应用到旧版本即可；极简 grant 表和 access_kind 列保留，canonical event 只被延长到同资源已有最晚旧 expires，不会超过历史最长 72 小时边界，也不会破坏旧 service 对 patch_resource_access 的读取。若旧版本恢复写入 72 小时 event，后续重新上线前必须建立新的 rollout cutoff/cutover 并再次 backfill，不能沿用上一次 snapshot。
6. 14 天后复核：游客日/周拦截率、镜像 reused 比例、登录转化、客服投诉和 access API 错误率。只有存在明确的登录用户批量获取证据时，才另写一份用户限额设计和实施计划。
