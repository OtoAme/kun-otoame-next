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
- Create/rewrite gallery uploads must preserve failed images visibly and retryably. Create must not clear localforage gallery draft or navigate away when the patch is created but screenshots fail; retain the full gallery draft plus the created patch target, mark successful items `uploaded`, mark failed items `failed`, dispatch the gallery-draft-updated event, and retry only failed screenshots without requiring the banner/form again. Rewrite must merge successful new images into existing images, keep failed new images in `rewriteStore.newImages` with `uploadStatus/uploadError`, and label the submit action as a retry when failures remain.
- Create/rewrite gallery cards keep the original NSFW styling: danger border plus top-right danger badge. Failed uploads should not override that border; show a `bg-danger/20` non-interactive overlay plus the bottom error strip.
- Gallery drop zones must use `utils/galleryDrop.ts` / `getGalleryFilesFromEvent`: browser-to-page image drags, especially on Windows, may provide only URL/HTML data instead of `DataTransfer.files`. Local files take precedence; URL/HTML imports go through `/api/edit/gallery/remote`.
- Create/rewrite gallery inputs must keep the watermark notice accurate: static images may be watermarked server-side, but animated WebP/AVIF are preserved as originals and skip watermarking.
- Gallery grids should render `thumbnailUrl ?? url`, while lightboxes and rewrite persistence use original `url`. Pass `previewSrc` separately for progressive lightbox rendering; rewrite must never save `thumbnailUrl` as the original URL.
- Gallery original prefetch should use `yet-another-react-lightbox`'s `carousel.preload`, not a custom `Image()` + `decode()` queue. Do not enqueue originals from thumbnail `onLoad` or lightbox `view`; that duplicates current or adjacent original requests. Detail gallery keeps two adjacent lightbox slides on each side for fast navigation, slide animation, and adjacent original preload. NSFW masks still load `thumbnailUrl ?? url`; animated AVIF without a generated thumbnail falls back to the original URL.
- Theme changes need `tests/unit/theme.test.ts`. For theme persistence, keep `SiteThemeScript`, `SiteThemeRouteSync`, `useKunSiteTheme`, `kun-site-theme` cookie, `localStorage`, and `html[data-kun-theme]` synchronized; browser-side `localStorage` is the source of truth, with cookie only as fallback. Cover hard-load/redeploy and client-navigation static-shell regressions where the option shows `otoame`/Pink but the root DOM falls back to `touchgal`/Classic.
- Home page remains `force-static`: only fetch `/api/home` from the client when the static `galgames` payload is empty, and keep non-empty home payloads on the zero-extra-API path except for `/api/patch/stats`.
- Do not make public `force-static` pages dynamic just to read the site theme cookie. Next.js `force-static` treats request cookies as empty, so client theme repair belongs in `SiteThemeScript` / `SiteThemeRouteSync` / `useKunSiteTheme`.

## Verification

```bash
pnpm test tests/unit/company-detail-container.test.tsx
pnpm test tests/unit/tag-detail-container.test.tsx
pnpm test tests/unit/edit-store.test.ts
pnpm test tests/unit/gallery-upload.test.ts
pnpm test tests/unit/gallery-preview.test.ts tests/unit/patch-gallery.test.tsx tests/unit/image-viewer.test.tsx
pnpm test tests/unit/theme.test.ts
pnpm typecheck
```
