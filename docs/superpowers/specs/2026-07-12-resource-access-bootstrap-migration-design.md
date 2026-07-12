# 资源访问基础表 Bootstrap Migration 设计

## 背景与根因

生产数据库目前不存在 `public.patch_resource_access`。资源访问 grant
上线无法继续，因为 `production-resource-access-grant-sync-2026-07-10.sql`
有意要求旧 Phase 2 事件表已经存在，然后才在其上增加 grant 语义。

Git 历史表明，`patch_resource_access` 最初由
`1c32a7fa feat(resource): record download access reuse` 引入；它在 rebase
前的等价提交是 `818d273f` 和 `f985ae71`。这些提交加入了 Prisma model、
关联关系、应用行为和测试，但没有加入任何受版本控制的生产 SQL。本地数据库
因此是通过开发环境的 `prisma db push` 创建的，而生产数据库从未获得 Phase 2
结构。后续 grant migration 正确实现了 Phase 2 到 grant 模型的转换，但对于
从未运行过 Phase 2 的环境，它错误地成为了第一份生产 migration。

生产 Prisma Guard 没有允许部署隐式修改数据库，而是暴露了这个缺失的
migration。在补齐并验证 bootstrap 路径之前，当前 Release 必须保持未部署
状态。

## 决策

新增一对独立、手工执行、fail-closed 的 bootstrap preflight/sync，只负责
创建缺失的 Phase 2 `patch_resource_access` 基础表。保持现有 grant migration
不变；bootstrap 完成后，立即用空的 legacy snapshot 运行现有 grant migration。

新增文件：

- `migration/production-resource-access-bootstrap-preflight-2026-07-12.sql`
- `migration/production-resource-access-bootstrap-sync-2026-07-12.sql`

Bootstrap 不加入 `prisma:deploy-safe`，也绝不由 `deploy:pull` 或
`deploy:build` 自动执行。运维必须先备份数据库，运行 review 通过的
bootstrap，再运行现有 grant migration，并在激活 Release 前通过 Prisma
Guard。

## 目标

- 让不存在 `patch_resource_access` 的生产数据库无需运行
  `prisma db push` 也能安全上线。
- 根据原始 Prisma model 精确重建 Phase 2 基础结构。
- 保持已经 review 的 grant migration 为以下内容的唯一所有者：
  `access_kind`、`patch_resource_access_grant`、grant 回填、canonical event
  规范化以及 grant 专用索引。
- 确保 preflight 可安全重跑；sync 只接受缺表状态，已有表时 fail-closed 并要求
  运维根据 preflight 状态直接进入 grant 流程。
- 在发布新 Release 前，使用 PostgreSQL 18 验证缺表路径。

## 非目标

- 不修改应用、API、额度、restore 或缓存行为。
- 不修改 Prisma schema。
- 不修改 `prisma:deploy-safe`、Prisma Drift Guard 或部署脚本。
- 不恢复或复用已放弃的 Phase 3 代码。
- 不在生产运行 `prisma db push`。
- 不执行破坏性清理，也不提供 down migration。
- 当源事件表从未存在时，不合成任何历史事件。

## 支持的源数据库状态

Bootstrap 只识别以下三种源状态：

1. **基础表缺失：** `public.patch_resource_access` 不存在，并且所有依赖和
   对象名称检查均通过。Preflight 报告 `ready_to_create`；sync 创建 Phase 2
   基础结构。
2. **有效的 Phase 2 基础表：** relation 拥有原始列、约束、sequence/default
   和五个索引，但没有 `access_kind`。Preflight 报告 `phase2_present`；sync
   证明无需 bootstrap 写入；sync 拒绝重复执行。
3. **有效且可继续 grant 升级的表：** relation 拥有精确的 Phase 2 基础结构和
   当前精确定义的 `access_kind`。`patch_resource_access_grant` 可以缺失或拥有
   当前精确定义；两个 grant-owned 索引可以缺失、精确 ready/valid/live，或者
   是由现有 grant sync 修复的 invalid/not-ready/not-live 真实索引。Preflight
   报告 `upgrade_compatible_present`；sync 拒绝重复执行。这个状态覆盖 grant sync 在
   `access_kind`、grant 表以及两个顶层 concurrent index 之间的每一个正常中断
   点，也覆盖精确最终结构。

