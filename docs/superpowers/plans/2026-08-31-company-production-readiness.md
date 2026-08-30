# 会社身份解析：本地收尾与生产就绪计划

**目标：** 完成会社身份解析项目尚缺的代码、生产维护工具、隔离库 E2E 与分阶段发布闭环；在全部门禁通过前不推送当前这批提交，不操作生产数据。

**结论：** 本地开发库的数据库迁移已经完成，但代码还不能直接推送并上线。剩余工作不是继续迁移本地 `touchgal`，而是修复一个“已保存却报失败”的用户可见缺陷、把会社合并脚本改成生产可审核的冻结计划、补回滚与真实 E2E，并重新整理尚未推送的提交拓扑。

## 当前基线

### 已完成

- 本地开发库 `touchgal` 已完成 Phase A、身份回填、计数触发器与 Phase B：
  - 会社 `normalized_name`：16 / 16；
  - VNDB external ID：11；
  - name identity：28；
  - tag / company 六个计数触发器齐全；
  - tag / company count 偏差均为 0；
  - `normalized_name` 与 `(source, external_id)` 最终唯一约束已安装；
  - Phase B postflight 与 `pnpm prisma:deploy-safe` 已通过。
- 本地开发库备份：
  - `backup/touchgal-before-company-identity-20260831-001932.dump`；
  - SHA-256：`003aed5ed42a0f6e43a9dc3505c3d1d6da869cda146c8666847321939cd4be17`；
  - `pg_restore --list` 已验证可读。
- 本地没有自动合并或删除会社；本地发现的相近名称只用于验证盘点能力，不得复制为生产合并决定。
- 写本计划前工作区干净；现在除本计划文件外没有其它未提交改动。`main` 比 `origin/main` 领先 21 个提交；这些提交尚未推送，因此仍可在用户确认后整理成安全的分阶段发布拓扑。

### 尚未完成，因此暂不推送

| 阻断项                        | 当前风险                                                                          | 完成标准                                                                |
| ----------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 直接创建 / 重写的提交后假失败 | 游戏主体与奖励已经提交，会社解析歧义却让页面显示整个操作失败                      | 已提交主体始终返回成功；会社问题作为结构化 warning 展示，缓存仍完成失效 |
| 生产会社清理 CLI              | dry-run 与 apply 会重新联网、重新规划；可误删零关系会社、丢失来源元数据与身份溯源 | apply 只消费审核过的冻结计划、零网络、单事务、漂移即零写入、缓存可重试  |
| Phase B 应急回滚              | R4 启动失败时虽可优先恢复兼容 Phase B 的 R3，但兼容层也失败时没有数据库退路       | 有幂等 rollback SQL、post-check、上一版 artifact 恢复与演练记录         |
| `touchgal_e2e` 结构陈旧       | 缺新列、身份表、唯一约束与六个计数触发器，当前 HEAD 的相关接口可能直接报错        | 可重复准备隔离库，最终 Schema 与触发器 postflight 全过                  |
| resolver 真实 E2E 缺失        | 单测未证明创建、重写、投稿预览与批准在真实数据库上同源                            | 3100 + `touchgal_e2e` 跑完 flag-off / flag-on 场景                      |
| Release 拓扑不完整            | 一次推完只生成最终 Phase B Release，无法先部署 Phase A 兼容版本                   | 三个兼容 Release 逐次生成并记录 tag，源码 commit 与 artifact tag 一致   |

## 已定边界

1. 本地 `touchgal` 不再执行数据迁移或会社合并；后续只重跑只读 postflight。
2. 生产重复会社不能依据本地 ID 处理，也不需要先导出整张生产表。先由只读 inventory 生成脱敏清单，再由人工 decisions 文件作出明确裁决。
3. 名称相似、共享 legacy alias、域名相同或“每个来源各出现一家”都不是自动合并证据。
4. 自动证据仍只来自 external ID 与已验证的 authoritative 名称 / 别名；歧义不得猜测。
5. 零作品关系不等于可删除。删除必须是人工计划中的显式动作。
6. 投稿批准保持事务内全有或全无；本计划只改变已经在事务外完成主体提交的直接创建 / 重写语义。
7. 生产禁止 `prisma db push`；所有结构变更继续使用 preflight / sync / postflight / rollback。
8. legacy alias 规范化放开、离线 LLM 建议、DLSite 新 UI 不属于本轮推送门槛。

