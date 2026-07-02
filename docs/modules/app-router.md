# App Router And Pages

本模块说明 Next.js App Router 页面、server actions、metadata 和组件如何组织。

## 入口结构

| 路径                  | 责任                                      |
| --------------------- | ----------------------------------------- |
| `app/layout.tsx`      | 全站根 layout。                           |
| `app/providers.tsx`   | 全局 providers。                          |
| `app/metadata.ts`     | 全站 metadata helper。                    |
| `app/page.tsx`        | 首页。                                    |
| `app/[id]/*`          | 游戏详情页，动态路由是 8 位 `unique_id`。 |
| `app/admin/*`         | 管理后台页面。                            |
| `app/edit/*`          | 创建/编辑游戏。                           |
| `app/message/*`       | 消息、会话、通知页面。                    |
| `app/doc/*`           | MDX 文档/公告页面。                       |
| `app/settings/user/*` | 用户设置。                                |

页面通常由三类文件组成：

- `page.tsx`：Server Component 页面入口。
- `metadata.ts`：页面 metadata。
- `actions.ts`：server actions 或页面侧 API 封装。

## 游戏详情页

代表路径：

- `app/[id]/page.tsx`
- `app/[id]/actions.ts`
- `app/[id]/metadata.ts`
- `components/patch/header/Container.tsx`
- `components/patch/resource/Resource.tsx`

详情页规则：

- `id` 必须匹配 `/^[A-Za-z0-9]{8}$/`，否则 `notFound()`。
- 页面数据来自 `kunGetPatchPageDataActions({ uniqueId })`。
- 登录状态来自 `verifyHeaderCookie()`。
- NSFW 显示状态来自 `getNSFWHeader()`。
- `revalidate = 120`，浏览量不在服务端渲染期间写入；页面 hydration 后由 `PatchViewBeacon` 调用 `POST /api/patch/views`，该接口返回 `Cache-Control: private, no-store`。
- 如果 NSFW 被阻挡，标题和内容会隐藏。

前端详情容器 `PatchHeaderContainer` 负责：

- 写入 `useRewritePatchStore`，让编辑页可以复用当前游戏数据。
- 挂载 `PatchViewBeacon`，详情页打开后发送一次浏览量写入请求，并对展示值做一次乐观更新。
- 管理 introduction/resources/comments/ratings 等 tabs。
- 点击“下载”时切换到资源 tab 并滚动到资源区。
- 根据 NSFW 状态设置 document title。

## 管理后台

代表路径：

- `app/admin/layout.tsx`
- `app/admin/*/page.tsx`
- `components/admin/*`
- `app/api/admin/*`

后台功能按资源域拆分：

- 用户、创作者、游戏、资源、资源申请。
- 评论、评分、反馈、举报、日志。
- 邮件和站点设置。

资源管理列表的主标题使用“下载资源管理”。资源列必须把资源条目名作为主行、所属游戏名作为可点击副行展示；资源 / 补丁归属放在紧随资源列后的“类型”列，不要挤在名称行里；对象存储链接的大小来自上传结果，编辑表单中大小输入必须禁用，普通外链大小仍可编辑；发布资源和更改资源链接弹窗中的说明性小字及表单 label 应使用 `select-none`，但不能影响输入框内容、按钮、链接等可交互元素；后台资源编辑成功后要用接口返回值立即更新当前行或重新拉取列表，删除成功后要刷新列表，避免继续用旧行数据再次编辑。

权限规则不应只靠页面隐藏按钮。所有后台 API 必须在 route handler 校验登录和角色。常见要求：

- `role >= 3`：管理员。
- `role >= 4`：超级管理员。

## 首页

代表路径：

- `app/page.tsx`
- `app/actions.ts`
- `app/api/home/service.ts`
- `app/api/home/route.ts`
- `components/home/Container.tsx`
- `components/home/HomeGalgameGrid.tsx`

规则：

