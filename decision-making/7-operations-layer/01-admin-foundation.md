# 模块 01：后台地基与统一收件箱（设计草稿）

状态：草稿，待站长审阅。基线：`decision-making/7.operations-layer-redesign.md` 第 7.1、7.2、7.3、2.2 节。计划：`decision-making/8.operations-layer-rollout-plan.md` 阶段 1，先做本模块再做模块 02。本文的事实部分来自 2026-09-06 对仓库的两次只读调查，引用处均给出文件路径。

---

## 1. 目标与对应基线章节

| 目标 | 基线 |
|---|---|
| 新后台建在独立的路由组与根布局下，样式入口独立，只用 shadcn，不加载 HeroUI | 7.2 |
| 统一收件箱：待审条目、待审资源、旧反馈、旧举报、创作者申请进同一列表，左列表右详情，一键动作，键盘导航，今日已处理计数 | 7.1 |
| 前台预览：投稿审核时能看到发布后在前台的真实样式 | 7.3 |
| 后台门槛统一到管理员级，破坏性操作保留超级管理员 | 2.2 |
| 旧后台 `/admin` 保留，页面逐个迁移，全部迁完后重定向 | 计划 5 节阶段 1 |

本模块不引入任何新表、新字段与定时任务。它是后续模块 03、04、06、08、09 站方侧界面的载体。

## 2. 偏离基线的地方与理由

| 偏离 | 基线原文 | 本文做法 | 理由 |
|---|---|---|---|
| 破坏性动作保留一次确认 | 7.1「每个动作一个键，不弹二次确认，改为可撤销」 | 通过、模板回复、标记已处理为一键无确认；拒绝资源申请、举报处理中的「删除内容」、投稿判违规这三类保留一次确认 | 现有服务不可逆：拒绝资源申请会物理删除资源行并删 S3 文件（`app/api/admin/resource-apply/service.ts` 第 88 行起）；举报「删除」会 `deleteMany` 评论或评价；判违规会清空投稿正文。把它们改成可撤销需要重写服务，属于模块 03、06 的范围。本模块不改服务语义 |
| 三个根布局而不是两个 | 7.2 只提到前台与后台两个根布局；7.3 说「在前台根布局下新增预览路由」 | 前台 `(site)`、后台 `(console)`、预览 `(preview)` 三个根布局 | 前台根布局无条件渲染顶栏、面包屑、页脚与回到顶部（`app/layout.tsx`、`components/layout/RootRouteChrome.tsx`），iframe 里的预览不能带这些。预览根布局导入与前台完全相同的样式与 Provider，只是不渲染站点外壳，仍然满足 7.3「渲染前台真实样式」的意图 |
| 后台数据只走接口一条通道 | 基线未规定 | 后台页面不再用每页一个 `actions.ts` 的服务端动作做首屏取数，统一由客户端调 `/api/admin/*` | 现状每个列表页都是「服务端动作首屏 + 客户端翻页」双通道，鉴权与校验各做一遍（调查 A.1）。后台不需要 SEO 与首屏直出，单通道少一半重复代码，也少一处门槛不一致的来源 |

## 3. 术语补充

| 术语 | 定义 |
|---|---|
| 路由组 | Next App Router 中用括号命名的目录，如 `app/(site)`，不出现在 URL 里，只用于组织布局 |
| 根布局 | 直接渲染 `<html>` 与 `<body>` 的 `layout.tsx`。没有父布局的布局就是根布局。删掉顶层 `app/layout.tsx` 后，每个路由组各有一个根布局；跨根布局的导航是整页加载而不是客户端导航（Next 官方约束） |
| 控制台 | 新后台的名字，URL 前缀 `/console`，路由组 `app/(console)`，组件目录 `components/console`。与旧后台 `/admin` 并存直到迁移完成 |
| 旧后台 | 现有 `app/admin/*` 与 `components/admin/*`，HeroUI 实现，本模块只减不加 |
| 收件箱项 | 统一收件箱里的一行，由五种来源之一归一化而来，字段见 5.2 |
| 来源 | 收件箱项来自哪个队列：投稿、资源申请、反馈、举报、创作者申请 |
| 一键动作 | 选中一项后按一个键或点一个按钮即完成的处理，无确认对话框 |
| 破坏性动作 | 会删除用户内容、清空正文或不可逆结算的处理，保留一次确认 |
| 预览根布局 | 路由组 `app/(preview)`，只为 iframe 提供无外壳的前台真实渲染 |
| 接口单通道 | 控制台页面的全部数据读写都经 `/api/admin/*`，服务端组件只做鉴权与骨架 |

