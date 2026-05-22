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

--kun-focus
```

这些 token 会在 `themes.css` 中桥接到 HeroUI：

```css
--heroui-primary: var(--kun-brand-default, var(--kun-brand-500));
--heroui-secondary: var(--kun-accent-default, var(--kun-accent-500));
```

注意：`default` 独立存在是为了匹配 HeroUI dark 模式。dark 下色阶会 swap，但 `primary.DEFAULT` / `secondary.DEFAULT` 不一定等于 `*-500`。

### Layer 2: 业务色

业务 token 只在确实需要独立控制时拆分。当前核心 token：

```css
--kun-color-resource-type
--kun-color-resource-type-text
--kun-color-resource-type-fg
--kun-color-resource-language
--kun-color-resource-language-text
--kun-color-resource-platform
--kun-color-resource-platform-text

--kun-color-content-sfw
--kun-color-content-sfw-text
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
--kun-rating-badge-fg
```

Flat Chip 的文字色使用 `*-text` token，用于匹配 HeroUI 原本的 `text-{color}-600/700` 行为。新增业务 Chip token 时应同时考虑 base color、flat text color，以及 solid 场景是否需要 foreground token。

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
--kun-breadcrumb-bg
--kun-background-glow-rose
```

只有组件确实需要主题专属视觉时才添加这一层。

## Chip 颜色用法

HeroUI 的 `color` prop 只能接收 `primary` / `secondary` / `success` 等固定语义色，不能直接传业务 token。

业务 Chip 应使用：

```tsx
import { semanticChipProps } from '~/utils/semanticColor'

<Chip {...semanticChipProps('resource-platform')}>Windows</Chip>
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

注意：主页游戏卡片底部的蓝色补丁类型标签来自 `components/kun/PatchAttribute.tsx`，应保持 flat，和重构前的 `variant="flat" color="primary"` 对齐。

以下组件**不迁移**到业务 token，继续使用 HeroUI `color` prop（因为它们跟随品牌色，不需要独立控制）：

- 详情页操作按钮（下载 primary、删除 danger、分享/编辑 bordered 等）
- 导航链接和 banner 轮播 chip / 指示点
- 游戏标签和会社 chip（`Tag.tsx`、`Company.tsx`，secondary 语义清晰）
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
--kun-rating-score-ss: 43 96% 56%;   /* >= 9 */
--kun-rating-score-s: 160 84% 39%;   /* >= 7 */
--kun-rating-score-a: 199 89% 48%;   /* >= 5 */
--kun-rating-score-b: 27 96% 61%;    /* >= 3 */
--kun-rating-score-c: 350 89% 60%;   /* < 3 */
```

这些值匹配原先的 Tailwind 固定色：`amber-400`、`emerald-500`、`sky-500`、`orange-400`、`rose-500`。

星星填充使用：

```css
--kun-rating-star
```

游戏卡片评分角标使用：

```css
--kun-rating-badge-bg
--kun-rating-badge-fg
```

星星和角标不要复用同一个 token；它们视觉角色不同。

## 新增主题步骤

大多数新主题只需改 Layer 1（品牌色 + 强调色），Layer 2/3 默认值会自动继承 touchgal 的业务语义映射。

1. 复制 `styles/theme-tokens/touchgal.css` 为新文件，改名。
2. 修改 Layer 1 token：`--kun-brand-*`、`--kun-accent-*`、`--kun-focus`（light 和 dark 都要）。
3. 设置 light / dark 下的 `--kun-brand-default` 和 `--kun-accent-default`（dark 下 `secondary.DEFAULT` 通常不等于 `accent-500`）。
4. 只覆盖需要变化的 Layer 2 业务 token（大部分不需要动）。
5. 只在需要主题专属视觉效果时覆盖 Layer 3 组件 token（如 `--kun-card-border`、`--kun-background-glow-*`）。
6. 在 `styles/themes.css` 中 `@import` 新 token 文件。
7. 在 `constants/theme.ts` 注册主题。
8. 检查 light / dark 两种模式。

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
- `constants/theme.ts` 的 `previewColor: '#006FEE'` — 主题注册元数据
- `constants/email/templates/touchgal.ts` — 邮件模板内联色
