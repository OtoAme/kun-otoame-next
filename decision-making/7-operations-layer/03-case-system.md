# 模块 03：工单系统（实施计划）

状态：草稿，待站长审阅。PM 版见 [03-case-system-pm.md](./03-case-system-pm.md)，总计划见 [00-master-plan.md](./00-master-plan.md)（任务编号 M03-1 至 M03-5，见其 4.4 节），产品依据是[运营层设计基线](../7.operations-layer-redesign.md)第 3 节，以及 4.4、5.6、8.3 的接入点。

仓库事实来自只读核查，标「现状」；其余为本模块建议。本文未运行命令、未连数据库、未构建部署，所有验证项均待执行。

## 1 目标与基线

| 目标                                           | 基线          | 任务         |
| ---------------------------------------------- | ------------- | ------------ |
| 反馈与举报合并为有目标、有归属、有状态机的记录 | 3.1、3.2      | M03-1        |
| 类型/目标/归属/开启方式由服务端确定            | 3.3           | M03-1、M03-2 |
| 状态、超时、升级、结论、重开                   | 3.4           | M03-1、M03-4 |
| 去重为一条并转订阅，结案统一通知，卡片徽标     | 3.5           | M03-2、M03-3 |
| 旧入口改写                                     | 3.6           | M03-5        |
| 用户页、发布者面板、站方收件箱、模板、通知直达 | 3.7、7.1      | M03-3        |
| 为 04/06/07 冻结内部接入边界                   | 4.4、5.6、8.3 | M03-4        |
| 保存可重建处理过程的事实供 09 使用             | 10            | M03-1、M03-4 |

现状与基线 3.1 一致：反馈是 [app/api/patch/feedback/service.ts](../../app/api/patch/feedback/service.ts) 写入的一行 `user_message` 并群发 `role >= 3`，处理端 [app/api/admin/feedback/service.ts](../../app/api/admin/feedback/service.ts) 置 `status` 并靠字符串反解；举报是 [prisma/schema/patch-report.prisma](../../prisma/schema/patch-report.prisma) 一行，[app/api/admin/report/service.ts](../../app/api/admin/report/service.ts) 会把同目标全部 `status = 0` 一起处理并逐个通知，属隐式合并，新模型用订阅显式化。

## 2 偏离与理由

| 偏离                                    | 基线                  | 做法与理由                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 表名 `ops_case` 系列                    | 3.2 实体名 `case`     | `CASE` 是 SQL 保留字，仓库既有表均带业务前缀；语义不变                                                                                                                                                                                                                                                                                              |
| 不建 `link_version`，链接类类型不可创建 | 3.2、3.3              | 现状 [app/api/patch/resource/update.ts](../../app/api/patch/resource/update.ts) 用 `deleteMany` 加 `create` 重建全部链接行，链接 ID 未稳定、无版本号；04 稳定后再加，避免提前引入空列                                                                                                                                                               |
| 官方资源沿用现有前台口径                | 3.3「官方资源为站方」 | 现状 [Tabs.tsx](../../components/patch/resource/Tabs.tsx) 以资源作者 `role > 2` 区分官方与社区资源，本模块沿用同一口径：官方资源的 `resource_mismatch` 归站方（因此不进入 7 天升级），其余归资源发布者本人。06 引入官方链接后，普通发布者的资源即使拥有官方镜像，内容问题仍归该发布者，链接故障另按链接归属判定；「有官方镜像」不等于「资源归站方」 |
| 发布者面板不放公开个人主页              | 3.7                   | `/user/[id]` 是公开主页语义，私有数据另开顶级段，沿用仓库既有约定                                                                                                                                                                                                                                                                                   |
| 「遇到问题」本批为资源卡片上的最小入口  | 3.6                   | 只含「资源与描述不符」一种，预填该资源；05 上线时在同一入口位置替换为完整现象分流，不并存两个入口。条目页反馈仍按基线三档，不扩类型                                                                                                                                                                                                                 |
| 站方归属不写具体人                      | 3.2                   | 基线 2.2 不分派、不设版主，`owner_type = staff` 时 `owner_id` 为空                                                                                                                                                                                                                                                                                  |
| 首报者也写一行订阅                      | 3.5「N 为订阅者数」   | 徽标 N 直接等于订阅数，语义与基线一致                                                                                                                                                                                                                                                                                                               |
| 重开不清空结论与结案时间                | 3.4                   | 二者改为「最近一次结案」的事实，是否结案一律看 `status`，避免重开抹掉 09 需要的历史                                                                                                                                                                                                                                                                 |

## 3 术语

事项＝基线所称工单，用户界面不出现该词（命名属 D4）。归属方只有发布者与站方两类，由类型与目标推导。去重键＝目标类型:目标ID:类型，仅未结案时有值。日限额键＝开启者:目标类型:目标ID:上海日期，仅用户开启且归属发布者时有值，永久保留。订阅者＝登记在事项上的报告者，含首报者。状态进入时间＝进入当前状态的时刻，所有超时与排序以它为准，不读 `updated`。修订号＝每次状态变更递增的整数，只随状态变更改动（订阅与读取都不动它），用作条件更新的版本。升级＝发布者归属超时后转站方。内部接入接口＝仅服务端可调用的开启/系统消息/结案函数。

## 4 数据模型

新建 `prisma/schema/case.prisma`（拟新增）三张表，不改既有表结构。

### 4.1 `ops_case`

列：`id`；`kind` VarChar(32)；`target_type` VarChar(16)（本模块启用 `resource`、`patch`、`comment`、`rating`、`shoutbox`、`user`；`link` 与 `help` 留给 04、07）；`target_id` Int；`patch_id` Int? 外键 `patch` **SetNull**（条目删除时保留事项事实，不级联删除）；`reporter_id` Int? 外键 `user` SetNull；`owner_type` VarChar(16)；`owner_id` Int? 外键 `user` SetNull；`status` VarChar(20) 默认 `open`；`resolution` VarChar(32)?；`public` Boolean 默认 false；`source` VarChar(16) 默认 `user`（`user`/`system`/`publisher_convert`/`help_escalation`）；`dedup_key` VarChar(96)? 唯一；`daily_key` VarChar(96)? 唯一；`revision` Int 默认 0（只随状态变更递增）；`status_changed_at`、`queue_entered_at`（进入当前归属队列的时间，只在创建、升级换归属、重开时写入，`open` 与两个等待状态之间往复不改它）、`closed_at`?、`escalated_at`?、`first_owner_response_at`?、`hidden_at`?、`restored_at`?、`reopened_count` Int 默认 0、`created`、`updated`。不设订阅冗余计数：订阅数一律按关系 COUNT 读取，避免订阅写入去动状态版本。

索引：`[status, status_changed_at]`（任务扫描）、`[owner_type, owner_id, status, status_changed_at]`（收件箱与发布者面板）、`[reporter_id, created(desc)]`、`[target_type, target_id, status]`、`[patch_id, status]`。

唯一性用可空唯一列而不是部分索引：PostgreSQL 视多个 NULL 互不相同，正好表达「未结案时唯一」；仓库当前不启用部分索引相关预览特性，本模块不为此引入新特性，也就不会给 [scripts/checkPrismaProductionSchema.ts](../../scripts/checkPrismaProductionSchema.ts) 的漂移检查增加例外面。

