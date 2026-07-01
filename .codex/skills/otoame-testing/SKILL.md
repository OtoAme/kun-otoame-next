---
name: otoame-testing
description: Use when adding, fixing, or reviewing tests in kun-otoame-next, especially Vitest tests for APIs, Prisma services, Redis cache, resource links, uploads, themes, or utility functions.
---

# OtoAme Testing

Use this skill for project-specific testing work.

## Required References

- Full testing guide: `docs/project/testing.md`
- Development workflow: `docs/project/development.md`

## Test Stack

- Vitest config: `vitest.config.ts`
- Test root: `tests/unit`
- Runtime: Node environment
- Alias: `~/*` points at repository root

## Rules

- For bugfixes, write a failing regression test before implementation.
- Prefer pure function tests for `utils/*`, `constants/*`, and `validations/*`.
- For API service tests, mock Prisma, Redis, cache helpers, and external APIs.
- Use `vi.hoisted` for values referenced by `vi.mock` factories.
- Do not connect to real PostgreSQL, Redis, S3, GitHub, Bangumi, VNDB, or DLSite in unit tests.
- Gallery upload tests live in `tests/unit/gallery-upload.test.ts`; mock Sharp/S3 and assert static AVIF transform + thumbnail behavior separately from animated WebP/AVIF original-preservation behavior, animated WebP thumbnail frame-size handling, no-benefit fallback, animated AVIF encoder success/fallback/no-placeholder behavior, and S3 compensation.
- Private chat image tests live in `tests/unit/api/conversation-image-upload.test.ts` and `tests/unit/api/conversation-service.test.ts`; mock Sharp/S3/Redis and assert conversation ownership, type/size limits, route-level `image-upload-intake` blocking before multipart parsing, recipient `allow_private_message` blocking image upload before real upload quota/charge/Sharp/S3 work, Redis metadata registration, successful image sends atomically consuming upload metadata so it cannot be replayed, message transaction failures restoring consumed metadata for retry, S3 compensation when registration fails, hourly free quota plus paid overage/refund behavior, image processing/S3 upload/metadata registration failures returning user-visible and distinguishable errors while rolling back quota/refunding paid overage, deleting image messages cleaning only unreferenced S3 objects, repeated deletes of already tombstoned messages not re-running S3 cleanup, and rejection of image message metadata that was not registered for the same conversation and user.
- Message notification route tests should assert `POST /api/message` rejects ordinary users and only allows admins to create arbitrary notification rows; normal product flows should be tested through their service-level `createMessage` calls. Notification read/clear tests should cover idempotent no-op paths so repeated calls do not run empty DB writes.
- User-triggered favorite/like notification tests should cover that adding a relation can notify, but removing an existing favorite/comment-like/rating-like/resource-like must not create or recreate a notification.
- Mention notification tests should cover duplicate mention links, self mentions, nonexistent users, and the per-comment notification cap so ordinary comments cannot amplify `user_message` rows or fail after the comment has already been written.
- Private chat visibility/privacy tests should cover current-user hide instead of row deletion, repeated remove-conversation no-op when the current side is already hidden with no unread count, hidden conversation restore through `getOrCreateConversation`, new-conversation moemoepoint charges using atomic guarded decrement before creating `user_conversation`, concurrent unique-pair create races returning the existing conversation for ordinary and privileged users, send-message restoration for both participants, recipient `allow_private_message` blocking sends even for existing conversations, `POST /api/message/conversation` returning `private, no-store`, and the StartChatButton path that POSTs existing conversations before navigation.
- Private chat unread tests should assert unread aggregation filters out conversations hidden for the current user in both the legacy message-nav status and the top-bar unread status, notification read updates only current-user unread `user_message` rows, message notification list/create/read/unread routes return `private, no-store`, `/api/user/session` returns `private, no-store` and uses `notification-read` before its unread subquery, notification list/unread/read/clear routes return `429` with `Retry-After` and avoid DB work when `notification-read` or `notification-write` is limited, conversation read route params use strict ID parsing before auth/DB work, conversation read-sync uses `message-read` rate limiting before DB work, and conversation read is idempotent when the current user's unread counter is already `0`.
- Private chat summary tests should cover image-only summaries, corrupted image-only summaries without valid media metadata, and deleted latest-message summaries so deleted content does not remain visible in the conversation list and dirty image rows do not look like normal image messages.
- Private chat message-fetch tests should cover chronological response order for the initial page plus `beforeId`/`afterId` cursor behavior, strict route-param and server-rendered page conversation ID parsing before auth/DB work, deleted message responses not exposing original content, media metadata, or reply preview data, and corrupted non-deleted image rows without valid image metadata being normalized to a text placeholder instead of returning `type: 1` with an empty image list.
- Private chat validation tests should cover whitespace-only edits so API schemas do not accept blank updated messages.
- Private chat rate-limit tests should cover user-scoped Redis key construction, send/image-upload-intake/image-upload/conversation-open/conversation-manage/message-read/message-write/notification-read/notification-write thresholds, user-visible retry messages, route-level `429` / `Retry-After` / no-store responses, server-action retry strings for initial conversation lists and initial chat loads, action-rate-limit fail-open behavior on Redis errors, hourly image quota key/cost/rollback behavior, hourly quota unavailable responses, avoiding DB reads/writes when conversation check/open, API-level conversation remove/hide, conversation-list, message fetches, notification list/unread/read/clear, initial chat loads, read-syncs, edits, or deletes are limited, avoiding multipart parsing when image-upload intake is limited, avoiding delete-time S3 cleanup when deletes are limited, avoiding Sharp/S3 work when image upload is limited or cannot be charged, and successful conversation remove/hide route calls consuming exactly one `conversation-manage` check rather than double-counting the service fallback.
- Private chat orphan image cleanup tests should cover dry-run/apply defaults, canonical `conversation/` S3 key validation, time-window protection, DB reference protection for non-deleted messages, tombstone reference cleanup, and delete failure summaries.
- Message realtime sync tests should cover global unread polling not starting overlapping `/api/message/unread` requests when visibility changes while a sync is in flight, preserving current unread store state when background `/api/message/unread` returns a string business error such as `notification-read` rate limiting, and preserving current unread store state when top-bar `/api/user/session` returns `unread: null` because its unread subquery was rate limited.
- Message nav tests should cover `/api/message/read` request exceptions or string business errors showing a retryable/user-visible error, restoring unread state from `/api/message/unread`, falling back to the pre-optimistic-clear unread snapshot when recovery also fails or returns a string, and stale unread responses not overwriting the read result.
- Message container tests should cover notification pagination request races so stale page responses cannot overwrite the latest requested page, pagination string errors preserving the current list with a toast, clearing read notifications requiring a confirmation before the delete request is sent, and delete string errors keeping the dialog/list open without refetching.
- Private chat input tests should cover clearing the hidden file input after a successful image send, capping rapidly appended clipboard/file images at 9, send/image-upload request exceptions showing retryable errors with concrete safe reasons and releasing sending state, accessible per-image removal from multi-image drafts, attachment plus-menu z-index above selected-image previews, and retaining successful image upload metadata across partial multi-image upload failures, including server string failures, thrown upload request failures, and adding/removing images before retry, so retries do not re-upload already successful images.
- Private chat message menu tests should cover keyboard access to the same bubble action menu, not only pointer context-menu or touch paths, long text-only final-line inline metadata without grid or float offsets, compact text-only bubbles vertically centering the text and metadata group, caption/reply text metadata aligned to the content baseline, image-only translucent metadata overlays, single-message delete requiring confirmation before the delete request, and edit/delete request exceptions releasing loading state with retryable user-visible errors.
- Private chat container tests should cover opening-chat and realtime read-sync request exceptions showing retryable user-visible errors without breaking the mounted chat or interrupting the rest of the poll refresh.
- Private chat container tests should cover `beforeId` history pagination failures releasing loading state and showing a retryable user-visible error.
- Private chat container tests should cover `beforeId` history pagination not starting overlapping requests when the top sentinel fires repeatedly for the same cursor.
- Private chat container tests should cover active-chat realtime polling not starting overlapping fetches when visibility changes while a poll is still in flight.
- Private chat container tests should cover realtime messages not forcing the scroll container to the bottom while the user is reading older history.
- Private chat container tests should cover the floating scroll button appearing away from the live edge, using animated normal scroll-to-bottom, starting its in-place fade immediately on normal scroll-to-bottom clicks, fading out before unmount without translate offsets or button transform press feedback, returning to the pre-reply-jump position once after a reply preview jump, highlighting the source reply message, and then falling back to normal scroll-to-bottom behavior.
- Private chat container tests should cover locally deleted messages being converted to tombstones immediately, without retaining stale content, media metadata, or reply preview data in component state.
- Private chat container tests should cover clearing reply drafts whose target message is deleted or removed from the current message set.
- Private chat conversation-list tests should cover first hydration not refetching the server-rendered first page, background refresh syncing returned `total` into pagination, unread-chip refresh, disabled detail-link prefetch, and not clearing global unread state from a current-page-only result.
- Private chat conversation-list tests should also cover overlapping initial/page/poll requests so stale responses cannot overwrite the latest selected page.
- Private chat conversation-list tests should cover silent polling during explicit initial/page loading so background refreshes cannot strand the list in a loading state.
- Private chat remove-conversation tests should cover request exceptions showing a retryable error and releasing the destructive action loading state.
- Private chat start-chat button tests should cover existing hidden conversation restore plus request exceptions from check/open flows showing a retryable error and releasing loading state.
- Gallery create/rewrite failure and drag-import tests live in `tests/unit/gallery-upload-batch.test.ts`, `tests/unit/gallery-drop.test.ts`, `tests/unit/gallery-remote-import.test.ts`, `tests/unit/gallery-remote-route.test.ts`, and `tests/unit/create-patch-draft.test.ts`; cover visible failed state, retryable failures, URL/HTML-only drags, SSRF redirects/private IP rejection, size/content-type validation, role gating, create draft full-image retention, failed-only retry filtering, and created patch target persistence.
- Gallery frontend tests use `tests/unit/gallery-preview.test.ts`, `tests/unit/image-viewer-slides.test.ts`, `tests/unit/patch-gallery.test.tsx`, and `tests/unit/image-viewer.test.tsx` to cover thumbnail/original URL selection, no thumbnail-load original fan-out, lightbox-owned adjacent original preload, adjacent lightbox slide animation preload, and progressive lightbox `previewSrc` behavior.

