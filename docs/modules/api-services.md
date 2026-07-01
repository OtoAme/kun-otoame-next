# API And Services

本模块说明 `app/api/*` 的 HTTP 层、业务 service、validation 和类型如何协作。

## API 约定

典型结构：

```text
app/api/<domain>/route.ts
app/api/<domain>/service.ts
validations/<domain>.ts
types/api/<domain>.ts
```

route handler 负责：

- 使用 `kunParseGetQuery`、`kunParsePostBody`、`kunParsePutBody`、`kunParseDeleteQuery` 或 `kunParseFormData`。
- 使用 `verifyHeaderCookie` 校验登录态。
- 校验角色。
- 调用 service/helper。
- 用 `NextResponse.json` 返回结果。

service/helper 负责：

- Prisma 查询和事务。
- Redis cache 或失效。
- 外部服务调用。
- 副作用和补偿。
- 业务返回数据整形。

不要把权限、CSRF、资源归属或管理员角色只放在页面层。页面隐藏按钮只能改善体验，不能替代 API 层判断。

## 主要 API 域

| 域        | 路径                                                                         | 说明                                                                                        |
| --------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 认证      | `app/api/auth/*`                                                             | 登录、注册、2FA、验证码、邮件通知、忘记密码。                                               |
| 游戏详情  | `app/api/patch/*`                                                            | 游戏详情、缓存内容、收藏、反馈、浏览量、评分、评论、资源。                                  |
| 创建/编辑 | `app/api/edit/*`                                                             | 创建和重写游戏，外部数据拉取，VNDB/Bangumi/Steam/DLSite，画廊上传。                         |
| 列表/搜索 | `app/api/otomegame`, `app/api/search`, `app/api/resource`, `app/api/ranking` | 游戏列表、搜索、资源列表、排行。                                                            |
| 标签/公司 | `app/api/tag/*`, `app/api/company/*`                                         | 标签列表、标签游戏、公司列表、公司游戏、公司 CRUD。                                         |
| 用户      | `app/api/user/*`                                                             | 用户资料、头像、设置、关注、收藏、状态、2FA。                                               |
| 消息      | `app/api/message/*`                                                          | 站内消息、未读状态、会话聊天。                                                              |
| 管理      | `app/api/admin/*`                                                            | 后台用户、资源、评论、评分、举报、邮件、设置、日志。                                        |
| 上传      | `app/api/upload/*`                                                           | 资源文件和视频上传。                                                                        |
| 工具      | `app/api/utils/*`                                                            | JWT、header cookie、CSRF 相关 helpers、Markdown render、Bangumi 工具、Cloudflare/IndexNow。 |

## 代表流程

### 登录

文件：

- `app/api/auth/login/route.ts`
- `app/api/auth/login/service.ts`
- `validations/auth.ts`
- `app/api/utils/jwt.ts`
- `app/api/utils/cookieOptions.ts`

流程：

1. `route.ts` 用 `loginSchema` 解析 JSON body。
2. `login` 校验 CAPTCHA。
3. 用 email 或用户名大小写不敏感查找用户。
4. 使用 dummy hash 防止用户不存在时的明显时间侧信道。
5. 校验封禁状态。
6. 必要时升级密码 hash。
7. 如果启用 2FA，写入短期 `kun-galgame-patch-moe-2fa-token`。
8. 否则生成 30 天登录 token，写入 `kun-galgame-patch-moe-token`。

### 游戏详情

文件：

- `app/api/patch/route.ts`
- `app/api/patch/pageData.ts`
- `app/api/patch/_queries.ts`
- `app/api/patch/_content.ts`
- `app/api/patch/cache.ts`

流程：

1. GET 校验 8 位 `uniqueId`。
2. 读取 cookie payload，允许未登录用户访问。
3. 先读 patch 内容缓存和 introduction 缓存。
4. 缓存命中时补充收藏状态和实时浏览量。
5. 缓存未命中时查 Prisma，构建 `Patch` 与 `PatchIntroduction` 数据，再写缓存。
6. 浏览量通过 Redis buffer 实时累加，列表和详情读取时用 `withRealtimePatchViews` / `getRealtimePatchStats` 叠加未落库值。

