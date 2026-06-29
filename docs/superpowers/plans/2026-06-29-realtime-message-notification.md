# Realtime Message And Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Private messages and notification red dots update without manual page refresh.

**Architecture:** Use lightweight client polling. A global client component syncs unread state into `messageStore`; chat and conversation-list components fetch incremental/current conversation data while visible. The API adds cursor-like `afterId` support to the existing conversation messages endpoint.

**Tech Stack:** Next.js 15 App Router, React 19, Zustand, Prisma 7, Vitest 4, existing `utils/kunFetch.ts` wrappers.

## Global Constraints

- Keep route handlers thin: parse input, verify auth, call service/helper, return `NextResponse.json`.
- Use `messageStore` as the single frontend source of truth for notification and conversation red dots.
- Keep `/api/message/unread`, `/api/message/read`, and `/api/message/conversation/[id]/read` personalized and `private, no-store`.
- No WebSocket/SSE infrastructure in this iteration.
- Follow TDD: write each failing test and verify it fails before production edits.
- Do not read or expose real `.env`.

---

## File Structure

- Modify `validations/conversation.ts`: add optional `afterId` to `getConversationMessagesSchema`.
- Modify `app/api/message/conversation/[id]/service.ts`: support incremental message fetches.
- Modify `app/api/message/conversation/[id]/route.ts`: add no-store header to GET responses for personalized chat data.
- Create `components/message/MessageRealtimeSync.tsx`: global unread polling effect.
- Modify `app/providers.tsx`: mount `MessageRealtimeSync`.
- Modify `components/message/chat/ChatContainer.tsx`: poll active chat by `afterId`.
- Modify `components/message/chat/ConversationList.tsx`: refresh current conversation page in the background.
- Create `tests/unit/api/conversation-messages.test.ts`: API service regression tests.
- Create `tests/unit/message-realtime-sync.test.tsx`: global unread polling tests.
- Create `tests/unit/chat-container-realtime.test.tsx`: active chat realtime tests.
- Create `tests/unit/conversation-list-realtime.test.tsx`: conversation-list realtime tests.
- Modify `docs/modules/app-router.md`, `docs/modules/frontend-content.md`, and `docs/project/testing.md`: document realtime message sync.

## Task 1: Conversation Incremental API

**Files:**
- Modify: `validations/conversation.ts`
- Modify: `app/api/message/conversation/[id]/service.ts`
- Modify: `app/api/message/conversation/[id]/route.ts`
- Test: `tests/unit/api/conversation-messages.test.ts`

**Interfaces:**
- Consumes: `getConversationMessages(conversationId, input, uid)`.
- Produces: `getConversationMessagesSchema` accepts `{ page, limit, afterId?: number }`; with `afterId`, the service returns messages with `id > afterId` in ascending order.

- [ ] **Step 1: Write the failing service tests**

Create `tests/unit/api/conversation-messages.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user_conversation: {
    findUnique: vi.fn()
  },
  user_private_message: {
    findMany: vi.fn(),
    count: vi.fn()
  }
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMock
}))

describe('conversation message fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user_conversation.findUnique.mockResolvedValue({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8,
      user_a: { id: 1007, name: 'Saya', avatar: '/saya.webp' },
      user_b: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    })
    prismaMock.user_private_message.count.mockResolvedValue(3)
  })

  it('returns only messages newer than afterId in chronological order', async () => {
    const newerMessages = [
      {
        id: 11,
        content: 'newest',
        status: 0,
        is_deleted: false,
        edited_at: null,
        created: new Date('2026-06-29T10:02:00.000Z'),
        sender: { id: 8, name: 'Mio', avatar: '/mio.webp' }
      },
      {
        id: 10,
        content: 'new',
        status: 0,
        is_deleted: false,
        edited_at: null,
        created: new Date('2026-06-29T10:01:00.000Z'),
        sender: { id: 8, name: 'Mio', avatar: '/mio.webp' }
      }
    ]
    prismaMock.user_private_message.findMany.mockResolvedValue(newerMessages)

    const { getConversationMessages } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await getConversationMessages(
      5,
      { page: 1, limit: 50, afterId: 9 },
      1007
    )

    expect(prismaMock.user_private_message.findMany).toHaveBeenCalledWith({
      where: { conversation_id: 5, id: { gt: 9 } },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true }
        }
      },
      orderBy: { created: 'asc' },
      take: 50
    })
    expect(result).toMatchObject({
      total: 3,
      otherUser: { id: 8, name: 'Mio', avatar: '/mio.webp' },
      messages: [
        { id: 10, content: 'new' },
        { id: 11, content: 'newest' }
      ]
    })
  })

  it('preserves existing paginated history query without afterId', async () => {
    prismaMock.user_private_message.findMany.mockResolvedValue([])

    const { getConversationMessages } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    await getConversationMessages(5, { page: 2, limit: 30 }, 1007)

    expect(prismaMock.user_private_message.findMany).toHaveBeenCalledWith({
      where: { conversation_id: 5 },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true }
        }
      },
      orderBy: { created: 'desc' },
      skip: 30,
      take: 30
    })
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm test tests/unit/api/conversation-messages.test.ts
```