任何部分表、错误 relation 类型、意外列、不兼容 default、错误约束、错误索引
定义，或者 sequence/index relation 名称冲突，都必须在首次写入之前失败。
唯一例外是两个 grant-owned 索引为真实索引但尚未 ready/valid/live；bootstrap
允许把它们交给现有 grant sync 修复。Grant 表缺失时不得单独存在 grant expires
索引，`access_kind` 缺失时不得存在 visitor 索引。Bootstrap 不修复含义不明确的
既有对象。

## Phase 2 基础结构

Sync 创建以下逻辑表结构：

| 列              | PostgreSQL 结构                                                     |
| --------------- | ------------------------------------------------------------------- |
| `id`            | integer 非空主键，由 `patch_resource_access_id_seq` 支持            |
| `actor_type`    | `varchar(20) NOT NULL`                                              |
| `visitor_token` | `varchar(64) NOT NULL DEFAULT ''`                                   |
| `section`       | `varchar(107) NOT NULL`                                             |
| `storage`       | `varchar(107) NOT NULL`                                             |
| `cost`          | `integer NOT NULL DEFAULT 0`                                        |
| `expires`       | `timestamp(3) without time zone NOT NULL`                           |
| `user_id`       | nullable integer                                                    |
| `patch_id`      | integer，非空                                                       |
| `resource_id`   | integer，非空                                                       |
| `link_id`       | integer，非空                                                       |
| `created`       | `timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP` |
| `updated`       | `timestamp(3) without time zone NOT NULL`                           |

`updated DateTime @updatedAt` 由 Prisma ORM 层维护，不产生数据库
`DEFAULT`。Catalog 中不得存在该列的 `pg_attrdef`。`id` 使用 Prisma 对 PostgreSQL
自增整数生成的 serial 契约：

- 列为 `integer NOT NULL`，不是 identity，也不是 generated；
- default 精确为
  `nextval('public.patch_resource_access_id_seq'::regclass)`；
- `public.patch_resource_access_id_seq` 由
  `public.patch_resource_access.id` `OWNED BY`；
- 只验证 sequence 结构和 ownership，不验证 sequence 当前值。

Catalog 验证必须使用 sequence OID、`pg_depend`、
`pg_get_serial_sequence` 以及 default 实际引用的 `regclass` 做结构化比较，不能
依赖 `pg_get_expr` 是否渲染出 `public.` 前缀；该文本会受 `search_path` 和对象
可见性影响。Sequence 还必须符合 integer serial 语义。

主键名称精确为 `patch_resource_access_pkey`。四个外键名称精确为：

- `patch_resource_access_user_id_fkey`；
- `patch_resource_access_patch_id_fkey`；
- `patch_resource_access_resource_id_fkey`；
- `patch_resource_access_link_id_fkey`。

外键与原始 Prisma model 保持一致：

- `user_id -> public.user(id)`，`ON DELETE SET NULL`，`ON UPDATE NO ACTION`；
- `patch_id -> public.patch(id)`，`ON DELETE CASCADE`，`ON UPDATE NO ACTION`；
- `resource_id -> public.patch_resource(id)`，`ON DELETE CASCADE`，
  `ON UPDATE NO ACTION`；
- `link_id -> public.patch_resource_link(id)`，`ON DELETE CASCADE`，
  `ON UPDATE NO ACTION`。

主键和外键都必须处于 validated 状态，均为 `NOT DEFERRABLE` 且不是 initially
deferred；外键全部使用 `MATCH SIMPLE`。除了上面列出的 delete/update 动作，列
顺序、被引用表和被引用列也必须精确匹配。

Bootstrap 只拥有原始的五个非唯一 B-tree 索引：

- `patch_resource_access_user_id_link_id_expires_idx`，字段顺序为
  `(user_id, link_id, expires)`；
- `patch_resource_access_visitor_token_link_id_expires_idx`，字段顺序为
  `(visitor_token, link_id, expires)`；
- `patch_resource_access_patch_id_created_idx`，字段顺序为
  `(patch_id, created DESC)`；
- `patch_resource_access_resource_id_created_idx`，字段顺序为
  `(resource_id, created DESC)`；
- `patch_resource_access_link_id_created_idx`，字段顺序为
  `(link_id, created DESC)`。

现有 grant migration 继续负责：

- `access_kind varchar(20) NOT NULL DEFAULT 'link_reveal'`；
- `public.patch_resource_access_grant`；
- `resource_access_grant_expires_idx`；
- `resource_access_visitor_kind_created_idx`；
- legacy grant/canonical event 数据转换。

## Bootstrap Preflight

只读 preflight 使用 `psql -X -v ON_ERROR_STOP=1` 语义，并且绝不输出数据库
连接串。它检查：