### 消息和反馈

文件：

- `app/api/message/service.ts`
- `app/api/message/all/service.ts`
- `app/api/patch/feedback/service.ts`
- `app/api/admin/feedback/service.ts`
- `app/api/utils/message.ts`

规则：

- 反馈工单本身使用 `type: 'feedback'`、`recipient_id: null`，供后台反馈管理列表查询。
- 用户提交反馈后发给管理员的提醒、管理员处理反馈后发给用户的回执都属于可筛选的系统通知，必须使用 `type: 'system'`。
- 不要把面向单个用户的反馈通知写成 `feedback`，否则会避开系统消息筛选并淹没在全部通知中。
- `POST /api/message` 是管理员手动创建站内通知的接口，必须要求 `role >= 3`。普通业务通知应在服务端业务流程中调用 `createMessage` / `createDedupMessage`，不能暴露给普通登录用户向任意 recipient 创建系统通知。
- `/api/message/read` 只把当前用户 `status = 0` 的 `user_message` 通知标记为已读，然后返回 `MessageUnreadStatus`；前端顶栏和消息页要用这个返回值更新全局红点，避免把仍未读的私聊红点一并清掉。如果当前用户没有未读通知，service 直接返回成功，不运行空 `updateMany`；清理已读通知时也要先确认存在匹配的 `status = 1` 行，没有则跳过 `deleteMany`，降低脚本反复调用造成的写放大。
- 普通站内通知的读取和写入也必须走用户级 Redis 限频。`/api/message/all` 和 `/api/message/unread` 使用 `notification-read`，当前阈值 180 次/分钟；`/api/message/read` 的 PUT/DELETE 使用 `notification-write`，当前阈值 30 次/分钟。限频检查在登录态之后、通知 DB 读取或写入之前执行；命中时返回 `429 Too Many Requests`、`Retry-After`、`Cache-Control: private, no-store`，响应体保留用户可见重试字符串，避免脚本高频刷新通知列表、未读状态、标已读或清理已读造成 DB 放大。`/api/user/session` 也会为顶栏返回 IM 未读状态，因此它必须保持 `private, no-store`，并在读取 `user_message` / `user_conversation` 之前对未读子查询执行 `notification-read`；命中限流时仍返回用户 session，但 `unread` 置为 `null`，让前端保留现有红点状态。
- 用户触发的收藏、评论点赞、评价点赞和资源点赞通知只在关系“新增”时创建。取消收藏或取消点赞不能创建或重新创建通知，即使收件人已经清理过旧通知；否则用户可以通过反复 toggle 制造误导性的通知噪音。
- 评论里的 `[@name](/user/<id>/resource)` 提及通知要先在服务端去重、跳过发送者本人、限制单条评论最多生成 20 条提及通知，并在写入 `user_message` 前查询真实存在的用户。不存在或伪造的用户 ID 直接忽略，不能让评论已经创建后因为通知外键错误把请求打成失败。
- `/api/message/all`、`/api/message`、`/api/message/unread`、`/api/message/read`、`/api/user/session` 和 `/api/message/conversation/[id]/read` 都返回或写入登录用户的个性化消息状态，必须带 `Cache-Control: private, no-store`，避免缓存旧消息列表、创建结果或未读结果让前端状态回跳。私聊未读聚合必须排除当前用户已隐藏的会话，避免“移除私聊”后全局私聊红点继续亮起。
- `/api/message/conversation/[id]/read` 只清理当前登录用户那一侧的私聊未读状态；动态会话 ID 必须用严格十进制正整数解析，并在 DB 读取前执行 `message-read` 用户级 Redis 限频。如果当前用户对应的 unread counter 已经是 `0`，service 应直接返回成功，不重复写 `user_private_message.status` 或 `user_conversation`，降低脚本反复 PUT 时的写放大。
- 发起新私聊时，`checkConversation` 和 `getOrCreateConversation` 都必须在 API/service 层检查目标用户的 `allow_private_message`；发送已有私聊消息、上传已有私聊图片时也必须检查收件人的 `allow_private_message`，不能让历史会话绕过“关闭接收私信”的隐私设置。图片上传的隐私检查必须发生在限流、小时额度、萌萌点扣费、Sharp 转码和 S3 上传之前，避免对方已关闭私信时继续消耗存储成本或用户额度。普通用户创建新私聊会消耗 10 萌萌点，`checkConversation` 只是展示预检，真正扣费必须在 `getOrCreateConversation` 的事务内用 `user.updateMany({ where: { id, moemoepoint: { gte: 10 } }, data: { moemoepoint: { decrement: 10 } } })` 原子完成；如果 `count` 为 0，返回余额不足且不能创建 `user_conversation`。同一对用户并发创建时，`user_conversation` 的 `[user_a_id, user_b_id]` 唯一约束是最终防线；命中唯一冲突后应重新读取并返回已创建的会话，普通用户事务回滚不能重复扣点，管理员直接创建路径也不能把该竞态暴露成失败。前端隐藏按钮只能改善体验，不能替代权限判断。`/api/message/conversation/check` 返回登录用户的个性化付费/会话状态，`POST /api/message/conversation` 会创建或恢复登录用户自己的会话可见性，两者都必须带 `Cache-Control: private, no-store`。
- 移除私聊只隐藏当前用户的会话列表记录，不物理删除共享的 `user_conversation` 和历史消息。`deleteConversation` 只设置当前参与方的 hidden flag 并清零当前参与方未读数；如果当前参与方已经隐藏且未读数已经为 0，直接返回成功，不重复写 `user_conversation`。会话列表查询必须过滤当前参与方 hidden 的记录。重新发起已有会话会恢复当前用户可见性；任一方发送新消息会恢复双方可见性，让被隐藏的会话重新出现在列表。
- 会话列表摘要必须尊重 `user_private_message.is_deleted`。最后一条消息已删除时展示删除占位，不继续展示旧 `content` 或图片摘要，避免列表泄露已删除内容。图片摘要要基于有效图片 metadata：有 `image_url` 或有效 `image_group` 时显示 `[图片]`；脏数据里 `type: 1` 但没有有效图片 payload 的空内容消息显示 `[图片不可用]`，和详情页响应保持一致。
- 会话消息列表支持首屏、`beforeId` 历史游标和 `afterId` 增量游标。所有返回的 `messages` 都按时间从旧到新排列；首屏可以按新到旧查询最新窗口，但返回前必须反转成时间正序。`afterId` 请求只返回新增消息且不统计历史总数；`beforeId` 请求按当前最早消息 ID 查询更早记录，并返回 `hasMoreBefore`。已删除的私聊消息必须在响应里转成 tombstone：保留消息 ID、时间、发送者和删除状态，但清空正文、图片 metadata、图片组和回复预览，不能只依赖前端隐藏旧 payload。非删除图片消息只有在至少包含一个有效图片 metadata 时才能以 `type: 1` 返回；历史或异常脏数据里的空图片 payload 要降级成文本消息，空正文显示 `[图片不可用]`，避免前端渲染空气泡。前端上翻历史时必须使用 `beforeId`，避免大对话用 `skip` 越翻越慢。
- 私聊动态路由和服务端渲染的聊天详情页会话 ID 都必须按严格十进制正整数解析，不能用 `parseInt` 接受 `5abc` 这类部分合法字符串；非法 ID 要在鉴权和 DB 读取前直接返回或渲染 `无效的会话 ID`。
- 私聊发送支持 `type: 0` 文本和 `type: 1` 图片。文本消息需要 trim 后非空 `content`，编辑已有消息也必须按同一规则拒绝纯空白内容；图片消息必须带由私聊上传接口产生并在 Redis 短期登记过的图片 metadata，可选补充说明文本；服务端发送前必须按会话、用户和 URL hash 原子校验并删除登记内容，不能信任客户端伪造的图片 URL，也不能让同一次上传 metadata 在 1 小时 TTL 内重复生成多条图片消息。如果 metadata 已消费但随后消息 DB 事务失败，service 必须 best-effort 恢复这批 metadata，让用户可以直接重试发送而不用重新上传。多图消息通过 `images` 数组保存完整图片组，同时 `image` / `image_url` 保留第一张用于旧数据兼容和会话摘要。回复消息通过 `replyToMessageId` 指向同会话、未删除的消息，并在发送时固化 `replyTo` 预览，包括原消息发送者、消息类型、文本摘要和图片缩略信息，避免原消息后续编辑影响回复上下文。前端右键某张图片回复时会提交 `replyImageIndex`，服务端必须校验该索引属于被回复消息的图片组，并把对应图片 metadata 固化到 `reply_image`。
- `/api/message/conversation/[id]/image` 是私聊图片上传接口，只允许会话成员上传 JPG/PNG/WebP/AVIF，单张入站上限 8MB。该接口在 handler 内校验 CSRF 和登录态后，先执行 `image-upload-intake` 用户级限频，再读取 multipart `formData()`，避免被大量图片请求拖进解析成本；随后校验会话成员身份，用 Sharp 将静态图 resize 到 1920x1080 内并输出 AVIF，不加水印；Sharp 解码/压缩或处理后 metadata 读取失败时要回滚小时额度和已扣萌萌点，并返回“重新选择有效图片”的用户可见错误，不能冒成 500；上传 S3 后把最终 AVIF metadata 以 `conversation:image-upload:<conversationId>:<uid>:<urlHash>` 写入 Redis 1 小时，供发送消息校验；S3 上传或 Redis 登记失败时 best-effort 删除刚上传的 S3 object、回滚本次小时额度和已扣萌萌点，并返回可区分对象存储失败或上传记录保存失败的可重试错误。接口必须保持 `private, no-store`。
- 私聊发送、私聊图片上传、私聊检查/打开、私聊移除/隐藏、私聊会话列表读取、私聊消息拉取、服务端首屏聊天加载、私聊已读同步和单条消息编辑/删除都必须做登录用户维度的 Redis 原子限频，避免跨多个会话快速群发、反复触发图片转码/S3 上传、脚本刷用户资料页上的私聊预检/恢复入口、高频拉取/同步聊天消息打 DB，或反复编辑/删除/隐藏造成写放大和删除时 S3 引用检查。当前阈值是发送消息 30 次/分钟、图片上传入口解析 30 次/分钟、实际图片上传 10 次/5 分钟、检查/打开私聊 60 次/分钟、移除/隐藏私聊共用 `conversation-manage` 30 次/分钟、会话列表读取/消息拉取/服务端首屏聊天加载/已读同步共用 `message-read` 180 次/分钟、编辑/删除消息共用 `message-write` 60 次/分钟；普通通知读取使用 `notification-read` 180 次/分钟，普通通知标已读/清理使用 `notification-write` 30 次/分钟。命中限频时 API route 返回 `429 Too Many Requests`、`Retry-After` 秒数、`Cache-Control: private, no-store`，响应体仍是带等待秒数的用户可见字符串，供现有前端 toast 分支展示；server action 返回同一用户可见字符串，由聊天页错误组件展示。检查/打开、图片上传入口解析、API 层移除/隐藏、`message-read`、`notification-read` 和 `notification-write` 限频必须在用户/会话/通知 DB 读取、multipart 解析和创建/恢复/隐藏/通知写入之前执行；`deleteConversation` service 仍保留成员校验后的 `conversation-manage` 兜底，并在隐藏写入前返回结构化限流结果，route 预检查通过后调用 service 时必须跳过兜底以避免一次请求消耗两次额度。单条消息编辑/删除限频必须在会话成员校验之后、消息行读取和删除图片 S3 cleanup 之前执行；实际 `image-upload` 限频必须保留在收件人隐私校验之后，避免对方关闭私信时消耗发送者的真实图片上传额度。限频 Redis 异常时 fail-open 并记录错误，不能因为短暂 Redis 故障中断普通文字私聊或正常读取。
- 私聊图片上传还有用户级小时额度，用来控制长期 S3 成本：每个用户每小时前 5 张成功上传免费，第 6 张起每张在图片处理和 S3 上传前用 `user.updateMany({ where: { id, moemoepoint: { gte: 5 } }, data: { moemoepoint: { decrement: 5 } } })` 原子扣 5 萌萌点；余额不足时返回用户可见错误且不进入 Sharp/S3。压缩、处理后 metadata 读取、S3 上传或 Redis metadata 登记失败时回滚本次 quota 计数并退回已扣萌萌点；处理失败返回无效图片提示，上传/登记失败返回可重试错误。小时 quota Redis 不可用时上传直接返回可重试错误，避免在无法计费时继续制造 S3 成本。
- 删除单条私聊图片消息时，API 先把消息转成 tombstone，再 best-effort 清理该消息引用的 `conversation/<conversationId>/<uid>-<timestamp>-<uuid>.avif` S3 对象。删除前必须检查其他未删除私聊消息的 `image_url`、`image_group` 和 `reply_image` 是否仍引用同一 key；仍被引用、URL 不属于本站或 key 不符合私聊图片规范时不能删除。已是 tombstone 的消息再次删除时直接返回成功，不重复更新 DB 或重跑 S3 清理。S3 清理或引用检查失败只记录错误，不阻断消息删除，后续由孤儿清理脚本兜底。
- IM 防滥用的核心边界是用户级而不是会话级：发送限速、消息读取限速、图片硬限速、图片小时额度、图片 metadata 登记、图片 metadata 发送时原子消费、图片尺寸/类型/压缩上限、删除后 S3 清理和定时孤儿清理都必须按登录用户或 canonical S3 key 生效，避免用户通过打开多个私聊窗口绕过限制。