## 4. 数据模型

无新表，无新字段，无索引变更，无迁移脚本。

收件箱是只读聚合视图，直接读现有表：`patch_submission`（`status = 'pending'`）、`patch_resource`（`status = 2`）、`user_message`（`type = 'feedback'`，`status = 0`，`recipient_id IS NULL`）、`patch_report`（`status = 0`）、`user_message`（`type = 'apply'`，`status = 0`）。写入只复用现有处理服务，另在两处补写现有的 `admin_log` 表（见 5.4）。

## 5. 接口

### 5.1 路径与命名

控制台的 UI 路径是 `/console`，接口命名空间沿用 `/api/admin/*`，不新建 `/api/console`。理由：接口与界面库无关，URL 保持稳定；中间件对 `/api` 的 CSRF 校验与 `admin/stickers/import` 的排除项（`middleware.ts` 第 13 行）不需要改。

### 5.2 新增接口

**`GET /api/admin/inbox`**

- 门槛：`role >= 3`。
- 校验：新增 `adminInboxQuerySchema`（`validations/admin.ts`）：`kinds` 为来源枚举数组，默认全部；`limitPerKind` 1 到 200，默认 200。
- 实现：`app/api/admin/inbox/service.ts` 调用现有五个列表服务各取前 `limitPerKind` 条，归一化后合并排序。五个服务与现有入参：`listAdminPatchSubmissions`（`status: 'pending'`，`app/api/admin/patch-submission/service.ts`）、`getPatchResourceApply`（`app/api/admin/resource-apply/get.ts`，需传 NSFW 头）、`getFeedback`（`app/api/admin/feedback/service.ts`）、`getReport`（`app/api/admin/report/service.ts`，`tab: 'pending'`，`targetType` 两种各取一次）、`getAdminCreator`（`app/api/admin/creator/service.ts`）。
- 不分页。站点规模下五个队列的未处理总量在几十到低几百之间，一次取全比跨来源分页简单且不会漏项。某来源达到上限时响应里标 `truncated: true`，界面显示「该来源还有更多，先处理这些」。
- 归一化后的收件箱项：

| 字段 | 含义 |
|---|---|
| `kind` | `submission`、`resource`、`feedback`、`report`、`creator` |
| `id` | 来源表的主键 |
| `title` | 投稿名、资源名或所属游戏名、反馈首行、被举报内容首行、申请人名 |
| `subtitle` | 投稿人、发布者、反馈人、举报人等 |
| `actor` | `{ id, name, avatar }` |
| `created` | 来源行的创建时间，ISO 字符串 |
| `waitingSeconds` | 当前时间减 `created`，服务端算 |
| `targetHref` | 可跳转的前台对象地址，如 `/{unique_id}` |
| `badges` | 来源特有的短标签，如投稿的 VNDB 重复提示、举报的目标类型 |
| `payload` | 来源特有的详情数据，形状按 `kind` 区分，直接复用现有列表服务返回的行（`AdminSubmissionRow`、`AdminResource`、`Message`、`AdminReport`、`AdminCreator`） |

- 排序：默认按 `waitingSeconds` 降序；界面可切换按来源分组。
- 响应头 `Cache-Control: private, no-store`。

**`GET /api/admin/inbox/counts`**

- 门槛 `role >= 3`。返回五个来源的未处理计数与「今日已处理」计数。今日已处理按当前管理员当天写入的 `admin_log` 条数统计，见 5.4。侧栏与标题栏用它，每 60 秒轮询一次。

**`GET /api/admin/patch-submission/[id]`**

- 门槛由现有 `getAdminPatchSubmission(id, reviewerRole)` 判定（`role >= 3`）。返回现有的 `AdminPatchSubmissionDetail`，含 `preview`、`vndbDuplicates`、`companyDiagnostics`。现状这份数据只在服务端组件里生成（`app/admin/submission/[id]/page.tsx`），控制台走接口单通道需要它有一个接口。响应头 `private, no-store`。

### 5.3 复用的处理接口

