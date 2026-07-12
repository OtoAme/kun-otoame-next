# 资源访问基础表 Bootstrap Migration 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为缺少 `patch_resource_access` 的生产数据库提供可审阅、可重跑、
fail-closed 的 Phase 2 bootstrap，并加固同一上线链路中的 Steam concurrent index
恢复和 GitHub Release 固定选择。

**Architecture:** Bootstrap preflight/sync 只创建并验证历史 Phase 2 基础表，已有
grant 中断状态交给现有 grant migration 精确验证和修复。Steam migration 在资源
访问停机窗口前独立完成并具备 invalid index 恢复；`deploy:pull` 使用命令级 tag
固定已经审阅的 Release。生产不运行 `prisma db push`。

**Tech Stack:** PostgreSQL 18 catalog SQL、psql、Prisma ORM 7.8、TypeScript、
Vitest 4、Node.js 22、GitHub Releases API、Docker disposable PostgreSQL。

## Global Constraints

- 所有文件保持未暂存、未提交；未经用户审核不得运行 `git add`、`git commit`、
  push 或创建 PR。
- 不连接或修改生产数据库；真实 SQL 验收只使用新建的 disposable PostgreSQL 18
  容器和数据库。
- Bootstrap 不加入 `prisma:deploy-safe`、`deploy:pull`、`deploy:build` 或 CI 自动
  执行路径。
- 生产绝不使用 `prisma db push` 代替 bootstrap/grant preflight/sync。
- Prisma Guard 保持只读，只接受空 diff 或 catalog 验证通过的
  `patch_released_idx` 精确已知例外。
- `updated DateTime @updatedAt` 对应 `timestamp(3) without time zone NOT NULL`，
  不得存在数据库 default。
- Bootstrap sync 使用单事务和 `SET LOCAL lock_timeout = '5s'`；任何失败完整回滚。
- 现有 grant sync 继续在 psql 顶层运行，不得增加 `-1` 或
  `--single-transaction`。
- 高风险维护窗口从 bootstrap 前停止全部 PM2 实例，到固定 tag 的新 Release
  启动为止。

---

### Task 1: 锁定 Bootstrap 与 Steam Migration 静态契约

**Files:**

- Create: `tests/unit/resource-access-bootstrap-migration.test.ts`
- Read: `prisma/schema/patch-resource.prisma`
- Read: `migration/production-resource-access-grant-sync-2026-07-10.sql`

**Interfaces:**

- Consumes: 设计文档中的 Phase 2、grant 中断恢复、Steam 恢复契约。
- Produces: 对四份生产 SQL 的文件级回归门槛。

- [ ] **Step 1: 写 Bootstrap 文件存在与自动执行隔离的失败测试**

```ts
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const bootstrapPreflight =
  'migration/production-resource-access-bootstrap-preflight-2026-07-12.sql'
const bootstrapSync =
  'migration/production-resource-access-bootstrap-sync-2026-07-12.sql'

describe('resource access bootstrap production migration', () => {
  it('stays manual and fail-closed', async () => {
    const [preflight, sync, pkg, deployPull, deployBuild, release] =
      await Promise.all([
        readProjectFile(bootstrapPreflight),
        readProjectFile(bootstrapSync),
        readProjectFile('package.json'),
        readProjectFile('scripts/deployPull.ts'),
        readProjectFile('scripts/deployBuild.ts'),
        readProjectFile('.github/workflows/release.yml')
      ])

    expect(preflight).toContain('\\set ON_ERROR_STOP on')
    expect(sync).toContain('\\set ON_ERROR_STOP on')
    for (const automaticSource of [pkg, deployPull, deployBuild, release]) {
      expect(automaticSource).not.toContain(
        'production-resource-access-bootstrap-sync-2026-07-12.sql'
      )
    }
  })
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm test tests/unit/resource-access-bootstrap-migration.test.ts
```

Expected: FAIL，因为两份 bootstrap SQL 尚不存在。

