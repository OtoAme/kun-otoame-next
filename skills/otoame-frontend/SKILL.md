---
name: otoame-frontend
description: Use when changing or reviewing kun-otoame-next pages, React components, state, themes, content rendering, editors, navigation, or frontend workflows. Applies HeroUI v2 to the site and legacy admin, and shadcn to the dashboard, with accessibility and theme integration.
---

# OtoAme Frontend

Use this skill for pages, components, state, theme, and content.

## Required References

- `docs/modules/app-router.md` — 首页, 用户与消息页面, 标签和公司详情页
- `docs/modules/frontend-content.md` — 资源详情与下载, 萌萌点, 消息展示, 状态管理, 用户资料设置, 主题与样式, 投稿页面
- `docs/modules/private-chat-stickers.md` — 管理后台
- `docs/theme-color-system.md` — `--kun-*` / `--kun-chat-*` tokens
- `docs/modules/workspace.md` — independent user shell, private editing and maintenance projection

## Mobile and Responsive Layout

- Treat mobile display and touch usability as baseline requirements for all frontend work, including the site, legacy admin, dashboard and shared components. Consider narrow screens when designing, changing or reviewing UI, even when the request or reference only shows a desktop layout.
- Adapt to available width: reflow columns, sidebars, split panes and action rows; constrain long text, links, media and tables without unintended page-level horizontal scrolling. Keep essential content and actions reachable on mobile; use local scrolling where the content requires it.
- Keep text readable and touch targets comfortably sized and spaced. Core actions must work without hover. Menus, dialogs and drawers must fit the available viewport and keep their content and controls reachable; account for the virtual keyboard and safe areas when relevant.

## Site and Legacy Admin: HeroUI v2

- Pages under `app/(site)` and their components, including legacy `/admin` and administrator previews, use HeroUI v2. Read the `@heroui/react` version from `package.json` and check current v2 docs through Context7; never apply v3 APIs.
- Pick building blocks in order: existing project component → HeroUI v2 component → composed HeroUI primitives → native/custom only when HeroUI has no v2 capability. Justify exceptions at handoff.
- Never rebuild buttons, form controls, tabs, cards, chips, badges, tables, pagination, loading states, menus, tooltips, popovers, drawers or dialogs from raw elements plus Tailwind.
- Preserve React Aria behavior: documented props and slots, labels, errors, keyboard interaction, focus visibility and restoration, disabled/loading semantics, overlay dismissal.
- Customize in order: props and variants → `className` / `classNames` slots → HeroUI theme tokens → project `--kun-*` tokens. Never fork HeroUI markup, target generated class names, or scatter one-off `dark:` fixes. Respect `prefers-reduced-motion`.

## Dashboard: shadcn

- `app/(dashboard)` uses `components/dashboard/ui` and shadcn composition. Keep HeroUI providers, legacy admin components, site theme scripts and site CSS out of its import tree.
- `components.json` targets `styles/dashboard.css` and dashboard aliases. Preserve the separate Tailwind source scopes and the official component license in `components/dashboard/ui/LICENSE`.
- Both roots share the `next-themes` light/dark storage key; site `--kun-*` / `data-kun-theme` palettes belong to the site root. Validate both style outputs when changing either source boundary.
- Dashboard inbox and review requests use the existing `/api/admin/*` HTTP APIs and `kunFetch`; do not add a parallel server-action write channel.
- Persist split widths only through `useResizableLayout` (`components/dashboard/ui/resizable.tsx`): pass its `groupRef` to `ResizablePanelGroup`, use stable Panel ids and pass matching `panelIds` in DOM order so re-entry and refresh restore widths. The hook reads an empty store until mounted so hydration matches the server, then applies the saved layout through `groupRef`. Case queue cards align status, prior resolution, reopen count and time at the right edge; wide table status text stays left-aligned.
- Shoutbox site surfaces use HeroUI v2; `/dashboard/shoutbox` uses shadcn Tabs and dialogs. Hide, remove, restore, resolve, end and cancel must open confirmation UI before the request; dismissal writes nothing and restores focus. Official removal is labelled 移除 / 已移除 and remains available on expired status-0 announcements; its confirmation explains that public history is removed, while early ending retains it.

## Rules

- Workspace identity comes from the server session, not persisted site user state. Capture editor bases once, isolate stale list/detail responses, retain failed drafts, and clear consumed upload references after committed saves. Health and maintenance merge independently within the same address version; expiry rereads never submit feedback.

