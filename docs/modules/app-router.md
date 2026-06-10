# App Router And Pages

本模块说明 Next.js App Router 页面、server actions、metadata 和组件如何组织。

## 入口结构

| 路径 | 责任 |
| --- | --- |
| `app/layout.tsx` | 全站根 layout。 |
| `app/providers.tsx` | 全局 providers。 |
| `app/metadata.ts` | 全站 metadata helper。 |
| `app/page.tsx` | 首页。 |
| `app/[id]/*` | 游戏详情页，动态路由是 8 位 `unique_id`。 |
| `app/admin/*` | 管理后台页面。 |
| `app/edit/*` | 创建/编辑游戏。 |
| `app/message/*` | 消息、会话、通知页面。 |
| `app/doc/*` | MDX 文档/公告页面。 |
| `app/settings/user/*` | 用户设置。 |

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
- `revalidate = 120`，但浏览量通过 `kunUpdatePatchViewsActions` 做实时更新补偿。
- 如果 NSFW 被阻挡，标题和内容会隐藏。

前端详情容器 `PatchHeaderContainer` 负责：

- 写入 `useRewritePatchStore`，让编辑页可以复用当前游戏数据。
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

权限规则不应只靠页面隐藏按钮。所有后台 API 必须在 route handler 校验登录和角色。常见要求：

- `role >= 3`：管理员。
- `role >= 4`：超级管理员。

## 用户与消息页面

用户页：

- `app/user/[id]/*`
- `components/user/*`
- `app/api/user/profile/*`

消息页：

- `app/message/*`
- `components/message/*`
- `app/api/message/*`

未读状态由 `app/api/message/service.ts` 查询普通消息与聊天会话未读数。会话模块在 `app/api/message/conversation/*`。

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