控制台的一键动作直接调用现有接口，不改请求与响应契约：

| 动作 | 接口 | 现状门槛 | 本模块门槛 |
|---|---|---|---|
| 投稿：通过、驳回、要求修改、判违规 | `POST /api/admin/patch-submission/[action]` | 服务内 `>= 3`，自审需超级管理员显式 override | 不变 |
| 资源申请：通过、拒绝 | `PUT /api/admin/resource-apply/approve`、`.../decline` | `>= 3` | 不变 |
| 反馈：处理并回复 | `POST /api/admin/feedback/handle` | `>= 4` | `>= 3` |
| 举报：删除内容或驳回 | `POST /api/admin/report/handle` | `>= 4` | `>= 3` |
| 创作者申请：通过、拒绝 | `PUT /api/admin/creator/approve`、`.../decline` | `>= 4` | `>= 3` |
| 统计 | `GET /api/admin/stats`、`.../sum` | `>= 4` | `>= 3` |
| 反馈、举报、创作者列表 | `GET /api/admin/feedback`、`/report`、`/creator` | `>= 4` | `>= 3` |

错误契约不变：接口以 HTTP 200 返回中文字符串表示失败，控制台的请求层统一按 `typeof res === 'string'` 判错并以 toast 呈现；投稿审核的状态冲突返回 409（`PATCH_SUBMISSION_REVIEW_STATE_CHANGED_MESSAGE`），控制台收到后刷新该项。

### 5.4 门槛统一表

基线 2.2：后台各队列门槛统一到管理员级（`role >= 3`），破坏性操作（封禁、删条目、站点设置、群发邮件）保留超级管理员（`role >= 4`）。调查 A、B 发现的不一致与本模块的处理：

| 位置 | 现状 | 本模块 |
|---|---|---|
| `app/api/admin/feedback/*`、`report/*`、`creator/*`、`log/*`、`stats/*` | `< 4` 拒绝 | 改为 `< 3` 拒绝 |
| `app/admin/report/actions.ts` 与 `rating-report/actions.ts` | 同一个 `getReport`，前者 `< 4`、后者 `< 3` | 旧后台页面不动，随旧后台退役消失；控制台只走接口 |
| `app/api/admin/comment/route.ts`（`< 4`）与 `comment/full/route.ts`（`< 3`） | 不一致 | 本模块不迁移评论管理，不动；迁移时统一为 `< 3` |
| `app/api/admin/resource/route.ts`（`< 3`）与 `app/admin/resource/actions.ts`（`< 4`） | 不一致 | 本模块不迁移，不动；模块 06 迁移时以接口为准 |
| `POST /api/admin/user`（发放萌萌点，`< 3`）与同文件其他方法（`< 4`） | 不一致 | 本模块不迁移用户管理，不动；待定：迁移时用户管理是否整体归超级管理员，含发放萌萌点（第 12 节第 4 项） |
| `app/api/admin/setting/*`、`mail/*`、`user/*` 的封禁与删除 | `< 4` | 保持超级管理员 |

错误文案「本页面仅超级管理员可访问」在改为管理员级的路由里同步改为「权限不足」。

### 5.5 审计日志补写

`handleFeedback`（`app/api/admin/feedback/service.ts` 第 51 行起）与 `handleReport`（`app/api/admin/report/service.ts` 第 149 行起）现状不写 `admin_log`（调查 B.2）。本模块在两者的事务内各补一条 `admin_log.create`，`type` 分别为 `feedback_handle` 与 `report_handle`，内容含处理人、目标 ID、结论与回复摘要（截断到 200 字）。用途：今日已处理计数的数据来源；模块 09 的处理量指标；补齐审计。这是本模块唯一改动现有服务行为的地方，且只增不改。

### 5.6 中间件与爬虫

- `middleware.ts` 的 matcher 增加 `'/console/:path*'` 与 `'/preview/:path*'`。
- `middleware/auth.ts` 的 `protectedPaths` 增加 `'/console'` 与 `'/preview'`。该数组用字符串前缀匹配（`startsWith`），实施时确认没有其他公开路径以这两个前缀开头。
- 中间件只判登录不判角色（调查 D.2），角色门槛在控制台的段布局里做，见 6.2。
- `app/robots.ts` 的 `DISALLOW_PATHS` 增加 `/console` 与 `/preview`。
- `next.config.ts` 新增 `headers()`，对 `/preview/:path*` 返回 `Content-Security-Policy: frame-ancestors 'self'`，只允许同源页面嵌入。现状该配置没有 `headers()`（调查 E.1）。

