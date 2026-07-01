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
- `kunFetch` preserves JSON string business errors from non-2xx responses, such as private chat `429` rate-limit messages, so existing `typeof response === 'string'` toast branches continue to show user-visible errors.
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
- Global message unread sync must not overlap `/api/message/unread` requests. Visibility recovery may trigger immediate sync, but if an unread sync is already in flight, let that request finish and schedule the next poll. If `/api/message/unread` returns a string business error such as `notification-read` rate limiting, background sync must preserve the current unread store state and avoid noisy repeated toasts. The top-bar `/api/user/session` refresh may return `unread: null` when its unread subquery is rate limited; update the user profile from that response but do not overwrite the current message unread store.
- Message navigation must recover from `/api/message/read` request exceptions or string business errors: show a retryable/user-visible error, restore real unread state from `/api/message/unread`, and keep stale unread responses from overwriting the confirmed read result. If both marking notifications read and the recovery unread request fail or return strings, roll back to the unread snapshot from before the optimistic clear.
- Notification list pagination fetches can overlap when users change pages quickly; guard state updates so older page responses cannot overwrite the latest requested notification page. If pagination returns a string business error such as `notification-read` rate limiting, show that toast and keep the current page data instead of clearing the list.
- Clearing read notification messages is destructive. Show a confirmation modal before calling `/api/message/read` delete, and keep confirm-button loading plus retryable error feedback on failure. If `/api/message/read` delete returns a string business error such as `notification-write` rate limiting, keep the dialog/list open, release loading, and do not refetch or clear local notifications.
- Private chat image input must clear the hidden file input value after a successful send, otherwise selecting the same local file again may not fire a browser `change` event.
- Private chat image drafts must cap selected images at 9 even when file selection or paste events append images rapidly before React renders the next state.
- Private chat selected-image previews must expose accessible per-image remove buttons, not only a clear-all action, so users can fix one mistaken attachment without losing the rest of the draft.
- Private chat input send and image-upload request exceptions must show retryable user-visible errors and release the sending state; image-upload request exceptions with a safe concrete `Error.message` should include that reason in the toast. Image-upload string responses, including rate-limit, hourly quota unavailable, insufficient moemoepoints, object-storage failure, metadata registration failure, and expired metadata messages, must be surfaced through the existing toast branch.
- Private chat multi-image sends must retain successfully uploaded image metadata when another image in the batch returns a server string or throws a request error; the next send attempt should only retry missing images, and adding/removing images before retry must keep metadata aligned by image index instead of re-uploading unchanged successful images.
- Private chat opening and realtime read-sync request exceptions must show retryable user-visible errors; opening sync should ignore stale results after unmount or conversation changes, and realtime read-sync failures must not interrupt the rest of the poll refresh.
- Private chat server-rendered detail pages must parse `conversationId` with the same strict decimal helper as API routes before loading initial messages; malformed IDs should render the existing error component without auth or DB reads.
- Private chat active-chat realtime polling must not overlap for the same conversation. Visibility recovery may trigger an immediate fetch, but it should not start a second request while the current realtime fetch is still in flight.
- Private chat active-chat realtime updates should only auto-scroll when the user is already near the live edge; background polling must not steal the scroll position while the user is reading older history.
- Private chat active-chat floating scroll button should appear only when the scroll container is away from the live edge, fade out in place instead of moving during exit, and start the fade immediately when a normal scroll-to-bottom click is triggered while the short animated scroll continues. The button itself should not use transform/scale press feedback that makes the fade look like downward motion. If the user just jumped through a reply preview, the first click returns to the pre-jump scroll position and highlights the source reply message; after that it behaves as a normal scroll-to-bottom button.
- Private chat deleted-message UI must treat deleted messages as tombstones and must not depend on the API continuing to send old content, image metadata, image groups, or reply previews. After a local delete succeeds, clear stale content/media/reply metadata from component state immediately instead of waiting for polling to replace it. If the active reply draft points at a deleted or missing message, clear that draft instead of letting the user send a server-rejected reply.
- Private chat message action menus must stay reachable by keyboard: focus the message bubble and open the same menu with Enter, Space, ContextMenu, or Shift+F10, with visible focus and `menu` / `menuitem` semantics.
- Private chat message metadata must keep Telegram-style compact behavior with explicit layout branches: long text-only messages keep normal inline text flow and place the time, edited marker, and sender-side read check at the end of the final text line, aligned to that line's bottom without a two-column grid or float; compact single-line text-only messages center the text in the bubble and pin metadata to the bubble bottom-right; image, caption, or reply-preview messages pin metadata to the bubble bottom-right; image-only messages place the same metadata group in a translucent bottom-right overlay.
- Private chat message edit/delete actions must catch thrown request errors, show a retryable toast, and release submit/loading state while preserving server-returned string errors. Single-message delete is destructive, so the menu action must open a confirmation modal and only call the delete API after confirmation.
- Private chat history pagination failures must release loading state and show a user-visible retryable error instead of leaving the top history spinner stuck.
- Private chat history pagination must not overlap for the same cursor when the top sentinel fires repeatedly before React loading state updates.
- Private chat conversation-list background refresh must sync the server-returned `total`, not only the current page rows, so pagination updates after conversations are created, hidden, or restored.
- Private chat conversation-list first hydration must reuse the server-rendered first page and avoid immediately showing a loading refetch; fetch again only for page changes or scheduled background refresh.
- Private chat conversation-list fetches can overlap during initial load, manual page changes, and background polling; guard state updates so older responses cannot overwrite the latest requested page.
- Private chat conversation-list silent polling must not supersede an active initial/page loading request; otherwise the explicit request can be ignored and leave the list stuck in loading.
- Private chat remove-conversation request exceptions must show a retryable user-visible error and release the destructive action loading state.
- Private chat start/open request exceptions from user profile buttons must show a retryable user-visible error and release the start-chat loading state.

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
