# 模块 07：求助区与费用奖励（实施计划）

状态：设计草稿，待站长审阅。上游：[总计划](./00-master-plan.md)第 4.8 节、[设计基线](../7.operations-layer-redesign.md)第 8.3 至 8.5 节；PM 视角见[模块 07 PM 版](./07-help-zone-pm.md)。仓库事实来自 2026-09-08 的只读核查，逐处给出文件链接；本轮未运行构建、迁移、测试或部署命令。基线 8.4「费用与奖励」整段属未审定事项 D8，本文只写实现方案与阻塞位置，不视其为已批准。

## 1. 目标与基线

| 目标                                                                                                     | 基线         | 任务  |
| -------------------------------------------------------------------------------------------------------- | ------------ | ----- |
| 求助锚定到一个游戏、一条资源或五个固定话题，发布前展示相似求助                                           | 8.4          | M07-1 |
| 未解决/已解决/已关闭三态、无活动 14 天关闭、提问者重开一次、不可更换的采纳、有效票与社区验证、同问与订阅 | 8.4          | M07-2 |
| 三条不经站方的桥接与工单结案回贴                                                                         | 8.3          | M07-3 |
| 求物两类、未落地投稿提示与落地、资源回答、文字回答转资源                                                 | 8.4          | M07-4 |
| 发布费、单次系统奖励、悬赏预留/追加/释放/结算、迟到采纳、四项日限额                                      | 8.4          | M07-5 |
| 首页最新求助与最新评论、替换 05 临时入口、无回应义务提示、无人回答率事实                                 | 8.5、8.6、10 | M07-6 |

已核实的复用点：[账务原语](../../app/api/moemoepoint/service.ts)与[账务 schema](../../prisma/schema/moemoepoint.prisma)（ledger 唯一幂等键、reservation 状态机）、[资源创建](../../app/api/patch/resource/create.ts)、[资源创建门槛](../../app/api/patch/resource/route.ts)、[资源审核](../../app/api/admin/resource-apply/service.ts)、[资源删除](../../app/api/patch/resource/delete.ts)、[资源表单校验](../../validations/patch.ts)、[首页服务](../../app/api/home/service.ts)与[首页路由](../../app/api/home/route.ts)、[可见性 where](../../app/api/utils/getPatchVisibilityWhere.ts)、[匿名响应缓存](../../app/api/utils/anonymousApiResponseCache.ts)、[缓存失效](../../app/api/patch/cache.ts)、[通知 helper](../../app/api/utils/message.ts)、[cron 注册](../../server/cron.ts)与[任务锁](../../server/tasks/withTaskLock.ts)、[点数规则展示](../../constants/moemoepoint.ts)。本模块不新增依赖、不新建队列框架、规则后台或消息总线。

## 2. 偏离与理由

| 偏离                                         | 基线原文                                                        | 本文做法                                                                             | 理由（源码事实）                                                                                                                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 资源回答的直接公开条件                       | 8.4「创作者与管理员的直接公开，普通用户的进入现有审核队列」     | 按现行规则判定，不放宽也不收紧                                                       | [create.ts](../../app/api/patch/resource/create.ts) 第 50 至 53 行：`needApproval = userRole === 1 \|\| (userRole === 2 && resourceCount === 0)`，创作者的第一条资源仍要审核                                                               |
| 资源发布奖励的发放时点                       | 8.4「回答者同时获得现有的发布资源奖励（3 点，资源审核通过时）」 | 按现状描述：创建事务内即发，含 `status = 2` 待审                                     | [create.ts](../../app/api/patch/resource/create.ts) 第 128 至 137 行无条件调用 `earnMoemoepoint`；[审批服务](../../app/api/admin/resource-apply/service.ts) 第 51 行起的事务不再发奖励                                                     |
| 审核拒绝后的奖励回收                         | 基线未写                                                        | 本模块不改既有行为，也不新增回收                                                     | 同文件第 130 行起：拒绝直接 `patch_resource.delete`，未调用 `reverseMoemoepoint`；只有[资源删除](../../app/api/patch/resource/delete.ts)第 48 行会回退 3 点                                                                                |
| 「至少净回收 2 点」                          | 8.4 净效果段                                                    | 资源回答场景改写为净发出 1 点，见第 9 节守恒表                                       | 上两行叠加后单条求助发出 3+3 点、收入 5 点                                                                                                                                                                                                 |
| 悬赏「只能提高」的实现                       | 8.4 悬赏段                                                      | 每次追加新建一条预留行，总额记在求助上                                               | [账务服务](../../app/api/moemoepoint/service.ts)只有 `reserveMoemoepoint`/`releaseMoemoepoint`/`forfeitMoemoepoint`，没有增额原语；新建行可直接复用现成幂等键                                                                              |
| 订阅                                         | 8.4「点击者订阅该求助」                                         | 不建订阅表，订阅集合派生为「提问者 ∪ 我也遇到了的用户 ∪ 同问子帖作者」               | 三份事实都已落表，另建表只会产生一致性负担                                                                                                                                                                                                 |
| 首页「被自动隐藏的内容不进入聚合」的落实方式 | 8.5                                                             | 三条规则都生效，不降级：求助按自身隐藏标记过滤，评论沿用模块 03 的最终内容可见性谓词 | [patch_comment](../../prisma/schema/patch-comment.prisma)没有隐藏列，[举报表](../../prisma/schema/patch-report.prisma)现有处理路径是删除内容，被删评论本就不在表内；03 若引入隐藏谓词，求助与评论两侧复用同一谓词，07 不自建第二套隐藏系统 |
| 通知去重                                     | 基线未写实现                                                    | 不用 `createDedupMessage` 承担并发正确性                                             | [message.ts](../../app/api/utils/message.ts)第 17 至 33 行是先读后写，无数据库并发保证；改为只有赢得条件更新的那一次在同事务内 `createMessage`                                                                                             |

## 3. 术语

| 术语         | 定义                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 系统奖励名额 | 每条求助唯一的一次 3 点系统发放资格，记在求助行的 `awarded_answer_id` 上，与 `accepted_answer_id` 是两个独立字段                                       |
| 悬赏状态     | 求助行上的 `bounty_state`：`none`、`held`、`released`、`settled`、`withdrawn`、`unsettled`；`unsettled` 即基线的「悬赏未结算」                         |
| 有效票       | `help_answer_vote` 的一行，每人每条回答一次，永不删除                                                                                                  |
| 社区验证有效 | 回答行的 `community_verified_at` 被写入，条件是有效票达阈值、求助发布满等待期、尚未采纳                                                                |
| 未落地求物   | `anchor_type = wanted_game` 的求助（意图必为条目资源类求物，`wanted_game_name` 非空）。落地时 `anchor_type` 改为 `patch`，不靠 `patch_id` 是否为空判断 |
| 资源回答     | 一条 `resource_id` 非空的回答行，其文字部分立即可见，资源部分走现有审核                                                                                |
| 系统回答     | `kind = system` 的回答行，用于工单结案回贴，不可投票、不可采纳、不参与奖励                                                                             |
| 日配额行     | `help_daily_quota` 中 `(user_id, 上海自然日)` 的一行，承载四项日限额的原子计数                                                                         |

## 4. 数据模型

新增文件 `prisma/schema/help.prisma`（拟新增）。既有表不新增列；Prisma 关系需要在[user.prisma](../../prisma/schema/user.prisma)、[patch.prisma](../../prisma/schema/patch.prisma)、[patch-resource.prisma](../../prisma/schema/patch-resource.prisma)、[moemoepoint.prisma](../../prisma/schema/moemoepoint.prisma)各补一行反向关系字段（无 DDL 列变更，外键约束只建在 help 侧）。

**`help_post`（拟新增）**