### 搜索和列表

文件：

- `app/api/search/service.ts`
- `app/api/otomegame/service.ts`
- `app/api/utils/galgameQuery.ts`
- `constants/api/select.ts`

规则：

- 搜索条件是 JSON 字符串，元素必须是 keyword/tag/company 且 include/exclude。
- 列表筛选支持类型、语言、平台、年份、月份、排序。
- SFW/NSFW 过滤由调用处传入 Prisma where。
- 卡片字段统一使用 `GalgameCardSelectField`，避免列表查询过载。
- 列表结果会经过 `withRealtimePatchViews` 叠加实时浏览量。

### 标签和公司

文件：

- `app/api/home/route.ts`
- `app/api/tag/service.ts`
- `app/api/company/service.ts`
- `app/api/tag/otomegame/route.ts`
- `app/api/company/otomegame/route.ts`
- `app/api/edit/processExternalData.ts`
- `app/api/edit/fetchCompanies.ts`
- `app/api/edit/companyEnsureHelper.ts`
- `scripts/cleanupDirtyCompanies.ts`
- `app/api/patch/cache.ts`

规则：

- 标签列表会排除用户 blocked tag。
- 标签/公司游戏列表使用 Redis 缓存，缓存 key 由 input + visibility where hash 得到；visibility where 必须合并 NSFW 条件和 blocked tag 条件。
- `/api/home`、`/api/tag/otomegame` 和 `/api/company/otomegame` 是只读匿名热点 API。匿名请求进入匿名响应热缓存；带登录 token、NSFW 设置或 blocked tag cookie 的请求必须走 `private, no-store` 个性化路径，不能共享匿名响应缓存。
- `/api/home` 只用于首页静态空 payload 的客户端兜底；正常首页不应每次请求该 API。该接口和 `home_data:*` 都不能缓存空 `galgames` payload，避免部署后空列表长期覆盖首页。
- 公司游戏列表 API 也必须应用 blocked tag visibility，不能只做 NSFW 过滤；否则 company 详情页个性化首屏补拉后仍可能展示用户已屏蔽标签的游戏。
- 公司支持 alias、parent_brand、primary_language、official_website。
- 公司创建和重写必须把 `name` 与 `alias` 一起做冲突检查；任一值命中其他公司的 `name` 或 `alias` 都应拒绝，避免别名导致重复公司。
- 修改公司后必须调用 `invalidateCompanyCaches`。
- 历史公司脏数据用 `pnpm maintenance:companies:dirty:dry` / `apply` 清理；不要让在线创建/编辑流程承担批量合并旧数据。