Expected: FAIL because `afterId` is not accepted by the schema/service query yet.

- [ ] **Step 3: Implement minimal API changes**

In `validations/conversation.ts`, change:

```ts
export const getConversationMessagesSchema = z.object({
  page: z.coerce.number().min(1).max(9999999),
  limit: z.coerce.number().min(1).max(50),
  afterId: z.coerce.number().min(1).max(9999999).optional()
})
```

In `app/api/message/conversation/[id]/service.ts`, branch inside `getConversationMessages`:

```ts
const { page, limit, afterId } = input
const offset = (page - 1) * limit

const messageWhere = afterId
  ? { conversation_id: conversationId, id: { gt: afterId } }
  : { conversation_id: conversationId }

const [data, total] = await Promise.all([
  prisma.user_private_message.findMany({
    where: messageWhere,
    include: {
      sender: {
        select: { id: true, name: true, avatar: true }
      }
    },
    orderBy: { created: afterId ? 'asc' : 'desc' },
    ...(afterId ? {} : { skip: offset }),
    take: limit
  }),
  prisma.user_private_message.count({
    where: { conversation_id: conversationId }
  })
])
```

Keep the existing `messages` mapping unchanged.

In `app/api/message/conversation/[id]/route.ts`, wrap GET response with `Cache-Control: private, no-store`.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
pnpm test tests/unit/api/conversation-messages.test.ts
```

Expected: PASS.

## Task 2: Global Unread Sync

**Files:**
- Create: `components/message/MessageRealtimeSync.tsx`
- Modify: `app/providers.tsx`
- Test: `tests/unit/message-realtime-sync.test.tsx`

**Interfaces:**
- Consumes: `useUserStore`, `useMessageStore`, `kunFetchGet('/message/unread')`.
- Produces: mounted global sync component with no visual output.

- [ ] **Step 1: Write failing component tests**

Create `tests/unit/message-realtime-sync.test.tsx` covering login-triggered sync and visibility-triggered sync.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm test tests/unit/message-realtime-sync.test.tsx
```

Expected: FAIL because `MessageRealtimeSync` does not exist.

- [ ] **Step 3: Implement `MessageRealtimeSync`**

Create a client component that:

- reads `uid` from `useUserStore((state) => state.user.uid)`;
- calls `kunFetchGet<{ hasUnreadMessages: boolean; hasUnreadChat: boolean }>('/message/unread')`;
- maps the response into `setUnreadMessageStatus({ hasUnreadNotification: res.hasUnreadMessages, hasUnreadConversation: res.hasUnreadChat })`;
- uses `setTimeout` loops rather than overlapping `setInterval`;
- uses 15000 ms visible interval and 60000 ms hidden interval;
- fetches immediately on `visibilitychange` when `document.visibilityState === 'visible'`;
- clears timers and ignores stale responses in cleanup.