### 4.2 对话与订阅

`ops_case_message`：`id`、`case_id`（级联删除）、`author_id`（SetNull，系统消息为空）、`kind` 取 `reply`/`system`、`event` VarChar(24)?（仅系统消息：`escalated`、`resolved`、`reopened`、`hidden`、`restored`、`moved`）、`payload` Json?（仅系统消息，键集合按 `event` 固定，只允许 `resolution`、`closed_at`、`actor_type`、`from_status`、`to_status`、`from_state_entered_at`、`queue_entered_at`、`first_owner_response_at`、`from_owner_type`、`from_owner_id`、`from_patch_id`、`to_patch_id`、`resource_id`、`previous_resource_status`、`handled_target`）、`body` VarChar(5007)、`created`；索引 `[case_id, id]`，读取按 `created asc, id asc`。`event` 与固定键 `payload` 只承载这六类既定事实，不是通用事件表，也不接受自定义键。结案事件以自身 `created` 为事件时间，固定带上 `resolution`、`closed_at`、`actor_type`（实际执行者分类，见 5.4 与 5.5）、本轮的 `from_state_entered_at`、`queue_entered_at`（直接取同名列，不靠事件推导）与 `first_owner_response_at`；重开事件先把上一轮的 `resolution`、`closed_at`、`first_owner_response_at` 写进 `payload`，再清空列上的首次回应时间并刷新 `queue_entered_at`，开始新一轮。等待开启者与等待归属方之间的往复不改队列进入时间，只有升级换归属与重开才开新周期。可重建的只有这些既定事件：本模块上线前的历史与未记录的中间过程都不可重建，09 的起算点以本模块上线为准，不宣称完整历史可还原。另外一条事实必须显式记录：`source` 只表示开启来源、`owner_type` 只表示当前归属，而站方可以在升级前直接处理仍归发布者的事项，因此两者都不能证明「谁真正结的案」。执行者事实只由结案事件的 `actor_type` 提供，取值仅 `system`、`publisher`、`staff`；开启者在本模块没有任何结案路径，故不设该取值，也不在事件里存个人 ID（站方身份另在 `admin_log`）。重开后历次结案事件仍然保留，09 可据此看出是否曾有站方介入。

`ops_case_subscriber`：`id`、`case_id`（级联删除）、`user_id`（级联删除）、`created`；唯一 `[case_id, user_id]`，索引 `[user_id, created(desc)]`。只登记登录用户。

### 4.3 状态、类型与结论

状态：`open`、`waiting_reporter`、`waiting_owner`、`resolved`、`rejected`、`merged`（本模块不写入 `merged`，留给 06）。

| 类型                   | 目标                     | 归属                             | 结论（全部取自基线 3.4）                                             |
| ---------------------- | ------------------------ | -------------------------------- | -------------------------------------------------------------------- |
| `resource_mismatch`    | 资源                     | 官方资源归站方，其余归资源发布者 | 已修正、无法复现、不在受理范围、升级后隐藏、升级后忽略、开启者未回应 |
| `resource_wrong_patch` | 资源                     | 站方                             | 已移动、不成立                                                       |
| `content_violation`    | 评论、评价、小喇叭、用户 | 站方                             | 已处理、不成立                                                       |
| `other`                | 条目                     | 站方                             | 已处理、不在受理范围                                                 |

`kind × target_type` 为白名单，表外组合一律拒绝。本模块冻结契约但不开放创建的组合：`content_violation × resource`（基线 8.2 的资源疑似违规或有害内容，归站方、无 7 天升级，由 05 的现象分流开放，不得降级成 `other` 而改掉归属与时限）、`content_violation × help`（求助举报，07 开放）、`link_suspect` 与 `link_disputed`（04）、`takedown_request` 与 `mirror_version_check`（06）。「条目信息错误」不是类型，界面直接引导，08 上线后指向纠错投稿。冻结类型的同时冻结处置闭环：`content_violation × resource` 的处置能力就是本模块已有的隐藏与恢复资源，由 03 的领域服务提供——该组合归站方、没有升级环节，结论登记为「违规隐藏」与「不成立」（措辞随 05 的上线文案确认，动作与守卫不变），隐藏与恢复与升级类共用同一套 `hidden_at`、`restored_at` 守卫，不另建第二个状态机，05 只接入口与分流；求助与回答的举报由 07 接线并复用同一结案与通知边界，07 上线前不预建其处置动作。只登记类型而没有处置闭环的组合不得开放。

「已移动」配套一个最小站方移动动作（见 5.4），引用枚举本轮已在源码中完成，不作为未来选项。按 [prisma/schema/patch-resource.prisma](../../prisma/schema/patch-resource.prisma)：需要在同一事务内改的条目引用只有两处，`patch_resource.patch_id` 与 `patch_resource_access.patch_id`（后者按 `resource_id` 一次 UPDATE，行数随揭示次数增长，但移动是低频站方动作，不分批以保住同事务一致性）；不需要动的是 `patch_resource_access_grant`（只有 `actor_key`、`resource_id`、`expires`）、`patch_resource_link` 与点赞关系（只挂 `resource_id`），因此资源 ID 不变时既不迁移也不重发授权；两侧条目的资源计数由 [migration/ensurePatchCounters.ts](../../migration/ensurePatchCounters.ts) 已有的 `patch_resource_count_trg` 维护（`AFTER INSERT OR DELETE OR UPDATE OF patch_id, status`，只计已发布状态，旧条目减一、新条目加一），本动作不得手工增减，否则重复计数；两侧条目的类型、语言、平台与资源更新时间用 [\_helper.ts](../../app/api/patch/resource/_helper.ts) 的 `updatePatchAttributes(patchId, tx)` 各重算一次（同事务，只统计可见资源，返回 `unique_id` 供缓存失效）。另需在同一事务内把以该资源为目标的全部事项 `patch_id` 同步为新条目，并写一条 `moved` 结构化系统消息。移动不改资源 ID 与链接 ID，不经过资源编辑路径。上述引用与触发器行为已在源码核实，实验按第 9 节判据复验一次结果即可，不作为产品未决项。

### 4.4 归属、公开性与目标引用

归属、来源、公开性等派生字段以服务端为唯一来源，请求体不声明、服务端也不读取任何同名输入（统一为「忽略」，不是「报错」）。`resource_mismatch`：目标资源按现有前台口径属官方（作者 `role > 2`）时 `owner_type = staff`，否则取资源发布者本人，`public = true`；其余类型 `owner_type = staff`、`public = false`。`patch_id` 由目标推导（资源、评论、评价取其所属条目，条目即自身），不接受客户端指定写库值。页面目标上下文另作一例：请求可携带只用于校验的 `expectedPatchId`（05 接入后再加 `resourceId`、`linkId` 上下文），服务端比对目标当前所属条目，不一致时返回「该资源已被移动，请刷新后重试」且不落库，避免移动后的旧页面把事项挂到错误条目。

