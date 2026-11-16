# 并行 worktree 开发

本指南用于在 Orca 中为多个功能准备独立开发环境。每个 worktree 使用自己的数据库、数据库账号、Redis、应用端口、登录秘密和 S3 路径前缀；同一主仓库的 worktree 共用一个专门的 PostgreSQL 容器。管理器只操作自己创建并登记的资源，个人开发库和生产环境不属于初始化对象。

## 本机准备

按[开发指南](development.md)安装 Node.js 24.22.1、pnpm 和 Git，并启动 Docker Desktop 或本机 Docker。准备官方镜像，初始化过程中不会自动下载镜像：

```bash
docker pull postgres:16
docker pull redis:7
```

当前入口支持 macOS 和 Linux；Windows 使用 WSL。管理器只接受本机 Unix socket Docker 端点，拒绝 SSH 或 TCP context，并将后续操作固定到核对过的端点。所有应用和容器端口仅绑定 `127.0.0.1`。PostgreSQL、Redis 的宿主机端口由 Docker 分配，应用端口从 3300 至 49999 分配并登记在主仓库中，同一主仓库的并行初始化会等待共享登记锁。

在 Orca 注册的主仓库目录中准备 `.env.worktree.local`。已有该文件时保留并核对；尚未创建时从[开发配置模板](../../.env.worktree.example)复制：

```bash
cp .env.worktree.example .env.worktree.local
```