## 阶段 1：修复直接创建 / 重写的提交后假失败

### 问题

`app/api/edit/create.ts` 与 `app/api/edit/update.ts` 都先提交游戏主体，再调用 `processSubmittedExternalData`。创建奖励和游戏主体位于同一笔事务，所以 enrichment 之后再抛出会社歧义时，**游戏已经存在且 3 点奖励已经确定发放**，接口却返回失败字符串；未知异常则返回 500。

这条早退还会确定跳过创建路径的列表缓存失效与 IndexNow。用户既看到“创建失败”，又可能因为旧列表缓存暂时看不到新游戏，最自然的动作是再次提交；第二次再撞外部 ID 唯一约束，会进一步强化“第一次没有成功”的错误认知。重写路径同样会在主体已更新后跳过内容 / 列表缓存失效。

### 实现

1. 为直接创建与重写定义结构化的提交后处理结果，例如：

   ```ts
   type ExternalDataProcessingResult = {
     warnings: Array<{
       kind: 'company-ambiguity' | 'external-data-error'
       message: string
     }>
   }
   ```

2. 主体事务一旦成功，API 必须返回正常成功 DTO；不得再把公司歧义或其它提交后 enrichment 异常伪装成主体失败。
3. 公司歧义不建立错误关系，返回“游戏已保存，但部分会社需要维护”的 warning；未知异常写服务端日志并返回不包含内部细节的 warning。
4. 公司 enrichment、缓存失效、IndexNow 等所有提交后副作用都不得再把已提交主体报告成失败。每项独立记录失败；能提供操作价值的失败通过 warning 告知用户，其余只记服务端日志。
5. 无论 warning 是否存在，都尝试执行主体需要的 patch 内容、列表与公司缓存失效；创建页的 IndexNow 仍按既有 SFW 条件执行。
6. 前端成功流程保持跳转 / 关闭编辑状态，并额外显示 warning toast；不得诱导用户重复点击创建或保存。
7. 投稿批准不采用这套降级：`publishSubmissionCore` 里的歧义仍回滚整笔批准。

### 测试

- create：主体已提交、奖励只发一次并返回原 balance、公司歧义返回成功 + warning、列表缓存仍尝试失效；
- rewrite：主体已更新、公司歧义返回成功 + warning、缓存仍失效；
- 未知 enrichment 异常不会把已提交动作报告成失败；
- IndexNow 或缓存副作用失败不会把已提交动作报告成失败，SFW 正常路径仍会尝试 IndexNow；
- 正常路径 DTO 与现有客户端兼容；
- 投稿批准歧义仍不发布、不结算押金。

## 阶段 2：把生产会社清理改成冻结计划

### 2.1 命令与文件契约

把当前“每次命令重新联网、重新规划”的入口拆成四步：

```bash
pnpm maintenance:companies:inventory -- --out=/var/lib/kun-otoame/maintenance/company/<run-id>/company-inventory.json
pnpm maintenance:companies:plan -- --inventory=/var/lib/kun-otoame/maintenance/company/<run-id>/company-inventory.json --decisions=/var/lib/kun-otoame/maintenance/company/<run-id>/company-decisions.json --out=/var/lib/kun-otoame/maintenance/company/<run-id>/company-cleanup-plan.json
pnpm maintenance:companies:dirty:dry -- --plan=/var/lib/kun-otoame/maintenance/company/<run-id>/company-cleanup-plan.json
pnpm maintenance:companies:dirty:apply -- --plan=/var/lib/kun-otoame/maintenance/company/<run-id>/company-cleanup-plan.json --confirm-sha256=<审核摘要>
```