- [ ] **Step 3: 补齐 Phase 2 schema、sequence、约束和索引静态断言**

测试必须逐项断言：

```ts
expect(sync).toContain("SET LOCAL lock_timeout = '5s'")
expect(sync).toContain('patch_resource_access_id_seq')
expect(sync).toContain('patch_resource_access_pkey')
expect(sync).toContain('patch_resource_access_user_id_fkey')
expect(sync).toContain('patch_resource_access_patch_id_fkey')
expect(sync).toContain('patch_resource_access_resource_id_fkey')
expect(sync).toContain('patch_resource_access_link_id_fkey')
expect(sync).toContain('patch_resource_access_user_id_link_id_expires_idx')
expect(sync).toContain(
  'patch_resource_access_visitor_token_link_id_expires_idx'
)
expect(sync).toContain('patch_resource_access_patch_id_created_idx')
expect(sync).toContain('patch_resource_access_resource_id_created_idx')
expect(sync).toContain('patch_resource_access_link_id_created_idx')
expect(sync).not.toMatch(/updated[^\n]*DEFAULT\s+CURRENT_TIMESTAMP/i)
expect(sync).not.toMatch(/\b(DROP|DELETE|UPDATE|INSERT)\b/i)
```

测试还要检查 preflight/sync 同时出现：

```text
patch_resource_access_pkey
patch_resource_access_grant_pkey
pg_get_serial_sequence
pg_depend
indisprimary
indisunique
indisready
indisvalid
indislive
ready_to_create
phase2_present
upgrade_compatible_present
```

- [ ] **Step 4: 增加 grant 中断状态和 Steam invalid index 静态断言**

```ts
expect(preflight).toContain('resource_access_grant_expires_idx')
expect(preflight).toContain('resource_access_visitor_kind_created_idx')
expect(preflight).toContain('patch_resource_access_grant')

const steamSync = await readProjectFile(
  'migration/production-steam-id-soft-duplicate-sync-2026-07-09.sql'
)
expect(steamSync).toContain('DROP INDEX CONCURRENTLY')
expect(steamSync).toContain('indisready')
expect(steamSync).toContain('indisvalid')
expect(steamSync).toContain('indislive')
expect(steamSync).toContain('steam_id index postflight failed')
```

- [ ] **Step 5: 审核点**

Run:

```bash
git status --short
git diff -- tests/unit/resource-access-bootstrap-migration.test.ts
```

Expected: 测试文件未暂存；不创建提交。

---

### Task 2: 为固定 GitHub Release Tag 写纯函数测试

**Files:**

- Create: `tests/unit/deploy-release-selection.test.ts`
- Create: `scripts/deployReleaseSelection.ts`
- Modify: `scripts/deployPull.ts`

**Interfaces:**

- Produces:
  - `getReleaseApiPath(repo: string, releaseTag?: string): string`
  - `selectReleaseAsset(release: GitHubRelease, expectedTag?: string): string`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import {
  getReleaseApiPath,
  selectReleaseAsset
} from '~/scripts/deployReleaseSelection'

describe('deploy release selection', () => {
  it('uses latest only when no release tag is supplied', () => {
    expect(getReleaseApiPath('OtoAme/kun-otoame-next')).toBe(
      '/repos/OtoAme/kun-otoame-next/releases/latest'
    )
  })

  it('encodes and pins the requested release tag', () => {
    expect(
      getReleaseApiPath('OtoAme/kun-otoame-next', 'v2026.07.12+reviewed')
    ).toBe('/repos/OtoAme/kun-otoame-next/releases/tags/v2026.07.12%2Breviewed')
  })

  it('returns release.tar.gz only for the exact expected tag', () => {
    expect(
      selectReleaseAsset(
        {
          tag_name: 'v2026.07.12.1200',
          assets: [
            {
              name: 'release.tar.gz',
              browser_download_url: 'https://example.invalid/release.tar.gz'
            }
          ]
        },
        'v2026.07.12.1200'
      )
    ).toBe('https://example.invalid/release.tar.gz')
  })

  it.each([
    [{ tag_name: 'other', assets: [] }, 'expected', 'tag mismatch'],
    [{ tag_name: 'expected', assets: [] }, 'expected', 'release.tar.gz']
  ])('fails closed: %o', (release, expectedTag, message) => {
    expect(() => selectReleaseAsset(release, expectedTag)).toThrow(message)
  })
})
```

- [ ] **Step 2: 运行并确认 RED**

Run:

```bash
pnpm test tests/unit/deploy-release-selection.test.ts
```

Expected: FAIL，模块 `scripts/deployReleaseSelection.ts` 不存在。

- [ ] **Step 3: 实现最小纯函数**

```ts
export interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
}

