# Frontend, State, Theme, Content

本模块覆盖组件目录、状态管理、主题系统和 MDX 内容。

## 组件分层

| 路径                                       | 说明                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `components/kun/*`                         | 全站共享 UI、导航、主题、编辑器、图片查看器、cropper、auth captcha。  |
| `components/home/*`                        | 首页 hero、轮播、统计、卡片。                                         |
| `components/patch/*`                       | 游戏详情页 header、introduction、resource、comment、rating、gallery。 |
| `components/edit/*`                        | 创建/重写游戏表单，VNDB/Bangumi/Steam/DLSite 外部数据输入。           |
| `components/admin/*`                       | 后台列表、编辑、审核、日志、邮件和设置。                              |
| `components/user/*`                        | 用户主页、关注、收藏、评论、评分、资源。                              |
| `components/settings/*`                    | 用户设置。                                                            |
| `components/message/*`                     | 消息列表和聊天会话。                                                  |
| `components/tag/*`, `components/company/*` | 标签和公司页面。                                                      |
| `components/doc/*`                         | 文档页导航、目录和内容布局。                                          |

## Client/Server 边界

- `app/*/page.tsx` 默认是 Server Component。
- 需要 hooks、事件、browser API、store 的组件使用 `'use client'`。
- API 调用在 client 组件中通常通过 `utils/kunFetch.ts`。后端若用非 2xx 返回 JSON 字符串业务错误（例如私聊限流 `429`），`kunFetch` 会把该字符串返回给调用方，让现有 `typeof response === 'string'` toast 分支继续工作。
- 页面级 server action 放在对应 `app/<route>/actions.ts`。

## 消息展示

- `components/message/MessageCard.tsx` 将通知正文作为纯文本渲染，并保留换行，用于系统通知展示多行变更摘要。
- 私聊会话详情页使用 `components/message/MessageLayoutChrome.tsx` 做路由级布局控制。只有 `/message/chat/[conversationId]` 会隐藏消息页标题、说明文字和全站面包屑，消息列表页继续保留原有 header、面包屑和消息导航。会话详情页会锁定 document 滚动，只允许 `ChatContainer` 内部消息列表滚动；不要为了取消整页滚动而移除或重写 `ChatContainer` 原本的卡片和内部 `overflow-y-auto` 滚动容器。该页外层通过 `--message-chat-top-reserve` 预留顶部空间，并让聊天卡片高度扣除这段预留；视觉高度微调优先调整这个 CSS 变量，再考虑基础预留值。`MessageNav` 在会话详情页大屏继续作为左侧栏显示，小屏通过 `max-lg:hidden` 隐藏，避免在聊天窗口上方占用高度；消息列表页不使用这条隐藏规则。

## 状态管理

Zustand stores 在 `store/*`：

- `userStore.ts`：当前用户状态。
- `settingStore.ts`：站点设置和 UI 设置。
- `editStore.ts`：创建游戏状态。
- `rewriteStore.ts`：重写游戏状态，详情页会写入当前 patch 数据。
- `milkdownStore.ts`：编辑器状态。
- `searchStore.ts`：搜索历史/条件。
- `messageStore.ts`：消息相关状态。
- `breadcrumb.ts`：面包屑状态。
- `_cookie.ts`：cookie 辅助。

Store 改动要检查使用该 store 的页面和组件，不要只改类型。

消息红点：

