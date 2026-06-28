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