export interface GitHubRelease {
  tag_name: string
  assets: GitHubReleaseAsset[]
}

export const getReleaseApiPath = (repo: string, releaseTag?: string) =>
  releaseTag
    ? `/repos/${repo}/releases/tags/${encodeURIComponent(releaseTag)}`
    : `/repos/${repo}/releases/latest`

export const selectReleaseAsset = (
  release: GitHubRelease,
  expectedTag?: string
) => {
  if (expectedTag && release.tag_name !== expectedTag) {
    throw new Error(
      `GitHub release tag mismatch: expected ${expectedTag}, received ${release.tag_name}`
    )
  }

  const asset = release.assets.find(({ name }) => name === 'release.tar.gz')
  if (!asset) {
    throw new Error(`No release.tar.gz found in release ${release.tag_name}`)
  }
  return asset.browser_download_url
}
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run:

```bash
pnpm test tests/unit/deploy-release-selection.test.ts
```

Expected: PASS。

- [ ] **Step 5: 审核点**

保持文件未暂存，不提交。

---

### Task 3: 实现 Bootstrap Preflight

**Files:**

- Create:
  `migration/production-resource-access-bootstrap-preflight-2026-07-12.sql`
- Test: `tests/unit/resource-access-bootstrap-migration.test.ts`

**Interfaces:**

- Produces: psql 状态 `ready_to_create`、`phase2_present`、
  `upgrade_compatible_present`；任何不支持状态以非零退出。

- [ ] **Step 1: 保持 Task 1 测试为 RED，先创建只读脚本骨架**

```sql
-- Read-only production bootstrap preflight for patch_resource_access.
\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;
```

Catalog 检查放在这个只读事务内，脚本末尾只在所有 fingerprint 通过后执行
`COMMIT`。脚本不创建临时对象，也不调用可写函数。

- [ ] **Step 2: 实现缺表依赖和全局名称冲突检查**

必须验证四张被引用普通表及 integer 主键，并在 access 表缺失时拒绝这些 relation
名称中的任意一个：

```text
patch_resource_access
patch_resource_access_id_seq
patch_resource_access_pkey
patch_resource_access_user_id_link_id_expires_idx
patch_resource_access_visitor_token_link_id_expires_idx
patch_resource_access_patch_id_created_idx
patch_resource_access_resource_id_created_idx
patch_resource_access_link_id_created_idx
patch_resource_access_grant
patch_resource_access_grant_pkey
resource_access_grant_expires_idx
resource_access_visitor_kind_created_idx
```

使用 `pg_class` + `pg_namespace`，不使用 `to_regclass` 判断所有名称，因为同名
relation kind 也必须报告。

- [ ] **Step 3: 实现 Phase 2 fingerprint**

用 `pg_attribute`、`pg_attrdef`、`pg_constraint`、`pg_index`、`pg_depend` 验证：

- 13 个且仅 13 个基础列；如果存在 `access_kind` 则总数为 14。
- `updated` 的 `pg_attrdef` 为 null。
- `id` default 引用 `patch_resource_access_id_seq`，
  `pg_get_serial_sequence('public.patch_resource_access', 'id')` 返回精确 qualified
  sequence；sequence 通过 `pg_depend` owned by `id`。