- Resource links show independent health, machine observation and report facts through server capabilities. Bind credentials/actions/callbacks to the full target, version and current read snapshot; a same-version new snapshot must discard old credentials and late results. The card uses a health dot plus always-on status text; machine/report/processing details stay in the dot popover. Mirror chrome follows the resource-card demo (nested HeroUI `Card`s with `shadow="none"` and `overflow-visible` plus `min-w-0 max-w-full` on Card/CardBody, semibold 链接 #N title, solid get-link, 20px white disk tiles for the five netdisk hosts, pan.otoame.top, object storage, and unrecognized links). Do not rebuild those cards, report callouts, or the health-dot trigger from raw `div`/`button` plus Tailwind; the health-dot is `Button size="sm" isIconOnly` with a 24px box so the status line is not stretched to 32px. The mirror title row's right side is icon-only 检测链接, 补链, and 报告失效 after reveal, with 报告失效 last and the names on Tooltip plus `aria-label`. The publisher, like, and download row stays the production `flex justify-between` / `flex gap-2` and does not host 遇到问题. Verify / confirm-broken / staff resolve sit in a dashed 处理 strip. Revealed download URLs shrink to content (`w-fit max-w-full` in a `min-w-0 max-w-full` wrapper) so empty space on that row does not navigate. Credential Snippets wrap via `classNames.pre` `!whitespace-pre-wrap break-all` because the HeroUI theme `pre` is nowrap. Title and note keep production `flex-col` / `mt-2` / `kun-prose` spacing. Broken links remain gettable after the resource-level fold and selectable in the two-step report entry. See `docs/modules/frontend-content.md`.
- Capture full `baseLinks` once per resource edit session, preserve drafts on 409 and never replace the old base during background refresh. Broken inbox edits use the existing role-3 HeroUI `/admin/resource/link/<resourceId>?linkId=<linkId>` page and exact administrator DTO, never a download grant; dashboard details remain shadcn and return with valid inbox kind/id selection.
- Deleted case targets keep their dialogue and historical participant capabilities (D37). Suppress dead target links and resource-dependent actions; require a nonblank manual closure/proposal note through the shared `caseClosingNoteError`, passing the closing side: 不在受理范围 needs a guide link from publishers but only a reason from site administrators (D39). Keep drafts and errors when the server rejects a stale operation.

- `/workspace/issues` uses shadcn under the `(dashboard)` route group (`components/dashboard/issue/`) and `/dashboard/case/[id]` uses the shared shadcn case detail; case entries embedded in site pages stay HeroUI v2. Both sides share UI-free logic in `components/case/caseDisplay.ts` and the resource-card phenomenon table in `constants/issueTriage.ts`. Consume `types/api/case.ts` capabilities and redacted fields; do not fetch identities or dialogue omitted for the viewer. Confirm every case moderation action, including message hide/unhide, before sending the request. Render case dialogue through `components/dashboard/case/CaseMessageText.tsx`. The inbox's embedded case detail signals the inbox only when the case leaves the queue; the inbox's conflict refresh would remount it and drop drafts. Case copy on site pages and `/workspace/issues` says 网站管理员, not 站方; the dashboard keeps 站方 and names the staff console 事项中心 in titles, header and navigation.
- Take a case reply's side only from `caseMessageSide`, which trusts the server's `authorSide`; an unmarked author other than the opener is another reporter, never the handler. Dialogue avatars use `components/dashboard/ui/avatar.tsx` only for authors the response already carries; the fallback initial keeps the side colours (handler primary, deleted account dashed), and both stay `aria-hidden`. Case-center group titles read `<group> · 站方` / `只读 · 发布者` and label their lists.
- Wrong-patch resources are reported only from the resource card (`wrong_patch` → `resource_wrong_patch`, always 网站管理员). The game feedback's 资源发错条目 and 资源链接失效 are guides: they close the modal and open the 资源链接 tab through `onOpenResources`, and create no case or fetch resources. 求资源或催更 is a case on both entries (`resource_request`, D40): the game feedback files it against the patch for 网站管理员, the resource card against the resource for its publisher, and both show `REQUEST_RESOURCE_GUIDE_NOTE` and `REQUEST_RESOURCE_GUIDE_LINKS` above the input. A case destination in `constants/issueTriage.ts` may carry a `guide` rendered above the handler hint and the input; only guide destinations (下载慢) have no submit button.
- Frontend gating is UX only; the API must re-check every permission.
- Download credentials (`content`, `code`, `password`) live only in component memory — never in stores, persisted state, URLs or caches. Authenticated administrator inbox details and resource previews may receive full links; public list data stays redacted.
- State-changing requests use `utils/kunFetch.ts` (CSRF header); surface its string business errors, never swallow them.
- Profile fields prefill saved text and enable saving only for valid changes after trimming. Update saved state only on success; preserve drafts on failure and during background refresh.
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

- For layout or interaction changes, check the affected UI in a browser at a narrow phone width (around 360 CSS px) and a desktop width; include tablet widths and relevant breakpoint transitions when the layout changes there. Exercise relevant long content, navigation, forms and overlays for overflow, clipping, scrolling and touch access.
- Automated tests and type checks do not establish mobile layout correctness. Report which viewport sizes and interactions were checked, and state any browser verification that could not be completed.

```bash
pnpm test tests/unit/<target>.test.ts   # while iterating
pnpm test:changed && pnpm typecheck     # default commit gate
pnpm test                               # checkpoints — see docs/modules/quality.md
```