- 顶栏和消息导航都以 `messageStore` 作为通知/私聊红点的单一状态源。
- `components/message/MessageRealtimeSync.tsx` 在全站 Provider 中同步登录用户的未读状态。它只读取 `/api/message/unread`，不会标记任何消息已读；系统通知、评论回复、@、关注等新通知在任意页面只通过顶栏铃铛小红点提示，不弹 toast；可见标签页约 15 秒同步一次，隐藏标签页降频，重新可见时立即同步。可见性恢复不能和已有未读同步请求重叠；当前请求完成后再安排下一次轮询。后台未读同步遇到 `notification-read` 限频等字符串业务错误时只保留当前红点状态，不弹重复 toast，也不能把字符串当状态对象写入 store。顶栏 `/api/user/session` 刷新会同步用户资料和未读状态；如果服务端因未读子查询限流返回 `unread: null`，前端只更新用户资料，不覆盖当前红点状态。
- 顶栏铃铛只导航到通知中心，不提前调用 `/api/message/read`。进入通知页时，消息导航在首屏列表已经渲染后乐观清除通知红点，并用 `/api/message/read` 返回的 `MessageUnreadStatus` 回写 store；标记已读请求抛出异常或返回字符串业务错误时必须提示可重试/用户可见错误，并重新读取 `/api/message/unread` 恢复真实红点状态。如果标已读和恢复读取都失败或都返回限频字符串，要回滚到乐观清除前的红点快照。不能用消息导航自己的本地状态覆盖全局状态，旧未读请求晚返回时也不能覆盖已读结果。
- 私聊全局红点来自服务端未读聚合，当前用户已隐藏的私聊不应参与聚合；隐藏会话只有在重新打开或收到新发送消息恢复可见后才重新影响红点。
- 通知列表客户端首次 hydrate 时复用服务端首屏数据，不立刻重新拉取当前页，避免用户第一次看到未读消息时 chip 被刷新成已读。通知列表分页请求可能因用户快速翻页而并发；旧页响应晚返回时不能覆盖最新页的消息和总数。分页遇到 `notification-read` 限频等字符串业务错误时要 toast 服务端重试文案，并保留当前列表内容。清理已读消息属于破坏性操作，必须先展示确认弹窗，再在确认按钮上发起删除请求，保留 loading 和失败 toast；删除接口返回 `notification-write` 限频等字符串错误时保持弹窗和列表，不触发额外刷新。
- 消息导航只在非通知页拉取 `/api/message/unread`，并在路由切换时通过 effect cleanup 忽略过期返回，避免旧未读请求把已读后的红点重新点亮。
- 私聊会话卡片禁用 Next Link 预取，避免个性化聊天详情使用旧 RSC payload。私聊详情页服务端首屏必须严格校验 `conversationId`，并在初始消息 DB 读取前走 `message-read` 限频；非法 ID 或限频命中都通过现有错误组件展示用户可见字符串。私聊详情页打开后立即用 `afterId` 补拉一次当前会话的新消息，并同步调用会话已读接口；首次已读同步抛出异常时必须提示可重试错误，并通过 effect cleanup 忽略过期返回。可见窗口约每 2 秒继续增量获取，隐藏窗口降频并在恢复可见时立即补拉；可见性恢复触发的立即补拉不能和已有实时刷新重叠，避免同一个 cursor 重复请求和重复已读同步。实时游标只记录服务端已同步到的最高消息 ID，本地发送成功的消息不能推进游标，避免双方同时发送时漏掉对方略早的消息。消息按 ID 去重并按时间排序。实时新消息只在用户已经接近底部时自动跟随到底部；如果用户正在上翻阅读历史，后台同步不能抢走滚动位置。当前会话收到对方新消息后，要调用会话已读接口并用返回的 `MessageUnreadStatus` 写回全局红点；该已读请求抛出异常时提示可重试错误，但不能中断本轮实时状态刷新。
- 私聊详情页历史消息上翻使用 `beforeId` 和当前最早消息 ID 加载更早记录。会话消息 API 的首屏、历史和增量响应都应按时间从旧到新返回；组件仍可排序合并作为防御，但不能把服务端响应倒序当成契约。已删除消息的响应应是 tombstone，占位渲染不能依赖服务端继续返回旧正文、图片 metadata 或回复预览；本地删除成功后也要立刻把当前 state 中的正文、图片和回复预览清空成同样的 tombstone，避免等下一轮轮询前继续持有旧 payload。如果输入框正在回复的目标消息被删除或从当前消息集合消失，必须同步清掉回复草稿，避免继续展示一个发送时会被服务端拒绝的引用。组件从服务端首屏 `hasMoreBefore` 初始化顶部哨兵；加载完成后根据响应的 `hasMoreBefore` 决定是否继续观察；顶部哨兵连续触发时不能为同一个游标启动重叠历史请求；加载失败时必须释放 loading 并提示用户，避免顶部 spinner 卡死且无法重试。不要恢复为 page/skip 翻页，否则大对话越往前加载越慢。
- 私聊会话列表首屏 hydrate 时复用服务端首屏数据，不立刻重新拉取第一页，避免用户刚看到私聊列表就被整页 loading 闪烁覆盖。服务端首屏列表和后续 API 列表刷新都走 `message-read` 限频；限频命中时首屏用错误组件展示重试字符串，客户端手动刷新显示 toast，静默轮询不弹噪音提示。之后会后台刷新当前页，刷新时不显示整页 loading，避免列表最新消息和未读 chip 必须靠手动刷新。刷新成功后必须同步服务端返回的 `total`，让分页控件随新建、隐藏或恢复会话后的总数变化更新；翻页和后台刷新可能并发，旧请求晚返回时不能覆盖更新后的当前页，静默后台刷新也不能抢占正在进行的翻页加载。图片-only 最新消息在列表中展示为 `[图片]`，不能显示为空消息；已删除的最后一条消息展示删除占位，不能继续显示被删除的原文。会话列表只能在当前页发现未读时点亮全局私聊红点，不能因为当前页没有未读就清除全局私聊红点；清除必须来自 `/api/message/unread` 或会话已读接口的全局状态。
- 私聊“移除”是当前用户隐藏会话列表记录，不删除双方历史消息。详情页确认弹窗要明确说明只影响自己；移除请求抛出异常时必须显示可重试 toast 并释放危险操作 loading。用户资料页再次发起已有私聊时必须调用创建/打开接口，让服务端恢复隐藏会话后再跳转；检查或创建/打开私聊请求抛出异常时也必须显示可重试 toast 并释放发起按钮 loading。
- 私聊输入框普通 Enter 发送，`Shift+Enter` 换行；输入法组合输入期间的 Enter 只交给 IME 确认候选词，不能触发发送。发送请求使用同步 ref 锁，避免按键连发或按钮/键盘并发造成重复消息。
- 私聊输入框带回复草稿和附件折叠菜单。加号菜单目前只放“图片”，支持文件选择和剪贴板粘贴，最多一次发送 9 张；即使用户在下一次 React 渲染前连续选择或粘贴图片，草稿也只能保留前 9 张。发送前用本地缩略图预览并可打开灯箱，预览区必须提供可访问的单张移除按钮；附件加号菜单必须显示在待发送图片预览和移除按钮上层。发送时先逐张上传图片再发送 `type: 1` 消息；文本说明可为空。图片上传接口可能返回用户可见字符串错误，包括限频、小时额度系统繁忙、萌萌点不足、对象存储失败、metadata 登记失败或 metadata 过期，前端必须沿用 toast 分支展示，不要吞掉余额不足提示；请求抛出异常时要从安全的错误 message 或状态中提取具体原因，显示可重试 toast 并释放发送态。多图上传如果部分失败，无论失败来自服务端字符串还是某个上传请求抛错，前端都必须按图片索引保留已成功上传的 metadata，下一次发送只补传失败项；失败后继续追加图片或移除单张图片时也不能丢掉未变图片的 metadata，避免重复上传和制造更多未发送的私聊图片对象。图片发送成功后必须清空隐藏文件输入的 value，保证用户可以马上再次选择同一张图片。回复草稿显示原发送者、选中文本/原消息摘要，以及被右键图片的小缩略图。消息气泡右键菜单支持“回复”和“回复选中文本”，并且必须可通过聚焦气泡后按 Enter、Space、菜单键或 Shift+F10 打开同一菜单；菜单项要保留可见焦点。图片菜单复制图片链接；右键图片时只高亮当前图片并让回复引用这张图片。图片-only 且无文本说明的自己消息不显示编辑入口，文本编辑弹窗打开后应聚焦文本框；单条消息删除必须先展示确认弹窗，确认后才发起删除请求；编辑或删除请求抛出异常时必须显示可重试 toast 并释放提交态，不能让保存按钮永久 loading。自己的消息使用 Telegram 风格轻量对钩，不显示“已读/未读”文字；所有有正文消息，包括短单行文本、长文本、回复预览正文和图片说明文字，都使用 Telegram 尾部元信息模式：正文保持正常左对齐行内流，尾部追加不可见内联占位为时间/编辑/对钩留空间，元信息贴在同一段落右下角/末行右侧；占位只镜像真实元信息宽度，不能贡献行高、padding 或额外垂直高度；不能用 `text-align-last: justify` 拉伸尾部文字，不能用固定/手写换行、两列 grid、`justify-between`、float 或右侧列占位。图片-only 消息把同一组合放在右下角半透明遮罩中。图片消息需要渲染真实图片预览、可选文本说明和灯箱，多图按紧凑拼图展示。已发送消息里的回复预览可点击短暂滚动到被引用消息并高亮目标内容；聊天窗口离开底部时显示浮动回底部按钮，如果刚通过回复预览跳转，按钮第一次点击应回到跳转前位置并高亮原回复消息，之后再作为普通回底部按钮使用；普通回底部点击同样使用短滚动动画，按钮应在点击时立即原地渐隐，外层退出和按钮自身按压反馈都不能造成先向下位移再消失的观感。