目标用 `target_type` 加 `target_id`，不为每种目标建外键：07 的求助表尚不存在，`patch_report` 的多列可空外键在八种目标下不可维护，自增主键不回收故不会指错对象。代价是目标删除后事项仍在，详情与列表须显示「目标已删除」而不是报错，站方仍可结案。

供 09 使用而在本模块保留的事实：创建时间、状态进入时间、队列进入时间（09 的队列等待时长口径以它为准；收件箱排序仍按状态进入时间，保证最久未动的先处理）、归属方首次回应时间、最近结案时间与结论、是否曾升级及时间、隐藏与恢复时间、归属类型与归属人、来源、类型、重开次数、按关系统计的订阅数，以及带固定键 `payload` 的系统消息（历次结论与执行者分类、原状态、原归属、移动前后条目、被处置对象）。列上只保留最新值，历次结论与归属变化靠这些结构化系统消息重建，不靠自然语言正文。口径与展示仍由 09 定义（D9），本模块不做展示。任何超时或先后判断都不读 `updated`：现状下载统计已改原生 SQL 且不刷新 `updated`，但它仍会被其他写入路径改变，也不证明文件版本。

## 5 接口、校验、权限、幂等

### 5.1 路由

用户与发布者侧 `app/api/case/`，站方动作在 `/api/admin/case/`；校验 `validations/case.ts`、类型 `types/api/case.ts`、常量 `constants/case.ts`（均拟新增）。

| 方法与路径                           | 校验                                                                                                                                              | 权限                            | 幂等                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------- |
| `POST /api/case`                     | `kind`、`targetType`、`targetId`、可选 `expectedPatchId`、`content`（举报下限 2 字，其余 10 字，上限 5000）                                       | 登录                            | 先查后建；插入用不中止事务的冲突跳过加固定顺序重读 |
| `GET /api/case`                      | `tab` 取 `reported`/`owned`/`subscribed`、`status`、分页                                                                                          | 登录，仅本人相关                | 无                                                 |
| `GET /api/case/[id]`                 | 正整数                                                                                                                                            | 见 5.3                          | 无                                                 |
| `POST /api/case/[id]/message`        | `content` 1–5000                                                                                                                                  | 开启者、当前归属方、`role >= 3` | 条件更新                                           |
| `POST /api/case/[id]/resolve`        | `resolution` 属该类型集合、可选 `content`                                                                                                         | 归属发布者本人                  | 条件更新                                           |
| `POST /api/case/[id]/reopen`         | 正整数                                                                                                                                            | 仅开启者                        | 条件更新加去重键唯一                               |
| `GET /api/admin/case`                | `status`、`kind`、分页，默认按状态进入时间升序                                                                                                    | `role >= 3`                     | 无                                                 |
| `POST /api/admin/case/[id]/handle`   | `action` 取 `reply`/`resolve`/`reject`、`resolution`、`content`；拒绝「已移动」「升级后隐藏」「违规隐藏」「已处理」这四个必须由对应动作写入的结论 | `role >= 3`                     | 条件更新                                           |
| `POST /api/admin/case/[id]/resource` | `action` 取 `hide`/`restore`/`move`，`move` 带目标条目                                                                                            | `role >= 3`                     | 条件更新加目标状态与隐藏来源条件                   |
| `POST /api/admin/case/[id]/content`  | `action` 取 `delete`（评论、评价）或 `takedown`（小喇叭）                                                                                         | `role >= 3`                     | 条件更新加目标存在条件                             |

全部 `private, no-store`。写接口在 `/api/` 前缀下，现状 [middleware.ts](../../middleware.ts) 已覆盖 CSRF，不改 matcher 的 API 部分；错误沿用现有「HTTP 200 加中文字符串」契约。隐藏、恢复、移动、内容处置属工单裁决动作，按后台队列统一门槛取 `role >= 3`；删除评论与评价不复用现状 [admin/report](../../app/api/admin/report/service.ts) 的 `handleReport`（它以 `reportId` 为入口并自管旧表状态与旧通知），而是从中抽出一个最小的事务内 helper（删除目标加评价统计重算），旧入口改调同一 helper、行为不变，事项侧只用这个 helper；小喇叭调用模块 02 的领域原语，只把载体换成事项。封禁用户、删除条目等既有超级管理员动作维持原门槛（`role >= 4`），本模块不碰：目标为用户的举报只能在既有用户管理入口完成处置后，于事项上登记结论。

### 5.2 创建流程（M03-2）

1. 白名单校验 `kind × target_type`；未开放类型直接拒绝，不落库。
2. 目标校验：资源须存在、`status = 0`、可见；评论/评价沿用现有服务的两条规则（属于该条目、不能举报自己，见 [app/api/patch/comment/report/service.ts](../../app/api/patch/comment/report/service.ts)、[app/api/patch/rating/report/service.ts](../../app/api/patch/rating/report/service.ts)）；条目须存在。被隐藏或不可见的目标不接受新建，已删除目标不接受新建。
3. 推导归属、公开性、`patch_id`（4.4）。
4. **先识别去重**：按去重键读一次；命中则走订阅事务——先对该事项行取行锁（`SELECT ... FOR UPDATE`），复核仍未结案，再用 `createMany({ skipDuplicates: true })` 写订阅行并提交。订阅不改 `revision`、不写任何冗余计数，因此不会让并发的状态变更误判成「已被他人处理」；重复订阅被冲突跳过即视为成功。行锁下若发现已结案，返回「该事项刚刚结案」并提示重新提交（会新建一条），结案通知不会漏发。
5. **未命中才创建**：日限额不先 count。用户开启且归属发布者时写 `daily_key`，由唯一约束保证「每人每资源每天一条」，日期用现有 [timeWindow.ts](../../app/api/patch/resource/download/access/timeWindow.ts) 的上海窗口函数，不新建时间工具。
6. 插入用不中止事务的冲突跳过原语（`createMany({ skipDuplicates: true })`，即 `ON CONFLICT DO NOTHING`），不依赖捕获 `P2002`，因此不存在「在已中止的事务里继续写」。按返回的 `count` 分支：`count = 1` 表示本次创建成功，按去重键读回本行后直接进入第 7 步，不得再落入订阅分支；`count = 0` 才是冲突，此时按固定顺序重读——先按去重键重读，命中则走第 4 步订阅路径，仍未命中再按 `daily_key` 重读，命中才返回日限额提示。两个唯一约束谁先冲突都不影响返回结果。第 4 步取行锁后若发现该事项已结案，只返回一次「该事项刚刚结案，请重新提交」，服务端不自动重试成环。
7. 胜出的同一事务内一并写：首条对话、首报者订阅行、归属方通知（发布者为具体用户；站方按 `role >= 3` 批量 `createMany`），链接指向事项详情。通知一律 `type: system`，沿用现有约定，不新增消息类型。不使用 [app/api/utils/message.ts](../../app/api/utils/message.ts) 的 `createDedupMessage`：它先读后写，无数据库幂等保证；本模块由唯一约束与条件更新决定唯一胜出方，胜出方在同一事务内发一次通知。

### 5.3 读取权限矩阵（M03-3）