数据库提交后，缓存失败只重试缓存阶段：

```bash
pnpm maintenance:companies:dirty:cache -- --plan=/var/lib/kun-otoame/maintenance/company/<run-id>/company-cleanup-plan.json
```

规则：

- `<run-id>` 对应一个仓库和所有 Git worktree 之外的持久审计目录。上线清单先以 `0700` 创建目录；inventory、decisions、plan、sidecar、receipt 与日志都不得落入源码目录、不得进入 Git，也不得跟随应用部署被清理。目录和文件拒绝符号链接，并按既定保留期连同数据库备份归档。
- `inventory` 只读数据库，只供指定审核人查看；owner 与确认人只输出本次 inventory 内稳定的 opaque reference / 冲突标记，不输出原始 `user_id`、用户名、联系方式或认证数据，也不包含连接串、投稿 payload 或环境变量。
- `plan` 是唯一允许请求 VNDB 的阶段。它必须按“实时数据库快照 A → 事务外 VNDB 请求 → 实时数据库快照 B”执行；A / B 的全局 normalized-name、external-ID、identity 与 relation digest 任一变化都不产出计划。传入的 inventory 文件只承载人工审阅上下文，不能代替这两次实时读取。
- `plan` 冻结证据、人工决定、显式删除、完整前置 / 后置快照、缓存目标、`toolVersion`、生成 commit 与规范化规则版本。生成、dry、apply 与 cache 全部由同一个 R4 exact checkout 执行，且 `toolVersion` 必须完全一致；否则必须重新生成并审核计划。
- `dry`、`apply`、`cache` 禁止访问 VNDB；`apply` 没有 `--plan` 或确认摘要不匹配时直接失败。
- JSON 使用严格 schema，拒绝未知字段。计划文件本身不内嵌自己的摘要：按固定 UTF-8、key 顺序、数组排序和末尾换行写出 canonical JSON，再对磁盘原始字节计算 SHA-256，写入同名 `.sha256` sidecar；`--confirm-sha256` 与 apply 都重新计算原始文件字节。
- 计划、decisions、sidecar 与 receipt 使用 `0600` 权限、临时文件 + 原子 rename，并默认拒绝覆盖既有审核文件。
- `decisions` 只表达人工裁决，不允许直接改机器生成的数据库快照。

### 2.2 冻结计划最少内容

- `schemaVersion`、`toolVersion`、生成 commit、生成时间与规范化规则版本；SHA-256 保存于 sidecar；
- 每家来源 / 目标会社的 ID、name、normalized name、`updated`、owner、introduction、alias、language、source websites、parent brand；
- external IDs 与 name identities，包括 `authoritative` / `legacy` 及确认人 opaque reference；真实 `confirmed_by_user_id` 只在数据库内重读并原样迁移；
- 当前作品关系 ID 与受影响 patch ID / unique ID；
- 权威证据更新、自动合并、人工合并、显式删除；
- 每个字段的合并策略与预期最终快照；
- blockers、warnings、缓存目标。

以下情况默认阻断，而不是自动选择：

- 两边存在不同的非空 introduction；
- owner 不同且计划没有明确保留策略；
- external ID 指向冲突；
- authoritative identity 冲突；
- 同一 source 被两个目标消费、source / target 重叠或出现循环；
- 计划生成前后 inventory 摘要发生变化。

### 2.3 apply 的数据库不变量