编辑页外部数据输入：

- VNDB、Bangumi、Steam、DLSite 输入会异步写入同一个创建/重写 store。
- 多个外部来源可能连续点击或并发返回；写入 store 时必须基于当前 state 合并，只覆盖该来源负责的字段。
- 不要用请求发起时捕获的旧 `data` 对象整体覆盖 store，否则后返回的 Bangumi/Steam 会丢掉先返回的 VNDB ID、公司、标签或别名。
- VNDB 获取只写入 ID、发售日、别名和 developer，不写入 VNDB 标签。
- Bangumi 获取会保留标签、developer、summary 和标题预览；summary 和标题只通过用户点击按钮填入简介或游戏名称，不自动覆盖已有内容。标题填入时中文名优先，没有中文名则使用原名。
- 公司写入优先级由 API 层处理：VNDB developer 优先，Bangumi developer 兜底；前端仍要保留 Bangumi 标签等非公司字段。
- 创建游戏页的“清除信息”用于从 A 游戏草稿切换到 B 游戏草稿，必须同时 reset `editStore`、清理封面和图库 localforage 草稿，并让封面/图库组件重新读取空状态。

编辑页 gallery：

- 创建页 `components/edit/create/GalleryInput.tsx` 和重写页 `components/edit/rewrite/RewriteGalleryInput.tsx` 都支持 JPG/PNG/WebP/AVIF 选择、拖拽排序、批量删除和 NSFW 标记。
- 创建页和重写页 gallery 都通过 `components/edit/utils/galleryUploadBatch.ts` 逐张上传并保留失败状态。创建页如果游戏主体已创建但截图上传失败，不能清空草稿或跳转详情页；localforage 保留整组图片和已创建 patch 目标，成功项标记为 `uploaded`，失败项标记为 `failed` 并显示错误，重试时只上传失败项。重写页把成功上传的新图并入已有图片，把失败的新图留在 `rewriteStore.newImages`，卡片显示失败原因，下一次提交只重传失败项。
- Gallery 卡片保持原 NSFW 视觉：NSFW 使用红色边框和右上角红色角标。上传失败不要抢占边框语义，使用 `bg-danger/20` 半透明红色遮罩和底部错误条表达，遮罩必须 `pointer-events-none`。
- 从浏览器网页直接拖拽图片到 Windows / 桌面浏览器时，`DataTransfer.files` 可能为空，浏览器只给 `text/uri-list`、`text/plain` 或 `text/html` 里的 `<img src>`，Network 面板也可能显示类型为 Other。gallery drop 必须走 `utils/galleryDrop.ts` 的 `getGalleryFilesFromEvent`，先使用本地 File，若没有 File 再把远程图片 URL 交给 `/api/edit/gallery/remote` 导入为 File。
- “添加水印”只影响静态图片。动态 WebP / AVIF 会保留原始动图并跳过水印，前端需要保留这条提示，避免管理员误以为动图也会被打水印。
- 创建页 gallery 草稿存在 localforage，主体已创建但 gallery 未全部上传完成时还会保存已创建 patch 目标；清除创建草稿时必须同步清理 gallery draft、已创建 patch 目标和水印开关。重写页新增图片存在 `rewriteStore.newImages`，提交成功后由上传接口返回最终 `url` 和 `thumbnailUrl`。
- 详情页和重写页已有 gallery 图片使用 `thumbnailUrl ?? url` 作为列表预览，灯箱始终使用原图 `url`。rewrite 提交已有图片时只传 id、NSFW 和排序，不能把 `thumbnailUrl` 当作原图 URL 写回数据库。
- NSFW 遮罩下仍会加载 `thumbnailUrl ?? url`；如果缩略图是 animated WebP 或 animated AVIF，可以在遮罩下播放。没有生成缩略图的 animated AVIF 会回退加载原图，不生成占位图。
- gallery 原图预载交给 `yet-another-react-lightbox` 的 `carousel.preload`。不要在缩略图 `onLoad` 后用自定义 `Image()` / `decode()` 队列预取原图，否则会和灯箱当前图或相邻图加载重复。
- gallery 展示使用普通 `<img>` 和 `KunImageViewer`，动态 WebP / AVIF 依赖浏览器原生播放，不在前端拆帧或转码。`KunImageViewer` 可以接收 `previewSrc`，通过 `yet-another-react-lightbox` 的 custom slide 先显示缩略图，原图加载完成后淡入切换；灯箱主图、相邻预载和下载都使用原图 `url`。详情页 gallery 保留前后各两张相邻 lightbox slide 来维持滑动动画并预载相邻原图。