| 身份                     | 公开事项                                             | 私有事项                                     |
| ------------------------ | ---------------------------------------------------- | -------------------------------------------- |
| 开启者                   | 全部                                                 | 全部                                         |
| 当前归属方（发布者）     | 全部对话与正文，开启者显示为「报告者」，无用户名头像 | 不适用                                       |
| 原发布者（已升级站方后） | 只读，同上脱敏                                       | 不适用                                       |
| 管理员                   | 全部，含身份                                         | 全部                                         |
| 订阅者                   | 类型、目标、状态、结论、人数；无正文、无身份         | **待 D4 定稿**，未定前不开放详情，仅结案通知 |
| 其他登录用户 / 未登录    | 拒绝                                                 | 拒绝                                         |
| 被举报人                 | 不适用                                               | 拒绝且不通知                                 |

订阅者两格与私有一格是给 D4 的最小建议，未审定前按最保守口径实现，实验判据以审定矩阵为条件。服务端不向任何响应自动写入资源地址、提取码、解压码；用户填写的正文可能含任意文本，按上表权限下发并按纯文本渲染，不对正文内容作「必然不含链接」的承诺；徽标与列表只出数量与当前处理方。

### 5.4 事务、状态转移与幂等

每次状态变更都是一次条件更新，条件为 `id + 期望原状态 + 读到的 revision`，成功即 `revision + 1` 并刷新（或按下表保持）状态进入时间；`count === 0` 判定他人已处理，返回可刷新的中文提示。不用时间戳当版本（同状态同毫秒可碰撞）。此模式与现状投稿领取（[app/api/patch-submission/review.ts](../../app/api/patch-submission/review.ts)）一致。

三条贯穿全表的规则：一，凡是终结事项的动作（结案、超时结案、隐藏、忽略、移动、内容处置）都必须经同一个 `closeCaseInternal` 完成——清 `dedup_key`、写状态与结案时间、写结构化系统消息、按事务内订阅快照发通知，动作侧不得只给归属方发一条通知就算结案，发给同一用户的多条通知先按用户去重；调用时必须带上执行者分类（`system`、`publisher`、`staff`），由调用入口决定而不取自请求体。站方允许在升级前直接处理仍归发布者的事项（收件箱不列出，只能从详情进入），此时归属不变、执行者记为 `staff`。二，同时改资源与事项的动作固定加锁顺序为「先资源行、后事项行」：先取资源行锁并完成资源写，再条件更新事项，事项条件不满足时整笔回滚、资源写一并撤销；订阅与结案路径持有事项行锁时不得反向发起资源处置。三，不改变事项状态的中间动作（小喇叭订阅数达阈值时调 02 的隐藏原语、登记订阅、写系统消息）不是终结动作，一律不得调用 `closeCaseInternal`：只写系统消息，事项仍留在站方队列等待处置。

| 动作       | 发起           | 原状态                                                                                              | 目标                                                 | 条件                                                                                        | 同事务副作用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | -------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开启       | 用户或内部接口 | 无                                                                                                  | `open`                                               | 白名单、日限额键                                                                            | 首条对话、首报订阅、通知归属方                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 归属方回复 | 发布者/站方    | `open`、`waiting_owner`                                                                             | `waiting_reporter`（`reporter_id` 为空时保持原状态） | 无                                                                                          | 对话、首次回应时间（只写一次）、通知开启者                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 开启者补充 | 开启者         | `waiting_reporter`                                                                                  | `waiting_owner`                                      | 无                                                                                          | 对话、通知归属方，刷新状态进入时间                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 开启者补充 | 开启者         | `open`、`waiting_owner`                                                                             | 不变                                                 | 无                                                                                          | 只加对话与通知，**不刷新状态进入时间**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 结案       | 归属方         | 三个未结状态                                                                                        | `resolved`/`rejected`                                | 结论属该类型                                                                                | 条件更新即持有该行写锁，随后在同一事务内读订阅快照；写结论与结案时间、清空 `dedup_key`、写 `event=resolved` 结构化系统消息（含结论与原状态）、通知开启者与全部订阅者（同一人一条）。结案通知只由这一个统一函数发出，任何调用方不得另发一套                                                                                                                                                                                                                                                                                      |
| 升级       | 定时任务       | `open`、`waiting_owner` 且归属发布者                                                                | `open` 且归属站方                                    | 状态进入时间早于 7 天                                                                       | 升级时间、`event=escalated`、通知发布者与开启者、刷新状态进入时间与队列进入时间                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 超时结案   | 定时任务       | `waiting_reporter` 且归属发布者且有开启者                                                           | `resolved`「开启者未回应」                           | 早于 14 天                                                                                  | 同结案                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 隐藏资源   | 站方           | 归属站方的未结事项：升级后的 `resource_mismatch`，或 05 开放后直报的 `content_violation × resource` | `resolved`，前者结论「升级后隐藏」、后者「违规隐藏」 | 资源存在且 `status = 0`                                                                     | 先锁资源行再把 `status` 置 1（条目资源计数由触发器自动减一，不手工改）、同事务调 `updatePatchAttributes` 重算该条目属性、写 `admin_log` 与 `hidden_at`，随后经 `closeCaseInternal` 结案并写 `event=hidden`（`payload` 记原 `status`）、通知发布者与订阅者；提交后失效缓存                                                                                                                                                                                                                                                       |
| 忽略       | 站方           | 同上                                                                                                | `resolved`「升级后忽略」                             | 无                                                                                          | 通知开启者                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 内容处置   | 站方           | `content_violation` 未结                                                                            | `resolved`「已处理」                                 | 无前置阻断：目标存在则处置，目标已删除则直接结案                                            | 同事务执行真实处置：评论与评价调用从 admin/report 抽出的最小删除与统计 helper，小喇叭调用模块 02 的 remove 或 restore、refund 原语（阈值自动隐藏是暂态动作，不在此列，也不终结事项）；随后经 `closeCaseInternal` 结案并写 `event=resolved`（`payload` 记 `handled_target`）、通知开启者与订阅者；提交后失效相关缓存。目标已被删除时按该类型既有结论结案并在 `payload` 记目标缺失，不强行再删一次；「不成立」只需理由，不执行任何删除。目标为用户时本动作不可用，须先在既有用户管理入口（`role >= 4`）完成处置，再登记「已处理」 |
| 恢复资源   | 站方           | 已结案事项上的补充动作                                                                              | 状态不变                                             | 结论为「升级后隐藏」或「违规隐藏」、`hidden_at` 非空、`restored_at` 为空、资源 `status = 1` | 先锁资源行再置回 0（计数由触发器自动加一）、同事务调 `updatePatchAttributes`、写 `restored_at`、`admin_log` 与 `event=restored`、通知发布者。任一条件不符即拒绝并说明该隐藏不是本事项造成或已恢复过。本模块不解析 `admin_log` 自由文本（其字段只有类型、内容、操作者、状态与时间，无资源或事项索引），也不新增资源侧来源字段；本批可达的越权面是「A 事项隐藏后已恢复，B 事项再次隐藏，A 的旧请求重放」，`restored_at` 非空即可挡住                                                                                              |
| 移动资源   | 站方           | `resource_wrong_patch` 未结                                                                         | `resolved`「已移动」                                 | 目标条目存在且与当前不同                                                                    | 先锁资源行，同事务改 `patch_resource.patch_id` 与 `patch_resource_access.patch_id`、对两侧条目各调一次 `updatePatchAttributes`、把以该资源为目标的全部事项 `patch_id` 同步为新条目、写 `admin_log`，随后经 `closeCaseInternal` 结案并写 `event=moved`（`payload` 记前后条目）、通知发布者与订阅者；不手工增减资源计数（触发器负责），不重发下载授权（资源 ID 不变）；提交后失效两侧内容与列表缓存                                                                                                                               |
| 重开       | 开启者         | `resolved`、`rejected`                                                                              | `open`                                               | 结案时间在 7×24 小时内且 `reopened_count = 0`                                               | 计数加一、重建 `dedup_key`、保留上次结论与结案时间、刷新队列进入时间、把上一轮首次回应时间写入 `event=reopened` 的 `payload` 后清空该列、通知归属方                                                                                                                                                                                                                                                                                                                                                                             |