1. 所有网络请求与缓存操作必须在事务外；事务开始先设置有限的 `lock_timeout` 与总超时。默认建议分别为 10 秒与 120 秒，并允许在受限范围内由 CLI 参数调低或调高。
2. 使用 `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE`，按固定顺序锁定 `patch_company_relation` → `patch_company` → `patch_company_external_id` → `patch_company_name_identity`。不能只锁计划涉及的现有行，否则挡不住新增关系、normalized name 或 external ID 的 phantom 写入。
3. 取得锁后验证三个 company relation 计数触发器、company count 不变量、计划行快照及全局 normalized-name / external-ID owner / identity / relation digest。
4. 任一前置状态漂移时整笔零写入失败；“缺少某个 source 后继续其余动作”不允许。
5. 迁移并去重作品关系、external IDs 和身份行；保留 `authoritative` 与真实 `confirmed_by_user_id` 溯源。
6. alias、语言、来源网站、母品牌、简介和 owner 严格采用计划里审核过的策略。
7. 只删除计划中显式批准的 source 或零关系会社；零关系但有人工内容的会社默认保留。
8. count 只由数据库触发器维护，脚本不手工增减或重算。
9. 任一动作失败整份计划回滚。相同计划重放只能得到“完整后置状态已存在”或零写入；介于前置与后置之间的状态必须拒绝。
10. 计划设置最大 action / relation 数；超过上限时只能拆成来源与目标互不重叠的多份计划，避免无上限持锁。

### 2.4 缓存回执

- 计划必须保存所有 source / target company ID 与受影响 patch unique ID。
- Redis / 内容缓存失效覆盖公司列表、来源详情、目标详情和所有受影响游戏。
- Cloudflare purge 返回结构化结果；`success !== true` 时命令非零退出，不得打印“全部完成”。
- CLI 环境无法可靠执行 Next ISR revalidate 时如实报告；生产部署 / 重启与页面烟雾测试承担 ISR 收尾。
- apply 提交后原子写出 result receipt，记录 plan SHA、完整后置状态摘要、提交结果、缓存状态和受影响 ID；若进程在提交后、写 receipt 前退出，重放 apply 必须从完整后置状态重建 receipt，而不是重复写数据库。
- `dirty:cache` 先只读确认数据库仍处于计划的完整后置状态，并校验 plan + receipt；未 apply 或发生后续漂移时拒绝 purge。
- 数据库已经提交而缓存失败时，只运行 `dirty:cache`，不得重新规划或再次写数据库。公司列表、已删除 source 详情、target 详情、patch 内容与列表全部覆盖；Cloudflare 分批请求逐批要求 `success === true`。
- 合并没有自动 unmerge。计划、decisions、sidecar、receipt 与执行日志是审计物；需要恢复数据时使用执行前已验证的数据库备份。

### 2.5 收敛性修复

当前本地 identity apply 后，`dirty:dry` 仍重复列出已经满足的 11 条 VNDB evidence 更新。修正 planner：已具备相同 external ID、authoritative identity 与 alias 投影的动作必须判为 no-op；生产 postflight 的目标是 pending write 为 0，而不是“重复 apply 也没报错”。

### 2.6 测试

- 计划 schema、稳定排序、SHA 与未知字段拒绝；
- plan 之外的 dry / apply 不调用 VNDB；
- 循环、重叠 source、一个 source 多目标、元数据冲突全部阻断；
- 漂移检测在任何写入前失败；
- 第二个动作失败时第一个动作同样回滚；
- external ID 与 authoritative / confirmed identity 不丢失；
- 未显式批准的零关系会社不删除；
- 成功计划可安全重放；
- apply 后 dry-run 收敛到 0 pending writes；
- 数据库成功但缓存失败后可只重试 cache；
- 在 apply 前误跑 cache 会因缺少完整后置状态 / receipt 而失败；
- 一次性 PostgreSQL 18 上安装计数触发器后做真实合并，验证关系与 count。

## 阶段 3：补齐 Phase B 回滚与部署保护

### 3.1 Phase B 应急 rollback

新增并测试幂等的：

- `migration/production-company-identity-constraint-rollback-2026-08-30.sql`；
- 对应 Phase A post-check 或独立 rollback postflight。

R4 启动失败时先关闭 resolver，并恢复部署前保留的 R3 standalone；R3 的约束兼容层应能继续运行在 Phase B 数据库上。只有 R3 兼容层烟雾测试也失败、或必须重新走 Phase A schema guard 时，才在停写状态下执行数据库 rollback：