## 6. 界面

### 6.1 目录与路由组重排

现状：只有一个根布局 `app/layout.tsx`，全部 25 个顶层路由段、`app/page.tsx`、`app/error.tsx` 都嵌在它下面；`app/robots.ts` 是根级元数据路由；仓库里没有 `not-found.tsx`、`global-error.tsx`、`loading.tsx`（调查 F）。

重排后：

```
app/
  robots.ts                      不动，根级元数据路由
  api/                           不动，路由处理器不需要布局
  (site)/
    layout.tsx                   原 app/layout.tsx 原样移入
    providers.tsx  metadata.ts  actions.ts   随布局移入，相对导入不变
    page.tsx                     原首页；官方约束首页必须在某个路由组内
    error.tsx                    原 app/error.tsx 移入
    not-found.tsx                新增，见 6.6
    [id]/ admin/ apply/ ... user/   其余 24 个段整体移入
  (console)/
    layout.tsx                   第二根布局：html、body、控制台样式入口、Provider
    error.tsx                    控制台错误边界，shadcn 实现
    console/
      layout.tsx                 鉴权与外壳：校验登录、role >= 3，否则 redirect('/')
      page.tsx                   统一收件箱
      stats/page.tsx             统计（迁移自 /admin）
  (preview)/
    layout.tsx                   第三根布局：与 (site) 相同的样式与 Provider，无站点外壳
    preview/
      submission/[id]/page.tsx   投稿预览
```

`app/__codex` 与 `app/dev` 是空目录，git 不跟踪，不需要处理。`components/admin/*` 不动；新组件在 `components/console/*`，shadcn 基础件在 `components/console/ui/*`，`cn` 等工具在 `lib/console/utils.ts`。

### 6.2 三个根布局各自包含什么

| 内容 | `(site)` | `(console)` | `(preview)` |
|---|---|---|---|
| 样式入口 | `styles/index.css` | `styles/console.css` | `styles/index.css` |
| `HeroUIProvider`、HeroUI `ToastProvider` | 是 | 否 | 是 |
| `next-themes` `ThemeProvider`（`attribute="class"`） | 是 | 是，同一个默认存储键，深浅色偏好前后台共享 | 是 |
| `AppProgressProvider`（`@bprogress/next`） | 是 | 是，与库无关，让现有 `useRouter` 用法一致 | 否 |
| `react-hot-toast` 的 `KunToaster` | 是 | 是，`components/kun/Toaster.tsx` 不依赖 HeroUI，可直接复用 | 否 |
| `SiteThemeScript`、`SiteThemeRouteSync`、`data-kun-theme` | 是 | 否。控制台不参与站点主题，`themes.css` 的规则不会命中它 | 是，预览要与前台同色 |
| `MessageRealtimeSync` | 是 | 否，控制台不需要轮询未读消息 | 否 |
| 顶栏、面包屑、页脚、回到顶部 | 是 | 否，控制台自带侧栏与标题栏 | 否 |
| 分析脚本 | 是 | 否 | 否 |
| `viewport` 导出 | `kunViewport` | 自带，含 `width=device-width`；现状后台继承根布局的 `userScalable: false`，控制台改为允许缩放 | 同 `(site)` |
| `metadata` | 现有 | `title: '控制台'`，`robots: noindex` | `robots: noindex` |
| 字体 | `index.css` 的全局 `!important` 系统字体栈 | `console.css` 里对 `body` 声明同一系统字体栈，不用 `!important` | 同 `(site)` |

`(preview)` 与 `(site)` 的差别只有外壳与分析脚本，其余通过共享同一个 `providers.tsx` 实现，不复制代码。

### 6.3 控制台样式入口 `styles/console.css`

按 shadcn 当前 Tailwind v4 手动安装文档生成，要点：

