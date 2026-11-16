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

仓库的 [orca.yaml](../../orca.yaml) 定义 setup 命令，并让 agent 等待 setup 成功。创建新 worktree 的基准提交必须包含该文件和管理脚本；当前目录中尚未提交的文件不会自动进入新 worktree。

在 `Settings → Repository → Hooks` 为本项目选择 `Command source & orca.yaml → orca.yaml only`，并保留 setup 默认执行。已有本地 setup 脚本时尤其需要检查命令来源，否则可能继续执行原来的安装命令。首次验证成功后再启动功能 agent。

[.worktreeinclude](../../.worktreeinclude) 只复制 `.env.worktree.local`；不要将 `.env`、`.worktree`、`node_modules` 或 `.next` 加入复制或共享路径。各 worktree 独立安装依赖并生成 Prisma 客户端，pnpm 自行复用包存储。配置和状态目录使用普通文件与目录，管理器拒绝通过符号链接读写它们。

在项目对应的 Orca 终端创建独立任务：

```bash
orca worktree create --name feature-example --no-parent --setup run --activate --json
```

setup 在新 worktree 中执行，也可以在该 worktree 中手动重试：

```bash
pnpm worktree:setup
pnpm worktree:status
```

主仓库本身会被拒绝初始化。setup 会创建或核对专用容器，准备仅能访问自身数据库的账号，安装当前分支依赖，并在新空库中安装 Prisma 结构、条目计数触发器及标签和会社计数触发器。最后生成合成账号和一个示例条目。它不会批量执行生产迁移；涉及手写约束、特殊索引或迁移恢复的任务，仍需按[运维指南](operations.md)和[隔离验收要求](testing.md)准备对应结构。

新库包含 `wt_admin`、`wt_author`、`wt_user` 三个合成账号，分别为超级管理员、创作者和普通用户；每个账号有 1000 点开发余额及对应初始账目。账号使用本 worktree 随机生成的同一开发密码，由操作者在本机的 `.worktree/secrets.json` 查看 `loginPassword`。这不是共享服务或生产账号的凭据。

## 启动和停止

setup 不自动启动开发服务器。需要浏览器验证的 worktree 再运行：

```bash
pnpm worktree:dev
```

以 `worktree:status` 显示的地址访问站点。启动器使用登记端口，并将完整的开发环境传给 Next.js；不要在受管 worktree 中同时运行普通 `pnpm dev`。同一工作区的开发服务器与构建仍须错开，避免共用 `.next` 产物。

不同端口仍可能共享同一主机的 Cookie。并行验证多个账号或登录流程时，为各 worktree 使用独立浏览器 profile。

在另一终端、归档或移除该 worktree 之前运行：

```bash
pnpm worktree:stop
```

它通过本 worktree 启动器确认身份并请求正常结束应用，再停止自己的 Redis。共享 PostgreSQL、数据库和数据卷保留；不猜测或强杀其他进程。停止超时或身份不符时会失败，应在原启动终端核对，不将失败当作已停止。当前没有自动删除数据库或数据卷的归档钩子。

## 重复执行和失败处理

再次 setup 会复用原数据库、账号、密码、端口和 S3 前缀，恢复自己的已停止容器，并重新安装依赖。已就绪数据库不会重置、重新填充开发数据或自动同步新的模型变更；已有数据的结构调整仍按当前任务单独执行迁移。

`.worktree/state.json` 保存 worktree 与资源身份；主仓库的 `.worktree/manager` 保存共享容器身份和端口登记；秘密保存在权限受限的本地文件中。它们共同决定资源归属，不要复制给另一个 worktree，也不要通过改写状态文件接管同名资源。状态或凭据丢失后，管理器不会自动重置账号、重建已登记数据库或采用来源不明的容器。

| 现象 | 处理方式 |
| --- | --- |
| 缺少镜像或 Docker 无法连接 | 按本页准备镜像并核对 Docker 服务与权限，保留状态后重试。 |
| 当前目录已有未受管的 `.env` | 保存并移走原配置，核对复制规则只包含 `.env.worktree.local`，再执行 setup。 |
| 受管 `.env` 被手动修改 | 保存修改，将需要复用的服务设置移入本 worktree 的 `.env.worktree.local`，移走 `.env` 后重跑；管理器不会直接覆盖。 |
| 同名容器、卷、数据库或账号归属不符 | 停止，核对本次资源记录；不要删除陌生资源或修改身份标记绕过。 |
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

该验收在临时目录创建专用 PostgreSQL、两个 Redis、合成账号和条目，检查跨库访问拒绝、再次 setup 保留数据和启动器的停止行为，并在核对身份后清理本次资源。它复用当前安装的项目依赖，跳过再次安装，使用受控 Node 服务验证进程控制；不验证真实 Next 页面、邮件、远程 S3 或生产部署。清理未完成时保留运行目录，先核对报告中的本次资源，再继续操作。

## 源码入口

- [管理命令](../../scripts/worktree.mjs)、[配置与身份规则](../../scripts/worktree/config.mjs)和[本地资源访问](../../scripts/worktree/runtime.mjs)
- [合成数据准备](../../scripts/worktreeSeed.ts)、[单元测试](../../tests/unit/worktree-environment.test.ts)和[一次性设施验收](../../tests/integration/worktree-environment.test.ts)