1. `public.user`、`public.patch`、`public.patch_resource` 和
   `public.patch_resource_link` 均作为普通表存在。
2. 每个被引用的 `id` 列都是预期的 integer 主键目标。
3. 如果 `patch_resource_access` 不存在，其表名、sequence 名、
   `patch_resource_access_pkey`、五个基础索引名、
   `patch_resource_access_grant`、`patch_resource_access_grant_pkey`，以及两个
   grant-owned 索引名均不得已经存在。缺少基础事件表却存在这些 grant 对象属于
   不支持的部分升级状态，必须在 bootstrap 首次写入前失败。
4. 如果表已存在，其 relation 类型、列清单与列结构、serial sequence
   ownership/default、具名主键、四个具名外键以及五个基础索引必须精确符合
   Phase 2 契约；同时验证 constraint 的 validated、deferrability、match、
   update/delete action。`updated` 必须没有 database default。
5. 如果 `access_kind` 已存在，只接受当前最终结构对应的类型、长度、default、
   nullability，以及非 generated/non-identity 属性。
6. 如果 `patch_resource_access_grant` 已存在，必须精确匹配当前 grant sync 对
   relation 类型、三列、具名复合主键、资源外键及其 validation/deferrability/
   action 的完整契约；`patch_resource_access_grant_pkey` 必须是该主键的有效
   backing index。
7. 对 `resource_access_grant_expires_idx` 和
   `resource_access_visitor_kind_created_idx` 分别按现有 grant sync 的恢复契约
   分类：缺失时接受；定义精确且 ready/valid/live 时接受；同名对象是真实索引
   但 invalid、not-ready 或 not-live 时接受并交给 grant sync 修复；同名对象为
   ready/valid/live 但定义不兼容，或者同名 relation 不是索引时失败。
8. 主键必须通过 `pg_constraint.conindid` 指向具名 backing index；backing index
   必须 `indisprimary`、`indisunique`、ready/valid/live。
9. 除精确的 Phase 2 清单和明确允许的 grant 升级附加项之外，不接受其他
   意外列或用户定义索引。

Preflight 输出一个明确的状态分类以及详细 catalog 证据。任何不支持的状态都
必须在 `ON_ERROR_STOP` 下触发 SQL error，使命令以非零状态退出。

## Bootstrap Sync

Sync 在写入前重复所有安全关键的依赖、名称冲突和既有结构检查，然后按以下规则
执行：

- 对于 `ready_to_create`，在一个事务中创建空的 Phase 2 表、
  sequence/default、具名主键/外键约束以及五个索引。因为新表为空，所以使用
  普通索引创建；使用 concurrent index 不会减少有意义的既有表锁，反而会增加
  复杂度。
- 事务开始后、执行 DDL 前运行 `SET LOCAL lock_timeout = '5s'`。外键创建需要
  锁定被引用的热表；如果超时，整个事务回滚并以非零状态退出，运维在维护窗口
  重试，不无限等待。`statement_timeout` 可以通过明确的 psql 参数配置，但不能
  削弱 `lock_timeout` 的 fail-closed 行为。
- 在 commit 前运行完整基础结构的 catalog postflight。任何不匹配都会回滚
  事务。
- 对于 `phase2_present` 或 `upgrade_compatible_present`，sync 在事务内确认表已
  存在后以非零状态退出，不执行 DDL/DML；运维使用 preflight 证据直接进入 grant
  migration。这样 stdin/Docker 执行不依赖 `\ir`，也不会用 no-op 掩盖 preflight
  后的竞态。
- 对于其他所有状态，在 `BEGIN` 前或第一条 DDL 前失败。

该文件不包含 `DROP`、`DELETE`、`UPDATE`、`INSERT` 或数据回填。它绝不使用
宽泛的 `IF NOT EXISTS` 来隐藏不兼容对象。

## 交接给 Grant Migration

Bootstrap 创建空的基础表后，运维继续运行现有 resource-access grant 流程。
为消除历史 rebase commit、Release artifact 和运行中代码版本判断错误，设计不
提供旧应用继续运行的路径。在第一次 bootstrap 写入前，必须停止全部生产应用
进程并确认没有存活实例；从此时起一直保持停止，直到 bootstrap、grant
migration、Guard 全部完成且新 Release 启动。不能仅凭表当前缺失、提交时间或
单一 commit hash 推断旧应用不会写入。

Bootstrap 完成后必须实际查询 `COUNT(*)` 和 `COALESCE(MAX(id), 0)`：