- `@import 'tailwindcss' source(none)`，然后显式 `@source '../app/(console)'` 与 `@source '../components/console'`。现状 `styles/tailwind.css` 没有任何扫描边界（调查 J.2），若不限定，控制台样式表会把前台所有 HeroUI 类一并编译进来。
- `@custom-variant dark (&:is(.dark *))`，与前台一致。
- shadcn 的 `@theme inline` 令牌块、`:root` 与 `.dark` 变量、`@layer base`。令牌名（`background`、`primary` 等）与 HeroUI 重名，但两份样式表各自编译，互不可见，这正是隔离的目的。
- 同时在 `styles/tailwind.css` 增加 `@source not '../app/(console)'` 与 `@source not '../components/console'`，避免前台样式表编译控制台的类。
- `prose.css`、`editor.css`、`blog.css` 全部依赖 HeroUI 工具类（调查 J.5 至 J.7），不进控制台；调查确认 `components/admin` 与 `app/admin` 对 prose、milkdown、MDX 零引用（J.8），控制台不需要它们。

`components.json`：`tailwind.config` 留空（v4），`tailwind.css: "styles/console.css"`，`cssVariables: true`，`aliases.ui: "~/components/console/ui"`，`aliases.components: "~/components/console"`，`aliases.utils: "~/lib/console/utils"`，`aliases.lib: "~/lib/console"`，`aliases.hooks: "~/hooks/console"`，`iconLibrary: "lucide"`，`rsc: true`，`tsx: true`。路径别名 `~` 来自 `tsconfig.json` 的 `paths`。新增依赖：`tw-animate-css`、`class-variance-authority`，以及 CLI 按组件引入的 `@radix-ui/*`。不引入 sonner，toast 沿用 `react-hot-toast`。

### 6.4 控制台外壳

- 侧栏：收件箱（带未处理总数）、按来源筛选（各带计数）、统计、「旧后台」分组（链接到尚未迁移的 `/admin/*` 页面，标注「旧」）、「前台」链接、深浅色切换、当前账号与退出。桌面固定，移动端抽屉。
- 标题栏：搜索框、刷新、今日已处理计数、键盘帮助。
- 主区：左列表右详情，桌面用可拖分栏，移动端单列切换。URL 携带状态：`/console?kind=submission&item=123`，可深链、可刷新。
- 错误边界 `(console)/error.tsx` 用 shadcn 组件与 `react-hot-toast`，不依赖 HeroUI。
- 顶栏「管理后台」入口（`constants/top-bar.ts` 的 `kunAdminNavItem`）与 `components/user/SelfButton.tsx` 的 `router.push('/admin')` 改指 `/console`。跨根布局导航是整页加载，`router.push` 仍可用。`components/kun/top-bar/TopBar.tsx` 里对 `/admin/` 的高亮特判随旧后台退役删除，本模块不动。

### 6.5 统一收件箱

**列表。** 每行显示来源图标、标题、副标题、等待时长、徽标。默认按等待时长降序，可切换按来源分组。筛选状态进 URL。

**详情面板。** 按来源渲染：

| 来源 | 详情内容 | 动作 |
|---|---|---|
| 投稿 | 调 `GET /api/admin/patch-submission/[id]`：基本字段、押金与角色、VNDB 重复列表、会社身份诊断（原样搬运现状展示逻辑，见 6.7）、前台预览 iframe | 通过（一键）、要求修改（需理由）、驳回（需理由）、判违规（需理由，破坏性，确认）。自审时按现状规则显示超级管理员 override 开关 |
| 资源申请 | 列表返回的完整资源行：名称、分区、类型、语言、平台、备注、全部链接与提取码、发布者与其资源数 | 通过（一键）、拒绝（需理由，破坏性，确认）、「编辑后通过」链接到旧后台 `/admin/resource-apply`（资源编辑表单是前台的 HeroUI 组件，模块 06 重做前不复刻） |
| 反馈 | 消息全文、反馈人、关联条目链接 | 模板回复并标记已处理（一键，模板见下）、自定义回复 |
| 举报 | 举报理由、被举报内容全文、被举报人、所属条目 | 驳回（一键）、删除内容（破坏性，确认）；两者都可附回复 |
| 创作者申请 | 申请内容、申请人、其已发布资源数 | 通过（一键）、拒绝（需理由） |

**键盘。** `j`、`k` 上下选择；`Enter` 打开详情；`a` 通过或驳回举报（当前来源的正向动作）；`d` 拒绝或删除（破坏性，进入确认）；`r` 打开回复；`/` 聚焦搜索；`?` 显示帮助。自写一个小型快捷键 hook，不引入新依赖。

