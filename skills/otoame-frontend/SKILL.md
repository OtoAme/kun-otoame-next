---
name: otoame-frontend
description: Use when changing or reviewing kun-otoame-next pages, React components, state, themes, content rendering, editors, navigation, or frontend workflows. Applies HeroUI v2 to the site and legacy admin, and shadcn to the dashboard, with accessibility and theme integration.
---

# OtoAme Frontend

Use this skill for pages, components, state, theme, and content.

## Required References

- `docs/modules/app-router.md` — 首页, 用户与消息页面, 标签和公司详情页
- `docs/modules/frontend-content.md` — 资源详情与下载, 萌萌点, 消息展示, 状态管理, 主题与样式, 投稿页面
- `docs/modules/private-chat-stickers.md` — 管理后台
- `docs/theme-color-system.md` — `--kun-*` / `--kun-chat-*` tokens

## Site and Legacy Admin: HeroUI v2

- Pages under `app/(site)` and their components, including legacy `/admin` and administrator previews, use HeroUI v2. Read the `@heroui/react` version from `package.json` and check current v2 docs through Context7; never apply v3 APIs.
- Pick building blocks in order: existing project component → HeroUI v2 component → composed HeroUI primitives → native/custom only when HeroUI has no v2 capability. Justify exceptions at handoff.
- Never rebuild buttons, form controls, tabs, cards, chips, badges, tables, pagination, loading states, menus, tooltips, popovers, drawers or dialogs from raw elements plus Tailwind.
- Preserve React Aria behavior: documented props and slots, labels, errors, keyboard interaction, focus visibility and restoration, disabled/loading semantics, overlay dismissal.
- Customize in order: props and variants → `className` / `classNames` slots → HeroUI theme tokens → project `--kun-*` tokens. Never fork HeroUI markup, target generated class names, or scatter one-off `dark:` fixes. Keep layouts responsive, touch-safe and `prefers-reduced-motion` aware.

## Dashboard: shadcn

- `app/(dashboard)` uses `components/dashboard/ui` and shadcn composition. Keep HeroUI providers, legacy admin components, site theme scripts and site CSS out of its import tree.
- `components.json` targets `styles/dashboard.css` and dashboard aliases. Preserve the separate Tailwind source scopes and the official component license in `components/dashboard/ui/LICENSE`.
- Both roots share the `next-themes` light/dark storage key; site `--kun-*` / `data-kun-theme` palettes belong to the site root. Validate both style outputs when changing either source boundary.
- Dashboard inbox and review requests use the existing `/api/admin/*` HTTP APIs and `kunFetch`; do not add a parallel server-action write channel.
- Shoutbox site surfaces use HeroUI v2; `/dashboard/shoutbox` uses shadcn Tabs and dialogs. Hide, remove, restore, resolve, end and cancel must open confirmation UI before the request; dismissal writes nothing and restores focus.

## Rules

- Frontend gating is UX only; the API must re-check every permission.
- Download credentials (`content`, `code`, `password`) live only in component memory — never in stores, persisted state, URLs or caches. Authenticated administrator inbox details and resource previews may receive full links; public list data stays redacted.
- State-changing requests use `utils/kunFetch.ts` (CSRF header); surface its string business errors, never swallow them.
- Author submission forms mutate only in `draft` and `changes_requested`; other statuses disable every mutation and external-fetch control.
- Submission review actions live in `/dashboard/inbox` details and legacy `/admin/submission/[id]`; self-review needs an explicit super-admin override. Every moderation action, including keyboard shortcuts, opens confirmation before writing; preserve existing legacy confirmations without nesting another.
- `/preview/submission/[id]` and `/preview/resource/[id]` require an administrator. Resource `preview` rendering must skip restore/access/download requests and show likes as static counts.
- A failed gallery upload must never clear the localforage draft or navigate away; keep failures retryable.
- Submission autosave is one serial promise chain reading `revision` at execution time; save, submit and preview stop on a failed `flush()`. Never retry a real conflict.
- Public `force-static` pages must not become dynamic to read cookies; theme repair belongs in `SiteThemeScript` / `SiteThemeRouteSync` / `useKunSiteTheme`.
- Moemoepoint balances can be negative — danger semantics, never clamp to 0.
- Polling, hydration and pagination must not overlap or let stale responses overwrite newer state.
- Public shoutbox reads use the shared query layer and gated refresh; preserve identity/preference isolation, SSR seed ownership, hidden-page silence, error cooldown and write invalidation. Time-bound display cleanup must not rewrite cached receipt/error state. See `docs/modules/frontend-content.md` for the contract.
- Destructive actions need confirmation and must release loading state on failure.

## Verification

```bash
pnpm test tests/unit/<target>.test.ts   # while iterating
pnpm test:changed && pnpm typecheck     # default commit gate
pnpm test                               # checkpoints — see docs/modules/quality.md
```
