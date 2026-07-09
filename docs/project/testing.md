# OtoAme Testing Guide

本文档记录当前项目测试策略和新增测试约定。

## 当前测试栈

- Runner：Vitest 4。
- 配置：[vitest.config.ts](../../vitest.config.ts)。
- 环境：`node`。
- 全局 API：`globals: true`。
- 路径别名：`~` 指向仓库根目录。
- Node：使用 22.15+，以匹配 Vitest 对 `vi.mock` / `vi.hoisted` 的 Node loader 要求和 CI 主版本环境。

运行：

```bash
pnpm test
pnpm test tests/unit/resource-link.test.ts
pnpm test tests/unit/api/batch-tag.test.ts
```

## 测试目录

```text
tests/unit/
  api/
  *.test.ts
```

现有覆盖重点：

- API service 逻辑：`tests/unit/api/*`。
- JWT session：`tests/unit/jwt-session.test.ts`。
- Redis 封装：`tests/unit/redis.test.ts`。
- 创建/重写 store 合并：`tests/unit/edit-store.test.ts`。
- 公司脏数据合并计划：`tests/unit/company-merge-plan.test.ts`。
- 搜索 store：`tests/unit/search-store.test.ts`。
- CAPTCHA：`tests/unit/captcha.test.ts`。
- 资源链接解析、资源分类、资源派生标签口径和后台资源表格布局：`tests/unit/resource-link.test.ts`、`resource-classification.test.ts`、`patch-resource-attributes.test.ts`、`admin-resource-container-layout.test.tsx`。
- 下载链接按需获取：`api/resource-access.test.ts` 覆盖资源列表脱敏、access API 可见性/归属查询和 no-store 响应；`resource-download-card.test.tsx` 覆盖点击“获取下载链接”后的敏感字段展示和错误反馈；`resource-access-links-helper.test.ts` 覆盖编辑资源前按需水合完整链接。
- Gallery 上传链路：`gallery-upload.test.ts` / `gallery-route.test.ts` 覆盖服务端转码、缩略图、S3 补偿和 route；`gallery-upload-batch.test.ts` 覆盖前端逐张上传失败保留；`gallery-drop.test.ts` 覆盖网页图片 URL/HTML 拖拽导入；`gallery-remote-import.test.ts` 和 `gallery-remote-route.test.ts` 覆盖远程图片导入、SSRF 边界和权限。
- 消息红点和实时同步：`message-nav.test.tsx` 覆盖通知页已读、已读请求异常或字符串业务错误后的可重试/user-visible toast 与未读状态恢复、恢复读取也失败或限频时回滚到乐观清除前的红点快照、过期未读请求 cleanup、通知/私聊红点分离；`message-container.test.tsx` 覆盖通知首屏 hydrate 保留首屏并后台刷新当前页、通知分页并发请求忽略旧响应、分页限频字符串保留当前列表并 toast、清理已读消息前必须确认、清理限频字符串保留弹窗和列表且不额外刷新；`user-message-bell.test.tsx` 覆盖顶栏铃铛只导航、不在通知展示前标已读，以及 `/api/user/session` 返回 `unread: null` 时保留当前红点状态；`message-realtime-sync.test.tsx` 覆盖全站未读轮询、任意页面新通知只点亮铃铛红点、可见性恢复同步、可见性恢复期间不重入已有未读同步请求，以及后台未读同步限频字符串保留当前红点状态；`chat-page.test.tsx` 和 `chat-actions.test.ts` 覆盖私聊详情页服务端首屏严格会话 ID 校验、server action 初始会话列表/消息读取 `message-read` 限流和限流时不继续 DB 读取；`chat-input.test.tsx` 覆盖私聊输入法组合期 Enter 不发送、`Shift+Enter` 换行、发送去重、发送/图片上传异常提示可重试错误、图片上传请求异常透出具体原因、回复 payload、回复图片缩略图、图片菜单发送、快速连续粘贴仍限制 9 张图片、多图预览单张移除、多图部分上传失败后只重试失败图片（包括服务端字符串和请求抛错）、失败后追加图片仍保留成功上传 metadata、图片发送后清空文件输入以便重选同一文件，以及 Escape 关闭附件菜单；`chat-message-menu.test.tsx` 覆盖消息气泡回复菜单、键盘打开气泡菜单、文本末端元信息底部对齐、图片-only 右下遮罩元信息、已读角标、图片渲染、图片链接复制、图片右键回复索引、编辑聚焦、单条消息删除前必须确认、编辑/删除请求异常后的可重试 toast 与提交态恢复，以及回复预览点击；`chat-container-realtime.test.tsx` 覆盖私聊详情页打开后立即 `afterId` 补拉、首次和实时已读同步异常提示可重试错误、`beforeId` 上翻历史、历史加载失败后释放 loading 并提示用户、历史哨兵重复触发不重入同一游标请求、2 秒可见轮询、隐藏降频/恢复立即补拉、可见性恢复期间不重入已有实时请求、上翻阅读历史时实时新消息不强制滚动到底部、去重合并、本地删除后立即清空旧正文/图片/回复 metadata 成 tombstone、被回复消息删除后清理回复草稿、回复预览跳转和当前会话已读同步；`delete-conversation-button.test.tsx` 覆盖移除私聊请求异常后的可重试 toast 与危险操作 loading 恢复；`conversation-list-realtime.test.tsx` 覆盖会话列表首屏 hydrate 保留首屏并后台刷新当前页、后台刷新 unread chip、total/pagination 同步、并发翻页/刷新时忽略旧响应、显式加载期间静默轮询不抢占当前请求、私聊详情链接禁用预取、以及当前页无未读时不清除全局私聊红点；`api/user-session.test.ts` 覆盖 `/api/user/session` 返回 `private, no-store`，正常路径读取 unread，未读子查询命中 `notification-read` 限流时不读取 `user_message` / `user_conversation` 并返回 `unread: null`；`api/conversation-service.test.ts` 覆盖目标用户关闭私聊时不能新建会话、新建私聊萌萌点扣费使用事务内原子条件扣减、普通用户和管理员并发创建同一对话命中唯一约束后返回既有会话、已有会话也不能绕过收件人关闭接收私信设置、回复预览、回复图片快照、回复归属校验、图片消息写入、发送图片成功会原子消费 Redis 上传 metadata 且未登记 metadata 会被拒绝、消息事务失败时会恢复已消费 metadata 供重试、编辑/删除命中 `message-write` 限流时不读取消息行或触发 S3 cleanup、删除图片消息后只清理未被其他未删除消息引用的 S3 对象、重复删除已 tombstone 消息不会重跑 S3 清理、S3 清理失败不阻断消息 tombstone、基于 `last_message_id` 的列表摘要、脏图片摘要显示不可用占位、已删除最后一条消息不泄露旧摘要，以及移除私聊只隐藏当前用户、重复移除已隐藏会话不重复写库、并在重新打开/发送消息时恢复可见；`api/conversation-image-upload.test.ts` 覆盖私聊图片上传权限、类型/大小限制、上传入口 `image-upload-intake` 限流在 multipart 解析前返回 429、上传超限在 Sharp/S3 前被拒绝、每小时免费额度后的萌萌点扣费/余额不足拒绝/失败退款和 quota 回滚、图片处理失败返回用户可见错误并退款/回滚 quota、S3 上传失败返回对象存储可重试错误并退款/回滚 quota、route 层 `429` / `Retry-After` / no-store 响应、Sharp metadata、S3 参数、上传 metadata 登记和登记失败后的 S3 补偿及记录保存可重试错误；`api/conversation-rate-limit.test.ts` 覆盖私聊 Redis 原子限频 key、发送/图片上传入口/图片上传/检查打开/私聊管理/消息读取/消息操作/通知读取/通知操作阈值、等待秒数、动作限频 Redis 故障 fail-open、图片小时 quota key/扣费阈值/回滚和 quota 故障 unavailable；`conversation-image-cleanup.test.ts` 覆盖私聊 S3 孤儿图片清理脚本的 dry-run/apply 默认值、key 规范、非删除消息引用保护、tombstone 遗留引用不保护和删除失败 summary；`api/message-unread.test.ts` 覆盖未读状态形态、隐藏会话不参与私聊红点聚合、普通用户不能调用 `POST /api/message` 伪造任意通知、通知已读/清理空操作不重复写 DB、通知列表/未读/标已读/清理命中限流时返回 `429` / `Retry-After` / no-store 且不继续读写 DB、私聊已读 route 严格会话 ID 校验、已读同步限流时不继续读写 DB、当前用户 unread counter 已为 0 时不重复写 DB，以及 no-store 响应头；`api/notification-toggle-abuse.test.ts` 覆盖取消收藏、取消评论点赞、取消评价点赞和取消资源点赞不创建通知；`api/mention-message.test.ts` 覆盖评论提及通知去重、跳过自己、忽略不存在用户和单条评论限额；`api/conversation-messages.test.ts` 覆盖会话消息增量查询、严格会话路由 ID 校验、首屏响应时间正序、`beforeId` 历史游标、消息 metadata 映射、脏图片消息缺少有效 metadata 时降级为文本占位、已删除消息响应不泄露旧正文/图片/回复 metadata、`afterId` 不统计历史总数、图片 payload 必须声明为图片消息、纯空白编辑内容会被拒绝、发送/编辑/删除/移除私聊/会话列表读取/消息读取/检查打开私聊限流的 `429` / `Retry-After` / no-store 响应、检查/打开、会话列表读取、消息读取、消息编辑/删除和移除私聊限流时不继续读写 DB，移除私聊成功路径只消耗一次 `conversation-manage` 检查，以及会话检查接口的 no-store 响应；`kun-fetch.test.ts` 覆盖非 2xx JSON 字符串错误体仍返回给现有 toast 分支；`start-chat-button.test.tsx` 覆盖用户资料页打开已有会话时先 POST 恢复隐藏会话再跳转，以及检查/打开私聊请求异常后的可重试 toast 与 loading 恢复。
- 私聊浮动回底部按钮：`chat-container-realtime.test.tsx` 覆盖离开底部时显示按钮、普通回到底部短滚动动画、点击普通回底部时立即原地渐隐、按钮渐隐卸载，以及回复预览跳转后先回到跳转前位置并高亮原消息再恢复普通回底部。
- 私聊附件菜单：`chat-input.test.tsx` 覆盖附件加号菜单在已有待发送图片预览时仍高于图片预览和移除按钮。
- 外部 ID、主题、标签等纯逻辑。
- 编辑外部 ID 查重：`api/duplicate.test.ts`、`api/create-galgame-timeout.test.ts`、`patch-update-gallery.test.ts` 和 `steam-input.test.tsx` 覆盖 Steam ID 软重复可继续创建/重写/拉取 Steam 数据，以及 Bangumi ID 硬唯一和 Prisma `P2002` 竞态提示。