- PK/FK 名称、列、目标、validated、NOT DEFERRABLE、not deferred、MATCH SIMPLE、
  update/delete actions。
- PK 的 `conindid` 指向 `patch_resource_access_pkey`，且 primary/unique/
  ready/valid/live。
- 五个普通索引均非唯一、非 primary、ready/valid/live、无 predicate/expression，
  列顺序和 DESC 精确匹配。

- [ ] **Step 4: 实现 grant 中断 fingerprint**

如果 `access_kind` 存在：

- grant 表可以缺失或精确匹配现有 grant sync 的三列、复合 PK、resource FK；
- grant 表缺失时 expires index 必须缺失；
- 两个 grant-owned index 分别允许 absent、exact ready/valid/live、或真实但
  invalid/not-ready/not-live；
- ready/valid/live 错误定义和同名非 index relation 失败。

如果 `access_kind` 缺失，grant 表和两个 grant-owned index 必须全部缺失。

- [ ] **Step 5: 输出状态并提交只读事务**

```sql
SELECT
  CASE
    WHEN to_regclass('public.patch_resource_access') IS NULL
      THEN 'ready_to_create'
    WHEN NOT EXISTS (
      SELECT 1
      FROM pg_attribute
      WHERE attrelid = 'public.patch_resource_access'::regclass
        AND attname = 'access_kind'
        AND attnum > 0
        AND NOT attisdropped
    ) THEN 'phase2_present'
    ELSE 'upgrade_compatible_present'
  END AS bootstrap_state;

COMMIT;
```

- [ ] **Step 6: 运行静态测试**

Run:

```bash
pnpm test tests/unit/resource-access-bootstrap-migration.test.ts
```

Expected: 仍因 sync 缺失而 FAIL，但 preflight 相关断言通过。

---

### Task 4: 实现 Bootstrap Sync

**Files:**

- Create: `migration/production-resource-access-bootstrap-sync-2026-07-12.sql`
- Test: `tests/unit/resource-access-bootstrap-migration.test.ts`

**Interfaces:**

- Consumes: Task 3 的同一 catalog fingerprint。
- Produces: 精确 Phase 2 空表；已有表状态非零退出并要求跳过 sync。

- [ ] **Step 1: 写 psql/事务骨架**

```sql
\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 在第一条 DDL 前重复 Task 3 的依赖、名称和既有 fingerprint 检查。
-- ready_to_create 才执行 DDL；已有表状态 fail-closed。

COMMIT;
```

- [ ] **Step 2: 创建精确 Phase 2 结构**

```sql
CREATE SEQUENCE public.patch_resource_access_id_seq AS integer;

CREATE TABLE public.patch_resource_access (
  id integer NOT NULL DEFAULT nextval(
    'public.patch_resource_access_id_seq'::regclass
  ),
  actor_type varchar(20) NOT NULL,
  visitor_token varchar(64) NOT NULL DEFAULT '',
  section varchar(107) NOT NULL,
  storage varchar(107) NOT NULL,
  cost integer NOT NULL DEFAULT 0,
  expires timestamp(3) without time zone NOT NULL,
  user_id integer,
  patch_id integer NOT NULL,
  resource_id integer NOT NULL,
  link_id integer NOT NULL,
  created timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated timestamp(3) without time zone NOT NULL,
  CONSTRAINT patch_resource_access_pkey PRIMARY KEY (id),
  CONSTRAINT patch_resource_access_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.user(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT patch_resource_access_patch_id_fkey
    FOREIGN KEY (patch_id) REFERENCES public.patch(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT patch_resource_access_resource_id_fkey
    FOREIGN KEY (resource_id) REFERENCES public.patch_resource(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT patch_resource_access_link_id_fkey
    FOREIGN KEY (link_id) REFERENCES public.patch_resource_link(id)
    ON DELETE CASCADE ON UPDATE NO ACTION
);

ALTER SEQUENCE public.patch_resource_access_id_seq
  OWNED BY public.patch_resource_access.id;
```

