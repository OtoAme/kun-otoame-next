# 标签 / 会社计数一致性实施计划

**Goal:** 把 `patch_tag.count` 与 `patch_company.count` 的维护从应用层手工增减改为数据库触发器，消除关系级联删除后的计数残留与并发插入下的计数偏差，并让「计数 = 关系行数」成为可断言的不变量。

**Architecture:** 计数不再由任何应用代码修改。关系插入 / 删除 / 外键改写由数据库触发器维护父行 `count`；应用层只保留**实际关系变更的返回值**用于决定缓存失效，不再读写 `count`。

**Tech Stack:** Prisma 7.8 / PostgreSQL 18、Next.js 15.5.18、Vitest 4。

**范围外：** 会社身份解析。见 `docs/superpowers/plans/2026-08-30-company-identity-resolution.md`；那份计划的阶段 8（resolver 接管写入）**必须等本计划落地之后**才能开始，否则关系插入会同时存在两套计数语义。

**在身份计划里的位置是阶段 6**，排在唯一约束（阶段 7）之前，并且**不占用阶段 7–8 的停写窗口**——本批次与身份约束互相独立，自己的写阻塞只有 sync 回填时的 `LOCK TABLE … IN SHARE MODE`，分钟级且自限。

## 为什么要做（本地实测口径）

上游 `465f5db9 fix(patch): tag/company counts via db triggers` 报告了生产上 +2738 tag / +50 company 的计数虚高。本仓库的情况**与上游不同，需要分开说**：

- **会社的级联删除已经修好了。** `app/api/patch/delete.ts:109-121` 在删除游戏后用 `COUNT(relation.id)` 重算了相关会社的 `count`。所以会社不存在上游那类删除残留。
- **标签的级联删除没有修。** `delete.ts` 里没有对应的 `patch_tag` 重算，`patch_tag_relation` 随 patch 级联删除后 `patch_tag.count` 不会回退。这是本仓库现存的真实数据完整性问题，也解释了上游为什么 tag 的偏差量级远大于 company。
- **并发偏差对两者都成立。** 计数散在 8 处运行时代码里，模式都是「插入关系后再 `count + 1`」。不同写入路径（批量标签、外部数据 ensure、投稿发布、详情页增删）并发时，判断「哪些是新插入」与实际插入之间存在窗口，偏差不可避免也不可审计。

所以本批次的价值是：**修掉 tag 的删除残留**、**关掉全部并发窗口**、并把「`count` 是派生值」这件事变成数据库保证而不是纪律。

## 已定方向

1. **采用数据库触发器，删除应用层全部手工增减。** 不保留「双写 + 校验」过渡态——两套语义并存必然双计数。
2. **独立批次，独立提交。** 不与会社身份解析混在同一阶段或同一提交里。
3. **必须在 resolver 接管写入之前落地。**
4. **用本仓库的 `production preflight` / `sync` SQL 对**，不直接照搬上游那个单文件 TypeScript 迁移脚本。
5. **不触发 Prisma 漂移守卫的索引例外**——触发器不是 Prisma 管理的索引，`scripts/checkPrismaProductionSchema.ts` 比对的是索引元数据。但触发器的**存在性**、SQL 内容与回滚方式仍要有契约测试。
6. **`count` 列保留**（读路径与排序索引 `@@index([count(sort: Desc), id(sort: Desc)])` 依赖它），只是不再由应用写入。

## 触发器形态：statement-level（已定），上游有可复用的参考实现

`465f5db9` 的提交信息写的是 _row-level_，**但实现不是**。`upstream/main:migration/ensureTagCompanyCounters.ts:83-101` 实际是：

```sql
CREATE TRIGGER <name>_ins AFTER INSERT ON "<relation>"
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION <name>_ins()
-- _del: REFERENCING OLD TABLE AS old_rows
-- _upd: REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
```

即 **statement-level + transition table，每张关系表三个触发器（INSERT / DELETE / UPDATE）**。所以本仓库采用 statement-level **不是本地分叉**，上游那份文件可以直接作参考实现，只需改造成本仓库的 preflight / sync SQL 形态（不照搬那个单文件 TypeScript 脚本）。

**UPDATE 触发器不能省。** 本计划先前以「关系行的外键从不被改写」为理由省掉它——那恰好违背立项目的：不变量应由数据库保证，而不是靠「当前应用没有 update」这条会过期的假设。PostgreSQL 文档与上游实现都是三个独立触发器，照做。

## 改动清单

### 1. 删除运行时手工计数（8 处）

