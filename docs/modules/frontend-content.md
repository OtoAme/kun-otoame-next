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
- API 调用在 client 组件中通常通过 `utils/kunFetch.ts`。
- 页面级 server action 放在对应 `app/<route>/actions.ts`。

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
- “添加水印”只影响静态图片。动态 WebP / AVIF 会保留原始动图并跳过水印，前端需要保留这条提示，避免管理员误以为动图也会被打水印。
- 创建页 gallery 草稿存在 localforage，清除创建草稿时必须同步清理 gallery draft 和水印开关；重写页新增图片存在 `rewriteStore.newImages`，提交成功后由上传接口返回最终 `url` 和 `thumbnailUrl`。
- 详情页和重写页已有 gallery 图片使用 `thumbnailUrl ?? url` 作为列表预览，灯箱始终使用原图 `url`。rewrite 提交已有图片时只传 id、NSFW 和排序，不能把 `thumbnailUrl` 当作原图 URL 写回数据库。
- NSFW 遮罩下仍会加载 `thumbnailUrl ?? url`；如果缩略图是 animated WebP 或 animated AVIF，可以在遮罩下播放。没有生成缩略图的 animated AVIF 会回退加载原图，不生成占位图。
- gallery 原图预载交给 `yet-another-react-lightbox` 的 `carousel.preload`。不要在缩略图 `onLoad` 后用自定义 `Image()` / `decode()` 队列预取原图，否则会和灯箱当前图或相邻图加载重复。
- gallery 展示使用普通 `<img>` 和 `KunImageViewer`，动态 WebP / AVIF 依赖浏览器原生播放，不在前端拆帧或转码。`KunImageViewer` 可以接收 `previewSrc`，通过 `yet-another-react-lightbox` 的 custom slide 先显示缩略图，原图加载完成后淡入切换；灯箱主图、相邻预载和下载都使用原图 `url`。详情页 gallery 保留一张相邻 lightbox slide 来维持滑动动画并预载相邻原图。

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
