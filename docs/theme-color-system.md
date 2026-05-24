# 颜色主题系统说明

> **状态：本文档描述当前实现中的颜色主题系统。** 历史设计方案来自本次颜色系统重构讨论；后续维护请以本文档和当前代码为准。

本文档记录站点颜色主题系统的结构、业务 token 约定，以及新增主题时需要检查的地方。

## 主题轴

项目有两套主题轴：

- 站点主题：`html[data-kun-theme]`，目前有 `touchgal` 和 `otoame`
- 明暗模式：`next-themes` 写入的 `.light` / `.dark`

站点主题负责品牌色和业务语义色；明暗模式负责同一站点主题在 light / dark 下的色阶。

## 关键文件

- `styles/themes.css`
  - import 各主题 token 文件
  - 将 `--kun-brand-*` / `--kun-accent-*` 桥接到 HeroUI 的 `--heroui-primary-*` / `--heroui-secondary-*`
  - 对有额外语义映射的主题做专属桥接，例如 otoame 将 `success` 从绿色改为淡蓝
  - 放置跨主题通用规则，例如 dark flat chip 的文字色修正
- `styles/theme-tokens/touchgal.css`
  - 默认主题 token
  - 同时提供 `:root` fallback 和 `html[data-kun-theme='touchgal']`
  - light / dark 双模式显式复刻 HeroUI 默认 blue / purple 色阶
- `styles/theme-tokens/otoame.css`
  - 只覆盖 otoame 与默认主题不同的 token
- `utils/semanticColor.ts`
  - 提供 `semanticChipProps()`
  - 用静态 Tailwind class + CSS 变量桥接业务颜色

## Token 分层

### Layer 1: 品牌色

```css
--kun-brand-50 ... --kun-brand-900
--kun-brand-default
--kun-brand-foreground

--kun-accent-50 ... --kun-accent-900
--kun-accent-default
--kun-accent-foreground

--kun-success-50 ... --kun-success-900
--kun-success-default
--kun-success-foreground

--kun-focus
```

这些 token 会在 `themes.css` 中桥接到 HeroUI：

```css
--heroui-primary: var(--kun-brand-default, var(--kun-brand-500));
--heroui-secondary: var(--kun-accent-default, var(--kun-accent-500));
```

`--kun-success-*` 不是所有主题必须提供的基础 token。默认 touchgal 继续使用 HeroUI 原生 success；otoame 需要把原本的绿色体系改成淡蓝，因此在 `themes.css` 中为 `html[data-kun-theme='otoame']` 单独桥接到 `--heroui-success-*`。

注意：`default` 独立存在是为了匹配 HeroUI dark 模式。dark 下色阶会 swap，但 `primary.DEFAULT` / `secondary.DEFAULT` 不一定等于 `*-500`。

### Otoame 色彩映射

otoame 主题按首页 HeroCard 下方按钮的视觉建立一套系统映射：

```text
HeroUI primary   / 原主题蓝色 -> 签到粉色
HeroUI secondary / 原主题紫色 -> 粉色
HeroUI success   / 原主题绿色 -> 淡蓝色
```

这意味着使用 HeroUI `color="primary"` 的按钮、链接、焦点色会进入与右上角“今日签到”一致的粉色色阶；使用 `color="secondary"` 的头像描边、菜单、标签等会进入粉色色阶；使用 `color="success"` 的平台、SFW、通过/确认状态会进入淡蓝色阶。不要在组件里为了 otoame 单独把 `secondary` 改成绿色或把 `success` 改成蓝色，应该优先调整 `styles/theme-tokens/otoame.css` 中的 token。

首页游戏卡片的资源类型标签是一个特殊业务视觉：它仍属于“原蓝色/primary”语义，但在 otoame 中使用淡紫 -> 淡粉渐变底、紫色文字和轻描边，因此由 `--kun-color-resource-type-bg` / `--kun-color-resource-type-text` / `--kun-color-resource-type-shadow` 单独控制。资源语言、平台、SFW 和会社标签也有 `bg/shadow` 槽位，otoame 中分别对齐 HeroCard 下方按钮的淡粉和淡蓝样式。

### Layer 2: 业务色

业务 token 只在确实需要独立控制时拆分。当前核心 token：