### 编辑外部数据合并

文件：

- `app/api/edit/processExternalData.ts`
- `app/api/edit/fetchCompanies.ts`
- `app/api/edit/companyEnsureHelper.ts`
- `components/edit/create/VNDBInput.tsx`
- `components/edit/create/VNDBRelationInput.tsx`
- `components/edit/components/BangumiInput.tsx`
- `components/edit/components/SteamInput.tsx`
- `store/editStore.ts`
- `store/rewriteStore.ts`

规则：

- 创建和重写游戏时不采用 VNDB 标签；Bangumi/Steam 外部标签仍按来源写入。
- 创建/重写页重新获取 VNDB、DLSite 或标题信息时，重复检查必须支持 `excludeId` 并排除当前 patch；rewrite 自己已有的外部 ID 不应被当作重复游戏。
- 标签写入必须按 `name` 和 `alias` 查找已有主标签；提交名命中主标签 alias 时，只关联和计数主标签，不创建 alias 标签。
- tag 的 alias 必须全局唯一，不能等于其它 tag 的 `name`，也不能出现在其它 tag 的 `alias` 中；创建/更新 tag 时服务端必须阻止这类冲突。
- 公司来源优先级是 VNDB > Bangumi。只要 VNDB ID 成功关联到至少一个公司，就不再使用 Bangumi developer 创建或关联公司；Bangumi developer 只作为 VNDB 无公司时的兜底。
- Steam developer 和 DLSite circle 独立补充公司关系，不参与 VNDB/Bangumi 主来源互斥。
- 外部公司关系必须按 `name` 和 `alias` 查找已有公司；提交名命中现有 alias 时，应关联到已有公司，而不是创建新公司。
- 新增外部公司关系后必须调用 `invalidateCompanyCaches`；只新增标签或别名时不应误触发公司缓存失效。