- 本次由 `ready_to_create` 创建的新表必须同时满足 `COUNT(*) = 0` 和
  `MAX(id) = 0`，然后使用以下空表 snapshot；
- `phase2_present` 或 `upgrade_compatible_present` 路径允许存在 legacy 行，必须
  在停机后使用 grant preflight 输出的实际非负 `MAX(id)` 和带时区 cutover，
  不能强制改成 `0`，并由现有 grant sync 完成 backfill。

```text
legacy_max_id = bootstrap 后实际查询得到的 0
legacy_cutover_at = bootstrap 后 resource-access preflight 输出的、
                    明确包含 UTC offset 的时间
```

无论 snapshot 是否为零，都必须使用同一次 grant preflight 输出的精确值；运维
不得自行编造或取整。现有 grant sync 使用同一组值运行两次，并且不得增加 `-1`
或 `--single-transaction`。从实际读取 `MAX(id)` 到新 Release 启动之间，所有旧
应用进程必须持续保持停止。第二次运行必须报告零次实际 grant 或 canonical event
更新。固定 snapshot postflight 必须证明最终 schema 和索引有效，并且
missing/short/unaligned 计数全部为零。

## 部署与可用性

运维必须使用维护窗口，在第一次 schema 写入前停止生产应用并完成经过验证的
数据库 dump。如果有限 `lock_timeout` 触发，必须让事务完整回滚后再重试；不得
为了恢复服务跳过 bootstrap、grant migration 或 Guard。

Steam ID soft-duplicate migration 必须在本次停机窗口前独立完成。其 sync 需要先
加固为：精确有效索引直接接受；invalid/not-ready/not-live 的同名真实索引使用
顶层 `DROP INDEX CONCURRENTLY` 后重建；ready/valid/live 但定义错误或同名非索引
relation 时失败；创建后执行 catalog postflight。只有 Steam preflight/postflight
均通过，才允许进入下面的资源访问维护窗口。

`deploy:pull` 默认解析 GitHub latest Release，因此本次高风险维护窗口必须使用
命令级 `KUN_DEPLOY_RELEASE_TAG` 固定已经 review 的 tag。Deploy helper 必须按该
tag 请求 Release、验证返回 `tag_name` 完全一致并找到 `release.tar.gz`；缺失、
不匹配或下载失败都必须在替换 standalone、启动 PM2 前退出。该变量只作用于当前
部署命令，不写入长期 `.env`。

新的上线顺序为：

1. 发布包含已 review bootstrap 脚本的新 Release；
2. 记录并冻结本次目标 Release tag；在生产应用仍运行时完成加固后的 Steam
   preflight、sync 和 postflight；
3. 更新生产源码 checkout 以取得 migration 文件，但不运行 `deploy:pull`，也不
   激活新 standalone；
4. 确认生产数据库目标，停止全部 PM2 应用实例并验证没有存活进程；
5. 完成经过验证的 custom-format dump；
6. 运行 bootstrap preflight、sync 和 postflight；`ready_to_create` 必须确认
   `COUNT(*) = 0` 且 `MAX(id) = 0`，已有表路径则保留实际 legacy snapshot；
7. 运行 resource grant preflight、两次固定 snapshot sync 和 postflight；
8. 运行 `pnpm exec esno scripts/checkPrismaProductionSchema.ts`；
9. 仅在 Guard 退出 `0` 且结果为空 diff，或只有经过 catalog 验证的
   `patch_released_idx` 已知例外后，才允许进入部署步骤；
10. 使用 `KUN_DEPLOY_RELEASE_TAG='<已冻结 tag>' pnpm deploy:pull`，确认脚本下载
    和启动的 tag 与冻结值完全一致；
11. 执行 PM2 与资源访问冒烟验收。

如果 bootstrap 成功但部署中止，保留这个仅新增的表，并保持全部旧应用进程
停止；不得重启旧 Release。排除故障后重新运行 bootstrap preflight（预期
`phase2_present` 或 `upgrade_compatible_present`），再运行无变量 grant
preflight，重新取得实际非负 `MAX(id)` 和带时区 cutover。不得沿用先前的
legacy max ID 或 cutover；必须用新 snapshot 完成 grant sync、postflight 和
Guard，最后只启动冻结 tag 对应的新 Release。生产回滚绝不删除该表或其约束。

## 测试与验证

### 静态契约测试

新增一个 Vitest 测试，读取两份 bootstrap SQL 并锁定：