随后创建五个具名 B-tree 索引，三个 created 索引显式 `created DESC`。

- [ ] **Step 3: 在 COMMIT 前重复完整 postflight**

Postflight 使用与 preflight 相同的结构化 catalog 条件，并额外断言：

```sql
SELECT COUNT(*) = 0 AS bootstrap_table_empty,
       COALESCE(MAX(id), 0) = 0 AS bootstrap_max_id_zero
FROM public.patch_resource_access;
```

任一 false 使用 `RAISE EXCEPTION`，让整个事务回滚。

- [ ] **Step 4: 运行静态测试并确认 GREEN**

Run:

```bash
pnpm test tests/unit/resource-access-bootstrap-migration.test.ts
```

Expected: PASS。

---

### Task 5: 加固 Steam ID Concurrent Index Sync

**Files:**

- Modify:
  `migration/production-steam-id-soft-duplicate-preflight-2026-07-09.sql`
- Modify: `migration/production-steam-id-soft-duplicate-sync-2026-07-09.sql`
- Test: `tests/unit/resource-access-bootstrap-migration.test.ts`

**Interfaces:**

- Produces: 可从 `patch_steam_id_idx` invalid/not-ready/not-live 中断状态恢复的顶层
  psql sync。

- [ ] **Step 1: 确认新增静态测试在旧脚本上 RED**

Run:

```bash
pnpm test tests/unit/resource-access-bootstrap-migration.test.ts
```

Expected: FAIL，旧 sync 没有 invalid index 修复和 postflight。

- [ ] **Step 2: 在删除 unique constraint 前验证同名目标对象**

使用与 grant sync 相同的 `pg_class`/`pg_index` 分类：

- 不存在：继续；
- 同名非 index：失败；
- ready/valid/live 且定义精确：继续；
- ready/valid/live 且定义错误：失败；
- invalid/not-ready/not-live 真实 index：标记为 needs_drop。

- [ ] **Step 3: 顶层修复 invalid index**

```sql
\if :steam_index_needs_drop
  DROP INDEX CONCURRENTLY public.patch_steam_id_idx;
\endif

CREATE INDEX CONCURRENTLY IF NOT EXISTS patch_steam_id_idx
  ON public.patch (steam_id);
```

不得加显式事务或 `-1`。

- [ ] **Step 4: 增加 catalog postflight**

验证同名对象是 `public.patch(steam_id)` 的 nonunique B-tree 普通索引，且
ready/valid/live、无 predicate/expression；仍存在任何包含 `steam_id` 的 unique
constraint/unique index 时失败。

- [ ] **Step 5: 扩充只读 preflight 输出**

输出 `indisready`、`indisvalid`、`indislive`、access method、predicate 和
expression，使运维能区分 exact、repairable 和 incompatible。

- [ ] **Step 6: 运行测试并确认 GREEN**

Run:

```bash
pnpm test tests/unit/resource-access-bootstrap-migration.test.ts
```

Expected: PASS。

---

### Task 6: 接入固定 Release Tag

**Files:**

- Modify: `scripts/deployPull.ts`
- Modify: `tests/unit/prisma-production-deploy-command.test.ts`
- Test: `tests/unit/deploy-release-selection.test.ts`

**Interfaces:**

- Consumes: `getReleaseApiPath`、`selectReleaseAsset`。
- Produces: command-scoped `KUN_DEPLOY_RELEASE_TAG` pin。

- [ ] **Step 1: 修改 release JSON 获取函数**

`deployPull.ts` 读取：

```ts
const expectedReleaseTag = process.env.KUN_DEPLOY_RELEASE_TAG?.trim()
const releasePath = getReleaseApiPath(repo, expectedReleaseTag || undefined)
```

解析 JSON 后调用：

```ts
const url = selectReleaseAsset(release, expectedReleaseTag || undefined)
```

