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
- `/api/message/read` 只标记 `user_message` 通知为已读，然后返回 `MessageUnreadStatus`；前端顶栏和消息页要用这个返回值更新全局红点，避免把仍未读的私聊红点一并清掉。

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
- DB 写入成功后 `finalizeUpload`；DB 写入失败后删除已上传 S3 object；S3 上传失败要释放 consume lock。
- 审计日志不能记录资源链接、提取码、密码和 hash。
- 管理员从后台修改他人发布的资源时，必须向资源发布者发送 `type: 'system'` 的站内通知，并只列出实际变更的安全字段摘要；字段名和值要使用前端资源表单展示文案，资源链接只展示数量和存储类型统计，不暴露链接内容、提取码、密码或 hash。

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