- 预期文件名及 `ON_ERROR_STOP` 行为；
- 13 个基础列及其关键类型/default/nullability；
- `updated` 没有 database default；
- `id` 的 sequence default、ownership，以及 non-identity/non-generated 契约；
- 精确的主键/外键名称，以及 validation、deferrability、match、delete/update
  动作；
- 五个精确基础索引名和字段顺序；
- 支持的状态分类；
- 不存在破坏性语句和数据变更语句；
- `package.json`、部署脚本和 CI 不会自动调用 bootstrap。

### PostgreSQL 18 验收矩阵

仅在 disposable PostgreSQL 18 数据库上运行，绝不使用生产目标：

1. 缺少依赖表 -> preflight/sync 失败，且不创建 access relation；
2. 表名/sequence 名、两个 PK backing-index 名及普通索引名冲突 -> 在修改前
   失败；
3. 已存在但结构错误的 access 表 -> 在修改前失败；
4. 缺表 baseline -> preflight 输出 `ready_to_create`，sync 创建精确 Phase 2
   结构；
5. 第二次 bootstrap sync -> 非零退出并明确提示跳过 sync，catalog 不变；
6. 精确 Phase 2 表 -> preflight 接受，sync 拒绝重复写入；
7. grant sync 在 `access_kind`、grant 表、grant expires concurrent index、visitor
   concurrent index 后的每个中断点 -> preflight 接受，bootstrap sync 拒绝重复写入，现有 grant sync
   能继续完成；
8. 任一 grant-owned 索引为真实索引但 invalid/not-ready/not-live -> 接受并交给
   现有 grant sync 修复；ready/valid/live 但定义错误，或同名对象不是索引 ->
   失败；
9. bootstrap 后实际查询得到 `MAX(id)=0`，再用固定 `legacy_max_id=0` 运行现有
   grant sync -> 最终 postflight 通过；
10. 非空 Phase 2 表 -> 使用停机后的实际非负 `MAX(id)` 和 cutover 完成 legacy
    backfill；
11. 第二次 grant sync -> 零数据更新；
12. `SET LOCAL lock_timeout = '5s'` 触发 -> bootstrap 事务完整回滚，不留下表、
    sequence、约束或索引；
13. 加固后的 Steam sync 遇到 invalid/not-ready/not-live 索引 -> concurrent
    drop/recreate 后 postflight 通过；错误定义和同名非索引 -> 修改前失败；
14. Prisma schema guard -> 退出 `0`，只允许空 diff 或经过 catalog 验证的
    `patch_released_idx` 例外。
15. 模拟 bootstrap 后部署中止 -> 旧 Release 不得重启；重跑 preflight 确认状态并
    跳过 bootstrap sync，
    grant preflight 必须重新取得实际 snapshot，完成迁移和 Guard 后才允许启动
    新 Release。
16. `KUN_DEPLOY_RELEASE_TAG` 缺失匹配 Release、tag 不一致或缺少
    `release.tar.gz` -> 在 standalone 替换和 PM2 启动前失败。

最终仓库验证包括：聚焦 migration 测试、全部资源访问测试、完整 Vitest、Prisma
Client 生成、typecheck、生产 build、格式化、`git diff --check`，以及没有未解决
Critical 或 Important finding 的独立代码审查。

## 文档变更

更新部署、运维、数据/缓存、测试、审查和项目 skill 指引，说明：

- 生产环境缺少 `patch_resource_access` 时，必须先运行 bootstrap pair，再运行
  grant pair；
- 已有 Phase 2/最终结构的环境经过精确验证后会跳过 bootstrap 写入；
- 生产绝不使用 `prisma:push` 代替 bootstrap；
- bootstrap 只新增结构，并且必须保持手工、review 后执行；
- 缺少 bootstrap 的当前 Release 不得部署到缺表生产数据库。

## 被否决的替代方案

### 扩展现有 Grant Sync

这样可以减少运维命令数量，但会把两个独立状态转换混入一份已经很大的
migration，增加真实运行过 Phase 2 的数据库的回归风险，也让失败边界更难
review。

### 在生产运行 `prisma db push`

这会绕过 review 过的 SQL，可能应用无关 drift，并与 fail-closed 生产 Guard
冲突。它还可能尝试重复重建 `patch_released_idx`。

### 恢复已放弃的 Phase 3 代码

原始 Phase 2 提交及其已知的 pre-rebase 版本均不存在受版本控制的生产创建
脚本。即使找到 dangling Phase 3 代码，它也不是当前 grant/access 设计的可信
来源。原始 Phase 2 Prisma model 和当前最终 schema 已经提供了编写 review 后
bootstrap 所需的明确契约。
