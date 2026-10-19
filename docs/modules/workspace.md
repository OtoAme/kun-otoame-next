# 用户工作台与链接维护

工作台为所有登录用户提供本人内容管理和问题处理入口，包括没有贡献记录的用户。
页面使用 `(dashboard)` 路由组的 shadcn 样式和独立 `WorkspaceShell`，不加载管理员
菜单或全站计数。`/dashboard` 仍要求管理员权限。

源码版本、验证结果与上线条件见
[2026-10-19 验收记录](../../decision-making/7-operations-layer/14-workspace-maintenance-acceptance.md)。

## 路由和身份

| 页面 | 职责 |
| --- | --- |
| `/workspace` | 跳转到我的资源 |
| `/workspace/entries` | 本人投稿、审核反馈、额度、余额及正式条目 |
| `/workspace/resources` | 本人资源与唯一的链接维护清单 |
| `/workspace/resources/[id]` | 资源完整编辑、上传、补链、维护及删除 |
| `/workspace/issues`、`/[id]` | 我提交的、待我处理、我关注的问题及对话 |

middleware 的 matcher 和受保护路径均包含 `/workspace`。布局还调用
`lib/workspace/auth.ts` 的 `requireWorkspaceUser`，只要求登录。
工作台身份来自服务端会话；客户端显示能力不能替代 API 授权。

`/issue` 和旧详情地址保留跳转，`utils/workspaceRoutes.ts` 仅保留合法的
tab、status、page、id 参数。新事项通知写入 `/workspace/issues/<id>`；历史通知不改写。
读取和未读查询同时识别新旧两种精确地址，只标记当前收件人有权读取的通知。
维护首报通知指向作者的资源编辑详情及 linkId；反馈者的结果通知指向公开资源页面。

个人主页保留公开正式条目展示，本人的私有管理入口指向工作台。复杂投稿编辑仍在
`/submission/[id]`：draft 和 changes_requested 可编辑，pending 须撤回后再改。
普通作者的已发布条目提供查看和反馈更正入口；既有管理员直接创建和重写能力保留。

## 本人 API 与编辑

| HTTP API | 内容 |
| --- | --- |
| `GET /api/workspace/entries` | submissions／published 两种视图，必要摘要、本人额度与余额 |
| `GET /api/workspace/resources` | 资源／游戏名搜索、状态和分区筛选，created DESC、id DESC 分页 |
| `GET /api/workspace/resources/[id]` | 精确编辑读取、完整 baseLinks 和私有维护信息 |
| `PUT /api/workspace/resources/[id]` | 严格输入适配到共用稳定资源 writer |
| `DELETE /api/workspace/resources/[id]` | 复用原删除与账务，并在锁内再次限制本人归属 |
| `GET /api/workspace/maintenance` | feedback、optional、handled 筛选与可行动数 |
| `POST /api/workspace/maintenance` | respond、verify、snooze、stop、resume |

共享契约在 `types/api/workspace.ts`、`types/api/linkMaintenance.ts`、
`constants/workspace.ts`、`constants/linkMaintenance.ts`。Zod 校验位于
`validations/workspace.ts`、`validations/linkMaintenance.ts`。
响应使用 `private, no-store`，业务错误沿用 JSON 字符串与对应 HTTP 状态。
查询主体仅取服务端会话，客户端不能选择其他用户；筛选与总数在数据库分页前应用。

普通作者只可编辑正常资源。待审核和封禁资源保留必要状态，详情不下发凭据；
共用 writer 在事务锁内再次核对状态，旧站点 PUT 同样受限。
管理员原接口权限保持不变，工作台接口仍限定其本人管理范围。

可编辑链接在私有详情中返回编辑所需字段，凭据只保存在组件内存。管理读取不调用
access／restore，不创建 grant、获取记录或反馈资格。普通作者的受保护资源盘槽位仅有
id、version、storage、protected 四个字段。

PUT 顶层、链接和基点均严格拒绝未知字段。受保护保留引用恰好为 `{ id, version }`，
不能夹带地址、密码、存储类型或排序字段。锁内重读全部实际链接并核对完整 baseLinks，
保护字段只从数据库补齐；缺槽、伪造、删除、重排均拒绝。旧站点作者提交的保护字段
必须与数据库一致，一致后也只持久化数据库原值。

每次编辑会话只捕获一次基点。后台刷新、请求失败和 409 保留草稿及原基点；成功保存
后才进入新的编辑基点。上传复用本人登记素材、consume、S3 补偿和 finalize，不信任
客户端地址或素材 metadata。移除最后一条链接须走整份资源删除确认，资源盘删除限制
和积分回退保持原规则。提交后的检测、缓存或清理失败不能把已提交结果报告成回滚。

## 维护与健康

维护控制在 `patch_resource_link_maintenance`，按原 linkId／地址版本唯一；revision
与健康 evidence_round 独立。事件保存在 `patch_resource_link_maintenance_event`，
每个控制记录有独立 round，active_key 约束同版本最多一个进行中事件；有效参与者
保存在 `patch_resource_link_maintenance_participant`。

