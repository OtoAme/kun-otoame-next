# 用户工作台与链接维护契约

契约版本：`WORKSPACE_CONTRACT_VERSION = 1`。需求依据：Orca Run
`run_8473a1455a0c` 的 `msg_b28676c80925`（最终 V3）；实施 Run：
`run_aa2b4655f8c5`。Astra 负责契约、整合和整链验收；GPT-6.1 Sol
负责后端；Grok 4.7 负责前端。本文件定义接口与验收条件，执行结果见
[验收记录](14-workspace-maintenance-acceptance.md)。

## 页面与 HTTP

所有工作台读取使用服务端会话 UID，响应为 `private, no-store`。错误体沿用 JSON
字符串，HTTP 状态取共享错误常量；前端使用 `kunFetch` 并保留失败草稿。

| 入口 | 请求／响应 |
| --- | --- |
| `/workspace` | 跳转 `/workspace/resources` |
| `/workspace/entries` | 本人投稿及已发布条目 |
| `/workspace/resources`、`/[id]` | 本人资源、维护清单和完整编辑 |
| `/workspace/issues`、`/[id]` | 原事项视图和详情 |
| `GET /api/workspace/entries` | `WorkspaceEntriesQuery` → `WorkspaceEntriesResponse` |
| `GET /api/workspace/resources` | `WorkspaceResourcesQuery` → `WorkspaceResourcesResponse` |
| `GET /api/workspace/resources/[id]` | `WorkspaceResourceDetail` |
| `PUT /api/workspace/resources/[id]` | `WorkspaceResourceUpdateInput` → 既有 `PatchResourceStableUpdateResponse` |
| `DELETE /api/workspace/resources/[id]` | 无请求体 → `WorkspaceResourceDeleteResponse` |
| `GET /api/workspace/maintenance` | `WorkspaceMaintenanceQuery` → `LinkMaintenanceListResponse` |
| `POST /api/workspace/maintenance` | `LinkMaintenanceActionInput` → `LinkMaintenanceActionResponse` |

页码默认 1、limit 默认 20、上限 50，query 去首尾空白且不超过 300 字。
条目 view 默认 `submissions`，该视图不重复列出 published/deleted；published 视图查询
本人正式 patch，不能下发私有投稿 payload。status 默认 all；published 视图仅允许 all。
资源 status/section 默认 all；维护 view 默认 feedback。列表先在数据库筛选再计数／分页，
资源使用 created DESC, id DESC。本人额度／余额由服务端计算；role >= 4 的 quota 为 null，
保留直接创建入口，也保留其晋升前的投稿处理能力。

`lib/workspace/auth.ts` 导出 `requireWorkspaceUser(): Promise<WorkspaceUser>`，未登录
redirect `/login`，没有管理员角色门槛。页面仅调用此 helper 和 HTTP 读取接口。
旧 issue 页面通过 `workspaceIssueRedirect` 保留合法 tab/status/page/id；旧、新通知地址
通过 `parseWorkspaceIssueNotification` 精确识别。管理员布局与菜单独立。

## 编辑与信任边界

`WorkspaceResourceUpdateInput` 不接收 UID、role、status、patchId 或 resourceId。
路径 ID、会话身份和锁内资源归属决定目标。所有对象 strict，包括顶层、baseLinks、
可编辑链接与受保护引用。保护引用恰好 `{ id, version }`，不能夹带 storage、sortOrder、
content、code、password、hash 或其他键。完整旧 baseLinks 包含全部槽位。

详情的正常可编辑槽位返回编辑字段；只读槽位恰好返回 id/version/storage/protected。
普通作者的 touchgal 槽位只读；普通作者的待审／封禁资源全部只读且不返回凭据。
管理读取不得调用 access/restore 或生成 grant/event。凭据只在组件内存。
workspace PUT 在同一稳定 writer 的锁内补齐受保护槽位原值；拒绝缺槽、伪造、改值或
重排。旧普通作者 PUT 校验受保护字段逐项相等后只持久化 DB 原值。普通作者 status=0
规则在共用 writer 锁内生效，管理员既有接口权限不变。

上传沿用登记素材、consume、S3 补偿、finalize；只信任本人登记 metadata。
基点每次编辑只捕获一次；刷新、409 和失败不替换草稿。最后一条链接需改走确认后的
整份资源删除，含资源盘维持既有删除限制。保存后检测／缓存失败不回滚提交。

