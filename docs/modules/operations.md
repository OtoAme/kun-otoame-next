# 数据库与日常运维操作指南

本指南集中维护数据库迁移、备份恢复、清理回填、后台任务与边缘缓存验收。应用下载、构建、进程切换与运行配置归[部署指南](../project/deployment.md)。只执行本次已经授权且目标明确的操作，读取和预览也要保护私有数据；命令存在不等于获准在生产执行。

## 开始一次维护

先确认目标主机、应用提交、数据库、发布标签和维护范围，选出本次依赖的迁移，审阅影响并在一次性设施演练。真实维护前保留当前运行产物、配置恢复资料及验证过的备份。私有盘点、计划、回执、日志与备份放在仓库及全部工作区之外的受限持久目录，目录权限 0700、文件 0600。

需要公告时，在后台小喇叭发布覆盖窗口的重要官方消息。恢复后按实际结果提前结束或移除：提前结束保留公开历史，移除退出公开展示。公告不代替停止旧进程和写入。

迁移按只读预检、审核、同步、只读复检执行；没有独立复检文件时，以同组预检重跑检查完成状态。同名对象不兼容、非法数据或冲突时停止，不能通过删对象或自动合并数据凑成可执行状态。大数据修复先预览并保存输出。

## 停写、备份与执行文件

以下适用于数据库在 Docker 容器、应用由 PM2 管理的场景。逐条执行并检查结果，尖括号全部替换为本次核对的值；认证使用既有受限凭据机制，不把密码写进命令历史。

```bash
export OTOAME_PG_CONTAINER='<数据库容器>'
export OTOAME_PG_USER='<数据库用户>'
export OTOAME_PG_DATABASE='<目标数据库>'
export OTOAME_BACKUP_FILE='<仓库外且尚不存在的绝对备份文件>'
docker inspect --format '{{.State.Status}}' "$OTOAME_PG_CONTAINER"
git status --short
git rev-parse HEAD
```

预检可在允许的只读阶段执行。需要排空旧写入时，停止全部旧应用实例，检查确已停止，同时停止其他相关写入进程，再建立宿主机备份：

```bash
pm2 stop kun-touchgal-next
pm2 status
umask 077
test ! -e "$OTOAME_BACKUP_FILE"
docker exec "$OTOAME_PG_CONTAINER" pg_dump -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" --format=custom --compress=6 --no-owner --no-privileges > "$OTOAME_BACKUP_FILE"
test -s "$OTOAME_BACKUP_FILE"
docker exec -i "$OTOAME_PG_CONTAINER" pg_restore --list < "$OTOAME_BACKUP_FILE" > /dev/null
```

确认父目录受限、备份非空且目录验证成功后继续；目录验证不等于已经演练完整恢复。不能只把备份留在数据库容器内。

每一份审核文件分别执行，将变量替换为下文实际文件路径。重定向需要容器标准输入参数：

```bash
export OTOAME_SQL_FILE='<审核的 migration 文件路径>'
docker exec -i "$OTOAME_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < "$OTOAME_SQL_FILE"
```

工具直接在主机时使用：

```bash
psql -X -v ON_ERROR_STOP=1 -d "$KUN_DATABASE_URL" -f "$OTOAME_SQL_FILE"
```

不要给并发建索引文件外包单事务。任何一步失败先停止后续执行并保持必要停写，保留输出与备份，按本页失败处理核对中断状态。

## 生产结构检查

审核迁移执行后运行：

```bash
pnpm prisma:deploy-safe
```

整条命令不是只读：先运行可能写结构或数据的资源链接兼容迁移，再只读比较结构，最后生成客户端。它不直接同步生产结构，也不应用差异建议。已有持久库不能改用开发初始化或接受数据库重置。