| 情况／操作 | 结果 |
| --- | --- |
| 纯机器异常 | 可选维护，不主动催办普通发布者 |
| 首份符合资格的非重复正权报告 | 原报告、维护事件、参与者及首报通知同事务写入 |
| 同轮后续报告 | 合并，不重复通知；零权或重复报告不能独自开新事件 |
| respond | 必填说明，完成本轮并通知有效参与者，不裁决健康 |
| verify | 沿用原权限、健康基点和核实间隔，健康转换与维护回应同事务 |
| snooze | 仅暂停进行中事件，服务器计算 1 或 3 天；期限内拒绝失效反馈 |
| 暂缓到期 | 同一事件派生为可行动，不建新轮、不重发通知，也不新增 cron |
| stop | 必填说明，结束现有事件并冻结当前版本；纯机器异常不制造首报或结果通知 |
| resume | 只解除冻结，下一份新的有效报告才能开新轮，不改健康和版本 |
| 换地址 | 结束旧版维护，新地址版本开放反馈 |
| 改码等同版本编辑 | 不自动解除停止维护 |
| 删除／移动 | 删除退出清单并保留必要历史；移动更新目标，保留轮次与通知标记 |

出站检测前和报告写事务内都校验反馈冻结，防止在途请求绕过。冻结只限制单链接失效
反馈，内容问题和违规反馈仍可提交。资源盘继续由站方处理。

锁序为资源 → 实际链接 → 维护控制／事件 → 事项。单链接操作可从链接开始，不能反向
锁父资源。控制表的 resource_id 保留为历史标量，不建立会隐式取得父资源 KEY SHARE
锁的外键；link_id 使用 SetNull，实际链接删除后维护历史仍可保留。

健康事项继续承载七天疑似超时、三十天核实后争议等规则。维护回应、暂缓、停止和历史
迁移不擅自关闭或改写健康事项；健康结案也不自动完成维护。机器与自动事项流转不追加
普通发布者催办，真实对话、管理员决定和站方争议／升级通知保留。同一回应或资源变更
同时产生维护结果和事项结案时，对同一反馈者合并结果通知。

## 清单、公开投影和缓存

发布者待处理数为可行动维护事件，加原有待处理事项，再排除已被维护记录代表的普通
发布者链接事项。未到期暂缓、可选维护、停止维护和已处理不计；到期暂缓计入。
owned 列表、分页总数及用户菜单使用同一排除谓词；等待报告者、站方争议和资源盘队列
保持原口径。未接续的历史事项继续保留入口和一次计数。

原事项页的独立链接待修复分组不再挂载。已有对话通过维护项的受权关联入口访问；
`canReadCaseForViewer` 复用原事项权限矩阵，只判断可读性，不标记已读。

公开 `LinkHealthSummary.maintenance` 只有 revision、限制原因与恢复时间；说明、事件、
参与者和内部关联属于私有 DTO。维护变更触发既有资源缓存失效，缓存失败不回滚已提交
操作。暂缓到期后界面重新读取状态，不自动提交反馈。

页面统一投影供状态、能力、失效数量和内部链接折叠读取；健康与维护分别按版本／修订
合并。健康回包不制造新的读取快照，不清除仍有效的凭据或编辑草稿。真正的新读取／
地址版本变化仍使旧凭据失效。资源卡片保留平台／语言排序及官方／社区分组，不按健康
重排，也不因全部链接失效而消失。两路反馈提示读取维护回执，不用 caseId 推断通知。

## 迁移与验证

先安装既有 2026-10-09 链接健康结构和 2026-10-17 CHECK 增量，再依次运行：

1. `migration/production-link-maintenance-preflight-2026-10-19.sql`
2. `migration/production-link-maintenance-sync-2026-10-19.sql`
3. `migration/production-link-maintenance-postflight-2026-10-19.sql`
4. 既有 `pnpm prisma:deploy-safe` 与固定版本部署流程。

preflight／postflight 只读；sync 单事务，锁等待 5 秒、语句上限 60 秒。仅接续当前版本、
最新健康上下文合法、未结且归发布者、已有 ever_counted 正权证据、尚未首次回应的
link_suspect。来源标记为 migrated，不补发通知，不改旧事项、上下文和时钟。异常上下文
单列核验；重跑不覆盖上线后的真实维护记录，既有健康 CHECK 保留。

生产须停止旧写入后迁移、postflight 和 schema guard，再切换同版本应用实例；新旧
应用不能混跑而绕过反馈冻结。不要在现有持久库运行 prisma db push。

单元测试覆盖本人范围、严格引用、状态转换、冻结、通知、待办、路由及 UI 草稿。
`tests/e2e/workspace-maintenance.e2e.ts` 使用真实 HTTP、隔离 PostgreSQL／Redis 和本机
受控 checker；`tests/e2e/workspace-maintenance-migration.e2e.ts` 验证只读检查、首次安装、
非空回填、锁超时回滚及重跑，`KUN_E2E_MIGRATION_PHASE=postruntime` 检查真实运行记录
不会被同步覆盖。脚本只接受 loopback、非默认数据库／Redis 端口和 `_e2e` 数据库，
应用服务导入还要求 `KUN_DATABASE_URL` 与显式 E2E URL 一致。只在一次性环境运行，
不请求真实分享，也不连接真实对象存储。浏览器验收包含 360、390、1280 宽度及交互。