## 主题与样式

核心文件：

- `docs/theme-color-system.md`
- `styles/index.css`
- `styles/tailwind.css`
- `styles/themes.css`
- `styles/theme-tokens/otoame.css`
- `styles/theme-tokens/touchgal.css`
- `constants/theme.ts`
- `utils/semanticColor.ts`
- `components/kun/theme/SiteThemeScript.tsx`
- `components/kun/theme/SiteThemeRouteSync.tsx`
- `hooks/useKunSiteTheme.ts`
- `tests/unit/theme.test.ts`

主题持久化规则：

- 实际 CSS 主题只看 `html[data-kun-theme]`，主题控件状态来自 `useKunSiteTheme`。
- `localStorage` 是浏览器端权威来源，`kun-site-theme` cookie 只做服务端首屏或 localStorage 不可用时的兜底；脚本和 hook 都不能让 stale cookie 覆盖 localStorage。
- `SiteThemeScript` 处理硬刷新首屏；`SiteThemeRouteSync` 处理客户端导航后的同步，并在静态页面把根主题恢复成默认值时，从 `localStorage` / `kun-site-theme` cookie 修复 `html[data-kun-theme]`。
- 首页等公开页面保持 `force-static`，不能为了读取主题 cookie 改成动态 SSR；Next.js `force-static` 下 `cookies()` 会返回空值。