重开重建去重键时若撞上同目标同类型的新事项，唯一约束报冲突，返回「该目标已有正在处理的事项」并给出入口，不静默失败。隔离级别沿用 ReadCommitted，靠条件更新与唯一约束保证正确性；可重试冲突的识别沿用现状 [grant.ts](../../app/api/patch/resource/download/access/grant.ts)：除 `P2034`，还认 `DriverAdapterError` 的 `TransactionWriteConflict` 与 SQLSTATE `40001`，业务校验失败不重试。缓存失效在提交后执行，失败只记日志。

### 5.5 内部接入边界（M03-4）

导出三个仅服务端可调用的函数，可在调用方的事务内直接使用：`openCaseInternal(tx, input)`——归属与公开性仍由本模块推导，系统来源不受日限额限制，插入一律用冲突跳过原语加重读（不捕获 `P2002`，因此不会中止调用方的外层事务），去重命中时返回既有事项并可登记订阅，`reporter_id` 为空的事项不得进入 `waiting_reporter`；`appendCaseSystemMessage(tx, caseId, event, payload, body)`；`closeCaseInternal(tx, input)`——必须传期望原状态集合、结论与执行者分类，返回是否胜出，结案通知由该函数统一发出，调用方不得另发一套，只在胜出时做本模块之外的副作用。执行者分类的取值规则固定为：本模块定时任务与 04、06、07 的系统触发传 `system`，前台发布者结案传 `publisher`，后台站方动作（回复结案、忽略、隐藏、移动、内容处置）传 `staff`；04、06 若由站方在其界面上点按钮触发，同样传 `staff` 而不是 `system`。

接入模块需在自己模块内登记三件事：该类型的额外结案结论、目标与归属推导的补充（如 04 的链接与链接版本）、以及超时由谁扫描。责任划分固定为：链接疑似失效与链接争议的超时由 04 的任务负责，镜像版本确认的 7 天由 06 定义，03 的通用升级任务只扫描已登记为「发布者归属加 7 天升级」的类型，既不代扫也不用通用升级覆盖它们。链接类特例与站方超时边界属 D5，由 04 定义。

再冻结两条薄封装契约，函数落在 03 的服务边界内，但与首次调用方同批交付，避免本批留下无人调用的死代码：`closeLinkCases(tx, { resourceIds?, linkIds?, resolution })`——按目标选出未结的链接类事项逐条走 `closeCaseInternal`，供 04 在补链、链接被移除等收尾场景统一使用，具体结论取值由 04 登记；合并语义——把同目标的未结事项并入另一条、迁移订阅、原事项置 `merged` 并保留指向目标事项的关联，这套实现与关联列随 06 交付，本模块只登记语义、不预建列、不写入 `merged`。结案事件的稳定身份就是本模块的 `ops_case_message.id`：本模块保证每次结案必写一条结案系统消息且该 ID 此后不变，07 用它作为回贴的幂等键（`case_event_key` 的唯一约束放在 07 侧），03 不为此新增字段。

## 6 前后台界面及文件

### 6.1 前台（HeroUI v2）

新增顶级段 `app/issue/`（拟新增；只读核查确认 `app/` 下当前无同名段，界面文案属 D4）：列表页含「我提交的」「待我处理」「我关注的」三页签，详情页含对话、动作区与模板，`noindex`。需把 `/issue` 加入 [middleware.ts](../../middleware.ts) 页面 matcher、[middleware/auth.ts](../../middleware/auth.ts) 的 `protectedPaths` 与 [app/robots.ts](../../app/robots.ts) 的禁止路径。组件放 `components/case/`（拟新增）。快捷模板为基线 3.7 四条，定义在 `constants/case.ts`，模块 01 若已有模板常量则统一引用一份。

入口：资源卡片新增「报告问题」，只提交 `resource_mismatch`，预填该资源并带上当前页面的 `expectedPatchId`；05 上线时在同一位置替换为完整现象分流，不并存两个入口。用户主页按基线 3.6 新增最小「举报」入口（放在 [components/user/Profile.tsx](../../components/user/Profile.tsx) 现有 `UserFollow`、`StartChatButton` 同排，新增一个 `ReportUserButton`），只提交 `content_violation`（目标为该用户），沿用评论举报的表单与文案结构，处置仍走既有用户管理入口；[FeedbackButton.tsx](../../components/patch/header/button/FeedbackButton.tsx) 改为选择类型的表单，三档为条目资料有误（只显示引导文案，不落库，08 上线后改指纠错投稿）、资源发错条目（需选中本条目下的资源）、其他。表单内按基线 8.6 已定稿口径给一句处理方与预计首次响应提示，不新增规则页。

徽标：[app/api/patch/resource/get.ts](../../app/api/patch/resource/get.ts) 增加一次按资源批量读取的查询，取 `public = true` 的未结事项及其订阅关系计数（Prisma `_count`，不落冗余列）与 `owner_type`，在 [types/api/patch.ts](../../types/api/patch.ts) 的资源类型上加可选字段；文案按归属方切换为「已有 N 人报告，发布者处理中」或「站方处理中」。响应只含数量与处理方。

### 6.2 后台（模块 01 的控制台）

收件箱新增来源「事项」，取 `owner_type = staff` 且未结案，按状态进入时间升序并返回截断标记；等待时长对本来源按状态进入时间计算（升级项从落到站方起排队）。本模块需改模块 01 的收件箱聚合服务与列表（两者由 01 交付，本模块按其契约对接，实施前对齐）。详情与站方动作放 `components/console/case/`（拟新增）。

相关既有事实，本模块不改：现状 [getFeedback](../../app/api/admin/feedback/service.ts) 不过滤 `status` 且按 `created desc`，若各来源各取前 N 再合并会漏最老待办；本模块只保证自身来源最老优先并带截断标记，并在验收时核对新事项不会被挤出可见范围。

### 6.3 旧入口切换（M03-5）