## 何时新增测试

必须新增或更新测试：

- API service 行为变更。
- 纯工具函数变更。
- Prisma 写入规则、计数器、缓存失效、权限判断变更。
- 资源链接、上传、下载、提取码、S3 补偿相关变更。
- Gallery create/rewrite 上传失败保留、重试、网页拖拽远程导入和 `/api/edit/gallery/remote` 安全边界相关变更。
- CSRF、角色、资源归属、每日上传配额、用户设置权限相关变更。
- 主题 token、语义颜色、过滤器、排序、外部 ID 解析变更。
- 编辑页外部数据合并规则变更，包括 VNDB/Bangumi/Steam 字段保留、Steam ID 软重复提示但不阻塞、公司来源优先级、alias 公司匹配和 store 函数式合并。
- 维护脚本的自动合并计划变更，尤其是公司/tag 的 alias 冲突、歧义跳过、关系迁移和 count 预览。
- 修 bug 时要加能在修复前失败的 regression test。

可以暂不新增测试但要手动验证：

- 只改静态文案。
- 只改 README 或项目文档。
- 视觉微调且没有逻辑分支。

## 测试优先级

1. 纯函数优先：`utils/*`、`constants/*`、`validations/*`。
2. Service 次之：mock Prisma、Redis、外部 API，验证业务行为。
3. Route handler 最后：只有当 HTTP 解析、header、cookie、status 行为本身是风险点时再测。