| 字段                  | 类型与约束                            | 说明                                                                                                                                                                                             |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                  | Int PK                                |                                                                                                                                                                                                  |
| `author_id`           | Int → `user`，Cascade                 | 提问者                                                                                                                                                                                           |
| `intent`              | VarChar(16)                           | `question` / `request`                                                                                                                                                                           |
| `request_kind`        | VarChar(16)?                          | `entry_resource` / `external`，`intent = request` 时必填                                                                                                                                         |
| `anchor_type`         | VarChar(16)                           | `patch` / `resource` / `topic` / `wanted_game`；合法组合见下表                                                                                                                                   |
| `patch_id`            | Int? → `patch`，SetNull               | 一律服务端推导：`patch` 锚定直接给出；`resource` 锚定由该资源反查后写入；未落地求物为空，落地时随 `anchor_type` 一起切到 `patch`。它只用于索引与展示回退，可见性按下方读取分支判定，不单看本字段 |
| `resource_id`         | Int? → `patch_resource`，SetNull      | 锚定资源                                                                                                                                                                                         |
| `topic`               | VarChar(24)?                          | 运行环境 / 下载与解压 / 账号与站务 / 作品推荐 / 其他                                                                                                                                             |
| `wanted_game_name`    | VarChar(300) default ""               | 未落地求物的游戏名称                                                                                                                                                                             |
| `title` / `content`   | VarChar(300) / VarChar(10007)         |                                                                                                                                                                                                  |
| `status`              | VarChar(16) default `open`            | `open` / `solved` / `closed`                                                                                                                                                                     |
| `hidden`              | Boolean default false                 | 举报达阈值自动隐藏，沿用 02、03 的举报体系，本模块不自定阈值                                                                                                                                     |
| `accepted_answer_id`  | Int? @unique → `help_answer`，SetNull | 采纳，写入后不可更改                                                                                                                                                                             |
| `accepted_at`         | DateTime?                             |                                                                                                                                                                                                  |
| `awarded_answer_id`   | Int? @unique → `help_answer`，SetNull | 系统奖励名额归属                                                                                                                                                                                 |
| `awarded_reason`      | VarChar(16)?                          | `accept` / `community`                                                                                                                                                                           |
| `client_request_id`   | VarChar(64)                           | 客户端生成的请求 ID，`@@unique([author_id, client_request_id])`，用于识别发布重放；沿用 [patch_submission_gallery](../../prisma/schema/patch-submission.prisma) 的 `client_asset_id` 既有做法    |
| `closed_at`           | DateTime?                             |                                                                                                                                                                                                  |
| `last_activity_at`    | DateTime default now                  | 新回答与「我也遇到了」刷新，自动关闭的唯一依据                                                                                                                                                   |
| `origin_post_id`      | Int? → 自关联，SetNull                | 同问始终指向最初原帖                                                                                                                                                                             |
| `bounty_total`        | Int default 0                         | 已接受的悬赏合计，释放后仍需保留用于迟到采纳                                                                                                                                                     |
| `bounty_state`        | VarChar(16) default `none`            | 见第 3 节                                                                                                                                                                                        |
| `case_id`             | Int?                                  | 求助 → 工单。**不加唯一约束**：同一资源的多条求助会被模块 03 按「资源 + 类型」去重到同一条工单。「每帖只关联一次」由 `updateMany where case_id IS NULL` 保证                                     |
| `from_case_id`        | Int? @unique                          | 工单 → 求助。保留唯一，保证一条工单至多转出一条求助                                                                                                                                              |
| `created` / `updated` |                                       |                                                                                                                                                                                                  |

索引：`([status, last_activity_at])` 供自动关闭；`([hidden, status, created(desc), id(desc)])` 供列表与首页；`([patch_id, created(desc)])`、`([anchor_type, resource_id, created(desc)])` 供条目/资源侧入口与相似求助；`([anchor_type, hidden, created(desc)])` 供「大家在求的游戏」；`([author_id, created(desc)])`；`([origin_post_id])`；`([case_id])`。

**合法锚定组合**，校验层与服务层各判一次，非法组合直接拒绝。意图列按基线 8.4 的求物表收窄，`resource` 锚定只用于提问，不默认所有求物都能锚定资源：

| `anchor_type` | `patch_id`       | `resource_id` | `topic` | `wanted_game_name`     | 适用意图                                         |
| ------------- | ---------------- | ------------- | ------- | ---------------------- | ------------------------------------------------ |
| `patch`       | 必填             | 空            | 空      | 落地前留下的名称可保留 | 提问、条目资源类求物、与某游戏相关的站外事物求物 |
| `resource`    | 由资源反查后必填 | 必填          | 空      | 空                     | 仅提问                                           |
| `topic`       | 空               | 空            | 必填    | 空                     | 提问、站外事物求物                               |
| `wanted_game` | 空               | 空            | 空      | 必填                   | 仅尚无条目的条目资源类求物                       |

`wanted_game` 只表示「真正未落地」。落地时把 `anchor_type` 改成 `patch` 并写入 `patch_id`，`wanted_game_name` 原样保留仅作展示，因此不需要另建一套历史记录；「大家在求的游戏」查 `anchor_type = 'wanted_game'`，不靠 `patch_id` 是否为空推断，落地后条目又被删也不会退回该列表。

**读取按锚定分支判定，不用一条通用谓词**，否则删除会留下洞：

| `anchor_type` | 可公开的条件                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `topic`       | 无目标依赖，恒可读                                                                                                                                                                        |
| `wanted_game` | 恒可读；落地后已改为 `patch`，不与本分支混淆                                                                                                                                              |
| `patch`       | `patch_id` 非空且该条目通过可见性判定；条目被删后 `patch_id` 置空即不可读，落地过的求物同样如此                                                                                           |
| `resource`    | `resource_id` 非空、资源行仍在，且**联表取当时的 `resource.patch_id`** 通过可见性判定。只看 `help_post.patch_id` 有两个洞：资源被删后仍会公开，资源被移动到别的条目后仍按旧条目的分级判断 |

**不设重开次数字段。** 「每次关闭后最多重开一次」由 `updateMany where status = 'closed'` 的比较并交换实现：一个关闭周期内只有一次能把 `closed` 改成 `open`；帖再次经历无活动窗口被关闭后才有下一次机会。累计计数字段会把语义收紧成「一生只能重开一次」，与基线不符。

**`help_answer`（拟新增）**：`id`；`post_id` → `help_post` Cascade；`user_id` Int? → `user` SetNull（系统回答为空）；`kind` VarChar(8) default `user`；`content` VarChar(10007)；`hidden` Boolean default false；`community_verified_at` DateTime?；`client_request_id` VarChar(64)?，`@@unique([user_id, client_request_id])`，识别普通回答与资源回答的请求重放；`case_event_key` VarChar(80)?，`@@unique([post_id, case_event_key])`，系统回贴的唯一键；`resource_id` Int? → `patch_resource` **SetNull**（审核拒绝会物理删除资源行，回答必须留下）；`resource_state` VarChar(16) default `none`（`none`/`pending`/`listed`/`not_listed`/`violation`，没有中间态）；`created`/`updated`。索引：`([post_id, created, id])`、`([user_id, created(desc)])`、`([resource_id])`、`([community_verified_at])`。

不保存有效票计数。`help_answer_vote.user_id` 是级联删除，账号注销会带走投票行，冗余计数必然漂移，而修计数只能再加一个补偿任务。社区验证扫描改用 `help_answer_vote.groupBy({ by: ['answer_id'], where: { answer: { … } }, having: { answer_id: { _count: { gte: 阈值 } } } })`，票数始终由行数决定。

**`help_answer_vote`（拟新增）**：`id`、`answer_id` Cascade、`user_id` Cascade、`created`；`@@unique([answer_id, user_id])`、`@@index([user_id, created(desc)])`。

**`help_me_too`（拟新增）**：`id`、`post_id` Cascade、`user_id` Cascade、`created`；`@@unique([post_id, user_id])`、`@@index([user_id, created(desc)])`。它同时是订阅事实。

**`help_bounty`（拟新增）**：`id`、`post_id` Cascade、`seq` Int、`amount` Int、`client_request_id` VarChar(64)、`reservation_id` Int? @unique → `user_moemoepoint_reservation` SetNull、`created`；`@@unique([post_id, client_request_id])`、`@@unique([post_id, seq])`。发布时 `seq = 0`，每次追加 `seq + 1`。`seq` 只用于排序与构成预留幂等键，不是请求幂等键：识别重放的是 `client_request_id`，否则同一次「追加 20 点」的网络重试会预留两份。

**`help_daily_quota`（拟新增）**：`user_id` Int、`day` VarChar(10)（上海自然日 `YYYY-MM-DD`）、`posts_created` / `rewards_earned` / `bounty_amount` / `votes_cast` Int default 0、`updated`；`@@id([user_id, day])`。选它而不是给 `user` 加四个计数列，是因为[现有日计数](../../server/tasks/resetDailyTask.ts)靠全表 `updateMany` 归零，再加四列会让归零任务更重；配额行按天新建、随查询自然过期，且能用条件 `updateMany` 提供数据库级原子限额。

