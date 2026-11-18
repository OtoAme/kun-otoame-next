# 测试与隔离验收操作指南

测试要证明变更后的业务结果、失败边界与权限保持正确。单元测试、真实数据库、浏览器和目标环境各回答不同问题，不能互相代替。证据的判断见[质量边界](../concepts/quality.md)，具体业务规则见[参考索引](../reference/README.md)。

## 选择相称的检查

前提是依赖已安装、使用项目要求的 Node.js 版本，并且清楚命令是否接触真实服务。单元测试用 Vitest 的本地替身隔离数据库、Redis、存储和外部平台，不能连接真实服务。`pnpm test` 同时收集集成测试目录；其中会社合并并发测试只在设置 `KUN_COMPANY_MERGE_TEST_DATABASE_URL` 时运行并连接该 PostgreSQL，未设置时跳过，设置时只能指向一次性数据库。

| 改动             | 应验证的结果                                                                   |
| ---------------- | ------------------------------------------------------------------------------ |
| 纯工具或输入校验 | 有效、非法和边界输入的实际返回。                                               |
| 业务接口         | 权限、归属、状态竞争、账务与通知、缓存受影响范围。                             |
| 数据结构或迁移   | 静态约束加一次性 PostgreSQL 的首次安装、非空数据、重复执行、中断与锁超时回滚。 |
| 上传与删除       | 本人登记、一次消费、部分失败、引用保护与补偿，必要时受控存储替身。             |
| 页面与交互       | 对应组件测试及受影响浏览器流程，手机、桌面和相关断点。                         |
| 部署和运行资源   | 类型、相应测试、产物完整性与目标环境就绪，构建受影响时构建。                   |
| 文档和技能       | 离线引用与契约检查，再核对事实和任务可用性。                                   |

行为修复先写最小失败测试，确认失败确由目标缺陷引起，再修复并验证。替身应体现真实事务和输入过滤，断言可观察结果及事务范围，不能只断言某个替身被调用。共享替身的初始化需遵守 Vitest 的提升规则；参考现有测试，不复制实现逐行自证。

迭代时运行目标文件，尖括号替换为本次实际路径：

```bash
pnpm test tests/unit/<目标文件>.test.ts
```

一般提交前门槛：

```bash
pnpm test:changed
pnpm typecheck
```

推送、发布、共享基础设施变化或导入关系无法覆盖的文件变更时运行相关完整检查；构建产物受影响时再构建：

```bash
pnpm test
pnpm build
```

受影响测试选择依据程序导入关系，样式、迁移文件、数据库结构与文档等通过文件读取的内容不一定被选中，应明确指定对应契约测试。已经通过且源码与环境仍有效的结果可以复用，不因文档修改重跑应用构建。

## 账号偏好隔离验收

以下命令创建任务专用、仅监听回环地址的一次性 PostgreSQL 和 Redis，核对随机身份后执行迁移与真实业务测试，并清理本次容器；依赖 Docker 和本地已有镜像，不使用默认业务库或既有 worktree 库兜底：

```bash
node scripts/verifyAccountPreferences.mjs
```

证据保存在本区 `.local/account-preferences/acceptance-<随机标识>/`，包含每步命令、退出码、迁移输出及清理结果。验收覆盖首次和存量迁移、重复执行、中断、锁超时、不兼容约束，以及同项竞争、异项并行、取消后旧请求、响应丢失重试、多项回滚、标签维护与注销竞争、交错快照读取和一次性邮件退订资格。

浏览器另用新的任务专属隔离配置：多个标签共用配置，跨设备另建配置。通过真实登录和受控测试账号验证换号及同账号新会话拒绝旧草稿、首次导入、离线草稿保留且重连不重放、跨设备冲突，以及三种内容模式下首页两块始终 SFW 且过滤屏蔽标签。真实迟到响应不能覆盖换号后的结果。账号偏好实际保存后还需组合部署保护，验证就绪失败时拒绝无兼容目标，并在取得对应凭据后安全恢复。浏览器引擎、版本、视口与未覆盖的最低版本应随交接记录，不能据当前浏览器通过声称全版本验收完成。