**模板。** `constants/console/replyTemplates.ts`，首批四条来自基线 3.7：已修复、需要截图、请参考指南、不在受理范围。模块 03 的工单系统上线后由工单模板替代。

**处理后。** 动作成功即从列表移除该项并选中下一项，`counts` 立即刷新；失败以 toast 显示接口返回的中文字符串；409 时刷新该项。

### 6.6 未匹配路由与错误

- `notFound()` 全仓库只在 `app/[id]/page.tsx` 调用一处，且没有自定义 404 页（调查 F.2）。删掉顶层布局后，未匹配 URL 的兜底页需要一个根布局来渲染。做法分两步：先在 `(site)` 内新增 `not-found.tsx`，处理站点内的 `notFound()` 与站点段内未匹配路径；实施时在开发环境验证「完全未匹配的顶层路径」由哪个根布局承接。若 Next 15.5.18 无法正确承接，启用 `experimental.globalNotFound` 并新增 `app/global-not-found.tsx`（自带 `<html>`、`<body>`，导入 `styles/index.css`），这是官方为多根布局提供的方案，15.4 起可用。是否启用实验特性列为待定（第 12 节第 6 项）。
- `app/error.tsx` 现状依赖 `KunToaster` 与 HeroUI（调查 F.1），移入 `(site)` 后行为不变。

### 6.7 前台预览

- 路由 `app/(preview)/preview/submission/[id]/page.tsx`：服务端组件，`verifyHeaderCookie()` 未登录 `redirect('/login')`，`canAccessAdmin(role)` 不满足 `redirect('/')`；调用现有 `getAdminPatchSubmission(id, role)` 取 `preview`，渲染 `components/submission/PatchSubmissionPreviewView`，传 `preview` 与 `createdAt`。预览链路里的介绍、画廊、灯箱、链接与视频挂载全是站点组件（调查 C），在预览根布局下原样可用。
- 控制台投稿详情里用 `<iframe src="/preview/submission/{id}">` 嵌入，同源，不加 `sandbox`；另给「在新标签打开」。深浅色通过共享的 `next-themes` 存储键保持一致。
- 会社身份诊断的展示（`components/admin/submission/AdminSubmissionDetail.tsx` 里的「本次发布结果」「阻断型歧义」「非阻断身份冲突」「候选快照未采用」四节及标签映射）在控制台用 shadcn 组件原样重写，逻辑与文案不变；有阻断型歧义时禁用「通过」，与现状一致。这是与会社线的接口约定（计划第 8 节），会社线落地后由会社线调整。

### 6.8 涉及的现有文件

新增：`app/(console)/**`、`app/(preview)/**`、`app/(site)/not-found.tsx`、`components/console/**`、`lib/console/utils.ts`、`hooks/console/**`、`styles/console.css`、`components.json`、`constants/console/replyTemplates.ts`、`app/api/admin/inbox/**`、`app/api/admin/patch-submission/[id]/route.ts`。

移动：`app/layout.tsx`、`providers.tsx`、`metadata.ts`、`actions.ts`、`page.tsx`、`error.tsx` 与 24 个顶层段进入 `app/(site)/`。

修改：`middleware.ts`、`middleware/auth.ts`、`app/robots.ts`、`next.config.ts`（`headers()`）、`styles/tailwind.css`（`@source not`）、`validations/admin.ts`（新 schema）、`constants/top-bar.ts`、`components/user/SelfButton.tsx`、五个门槛调整的路由文件、两个补写审计日志的服务文件、`tests/unit/root-layout.test.tsx`（导入路径）。

不动：`components/admin/**`、`app/(site)/admin/**`（移动后内容不变）、`scripts/postbuild.ts`、`scripts/deployPm2.ts`、`.github/workflows/release.yml`。样式与组件是编译产物，不在运行时资产复制清单内（调查 E.4、E.5）。

## 7. 定时任务

无。

## 8. 迁移与回填

