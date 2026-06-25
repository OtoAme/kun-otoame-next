---
name: otoame-frontend
description: Use when changing kun-otoame-next App Router pages, React components, Zustand stores, theme tokens, MDX content rendering, editors, navigation, NSFW UI, or user-facing frontend workflows.
---

# OtoAme Frontend

Use this skill for pages, components, state, theme, and content.

## Required References

- App Router guide: `docs/modules/app-router.md`
- Frontend/content guide: `docs/modules/frontend-content.md`
- Theme guide: `docs/theme-color-system.md`

## Rules

- Use Server Components by default; add `'use client'` only for hooks, events, stores, or browser APIs.
- Keep business-specific UI in domain folders; keep `components/kun` generic.
- Update metadata for new pages.
- Check NSFW behavior across list, detail, title, and mask flows.
- For tag/company detail pages, preserve the static-cache split: company may reuse an SFW static first page only for anonymous default filters, while login/NSFW `nsfw` or `all`/blocked-tag cookies must trigger a client list fetch; tag detail should fetch its game list on client mount.
- Use `utils/kunFetch.ts` or preserve the CSRF header behavior for state-changing client requests.
- Keep user-facing copy on OtoAme/OtomeGame naming unless referencing compatibility paths.
- For edit external-data inputs, merge async source results with the latest store state and only overwrite fields owned by that source.
- Bangumi title/summary should only fill game name/introduction after an explicit user click; title fill prefers `nameCn`, then `name`.
- Create edit-page clear actions must reset `editStore`, localforage banner/gallery drafts, and remount local draft UI state.
- Create/rewrite gallery inputs must keep the watermark notice accurate: static images may be watermarked server-side, but animated WebP/AVIF are preserved as originals and skip watermarking.
- Gallery grids should render `thumbnailUrl ?? url`, while lightboxes and rewrite persistence use original `url`. Rewrite must never save `thumbnailUrl` as the original URL.
- Gallery original prefetch should follow current gallery slot order, not filename or image id ordering. NSFW masks still load `thumbnailUrl ?? url`; animated AVIF v1 has no generated thumbnail and falls back to the original URL.
- Theme changes need `tests/unit/theme.test.ts`. For theme persistence, keep `SiteThemeScript`, `SiteThemeRouteSync`, `useKunSiteTheme`, `kun-site-theme` cookie, `localStorage`, and `html[data-kun-theme]` synchronized; browser-side `localStorage` is the source of truth, with cookie only as fallback. Cover hard-load/redeploy and client-navigation static-shell regressions where the option shows `otoame`/Pink but the root DOM falls back to `touchgal`/Classic.
- Home page remains `force-static`: only fetch `/api/home` from the client when the static `galgames` payload is empty, and keep non-empty home payloads on the zero-extra-API path except for `/api/patch/stats`.
- Do not make public `force-static` pages dynamic just to read the site theme cookie. Next.js `force-static` treats request cookies as empty, so client theme repair belongs in `SiteThemeScript` / `SiteThemeRouteSync` / `useKunSiteTheme`.

## Verification

```bash
pnpm test tests/unit/company-detail-container.test.tsx
pnpm test tests/unit/tag-detail-container.test.tsx
pnpm test tests/unit/edit-store.test.ts
pnpm test tests/unit/gallery-upload.test.ts
pnpm test tests/unit/gallery-prefetch.test.ts tests/unit/gallery-preview.test.ts
pnpm test tests/unit/theme.test.ts
pnpm typecheck
```
