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

登录后的全站未读状态由 `components/message/MessageRealtimeSync.tsx` 在 `app/providers.tsx` 中挂载同步。它只轮询 `/api/message/unread` 并写入 `messageStore`，不负责标记已读；系统通知、评论回复、@、关注等 `user_message` 新通知在任意页面到达时，表现为顶栏铃铛小红点动态亮起，不弹 toast。页面隐藏时降频，回到可见状态时立即同步一次。私聊会话卡片禁用 Next Link 预取，避免个性化聊天详情使用停留列表时预取到的旧 RSC payload。私聊详情页 `ChatContainer` 打开后立即用 `/api/message/conversation/[id]?afterId=<latestId>` 补拉一次，可见窗口约每 2 秒继续增量获取，隐藏窗口降频并在恢复可见时立即补拉；实时 `afterId` 游标只由服务端拉取到的消息推进，本地刚发送成功的消息只插入 UI，不推进游标，避免双方同时发送时略早的对方消息被永久跳过。收到对方消息后调用 `/api/message/conversation/[id]/read` 并用返回值同步红点。会话消息接口的 `afterId` 增量请求只查新增消息，不再统计整段历史总数。会话列表页会后台刷新当前页，让最新消息、未读 chip 和私聊红点不依赖手动刷新。所有这些个性化消息接口都必须保持 `private, no-store`。

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