## 状态、锁与通知

维护控制按 linkId/version；事件另有独立 round。同版本最多一个进行中事件。
`maintenanceRevision` 是控制修订号，与 health evidenceRound 无关；公开限制仅为
`LinkMaintenanceRestriction`，私有说明／关联事项只在 `LinkMaintenanceItem`。
当前读取总是返回公开 maintenance，旧快照可省略并按 revision=0、无限制处理。
当前报告总是返回 maintenance 回执，旧调用端允许没有该字段。

| 操作 | 状态转换 | 通知 |
| --- | --- | --- |
| 首份可计权且非重复报告 | 新 pending 轮次 | 事务内通知普通发布者一次，跳过自己 |
| 同轮后续报告 | 合并，保留轮次 | 不重复首报 |
| 零权／重复且无事件 | 不建事件 | 不催办 |
| respond（必填说明） | 结束当前事件，handled | 有效参与者一次结果 |
| verify（必填说明和健康基点） | 原健康权限及间隔内核实，完成事件 | 与健康结案结果对同一人合并 |
| snooze（1 或 3 天） | 仅 pending 事件，服务器计算截止；仍是同一轮 | 不发结果、不算完成 |
| 到期 | 派生 pending，不写新轮、不新增 cron | 不重发首报 |
| stop（必填说明） | 结束事件（若有），冻结当前版本 | 仅已有有效参与者收结果 |
| resume | 解除冻结，保留历史完成事件 | 不追发、不造新事件 |
| 换地址 | 完成旧版事件，新版开放 | 参与者收到补链结果 |
| 改码／排序 | 版本不变，冻结不变 | 不重发首报 |
| 删除／移动 | 删除退清单并保留必要记录；移动仅更新目标 | 不重置轮次／首报标记 |

锁序：资源 → 实际链接（ID 顺序）→ 维护控制／事件 → 事项（ID 顺序）。单链接
操作可从 link 开始，不反向取得父级锁。首报、事件、参与者和首次通知同事务。
所有期望值锁内重读。冻结先于出站检测预检，报告落库事务再次验证；资源内容／违规反馈
不受单链接冻结影响。资源盘继续站方处理。

机器异常只属于 optional，机器确认失效／事项开立／自动超时不新增普通发布者催办。
真实对话、管理员决定、站方争议和升级通知保留。维护回应不能擅自结健康事项；健康结案
不能自动完成维护。七天和三十天健康时钟／上下文不变。verify 与维护完成同事务。
结果通知只给有权参与者及公开资源入口，绝不发作者编辑地址给反馈者。

## 唯一待办与健康投影

发布者 pending-count.owned = 可行动的维护事件 + 原有等待发布者事项 − 已由维护记录
代表的普通发布者链接事项。未到期 snooze、optional、stopped、handled 不计；到期
snooze 计入。等待报告者、站方争议／资源盘保持原口径。未接续历史事项保留一次计数和
入口。owned 列表／总数／角标使用同一排除谓词；维护反馈筛选仍展示未到期暂缓。
原 IssueLinkRepairList/useLinkRepairList 挂载退役，关联对话从维护项进入。

前台共享当前读取快照下的健康投影，文字、动作、失效数、折叠同源；健康与维护修订
分开合并，旧健康回包不抹掉新限制。健康更新不制造新读取快照或清空凭据。
真读取刷新／版本变化仍清理旧凭据。资源卡片维持现有分组／平台语言顺序，只折叠内部
broken 链接。报告两入口按 maintenance.publisherNotified/event 提示已通知／已合并。

## 文件白名单

下列路径为精确授权，包含新增文件。新增路径或跨界改动先通过 Orca ask 申请；同一作者
的 B1→B2→B3、F1→F2→F3 顺序实施。作者不得合并、推送、部署或改根工作树。

### B1：GPT-6.1 Sol