Mount it under `SiteThemeRouteSync` in `app/providers.tsx`.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
pnpm test tests/unit/message-realtime-sync.test.tsx
```

Expected: PASS.

## Task 3: Active Chat Incremental Sync

**Files:**
- Modify: `components/message/chat/ChatContainer.tsx`
- Test: `tests/unit/chat-container-realtime.test.tsx`

**Interfaces:**
- Consumes: incremental API from Task 1.
- Produces: active chat updates with new messages without page refresh.

- [ ] **Step 1: Write failing component tests**

Create `tests/unit/chat-container-realtime.test.tsx` covering:

- after mount, the component polls with `afterId` equal to the highest rendered message id;
- fetched messages merge without duplicating existing ids;
- fetched messages from the other user trigger `/message/conversation/[id]/read` and update `messageStore`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm test tests/unit/chat-container-realtime.test.tsx
```

Expected: FAIL because chat does not poll for new messages.

- [ ] **Step 3: Implement chat polling**

In `ChatContainer`, add a polling effect that:

- skips when `document.visibilityState === 'hidden'`;
- gets `latestMessageId` from current messages;
- requests `/message/conversation/${conversationId}` with `{ page: 1, limit: 50, afterId: latestMessageId }`;
- merges returned messages with a `Map<number, PrivateMessage>`;
- sorts by `created`;
- if any returned message sender is not the current user, calls `/message/conversation/${conversationId}/read` and writes returned unread status to `messageStore`;
- clears timers and ignores stale responses.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
pnpm test tests/unit/chat-container-realtime.test.tsx
```

Expected: PASS.

## Task 4: Conversation List Background Refresh

**Files:**
- Modify: `components/message/chat/ConversationList.tsx`
- Test: `tests/unit/conversation-list-realtime.test.tsx`

**Interfaces:**
- Consumes: `/api/message/conversation` existing endpoint.
- Produces: fresh unread chips and latest-message rows without refresh.

- [ ] **Step 1: Write failing component tests**

Create `tests/unit/conversation-list-realtime.test.tsx` covering:

- background refresh updates the rendered unread chip;
- `messageStore.hasUnreadConversation` mirrors refreshed conversations.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm test tests/unit/conversation-list-realtime.test.tsx
```

Expected: FAIL because the list only fetches on page changes.

- [ ] **Step 3: Implement background refresh**

In `ConversationList`, split fetching into:

- foreground page fetch with loading state;
- background refresh without loading state.

Add a visible-tab polling loop around current `page`, using a 15000 ms interval and cleanup ignore flag.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
pnpm test tests/unit/conversation-list-realtime.test.tsx
```

Expected: PASS.

## Task 5: Documentation Sync

**Files:**
- Modify: `docs/modules/app-router.md`
- Modify: `docs/modules/frontend-content.md`
- Modify: `docs/project/testing.md`

**Interfaces:**
- Produces: documented realtime message behavior for future maintainers.

- [ ] **Step 1: Update docs**

Document:

- global unread polling lives in `MessageRealtimeSync`;
- chat detail uses `afterId` incremental fetch;
- conversation list background refreshes current page;
- all personalized message sync APIs remain no-store;
- tests covering realtime message behavior.

- [ ] **Step 2: Review docs for consistency**

Run:

```bash
rg -n "MessageRealtimeSync|afterId|messageStore|conversation list" docs/modules/app-router.md docs/modules/frontend-content.md docs/project/testing.md
```

Expected: output includes the new documented contracts.

## Task 6: Final Verification

**Files:**
- All touched files.

**Interfaces:**
- Proves the requested behavior is implemented and type-safe.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm test tests/unit/api/message-unread.test.ts tests/unit/api/conversation-messages.test.ts
pnpm test tests/unit/message-nav.test.tsx tests/unit/user-message-bell.test.tsx tests/unit/message-realtime-sync.test.tsx tests/unit/chat-container-realtime.test.tsx tests/unit/conversation-list-realtime.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Inspect current diff**

Run:

```bash
git diff --stat
git diff --check
```

Expected: no whitespace errors, diff scoped to message realtime behavior and docs.