检查只接受空差异，或经过 PostgreSQL 实际定义核验的 Prisma 7.8 发行日期索引精确识别差异，目标为 `public.patch_released_idx`。不能扩大例外，也不要执行其建议的删除与重建 SQL；它会反复显示，重建可能阻塞生产写入。其他差异通过审核迁移解决，再按[固定发布流程](../project/deployment.md#发布已经审核的版本)切换。

## 按能力选择迁移

只运行目标环境尚缺且已经审核的依赖，不把整表当作无条件批处理。每行链接按顺序执行。

| 能力 | 文件与完成条件 |
| --- | --- |
| 通用兼容结构 | [预检](../../migration/production-schema-preflight-2026-05-03.sql)、[同步](../../migration/production-schema-sync-2026-05-03.sql)，完成后重跑预检。 |
| 私聊列表隐藏 | [预检](../../migration/production-conversation-hidden-preflight-2026-07-01.sql)、[同步](../../migration/production-conversation-hidden-sync-2026-07-01.sql)，复检列定义，不删除历史。 |
| Steam 软重复 | [预检](../../migration/production-steam-id-soft-duplicate-preflight-2026-07-09.sql)、[同步及内置复检](../../migration/production-steam-id-soft-duplicate-sync-2026-07-09.sql)，在显式事务外执行，确认旧唯一限制解除、普通索引有效；失败索引由加固同步识别恢复。 |
| 资源访问缺基础表 | [预检](../../migration/production-resource-access-bootstrap-preflight-2026-07-12.sql)、[同步](../../migration/production-resource-access-bootstrap-sync-2026-07-12.sql)，复检后走下节授权迁移；不加入自动部署。 |
| 私聊贴纸基础与管理 | 依次运行[基础预检](../../migration/production-private-chat-stickers-preflight-2026-08-14.sql)、[基础同步](../../migration/production-private-chat-stickers-sync-2026-08-14.sql)、[管理预检](../../migration/production-sticker-admin-preflight-2026-08-14.sql)、[管理同步](../../migration/production-sticker-admin-sync-2026-08-14.sql)。旧安装追加[结构对齐](../../migration/production-stickers-prisma-alignment-2026-08-15.sql)，复检重复内容、封面与外键；不处理发行日期索引。 |
| 萌萌点账目 | [预检](../../migration/production-moemoepoint-ledger-preflight-2026-08-17.sql)、[同步](../../migration/production-moemoepoint-ledger-sync-2026-08-17.sql)，重跑预检确认结构与幂等初始账目；旧版不记账，不能有写流量时单独回退应用。 |
| 投稿和素材清理 | 依次运行[发行版本唯一预检](../../migration/production-vndb-relation-id-unique-preflight-2026-08-24.sql)、[同步](../../migration/production-vndb-relation-id-unique-sync-2026-08-24.sql)、[投稿预检](../../migration/production-patch-submission-preflight-2026-08-24.sql)、[同步](../../migration/production-patch-submission-sync-2026-08-24.sql)、[清理预检](../../migration/production-patch-submission-orphan-cleanup-preflight-2026-08-25.sql)、[同步](../../migration/production-patch-submission-orphan-cleanup-sync-2026-08-25.sql)。完成后重跑三份预检，见下文。 |
| 会社身份基础 | [预检](../../migration/production-company-identity-bootstrap-preflight-2026-08-30.sql)、[同步](../../migration/production-company-identity-bootstrap-sync-2026-08-30.sql)、[复检](../../migration/production-company-identity-bootstrap-postflight-2026-08-30.sql)，先于依赖新结构的代码。 |
| 标签与会社计数 | [预检](../../migration/production-tag-company-count-preflight-2026-08-30.sql)、[同步](../../migration/production-tag-company-count-sync-2026-08-30.sql)、[复检](../../migration/production-tag-company-count-postflight-2026-08-30.sql)，按下文避免双重计数。 |
| 会社最终约束 | [预检](../../migration/production-company-identity-constraint-preflight-2026-08-30.sql)、[同步](../../migration/production-company-identity-constraint-sync-2026-08-30.sql)、[复检](../../migration/production-company-identity-constraint-postflight-2026-08-30.sql)，持续停写并完成冻结清理。 |
| 小喇叭 | [预检](../../migration/production-shoutbox-preflight-2026-09-11.sql)、[同步](../../migration/production-shoutbox-sync-2026-09-11.sql)、[复检](../../migration/production-shoutbox-postflight-2026-09-11.sql)，检查扣费、三人隐藏、官方例外、退款一次及生效边界后开放。 |
| 问题处理基础 | [预检](../../migration/production-case-preflight-2026-09-13.sql)、[同步](../../migration/production-case-sync-2026-09-13.sql)、[复检](../../migration/production-case-postflight-2026-09-13.sql)，再装下一行扩展。 |
| 问题附图与提醒 | [预检](../../migration/production-case-feedback-preflight-2026-09-26.sql)、[同步](../../migration/production-case-feedback-sync-2026-09-26.sql)、[复检](../../migration/production-case-feedback-postflight-2026-09-26.sql)，扩展后不重跑只认基础列数的检查，旧反馈与举报不回填。 |
| 控制台查询索引 | [预检](../../migration/production-dashboard-indexes-preflight-2026-10-31.sql)、[同步](../../migration/production-dashboard-indexes-sync-2026-10-31.sql)，在显式事务外执行；只建索引，不改数据，不需要停写。同步可重复运行：已存在且有效的跳过，中断留下的无效索引删掉重建，同名但定义不同时停止。完成后重跑预检，四项都应为 `already_ok`。 |

### 资源访问授权

先在维护窗口前完成 Steam 软重复与复检。排空旧获取写入并备份，缺基础表先补齐。运行[授权预检](../../migration/production-resource-access-grant-preflight-2026-07-10.sql)，从实际输出取得停写后的最大记录号与含时区切换时刻；空表最大号为 0，不能用示例或停写前旧快照。

固定这两个实际值用于本次全部执行：

```bash
export OTOAME_ACCESS_MAX_ID='<实际非负最大记录号>'
export OTOAME_ACCESS_CUTOVER_AT='<实际含时区切换时刻>'
docker exec -i "$OTOAME_PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" -v legacy_max_id="$OTOAME_ACCESS_MAX_ID" -v legacy_cutover_at="$OTOAME_ACCESS_CUTOVER_AT" < migration/production-resource-access-grant-sync-2026-07-10.sql
```

以完全相同的值再运行[授权同步](../../migration/production-resource-access-grant-sync-2026-07-10.sql)，再将上述命令输入文件换成授权预检，带相同参数复检，确认分类、授权与索引完整。同步在显式事务外执行；中断按现有检查核对，不猜测已完成。

通过结构检查后只启动审核固定版本。旧有效授权最多可能延续 72 小时，新授权固定 24 小时。旧版重新写过旧格式后，下次必须重新排空并建立新快照，不能沿用旧参数。

### 投稿上线

发行版本预检出现任何大小写重复组时停止人工裁决，不自动合并。唯一同步使用并发索引，不外包事务。投稿预检分别处理主表和画廊缺失，首次缺表可跳过对应行检查；已有不兼容类型、状态或约束须先解决。

完成后重跑三份预检，确认结构存在、非法行数为零、自动更新时间列没有数据库默认值、清理表具备。旧默认值由当前可重跑同步修正，不能忽略检查。先完成清理结构和缓存权限，再启动依赖代码，受权走草稿、上传、提交和审核短流程；没有真实写入授权时在隔离环境验证。

### 会社身份与计数

先装身份基础，部署与之兼容、解析关闭且能同步身份的版本；不能用最终数据模型检查强行跳过中间依赖。回填先预览再应用，完成后变更数应为零：

```bash
pnpm maintenance:companies:identity:dry
pnpm maintenance:companies:identity:apply
pnpm maintenance:companies:identity:dry
```

历史别名保留为历史证据，不冒充可信来源，不猜外部编号。名称过长时人工核对，不截断继续；不同公司共享别名可保留，不因此自动合并。

计数迁移前先部署不手工增减计数的兼容应用，再安装六类触发器、回填并复检实际定义与计数；重复同步应无回填变化。通过后才部署完全移除旧绝对修复的后续版本，避免双重计数。最终应用和维护脚本都只能由数据库维护关系计数。

最终约束需连续停写创建、重写、投稿批准及会社关系修改，重新盘点和审核冻结清理，按下节预览、执行、清缓存，再安装约束与复检。共享别名告警不必清零，主名和外部身份冲突须处理。以候选实际结构检查发布兼容版本，先保持 `KUN_COMPANY_IDENTITY_RESOLVER_ENABLED=false`，再启用同一服务端开关并重启受控实例。

恢复写入前核对创建、重写、投稿预览与批准三条链路，预览与正式关系一致、有效来源未丢、无唯一冲突。失败先关闭开关并验证兼容路径；兼容也失败则持续停写，按恢复节处理。源码存在不证明生产已经启用。

### 链接健康与维护结构

依次运行[健康预检](../../migration/production-link-health-preflight-2026-10-09.sql)、[同步](../../migration/production-link-health-sync-2026-10-09.sql)、[复检](../../migration/production-link-health-postflight-2026-10-09.sql)，再运行[屏蔽原因预检](../../migration/production-link-health-blocked-preflight-2026-10-17.sql)、[同步](../../migration/production-link-health-blocked-sync-2026-10-17.sql)、[复检](../../migration/production-link-health-blocked-postflight-2026-10-17.sql)。已有基础只补增量，增量后用认识新约束的检查，不重跑旧定义检查。

屏蔽原因同步只替换经过核对的约束，不修改业务记录，锁等待 5 秒、语句上限 60 秒，失败整体回滚。历史获取记录不猜地址版本，也不据此取得当前版本报告资格。回退应用可以保留兼容扩展约束；必须收窄时先停写并确认没有新增原因记录，不能删观察强行回退。

随后运行[维护预检](../../migration/production-link-maintenance-preflight-2026-10-19.sql)、[同步](../../migration/production-link-maintenance-sync-2026-10-19.sql)、[复检](../../migration/production-link-maintenance-postflight-2026-10-19.sql)。先停旧写入并备份，同步单事务、相同超时边界；只接续当前地址、合法最新依据、仍归发布者未结、曾有有效报告且尚无首次回应的普通疑似事项。不改健康时钟、不补发通知，重跑保护真实维护记录。检查后切同版本实例，禁止旧版混跑绕过反馈冻结。

## 冻结会社清理与合并

前提是身份、计数结构和受限审计目录具备，备份已经验证。顺序为盘点、人工裁决、冻结计划、预览、执行和缓存确认。下列路径与摘要须替换为本次真实文件：

```bash
pnpm maintenance:companies:inventory --out=<审计目录>/inventory.json
pnpm maintenance:companies:plan --manual-only --inventory=<审计目录>/inventory.json --decisions=<审计目录>/decisions.json --out=<审计目录>/plan.json
pnpm maintenance:companies:dirty:dry --plan=<审计目录>/plan.json
pnpm maintenance:companies:dirty:apply --plan=<审计目录>/plan.json --confirm-sha256=<审核计划摘要>
pnpm maintenance:companies:dirty:cache --plan=<审计目录>/plan.json
```

人工裁决仅引用本次盘点对象，明确合并、删除、所有者、内容保留与理由。零作品关系不是删除许可，没有明确裁决的对象保留。手工模式不访问 VNDB 或 NextMoe、不提自动合并；两次数据库快照变化拒绝产计划。需外部证据且获授权时，省略手工参数才在规划阶段读取 VNDB 和可选 NextMoe。只有规划可以联网取证，预览和执行不重规划、不访问资料或缓存。

执行要求精确摘要，核对完整前置状态、工具版本、来源与计数，漂移在零写入下拒绝；整体提交或回滚，提交后保存回执。缓存失败只在数据库仍匹配完整后置状态时重试缓存，不重跑数据库动作。合并没有自动拆分，恢复依赖备份和审计物。旧工具盘点与计划不能混用当前版本，关系快照必须包含当前要求的完整来源信息。

后台合并建议检测与驳回不改会社。确认至少选两家，只合并所选，最小编号为保留对象，未选不删并记录排除关系。源公司删除后旧链接可能失效。按实际成员识别跳过与重开，不按相近名称认同一组。

建议表缺失时先运行[建议预检](../../migration/production-company-merge-suggestion-preflight-2026-09-17.sql)和[同步](../../migration/production-company-merge-suggestion-sync-2026-09-17.sql)，再依次执行[子集预检](../../migration/production-company-merge-subset-preflight-2026-09-22.sql)、[同步一](../../migration/production-company-merge-subset-sync-a-2026-09-22.sql)、[同步二](../../migration/production-company-merge-subset-sync-b-2026-09-22.sql)、[第二预检](../../migration/production-company-merge-subset-preflight-2-2026-09-22.sql)、[同步三](../../migration/production-company-merge-subset-sync-c-2026-09-22.sql)、[复检](../../migration/production-company-merge-subset-postflight-2026-09-22.sql)，依赖代码不能提前运行。含旧运营结构的持久库同样不能直接推结构；生产转储只恢复到独立演练库，不对转储保留库操作。

## 日常预览、清理和回填

先核对目标、范围与授权。涉及写入时有备份或明确文件恢复限制，先读预览输出，确认候选与预计变化，再用同样范围执行；预览失败停止。

| 任务 | 预览与执行 | 完成与失败处理 |
| --- | --- | --- |
| 资源派生分类 | `pnpm maintenance:resource-attributes:dry`；确认后 `pnpm maintenance:resource-attributes:apply` | 只按已发布资源重算并刷新缓存，待审与封禁不参与。 |
| 资源类型重分类 | `pnpm migration:resource-type:dry`；确认后 `pnpm migration:resource-type:apply` | 同步游戏派生分类；资源计数触发器由 `pnpm migration:patch-counters` 在审核窗口安装与回填。 |
| 标签别名重复 | `pnpm maintenance:tags:auto-alias:dry`；确认后 `pnpm maintenance:tags:auto-alias:apply` | 迁移关系、别名及屏蔽偏好，数据库维护计数；多主歧义保留并人工裁决。 |
| 人工标签合并 | `pnpm maintenance:tags:export --out=<审计目录>/tags.json` 后使用 `pnpm maintenance:tags:merge:dry -- --plan=<审核计划>`；确认后 `pnpm maintenance:tags:merge:apply -- --plan=<同一计划>` | 核对真实盘点，空本地库不能证明生产影响；脏标签清理另有 `pnpm maintenance:dirty-tags:dry` 和对应 `apply`，先审核候选。 |
| 截图缩略图 | `pnpm maintenance:gallery-thumbnails:dry`；确认后 `pnpm maintenance:gallery-thumbnails:apply -- --limit=50 --batch=20 --concurrency=1 --delay=1000` | 预览不下载原图、不写存储或数据库，执行只补真实缩略图，不改原图；失败看跳过与错误，再缩范围复查。 |
| 未发送私聊图片 | `pnpm maintenance:conversation-images:dry`；确认后 `pnpm maintenance:conversation-images:apply -- --limit=100 --batch=50 --concurrency=1 --delay=1000` | 默认仅删超过 2 小时、路径符合且不被未删除消息或回复引用的对象；预览默认最多 200，执行前重查引用。失败保留错误，不能把候选当已删。 |
| 投稿素材积压 | `pnpm maintenance:submission-assets:dry`；确认后 `pnpm maintenance:submission-assets:apply` | 预览不写待办、不删文件、不清边缘。执行依次处理终态投稿积压、持久待办和新无主文件，默认宽限 24 小时，可用 `--grace-hours` 与 `--limit` 调整。 |
| 内置贴纸 | `pnpm stickers:sync -- --manifest=<本地清单>`；确认后同命令加 `--apply` | 校验后上传与更新目录，不删历史贴纸；格式与步骤见[贴纸维护](private-chat-stickers.md#导入和同步操作)。 |

截图可用 `--patch-id`、`--start-id`、`--limit`、`--max-original-mb` 缩范围，不确定编码成本时加 `--skip-animated-avif`。私聊图片可用 `--conversation-id` 和更长 `--older-than-hours` 缩范围。保持生产低并发，视频工具安装和验证见部署指南。

截图摘要区分总图、已有缩略图、缺图、扫描、合格、更新、跳过和失败。扫描为零且无缺图只表示当前范围无需补图，不表示没有图库。私聊摘要区分扫描、合格、已删、引用中、过新、路径不符和失败，预览不产生删除。

### 投稿素材清理的范围

同一维护命令先处理投稿记录上的清理积压，再处理单独保存的文件清理记录，最后发现新的无主文件。新发现的对象先写入持久待办，再尝试删除。前两类记录的保护范围不同：

| 记录 | 当前检查与完成判定 |
| --- | --- |
| 已驳回、违规处理或删除的投稿仍记录的清理积压 | 检查投稿属于可清理状态，按其中的文件记录删除，只从当前配置生成公开地址。文件删除及这些地址的缓存清理确认后，清空投稿上的文件记录；不逐文件复查其他活动投稿或正式条目是否仍在使用，也不保存已经退出配置的旧公开地址。 |
| 单独保存的文件清理记录 | 执行时重新读取活动投稿与正式内容引用，仍被使用则取消该待办；保留已记录的历史公开地址，并在删除前保存新增地址。文件删除与已记录地址的缓存清理都确认后才结清。 |

迁移图床或资源公开域名、从备份恢复或人工修复数据后，执行投稿积压清理前，操作者须核对待删文件是否仍被活动投稿或正式条目使用，并核对曾使用过的公开域名及其缓存清理情况。引用关系不清时先停止本次清理，仅凭投稿已经结束不能代替文件核对。旧域名缓存尚未确认清除时，即使命令报告完成，也不能认定素材已下架。

积压未清应核对未完成、记账失败与缓存日志，不能手工删记录清空。事项未提交图片与贴纸清理失败没有可套用的通用持久重试任务，不把私聊或投稿清理误用于其他目录。

## 定时任务怎样观察

应用注册每日重置、临时上传清理、浏览量入库、投稿素材巡检、问题超时和链接健康六类任务。临时上传每小时清理超过一天的残留，浏览量每两分钟入库。投稿素材每天上海时间凌晨 4 点只巡检，使用本进程防重入和 8 小时多实例锁，不删除或建立清理待办。

问题超时每小时第 17 分钟处理相关发布者问题的转交、结案与到期前提醒，站方问题和链接健康不混入。健康每小时第 27 分钟处理普通疑似 7 天、核实后普通争议 30 天到期，持久机器冲突与损坏依据跳过。按编号推进，每批 200、最多 10 轮，跳过也推进；游标保存失败只在本进程回退，不承诺跨实例进度。任务锁获取失败跳过整轮，不能套普通技术限频故障放行规则。

修改任务注册或实现后重启应用。常驻任务复用维护引擎但不能关闭共享数据库连接。检查日志与未完成计数，页面正常不能证明任务已经执行。

## 失败与数据库恢复

停写后任一步失败，保持必要写入停止，记录发生在同步前、中还是应用切换中，保留备份和输出并重新核对实际状态。可重入只适用于文件已支持的中断点，不等于任意失败自动恢复。

应用回退只处理运行版本，见[部署恢复](../project/deployment.md#离线回退应用)。旧版必须兼容账务、维护冻结、事项和新约束。新事项不能转写旧队列或删表；暂停新事项创建时，依赖关注记录的小喇叭自动隐藏也需由管理员人工处理。

会社解析失败先关闭开关、验证兼容上一版。只有上一版也不能兼容最终结构，才在持续停写下执行[约束回退](../../migration/production-company-identity-constraint-rollback-2026-08-30.sql)及[回退复检](../../migration/production-company-identity-constraint-rollback-postflight-2026-08-30.sql)，恢复基础可空形态但保留业务数据。计数回退需停关系写入，执行[计数回退](../../migration/production-tag-company-count-rollback-2026-08-30.sql)，部署匹配手工计数版本、检查计数后再开放。[合并建议专用回退](../../migration/production-company-merge-subset-rollback-2026-09-22.sql)也需审阅演练，不与会社数据合并恢复混用。

真正数据恢复是独立的破坏性操作，基于本次已验证备份、恢复目标与审计物制定审核方案，先在隔离库验证。不能用结构强推、重置、清表或未经审核的覆盖恢复对齐。本仓库没有自动撤销任意生产变更的通用任务。

## Cloudflare 共享缓存配置与验收

前提是目标版本已实现公开写入失效、实时统计禁止缓存及私有响应隔离，反代不额外覆盖源站缓存头。先核对区域和令牌权限，SaaS 使用承载自定义主机名的提供方区域，不能从访问域名猜。网站与图床分区时按[运行配置](../project/deployment.md#运行配置)分别填写；显式网站区域缺令牌不会退回默认区域。

按下列顺序建立三条规则，不全站缓存。规则叠加时，同一设置冲突以后命中为准，见[官方顺序说明](https://developers.cloudflare.com/cache/how-to/cache-rules/order/)。下面把 `<网站主机>` 替换为精确主机，不带协议。

第一条只缓存匿名公开 HTML：

```text
http.host eq "<网站主机>"
and (http.request.method eq "GET" or http.request.method eq "PURGE")
and (
  http.request.uri.path eq "/"
  or http.request.uri.path eq "/otomegame"
  or http.request.uri.path eq "/tag"
  or starts_with(http.request.uri.path, "/tag/")
  or http.request.uri.path eq "/company"
  or starts_with(http.request.uri.path, "/company/")
)
and not http.cookie contains "kun-galgame-patch-moe-token"
and not http.cookie contains "kun-patch-setting-store|state|data|kunNsfwEnable"
and not http.cookie contains "kun-patch-setting-store|state|data|kunBlockedTagIds"
and not has_key(http.request.headers, "rsc")
and not has_key(http.request.headers, "next-router-prefetch")
and not has_key(http.request.headers, "next-router-state-tree")
and not has_key(http.request.headers, "next-router-segment-prefetch")
```

游戏详情 HTML、个人页面和框架数据请求不进入该范围。第二条只缓存匿名标签与会社列表 API：

```text
http.host eq "<网站主机>"
and (http.request.method eq "GET" or http.request.method eq "PURGE")
and (
  http.request.uri.path eq "/api/tag/otomegame"
  or http.request.uri.path eq "/api/company/otomegame"
)
and not http.cookie contains "kun-galgame-patch-moe-token"
and not http.cookie contains "kun-patch-setting-store|state|data|kunNsfwEnable"
and not http.cookie contains "kun-patch-setting-store|state|data|kunBlockedTagIds"
```

两条动作均允许缓存，边缘寿命选择使用源站缓存控制头、缺头则绕过，浏览器寿命尊重源站，保留默认缓存键和完整查询参数，不按设备拆分，缓存欺骗盔甲保持本方案的关闭设置。查询排序仅在套餐支持并有需要时使用，不能忽略查询字符串。设置含义见[官方规则设置](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/)。

第三条放在最后，绕过个性化、框架数据和非白名单业务请求：

```text
http.host eq "<网站主机>"
and (
  (http.request.method ne "GET" and http.request.method ne "PURGE")
  or http.cookie contains "kun-galgame-patch-moe-token"
  or http.cookie contains "kun-patch-setting-store|state|data|kunNsfwEnable"
  or http.cookie contains "kun-patch-setting-store|state|data|kunBlockedTagIds"
  or has_key(http.request.headers, "rsc")
  or has_key(http.request.headers, "next-router-prefetch")
  or has_key(http.request.headers, "next-router-state-tree")
  or has_key(http.request.headers, "next-router-segment-prefetch")
  or (
    starts_with(http.request.uri.path, "/api/")
    and http.request.uri.path ne "/api/tag/otomegame"
    and http.request.uri.path ne "/api/company/otomegame"
  )
)
```

第三条动作设为绕过。缓存与方法绕过同时考虑获取和清理方法，因为[单 URL 清理会评估规则](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-single-file/#cache-rules-that-match-on-request-properties)；应用调用清理 API 仍为认证请求。不要强制覆盖私有或禁止保存的源站响应，也不要叠加未纳入失效链的反代 HTML 缓存。

验收用 GET 连续请求，同一出口、节点与原寿命内比较内容和响应头，不用 HEAD。设为本次受控公开页面或白名单 API 的完整地址：

```bash
export OTOAME_CACHE_URL='<本次受控公开地址>'
curl -fsS -D - -o /dev/null "$OTOAME_CACHE_URL"
curl -fsS -D - -o /dev/null "$OTOAME_CACHE_URL"
```

观察 `cf-cache-status`、`age`、`cache-control`、`vary` 和 API 的 `x-kun-cache`。可缓存的匿名响应应能从未命中到命中；登录、成人偏好、屏蔽标签、框架数据、实时统计和写入请求不应命中共享缓存。使用受控账号和浏览器分别验这些情况，不能以伪造登录值证明真实个性化边界。验证不同查询返回正确各自结果，不只比较年龄。平台接受规则不证明所有响应都可缓存。

分别验证页面和图片完整地址清理，以及 API 前缀多组查询。清理前确认命中，在原缓存寿命内触发已授权业务失效，观察新内容、未命中或过期，随后重新命中且年龄重算，避免把自然过期当成功。[前缀清理](https://developers.cloudflare.com/cache/how-to/purge-cache/purge_by_prefix/)用主机与路径，不带协议、查询和片段，覆盖对应查询变体。

任一区域未确认成功，都保留素材或会社清理凭据，不能只凭 HTTP 成功结清。失败核对区域、令牌权限、提供方区域、公开地址、自定义键、规则顺序与清理方法；日志不输出令牌、区域标识、完整资源地址或分享凭据。图片仍旧时核对源对象与浏览器缓存，边缘成功不等于浏览器立即更新。

## 性能与索引评估

先确定测试边缘命中、源站未命中还是个性化请求，绑定源码、数据量、实例、工具和范围。对独立测试环境逐级增加负载，观察延迟分位、错误率、CPU、内存、数据库连接和缓存命中。客户端握手或带宽先饱和时换测量环境，不能据此推断源站上限。生产压力测试需单独授权，本页不保留历史吞吐量作为当前承诺。

索引调整先核对数据库与源码定义，再取得真实查询的执行计划、扫描量和成本，检查统计与长期使用。未使用不等于可删除，索引可能承担去重约束。变更用审核迁移并在验证环境演练，不粘贴临时建索引或全库重建。用途见[索引说明](../project/database-indexes.md)。

## 源码入口

- [维护命令](../../package.json)、[生产检查](../../scripts/checkPrismaProductionSchema.ts)与[迁移文件](../../migration/)
- [冻结会社计划](../../scripts/companyCleanupPlan.ts)、[执行与回执](../../scripts/cleanupDirtyCompanies.ts)及[缓存重试](../../scripts/companyCleanupCache.ts)
- [缩略图回填](../../scripts/galleryThumbnailBackfill.ts)、[私聊孤儿清理](../../scripts/cleanupConversationImages.ts)与[投稿素材维护](../../scripts/cleanupSubmissionAssets.ts)
- [任务注册](../../server/cron.ts)、[任务锁](../../server/tasks/withTaskLock.ts)与[健康任务](../../server/tasks/linkHealthTask.ts)
- [公开响应缓存头](../../app/api/utils/cacheHeaders.ts)、[内容缓存失效](../../app/api/patch/cache.ts)与[分区域清理](../../app/api/utils/purgeCloudflareCache.ts)