| 旧入口                                                                             | 切换后                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [feedback/service.ts](../../app/api/patch/feedback/service.ts)                     | 保留 URL 与请求体，改为创建 `other`（目标为条目），不再写 `user_message` 反馈行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [comment/report/service.ts](../../app/api/patch/comment/report/service.ts)         | 改为创建 `content_violation`（目标评论），保留原两条校验                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [rating/report/service.ts](../../app/api/patch/rating/report/service.ts)           | 同上，目标评价                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 模块 02 小喇叭举报写入端（02 交付的拟新增路径 `app/api/shoutbox/report/route.ts`） | 改为按 5.5 契约创建 `content_violation`（目标小喇叭）；02 在 03 之前上线，本批必须完成接线。02 的阈值自动隐藏不能在迁移中丢失：改由本模块在订阅数达到 02 定义的阈值（D3）时，在同一事务内调用 02 的隐藏原语「只隐藏、不结案」，不再回头去数旧举报表；误判恢复与退款同样调 02 的 restore、refund 原语，通知与结案一律由事项侧统一发出。处置原语的同事务语义见同目录 [02 的实施计划](./02-shoutbox.md)，03 实施时从中抽出最小事务内领域 helper，阈值常量待 D3。切换时 02 已存在的待处理举报保留原有处理分支与原权限，直到模块 09 按 D9 归档退役，不迁移成事项、不新建第三套表；切换后的新举报只走事项，已办历史只读可查 |
| 用户主页举报（本模块新增，非旧入口）                                               | 新增最小入口创建 `content_violation`（目标用户），归站方；处置仍在既有用户管理入口完成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

保留旧 URL 与请求体，使上线瞬间仍持旧页面 JS 的客户端不报错，同时新提交落新表。旧记录与历史通知链接不动，只读查看沿用模块 01 的旧来源，归档属 09。

### 6.4 缓存与文件

事项详情与列表、收件箱均为 `private, no-store`。公开事项的开启、订阅、升级、结案，以及隐藏/恢复/移动，提交后调用 [app/api/patch/cache.ts](../../app/api/patch/cache.ts) 的条目内容失效；隐藏、恢复、移动另加列表缓存失效（移动为两侧条目）。

拟新增：`prisma/schema/case.prisma`、`constants/case.ts`、`validations/case.ts`、`types/api/case.ts`、`app/api/case/**`、`app/api/admin/case/**`、`server/tasks/caseTimeoutTask.ts`、`app/issue/**`、`components/case/**`、`components/console/case/**`、三份迁移 SQL 与测试。修改现有：[server/cron.ts](../../server/cron.ts)、[tests/unit/cron-registration.test.ts](../../tests/unit/cron-registration.test.ts)、上表三个旧服务、[FeedbackButton.tsx](../../components/patch/header/button/FeedbackButton.tsx)、资源卡片组件、[resource/get.ts](../../app/api/patch/resource/get.ts)、[types/api/patch.ts](../../types/api/patch.ts)、[middleware.ts](../../middleware.ts)、[middleware/auth.ts](../../middleware/auth.ts)、[app/robots.ts](../../app/robots.ts)、[components/user/Profile.tsx](../../components/user/Profile.tsx)（新增最小举报按钮），以及模块 01 的收件箱与 02 的举报写入端与处置原语。轻改：[app/api/admin/report/service.ts](../../app/api/admin/report/service.ts) 只抽出「删除目标加评价统计重算」的事务内 helper 供两侧共用，旧入口的行为、旧表状态与旧通知都不变。不动：`patch_report` 表结构、资源发布与编辑、揭示的现有路径。

## 7 定时任务

新增 `server/tasks/caseTimeoutTask.ts`，在 [server/cron.ts](../../server/cron.ts) 注册，并同步更新 [cron-registration.test.ts](../../tests/unit/cron-registration.test.ts) 的断言。

| 项         | 取值                                                                                                                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 频率与时区 | 每小时一次、错开整点，`Asia/Shanghai`；超时单位为天                                                                                                                                                                                                                                            |
| 锁         | 沿用 [withTaskLock](../../server/tasks/withTaskLock.ts)，键 `cron:case-timeout:lock`，TTL 15 分钟。无续租，故锁只减少重叠，正确性靠条件更新                                                                                                                                                    |
| 批与序     | 每类每轮至多 200 条，按状态进入时间升序，循环至无到期项或 10 轮上限                                                                                                                                                                                                                            |
| 扫描一     | `status = waiting_reporter`、`owner_type = publisher`、`reporter_id` 非空、`kind` 已登记本模块超时策略（当前仅 `resource_mismatch`）、早于 14×24 小时。站方归属一律排除（基线「站方归属没有超时」；是否放开属 D5，未定前不启用）；链接类与镜像类由 04、06 各自的任务负责，本模块两个扫描都不碰 |
| 扫描二     | `owner_type = publisher`、`status ∈ {open, waiting_owner}`、`kind` 已登记为「发布者归属加 7 天升级」（本模块只有 `resource_mismatch`）、早于 7×24 小时 → 升级。链接类超时由 04 的任务负责，镜像确认 7 天由 06 定义，本任务都不扫                                                               |
| 正确性     | 逐条条件更新（原状态 + revision），`count === 0` 跳过且不通知；依据绝对到期时间，漏跑后自动补齐                                                                                                                                                                                                |
| 边界       | 归属人已注销（`owner_id` 为空）按升级转站方；目标已删除仍升级，由站方以忽略结案；未登记类型跳过并计数；单条异常记日志继续                                                                                                                                                                      |

任务停用或 Redis 不可用时只会积压，恢复后按到期时间补齐，不做额外兜底。

## 8 迁移与回填

只新增三张表与索引，不改既有表、不迁移历史数据。

1. preflight（只读）：确认三表与索引名不存在、无同名对象；记录 `user_message` 中 `type = feedback` 与 `patch_report` 的存量条数，作为切换后零新增的比对基线。
2. sync：仅建表、索引、外键，加法且可重复执行；可写迁移在部署脚本中先于漂移检查执行，`prisma:deploy-safe` 不能当作纯只读检查。
3. postflight（只读）：核对列、类型、可空性、两个可空唯一列的唯一索引（且不是部分索引）、外键删除行为（`patch_id` 为 SetNull）与零漂移。
4. 按仓库既有做法为三份 SQL 加只读契约测试，锁定 preflight 只读、sync 幂等、postflight 覆盖唯一约束。真实 DDL 只在一次性 PostgreSQL 演练。

上线顺序：备份与 preflight → sync → postflight → 漂移检查与构建部署 → 冒烟 → 打开入口切换与定时任务 → 记录结果。入口切换与处理能力同批发布。回退边界：生产写入事项后不能盲目退旧代码；允许退到「保留新表与处理端、暂停新建入口」的版本，不允许把新提交静默送回旧队列，也不允许有数据后删表；定时任务可单独停用。暂停新建入口期间，依赖事项订阅数的小喇叭阈值自动隐藏同时失效，需站方人工处置，这一点写进运维说明。

## 9 测试与实验方案

### 9.1 单元测试（Vitest，mock Prisma 与 Redis，沿用 `vi.hoisted` 写法）