由操作者在本机填写开发邮件、对象存储、图床和需要使用的外部接口配置。S3 的两个公开地址填写不含环境前缀的根地址，见[S3 配置说明](deployment.md#s3-路径前缀)。模板中的占位服务不可用于真实上传或邮件验证；邮件同时存在 SMTP 和 HTTP 调用，单一 SMTP 收件箱不能覆盖全部邮件流程。

管理器只继承模板中列出的开发服务配置。数据库、Redis、JWT secret、站点地址和 S3 前缀始终重新生成；定时任务、Cloudflare 清理、搜索通知、链接检测和会社身份解析默认关闭。每个应用进程的连接池上限为 5，共享实例的总连接数仍需按同时运行的服务核算。

## 接入 Orca

仓库的 [orca.yaml](../../orca.yaml) 定义 setup 和 archive 命令，并让 agent 等待 setup 成功。创建新 worktree 的基准提交必须包含 setup 配置和管理脚本；当前目录中尚未提交的文件不会自动进入新 worktree。archive 配置及销毁脚本从 Orca 注册的主仓库读取，在待删除的 worktree 中执行，因此旧分支也能使用主仓库的清理能力。

创建时核对所选基准分支。本地 `main` 的提交尚未推送时，`origin/main` 仍可能停在不含 setup 的旧版本；从它创建的 worktree 也会缺少脚本。使用本机最新代码时选择本地 `main`；使用 `origin/main` 时，先确认所需提交已推送且本机远程跟踪分支已更新。受 Git 跟踪的脚本随基准提交检出，不通过 `.worktreeinclude` 复制。

在 `Settings → Repository → Hooks` 为本项目选择 `Command source & orca.yaml → orca.yaml only`，并保留 setup 默认执行。已有本地 setup 脚本时尤其需要检查命令来源，否则可能继续执行原来的安装命令。首次验证成功后再启动功能 agent。

[.worktreeinclude](../../.worktreeinclude) 复制 `.env.worktree.local`，并在本机存在时复制 `.local/production-operations.md`。这些本地文件继续由 Git 忽略，复制规则只提交路径。不要将 `.env`、`.worktree`、`node_modules` 或 `.next` 加入复制或共享路径。各 worktree 独立安装依赖并生成 Prisma 客户端，pnpm 自行复用包存储。配置和状态目录使用普通文件与目录，管理器拒绝通过符号链接读写它们。

在项目对应的 Orca 终端，以本地 `main` 创建独立任务：

```bash
orca worktree create --name feature-example --base-branch main --no-parent --setup run --activate --json
```

setup 在新 worktree 中执行，也可以在该 worktree 中手动重试：

```bash
pnpm worktree:setup
pnpm worktree:status
```

主仓库本身会被拒绝初始化。setup 会创建或核对专用容器，准备仅能访问自身数据库的账号，安装当前分支依赖，并在新空库中安装 Prisma 结构、条目计数触发器及标签和会社计数触发器。最后生成合成账号和一个示例条目。它不会批量执行生产迁移；涉及手写约束、特殊索引或迁移恢复的任务，仍需按[运维指南](operations.md)和[隔离验收要求](testing.md)准备对应结构。

新库包含 `wt_admin`、`wt_author`、`wt_user` 三个合成账号，分别为超级管理员、创作者和普通用户；每个账号有 1000 点开发余额及对应初始账目。新环境的三个账号统一使用开发密码 `test1234`，数据库保存其密码哈希；数据库、Redis 和 JWT 凭据仍分别随机生成。这些账号仅用于本机隔离开发环境。

重复 setup 不修改已初始化账号的密码。已有环境保留其原密码，最初生成的登录密码记录在本机 `.worktree/secrets.json` 的 `loginPassword` 字段；手动改过账号密码后，以该账号的实际密码为准。

## 启动和停止

setup 不自动启动开发服务器。需要浏览器验证的 worktree 再运行：

```bash
pnpm worktree:dev
```

以 `worktree:status` 显示的地址访问站点。启动器使用登记端口，并将完整的开发环境传给 Next.js；不要在受管 worktree 中同时运行普通 `pnpm dev`。同一工作区的开发服务器与构建仍须错开，避免共用 `.next` 产物。

不同端口仍可能共享同一主机的 Cookie。并行验证多个账号或登录流程时，为各 worktree 使用独立浏览器 profile。

暂时停用环境时，在另一终端运行：

```bash
pnpm worktree:stop
```

它通过本 worktree 启动器确认身份并请求正常结束应用，再停止自己的 Redis。共享 PostgreSQL、数据库和数据卷保留；不猜测或强杀其他进程。停止超时或身份不符时会失败，应在原启动终端核对，不将失败当作已停止。

## 销毁环境与删除 worktree

确认该 worktree 的开发数据可以丢弃后，通过 Orca 的 archive hook 清理资源，再删除目录。仓库配置的 hook 调用主仓库中的销毁脚本，不依赖待删除分支是否包含该脚本，也不需要该分支安装依赖。Hooks 的命令来源应允许执行 `orca.yaml`，本指南使用 `orca.yaml only`。

CLI 删除必须显式启用钩子，将路径替换为待删除 worktree 的绝对路径：

```bash
orca worktree rm --worktree path:/absolute/path/to/worktree --run-hooks --json
```

销毁会核对本地状态、容器 ID 与标签、数据卷标签、数据库所有者和账号标记，正常结束本 worktree 的受管开发进程，删除其 Redis 容器及数据卷、独立数据库与账号，最后释放共享端口登记。共享 PostgreSQL 容器及数据卷、其他 worktree 的资源和 S3 对象保留。共享 PostgreSQL 已停止时，清理会核对身份并启动它以删除目标数据库。

只销毁开发环境、保留源码目录时，在该 worktree 中运行：

```bash
pnpm worktree:destroy
```

旧分支没有该命令时，由主仓库终端进入目标 worktree，再用主仓库脚本的绝对路径执行 `node /absolute/path/to/primary/scripts/worktree.mjs destroy`。销毁后保留本地完成记录，重复销毁安全跳过已完成资源；该目录不能重新 setup 或启动。需要新环境时删除旧 worktree 后重新创建，不能删改身份记录绕过保护。

从未初始化且没有资源登记的 worktree 会直接跳过清理。资源身份不符、登记丢失、未知进程占用端口或 Docker 不可用时，hook 非零退出并阻止 Orca 删除。已删除的资源不会恢复，状态和端口登记保留以便核对后重试；不要通过 `--allow-failed-archive-hook` 跳过失败，或提前删除 `.worktree/`。如果清理已经成功，而后续 Git 工作区检查等步骤阻止删除，开发资源也已销毁；保留改动并解决 Git 删除条件后再重试。

直接删除目录、使用原生 `git worktree remove`，或 CLI 删除时省略 `--run-hooks`，都会绕过此清理。Orca 中也应保留 archive hook 的执行，不把工作区休眠当作销毁。

## 重复执行和失败处理

再次 setup 会复用原数据库、账号、密码、端口和 S3 前缀，恢复自己的已停止容器，并重新安装依赖。已就绪数据库不会重置、重新填充开发数据或自动同步新的模型变更；已有数据的结构调整仍按当前任务单独执行迁移。

`.worktree/state.json` 保存 worktree 与资源身份；主仓库的 `.worktree/manager` 保存共享容器身份和端口登记；秘密保存在权限受限的本地文件中。它们共同决定资源归属，不要复制给另一个 worktree，也不要通过改写状态文件接管同名资源。状态或凭据丢失后，管理器不会自动重置账号、重建已登记数据库或采用来源不明的容器。

| 现象 | 处理方式 |
| --- | --- |
| 缺少 `orca.yaml`、`scripts/worktree.mjs` 或 `worktree:setup` 命令 | 核对 worktree 的基准版本。妥善保存已有改动后，按正常分支合并流程引入包含 setup 的提交；可以快进到本地 `main` 时运行 `git merge --ff-only main`，再手动执行 `pnpm worktree:setup`。更新文件不会自动补跑创建时的 hook。 |
| 缺少镜像或 Docker 无法连接 | 按本页准备镜像并核对 Docker 服务与权限，保留状态后重试。 |
| 当前目录已有未受管的 `.env` | 保存并移走原配置，核对 `.env` 未加入复制或共享路径，再执行 setup。 |
| 受管 `.env` 被手动修改 | 保存修改，将需要复用的服务设置移入本 worktree 的 `.env.worktree.local`，移走 `.env` 后重跑；管理器不会直接覆盖。 |
| 同名容器、卷、数据库或账号归属不符 | 停止，核对本次资源记录；不要删除陌生资源或修改身份标记绕过。 |
| 销毁中断或 archive hook 失败 | 保留 worktree 及 `.worktree/`，核对错误并修复前提后重新销毁或带 `--run-hooks` 删除；不要继续 setup 或跳过清理失败。 |
| 初始化结构或合成数据失败 | 本次数据库保留，修复失败前提后重跑；非空业务表会阻止未完成的初始化，不能接受数据库重置。 |
| 操作锁或开发进程记录遗留 | 核对锁目录中的 PID、原终端与登记端口。确认原进程退出后再处理遗留记录，不按 PID 猜测并发送强制终止信号。 |

迁移 worktree 目录、切换数据库前缀或清理遗留资源需要单独核对对象和身份。首次启用 S3 前缀不能代替已有对象及引用迁移，见[存储前缀的已有数据边界](deployment.md#s3-路径前缀)。

## 验证入口

常规检查使用本地服务替身：

```bash
pnpm test tests/unit/worktree-environment.test.ts tests/unit/prisma-index-lifecycle.test.ts
pnpm typecheck
```

已准备 Docker 镜像时，可显式运行一次性设施验收：

```bash
OTOAME_WORKTREE_ACCEPTANCE=1 pnpm test tests/integration/worktree-environment.test.ts
```

该验收在临时目录创建专用 PostgreSQL、两个 Redis、合成账号和条目，检查跨库访问拒绝、再次 setup 保留数据、启动器停止、销毁目标资源并保留相邻环境，以及重复销毁和共享实例停止后的清理。结束时核对身份后清理本次资源。它复用当前安装的项目依赖，跳过再次安装，使用受控 Node 服务验证进程控制；不验证真实 Next 页面、邮件、远程 S3 或生产部署。清理未完成时保留运行目录，先核对报告中的本次资源，再继续操作。

## 源码入口

- [管理命令](../../scripts/worktree.mjs)、[配置与身份规则](../../scripts/worktree/config.mjs)和[本地资源访问](../../scripts/worktree/runtime.mjs)
- [合成数据准备](../../scripts/worktreeSeed.ts)、[单元测试](../../tests/unit/worktree-environment.test.ts)和[一次性设施验收](../../tests/integration/worktree-environment.test.ts)