| 文件                                        | 位置            | 当前行为                         |
| ------------------------------------------- | --------------- | -------------------------------- |
| `app/api/edit/companyRelationHelper.ts`     | `:34` / `:62`   | 会社关系插入后 `+1`、删除后 `-1` |
| `app/api/edit/batchTag.ts`                  | `:110` / `:121` | 批量标签 `+1` / `-1`             |
| `app/api/edit/processExternalData.ts`       | `:95`           | 外部标签 ensure `+1`             |
| `app/api/patch/introduction/tag/service.ts` | `:44` / `:69`   | 详情页加 / 删标签                |
| `app/api/patch-submission/publishCore.ts`   | `:126`          | 投稿发布时标签 `+1`              |

`addPatchCompanyRelations` / `removePatchCompanyRelations` 的 `RETURNING "company_id"` **保留**——返回值仍用于判断是否需要 `invalidateCompanyCaches()`，只是不再拿它去改 `count`。同理标签路径保留「本次是否真的插入了关系」的判断。

### 2. 绝对重算保留到最后再删

`app/api/patch/delete.ts:109-121` 的会社计数重算在触发器生效后是冗余的，但**第一批不要删**：它是 `SET count = 绝对值`、不是增量，留着不会双计数，而在触发器还没装上的窗口里它仍然在修数据。**等触发器安装并通过 postflight 之后**再单独删除。

### 3. 迁移脚本里的残留（必须在装触发器**之前**清掉）

`migration/syncSteamData.ts:84`、`:134` 与 `migration/syncVndbTags.ts:244` 仍会手工 `+1`。它们不是常驻代码，但 sync 之后**误执行一次就双计数**，所以必须随第一批应用代码一起删掉计数语句——**不能**和 `delete.ts` 的绝对重算一样留到 postflight 之后。只有绝对重算是幂等的、可以安全留着。

### 4. 缓存失效

游戏删除后除了关系被级联清掉，还要失效标签 / 会社列表缓存——触发器会改 `count`，而列表缓存里带着旧 `count`。`app/api/patch/delete.ts` 现在只做了会社侧的重算，没有把两侧列表缓存一起失效，本批次补上。

## 触发器与迁移交付物

四个 SQL 文件，命名沿用仓库既有约定：

- `migration/production-tag-company-count-preflight-<日期>.sql`
- `migration/production-tag-company-count-sync-<日期>.sql`
- `migration/production-tag-company-count-postflight-<日期>.sql`
- `migration/production-tag-company-count-rollback-<日期>.sql`

### preflight（只读；偏差只报告，结构问题阻断）

**关键：不能因为发现计数偏差就拒绝继续——偏差正是 sync 要修的东西。** 阻断的只有结构性问题。

1. 盘点当前偏差：`patch_tag` 与 `patch_company` 中 `count <> COUNT(relation.id)` 的行数与最大偏差，分表输出。**这是上线前唯一的事实基线**，sync 回填之后就再也统计不到了，需要留档。
2. 报告目标触发器的当前状态。**已存在且定义正确不算失败**——sync 是幂等的，preflight 必须可以在 sync 之后重跑。
3. 报告两张关系表上是否有其它同名触发器或规则。

**但结构性问题必须阻断 sync**（偏差只报告，结构不对不能继续）：

- 关系表或父表缺失；
- `count` 列类型不符；
- 目标名称被其它类型的数据库对象占用；
- 已存在的触发器定义无法被安全替换（例如属于别的函数、或带我们不认识的 `WHEN` 条件）。

### sync（幂等，单事务）

1. `CREATE OR REPLACE FUNCTION` 六个计数函数（tag / company × ins / del / upd）。
2. `DROP TRIGGER IF EXISTS` 后 `CREATE TRIGGER`，每张关系表三个：`INSERT` / `DELETE` / `UPDATE`，全部 `FOR EACH STATEMENT` 配 transition table。
3. **回填前必须 `LOCK TABLE "patch_tag_relation", "patch_company_relation" IN SHARE MODE`。** 这是整批最容易静默出错的一点：绝对重算与触发器自增之间存在竞态——回填正在算的时候来一个插入，触发器加了 1，随后回填用旧的 `COUNT(*)` 覆盖掉它，那次插入永久丢失，且不会有任何报错。SHARE 与 ROW EXCLUSIVE 冲突，短暂阻塞写入，事务提交后自动释放。上游 `ensureTagCompanyCounters.ts:142-150` 就是这么做的。
4. **全量绝对重算**：`SET count = COALESCE(COUNT(relation), 0)`。用绝对值而非增量，顺带修掉零关联残留。
5. 建触发器、加锁、回填必须在**同一个事务**里，否则中间窗口的写入会被漏计。
6. 全表回填在生产上是长事务 + 短暂写阻塞，`patch_company` / `patch_tag` 都不是热写表，可接受，但仍应放在维护窗口。

