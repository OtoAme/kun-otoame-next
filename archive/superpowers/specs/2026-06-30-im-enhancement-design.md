# IM Enhancement Design

## Goal

Improve OtoAme private chat with Telegram-like message read indicators, reply support, a QQ-style plus attachment menu, image messages, and cursor-based history loading that remains fast in large conversations.

## Context

The current private-message system already has a useful base:

- `user_conversation` stores the two participants, last-message metadata, and per-user unread counters.
- `user_private_message.status` stores whether a message has been read after the recipient opens the conversation.
- `/api/message/conversation/[id]` returns private messages and supports `afterId` for active-chat incremental polling.
- `/api/message/conversation/[id]/read` clears the current user's unread counter and returns `MessageUnreadStatus`.
- `ChatContainer` renders the active chat, polls for new messages, marks incoming messages read, and loads older history with a top sentinel.
- `ChatMessage` already supports desktop right-click and mobile tap menus for copy, edit, and delete.
- `ChatInput` already handles IME composition, Enter-to-send, `Shift+Enter` newlines, and duplicate-send locking.

The missing pieces are message-level read indicators in the UI, reply metadata and UI, image message storage and upload, a plus attachment menu, and history pagination that does not degrade with deep `skip` offsets.

## References

- Context7 Next.js docs: use App Router route handlers for authenticated JSON APIs and FormData upload calls; personalized message APIs must keep explicit `Cache-Control: private, no-store`.
- Context7 React docs: use `memo`, stable callbacks, and state isolation for expensive/event-heavy child components such as message rows and menus.
- Matrix client-server API: replies are represented as relations to another event, read receipts are cursor-like state over message position, and media messages keep media metadata separate from text body.
- Mattermost post APIs: mature chat systems expose `before`/`after` style pagination rather than relying on deep offset pagination.
- OtoAme gallery/upload docs: image upload code must validate type and size, compensate S3 objects on DB failure, and avoid trusting client-only metadata for authorization.
- `ui-ux-pro-max`: chat menus need predictable z-index, accessible icon buttons, keyboard focus, visible pressed states, image sizing, alt text, and no layout-shifting interactions.

## Selected Approach

Use an incremental schema and UI enhancement of the existing private chat instead of replacing the IM stack.

This keeps the current polling, unread counters, route structure, and client stores. It adds message metadata for replies and images, switches old-history fetches to `beforeId` cursor pagination, and splits the chat UI into smaller components so reply/image/menu states do not force avoidable full-list rerenders.

## Alternatives Considered

1. Add a full read-receipt table per user/device.
   - Pros: precise multi-device read semantics and an easy future path to group chat.
   - Cons: more schema, write volume, and UI complexity than the current two-person private chat needs.

2. Store reply content only as formatted text inside `content`.
   - Pros: no schema changes.
   - Cons: impossible to jump to the source message, hard to render consistently, and fragile when the source message is deleted or edited.

3. Reuse gallery upload directly for private chat images.
   - Pros: proven image handling.
   - Cons: gallery upload is patch-owned and writes `patch_game_image`; private chat needs conversation ownership, different S3 keys, and different persistence.

4. Keep offset pagination and only lower the page size.
   - Pros: minimal change.
   - Cons: deep conversations still become slower as `skip` grows and the API still counts full history for every older-page fetch.

## Product Behavior

### Message Read Indicators

Only messages sent by the current user show delivery/read status.

- `status = 0`: render a subtle single-check state labeled as unread when hovered or announced by screen readers.
- `status = 1`: render a double-check or highlighted read state labeled as read.
- Deleted own messages still show the deleted placeholder and do not need a read badge.
- The active chat's existing read endpoint remains the source of truth. When the other participant opens or polls the conversation and marks it read, subsequent incremental fetches or history refreshes update message `status`.

### Replying To Messages

The message menu supports:

- `回复`: replies to the whole message.
- `回复选中文本`: appears when the current text selection intersects the message body, and sends only the selected excerpt as the quoted preview.
- `复制文本` / `复制选中文本`.
- `编辑` and `删除` for the sender's own non-deleted messages.

When a reply is active, the composer shows a compact quote bar above the input with:

- Original sender name.
- Selected excerpt if present, otherwise the original message preview.
- Image marker when replying to an image message.
- A cancel icon button.

Sent reply messages render a quote block above the message body. Clicking the quote block scrolls to the original message if it is already loaded in the current DOM. If the original message is not loaded, the first version keeps the saved preview visible and does not fetch the historical window around that message.

### Plus Attachment Menu