计数与排序一律不做冗余字段：「N 条同问」「我也遇到了人数」「有效票数」「无回答」都用关系计数与 `orderBy` 关系计数，既避免漂移，也避免为对账再加一个任务。

## 5. 接口、校验、权限与幂等

新增 `app/api/help/`（拟新增）、`app/api/admin/help/`（拟新增）、`validations/help.ts`（拟新增）、`types/api/help.ts`（拟新增）。沿用 `kunParse*` 解析、CSRF 与 origin 校验；错误仍以 HTTP 200 返回中文字符串。

| 路由（拟新增）                        | 权限                                  | 关键校验                                                                                                                                                                                         | 原子性与幂等                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/help`                       | 公开                                  | 锚定、意图、话题、状态筛选；求物默认包含                                                                                                                                                         | 无个性化字段，走匿名响应缓存命名空间 `help`                                                                                                                                                                                                                                                                          |
| `GET /api/help/[id]`                  | 公开；`hidden` 仅作者与 `role >= 3`   |                                                                                                                                                                                                  | `private, no-store`                                                                                                                                                                                                                                                                                                  |
| `POST /api/help`                      | 登录                                  | `clientRequestId` 必填；锚定组合合法性与目标可见性、话题枚举、求物类别、悬赏区间、余额                                                                                                           | 事务第一步用 `createMany({ skipDuplicates: true })` 按 `([author_id, client_request_id])` 建帖再回查：插入 0 行即为重放，直接返回原帖，不进入配额与扣费；插入 1 行才继续日配额条件更新 → `spendMoemoepoint`（键 `help:{id}:post-fee`，`requiredAvailable = 发布费 + 悬赏`）→ 可选 `reserveMoemoepoint`。整段同一事务 |
| `POST /api/help/[id]/answer`          | 登录                                  | 帖未隐藏且按锚定分支可读；`kind` 固定 `user`；`clientRequestId` 必填。未解决、已解决、已关闭三态都可回答，关闭态回答不改状态、只通知提问者                                                       | 在帖行条件保护内：按 `([user_id, client_request_id])` 跳重插入并回查；命中行的 `post_id` 与本请求不一致时按冲突拒绝，绝不返回别帖的回答；仅新插入时刷新 `last_activity_at`                                                                                                                                           |
| `PUT`/`DELETE /api/help/answer/[id]`  | 回答作者                              | 非系统回答；未被采纳、未获奖励名额、未被社区验证                                                                                                                                                 | 与采纳、社区验证串行化在同一行锁上：事务先对 `help_post` 做一次条件更新取得该行的写锁，再在同事务内复核三个指针并改回答。禁止先读父表再无条件改子表                                                                                                                                                                  |
| `POST /api/help/[id]/accept`          | 提问者                                | 回答属本帖、`kind = 'user'`、该回答未被隐藏、回答者非本人。帖被隐藏时提问者仍可采纳（基线的「隐藏后迟到采纳」），被隐藏的回答永远不可被采纳                                                      | `updateMany where id AND author_id AND accepted_answer_id IS NULL`；`count = 0` 即已采纳。同一事务内再争夺奖励名额（`awarded_answer_id IS NULL`）与结算悬赏；作者改删因共用该行锁而被排到前后，不会交叉                                                                                                              |
| `POST /api/help/[id]/reopen`          | 提问者                                |                                                                                                                                                                                                  | `updateMany where status = 'closed'` 的比较并交换：同一关闭周期内只有一次成功，`count = 0` 表示帖已不在关闭态。同事务刷新 `last_activity_at` 并通知锚定资源发布者                                                                                                                                                    |
| `POST /api/help/[id]/me-too`          | 登录                                  | 帖按锚定分支可读                                                                                                                                                                                 | `createMany({ skipDuplicates: true })`：插入 0 行即已点，不刷新活动时间、不消耗任何配额；插入 1 行才刷新 `last_activity_at`。可能跨过桥接阈值时按下文的 case → help 次序执行，不在持有帖行锁时反向去取工单                                                                                                           |
| `POST /api/help/answer/[id]/vote`     | 登录                                  | 注册时长门槛、非回答作者、回答未隐藏                                                                                                                                                             | 事务：先 `createMany({ skipDuplicates: true })`，插入 0 行直接返回且不占每日配额；插入 1 行才做 `votes_cast` 条件更新，超限则整个事务回滚                                                                                                                                                                            |
| `POST`/`DELETE /api/help/[id]/bounty` | 提问者                                | `clientRequestId` 必填；追加只能提高、受每日悬赏额度约束，且帖必须 `status = 'open'`、`accepted_answer_id IS NULL`、`hidden = false`；撤回仅在该帖尚无任何 `kind = 'user'` 回答时                | 追加：按 `([post_id, client_request_id])` 识别重放并直接返回原结果，不重复校验也不重复扣费；否则在帖行条件保护内新建 `help_bounty` 行与新预留，`bounty_total` 同事务累加；撤回：`bounty_state` 条件更新 `held → withdrawn` 后逐行 `releaseMoemoepoint`                                                               |
| `POST /api/help/[id]/link-patch`      | 提问者、`role >= 3`，或经核实的投稿人 | 条目存在且对操作者可见；该帖为未落地求物；投稿人身份由 [patch_submission](../../prisma/schema/patch-submission.prisma) 反查（目标条目对应的投稿已发布且 `user_id` 等于操作者），不接受客户端自称 | `updateMany where anchor_type = 'wanted_game'`，同一语句把 `anchor_type` 改为 `patch` 并写入 `patch_id`，`wanted_game_name` 保留作展示；`count = 0` 即已落地                                                                                                                                                         |
| `POST /api/help/[id]/to-case`         | 锚定资源的 `user_id`                  | 仅 `anchor_type = resource`                                                                                                                                                                      | `updateMany where case_id IS NULL`；工单本身由模块 03 按「资源 + 类型」去重，多条求助可以指向同一条工单                                                                                                                                                                                                              |
| `POST /api/help/answer/[id]/resource` | 回答作者                              | 复用 `patchResourceCreateSchema`；帖为已落地条目资源类求物                                                                                                                                       | 见下文的原子创建与转换                                                                                                                                                                                                                                                                                               |
| `GET`/`POST /api/admin/help`          | `role >= 3`                           | 概览（含无人回答率的分子与分母）、隐藏与恢复                                                                                                                                                     | 隐藏时同事务释放悬赏；恢复不重新预留                                                                                                                                                                                                                                                                                 |
| 求助与回答的举报                      | 登录用户提交，站方处理                | 目标类型扩展出 `help_post` 与 `help_answer`                                                                                                                                                      | 提交与处理都走模块 03 的站方举报队列，07 只提供目标解析与隐藏、恢复的执行端                                                                                                                                                                                                                                          |

子表写入一律在父帖行的条件保护内完成。回答、投票、「我也遇到了」、资源回答、追加与撤回悬赏都先对 `help_post` 做一次条件更新取得该行的写锁，再在同事务内复核可读性与当前状态，然后写子表；不允许先判 `hidden` 再无条件落子表，否则会与采纳、隐藏、自动关闭交叉。系统回贴不带 `client_request_id`，不刷新 `last_activity_at`，不计入用户回答、费用与奖励。请求幂等的命中还要校验请求语义：同一用户的同一 `clientRequestId` 若命中的是一条普通回答而本次是资源回答（或反之），按冲突拒绝，绝不把普通回答冒充成「资源已创建成功」。帖被隐藏时提问者保留一个受控只读视图：可读本帖与未隐藏的回答、可以采纳，公众不可读，任何人不得新增回答与互动。

模块 03 侧的两个入口（工单转求助、工单结案回贴）由 03 调用本模块的 `app/api/help/bridge.ts`（拟新增）导出的服务，在 03 的结案事务内执行。工单实体沿用模块 03 的 `ops_case`，结案事件取 03 统一结案出口产生的 `ops_case_message.id`；终结动作不限于 `resolved`，`hidden`、`moved` 等同样要回贴，因此不按 `event` 值筛选，只取本次结案消息的 ID。回贴正文只写 03 给出的可公开结论，不复制该消息的私有载荷。两条保证：`from_case_id` 唯一，一条工单至多转出一条求助；系统回贴按 `([post_id, case_event_key])` 唯一，`case_event_key` 取该结案消息 ID，因此一条工单关联的每条求助各收到一次回贴，工单重开后再次结案会产生新 ID、再回贴一次，而同一事件的重试不会重复。写入用 `createMany({ skipDuplicates: true })`，不让 `P2002` 中断 03 的外层事务。

**加锁次序统一为 case → help，手动与自动两条桥接路径都遵守。** 否则会死锁：任一路径若先锁 help 再等 case，而 03 结案已持 case 锁并因外键等待 help，两侧互等。

- 「求助转工单」在同一事务里先解析或创建目标工单，再锁 help 并条件更新 `case_id`；`count = 0` 时整事务回滚，不留下孤立工单。
- 「我也遇到了」达阈值这条自动路径同样不能在持帖行锁时反向取工单。做法是事务前先读该帖的 `anchor_type`、`case_id` 与当前计数：只有「锚定资源、`case_id` 为空、且本次插入后可能达到阈值」时才走带工单的次序（先取或建工单，再锁 help、插行、条件更新 `case_id`）；其余情况走普通短事务。若在锁内才发现插入后已达阈值而此前没取工单（预读已过时），回滚这次短事务，再按带工单的次序有界重试，最多两次。未达阈值的帖不预先创建工单；带工单次序里发现 `case_id` 已非空则复用既有工单、不新建；新建工单后关联失败则整事务回滚。
- 03 结案时持 case 锁后按 help 主键升序逐条写回贴。同问、普通回答、投票与悬赏操作不触及工单，不加这一层。

工单转求助只复制原开启者本人提交、原本就可公开的初始描述与锚定上下文，不复制工单内的后续对话、站方备注或私有举报内容；找不到可归属的原开启者时不提供该转换入口。

求助与回答的举报映射到模块 03 的站方举报目标类型，处理端在 03 的队列里；07 负责目标解析、隐藏与恢复，以及隐藏时释放悬赏。不复用[旧举报表](../../prisma/schema/patch-report.prisma)，因为它的 `patch_id` 非空，话题锚定的求助无法落表。自动隐藏阈值不沿用小喇叭的候选数值，见第 12 节。求助本身不进入模块 01 的统一收件箱，因为站方不是回答者，也避免给多队列合并再加一个来源。

**资源回答在一个事务内完成。** [资源创建](../../app/api/patch/resource/create.ts)已经把对象存储上传放在 `prisma.$transaction` 之前，事务内只有建行、发奖励与更新条目属性三件事。因此最小改法是把该事务体抽成一个接受调用方 `tx` 的函数（放在 `app/api/patch/resource/_helper.ts` 或同目录新文件），原路由与本模块各调一次；不重写资源模块，也不改其判定与奖励语义。求助侧在同一事务内建回答、建资源、写入 `resource_id` 与 `pending`/`listed`。这样不存在「资源已建、回答未回填」的中间态，审核无论多快都能找到回答，也不需要补偿任务；网络重放由回答的 `([user_id, client_request_id])` 唯一键拦住，不会多出第二条资源与第二份既有发布奖励。

资源侧不放宽任何既有门槛：[资源路由](../../app/api/patch/resource/route.ts)的存储类型角色限制、普通用户可用点 ≥ 20、同一用户至多一条待审资源、以及 `lock:patch:resource:create:{uid}` 短锁全部适用。门槛不满足时整个请求失败并明确说明原因，不静默降级成一条纯文字回答；用户可以改发普通回答，那是另一次显式操作。

**文字回答「转为条目资源」另有一处绑定竞争。** 新回答的 `client_request_id` 只挡得住同一请求的重放，两个不同请求同时转换同一条回答仍会建出两条资源与两份既有发布奖励。因此转换的原子性落在原回答上：同一事务内先 `updateMany where id AND user_id AND post_id AND resource_id IS NULL AND resource_state = 'none'` 取得该行，`count = 0` 表示已经转换过，回查后返回原结论。只判 `resource_id IS NULL` 不够——审核判违规、判不收录以及资源被普通删除都会把它置空，仅凭空值会让一条已转换过的回答再建一条资源、再发一份既有发布奖励；`resource_state` 只要不是 `none`，也就是处于 `pending`、`listed`、`not_listed`、`violation` 中任一「已经转换过」的状态，就不可再转换，界面显示上一次的结论。取得该行后，随后在同事务内建资源并回填 `resource_id` 与 `pending`/`listed`。上传准备仍在事务之前，但进入准备前先查该回答是否已绑定资源，已绑定就直接返回，避免重复上传与随后的清理。绑定唯一即够，不新增事件表。

资源行后续被普通删除、被模块 06 合并或被移动到其他条目时，回答按当时真实的资源行处理：`resource_id` 是 `SetNull`，资源消失后置空、帖中保留最后一次审核结论。模块 06 先于本模块上线，因此把 `help_answer.resource_id` 与求助的资源锚定接进 06 已交付的合并引用迁移，是本模块批次内的改动，不能要求 06 在自己的阶段查询当时还不存在的表。资源被移动到别的条目后，锚定的可见性按联表取到的 `resource.patch_id` 判定，不用求助行上那份可能过时的副本。

**审核联动。** [资源审核服务](../../app/api/admin/resource-apply/service.ts)现在的 `decline` 只有一个 `reason` 字符串且直接删除资源行，无法区分基线要求的两种结果。最小改动：在 `validations/admin.ts` 的 decline schema 增加可选 `outcome: 'not_listed' | 'violation'`（缺省 `not_listed` 以兼容旧调用），并在 decline 事务内按 `resource_id` 条件更新对应回答：`not_listed` 只置 `resource_state = 'not_listed'`，`violation` 在同一事务内另置 `hidden = true`。approve 事务内置 `listed`。因为关联在资源创建的同一事务里就已写好，不存在审核早于绑定的情形；资源行随 decline 被删除后 `resource_id` 变空，回答与终态标记仍在。影响范围：该服务、`validations/admin.ts`、模块 01 的拒绝动作界面需要多一个选项，门槛不变，仍为 `role >= 3`。

**账务事件与幂等键**（金额随 D8，键与原语不随）：

| 事件         | 原语                                   | 新增 reason code          | 幂等键                                              |
| ------------ | -------------------------------------- | ------------------------- | --------------------------------------------------- |
| 发布费       | `spendMoemoepoint`                     | `help.post_fee`           | `help:{postId}:post-fee`                            |
| 系统奖励     | `earnMoemoepoint`                      | `help.answer_reward`      | `help:{postId}:answer-reward`                       |
| 悬赏预留     | `reserveMoemoepoint`                   | `help.bounty_hold`        | `help:{postId}:bounty:{seq}`                        |
| 悬赏释放     | `releaseMoemoepoint`                   | `help.bounty_release`     | 服务内置 `reservation:{id}:released`                |
| 悬赏结算扣除 | `forfeitMoemoepoint` 逐行              | `help.bounty_settle`      | 服务内置 `reservation:{id}:forfeited`               |
| 悬赏支付     | `earnMoemoepoint`                      | `help.bounty_payout`      | `help:{postId}:bounty-payout`                       |
| 迟到采纳直付 | `spendMoemoepoint` + `earnMoemoepoint` | `help.bounty_late_settle` | `help:{postId}:bounty-late-charge` / 同上 payout 键 |

支付额 = `min(floor(总额 × 保留比例), 总额 − 1)`，按总额一次计算，不逐行取整。涉及提问者与回答者两个账户的结算，在同一事务内按用户 ID 升序依次写入，避免互为反向的两笔结算死锁。预留行 `pending → released/forfeited` 由[账务服务](../../app/api/moemoepoint/service.ts)的状态机保证只发生一次。全部新增 code 与展示行同步进[constants/moemoepoint.ts](../../constants/moemoepoint.ts)，该文件注释要求展示金额与实现一致；D8 未定前不写入任何候选数值。

**悬赏动作矩阵。** 金额与个别分支是否开放属 D8，此处只固定可执行语义。矩阵只描述 `bounty_state` 的迁移；「追加」还要同时满足接口表里的帖状态前置（`open`、未采纳、未隐藏），少了那道门，一条已解决且从未设悬赏的帖仍能事后追加，点数会永久停在预留里没有出口：

| 当前 `bounty_state`     | 追加                                | 撤回                                                | 提问者采纳                                                                                                                 | 自动关闭 / 被隐藏           |
| ----------------------- | ----------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `none`                  | 建首笔预留，转 `held`               | 不适用                                              | 只发系统奖励                                                                                                               | 不动                        |
| `held`                  | 新建一笔预留，`bounty_total` 累加   | 仅在无用户回答时允许，转 `withdrawn` 并释放全部预留 | 结算全部预留并支付，转 `settled`                                                                                           | 释放全部预留，转 `released` |
| `released`              | 是否允许重新预留属 D8，未定前不开放 | 不适用                                              | 可用余额 ≥ `bounty_total` 时按原额直付并转 `settled`；不足则只发系统奖励、转 `unsettled`、帖标「悬赏未结算」，不做部分扣款 | 不动                        |
| `withdrawn`             | 同 `released`，属 D8                | 不适用                                              | 不再按 `bounty_total` 扣款，只发系统奖励                                                                                   | 不动                        |
| `settled` / `unsettled` | 不适用                              | 不适用                                              | 采纳已发生，不重复                                                                                                         | 不动                        |

奖励名额只有一个入口：谁先把 `awarded_answer_id` 从空改成非空谁得到它。若名额已被社区验证给了 A，之后提问者采纳 B，则 B 只拿悬赏，不再发第二份系统奖励。名额的候选口径是由**首个合格事件**赢得：不合格的事件（双方任一注册未满门槛，或回答者当日系统奖励次数已满）只写采纳或社区验证标记，不消耗名额、也不给自己补发，但之后出现的合格事件仍可取走这唯一名额一次。这是本模块给 D8 的单一候选读法，不是基线的唯一读法，批准前不当作既定规则。

该候选与基线「社区验证只在提问者尚未采纳时生效」的交互必须写明，否则自相矛盾：社区验证的**标记**条件仍是回答自身 `community_verified_at IS NULL` 且帖 `accepted_answer_id IS NULL`，**名额**条件是帖 `awarded_answer_id IS NULL`，两者分开判。于是已被标记但不合格的那条回答离开扫描集合，不会次日被补发；同一帖上另一条后来达阈值且作者合格的回答，仍能在同一次扫描里取走空名额。反过来，若首个事件是一次不合格的采纳，基线的「尚未采纳」条件让社区验证此后不再生效，这个名额就不再有事件可取——这是候选方案的已知后果，随 D8 一并审，不为它另加奖励类型或补发机制。

每日系统奖励次数上限只挡系统奖励，不挡合格的悬赏结算（基线明写悬赏结算不计入此上限）。注册时长不足导致悬赏不结算时，采纳照常成立，但**已 `held` 的预留必须在同一事务内释放并把 `bounty_state` 置 `unsettled`**，帖中标「悬赏未结算」；不能因为帖已 `solved` 就把点数永久冻结在预留里。以上口径记入第 12 节，实验按同一口径验证，不做两可实现。

## 6. 前后台界面及文件

前台沿用 HeroUI v2。拟新增：`app/help/page.tsx`（列表与筛选）、`app/help/[id]/page.tsx`（详情）、`app/help/create/page.tsx`（发布，含相似求助、费用提示、无回应义务与一句话受理范围）、`components/help/`（`HelpCard`、`HelpDetail`、`AnswerList`、`AnswerEditor`、`ResourceAnswerForm`、`BountyPanel`、`SimilarHelpPanel`、`MeTooButton`、`SameQuestionButton`、`WantedPatchBanner`、`SystemReplyItem`）。

拟修改：模块 05 的分流入口。M05-3 的运行、解压临时去向定义在 05 交付的 `constants/issueTriage.ts` 与 `IssueTriageDialog` 里，07 改的是这两处的分支目标；[DownloadCard](../../components/patch/resource/DownloadCard.tsx) 只是它们的宿主之一，只改卡片会漏掉其他入口。[首页服务](../../app/api/home/service.ts)新增最新求助与最新评论两段，`HOME_PAYLOAD_CACHE_VERSION` 由 `v2` 提升，`HomeData` 与[types/api/home.ts](../../types/api/home.ts)（其中 `HomeComment` 已存在）补齐类型；首页组件增加两个栏目。「大家在求的游戏」挂在[本人「发布条目」页](../../app/(site)/user/[id]/submission/page.tsx)：该页本人分支按角色分成 [AdminEntryPanel](../../components/submission/AdminEntryPanel.tsx)（`role >= 4`，跳 `/edit/create`）与 [SubmissionQuotaPanel](../../components/submission/SubmissionQuotaPanel.tsx)（其余作者），列表放在两个分支共同渲染的位置。求物跳转把游戏名作为查询参数带来，`SubmissionQuotaPanel` 建草稿时把 `payload.name` 从固定的「未命名投稿」换成该建议名——该组件第 42 至 50 行已经在用 `requestId` 加 `payload` 建草稿再跳 `/submission/{id}`，只需替换名称；参数只是用户可再编辑的建议，不作可信输入。

过滤分两层，不能混成一条谓词。**公开可见性**由列表页、详情、相似求助、同问的只读摘要与系统回贴共用一个实现：`hidden = false`，并满足第 4 节按锚定分支的读取条件，其中条目侧走[可见性 where](../../app/api/utils/getPatchVisibilityWhere.ts)（含 NSFW 与屏蔽标签）。**首页聚合**在公开可见性之上再加一条作者 `register_time <= now − 注册时长门槛`。基线 8.5 明确这条门槛「只影响是否上首页，不影响发布本身」，因此不能下放到普通列表与详情，否则新用户付了发布费却看不到自己的求助。首页排序按「未解决且无用户回答」优先，再按创建时间倒序，系统回答不计入「有回答」。评论侧按同一分层处理：公开可见性沿用模块 03 的最终内容可见性谓词，首页再加注册时长门槛。

后台使用独立样式的 shadcn，门槛 `role >= 3`，拟新增 `components/dashboard/help/`，做举报处理所需的查询、隐藏与恢复、关联到条目，并在该页显示一个无人回答率数字。这对应[第 8 份计划](../8.operations-layer-rollout-plan.md)第 5 节阶段 4 的「无人回答率在后台可见」验收。落实方式是第 5 节已经规划的 `GET /api/admin/help` 概览多返回一组分子分母：不新增页面、不新增接口、不做快照、不做图表。候选口径与模块 09 对齐——分母是近 30 天内创建、未隐藏且目标按锚定分支可公开的求助，分子是其中不存在「他人可见的用户回答」的那些；提问者本人的自答（`help_answer.user_id` 等于 `help_post.author_id`）、`kind = 'system'` 的回贴、以及被隐藏的回答都不算已回答。这项全站指标按对象状态与锚定存在性取数，不随管理员个人 NSFW 或屏蔽偏好变化。精确口径仍按 D9 定稿；内部查询接收默认 30 天的窗口参数，07 概览使用默认值，模块 09 复用它接完整指标页。控制台路径与命名随模块 01 的 `/dashboard` 决定，本模块不重复决策。破坏性动作沿用超级管理员边界，本模块不新增此类动作。

**写入 → 失效表**

| 写入                                            | 需要失效的读取面                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 发布、回答、隐藏/恢复、采纳、社区验证、自动关闭 | 求助详情与列表、相似求助、首页聚合（`invalidatePatchListCaches` 已含 `home_data:*` 与匿名接口缓存）、锚定条目/资源入口 |
| 关联到条目                                      | 该帖详情、「大家在求的游戏」、条目页求助入口                                                                           |
| 资源回答审核结果                                | 帖详情、条目资源列表（沿用既有资源缓存失效）、首页                                                                     |
| 账务变化                                        | 用户点数展示与明细（沿用现有读取面，无新增缓存）                                                                       |

匿名接口缓存的内存层只清本进程，这是既有限制（[实现](../../app/api/utils/anonymousApiResponseCache.ts)），沿用不改；配合[缓存时长](../../config/cache.ts)的 TTL 上界，注册时长门槛与「无回答」这类随时间变化的条件靠 TTL 自然收敛。

## 7. 定时任务

拟新增 `server/tasks/helpZoneTask.ts`，注册进[server/cron.ts](../../server/cron.ts)。频率 `*/15 * * * *`，`timezone: 'Asia/Shanghai'`，`noOverlap: true`，`withTaskLock` key `cron:help-zone:lock`、TTL 1800 秒、`releaseOnComplete: true`。锁无续租（[实现](../../server/tasks/withTaskLock.ts)），因此每步都必须是可重复执行的条件更新；每步单批上限 200 条，处理完继续下一批直到无到期记录，按「到期即处理」筛选而不是「本分钟到期」。入口函数接受 `now` 参数，默认 `new Date()`，供实验注入假时钟。

| 步骤           | 条件                                                                                                                                                                         | 动作                                                                                                                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 自动关闭       | `status = 'open'` 且 `hidden = false` 且 `now >= last_activity_at + 关闭窗口`                                                                                                | 同事务置 `closed`、写 `closed_at`、通知提问者；悬赏按第 5 节矩阵**只在 `bounty_state = 'held'` 时**释放预留并转 `released`，`none`/`withdrawn`/`settled`/`unsettled` 原样不动——无条件写 `released` 会把撤回过的悬赏改回可结算，之后采纳就会再扣一次已撤回的钱。自动隐藏走同一规则 |
| 社区验证等待期 | 票行分组计数 ≥ 阈值；回答 `community_verified_at IS NULL`、`hidden = false`、`kind = 'user'`；帖 `accepted_answer_id IS NULL`、`hidden = false` 且 `now >= created + 等待期` | 条件更新写入 `community_verified_at`；名额另按 `awarded_answer_id IS NULL` 与资格、日上限争夺，两组条件分开判，因此已标记但不合格的回答离开扫描集合、不被次日补发，而同帖另一条后来达阈值且合格的回答仍能取走空名额；只有赢得更新的那次发通知                                     |

关闭步骤必须写成一条 `updateMany`，把 `last_activity_at` 的比较放进 `where`，不能先读列表再无条件更新：新回答与首次「我也遇到了」刷新的正是同一个字段，任务读到旧值后落库时条件已不成立，更新自然落空，刚有活动的帖不会被关掉。

只有这两步。隐藏与关闭都在各自事务里连同预留释放一起提交，不存在「已关闭却仍 `held`」的中间态，因此不设兜底释放任务——为不可能出现的中间态造任务只会掩盖真正的缺陷。应用内任务停用或 Redis 不可用时，积压体现为「`open` 且已超期」与「票数达阈值且已过等待期却未标记」的记录数，恢复后按同一条件补跑即可。

## 8. 迁移与回填

- 全部为新表，无历史数据回填。既有表只增反向关系声明，不新增列；新增外键约束只落在 help 侧。
- 交付顺序：隔离库演练建表迁移 → 生产按既有流程执行只读 preflight、已审 sync、postflight → schema guard 与构建部署（入口未开）→ 开放前台入口与 cron → 记录结果。文档阶段不运行这些命令。
- 纯代码变更（无迁移）：[constants/moemoepoint.ts](../../constants/moemoepoint.ts)新增 reason 与规则展示行、`validations/admin.ts` 的 decline `outcome` 可选字段、[资源审核服务](../../app/api/admin/resource-apply/service.ts)的联动、把[资源创建](../../app/api/patch/resource/create.ts)的事务体抽成可接收调用方 `tx` 的函数（外部行为不变，由原路由的回归测试保证）、首页缓存版本号。
- 账号被删除时的终态沿用既有约束，本模块不新增清理任务：[预留行](../../prisma/schema/moemoepoint.prisma)的 `user_id` 是 `onDelete: Cascade`，与 `help_post.author_id`、`help_bounty.post_id` 的级联一起生效，删号会同时带走该用户的求助、悬赏行与预留行，不会留下无主的 `pending` 预留。本模块也不扩展账号注销流程。
- 回退边界：可以停止新增求助与新增悬赏，但已存在的预留必须仍可释放与结算，不能让点数永久冻结；已写入的采纳、奖励名额与账务明细不做应用层回滚，优先回退到仍理解新表的兼容版本。

## 9. 测试与实验方案

单元测试优先扩展既有 `tests/unit/api/moemoepoint-service.test.ts` 与新增 `tests/unit/api/help-*.test.ts`；真实并发、外键与迁移行为只在显式隔离的测试数据库证明，mock 不能代替。并发用测试层屏障或受控事务交错实现，交错点按第 5 节的实际加锁次序（父帖行、case → help）安排，不引入生产延迟开关或通用试验平台；日期边界注入 `now` 或假时钟，不修改机器时间。全部实验状态：**未执行**。

**E07-01 锚定、同问、关闭、重开与采纳。** 目的：证明锚定组合与状态机的服务端判定唯一且可重复。前提：隔离测试库、注入时钟、种子含 SFW 与 NSFW 条目各一、NSFW 条目下的资源一条、五个话题各一、尚无条目的游戏名一个。步骤与组合：按合法组合表逐项发布，并提交若干非法组合（求物锚定 `resource`、站外事物求物锚定 `wanted_game`、`topic` 带 `patch_id`、`wanted_game` 不给名称、`resource` 与 `patch_id` 不匹配、目标不存在或不可见）；构造 `now` 恰好等于与刚超过 `last_activity_at + 关闭窗口` 的两条帖并推进时钟运行任务；构造「任务已读出候选、落库前该帖收到新回答」的交错；对已关闭帖提交新回答与采纳；关闭后重开一次再重开，随后再等满一个窗口被关闭后再次重开；对原帖与同问帖各点一次「提出相同问题」；对已采纳帖再次采纳；删除一条被锚定的资源后再读该帖的各个公开面；另把一条未落地求物关联到条目使其转为 `patch` 锚定，再删除该条目后重读，并与一条真正未落地的求物对照。通过判据：非法组合全部被服务端拒绝；只有 `now >= last_activity_at + 窗口` 的帖被关闭，边界相等的一条按同一不等式判定且结果稳定；有新活动的帖在同一轮任务中不被关闭；关闭后回答与采纳均成功且采纳使帖变为 `solved`；同一关闭周期内第二次重开返回「已不在关闭态」，下一个关闭周期可以再重开一次；同问帖的 `origin_post_id` 始终指向最初原帖；重复采纳返回已采纳且字段不变；资源被删后该帖在任何公开面都读不到，不因 `patch_id` 仍在而继续公开；落地后条目被删的求物同样不可读，且不退回「大家在求的游戏」，而真正未落地的那条仍在该列表里。失败判据：出现二次采纳、跨层同问、边界判定不一致、刚有活动的帖被关掉、重开被收紧成一生一次、目标失踪的帖仍公开可见，或落地过的求物被误当作从未落地。时间点：M07-2 完成后、批次上线前。证据：SQL 快照、任务日志、交错时序记录。清理：回滚测试库。相关单测：合法组合校验、状态转换条件更新、同问层级归一。

**E07-02 发布费、奖励、悬赏及并发账务守恒。** 目的：证明三类事件独立记账、并发不重复发放，且逐笔守恒可核。前提：隔离测试库、账务表初始快照、注入时钟。步骤与组合：无悬赏与两档悬赏各发一帖；发布与追加悬赏各用同一 `clientRequestId` 重放三次；同一采纳请求重放三次；对同一帖并发触发采纳、自动关闭任务与社区验证；悬赏在无回答与有回答两种情形下尝试撤回；撤回后再让该帖自动关闭或被隐藏，随后迟到采纳；在未解决状态下先追加一次再采纳，以及采纳之后再试一次追加；`released` 之后再采纳，分别在余额充足与不足时各一次；先由社区验证把名额给 A，再由提问者采纳 B；提问者或回答者注册未满门槛时采纳一条带悬赏的求助；当日系统奖励次数已满但双方均合格时采纳一条带悬赏的求助；一条求物收到两条资源回答且其中一条被采纳，两条资源分别经历审核通过、判不收录、判违规；由工单免费转入的求助被采纳。通过判据：重放不产生第二条帖、第二笔预留或第二次扣费；ledger 中 `help:{postId}:answer-reward` 与 `help:{postId}:bounty-payout` 各至多一条；预留行终态唯一；有回答时撤回被拒；未解决时追加成功并按新总额结算，采纳之后的追加被拒、不产生新的预留，账上不留没有出口的冻结额；撤回后经自动关闭或隐藏，`bounty_state` 仍是 `withdrawn`，其后采纳不产生任何悬赏扣款；余额不足时只发系统奖励、置 `unsettled`、不做部分扣款；A 已获名额后采纳 B 只支付悬赏、不再发第二份系统奖励；资格不足时采纳成立、已 `held` 的预留在同一事务释放并置 `unsettled`，账上不留冻结额；当日奖励满额只挡系统奖励，合格的悬赏照常结算；名额按候选口径「首个合格事件赢得、之后的合格事件仍可取走一次」落库，已标记但不合格的回答不被次日补发，首个事件是不合格采纳时该名额此后无人可取（作为已知后果记录，不当缺陷）；免费转入的求助不产生系统奖励；每一笔用户间转移在两侧各有一条金额相反的明细，系统发放与烧毁另计入系统侧，不要求用户余额之和为零；下面两张表逐行相符。

| 场景                       | 提问者                  | 回答者                   | 系统净额                   |
| -------------------------- | ----------------------- | ------------------------ | -------------------------- |
| 无悬赏，采纳或社区验证     | −发布费                 | +系统奖励                | 净回收 = 发布费 − 系统奖励 |
| 有悬赏，采纳               | −发布费 −悬赏           | +系统奖励 +支付额        | 净回收再加烧毁额           |
| 有悬赏，自动关闭未采纳     | −发布费（悬赏退回可用） | 0                        | 净回收 = 发布费            |
| 释放后迟到采纳，余额充足   | −发布费 −悬赏           | +系统奖励 +支付额        | 同「有悬赏，采纳」         |
| 释放后迟到采纳，余额不足   | −发布费                 | +系统奖励                | 净回收 = 发布费 − 系统奖励 |
| 资源回答被采纳（普通用户） | −发布费                 | +系统奖励 +资源发布奖励  | **系统净发出**，见第 2 节  |
| 同上但判不收录或违规       | −发布费                 | 同上，现状不回收资源奖励 | **同为系统净发出**         |
| 自问自答                   | −发布费                 | 0（回答者不得为提问者）  | 净回收 = 发布费            |

资源回答另立一张表，因为它同时动到既有的资源贡献账，两本账必须分列，不能用一个「+3」概括所有求物。设一条求物收到 N 条资源回答（N ≥ 1），其中一条被采纳：

| 账本           | 收         | 发                                                             | 小计                       |
| -------------- | ---------- | -------------------------------------------------------------- | -------------------------- |
| 纯求助账       | 发布费 × 1 | 系统奖励 × 1                                                   | 净回收 = 发布费 − 系统奖励 |
| 既有资源贡献账 | 0          | 资源发布奖励 × N（创建时即发，含待审；判不收录或违规都不回收） | 净发出 = N × 资源发布奖励  |
| 合计           |            |                                                                | N 越大越偏向净发出         |

两本账相加后「每条求助至少净回收 2 点」不成立。本模块不改既有资源经济规则：调整资源奖励的发放时点并不改变已通过资源的长期净额，只会把差异挪到被拒绝的资源上，属于全站改账，不列为本模块的修复方案。是否接受这一增量记入第 12 节。

失败判据：任一幂等键出现两条、预留被重复结算、并发下出现两次奖励、发布或追加的网络重放造成第二次扣费或第二笔预留，或两本账的实测值与上表不一致却未被记录。时间点：D8 定稿后、M07-5 完成时。证据：ledger 与 reservation 全量导出、交错时序日志。清理：回滚测试库。相关单测：支付额取整与「至少少 1 点」边界、名额争夺条件更新、请求幂等键命中。

**E07-03 有效投票、我也遇到了、工单桥接和通知。** 目的：证明投票与桥接的唯一性、配额不被重复点击消耗，以及通知接收人正确。前提：隔离测试库、模块 03 已上线并接入其举报队列、注入时钟；种子含注册时长跨门槛的用户各若干、同一资源下的两条求助。步骤与组合：注册未满与已满门槛的用户各投一票；同一用户对同一回答重复投票十次；同一用户对同一帖重复点「我也遇到了」十次；单用户当日投票超过上限；三名合格用户在等待期前后分别投票；两条锚定同一资源的求助各自并发点「我也遇到了」直至达阈值，并重放请求；发布者在其中一条点「转为工单」后重放；由 03 触发工单转求助、结案回贴、重开后再次结案，并重放同一次结案事件；对一条求助与一条回答提交举报并在 03 的队列里处理到隐藏与恢复；让 03 结案分别与「求助转工单」和「第三次『我也遇到了』触发自动桥接」并发，按 case → help 的统一次序各跑一轮，并让其中一条预读判为无需桥接、锁内才发现跨阈值，走一次有界重试；对一条以 `hidden` 结案与一条以 `moved` 结案的工单各检查回贴；对一条含站方备注与后续对话的工单执行「转为求助」；对一条找不到可归属原开启者的工单尝试转换；把一条带悬赏、已有回答的求助隐藏后由提问者采纳。通过判据：不合格投票被拒且不计票；重复投票与重复「我也遇到了」都不改变计数、不消耗当日额度、不刷新活动时间；超上限被拒；等待期前达阈值的回答在推进时钟后由任务标记；两条求助可以共享同一条工单，但各自只关联一次；同一结案事件对每条关联求助恰好产生一条系统回贴，重开后再结案会新增一条；提问者、我也遇到了的用户、各同问提问者、锚定资源发布者按基线规则各收到一次通知，已关闭帖不再通知发布者；举报能在 03 的站方队列里被处理，隐藏时 `held` 的悬赏被释放、恢复时不重新预留；两侧按同一加锁次序时不出现互等，关联失败时整事务回滚、不留孤立工单，未达阈值与非桥接操作都不产生任何新工单，锁内发现跨阈值后的有界重试最终只关联一次；`hidden`、`moved` 等终结动作与 `resolved` 一样各回贴一次；转出的求助只含原开启者的初始描述与锚定上下文，工单内的后续对话与站方备注不出现；无可归属开启者的工单不提供转换入口；被隐藏的求助公众不可读、不能新增回答与互动，但提问者可读受控视图并采纳未隐藏的回答。失败判据：重复点击吃掉配额、出现两条关联或重复回贴、结案事件的重试产生第二条回贴、通知重复或漏发、关闭后仍通知发布者、举报无处理端。时间点：M07-3 完成后。证据：通知表与关联字段导出、并发日志、03 队列的处理记录。清理：回滚测试库。相关单测：订阅集合派生、通知接收人计算、回贴唯一键。

**E07-04 求物落地、资源回答与审核联动。** 目的：证明求物闭环、资源回答的数据库级幂等，以及审核两种拒绝的联动。前提：隔离测试库、可用的资源创建链路（对象存储调用以受控替身代替）、可在事务提交前后注入中断的测试钩子。步骤与组合：发未落地求物 → 投稿并通过 → 由经核实的投稿人、提问者、管理员三方并发点「关联到条目」，另由非投稿人的第三方与自称投稿人的客户端各试一次，并对不可见条目试一次；在已落地帖上以普通用户、创作者首条、创作者非首条、管理员四种身份各提交一次资源回答；用同一 `clientRequestId` 重放提交；在资源已写入但事务尚未提交时注入中断并让客户端重试；将资源分别审核通过、判不收录、判违规；对文字回答点「转为条目资源」；构造「已有待审资源」「可用点不足」的用户各提交一次资源回答；对同一条已有文字回答用两个不同 `clientRequestId` 并发点「转为条目资源」，并对已转换过的回答再重放一次转换；把已转换回答的资源分别经审核判违规、判不收录与普通删除使 `resource_id` 置空后，各再重放一次转换；另用同一 `clientRequestId` 先发普通回答再提交资源回答。通过判据：关联只成功一次，非投稿人与自称投稿人被拒，不可见条目被拒；文字回答在四种身份下都立即可见且可被采纳；待审与直接公开的判定与第 2 节所述现行规则一致；重放与中断重试后帖中只有一条回答、条目下只有一条资源、ledger 里只有一份既有发布奖励；通过后帖中出现收录标记；不收录保留回答、违规在同一事务里隐藏回答，资源行删除后回答仍存在且 `resource_id` 置空；门槛不满足时整个请求失败并给出原因，不静默只留文字回答；并发转换同一条文字回答只产生一条资源与一份既有发布奖励，落后者返回同一绑定结果，已转换的重放不重复上传；资源因违规、不收录或普通删除而使 `resource_id` 置空后，重放转换被 `resource_state` 的「已经转换过」状态挡住，不再建第二条资源、不再发第二份发布奖励；跨类型复用同一请求 ID 时按冲突拒绝，不把普通回答报成资源创建成功。失败判据：文字回答进入任何审核队列、中断重试造成第二条资源或第二份奖励、审核结果未联动、资源行删除导致回答丢失、门槛失败被隐瞒。时间点：M07-4 完成后。证据：帖与资源双侧快照、ledger 导出、中断点日志。清理：回滚测试库与替身产物。相关单测：`resource_state` 转换表、decline `outcome` 分支、投稿人资格反查。

**E07-05 可见性、相似求助、限额与无回应义务。** 目的：证明公开可见性在所有读取面一致、注册时长门槛只作用于首页、相似求助排序正确、四项日限额在并发与重复点击下都成立、入口提示与真实能力一致。前提：隔离测试库、注入时钟、种子含 NSFW 条目及其下的资源、被隐藏的帖与回答、注册时长跨门槛的作者、已有社区验证回答的旧帖、NSFW 条目下的评论。步骤与组合：以开启与未开启 NSFW 的访客分别请求求助列表、求助详情、首页页面与首页接口、相似求助与同问的只读摘要；对 NSFW 条目下的资源发一条锚定资源的求助并重复上述读取；构造隐藏帖、隐藏回答与注册时长未满的帖与评论；在同一锚定对象下发多条帖后调用相似求助；单用户并发发布超过每日条数上限、并发投票超过上限、并发追加悬赏超过每日额度、并发获得超过每日奖励次数，并对同一回答、同一帖各重复点击十次；另构造四条帖用于复算无人回答率——无任何回答、只有提问者自答、只有系统回贴、唯一的他人回答被隐藏；走一遍模块 05 的分流入口，确认运行与解压分支落到求助发布页并带上资源上下文；核对发布界面与入口的提示文案。通过判据：公开可见性（隐藏加锚定分支）在上述每一个读取面给出一致结果，接口不比页面多返回任何内容；注册时长门槛只作用于首页聚合——新用户的求助在普通列表与详情正常可见、本人能打开，但不进首页，满门槛后才进入；锚定资源的求助按其所属条目判定分级；相似求助把社区验证有效的回答排在前；四项限额在并发下不被突破，重复点击不额外计数，配额行与业务行计数一致；缓存版本提升后首页返回新结构；后台概览显示的无人回答率与按候选口径手工复算的分子、分母一致，上述四条帖中前三条都计作未回答、第四条也计作未回答；分流入口的真实切换点已替换，未上线能力不出现在提示里，求物界面明示无回应义务。失败判据：任一读取面泄漏应被过滤的内容、资源锚定绕过分级、注册未满的作者在普通列表或详情里看不到自己的求助、限额被并发或重复点击突破、只改了下载卡片而其他分流入口仍指向旧去向。时间点：M07-6 完成后、上线前。证据：两种访客在各读取面的响应对比、配额行与业务行计数对比、分流入口走查记录。清理：回滚测试库并清空相关缓存键。相关单测：共用过滤谓词构造、相似求助排序、配额条件更新。

按仓库测试约定：改动 schema 与共享资产时跑全量测试，首页与布局相关改动加生产构建；上线前在隔离环境验证生产构建与所需迁移。

## 10. 实施任务与验收

| 任务                 | 落点                                                                                                                                                                         | 验收                                                                                                                                   | D8 阻塞                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| M07-1 实体与阅读     | `prisma/schema/help.prisma`、`app/api/help/`、`validations/help.ts`、`components/help/`、列表/详情/发布页                                                                    | 锚定与可见性服务端校验；回答平铺；关闭后仍可回答与采纳；相似求助可用                                                                   | 发布费与悬赏字段的取值                     |
| M07-2 状态与互动     | 状态服务、投票、我也遇到了、同问、订阅派生                                                                                                                                   | 同问只连原帖一层；每个关闭周期可重开一次；被采纳、获名额或被社区验证的回答作者不能改正文或删除；通知接收人与关闭前后规则正确           | 阈值、等待期与投票门槛数值                 |
| M07-3 工单桥接       | `app/api/help/bridge.ts`、`case_id`/`from_case_id`、系统回贴唯一键                                                                                                           | 每帖只关联一次，多条求助可共享同一工单；每次有效结案给每条关联帖恰好一条回贴；原开启者与锚定对象保留                                   | 工单转求助的收费、发布资格与是否发系统奖励 |
| M07-4 求物与资源回答 | 求物类别、落地关联、资源回答原子创建、decline `outcome` 联动                                                                                                                 | 文字回答立即可见且不进审核队列；待审与直接公开按现行规则；不收录保留、违规联动隐藏                                                     | 无（不含账务）                             |
| M07-5 账务           | 复用[账务原语](../../app/api/moemoepoint/service.ts)、`help_bounty`、`help_daily_quota`、[规则展示](../../constants/moemoepoint.ts)                                          | 状态与收支同事务；并发不重复奖励或结算；余额不足按审定规则展示                                                                         | 全部                                       |
| M07-6 首页与入口     | [首页服务](../../app/api/home/service.ts)、首页组件、模块 05 的分流入口、[本人发布条目页](../../app/(site)/user/[id]/submission/page.tsx)的「大家在求的游戏」、后台概览的无人回答率 | 公开可见性在各读取面一致、注册时长门槛只作用于首页、接口不泄露；提示与真实入口一致；后台能看到无人回答率的分子、分母与比值且口径可复算 | 提示中的金额文案                           |

## 11. 非目标

- 不做嵌套回答、求助搜索扩展、全文索引或数据库扩展安装。
- 只有回答有作者改删：回答在被采纳、被授予奖励名额或被社区验证之前，作者可以编辑或删除，之后转为只读。不给作者新增「删除自己求助」的能力，那会绕过「有回答后悬赏不可撤回」。站方侧只有隐藏与恢复，没有物理删除动作，也不新增通用审计系统。不设版主、志愿者或角色层级。
- 求助帖内的链接是普通文字，不进入揭示、配额与恢复链路；本模块不改 access、grant 与 restore。
- 不改既有资源发布奖励、资源审核语义与门槛，除第 5 节明列的 decline `outcome` 可选参数。
- 不做运营指标看板、图表与指标快照；后台只按阶段 4 的验收显示一个无人回答率数字，完整指标页归模块 09。不迁移旧反馈与举报数据。
- 不新增消息总线、工作流平台、通用队列框架或规则后台；不为将来预留字段。
- 不涉及会社、开发商、社团字段。

## 12. 待决定

1. **D8 全部**：费用与奖励整段及所有标「新增，待确认」的参数。本模块把下列分支都实现成单一口径并写入实验，等站长批准或改判，不做两可实现：
   - 桥接「工单转求助」不向原开启者收费、不占其发布配额；由于没有发布费收入，该帖不发系统奖励，只保留采纳标记，否则出现无收入的净发放口子。这类帖由 `from_case_id` 非空直接判定，不另设开关，也不隐藏收费。
   - 名额由首个合格事件赢得；不合格事件只写标记、不消耗名额、不给自己补发，之后出现的合格事件仍可取走这唯一名额一次。当日奖励次数上限只挡系统奖励，不挡合格的悬赏结算；因注册时长不足而不结算悬赏时，已 `held` 的预留在同一事务释放并置 `unsettled`，不把点数冻结在已解决的帖上。
   - 追加悬赏按发生当日的毛额计入每日悬赏额度，释放或撤回不返还额度。
   - `released`、`withdrawn` 之后是否允许重新预留悬赏，未定前不开放。
     阻塞 M07-5 全部与 M07-3 的一个分支。
2. **资源回答带来的既有资源贡献奖励增量**：这不是待核实的事实，源码已核实（第 2 节）。需要站长决定的只有一件事——接受第 9 节两本账相加后的净发出，还是调整求助侧的奖励额。调整资源奖励的发放时点或增加拒绝回收都属于全站经济改造，本模块不提出、不实施。
3. **求助与回答的自动隐藏阈值与关键词过滤细则**：举报达阈值自动隐藏是基线 8.4 明列的能力，不能拿「先只做人工隐藏」当作本模块完成。阈值不沿用小喇叭的候选数值，作为 D8 的一处新增参数由站长给值，或随模块 02、03 的举报合同一并审定。该值未定即阻塞本批的上线定稿，人工隐藏只是它到位前的临时手段。
4. **D9 相关**：本模块按第 6 节的候选口径在后台显示一个无人回答率数字，这是阶段 4 的验收要求，不是待定项；同时保证求助创建时间、状态进入时间、用户回答存在性（系统回贴与提问者自答不计入）与奖励归属可复算。精确口径与完整指标页仍由 D9 与模块 09 定稿，届时复用同一查询，本模块不另开待定项。
