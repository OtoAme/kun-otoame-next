---
name: otoame-documentation
description: Use when authoring, updating, or reviewing technical and business maintenance documentation in kun-otoame-next, excluding user-facing release notes handled by otoame-changelog.
---

# OtoAme Documentation

Scope includes `docs/`, `README.md`, operations, and deployment guides.

## Required Reference

- [Documentation standard](../../docs/project/documentation.md)

Read the standard before editing prose. It is the single source of truth for voice, structure, and factual gates.

## Core Workflow

1. **Classify task & audience**: Identify content type. Keep one primary job per page. Verify version, release, environment, and permission boundaries when they affect readers.
2. **Verify facts first**: Check claims against source, tests, or runtime evidence. Net new explanations need verified mechanisms. Never leave unverified assumptions in finished docs.
3. **Draft concisely**: Follow formal, compact prose. How-to procedures require prerequisites, verified steps, observable results, and recovery paths for failures (report gaps instead of inventing steps). Distinguish runnable commands from illustrations.
4. **Preserve working prose**: Retain accurate existing text; edit only to fix factual errors, ambiguity, or broken tasks.
5. **Recheck the rewrite**: Audit added claims and recovery steps. Unsupported steps belong in review notes, never ready-to-publish prose.
6. **Check incoming links**: Link every new or moved page from another maintained documentation page.

## Verification Gate

Use `pnpm docs:check` for focused iteration, and run `pnpm test:docs-contracts` before final handoff.

Mechanical checks verify relative links, placeholders, headings, and inbound links. They do not prove factual accuracy or task usability.