### 资源发布和上传

文件：

- `app/api/upload/resource/route.ts`
- `app/api/patch/resource/create.ts`
- `app/api/patch/resource/update.ts`
- `app/api/patch/resource/_helper.ts`
- `validations/resource.ts`

规则：

- `/api/upload/resource` 跳过 middleware，在 handler 内调用 `verifyKunCsrf`。
- 上传 handler 校验登录、扩展名、大小、角色、萌萌点、每日 5GB 配额和待审核资源。
- 发布阶段必须先 `consumeUpload(uploadId, userId)`，不能直接信任客户端传入的 S3 URL。
- 对象存储资源的 `content`、`hash`、`size` 必须来自上传元数据；更新已有 S3 链接且没有新 `uploadId` 时保留数据库中的原值，不能信任客户端手动传入的大小。
- DB 写入成功后 `finalizeUpload`；DB 写入失败后删除已上传 S3 object；S3 上传失败要释放 consume lock。
- 审计日志不能记录资源链接、提取码、密码和 hash。
- 修改资源时必须校验 `resourceId` 与提交的 `patchId` 属于同一条资源，避免过期列表或篡改请求把资源写入后却刷新错误游戏的派生属性和缓存。
- 管理员从后台修改他人发布的资源时，必须向资源发布者发送 `type: 'system'` 的站内通知，并只列出实际变更的安全字段摘要；字段名和值要使用前端资源表单展示文案。资源链接变更要忽略重建链接记录造成的数据库 ID 变化，并给出字段级安全摘要：数量和存储类型可展示统计，`存储类型`、`大小 (MB 或 GB)` 可展示前后值，`资源链接`、`提取码`、`解压码`、`Hash` 只展示填写状态或“已更新”，不暴露原始链接内容、提取码、密码或 hash。
- 后台资源更新和删除的管理日志要按资源 `section` 区分“游戏资源”和“补丁资源”，不能把所有资源统一写作补丁资源。后台更新接口返回值要保留 `patchName` 等列表上下文，供前端立即更新当前行。

