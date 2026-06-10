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
- Use `utils/kunFetch.ts` or preserve the CSRF header behavior for state-changing client requests.
- Keep user-facing copy on OtoAme/OtomeGame naming unless referencing compatibility paths.
- Theme changes need `tests/unit/theme.test.ts`.

## Verification

```bash
pnpm test tests/unit/theme.test.ts
pnpm typecheck
```