- 首页是 `force-static`，正常首屏游戏和资源来自服务端静态 payload，不要为了修复部署后的空列表把首页改成动态 SSR。
- 首页游戏 section 只在静态 payload 的 `galgames` 为空时，由客户端补拉一次 `/api/home`；静态 payload 非空时不能额外请求 `/api/home`，只保留现有 `/api/patch/stats` 实时浏览量合并。
- `/api/home` 是部署空快照的兜底路径。匿名请求使用短响应缓存；登录、NSFW 设置或 blocked tag cookie 请求仍按个性化可见性返回 `private, no-store`。
- 调整首页首屏数据时，要同时检查 `home_data:*` Redis payload cache、`/api/home` 匿名响应缓存、Cloudflare API purge、`/api/patch/stats` 实时叠加，避免空结果被缓存后长期覆盖静态首页。

## 用户与消息页面

用户页：

- `app/user/[id]/*`
- `components/user/*`
- `app/api/user/profile/*`

消息页：

- `app/message/*`
- `components/message/*`
- `app/api/message/*`

通知正文按纯文本渲染，前端会保留后端消息里的换行，供系统通知展示多行变更摘要。

未读状态由 `app/api/message/service.ts` 查询普通消息与聊天会话未读数。会话模块在 `app/api/message/conversation/*`。顶栏铃铛只负责导航到通知中心，不应在用户看到通知列表前调用 `/api/message/read`。通知页由消息导航在首屏消息已经渲染后调用 `/api/message/read`，用服务端返回的 `MessageUnreadStatus` 同步全局红点；不要只在前端把通知和私聊红点一起乐观清空。消息列表客户端首次 hydrate 时复用服务端首屏数据，不能立刻重新拉取当前页把刚看到的未读 chip 刷成已读。消息导航红点以 `messageStore` 为单一状态源，通知页不再发额外 `/api/message/unread` 覆盖刚确认的已读状态；跨路由未读请求必须在 effect cleanup 后忽略过期返回。

登录后的全站未读状态由 `components/message/MessageRealtimeSync.tsx` 在 `app/providers.tsx` 中挂载同步。它只轮询 `/api/message/unread` 并写入 `messageStore`，不负责标记已读；系统通知、评论回复、@、关注等 `user_message` 新通知在任意页面到达时，表现为顶栏铃铛小红点动态亮起，不弹 toast。页面隐藏时降频，回到可见状态时立即同步一次，但不能在已有未读同步请求仍在进行时再发起第二个 `/api/message/unread` 请求。私聊会话卡片禁用 Next Link 预取，避免个性化聊天详情使用停留列表时预取到的旧 RSC payload。私聊会话列表首屏和 API 列表刷新必须在 DB 读取前走 `message-read` 限频；私聊详情页服务端首屏必须用严格十进制 helper 校验 `conversationId`，并在初始消息 DB 读取前走 `message-read` 限频；非法 ID 渲染 `无效的会话 ID`，限频命中渲染用户可见重试字符串。`ChatContainer` 打开后立即用 `/api/message/conversation/[id]?afterId=<latestId>` 补拉一次，可见窗口约每 2 秒继续增量获取，隐藏窗口降频并在恢复可见时立即补拉；实时 `afterId` 游标只由服务端拉取到的消息推进，本地刚发送成功的消息只插入 UI，不推进游标，避免双方同时发送时略早的对方消息被永久跳过。收到对方消息后调用 `/api/message/conversation/[id]/read` 并用返回值同步红点。会话消息接口的 `afterId` 增量请求只查新增消息，不再统计整段历史总数；历史消息上翻使用 `beforeId=<oldestId>` 游标加载更早消息，不能用 page/skip 翻页扫过整段会话。会话列表页会后台刷新当前页，让最新消息、未读 chip 和私聊红点不依赖手动刷新。私聊详情页的“移除私聊”只隐藏当前用户列表记录；重新发起已有会话会先调用创建/打开接口恢复可见性再跳转。所有这些个性化消息接口都必须保持 `private, no-store`。