### postflight（独立交付物）

先按 PostgreSQL catalog 断言六个目标 trigger 与六个函数全部存在，且事件、`FOR EACH STATEMENT`、transition table 和目标函数定义完全匹配；再断言计数不变量对两张表都成立。只有某一时刻计数恰好相等、但触发器没有正确安装，不能算上线成功：

```sql
SELECT COUNT(*) FROM patch_company c
WHERE c.count <> (
  SELECT COUNT(*) FROM patch_company_relation r WHERE r.company_id = c.id
);
-- 必须为 0，patch_tag 同理
```

## 上线顺序（不可颠倒）

1. **先部署去掉手工增减的应用代码**，同时清掉迁移脚本里的残留自增，但**保留** `delete.ts` 的绝对重算。此时计数暂时不再增长——短暂偏低，可接受。
2. 跑 preflight，把偏差基线留档。
3. **执行 sync**：建六个函数 + 六个触发器 → 加 SHARE 锁 → 全量绝对重算，同一事务。
4. 跑 postflight 断言。
5. postflight 通过后，才删除 `delete.ts` 的绝对重算。

**反过来会双计数**：先装触发器再部署代码，中间窗口内每次关系插入会被触发器和应用各加一次。这是本批次唯一的不可逆风险点，必须放在维护窗口并留回滚路径。

## 文档同步交付物

随对应提交一起改，不是可选项：

- `docs/modules/operations.md` —— 四个 SQL 与上线顺序；
- `docs/modules/api-services.md` —— 计数归属改为数据库触发器，应用层不再增减；
- `skills/otoame-data-cache/SKILL.md` —— 明确写「`patch_tag.count` / `patch_company.count` 由触发器维护，应用禁止手工增减」，否则下一个人会照旧模式加回来。

## 提交拆分

代码、迁移 SQL、文档**分三个提交**。迁移 SQL 与其契约测试同一个提交，便于回滚时整体 revert。

## 回滚

回滚同样在停写维护窗口执行：`DROP TRIGGER` + `DROP FUNCTION`，然后重新部署带手工计数的旧代码，再跑一次全量回填校正，最后恢复关系写入。回滚脚本随 sync 一起交付，不要现场写。

## 测试

- `tests/unit/tag-company-count-migration.test.ts`：仿 `tests/unit/patch-submission-migration.test.ts`，静态读取 preflight / sync / postflight / rollback 四个 SQL 做契约断言——幂等（`CREATE OR REPLACE`、`DROP … IF EXISTS`）、除精确目标 trigger / function 外不含破坏性 DDL、触发器名与表名、**每张关系表三个触发器齐全**、**回填前有 `LOCK TABLE … IN SHARE MODE`**、建触发器与回填在同一事务内、postflight 同时核对 catalog 定义与计数；计数偏差查询只报告、不含中止语义，但缺表、列类型错误、目标对象冲突和不可安全替换的触发器定义必须让 preflight 失败。
- 全仓库审计断言：新增一条测试或 lint 规则，禁止在 `patch_tag` / `patch_company` 上出现 `count: { increment` / `decrement`，防止将来有人加回来。这是本批次最容易退化的地方。
- 更新受影响的现有测试：`tests/unit/api/company-relation-helper.test.ts`、`tests/unit/patch-submission-publish-preview.test.ts` 等断言 `count` 变化的用例，改为断言「关系已插入 + 缓存已失效」，不再断言 `count` 数值（数值由数据库负责，单测里没有触发器）。
- 临时 PostgreSQL 演练：空库与生产快照各跑一次 preflight → sync → postflight → rollback → sync。

## 风险

- **本批次是有用户可见变化的。** 回填把 `count` 校正到真实关系数，而标签与会社列表都按 `count desc, id desc` 排序（`prisma/schema/patch-company.prisma:20`），所以数字和**排序**同时变。偏差越大重排越明显——上游同一问题实测 +2738 标签 / +50 会社，我们的量级要等 preflight。不要把这一批当成纯内部修复排期，标签热度榜的变化用户会注意到。
- **单元测试看不到触发器。** Vitest 里 Prisma 被 mock，触发器不参与，所以「计数正确」这个不变量只能靠 postflight 与演练保证，不能靠单测。这一点要在测试注释里写明，否则后来者会以为单测覆盖了计数。
- **偏差基线只有一次机会采集。** preflight 跑过、sync 执行之后，旧的偏差就被回填抹平了，没法回头统计历史偏差有多大。如果需要这个数字（例如判断标签热度榜此前失真到什么程度），必须在 preflight 阶段留档。
- 本计划全部基于读码，未查生产库；偏差的实际量级要等 preflight 才知道。