```css
--kun-color-resource-type
--kun-color-resource-type-text
--kun-color-resource-type-bg
--kun-color-resource-type-shadow
--kun-color-resource-type-fg
--kun-color-resource-language
--kun-color-resource-language-text
--kun-color-resource-language-bg
--kun-color-resource-language-shadow
--kun-color-resource-platform
--kun-color-resource-platform-text
--kun-color-resource-platform-bg
--kun-color-resource-platform-shadow
--kun-color-company
--kun-color-company-text
--kun-color-company-bg
--kun-color-company-shadow

--kun-color-content-sfw
--kun-color-content-sfw-text
--kun-color-content-sfw-bg
--kun-color-content-sfw-shadow
--kun-color-content-nsfw
--kun-color-content-nsfw-text

--kun-color-recommend-strong-yes
--kun-color-recommend-strong-yes-text
--kun-color-recommend-yes
--kun-color-recommend-yes-text
--kun-color-recommend-neutral
--kun-color-recommend-neutral-text
--kun-color-recommend-no
--kun-color-recommend-no-text
--kun-color-recommend-strong-no
--kun-color-recommend-strong-no-text

--kun-color-like

--kun-rating-score-ss
--kun-rating-score-s
--kun-rating-score-a
--kun-rating-score-b
--kun-rating-score-c
--kun-rating-star
--kun-rating-badge-bg
--kun-rating-badge-background
--kun-rating-badge-fg
```

Flat Chip 的文字色使用 `*-text` token，用于匹配 HeroUI 原本的 `text-{color}-600/700` 行为。需要渐变或其它非单色背景时，可额外提供完整 CSS 值 token（如 `--kun-color-resource-type-bg`）；需要增强边缘感时，可提供不占位的阴影/描边 token（如 `--kun-color-resource-type-shadow`）。新增业务 Chip token 时应同时考虑 base color、flat text color，以及 solid 场景是否需要 foreground token。

此外，`resource-type` 在详情页头部使用 `solid` 变体，因此额外有 `--kun-color-resource-type-fg`（前景文字色，默认 `var(--heroui-primary-foreground)`）。

### Dark 模式 flat Chip 文字色

HeroUI dark 模式下，`success` / `warning` / `danger` 的 flat Chip 文字直接使用 DEFAULT 而非 600/700 色阶。因此需要在全局（所有主题）覆盖对应 `-text` token：

```css
html.dark[data-kun-theme] {
  --kun-color-resource-platform-text: var(--heroui-success);
  --kun-color-content-sfw-text: var(--heroui-success);
  --kun-color-recommend-yes-text: var(--heroui-success);
  --kun-color-recommend-no-text: var(--heroui-warning);
  --kun-color-recommend-strong-no-text: var(--heroui-danger-500);
  --kun-color-content-nsfw-text: var(--heroui-danger-500);
}
```

这条规则放在 `themes.css` 或 `touchgal.css` 均可，语义上它是跨主题的通用行为。

### Layer 3: 组件微调

例如：

```css
--kun-card-border
--kun-card-glow
--kun-nav-bg
--kun-hero-card-bg
--kun-hero-button-bg
--kun-hero-flower-image
--kun-user-primary-icon
--kun-user-primary-link
--kun-user-primary-flat-bg
--kun-user-primary-flat-text
--kun-user-primary-flat-shadow
```

只有组件确实需要主题专属视觉时才添加这一层。

### 用户页 Primary Accent

otoame 用户页会把 primary 语义拆成三个组件 token：

```css
--kun-user-primary-icon
--kun-user-primary-link
--kun-user-primary-flat-bg
--kun-user-primary-flat-text
--kun-user-primary-flat-shadow
```

它们都从 otoame 的 `--kun-brand-*` 色阶派生，但视觉角色不同：统计图标使用更亮、更饱和的 primary，个人链接使用更深一阶的 primary，浅底按钮和身份 chip 使用更淡的粉底。不要为了调整其中一项直接改组件 class；优先改这些 token。

### 首页 HeroCard

首页 HeroCard 有一组 otoame 专属组件 token，用于复刻粉紫柔光卡片和按钮：

```css
--kun-hero-font-family
--kun-hero-card-bg
--kun-hero-card-shadow
--kun-hero-title-gradient
--kun-hero-subtitle
--kun-hero-eyebrow-bg
--kun-hero-eyebrow-text
--kun-hero-eyebrow-icon
--kun-hero-button-bg
--kun-hero-button-fg
--kun-hero-button-shadow
--kun-hero-icon-button-bg
--kun-hero-icon-button-text
--kun-hero-icon-button-shadow
--kun-hero-nav-tags-bg
--kun-hero-nav-tags-hover-bg
--kun-hero-nav-tags-text
--kun-hero-nav-tags-shadow
--kun-hero-nav-publish-bg
--kun-hero-nav-publish-hover-bg
--kun-hero-nav-publish-text
--kun-hero-nav-publish-shadow
--kun-hero-nav-docs-bg
--kun-hero-nav-docs-hover-bg
--kun-hero-nav-docs-text
--kun-hero-nav-docs-shadow
--kun-hero-flower-image
--kun-hero-flower-opacity
--kun-hero-flower-right
--kun-hero-flower-bottom
--kun-hero-flower-width
--kun-hero-flower-max-width
--kun-hero-flower-aspect-ratio
--kun-hero-flower-position
--kun-hero-flower-background-size
--kun-hero-flower-transform
--kun-hero-flower-transform-origin
```