## 通知中心隔离验收

使用 Node.js 24.22.1、Docker 及本地 PostgreSQL 16 镜像，运行：

```bash
node scripts/verifyNotifications.mjs
```

命令只新建带随机身份的回环监听容器、独立数据库与卷，实际连接再次核对数据库、角色及身份标识，不回落默认业务库或已有工作区库。执行前建立新的绝对路径受限备份，核对自定义归档并演练恢复；账号偏好结构先安装，随后安装通知结构。可用 `--migrations-only` 或 `--business-only` 限定范围，默认完整执行。证据与逐步退出码在本区 `.local/notification-center/postgres-<随机标识>/`，结束时停止容器并保留卷与证据。

迁移覆盖空库、非空历史、重复执行、中断、锁超时回滚及不兼容定义，核对历史数据保持和索引执行计划。实际业务覆盖聚合与已读、清理交错，事件重试、事务回滚、并行回答与采纳、订阅保存及账号删除锁序，以及列表与内容序号的一致快照。替身测试分别验证必要通知、关闭订阅、收件关系、能力协商、旧客户端解析、具体条目版本、最大 30 条及旧批量已读安全拒绝。

浏览器使用新的独立配置与合成账号，在约 360 像素手机、桌面和中间断点实际验收。90 条未读只加载 30 条仍应保持 90，真实看到 6 条后为 84，看到前 30 条后为 60；前后三页不漏、不自动补位。覆盖跨分类、清理取消、纯已读不提示新内容、未读数不变的聚合或一读一新增仍提示，以及旧列表不消除新提示。验证连续前台焦点、遮挡撤除后重新计时、部分排队卡片失去资格、长文展开、键盘、详情成功与失败、普通直达、跨标签和返回位置；同一身份临时会话恢复保留原页，换号的迟到响应和旧订阅草稿零写入。

原生焦点、隐藏和恢复必须记录实际可见状态及可信事件；程序化 DOM 动作和受控计时只能证明标明的辅助场景，不能代替墙钟或原生交互。另以已安装的独立部署保护模块组合实际通知创建、确认后就绪失败与中断，验证不兼容恢复被拒绝、兼容资格与产物绑定正确。运行报告列明精确提交、依赖、构建及产物摘要、浏览器版本、视口、证据边界、未验证项和自己的样本清理结果。

## 只修改文档

在仓库根目录运行：

```bash
pnpm docs:check
pnpm test:docs-contracts
```

前者检查当前相对版本控制基准的维护文档变更；后者包含同一机械检查、检查器测试，以及核对文档中关键命令和迁移文件名的契约测试；契约只绑定命令、文件名与步骤顺序，不绑定具体措辞。检查指定文件可用 `pnpm docs:check docs/guides/documentation.md`，选择提交范围可用 `pnpm docs:check --base HEAD~1`。检查只核对本地相对目标、标题、占位、新页面入口及删改引用，不验证远程页面、站内路由、锚点、事实或自然语言。

若旧契约只绑定过期标题、内部名称或重复迁移清单，应保留安全含义并报告待调整断言，不为通过测试恢复错误文案。未执行或失败的检查如实报告。事实审阅按[文档标准](documentation.md)另行完成。

## 哪些行为需要真实隔离设施