- `lib/workspace/auth.ts`
- `middleware.ts`、`middleware/auth.ts`
- `app/api/workspace/http.ts`
- `app/api/workspace/entries/route.ts`、`app/api/workspace/entries/service.ts`
- `app/api/workspace/resources/route.ts`、`app/api/workspace/resources/service.ts`
- `app/api/workspace/resources/[id]/route.ts`
- `validations/workspace.ts`、`validations/patch.ts`
- `app/api/patch/resource/update.ts`
- `tests/unit/api/workspace-auth.test.ts`、`tests/unit/api/workspace-entries.test.ts`
- `tests/unit/api/workspace-resources.test.ts`、`tests/unit/workspace-validation.test.ts`
- `tests/unit/api/patch-resource-update.test.ts`、`tests/unit/api/resource-stable-route.test.ts`

### B2：GPT-6.1 Sol

- `prisma/schema/patch-resource-link-maintenance.prisma`
- `prisma/schema/patch-resource.prisma`、`prisma/schema/user.prisma`、`prisma/schema/case.prisma`
- `app/api/patch/resource/maintenance/service.ts`、`app/api/patch/resource/maintenance/read.ts`、`app/api/patch/resource/maintenance/policy.ts`
- `app/api/workspace/maintenance/route.ts`、`validations/linkMaintenance.ts`
- `migration/production-link-maintenance-preflight-2026-10-19.sql`
- `migration/production-link-maintenance-sync-2026-10-19.sql`
- `migration/production-link-maintenance-postflight-2026-10-19.sql`
- `tests/unit/api/link-maintenance.test.ts`、`tests/unit/api/link-maintenance-read.test.ts`
- `tests/unit/link-maintenance-policy.test.ts`、`tests/unit/link-maintenance-migration.test.ts`

### B3：GPT-6.1 Sol

- `app/api/patch/resource/link/service.ts`、`app/api/patch/resource/link/read.ts`、`app/api/patch/resource/link/http.ts`
- `app/api/patch/resource/linkHealthProjection.ts`、`app/api/patch/resource/link-check/service.ts`
- `app/api/patch/resource/update.ts`、`app/api/patch/resource/delete.ts`、`app/api/patch/resource/mutation.ts`、`app/api/patch/resource/get.ts`
- `app/api/case/linkHealth.ts`、`app/api/case/service.ts`
- `tests/unit/api/case-link-health.test.ts`、`tests/unit/api/case-service.test.ts`、`tests/unit/api/case-feedback-service.test.ts`
- `tests/unit/api/link-health-http.test.ts`、`tests/unit/api/resource-health-read.test.ts`
- `tests/unit/api/resource-deletion.test.ts`、`tests/unit/api/resource-mutation-retry.test.ts`
- `tests/unit/api/admin-resource-update-message.test.ts`、`tests/unit/link-health-projection.test.ts`
- `tests/unit/api/link-check-health.test.ts`、`tests/unit/api/manual-link-check.test.ts`

`app/api/case/service.ts` 仅允许：链接通知门禁、维护回应／结案结果合并、owned／pending-count
去重、移动时维护目标同步、新旧事项 URL／未读／已读兼容。其他事项逻辑只读。
另授权 `canReadCaseForViewer` 只读 helper：复用既有 getCaseById、handoffFactFor、
canViewCase，供维护 DTO 判断关联事项可读性；不得标已读或改变权限矩阵。

### F1：Grok 4.7

- `app/(dashboard)/workspace/layout.tsx`、`app/(dashboard)/workspace/page.tsx`
- `app/(dashboard)/workspace/issues/page.tsx`、`app/(dashboard)/workspace/issues/[id]/page.tsx`
- `app/(dashboard)/issue/layout.tsx`、`app/(dashboard)/issue/page.tsx`、`app/(dashboard)/issue/[id]/page.tsx`
- `components/dashboard/workspace/WorkspaceShell.tsx`
- `components/dashboard/issue/IssueHeader.tsx`、`components/dashboard/issue/IssueLoginNotice.tsx`
- `components/dashboard/issue/IssueCaseList.tsx`、`components/dashboard/issue/IssueCaseDetail.tsx`
- `components/kun/top-bar/UserDropdown.tsx`、`components/user/Activity.tsx`
- `app/(site)/user/[id]/submission/page.tsx`（仅移除私有管理分支并加工作台入口，保留公开查询）
- `tests/unit/workspace-shell.test.tsx`、`tests/unit/case-issue-server-pages.test.tsx`
- `tests/unit/case-issue-header.test.tsx`、`tests/unit/user-submission-page.test.tsx`
- `tests/unit/case-detail-permissions.test.tsx`（仅新旧事项导航地址的对应断言）

### F2：Grok 4.7