### 用户设置和资料

文件：

- `app/api/user/setting/*`
- `app/api/user/profile/*`
- `app/api/user/status/*`
- `app/api/user/follow/*`

规则：

- 头像、邮箱、密码、2FA、屏蔽标签和私信设置都必须校验当前用户身份。
- 邮箱回滚接口 `/api/user/setting/email/revert` 是 CSRF 豁免路径，因为它使用邮件中的一次性 token。
- 资料页查询要区分本人视图、公开资料和悬浮卡片的字段暴露。

### 管理 API

代表文件：

- `app/api/admin/user/route.ts`
- `validations/admin.ts`
- `tests/unit/api/grant-moemoepoint.test.ts`

规则：

- 后台查询/修改用户多数要求超级管理员。
- 发放萌萌点允许管理员 `role >= 3`。
- 删除、更新用户时必须写审计日志或保留操作人上下文。
- 后台更新他人资源时除写审计日志外，还要通知资源发布者并列出安全的字段级变更；字段命名跟随前端资源表单；管理员修改自己发布的资源不自通知。

## 输入校验

所有新 API 都应优先在 `validations/<domain>.ts` 定义 schema。解析 helper 失败时返回字符串，调用处必须立即返回：

```ts
const input = await kunParsePostBody(req, schema)
if (typeof input === 'string') {
  return NextResponse.json(input)
}
```

