# Realtime Message And Notification Design

## Goal

Logged-in users receive private-message updates and notification red dots without manually refreshing the page.

## Context

OtoAme already has the persistence model needed for lightweight realtime behavior:

- `user_message.status` stores unread notification messages.
- `user_conversation.user_a_unread_count` and `user_b_unread_count` store unread private-message counters.
- `/api/message/unread`, `/api/message/read`, and `/api/message/conversation/[id]/read` return personalized unread state with `Cache-Control: private, no-store`.
- `messageStore` is the single frontend source of truth for top-bar and message-nav red dots.

The missing behavior is continuous client synchronization. Today the user sees fresh unread state only after a session fetch, route navigation, or manual refresh.

## References

- Context7 Next.js docs: App Router route handlers can return personalized JSON and streamed responses; in Next.js 15, GET route handlers are not cached by default, while this project still explicitly uses `private, no-store` for unread APIs.
- Context7 React docs: long-running effects must clean up timers/listeners and ignore stale async responses.
- Zulip events API: use a cursor-style model such as `last_event_id` for incremental delivery.
- Discourse MessageBus: supports long-polling/polling and lowers background-tab frequency.

## Selected Approach

Use lightweight polling with incremental chat fetches.

This avoids adding WebSocket/SSE infrastructure while satisfying the requested behavior in the current Next standalone + PM2 deployment model. The design keeps an upgrade path to SSE by isolating realtime behavior in small client components and by using cursor-like `afterId` query support for chat messages.

## Alternatives Considered

1. Server-Sent Events through App Router route handlers.
   - Pros: lower latency, server-pushed events.
   - Cons: needs connection lifecycle handling, reverse proxy timeout checks, multi-instance event fanout, and likely Redis pub/sub.

2. WebSocket service.
   - Pros: best fit for full IM presence and typing indicators.
   - Cons: new process/runtime surface, auth handshake, heartbeat, backpressure, and multi-instance fanout.

3. Lightweight polling with incremental chat fetches.
   - Pros: minimal infrastructure, uses existing API/auth/cache contracts, easy to test, predictable operational cost.
   - Cons: latency is interval-bound and not true push.

## Architecture

### Global Unread Sync

Create `components/message/MessageRealtimeSync.tsx`.

The component mounts once in `app/providers.tsx`, reads the logged-in user from `userStore`, and synchronizes `messageStore` from `/api/message/unread`.

Rules:

- Do nothing when no user is logged in.
- Fetch immediately after login/session availability.
- Poll while the tab is visible.
- Poll less aggressively after the tab becomes hidden.
- Fetch immediately when the tab becomes visible again.
- Ignore stale responses after logout, unmount, user changes, or route changes.
- Never mark messages read; it only synchronizes unread status.

### Conversation Incremental Fetch

Extend `getConversationMessagesSchema` with optional `afterId`.

When `afterId` is present, `getConversationMessages` returns messages in the conversation whose `id` is greater than `afterId`, ordered ascending for display merge. It still verifies conversation access and returns the same `{ messages, total, otherUser }` shape so existing clients remain compatible.

The route keeps auth and query parsing in `route.ts`, with database logic in `service.ts`.

### Active Chat Sync

Update `components/message/chat/ChatContainer.tsx`.

The component tracks the highest message id currently rendered. While the tab is visible, it polls `/api/message/conversation/[id]?afterId=<highestId>&limit=50`.

Rules:

- Merge new messages by id, keeping chronological order.
- Do not duplicate messages when an optimistic sent message is already present.
- Scroll to bottom only when new messages arrive and the user was already near the bottom, or when the current user sent the message.
- If any fetched message was sent by the other user, call `/api/message/conversation/[id]/read` and write the returned `MessageUnreadStatus` into `messageStore`.
- Ignore stale responses after conversation changes or unmount.

### Conversation List Sync

Update `components/message/chat/ConversationList.tsx`.

While on `/message/chat`, periodically refresh the current page of conversations. This keeps unread chips, latest message text, ordering, and the global conversation red dot fresh without a manual refresh.

Rules:

- Reuse the existing `/api/message/conversation` endpoint.
- Do not show a loading skeleton for background refreshes after the first page load.
- Sync `messageStore.hasUnreadConversation` from the refreshed items.
- Ignore stale responses on page changes or unmount.

## Error Handling

- Background polling failures do not toast on every interval. They fail silently and retry on the next scheduled tick.
- User-initiated actions keep existing toast behavior.
- Login invalidation remains owned by `/user/session` in the top bar.

## Testing

Add or update Vitest coverage:

- `tests/unit/api/conversation-messages.test.ts`: service returns only messages after `afterId`, verifies access, and preserves normal pagination.
- `tests/unit/message-realtime-sync.test.tsx`: global sync fetches unread state after login, updates `messageStore`, pauses for logged-out users, and fetches on visibility return.
- `tests/unit/chat-container-realtime.test.tsx`: active chat fetches new messages by `afterId`, merges without duplicates, and marks the current conversation read when the other user sends a message.
- `tests/unit/conversation-list-realtime.test.tsx`: conversation list background refresh updates unread chips and `messageStore`.

Run:

```bash
pnpm test tests/unit/api/message-unread.test.ts tests/unit/api/conversation-messages.test.ts
pnpm test tests/unit/message-nav.test.tsx tests/unit/user-message-bell.test.tsx tests/unit/message-realtime-sync.test.tsx tests/unit/chat-container-realtime.test.tsx tests/unit/conversation-list-realtime.test.tsx
pnpm typecheck
```

## Documentation

Update:

- `docs/modules/app-router.md`
- `docs/modules/frontend-content.md`
- `docs/project/testing.md`

Only update local skills if the new realtime rules create future agent guidance that is not already covered by those docs.