1. 删除 `normalized_name` 与 `(source, external_id)` 最终唯一索引；
2. 恢复 Phase A 的两个普通查询索引；
3. 取消 `patch_company.normalized_name NOT NULL`；
4. 核对 Phase A 列、表、外键与索引契约；
5. 数据保留，不删除 identity 或 external ID 行。

补静态契约测试和 PostgreSQL 18 演练：Phase A → Phase B → R3 flag-off 兼容烟雾 → rollback → Phase B，全部必须可重复执行。

### 3.2 artifact 与源码一致

`package.json` 当前把 `deploy:pull` 定义为 `git pull && esno scripts/deployPull.ts`。这个 `git pull` 发生在 TypeScript 脚本读取 pinned tag 之前，因此只在 `deployPull.ts` 内增加 HEAD / tag 校验仍然太晚：远端 `main` 已推进后，源码、迁移脚本和部署脚本已经先被更新。

保留普通 latest 更新入口，同时新增真正独立的 pinned 入口：

- `deploy:pull`：普通更新使用 `git pull --ff-only`，随后必须重新加载 pull 后的部署脚本；
- `deploy:pull:pinned`：**不执行 `git pull`、merge 或自动 checkout**，强制要求 `KUN_DEPLOY_RELEASE_TAG`，只 fetch 精确 tag 并解析 peeled commit；
- pinned 模式在任何下载、解压、数据库命令、根 `prisma` 或 standalone 变更前，要求工作区干净并验证 `HEAD commit === tag commit`；不一致立即退出。

Release artifact 新增 `release-manifest.json`，至少包含 manifest 版本、Release tag 与 `github.sha`。候选包解压后、修改线上文件前，必须同时满足：期望 tag = GitHub Release tag = manifest tag，源码 HEAD = fetched tag commit = manifest commit SHA。R1 / R3 是旧 Release workflow 产生的过渡 artifact，没有该 manifest，因此只允许在远端 `main` 尚未继续推进、人工核对 tag commit = 预定 SHA 并备份当前槽位后部署；R4 及后续全部使用新 pinned 契约。

候选 Prisma schema 不能像当前实现一样在 guard 前先删除并替换根 `prisma`。让 schema guard 与 `prisma generate` 接受解压目录中的候选 schema；验证和 Client 注入全部成功后才切换。若工具接口暂时无法支持候选路径，至少要先原子备份根 Prisma 并保证任何失败路径恢复，但这是次选方案。

首选方案写死为给 `scripts/checkPrismaProductionSchema.ts` 增加严格的候选 Schema 参数，例如 `--schema=<path>`：

- 未传参数时继续默认使用项目根的 `prisma/schema`，保持现有 `pnpm prisma:deploy-safe` 行为；
- 传入时先解析并校验目录存在、可读且属于本次已验证的候选解压目录，拒绝未知参数、重复参数、符号链接和缺失路径；
- 调用 Prisma 时继续使用 `spawnSync` 参数数组，把解析后的路径作为 `--to-schema=<path>` 单独透传，不拼接 shell 字符串；
- `migration:resource-links` 仍按既有顺序执行，但候选 guard 通过前不得替换根 Schema；随后用同一个候选路径执行 `prisma generate --schema=<path>` 并注入候选 standalone；
- 候选路径只改变“拿哪份 Prisma Schema 比对”，不得改变 guard 的只读性质，也不得放宽空 diff / `patch_released_idx` 精确例外之外的任何失败条件。

补参数与部署顺序测试：默认路径保持兼容；候选路径准确进入 `--to-schema`；未知、重复、缺失或越界路径拒绝；guard 失败时根 Prisma、current standalone 和当前 Prisma Client 均不变；candidate generate 只在 guard 通过后执行。

部署使用 current / previous 双槽：保留上一份已验证 standalone、Prisma schema 与 release metadata，直到新版本启动和 smoke 通过；独立 `deploy:rollback` 只恢复本地 previous 槽并重启 PM2，不访问 GitHub、不执行 `git pull`、不重跑 schema guard、不修改数据库。这样远端 `main` 已推进到 R4 后仍能离线恢复 R3。R1 / R3 使用旧工具时，上线清单必须在每次替换前人工保存等价的 standalone、Prisma 与 release metadata 快照。