`kunParseFormData` 会把重复字段转成数组、单字段转成字符串或 `File`。如果 schema 需要数组，必须确保前端确实按重复字段提交，或在 schema 中做 preprocess。

## 安全约束

- 非 upload API 由 `middleware.ts` 统一校验 CSRF；只读匿名热点 `/api/home`、`/api/tag/otomegame` 和 `/api/company/otomegame` 从 matcher 中排除以降低 GET 固定开销。
- upload API 因大 body 跳过 middleware，必须在 handler 内调用 `verifyKunCsrf`。
- 状态变更请求需要 `x-requested-with: kun-fetch`，并通过 `origin` / `referer` host 校验。新增 `fetch` wrapper 或第三方回调时要确认它能满足这个约束，或明确加入最小豁免。
- 用户可见错误不要泄漏 secret、token、资源密码、S3 key。
- 权限必须在 API 层校验，不能只靠前端。
- 资源删除和 S3 object 删除必须先检查引用关系，避免删掉仍被其他资源链接使用的对象。

## 测试建议

- 纯业务 service 用 Vitest mock Prisma/cache。
- 对缓存失效、计数器、事务边界写断言。
- 上传和资源测试要覆盖 owner mismatch、already consuming、S3 compensation、audit log 脱敏。
- route handler 只有在 HTTP 层行为是风险点时才单测。
- 标签写入必须先按 `name` 和 `alias` 解析到 canonical tag；如果提交值是主标签 alias，不创建 alias 同名 tag，也不为 alias tag 计数，只移动/计数主 tag。
- VNDB 信息只用于 ID、会社等外部数据；不要导入 VNDB tag。历史 VNDB tag 同步脚本默认禁用，避免重新写入 VNDB 标签。

参考：

- `tests/unit/api/batch-tag.test.ts`
- `tests/unit/api/grant-moemoepoint.test.ts`
- `tests/unit/api/process-external-data.test.ts`
- `tests/unit/api/otomegame-route-cache.test.ts`