日志必须显示 resolved `tag_name`，但不得输出 token。

- [ ] **Step 2: 增加部署顺序静态测试**

`tests/unit/prisma-production-deploy-command.test.ts` 断言：

```ts
expect(source).toContain('KUN_DEPLOY_RELEASE_TAG')
expect(source.indexOf('selectReleaseAsset')).toBeLessThan(
  source.indexOf("console.log('Applying atomic update...')")
)
expect(source.indexOf('selectReleaseAsset')).toBeLessThan(
  source.indexOf("console.log('Reloading application...')")
)
```

- [ ] **Step 3: 运行聚焦测试**

Run:

```bash
pnpm test tests/unit/deploy-release-selection.test.ts tests/unit/prisma-production-deploy-command.test.ts
```

Expected: PASS。

---

### Task 7: PostgreSQL 18 Disposable 验收

**Files:**

- Verify only; 不创建生产连接脚本。

**Interfaces:**

- Consumes: Task 3–5 SQL。
- Produces: PostgreSQL 18 实际 catalog、重跑和中断恢复证据。

- [ ] **Step 1: 创建专用 PostgreSQL 18 容器**

```bash
docker run --rm -d \
  --name otoame-resource-bootstrap-pg18 \
  -e POSTGRES_PASSWORD=bootstrap_test_only \
  -e POSTGRES_DB=otoame_bootstrap_test \
  -p 127.0.0.1::5432 \
  postgres:18-alpine
```

只使用该容器；不得复用用户本地或生产 PostgreSQL 容器。

- [ ] **Step 2: 用当前 Prisma schema 创建 disposable baseline**

从 `docker port` 取得随机端口，并仅对当前命令设置测试 URL：

```bash
KUN_DATABASE_URL='postgresql://postgres:bootstrap_test_only@127.0.0.1:<port>/otoame_bootstrap_test?schema=public' \
  pnpm prisma db push --skip-generate
```

随后删除 `patch_resource_access_grant` 和 `patch_resource_access`，保留四张依赖表。

- [ ] **Step 3: 验证 missing baseline 和幂等**

依次运行 bootstrap preflight、sync、preflight；断言状态为
`ready_to_create -> phase2_present`、`COUNT(*)=0`、`MAX(id)=0`。第二次 sync 必须
非零退出且 catalog 不变。

- [ ] **Step 4: 验证错误和冲突矩阵**

使用独立 disposable database/schema 逐项制造并断言非零退出且无 bootstrap
对象残留：

- 缺依赖表；
- access 表名、sequence、两个 PK 名、五个基础索引名、grant 表名、两个 grant
  索引名冲突；
- `updated DEFAULT CURRENT_TIMESTAMP`；
- sequence ownership/default 错误；
- FK action/deferrability/validation 错误；
- `lock_timeout` 被另一个 session 持锁触发。

- [ ] **Step 5: 验证非空 Phase 2 和 grant 每个中断点**

创建一组引用一致的 legacy event，固定实际 `MAX(id)>0` 和带 offset cutover，运行
两次 grant sync及 postflight。分别在 access_kind、grant table、grant expires
index、visitor index 后构造中断状态；preflight 必须接受、bootstrap sync 必须拒绝
重复写入，grant sync 必须恢复。

- [ ] **Step 6: 验证 Steam invalid index 恢复**

创建同名 invalid/not-ready 测试索引，运行加固 sync 后验证 exact
ready/valid/live；创建同名非 index 和 ready/valid/live 错误定义时必须在删除 unique
约束前失败。

- [ ] **Step 7: 运行 Prisma Guard**

对最终 disposable schema 运行：

```bash
KUN_DATABASE_URL='<disposable URL>' \
  pnpm exec esno scripts/checkPrismaProductionSchema.ts
```

Expected: clean，或仅 catalog 验证通过的 `patch_released_idx` 精确例外。

- [ ] **Step 8: 删除 disposable 容器**

```bash
docker stop otoame-resource-bootstrap-pg18
```