补部署工具测试：pinned 模式绝不调用 `git pull`；latest pull 后执行的是更新后的脚本；tag / HEAD / manifest 任一不一致时零下载或零文件变更；guard 失败后根 Prisma 与 current standalone 不变；PM2 启动或 smoke 失败可离线恢复 previous；成功 smoke 后才允许清理上一份备份。

### 3.3 可执行停写机制

上线文档不能只写“暂停会社关系写入”。生产清单必须给出实际可验证的维护方式：

- 反向代理先对公网启用维护页 / 503，阻断公开写请求；
- 应用仅保留本机 canary 访问；
- 数据库迁移与最终应用启动期间公网仍关闭；
- 通过本机 Host header 或等价 canary 路径完成创建、重写、投稿批准烟雾测试；
- 测试通过后才重新开放公网。

若当前反向代理不能提供该能力，Phase B 上线前先补运维配置并在非生产环境演练；不得用“操作会很快”代替停写。

## 阶段 4：重建隔离测试库并补真实 E2E

### 4.1 可重复的测试库准备

当前 `touchgal_e2e` 有旧数据，但缺 `company_candidates`、`normalized_name`、身份表、最终唯一约束和六个计数触发器。增加受保护的 `e2e:db:prepare`：

- 只接受显式 `KUN_E2E_DATABASE_URL`；
- 数据库名必须以 `_e2e` 结尾，禁止命中开发库或生产库；
- 重置必须另加显式参数并先备份现有 `touchgal_e2e`；
- 对 disposable 库建立最终 Prisma Schema、安装计数触发器、运行两个 postflight；
- 生成 / 保留 E2E 所需的投稿人和审核员种子数据；
- 不把 `prisma db push` 写进生产流程。

优先选择重建 disposable `touchgal_e2e`，而不是为 73 条历史测试投稿做一次性人工清理。原库备份保留到新 E2E 全绿。

### 4.2 E2E 场景

新增 `tests/e2e/company-identity.e2e.ts`，并复跑现有三套 E2E：

1. resolver flag-off：旧兼容路径仍可创建、重写和批准投稿。
2. resolver flag-on / create：同一会社的规范化等价写法只关联一个 canonical company；另一家真实发行商 / 移植商仍单独保留。
3. resolver flag-on / rewrite：换一种写法不会新增重复会社。
4. submission：管理员预览显示的 canonical 公司与批准后的正式关系一致。
5. ambiguity：投稿批准不发布；直接 create / rewrite 显示“主体已保存、会社待维护”，不误报整个动作失败。
6. trigger：新增、删除和改写关系后，`patch_company.count` / `patch_tag.count` 与真实关系数一致。

E2E 不依赖实时外部网站：不增加测试专用公开 API；投稿由测试夹具直接写可信快照，直接创建 / 重写用确定性的未验证名称候选，权威 external ID 的网络边界继续由单元测试覆盖。

3100 与 3000 共享同一仓库的 `.next`，任何时刻只启动一个 `next dev`。3100 必须明确连接 `touchgal_e2e`，resolver flag 改动后重启进程。

## 阶段 5：本地完成门禁

代码完成后依次验证：

```bash
pnpm test:changed
pnpm typecheck
pnpm test
pnpm test:docs-contracts
pnpm build
git diff --check
git status --short
```

`pnpm test:docs-contracts` 只证明既有 `docs/project/*`、`docs/modules/*` 与相关 skill 契约没有回归，不读取 `docs/superpowers/plans/*`。本计划文本另以 Prettier、`git diff --check` 和人工一致性审阅把关，不能把 docs-contracts 绿灯解释为“计划已被自动验证”。

另外必须有以下证据：