这些 token 目前只在 `otoame.css` 中覆盖。HeroCard 的圆角沿用原本 Card，不单独做主题 token。HeroCard 字体使用系统宋体栈，优先 `Songti SC`，回退到思源宋体 / Noto Serif CJK / 华文宋体 / SimSun / serif，不引入远程字体下载。由于全局字体规则带 `!important`，HeroCard 字体覆盖也需要在 `themes.css` 中使用 `!important`。按钮描边使用 `box-shadow` 的 `inset 0 0 0 1px ...` 模拟，不使用真实 `border`，因此不会影响按钮位置。light 模式的卡片背景参考粉紫大光圈：圆心在左上外侧，颜色从白 -> 粉 -> 紫。组件里保留了 `.kun-home-hero-flower-slot` 装饰图片槽位，但默认 `--kun-hero-flower-image: none`，因此不会显示花朵素材。

常用调参方式：

```css
--kun-hero-flower-right: 1.5rem; /* 越大越往左收 */
--kun-hero-flower-bottom: 0.5rem; /* 越大越往上抬 */
--kun-hero-flower-width: clamp(11rem, 30vw, 20rem);
--kun-hero-flower-max-width: 52%;
--kun-hero-flower-position: right bottom;
--kun-hero-flower-background-size: contain;
--kun-hero-flower-transform: translate(0.5rem, 0.25rem) scale(1.04);
--kun-hero-flower-transform-origin: right bottom;
--kun-hero-flower-opacity: 0.85;
```

后续接入图片时只需要在主题 token 中设置图片、透明度和位置，不要把背景图写死到组件。

HeroCard 属于 Layer 3 组件微调，颜色 token 使用完整 CSS 值（如 `hsl(...)` / `hsla(...)` / `linear-gradient(...)`），便于 IDE 直接识别和调色；不要按 Layer 1/2 的裸 HSL fragment 格式书写。

### 首页轮播图

otoame 主题下，首页轮播图标题、作者名称和描述使用宋体系：

```css
--kun-carousel-font-family
```

当前默认值复用 `--kun-hero-font-family`。由于全局字体规则带 `!important`，轮播标题、作者名称和描述也在 `themes.css` 中使用 `!important` 覆盖。该规则只作用于 `.kun-home-carousel-title`、`.kun-home-carousel-author` 和 `.kun-home-carousel-description`，不会影响目录 chip、时间 chip 或其它主题。

轮播标题中英混排时，英文/数字片段会包一层 `.kun-home-carousel-title-latin`，中间点会包一层 `.kun-home-carousel-title-separator`。`otoame.css` 提供四个微调 token：`--kun-carousel-title-line-height` 控制标题行高，`--kun-carousel-title-latin-offset` 控制英文/数字视觉上下位置（正值下移，负值上移），`--kun-carousel-title-latin-font-size` 控制英文/数字视觉大小，`--kun-carousel-title-separator-offset` 控制中间点的视觉上下位置。

## Chip 颜色用法

HeroUI 的 `color` prop 只能接收 `primary` / `secondary` / `success` 等固定语义色，不能直接传业务 token。

业务 Chip 应使用：

```tsx
import { semanticChipProps } from '~/utils/semanticColor'

const chip = <Chip {...semanticChipProps('resource-platform')}>Windows</Chip>
```

实现方式是：

- className 保持静态，避免 Tailwind v4 扫描不到动态 class
- 具体颜色通过 `style` 写入 CSS 变量桥
- 使用 HeroUI `classNames.base/content` 覆盖内部 slot

## Flat 和 Solid 的区别

列表、卡片、资源属性区域使用 flat：

```tsx
<Chip {...semanticChipProps('resource-type')} size="sm">
  人工翻译补丁
</Chip>
```

详情页头部的补丁类型使用 solid，以保持信息层级：

```tsx
<Chip {...semanticChipProps('resource-type', { variant: 'solid' })}>
  人工翻译补丁
</Chip>
```

注意：主页游戏卡片底部的资源属性标签来自 `components/kun/PatchAttribute.tsx`，应保持 flat。otoame 主题通过 `--kun-color-resource-type-bg` / `--kun-color-resource-type-text` / `--kun-color-resource-type-shadow` 将类型标签覆盖为淡紫到淡粉渐变底、紫色文字和轻描边；语言标签和会社标签使用 HeroCard 下方“发布页”按钮的淡粉系列，平台标签和 SFW 标签使用“文档”按钮的淡蓝系列。