修改主题 token 或 semantic color 后至少运行：

```bash
pnpm test tests/unit/theme.test.ts
pnpm typecheck
```

## MDX 内容

入口：

- `posts/*`
- `lib/mdx/getPosts.ts`
- `lib/mdx/directoryTree.ts`
- `lib/mdx/CustomMDX.tsx`
- `components/doc/*`

`getAllPosts` 会递归读取 `posts` 下的 `.mdx`，使用 gray-matter 读取 frontmatter，并生成：

- title
- banner
- date
- description
- textCount
- slug/path

`postbuild.ts` 会把 `posts` 复制进 `.next/standalone/posts`。新增运行时内容目录时，必须同步 postbuild 和 release packaging。

全站 Markdown / MDX 渲染约定为“一个回车即换行”：详情简介、评论、资源备注、文档 MDX 和编辑器预览都应把单个换行渲染为 hard break。

## 编辑器

主要路径：

- `components/kun/milkdown/*`
- `components/kun/milkdown/plugins/*`
- `components/kun/editor/MarkdownEditor.tsx`

编辑器相关改动通常影响创建、重写、评论和 Markdown 预览。要检查：

- 上传插件。
- link/video/emoji/mention 插件。
- Markdown sanitize 和 render。
- mobile layout。

## 前端开发规则

- 新业务组件放在对应 domain 目录，不要把业务逻辑塞进 `components/kun`。
- 共享组件保持通用，不依赖具体 API 响应。
- 新图标优先用 `lucide-react` 或现有图标。
- 用户文案保持 OtoAme 命名，避免误回退到 TouchGal/GalGame。
- NSFW 相关 UI 必须同时检查遮罩、标题、列表过滤和详情隐藏。

## 验证

UI-only 改动：

```bash
pnpm typecheck
```

涉及 stores、主题、搜索、资源、编辑器：

```bash
pnpm test
pnpm typecheck
```