---

### Task 8: 同步运维文档与项目 Skills

**Files:**

- Modify: `README.md`
- Modify: `docs/project/deployment.md`
- Modify: `docs/modules/operations.md`
- Modify: `docs/modules/data-cache-upload.md`
- Modify: `docs/project/testing.md`
- Modify: `docs/project/review.md`
- Modify: `.codex/skills/otoame-data-cache/SKILL.md`
- Modify: `.codex/skills/otoame-operations/SKILL.md`
- Modify: `.codex/skills/otoame-deployment/SKILL.md`
- Modify: `.codex/skills/otoame-testing/SKILL.md`
- Modify: `.codex/skills/otoame-review/SKILL.md`

**Interfaces:**

- Produces: 与实际 SQL、固定 tag、停机/恢复顺序一致的中文运维说明。

- [ ] **Step 1: 写失败的文档契约断言**

扩充 `tests/unit/resource-access-bootstrap-migration.test.ts`，要求 deployment、
operations、data-cache、testing、review 和相关 skills 同时包含 bootstrap pair、
grant pair、`KUN_DEPLOY_RELEASE_TAG`、生产禁止 `prisma:push`、停旧应用和中止后不
恢复旧 Release。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
pnpm test tests/unit/resource-access-bootstrap-migration.test.ts
```

Expected: FAIL，文档尚未同步。

- [ ] **Step 3: 更新文档和 skills**

运维命令必须明确：Steam 先行 postflight、固定 tag、新增 bootstrap
preflight/sync、实际 snapshot、两次 grant sync、Guard、deploy pull。示例不得
包含真实容器名、用户名、密码或连接串。

- [ ] **Step 4: 运行测试确认 GREEN**

Run:

```bash
pnpm test tests/unit/resource-access-bootstrap-migration.test.ts
```

Expected: PASS。

---

### Task 9: 全量验证和独立审阅

**Files:**

- Verify all modified/untracked files.

- [ ] **Step 1: 格式与占位符检查**

```bash
pnpm exec prettier --check \
  docs/superpowers/specs/2026-07-12-resource-access-bootstrap-migration-design.md \
  docs/superpowers/plans/2026-07-12-resource-access-bootstrap-migration.md \
  tests/unit/resource-access-bootstrap-migration.test.ts \
  tests/unit/deploy-release-selection.test.ts \
  scripts/deployReleaseSelection.ts \
  scripts/deployPull.ts
rg -n "T[B]D|TO[D]O|f[i]ll in|implement late[r]" docs .codex/skills README.md
git diff --check
```

- [ ] **Step 2: 聚焦测试**

```bash
pnpm test \
  tests/unit/resource-access-bootstrap-migration.test.ts \
  tests/unit/deploy-release-selection.test.ts \
  tests/unit/prisma-production-deploy-command.test.ts \
  tests/unit/prisma-production-schema-guard.test.ts
```

- [ ] **Step 3: 资源访问与全量回归**

```bash
pnpm test \
  tests/unit/api/resource-access-policy.test.ts \
  tests/unit/api/resource-access-grant.test.ts \
  tests/unit/api/resource-access-rate-limit.test.ts \
  tests/unit/api/resource-access.test.ts \
  tests/unit/api/resource-access-restore.test.ts \
  tests/unit/resource-download-card.test.tsx \
  tests/unit/resource-download-restore.test.tsx
pnpm test
pnpm prisma:generate
pnpm typecheck
pnpm build
```

- [ ] **Step 4: 独立审阅**

审阅者必须重点复查：SQL 首次写入前 fail-closed、sync 事务边界、grant 每个中断
点、Steam invalid index、Release tag mismatch、Guard 顺序、无生产自动执行入口。

- [ ] **Step 5: 最终用户审核点**

```bash
git status --short --branch
git diff --stat
git diff --cached --name-only
```

Expected: 所有实现文件未暂存；cached diff 为空；向用户报告验证证据并等待提交
批准。