The composer gets a left-side icon-only plus button.

- Pressing it opens a compact QQ-style folded menu above the composer.
- The first version contains one action: image.
- The action opens a file picker.
- The button has an accessible label and a visible pressed/open state.
- The menu closes on outside click, escape, image selection, send, route change, or composer unmount.

### Image Messages

The first version supports one image per message with an optional text caption.

- Supported formats: JPG, PNG, WebP, AVIF.
- Maximum upload size: 8 MB.
- The selected image shows a pre-send preview above the input with file name, size, and remove button.
- Sending an image with no caption is valid.
- Sending plain text with no image remains valid.
- Sending an empty message with no image remains invalid.
- Rendered image messages use constrained dimensions, lazy loading, and an alt text derived from the image name or caption.
- Image messages can be replied to, copied if they have caption text, deleted by sender, and used as reply targets.

## Data Model

Extend `user_private_message`:

- `type Int @default(0)`: `0` text, `1` image.
- `image_url String? @db.VarChar(1000)`.
- `image_width Int?`.
- `image_height Int?`.
- `image_size Int?`.
- `image_mime String? @db.VarChar(100)`.
- `image_name String? @db.VarChar(255)`.
- `reply_to_message_id Int?`.
- `reply_to_message user_private_message?` self relation with `onDelete: SetNull`.
- `reply_preview_content String? @db.VarChar(500)`.
- `reply_preview_sender_name String? @db.VarChar(50)`.
- `reply_selected_text String? @db.VarChar(500)`.

The saved preview is intentional. It keeps reply rendering stable if the source message is later deleted, edited, or not loaded in the current page.

`PrivateMessage` API types gain:

- `type`.
- Optional `image`.
- Optional `replyTo`.

`Conversation.lastMessage` renders a display summary:

- Text message: trimmed text preview.
- Image with caption: caption preview.
- Image without caption: `[图片]`.
- Deleted last message: existing deleted-message behavior can remain unchanged for the first implementation unless current behavior is user-visible wrong.

## API Design

### Fetch Messages

`GET /api/message/conversation/[id]` supports three modes:

- Initial history: `limit=30`.
- Older history: `beforeId=<oldestLoadedId>&limit=30`.
- Newer realtime: `afterId=<latestServerSyncedId>&limit=50`.

Rules:

- `beforeId` and `afterId` are mutually exclusive.
- `afterId` returns ascending messages newer than the cursor and does not count full history.
- `beforeId` returns messages older than the cursor, ordered for display after service normalization, and does not use `skip`.
- The initial request may still return `total` for compatibility, but `hasMoreBefore` is the preferred frontend flag.
- All responses remain personalized `private, no-store`.

### Send Message

`POST /api/message/conversation/[id]` accepts JSON:

- `content?: string`.
- `type?: 0 | 1`.
- `image?: { url, width, height, size, mime, name }`.
- `replyToMessageId?: number`.
- `replySelectedText?: string`.

Rules:

- Plain text must have non-empty `content`.
- Image messages must have valid uploaded image metadata.
- Image captions use the existing 2000-character content limit.
- Reply target must belong to the same conversation and must not be deleted.
- Reply preview is generated server-side from the target message and optional selected text.
- Creating the message and updating conversation last-message/unread counters happen in one transaction.

### Upload Image

Add a private chat image upload route under the message domain.

Rules:

- Verify login and CSRF in the handler because uploads are excluded from middleware.
- Verify the current user belongs to the conversation before accepting the file.
- Accept one image file per request.
- Reject unsupported MIME/extension or files over 8 MB.
- Derive image dimensions and MIME server-side when possible.
- Store the object under a private-chat S3 key such as `conversation/{conversationId}/{messageImageId-or-uploadId}.{ext}`.
- Return only the metadata needed by `POST /api/message/conversation/[id]`.
- If DB persistence fails after upload, compensate by deleting the uploaded S3 object.

The implementation can either create a temporary metadata row before final message creation or upload first and compensate in `sendMessage`. The final code must not trust a user-supplied URL that was not produced by this route for that user and conversation.

## Frontend Architecture

### Component Boundaries

Split the current chat UI into focused pieces:

- `ChatContainer`: data orchestration, cursors, polling, read sync, scroll anchoring.
- `ChatMessage`: memoized message row wrapper.
- `ChatMessageBubble`: text/image body rendering.
- `ChatMessageMenu`: copy/reply/edit/delete menu and selection handling.
- `ChatReplyPreview`: quote block inside messages.
- `ChatComposer`: input, reply state, image preview, plus menu, send action.
- `ChatAttachmentMenu`: plus menu.