## Vitest mock 模式

项目已有模式：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    patch_tag: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn()
    }
  }

  return {
    patch_tag: {
      findMany: vi.fn()
    },
    $transaction: vi.fn((fn) => fn(tx)),
    _tx: tx
  }
})

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))
```

使用 `vi.hoisted` 的原因是 `vi.mock` 会被 Vitest 提升，mock factory 不能依赖尚未初始化的普通变量。

## API service 测试约定

测试 service 时优先验证：

- 返回值。
- Prisma 查询条件和事务写入。
- 缓存失效函数是否被调用。
- 权限和边界条件。
- 输入去重、normalize、alias 匹配等业务规则。
- 外部数据合并优先级，例如 VNDB 公司优先、Bangumi 公司兜底、Bangumi 标签仍保留、Steam ID 软重复和 Bangumi ID 硬唯一。
- 用户身份、角色阈值和 owner mismatch。

避免：

- 只验证 mock 被调用，没验证行为结果。
- mock 过深导致测试复制实现。
- 在单元测试里真实连接 PostgreSQL、Redis、S3、GitHub、Bangumi、VNDB。
- 为了让测试好写而把 API 权限判断移到前端。

## Redis 测试约定

Redis 相关逻辑分两类：

- key 生成、envelope、stale 逻辑：可单测纯逻辑或 mock `redis`。
- 真实 Redis 集成：只在明确需要时加集成测试，并隔离 key 前缀和 cleanup。

写缓存失效测试时，优先断言调用的是 `delKvPattern('业务前缀:*')` 或公开失效函数，而不是散落的低层 key。

直接使用 `redis` / `runRedisCommand` 的模块要单独检查 key 前缀和原子性，例如浏览量 buffer 使用 Redis hash 和 Lua，不能简单套 `setKv` 测试模式。

## Prisma/事务测试约定

mock transaction 需要模拟真实 Prisma transaction callback：

```ts
prismaMocks.$transaction.mockImplementation((fn) => fn(prismaMocks._tx))
```

事务测试要覆盖：

- create/update/delete 的顺序敏感行为。
- 计数器 increment/decrement。
- `skipDuplicates`。
- rollback 前的外部副作用补偿策略，尤其是上传和 S3。

## 上传和资源测试

资源相关至少覆盖：

- 链接解析和提取码合并。
- 资源列表不能下发真实下载链接、提取码或解压码；下载 access API 必须校验资源归属、游戏归属和可见性，并保持 `private, no-store`。
- 上传 owner mismatch、already consuming、not found。
- S3 URL key 提取拒绝非本站 URL。
- DB 写失败后的 compensation。
- audit log 脱敏。
- 每日上传配额和创作者 CAPTCHA / 萌萌点限制。

已存在基础测试：[tests/unit/resource-link.test.ts](../../tests/unit/resource-link.test.ts)。

## 修 bug 的红绿流程

1. 写一个最小失败测试，名称描述用户可见行为。
2. 运行目标测试，确认失败原因是 bug，而不是测试拼写或 mock 缺失。
3. 写最小修复。
4. 运行目标测试确认通过。
5. 运行相关测试文件或全量 `pnpm test`。

示例命令：

```bash
pnpm test tests/unit/api/batch-tag.test.ts
pnpm test
pnpm typecheck
```

## 发布前验证矩阵

| 改动                         | 最小验证                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------- |
| 纯 utils                     | 目标测试 + `pnpm typecheck`                                                   |
| API service                  | 目标 API 测试 + `pnpm typecheck`                                              |
| Prisma schema                | `pnpm prisma:generate` 或 `pnpm prisma:push` + `pnpm typecheck` + `pnpm test` |
| Redis/cache                  | 目标测试 + 相关 API 测试 + `pnpm typecheck`                                   |
| 上传/S3                      | 目标测试 + 手动上传流程说明 + `pnpm typecheck`                                |
| Auth/CSRF/role               | 目标 API/service 测试 + `pnpm typecheck`                                      |
| Next config/postbuild/deploy | `pnpm typecheck` + 可行时 `pnpm build`                                        |
| UI-only                      | `pnpm typecheck`，复杂交互加手动验证                                          |

## 已知缺口

- 当前没有 Playwright/E2E 配置。
- 多数 API route handler 没有 HTTP 层测试。
- 真实 PostgreSQL/Redis/S3 集成测试缺少统一 harness。
- `pnpm lint` 依赖 Next lint 命令；Next 15 项目如果命令不可用，需要迁移到 ESLint CLI 后再纳入强制验证。