归属与公开性推导（含官方资源归站方）及派生字段被忽略、`expectedPatchId` 不一致时拒收；`kind × target_type` 白名单（含冻结但未开放的组合）与目标校验（不属该条目、非 `status = 0`、举报自己、目标不存在）；去重先识别、`count = 1` 与 `count = 0` 两个分支（创建成功不得落入订阅分支，且必写首条正文、首报订阅与一条归属方通知）、冲突后的固定顺序重读、订阅幂等且不改 `revision`、结案竞态提示不成环；`daily_key` 生成与上海日界；状态机合法/非法转移、条件更新未命中提示、开启者在 `open`/`waiting_owner` 补充不刷新状态进入时间、队列进入时间只在创建与升级、重开时写入；结案通知去重且只由统一函数发出、结案事件的执行者分类按调用入口推导且不受请求体影响；重开四个分支与结构化系统消息写入；任务两类扫描条件、排序、重复执行、归属人注销、链接与镜像类不被扫描；隐藏、恢复（`hidden_at` 与 `restored_at` 绑定的拒绝分支）、移动、内容处置的事务内多写、统一走结案函数与失败回滚，以及「先资源行后事项行」的加锁顺序；读取矩阵与响应头；旧服务改写后返回形态不变且不写旧表。以上判据分别对应下列 E 编号，不单列新实验。

### 9.2 实验（全部**未执行**）

统一环境：一次性 PostgreSQL（库名以 `_e2e` 结尾）、独立前缀 Redis、独立端口开发服务；不连生产库、无外部副作用；时间用现有上海窗口函数与假时钟，不加生产延迟开关。

**E03-01 目标类型、归属与私有详情读取权限**

- 目的：证明归属与派生字段只由服务端决定、目标校验完整、私有详情不越权、站方裁决动作受权限与绑定约束。
- 前提：条目两个；作者角色为 1、2 与大于 2 的资源各一（后者代表现有官方资源口径）、`status` 为 1/2 的资源各一；跨条目的评论与评价各一、小喇叭一条、可举报的用户一个；账号覆盖开启者/发布者/无关用户/管理员/订阅者/被举报人/未登录；另有已发放的资源获取记录若干用于移动核对。
- 步骤：每个允许组合各提交一次（含目标为用户的违规举报），并试冻结未开放的组合（`content_violation × resource`、`× help`、链接类、镜像类）；请求体塞入归属、来源、公开性并断言被忽略、落库值为推导值；`expectedPatchId` 与目标当前条目不一致时断言拒收且不落库；作者角色三档各跑一遍 `resource_mismatch`；对一条公开与一条私有事项用各身份读详情、列表与徽标；非管理员调用隐藏/恢复/移动/内容处置；对已删除目标读详情与结案；执行一次移动，核对资源与获取记录的条目字段、两侧条目的资源计数（触发器维护）、两侧条目属性与资源更新时间、以该资源为目标的其他事项的 `patch_id`、下载授权未被重发；按本批真实可达的路径核对恢复绑定——事项 A 隐藏该资源、A 恢复、事项 B 再隐藏，然后重放 A 的恢复请求须被拒，另用一条没有任何事项隐藏事实的遗留 `status = 1` 资源尝试恢复也须被拒；再用站方结案接口直接提交「已移动」「升级后隐藏」「违规隐藏」「已处理」，须被拒绝而不能绕过对应动作；另用内部接口建一条归站方直报的 `content_violation × resource`（05 上线后才有入口），对它与升级后的 `resource_mismatch` 各做一次隐藏与恢复；再对一条目标已被删除的违规举报执行内容处置。
- 通过：归属、公开性、`patch_id` 与 4.4 一致，官方资源归站方且不进入 7 天升级；未开放组合全部拒绝且不落库、不降级成 `other`；各身份可见字段与 5.3 一致（订阅者与私有两格按当时审定口径）；响应不含服务端生成的地址、提取码、解压码；徽标只含数量与处理方；非站方调用被拒；已删除目标显示占位且可结案；移动后两侧计数正确且未被重复增减、无指向旧条目的引用；恢复只在本事项造成且尚未恢复过的隐藏上成功，A 的重放请求与遗留隐藏都被拒绝；直报类与升级类的隐藏、恢复各合法一次且共用同一守卫，结论分别为「违规隐藏」与「升级后隐藏」；目标已删除的违规举报不被前置条件挡住，按既有结论结案并在 `payload` 记缺失；需要真实动作的四个结论无法由结案接口直接写入；`private, no-store` 生效。
- 失败：任一越权字段、客户端影响归属、未开放组合落库、移动后出现指向旧条目的引用或计数被重复增减、恢复放开了非本事项造成或已恢复过的隐藏、结案接口可直接写入需要动作的结论、详情因目标缺失报错。
- 时间点：M03-3 完成后本地一次；上线前隔离环境完整重跑。
- 证据与清理：记录请求与响应字段名（不留正文）、移动前后引用比对、权限拒绝响应；清空三表与测试账号。

**E03-02 去重、订阅、重开与并发唯一性**

- 目的：证明未结唯一性、订阅幂等、日限额与重开规则由数据库保证。
- 前提：同上；用测试层屏障或受控事务交错让 2–3 个会话在同一临界点提交，不靠账号数量堆并发。
- 步骤：3 个会话同时对同一资源同一类型提交，并核对创建成功的那次不会被重读改判成订阅；同一账号连提 5 次；用两个受控事务分别验证两种合法次序——先订阅后结案（该订阅须进入结案通知范围）与先结案后订阅（订阅方须收到「刚结案」并可新建）；构造同一请求同时触碰两个唯一约束（当天已开过一条且该目标另有未结事项），核对返回结果稳定；在订阅提交的同时执行一次状态变更，核对状态变更不被误判为「已被他人处理」；结案后再提交；第 6 天与第 8 天各重开一次，另测第二次重开与撞上新事项；同账号当天第二条发布者归属事项，及跨上海日界后再试。
- 通过：并发后恰好一条未结事项，其余成为订阅，订阅行数含首报者且徽标数量与之一致；胜出的那条事项必带首条正文、首报订阅行与恰好一条归属方通知，不出现只有壳的空事项；重复提交不新增订阅、不改 `revision`；两种次序下结案通知都不遗漏也不重复；同时触碰两个约束时始终按去重优先返回既有事项，不随机报日限额；重开仅第 6 天首次成功，撞上新事项时返回冲突与入口；日限额第二条被拒且提示明确，跨日恢复。
- 失败：出现两条未结的同目标同类型；订阅重复或徽标数量不符；订阅导致并发状态变更误报「已被他人处理」；同一请求随机返回日限额；重开超过一次；日限额在并发下被突破；冲突分支返回 500 或静默成功。
- 时间点：M03-2 完成后本地一次；上线前隔离环境重跑。
- 证据与清理：交错脚本、返回码统计、三表行数与计数快照；清理数据。

**E03-03 状态、超时、通知与竞态**