- 本地 `touchgal` 的 identity / count / Phase B postflight 重跑通过；
- `touchgal_e2e` 的 count / Phase B postflight 与 `prisma:deploy-safe` 通过；
- PostgreSQL 18 完整演练：Phase A → identity backfill → count sync → 冻结计划 apply / replay → Phase B → rollback → Phase B；
- 从 R4 exact checkout 生成的 Prisma Client 与维护 CLI 必须在“Phase A Schema + 计数触发器已安装”的数据库上完整跑通 inventory → plan → dry → apply / replay → cache；不得依赖 Phase B 唯一约束已经存在；
- 3100 上 flag-off / flag-on 的全部 E2E 通过；
- 生产维护 CLI 的 apply 测试证明没有网络请求、没有部分提交、没有隐式删除。

满足以上门禁后，才按既有 commit 切点准备分阶段 Release；在此之前不推送。

## 阶段 6：复用既有 Release 切点，不重写历史

现有未推送历史已经提供两个干净的 Phase A 边界，并且与最终 HEAD 保持祖先关系，不需要 rebase、cherry-pick 或重放 21 个提交：

| Release | 候选 commit                | 数据库契约                | 内容                                                                                        |
| ------- | -------------------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| R1      | `fec99a95`                 | Phase A、旧计数语义       | 最小 Phase A 应用；已有 trusted snapshot、identity projection / backfill；尚未引入 resolver |
| R3      | `c617a158`                 | Phase A、计数触发器已安装 | 应用手工计数与旧绝对修复均已删除；resolver 必须保持 false                                   |
| R4      | 阶段 1–4 完成后的未来 HEAD | Phase B                   | 最终约束、resolver、冻结计划 CLI、部署保护、全部修复与 E2E                                  |

`c915e2e1` 虽然也是 Phase A，但已经带入旧 resolver / maintenance workflow，又没有比 R1 提供更安全的迁移能力，因此不作为 Release 节点。

阶段 1 修复只要求进入 R4：R1 根本没有 resolver，R3 强制 flag=false，所以新增的 ambiguity 早退不会在两个过渡版本启用。通用 enrichment 异常导致的提交后假失败是既有缺陷，不是 Phase A 新回归；R1 / R3 只能作为短期迁移版本，不安排长期停留。若迁移因外部原因需要长期暂停，应停止推进并另行制作 Phase A 修复 Release，而不是重写整段历史。

冻结计划 CLI 同样不要求进入 R1：R4 Release 生成后，在生产仍运行 R3、数据库仍是“Phase A + 计数触发器”时，从仓库外的 detached R4 exact checkout / worktree 运行。该 checkout 单独安装依赖并生成 R4 Prisma Client，安全读取生产 `.env` 但不复制或输出其中内容；审计物写到阶段 2 的仓库外目录。阶段 5 必须先在 PostgreSQL 18 上证明这个组合可运行。

本地先验证：

- `fec99a95` 是 `c617a158` 的祖先，`c617a158` 是最终 R4 的祖先；
- R1 / R3 exact checkout 各自在对应 Phase A Schema 上通过类型检查、构建与 schema guard 演练；
- R4 exact checkout 在 Phase A + 计数触发器数据库上通过维护 CLI 演练，在 Phase B 数据库上通过应用 / guard 演练。

实际推送仍与阶段 7 的生产迁移交错：推 R1 并完成 R1 阶段后才推 R3，完成 R3 阶段后才推 R4。每次等待 Release workflow 完成，确认 tag commit 等于事件 SHA，并避开 CalVer 只有分钟精度造成的同分钟 tag 冲突。

## 阶段 7：生产执行顺序（本地完成后另行批准）

本计划只准备工具与清单，不授权现在修改生产库。真正上线按以下顺序执行：