- 无数据迁移。
- 路由重排用 `git mv` 一次完成，保证移动后的相对导入（`./providers`、`./metadata`、`./actions`）不变。
- 旧后台在本模块内保持完整可用，只有两处入口改指控制台。旧后台的退役在模块 09。
- 文档与技能同步单独提交（`docs(...)` 或 `chore(skills)`），不混入业务代码提交，遵守 `docs/project/development.md` 的提交约定。需要修订的文档：`skills/otoame-frontend/SKILL.md` 把「HeroUI v2 是强制设计系统」限定到前台路由组并新增控制台条款；`docs/modules/app-router.md` 增加三个根布局与控制台的描述；`docs/modules/frontend-content.md` 组件分层表增加 `components/console/*`；`docs/theme-color-system.md` 的 `rg` 扫描命令排除控制台目录；`docs/project/development.md` 的样式清单加入 `styles/console.css`。

## 9. 测试点

- 接口：`GET /api/admin/inbox` 与 `/counts` 的鉴权（未登录、`role 2`、`role 3`）、来源筛选、`truncated` 标记、排序；`GET /api/admin/patch-submission/[id]` 的鉴权；五个门槛调整路由的新旧行为对比；`handleFeedback` 与 `handleReport` 写入 `admin_log`。沿用现有模式：`vi.mock('~/middleware/_verifyHeaderCookie')` 与整份 mock 服务模块，用 `NextRequest` 调用路由（参照 `tests/unit/api/admin-stickers-route.test.ts`）。
- 聚合服务：mock 五个列表服务，验证归一化字段与排序。
- 中间件：`isProtectedRoute('/console/x')` 与 `('/preview/x')` 为真。
- 布局：`tests/unit/root-layout.test.tsx` 的导入路径改为 `~/app/(site)/layout`，断言不变。
- 控制台组件：现状组件测试是手写 JSDOM 加 `createRoot` 并逐个 mock HeroUI 组件（调查 D），对 Radix 门户不友好。本模块只对纯逻辑写单测：快捷键 hook、收件箱排序与筛选、URL 状态编解码；渲染层验证放在验收里手工完成。是否为控制台引入 `@testing-library/react` 列为待定（第 12 节第 7 项）。
- 全量：`styles/tailwind.css` 被修改，按 `skills/otoame-development/SKILL.md` 的规则跑全量 `pnpm test`；路由重排与 `next.config.ts` 变更要求 `pnpm build` 通过。

## 10. 验收标准

1. 站长一天的审核（投稿、资源申请、反馈、举报、创作者申请）只在 `/console` 一个页面完成，不需要打开旧后台，除「编辑后通过」资源申请这一种情况。
2. 键盘从选择到处理一项不需要鼠标。
3. `/console` 的样式表不含任何 HeroUI 类，前台样式表不含任何控制台类（构建产物检查）。
4. 投稿详情里的 iframe 显示与前台一致的样式，深浅色与控制台一致。
5. 5.4 门槛表全部生效，旧后台行为不变。
6. `pnpm typecheck`、`pnpm test`、`pnpm build` 通过；生产部署后前台首页、任一条目页、旧后台、控制台、预览页各打开一次正常。
7. 未匹配的顶层路径有正常的 404 页。

## 11. 非目标

- 不迁移用户、下载资源管理、游戏管理、贴纸、评论、评价、日志、设置、邮件群发、萌萌点账本页面。它们留在旧后台，由模块 06、09 或各自替代模块迁移。
- 不改任何处理服务的语义，不引入可撤销。
- 不做实时推送，只做 60 秒计数轮询与动作后刷新。
- 不重做资源编辑表单。
- 不删除 `components/admin/*` 与面包屑常量里的 `/admin*` 映射。
- 不引入 sonner、react-query 等新数据层或通知库。

## 12. 待站长决定的事项

1. 控制台 URL 前缀用 `/console`，还是别的名字。
2. 接口单通道（2 节第三行）是否接受。
3. 破坏性动作保留一次确认（2 节第一行）是否接受。
4. 用户管理迁移时是否整体归超级管理员，含发放萌萌点（现状发放萌萌点是管理员级）。本模块不迁移用户管理，但门槛表需要一个方向。
5. 第三个根布局 `(preview)` 是否接受，或改为在前台根布局内用条件隐藏外壳。
6. 未匹配路由的兜底若需启用 `experimental.globalNotFound`，是否接受在生产使用实验特性；不接受则保留 Next 默认 404 的现状行为。
7. 是否为控制台组件测试引入 `@testing-library/react` 与 jsdom 环境；不引入则渲染层靠手工验收。
8. 统计页是在本模块迁入 `/console/stats`，还是留到模块 09。