- 目的：证明状态机、两个超时、升级与站方裁决在重复执行与竞态下只有一个结果，且保留 09 需要的事实。
- 前提：直接写入状态进入时间构造到期数据，不等真实天数；任务可手动触发。
- 步骤：逐条走完 5.4 表；构造发布者归属 `waiting_reporter` 超 14 天、`open` 与 `waiting_owner` 各超 7 天、站方归属 `waiting_reporter` 与 `open` 超 30 天、无开启者的内部事项五组后运行任务；另用内部接口建一条链接类与一条镜像类事项并让其超期，核对本模块任务不动它们；在任务读取与更新之间由用户结案；连续运行两次并模拟锁提前过期的双执行者；对升级项分别隐藏与忽略；对 `status = 2` 的资源试隐藏；隐藏后恢复；对一条已结案事项重开后再结案；在一个外层事务里调用内部开启接口并故意撞去重键，随后在同一外层事务继续写入并提交；对隐藏、忽略、移动、内容处置四个终结动作各跑一次；构造一条小喇叭举报使订阅数达到 02 的阈值，再按误判走 02 的恢复与退款原语；另跑三个执行者样例——定时任务的超时结案、发布者自己完成的结案、站方在升级前直接处理一条仍归发布者的事项，三次都在请求体里塞入伪造的执行者字段。
- 通过：站方归属与无开启者的事项均不被自动结案；两类超时按状态进入时间触发；竞态与重复执行只产生一次结案、一次通知；隐藏与移动整体成功或整体不生效；`status = 2` 拒绝隐藏；恢复后可见且缓存已失效；重开后仍能查到上一次结论、结案时间、首次回应时间与升级事实，且这些值来自固定键系统消息而不只靠最新列；内部开启接口撞冲突后外层事务仍可继续写入并提交；链接类与镜像类事项不被本模块任务升级或结案；四个终结动作都经统一结案函数，订阅者各收到一次通知；结案事件的 `payload` 含 `resolution`、`closed_at`、`from_state_entered_at`、`queue_entered_at` 与本轮 `first_owner_response_at`，且 `queue_entered_at` 只在升级与重开时变化、在等待状态往复时不变；重开事件保留上一轮的结论、结案时间与首次回应时间；小喇叭阈值只触发暂态隐藏、事项仍留在站方队列，退款只发生一次；三个执行者样例的结案事件 `actor_type` 分别为 `system`、`publisher`、`staff`，其中站方样例的 `owner_type` 仍为 `publisher`，伪造的执行者字段一律不生效。
- 失败：重复结案或重复通知、半提交状态、站方事项被自动结案、重开抹掉历史事实、内部开启冲突后外层事务被迫回滚、通用升级吞掉 04 或 06 负责的类型、终结动作漏发订阅者通知、阈值触发把事项一并结案或重复退款、结案事件缺执行者分类或该分类可被请求体影响。
- 时间点：M03-4 完成后本地一次；上线前隔离环境重跑并含真实调度一次。
- 证据与清理：任务日志、通知条数比对、注入失败的回滚证据、事实字段快照；清理数据与 Redis 键。

**E03-04 旧入口切换及后续模块接入**

- 目的：证明四个旧入口零新增、历史可读、未开放类型不可创建、内部边界不可绕过。
- 前提：隔离库预置若干旧反馈、旧举报与一条历史通知，其中包含一条 02 尚未处理的待办举报；模块 02 已上线，小喇叭举报为必测项。
- 步骤：用旧请求体调用条目反馈、评论举报、评价举报、小喇叭举报（`app/api/shoutbox/report/route.ts`）各 3 次；从用户主页提交一次用户举报；统计旧表行数并与 preflight 基线比对；打开历史通知链接、模块 01 的旧来源与旧举报的处理记录；点开条目资料有误分支；尝试创建链接类、镜像类、`content_violation × resource` 与 `× help` 事项；尝试伪造来源为系统、归属为站方、公开性为真。
- 通过：旧表零新增且新表出现对应事项；用户举报落为 `content_violation × user` 且归站方；历史链接可达、旧记录与旧处理记录可只读查看；引导分支不落库；未开放组合被拒且不降级成 `other`；伪造字段一律被忽略并以推导值落库；小喇叭的阈值自动隐藏与误判退款在切换后仍然生效；切换前已存在的待处理旧举报仍可用原有分支与原权限处理完，已办历史只读可查；求助与回答的举报只有契约、没有可创建入口。
- 失败：任一旧表新增、旧链接或旧处理记录不可达、未开放组合可创建、来源或归属可由客户端决定。
- 时间点：M03-5 完成后本地一次；上线前隔离环境重跑；上线后由站长实际处理一轮时顺带核对，不作为发布前置。
- 证据与清理：切换前后行数统计、被拒响应文本；清理隔离数据。

## 10 实施任务与验收

| 任务  | 交付物                                                                                          | 验收                                                                                                                    |
| ----- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| M03-1 | `prisma/schema/case.prisma`、`constants/case.ts`、4 与 5.4 的规则表、跨模块类型与超时责任登记表 | 每个动作写清角色、原状态、目标状态、时间条件与副作用；未开放组合与各模块结论、超时责任登记齐备；D4、D5 由站长结论后冻结 |
| M03-2 | 创建服务、校验、去重与订阅、日限额键、内部接口                                                  | E03-01、E03-02 通过；派生字段客户端不可控                                                                               |
| M03-3 | 用户页与详情、发布者页签、控制台来源与详情、模板、站方裁决与移动、内容处置、用户主页举报入口    | E03-01 读取与动作判据通过；举报结案伴随真实处置；恢复受绑定校验约束；收件箱最老一条可达且有截断标记                     |
| M03-4 | 状态服务、定时任务与注册、内部结案接口                                                          | E03-03 通过；`cron-registration` 覆盖新任务；站方事项无自动结案                                                         |
| M03-5 | 四个旧入口改写、用户举报入口接线、02 阈值隐藏与退款改走事项载体、未上线模块去向文案             | E03-04 通过；旧表零新增；旧记录、旧处理记录与历史链接可用；02 的自动隐藏与退款仍然生效                                  |

另需满足总计划第 8 节通用条件：单测与类型检查通过；涉及 schema 与 SQL 资产按仓库规则跑全量测试；隔离环境验证生产构建与迁移；文档同步（路由约定与测试覆盖点），代码与文档分开提交。

## 11 非目标

不做链接类事项、失效报告与任何链接持久化改动（04）；不做完整现象分流（05）；不做申请下架、镜像确认、存量合并（06）；不做求助区与互转，不预设桥接收费与资格（D8，07）；不做条目资料修正（08）；不迁移或归档旧数据、不删旧表与旧处理端、不做指标看板（09）；不写入 `merged`；不做批量处理、站方间指派与事项转移；不涉及萌萌点；不新增消息类型、队列框架、规则后台、角色层级或通用事件平台；不做实时推送；不新增求助举报入口与资源违规举报入口（分属 07 与 05，本模块只冻结类型契约）；不做通用撤销、通用审核或通用事件框架。

## 12 待决定

| 编号 | 内容                                     | 最小建议与阻塞位置                                                                                                                         |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| D4   | 用户界面命名；私有事项订阅者的读取范围   | 建议顶级段 `/issue`、界面称「问题处理」；订阅者只读状态与结论，私有事项不开放详情。阻塞 5.3 两格实现与 E03-01 对应判据，未定前按最保守口径 |
| D5   | 站方归属事项是否适用 14 天等待开启者超时 | 基线写站方无超时，本模块据此在扫描一中排除站方；如放开需站长确认。链接类特例交 04，不阻塞本模块其余部分                                    |

D9 要求的事实清单见 4.4，属本模块保留的字段与系统消息，口径与展示仍由 09 定义；基线 8.4 费用奖励整体未审（D8），本模块不涉及点数。