私聊详情页消息气泡支持文本消息、图片消息、回复预览和发送方已读/未读状态。所有存在正文的消息，包括短单行文本、长文本、带回复预览的正文和图片说明文字，都使用 Telegram 风格尾部元信息布局：正文保持普通左对齐内联文本流，在文本尾部追加不可见内联占位为元信息留出空间，发送时间、编辑标记和自己消息的轻量对钩贴在同一段落右下角/末行右侧；占位只镜像真实元信息宽度，不能贡献行高、padding 或额外垂直高度；不能把尾部文字拆成单独右对齐行，不能用 `text-align-last: justify` 拉伸文字，不能用固定/手写换行、两列 grid、`justify-between` 或 float/right-column 布局。图片-only 消息把同一组元信息放在右下角半透明遮罩中。对钩语义来自 `user_private_message.status`。右键菜单可对消息选择“回复”；如果当前气泡内有选中文本，还会出现“回复选中文本”。消息气泡本身必须可聚焦，键盘用户可通过 Enter、Space、菜单键或 Shift+F10 打开同一个操作菜单，菜单使用 `menu` / `menuitem` 语义并保留可见焦点。移动端左滑消息气泡直接进入与右键“回复”相同的回复草稿路径，并用水平阈值区分纵向滚动。图片右键菜单复制的是图片链接；右键落在某一张图片上时，回复会绑定这张图片并显示主题色遮罩。图片-only 且没有文本说明的消息不显示编辑入口。回复预览支持图片缩略图，点击已发送消息里的回复预览会短暂滚动到被引用消息并高亮目标内容。聊天窗口离开底部时显示浮动回底部按钮；如果刚通过回复预览跳转，按钮第一次点击会短暂滚动回到跳转前位置并高亮原回复消息，之后再作为普通回底部按钮使用；普通回底部点击同样使用短滚动动画，并在点击时立即触发原地渐隐，按钮退出和按钮自身按压反馈都不能造成先向下位移再消失的观感。移动端长按菜单不可用时，组件保留单击回复入口的扩展空间，交互必须避免和图片预览、复制、编辑、删除冲突。输入区加号折叠菜单承载附件能力，目前只开放图片；菜单支持 Escape 关闭并使用 menu/menuitem 语义。图片先上传到 `/api/message/conversation/[id]/image` 获取同会话、同用户短期登记过的 metadata，再随发送消息请求写入消息记录；前端不能拼装或复用未登记图片 URL 绕过上传流。

## 标签和公司详情页

代表路径：

- `app/tag/[id]/page.tsx`
- `app/company/[id]/page.tsx`
- `components/tag/detail/Container.tsx`
- `components/company/detail/Container.tsx`

规则：

- `/tag/[id]` 和 `/company/[id]` 都是 `force-static` 公开页面，默认可进入匿名 HTML 缓存；不要在页面渲染阶段读取登录、NSFW 或 blocked tag cookie 来生成个性化列表。
- `/company/[id]` 可以在服务端预取默认 SFW 公司游戏列表，并传给客户端作为匿名默认筛选首屏数据。客户端默认筛选状态下，匿名用户复用这份静态列表；登录、NSFW `nsfw` / `all`、或 blocked tag cookie 存在时，首屏应通过 `/api/company/otomegame` 补拉个性化列表。
- `/tag/[id]` 不在服务端预取游戏列表；登录用户在客户端首屏通过 `/api/tag/otomegame` 拉取列表，避免静态产物混入登录态、blocked tag 或 NSFW 结果。
- 调整 tag/company 详情列表首屏逻辑时，要同时验证匿名默认场景不多打 API、个性化场景会补拉 API，并检查 StrictMode 下不会重复请求。

## 页面开发规则

- 只有需要浏览器 API、状态、事件或 hooks 的组件才加 `'use client'`。
- 页面参数和 search params 必须经过 schema 或显式校验。
- 页面不直接承载复杂 Prisma 逻辑，业务逻辑放到 API service 或 actions。
- 新页面要同步 metadata。
- 受保护页面必须确认 `middleware.ts` matcher 是否覆盖。

## 变更检查

页面/组件改动至少运行：

```bash
pnpm typecheck
```

涉及共享逻辑、stores、filters 或 API 数据形态时，加跑相关测试或全量：

```bash
pnpm test
```