The split should be incremental. Existing file names can remain where it avoids churn, but new reply/image/menu behavior should not make `ChatMessage.tsx` much larger.

### Scroll And Pagination

`ChatContainer` keeps:

- `oldestMessageId` for `beforeId`.
- `realtimeCursorRef` for `afterId`, advanced only by server-fetched messages, not by locally sent optimistic messages.
- `hasMoreBefore` from the server when available.
- Scroll-height anchoring when older messages are prepended.

Rules:

- Initial render scrolls to bottom.
- Loading older messages preserves the user's viewport position.
- Incoming realtime messages scroll to bottom only when appropriate for the current behavior. The first version may keep the existing scroll-to-bottom-on-new-message behavior if changing it would expand scope.
- Message rows use stable keys and are memoized.

### Styling

Follow current OtoAme/HeroUI/Tailwind style:

- Use `lucide-react` icons for plus, image, reply, copy, edit, delete, close, and read checks.
- Keep icon buttons at least 44 px clickable area.
- Use `primary` surfaces for own bubbles and `default/content` surfaces for other bubbles.
- Reply quote bars use a thin primary/default accent line and compact text, not nested cards.
- Menus use the existing rounded floating menu style, z-index scale, and focus/hover states.
- Images use fixed max width, max height, `object-contain`, and no layout-shifting hover effects.

## Error Handling

- Oversized or unsupported image upload: toast a specific user-facing error.
- Upload succeeds but send fails: keep the preview and show the error so the user can retry or remove it.
- Reply target deleted before send: reject with a user-facing message and clear the reply state only after the user dismisses or retries.
- Background polling failures stay silent and retry later.
- User-initiated send/upload/edit/delete failures keep existing toast behavior.

## Security And Privacy

- Every message fetch, send, read, delete, update, and upload verifies conversation membership server-side.
- Frontend visibility does not grant permissions.
- Upload route enforces CSRF, type, size, and ownership.
- Message image URLs are only accepted if produced by the private chat upload flow for the same conversation and user.
- Personalized chat APIs remain `Cache-Control: private, no-store`.
- Do not expose S3 keys, secrets, or raw internal upload paths in user-facing errors.

## Testing

Add or update Vitest coverage:

- `tests/unit/api/conversation-messages.test.ts`: `beforeId` cursor fetch avoids `skip` and full count, `afterId` remains count-free, reply fields and image metadata are returned.
- `tests/unit/api/conversation-service.test.ts`: send text reply, send image message, reject reply to another conversation, reject deleted reply target, update unread counters transactionally.
- A new upload service test if upload logic is factored for unit testing: validates type/size/ownership and S3 compensation behavior with mocks.
- `tests/unit/chat-input.test.tsx` or a new composer test: plus menu opens, image action selects an image, reply preview contributes payload, empty content plus image can send, empty content without image cannot send.
- `tests/unit/chat-container-realtime.test.tsx`: older history uses `beforeId`, preserves scroll anchoring, and message status changes render after fetch.
- A message-row/menu test: right-click/tap menu exposes reply actions and `回复选中文本` only when text is selected.

Run at minimum:

```bash
pnpm test tests/unit/api/conversation-messages.test.ts tests/unit/api/conversation-service.test.ts
pnpm test tests/unit/chat-input.test.tsx tests/unit/chat-container-realtime.test.tsx
pnpm typecheck
```

Run broader message tests when touching shared unread behavior:

```bash
pnpm test tests/unit/message-nav.test.tsx tests/unit/user-message-bell.test.tsx tests/unit/message-realtime-sync.test.tsx tests/unit/conversation-list-realtime.test.tsx
```

## Documentation

Update after implementation:

- `docs/modules/app-router.md`: private chat behavior, reply/image messages, cursor pagination, no-store APIs.
- `docs/modules/frontend-content.md`: message UI, composer, plus menu, reply interactions, image preview.
- `docs/modules/api-services.md`: message send/fetch/upload service contracts.
- `docs/modules/data-cache-upload.md`: private chat image upload ownership, S3 key, compensation.
- `docs/project/testing.md`: new message/reply/image/cursor tests.

Only update local OtoAme skills if the new behavior introduces future agent guidance not already covered by these docs.

## Rollout Notes

This is a schema-changing feature. Development should run `pnpm prisma:generate` at minimum after editing Prisma schema. Production rollout needs a migration/sync plan that adds nullable columns and a defaulted `type` column without resetting existing data.

Existing text messages remain valid because new fields are nullable and `type` defaults to text.