- `app/(dashboard)/workspace/entries/page.tsx`、`app/(dashboard)/workspace/resources/page.tsx`、`app/(dashboard)/workspace/resources/[id]/page.tsx`
- `components/dashboard/workspace/WorkspaceEntries.tsx`、`components/dashboard/workspace/WorkspaceResources.tsx`
- `components/dashboard/workspace/WorkspaceResourceEditor.tsx`、`components/dashboard/workspace/WorkspaceResourceUpload.tsx`
- `components/submission/SubmissionEditor.tsx`、`components/submission/SubmissionList.tsx`、`components/submission/SubmissionQuotaPanel.tsx`
- `tests/unit/workspace-entries.test.tsx`、`tests/unit/workspace-resources.test.tsx`、`tests/unit/workspace-resource-editor.test.tsx`
- `tests/unit/patch-submission-readonly-controls.test.tsx`

### F3：Grok 4.7

- `components/dashboard/workspace/WorkspaceMaintenance.tsx`
- `components/dashboard/issue/IssueWorkspace.tsx`、`components/dashboard/issue/IssueLinkRepairList.tsx`、`components/dashboard/issue/useLinkRepairList.ts`
- `components/patch/resource/ResourceDownload.tsx`、`components/patch/resource/DownloadCard.tsx`、`components/patch/resource/ResourceTab.tsx`、`components/patch/resource/Tabs.tsx`
- `components/patch/resource/LinkHealthActions.tsx`、`components/patch/resource/LinkHealthStatus.tsx`、`components/patch/resource/LinkReportPanel.tsx`
- `components/patch/resource/linkHealthDisplay.ts`、`components/patch/resource/useResourceLinkHealthUpdates.ts`
- `components/case/ReportResourceButton.tsx`、`components/case/linkHealthActionFlow.ts`
- `tests/unit/workspace-maintenance.test.tsx`、`tests/unit/case-issue-page.test.tsx`、`tests/unit/issue-link-repair-list.test.tsx`
- `tests/unit/resource-download-card-health.test.tsx`、`tests/unit/resource-download-late-callback.test.tsx`、`tests/unit/resource-download-restore.test.tsx`
- `tests/unit/resource-tabs-permissions.test.tsx`、`tests/unit/case-entry-buttons.test.tsx`、`tests/unit/link-check-feedback.test.tsx`、`tests/unit/link-health-display.test.ts`

共享 UI 库、`IssueImageField.tsx`、`resourcePermissions.ts` 冻结。Sol 不改 React/CSS/文档／
共享契约，Grok 不改 API/schema/SQL/middleware/权限服务／共享契约。Astra 独占
`constants/workspace.ts`、`constants/linkMaintenance.ts`、本任务相关的共享 types/constants、
`utils/workspaceRoutes.ts`、契约测试、`tests/e2e/workspace-maintenance.e2e.ts`、验收脚本及文档。
迁移整链验收位于 `tests/e2e/workspace-maintenance-migration.e2e.ts`。

## 验收与迁移

作者提交包含 SHA、精确文件、契约版本、测试结果、未验项。Astra 查文件清单及函数级
差异并将业务修复退回原作者。应用代码与文档分开提交。

定向／全量测试、typecheck、隔离源码生产 build、独立 PostgreSQL/Redis/受控 checker HTTP
整链测试；浏览器 360/390/1280。验证跨用户与伪造输入、零 grant 管理读取、严格保护引用、
审核状态锁内拒绝、并发首报唯一、在途冻结、到期同轮、健康时钟、结果通知合并、迁移／
删除／移动、唯一待办、新旧未读地址、迟到投影与凭据草稿、取消零写入和失败保留输入。

迁移 pre/postflight 只读，sync 单事务且幂等，保留现有健康 CHECK。仅回填当前版本、
有效最新健康 context、未结 publisher link_suspect、存在 ever_counted 正权且未有
first_owner_response_at 的事项。标记 migrated，不补发通知、不关闭事项或改时钟。
坏 context 单列，站方争议／纯机器／已回应不接续。重跑不能覆盖真实维护事件。
一次性 `_e2e` PostgreSQL 验证首次安装、重跑与锁超时回滚。生产先停旧写入、审 SQL、
postflight、schema guard，再同版本切换，不能新旧应用混跑。此任务不部署生产。