worktree 管理器的重复初始化、数据库账号隔离和进程停止使用单独的[一次性设施验收入口](worktrees.md#验证入口)，需显式设置 `OTOAME_WORKTREE_ACCEPTANCE=1`；默认测试不创建 Docker 资源。

下载日周额度的临界并发、重复获取与当前地址资格；资源完整对照编辑、删除、移动与真实锁序；投稿撤回和审核竞争、押金结算；事项通知与账号删除竞争；数据库触发器和唯一性；缓存失效与官方生效边界，都不能只用模拟事务证明。

链接检测使用本机受控 HTTP 服务和合成响应，覆盖登录、来源保护、超时、拒绝跳转、大小上限、错误脱敏、时间与迟到结果。真实网盘仅在另行取得受权样本后验证，不能用生产分享代替测试样本。检测服务自身的固定源验证见[独立检测服务指南](../../deployment/link-checker/README.md)。

浏览器验证应覆盖长链接、失效折叠、两步反馈、确认取消零写入、最后一链删除限制、受限预览、保存冲突保留输入、跨目标迟到响应，以及手机虚拟键盘和焦点。它们是验收要求，本页不声称已有全站通过记录。

## 准备会社身份一次性验收

本节准备器和会社验收命令通过 Node.js 直接运行 TypeScript，按[开发指南](development.md#在空开发库启动)使用 Node.js 24.22.1，且保持默认类型剥除启用；它让 Node.js 忽略类型标注后执行脚本，不代替类型检查。其他直接以 Node.js 运行的端到端脚本，包括后文手机布局检查，也采用这一测试前提。类型剥除的行为见 [Node.js 官方 TypeScript 说明](https://nodejs.org/docs/latest-v24.x/api/typescript.html#type-stripping)。

前提是已准备可丢弃 PostgreSQL、隔离 Redis、浏览器，以及项目源码副本；项目根目录需有运行配置文件，准备器与验收命令会读取它，用于核对一次性数据库与应用默认库不同，文件缺失时命令直接失败；数据库连接必须显式给出、与应用默认库不同，名称严格以 `_e2e` 结尾。安全启动器固定本机 3100 端口，当前工作区不得已有开发服务器。以下尖括号均为操作者在隔离环境填写的值，备份路径必须是绝对且尚不存在的文件。

```bash
KUN_E2E_DATABASE_URL='<一次性数据库连接>' pnpm e2e:db:prepare --reset --backup=<新绝对备份路径>
```

准备器先写权限受限的自定义格式备份并验证目录，再重置、安装结构与计数触发器、检查约束，写入测试身份标记。目标、路径或备份验证不符会在重置前拒绝。数据库工具只在容器内时增加 `KUN_E2E_PG_CONTAINER`，连接还须为精确本机回环地址；不得改用真实持久库完成准备。

分别启动解析关闭与开启的两轮服务，每轮在另一终端运行对应验收：

```bash
KUN_E2E_DATABASE_URL='<一次性数据库连接>' pnpm e2e:company-server --resolver=off
KUN_E2E_DATABASE_URL='<同一一次性数据库连接>' pnpm e2e:company-identity --expect-resolver=off
```

停止唯一服务后，分别把两个参数改为 `on` 再运行。启动器关闭 Cloudflare 与搜索通知副作用，验收检查实际服务的数据库标记及解析行为，不只看当前终端变量；该会社脚本不写入或删除对象存储。失败保留隔离结果，不回退默认库重跑。

## 站方备份与资源合并验收

[模块验收入口](../../scripts/officialMirrorAcceptance.py)使用独占的一次性 PostgreSQL、Redis、生产构建和本机受控服务，执行真实数据库、HTTP 与浏览器检查。前提是已安装项目依赖、Docker、本机 Chrome，以及 PostgreSQL 16 和 Redis 7 镜像；本机 3100、36741、55432、55435、55436、55443、56380 端口须空闲。入口从当前提交创建应用副本，只叠加指定测试文件，不加载真实环境配置；未提交的业务修改不在该副本内，须先确定待测提交。它不使用现存 dump，也不能替代上线前真实数据核查。

先创建新运行目录，再把输出的 `RUN_DIRECTORY` 填入下列变量；不要复用别人的运行目录或以默认数据库代替失败目标。每步成功后再执行下一步，失败日志保留在该目录：

```bash
python3 scripts/officialMirrorAcceptance.py prepare
OM06_RUN_DIR='coverage/<本次 prepare 输出的目录名>'
python3 scripts/officialMirrorAcceptance.py integration --run-dir "$OM06_RUN_DIR"
python3 scripts/officialMirrorAcceptance.py build --run-dir "$OM06_RUN_DIR"
python3 scripts/officialMirrorAcceptance.py start --run-dir "$OM06_RUN_DIR"
python3 scripts/officialMirrorAcceptance.py browser --run-dir "$OM06_RUN_DIR"
python3 scripts/officialMirrorAcceptance.py contrast --run-dir "$OM06_RUN_DIR"
python3 scripts/officialMirrorAcceptance.py http --run-dir "$OM06_RUN_DIR"
python3 scripts/officialMirrorAcceptance.py stop-app --run-dir "$OM06_RUN_DIR"
python3 scripts/officialMirrorAcceptance.py start --run-dir "$OM06_RUN_DIR"
python3 scripts/officialMirrorAcceptance.py recover --run-dir "$OM06_RUN_DIR"
python3 scripts/officialMirrorAcceptance.py typecheck --run-dir "$OM06_RUN_DIR"
python3 scripts/officialMirrorAcceptance.py verify-source --run-dir "$OM06_RUN_DIR"
python3 scripts/officialMirrorAcceptance.py stop --run-dir "$OM06_RUN_DIR"
python3 scripts/officialMirrorAcceptance.py clean-source --run-dir "$OM06_RUN_DIR"
```

`http` 留下受控失败的清理待办，停止并重启应用后由 `recover` 验证持久恢复；不能省去重启再声称已验证进程恢复。`verify-source` 核对应用副本与待测提交并记录构建标识；测试结果、命令退出码、日志和截图须一并核对。集成子集可用 `--suite a-migration|a-reference|c-grant|d-merge|b-reopen` 选择，不把未运行的组记为通过。

运行的写入阶段会复核本次容器的固定 ID、标签和回环端口；浏览器、HTTP 与恢复还核对进程启动身份、工作目录、监听归属和服务标记。旧运行目录不能接续占据相同端口的新容器，身份不符时应保留记录并排查，不能改状态文件绕过。

运行结束或中断后，只清理本次入口创建的进程和容器。`stop` 只发送正常终止信号，并在有界等待内确认进程组退出后清空身份；无法确认时非零退出、保留记录，不升级信号或停止未知进程。确认停止后再执行 `clean-source`，移除源码与构建副本，保留证据；未清理副本可能使根目录测试再次发现副本中的用例，不得把重复执行算作新增覆盖。

[入口保护检查](../../scripts/officialMirrorAcceptanceChecks.py)可用 `python3 scripts/officialMirrorAcceptanceChecks.py` 单独运行；要求 3100 和 36741 空闲，使用自建受控进程与 CLI 替身，不连接真实 Docker 或数据库。它验证身份拒绝和停止语义，不能替代业务整链验收。真实提供方与手机软键盘需另行核实，受控服务和浏览器高度模拟不证明它们已经通过。

## 私聊事务与恢复资格验收

使用 Node.js 24.22.1、已安装依赖、Docker 和 PostgreSQL 16 镜像，运行独立入口：

```bash
OTOAME_PRIVATE_CHAT_ACCEPTANCE=1 node scripts/privateChatTransactions.mjs
```

[私聊验收入口](../../scripts/privateChatTransactions.mjs)新建带独占标签、随机密码和回环随机端口的一次性 PostgreSQL，核对容器编号、标签与数据库身份后安装当前结构，再运行[实际业务事务测试](../../tests/integration/private-chat-transactions.test.ts)。它显式提供测试数据库地址并禁用默认配置读取，模拟外部存储与 Redis；普通 `pnpm test` 没有专用测试数据库变量时跳过这一组。

用例通过实际会话锁交错发送、范围确认与隐藏，检查重复确认、计数为零但历史仍未读、事务回滚、对方与其他会话隔离，以及编号空隙、逆序时间、超过 80 条积压、中间批失败重试和并发发送。恢复资格用例从入口固定的已审提交提取控制模块，仅写入本次一次性库，通过实际私聊业务事务验证冻结、验收写入与 `private-chat-v1` 兼容判断。其候选文件是合成样本，实际生产制品与运行时故障仍需在发布验收中单独验证。

入口结束时核对标签并停止自动移除的自建容器，同时清理临时控制模块；清理失败以非零退出报告。输出和退出码是本次运行结果，不能用脚本存在替代通过证据。真实浏览器需另用专属 profile 验证实际五分钟前台等待、历史媒体和引用变更、迟到响应、网络错误及手机和桌面；原生隐藏恢复使用可信可见性事件，不能覆盖 getter 或缩短时钟代替。

## 其他端到端脚本

[编辑上传守卫](../../tests/e2e/edit-upload-guards.e2e.ts)、[投稿流转](../../tests/e2e/patch-submission-lifecycle.e2e.ts)、[投稿界面](../../tests/e2e/submission-ui.e2e.ts)和[资料设置](../../tests/e2e/user-profile-settings.e2e.ts)会真实创建、修改或删除记录。先按脚本头部准备测试身份、服务地址与受控设施，确认正在运行的 3100 服务实际使用一次性测试库；资料设置还要求非默认端口的独立 Redis，并核对费用明细与清理本次账号。服务缺失、身份不明或数据库不符时停止，不能用默认配置兜底。

工作台[整链验收](../../tests/e2e/workspace-maintenance.e2e.ts)要求非默认本机数据库和 Redis、受控检测服务与对象存储替身，不加载真实环境配置。[迁移验收](../../tests/e2e/workspace-maintenance-migration.e2e.ts)只需一个尚未执行维护迁移的一次性 PostgreSQL：地址为 `127.0.0.1`、端口不是 5432、库名以 `_e2e` 结尾，并用 `KUN_E2E_ARTIFACT_DIR` 指定结果目录。迁移检查包含上线后真实维护记录保护，不能只验空库。

工作台整链验收还需显式提供 `KUN_E2E_SOURCE_SHA`，填写本次整合源码的完整提交号，并核对隔离副本与该提交一致；结果记录中的提交号不能代替这项核对。它调用[工作台浏览器扩展](../../tests/e2e/workspace-alignment.browser.ts)，检查资源分类与编辑、投稿操作、个人入口，以及四个视口的深浅色布局。正常操作通过真实接口执行，网络失败与迟到响应使用受控拦截；脚本和截图存在不代表本次验收已经通过，须检查各组实际结果。

[求助区验收](../../tests/e2e/help-board.e2e.ts)会真实创建帖子、回答、回复、举报事项和萌萌点账目，结束时清理本次创建的用户、帖子、事项与游戏。前提是一个已执行求助区迁移的一次性 `_e2e` 库、非默认端口的独立 Redis，以及唯一一个按待测提交生产构建、连接这两者的服务；用 `KUN_E2E_BASE_URL` 指定该服务的本机地址，`KUN_DATABASE_URL` 不能指向同一个库，否则目标检查会拒绝运行。脚本用 `pnpm exec esno tests/e2e/help-board.e2e.ts` 运行，覆盖发帖与关联、费用与采纳奖励的并发、删帖与新回答的竞争、举报隐藏与站方结论，以及桌面和 390px 的浏览器全流程。

[资源卡手机检查](../../tests/e2e/resource-card-mobile.e2e.ts)是单独的只读布局检查，默认读取正在运行的 3000 站点并拦截下载获取和恢复，不写授权或消耗额度。按[直接运行 TypeScript 的版本前提](#准备会社身份一次性验收)使用 Node.js 24.22.1，先用 `KUN_E2E_BASE_URL` 和 `KUN_E2E_RESOURCE_CARD_PATH` 指向本次允许读取的页面，再执行：

```bash
node tests/e2e/resource-card-mobile.e2e.ts
```

这些脚本未形成统一浏览器测试流水线。自动化缺少的真实存储、平台命中或交互结果，作为未验证事项报告，不用组件通过或历史截图替代。

## 源码入口

- [测试配置](../../vitest.config.ts)、[单元测试](../../tests/unit/)、[集成测试](../../tests/integration/)与[端到端脚本](../../tests/e2e/)
- [安全数据库准备器](../../scripts/e2eDatabasePreparation.ts)、[会社隔离启动器](../../scripts/e2eCompanyIdentityServer.ts)与[文档检查器](../../scripts/checkDocs.ts)