1. **推 R1 并等待 Release。** 记录 R1 commit / CalVer tag，校验 artifact；备份并验证生产数据库。
2. 执行 Phase A preflight / sync / postflight，部署 pinned R1，resolver=false。
3. identity dry → apply → dry，第二次 pending writes 必须为 0。
4. **推 R3 并等待 Release。** R1 继续提供服务；在停机前先运行 count preflight 并保存旧偏差基线。由于 R1 / R3 仍使用旧部署工具，替换前人工保存 current standalone、根 Prisma 与 release metadata，并确认远端 `main`、服务器 HEAD 和 Release tag 都指向预定 R3 SHA。
5. 启用公网维护页并停止应用，再次备份；做一次短结构检查后执行 count sync / postflight，再部署 R3。确认计数不变量后恢复 flag-off 服务。R3 失败时先执行 count rollback，再从本地快照恢复 R1 artifact；不要在远端已经推进后调用旧 `deploy:pull` 回拉 R1。
6. **推 R4 并等待 Release。** R3 继续提供服务，不提前运行 Phase B；确认 Release manifest 的 tag / commit SHA 指向最终 R4。
7. 在仓库外准备 detached R4 exact maintenance checkout / worktree，安装锁定依赖并生成 R4 Prisma Client。数据库仍是 Phase A + 计数触发器；此时不得运行 R4 `prisma:deploy-safe`。从这个 checkout 生成生产 inventory；根据生产实际数据制作 decisions 与冻结计划，人工审核 plan 文件和 sidecar SHA。不要复用本地公司 ID。
8. 在最终 Phase B 窗口启用公网维护页并停止公开写入，用同一个 R4 checkout 重验冻结计划。若发生漂移，保持维护状态，重新实时 inventory → 复用并逐条重验或修订 decisions → 生成新 plan → 人工审核新 SHA；禁止强制执行旧计划。
9. 对通过复核的计划执行 dry → apply → cache，再跑 inventory；所有阻断碰撞和 pending writes 必须清零。
10. 执行 Phase B preflight / sync / postflight。此时**不得**用 R3 的 Phase A Prisma schema 单独运行 `prisma:deploy-safe`。
11. 在主部署仓库中只 fetch 目标 tag / commit，并把当前分支 exact fast-forward 到 R4 SHA；不得调用带无条件 `git pull` 的旧 pinned 路径。确认工作区干净且 HEAD = tag = manifest commit 后，运行 R4 的 `deploy:pull:pinned`；它以候选 schema 执行 guard / Client 生成，resolver 仍为 false。
12. 打开 resolver 并重启，通过本机 canary 完成创建、重写、投稿预览 / 批准三条烟雾测试。
13. 检查公司详情、公司列表、受影响游戏、result receipt 与 Cloudflare cache 回执，最后开放公网；成功 smoke 后才允许清理 previous 部署槽。

R4 无法启动时，继续保持维护状态并关闭 resolver，优先恢复部署前保留的 R3 artifact，在 Phase B 上运行 flag-off 兼容烟雾。只有兼容层也失败时才执行 Phase B rollback，确认 Phase A post-check 后恢复 R3；不得让更早且不具备约束兼容层的应用连接 Phase B Schema。

## 预计提交拆分

1. `fix(edit): preserve committed results on company warnings`
2. `feat(maintenance): freeze reviewed company cleanup plans`
3. `fix(operations): add company rollback and release guards`
4. `test(company): cover resolver against a disposable database`
5. `docs(operations): document staged company production rollout`

代码 / SQL 与文档保持独立提交；测试随其守护的实现提交。不进行 rebase 或历史重排，最终新增提交只追加在当前 HEAD 之后。

## 推送判定

只有同时满足以下条件，才可以开始分阶段推送：

- 阶段 1–4 的实现与测试全部完成；
- 阶段 5 全部门禁通过；
- R1 / R3 / R4 的 Schema 兼容矩阵在 PostgreSQL 18 演练通过；
- R1 已含 Phase A / identity backfill，R3 已含 count SQL，R4 已含冻结计划、Phase B、pinned deploy 与应急回滚；每个节点的能力与生产步骤逐项对应；
- 生产 decisions 仍为空白模板，不夹带本地 ID 或未经审核的自动合并；
- 用户明确批准按 `fec99a95` → `c617a158` → 最终 R4 SHA 分阶段 fast-forward 推送。