以下组件**不迁移**到业务 token，继续使用 HeroUI `color` prop（因为它们跟随品牌色，不需要独立控制）：

- 详情页操作按钮（下载 primary、删除 danger、分享/编辑 bordered 等）
- 导航链接和 banner 轮播 chip / 指示点
- 游戏标签 chip（`Tag.tsx`，secondary 语义清晰）
- 用户状态、日志类型等功能性 chip

## 推荐等级映射

推荐等级统一为：

```text
strong_yes -> recommend-strong-yes
yes        -> recommend-yes
neutral    -> recommend-neutral
no         -> recommend-no
strong_no  -> recommend-strong-no
```

视觉默认值对应原本的：

```text
strong_yes -> secondary
yes        -> success
neutral    -> default
no         -> warning
strong_no  -> danger
```

## 评分颜色

评分分数档位：

```css
--kun-rating-score-ss: 43 96% 56%; /* >= 9 */
--kun-rating-score-s: 160 84% 39%; /* >= 7 */
--kun-rating-score-a: 199 89% 48%; /* >= 5 */
--kun-rating-score-b: 27 96% 61%; /* >= 3 */
--kun-rating-score-c: 350 89% 60%; /* < 3 */
```

这些值匹配原先的 Tailwind 固定色：`amber-400`、`emerald-500`、`sky-500`、`orange-400`、`rose-500`。

星星填充使用：

```css
--kun-rating-star
```

游戏卡片评分角标使用：

```css
--kun-rating-badge-bg
--kun-rating-badge-background
--kun-rating-badge-fg
```

`--kun-rating-badge-bg` 保留为 HSL fragment，用于 touchgal 等纯色主题；`--kun-rating-badge-background` 是完整 CSS 背景值，允许 otoame 这类主题使用渐变。组件应直接把 `--kun-rating-badge-background` 用作 `background`，不要把渐变塞进 `hsl(var(...))`。

星星和角标不要复用同一个 token；它们视觉角色不同。

## 新增主题步骤

大多数新主题只需改 Layer 1（品牌色 + 强调色），Layer 2/3 默认值会自动继承 touchgal 的业务语义映射。如果新主题像 otoame 一样需要把 HeroUI 的 `success`、`warning`、`danger` 也换成另一套主题色，需要新增对应 `--kun-success-*` 等 token，并在 `themes.css` 中添加主题专属桥接。

1. 复制 `styles/theme-tokens/touchgal.css` 为新文件，改名。
2. 修改 Layer 1 token：`--kun-brand-*`、`--kun-accent-*`、`--kun-focus`（light 和 dark 都要）。
3. 设置 light / dark 下的 `--kun-brand-default` 和 `--kun-accent-default`（dark 下 `secondary.DEFAULT` 通常不等于 `accent-500`）。
4. 如需重映射 `success` 等 HeroUI 语义色，补充对应色阶 token，并在 `styles/themes.css` 加主题专属桥接。
5. 只覆盖需要变化的 Layer 2 业务 token（大部分不需要动）。
6. 只在需要主题专属视觉效果时覆盖 Layer 3 组件 token（如 `--kun-card-border`、`--kun-hero-card-bg`）。
7. 在 `styles/themes.css` 中 `@import` 新 token 文件。
8. 在 `constants/theme.ts` 注册主题。
9. 检查 light / dark 两种模式。

## 验证命令

```bash
pnpm typecheck
pnpm build

# 使用 rg（ripgrep）—— macOS 可通过 brew install ripgrep 安装
rg "#f31260|#006FEE" components app styles -g '*.tsx' -g '*.ts' -g '*.css'
rg "text-amber-|text-emerald-|text-sky-|text-orange-|text-rose-" components app -g '*.tsx'
rg -- "--heroui-border\b|--heroui-background-\d|--heroui-overlay-\d|--heroui-foreground-\d" components app styles -g '*.ts' -g '*.tsx' -g '*.css'
rg "hsl\(var\([^)]+\)\)\d|\$\{colors\.[^}]+\}\d" components/kun/milkdown/codemirror/theme.ts
```

`pnpm build` 可能需要本地 Redis / Prisma 依赖可访问；如果在受限沙箱里运行，可能会在预渲染阶段失败。

如果改为全仓库扫描，以下命中属于已知例外，不属于运行时主题系统：

- `constants/theme.ts` / `tests/unit/theme.test.ts` 的 `previewColor` — 主题注册元数据，使用普通 hex 便于直接作为内联色
- `constants/email/templates/touchgal.ts` — 邮件模板内联色