## Common Commands

```bash
pnpm test
pnpm test tests/unit/gallery-upload.test.ts tests/unit/gallery-route.test.ts
pnpm test tests/unit/patch-update-gallery.test.ts
pnpm test tests/unit/gallery-preview.test.ts tests/unit/patch-gallery.test.tsx tests/unit/image-viewer.test.tsx
pnpm test tests/unit/resource-link.test.ts
pnpm test tests/unit/api/batch-tag.test.ts
pnpm typecheck
```

## What To Assert

- Return values and user-visible behavior.
- Prisma query conditions and transaction writes.
- Cache invalidation calls after writes.
- Upload lock/finalize/compensation behavior.
- Message regressions: feedback work items stay `feedback`, but feedback notices sent to users/admins are `system`.
- Role, permission, owner mismatch, CSRF, and quota edge cases when service-level logic owns them.
- Edit external-data regressions: VNDB company priority, VNDB tags ignored, Bangumi company fallback, Bangumi tags retained, alias-aware tag/company matching, tag alias uniqueness on create/update, Bangumi summary/title copy, duplicate checks excluding current rewrite patch, create-page draft clearing, and async store merges.
- Tag migrations should prefer pure-function tests for generated plans because production tag data is not available locally.

Avoid tests that only duplicate implementation steps without checking behavior.
