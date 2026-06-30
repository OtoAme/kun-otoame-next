# IM Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Telegram-like private-message read indicators, message replies, a QQ-style image attachment menu, image sending, and cursor-based history loading to OtoAme IM.

**Architecture:** Extend the existing two-person private chat instead of replacing it. Add nullable Prisma fields for reply/image metadata, keep route handlers thin, move persistence/upload rules into message services, and split the chat UI so composer/menu/message row state stays isolated.

**Tech Stack:** Next.js 15 App Router, React 19, HeroUI, Tailwind CSS 4, lucide-react, Prisma 7, AWS S3 helper, Sharp image metadata, Vitest 4.

## Global Constraints

- Keep route handlers thin: parse input, verify auth/role, call service/helper, return `NextResponse.json`.
- All private chat APIs remain personalized and use `Cache-Control: private, no-store`.
- State-changing APIs preserve CSRF behavior; upload APIs verify CSRF in the handler.
- Every fetch, send, read, edit, delete, and upload verifies conversation membership server-side.
- No WebSocket/SSE infrastructure in this iteration.
- Use existing `utils/kunFetch.ts` wrappers on the client.
- Use `lucide-react` icons and keep icon-only controls accessible with labels and stable 44 px hit targets.
- Follow TDD: write a failing test, run it red, implement, run it green.
- After Prisma schema changes, run `pnpm prisma:generate` at minimum.
- Do not read or expose real `.env`.

---

## File Structure

- Modify `prisma/schema/conversation.prisma`: add private-message type, image metadata, and reply self relation.
- Modify `validations/conversation.ts`: add `beforeId`, message type, image metadata, reply fields, and upload form constraints.
- Modify `types/api/conversation.ts`: add message type, image payload, reply preview, `hasMoreBefore`.
- Modify `app/api/message/conversation/[id]/service.ts`: cursor fetches, message mapping, reply validation, image send, transactional send.
- Modify `app/api/message/conversation/[id]/route.ts`: parse new schemas and keep no-store responses.
- Create `app/api/message/conversation/[id]/image/service.ts`: private chat image upload ownership, validation, S3 upload, compensation helpers.
- Create `app/api/message/conversation/[id]/image/route.ts`: upload route with login and CSRF checks.
- Modify `app/api/message/conversation/service.ts`: summarize last image messages as `[图片]` or caption preview.
- Modify `components/message/chat/ChatContainer.tsx`: `beforeId` history loading, `hasMoreBefore`, reply state, image-aware sent message merge, status refresh.
- Modify `components/message/chat/ChatInput.tsx`: evolve into composer with plus menu, image preview, reply bar, send payload.
- Create `components/message/chat/ChatAttachmentMenu.tsx`: plus menu with image action.
- Create `components/message/chat/ChatReplyPreview.tsx`: reusable reply quote display.
- Modify `components/message/chat/ChatMessage.tsx`: reply actions, selected-text reply, image body, read indicator.
- Optional split if needed: `components/message/chat/ChatMessageBubble.tsx` and `components/message/chat/ChatMessageMenu.tsx`.
- Modify `tests/unit/api/conversation-messages.test.ts`: before cursor, no count, mapped reply/image fields.
- Modify `tests/unit/api/conversation-service.test.ts`: send reply/image validation and transactional unread updates.
- Create `tests/unit/api/conversation-image-upload.test.ts`: upload ownership/type/size/S3 compensation service tests when upload helper is factored.
- Modify `tests/unit/chat-input.test.tsx`: plus menu, image preview, reply payload, image-only send.
- Modify `tests/unit/chat-container-realtime.test.tsx`: before cursor history and status update rendering.
- Create or modify a message row test for reply menu actions.
- Modify docs after implementation: `docs/modules/app-router.md`, `docs/modules/frontend-content.md`, `docs/modules/api-services.md`, `docs/modules/data-cache-upload.md`, `docs/project/testing.md`.

## Task 1: Message Schema, Types, And Validation

**Files:**
- Modify: `prisma/schema/conversation.prisma`
- Modify: `validations/conversation.ts`
- Modify: `types/api/conversation.ts`
- Test: `tests/unit/api/conversation-messages.test.ts`

**Interfaces:**
- Produces `PrivateMessage.type`, optional `PrivateMessage.image`, optional `PrivateMessage.replyTo`, and `ConversationMessagesResponse.hasMoreBefore` TypeScript interfaces.
- Produces `sendPrivateMessageSchema` accepting text, image metadata, and reply metadata.
- Produces `getConversationMessagesSchema` accepting mutually exclusive `beforeId` and `afterId`.

- [x] **Step 1: Write the failing validation test**

Add tests to `tests/unit/api/conversation-messages.test.ts`:

```ts
it('rejects beforeId and afterId together', async () => {
  const { getConversationMessagesSchema } = await import(
    '~/validations/conversation'
  )

  expect(
    getConversationMessagesSchema.safeParse({
      page: 1,
      limit: 30,
      beforeId: 10,
      afterId: 20
    }).success
  ).toBe(false)
})
```

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test tests/unit/api/conversation-messages.test.ts
```

Expected: FAIL because `beforeId` validation does not exist.

- [x] **Step 3: Update Prisma schema**

In `prisma/schema/conversation.prisma`, extend `user_private_message`:

```prisma
  type Int @default(0)

  image_url    String? @db.VarChar(1000)
  image_width  Int?
  image_height Int?
  image_size   Int?
  image_mime   String? @db.VarChar(100)
  image_name   String? @db.VarChar(255)

  reply_to_message_id Int?
  reply_to_message    user_private_message?  @relation("private_message_reply", fields: [reply_to_message_id], references: [id], onDelete: SetNull)
  replies             user_private_message[] @relation("private_message_reply")

  reply_preview_content     String? @db.VarChar(500)
  reply_preview_sender_name String? @db.VarChar(50)
  reply_selected_text       String? @db.VarChar(500)
```

- [x] **Step 4: Update validations**

In `validations/conversation.ts`, add:

```ts
const messageTypeSchema = z.union([z.literal(0), z.literal(1)]).default(0)

const privateMessageImageSchema = z.object({
  url: z.string().url().max(1000),
  width: z.coerce.number().int().min(1).max(20000),
  height: z.coerce.number().int().min(1).max(20000),
  size: z.coerce.number().int().min(1).max(8 * 1024 * 1024),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  name: z.string().trim().min(1).max(255)
})
```

Replace `getConversationMessagesSchema` with:

```ts
export const getConversationMessagesSchema = z
  .object({
    page: z.coerce.number().min(1).max(9999999),
    limit: z.coerce.number().min(1).max(50),
    beforeId: z.coerce.number().min(1).max(9999999).optional(),
    afterId: z.coerce.number().min(1).max(9999999).optional()
  })
  .refine((input) => !(input.beforeId && input.afterId), {
    message: 'beforeId 和 afterId 不能同时使用'
  })
```

Replace `sendPrivateMessageSchema` with:

```ts
export const sendPrivateMessageSchema = z
  .object({
    type: messageTypeSchema,
    content: z.string().trim().max(2000, { message: '消息内容最多 2000 个字符' }).optional(),
    image: privateMessageImageSchema.optional(),
    replyToMessageId: z.coerce.number().min(1).max(9999999).optional(),
    replySelectedText: z.string().trim().max(500).optional()
  })
  .superRefine((input, ctx) => {
    const content = input.content?.trim() ?? ''
    if (input.type === 0 && !content) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '消息内容不能为空', path: ['content'] })
    }
    if (input.type === 1 && !input.image) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '请先选择图片', path: ['image'] })
    }
    if (input.type === 1 && !content && !input.image) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '消息内容不能为空', path: ['content'] })
    }
  })
```

- [x] **Step 5: Update API types**

In `types/api/conversation.ts`, add:

```ts
export interface PrivateMessageImage {
  url: string
  width: number
  height: number
  size: number
  mime: string
  name: string
}

export interface PrivateMessageReplyPreview {
  messageId: number
  content: string
  senderName: string
  selectedText: string | null
}
```

Extend `PrivateMessage`:

```ts
  type: number
  image: PrivateMessageImage | null
  replyTo: PrivateMessageReplyPreview | null
```

Add:

```ts
export interface ConversationMessagesResponse {
  messages: PrivateMessage[]
  total: number
  hasMoreBefore: boolean
  otherUser: KunUser
}
```

- [x] **Step 6: Run Prisma generate**

Run:

```bash
pnpm prisma:generate
```

Expected: Prisma Client generation succeeds.

- [x] **Step 7: Run GREEN**

Run:

```bash
pnpm test tests/unit/api/conversation-messages.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add prisma/schema/conversation.prisma validations/conversation.ts types/api/conversation.ts tests/unit/api/conversation-messages.test.ts
git commit -m "feat(message): add private message metadata schema"
```

## Task 2: Cursor Fetching And Message Mapping

**Files:**
- Modify: `app/api/message/conversation/[id]/service.ts`
- Modify: `app/api/message/conversation/[id]/route.ts`
- Modify: `tests/unit/api/conversation-messages.test.ts`

**Interfaces:**
- Consumes new schema and `PrivateMessage` type from Task 1.
- Produces `getConversationMessages(...): ConversationMessagesResponse | string` with `beforeId`, `afterId`, mapped image/reply metadata, and `hasMoreBefore`.

- [x] **Step 1: Add failing before cursor and metadata mapping tests**

In `tests/unit/api/conversation-messages.test.ts`, add:

```ts
it('loads older messages with beforeId without skip or full count', async () => {
  prismaMock.user_private_message.findMany.mockResolvedValue([
    {
      id: 4,
      type: 0,
      content: 'older',
      status: 0,
      is_deleted: false,
      edited_at: null,
      image_url: null,
      image_width: null,
      image_height: null,
      image_size: null,
      image_mime: null,
      image_name: null,
      reply_to_message_id: null,
      reply_preview_content: null,
      reply_preview_sender_name: null,
      reply_selected_text: null,
      created: new Date('2026-06-30T09:00:00.000Z'),
      sender: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    }
  ])

  const { getConversationMessages } = await import(
    '~/app/api/message/conversation/[id]/service'
  )
  const result = await getConversationMessages(
    5,
    { page: 1, limit: 30, beforeId: 9 },
    1007
  )

  expect(prismaMock.user_private_message.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { conversation_id: 5, id: { lt: 9 } },
      orderBy: { id: 'desc' },
      take: 31
    })
  )
  expect(prismaMock.user_private_message.count).not.toHaveBeenCalled()
  expect(result).toMatchObject({
    messages: [{ id: 4, content: 'older' }],
    hasMoreBefore: false
  })
})
```

Also add:

```ts
it('returns image and reply metadata for mapped messages', async () => {
  prismaMock.user_private_message.findMany.mockResolvedValue([
    {
      id: 20,
      type: 1,
      content: 'caption',
      status: 1,
      is_deleted: false,
      edited_at: null,
      image_url: 'https://img.example/chat.webp',
      image_width: 800,
      image_height: 600,
      image_size: 12345,
      image_mime: 'image/webp',
      image_name: 'chat.webp',
      reply_to_message_id: 10,
      reply_preview_content: 'quoted text',
      reply_preview_sender_name: 'Mio',
      reply_selected_text: 'quoted',
      created: new Date('2026-06-30T10:00:00.000Z'),
      sender: { id: 1007, name: 'Saya', avatar: '/saya.webp' }
    }
  ])

  const { getConversationMessages } = await import(
    '~/app/api/message/conversation/[id]/service'
  )
  const result = await getConversationMessages(5, { page: 1, limit: 30 }, 1007)

  expect(result).toMatchObject({
    messages: [
      {
        id: 20,
        type: 1,
        content: 'caption',
        image: {
          url: 'https://img.example/chat.webp',
          width: 800,
          height: 600,
          size: 12345,
          mime: 'image/webp',
          name: 'chat.webp'
        },
        replyTo: {
          messageId: 10,
          content: 'quoted text',
          senderName: 'Mio',
          selectedText: 'quoted'
        }
      }
    ]
  })
})
```

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test tests/unit/api/conversation-messages.test.ts
```

Expected: FAIL because `beforeId` is not implemented and mapping lacks new fields.

- [x] **Step 3: Add mapping helpers**

In `app/api/message/conversation/[id]/service.ts`, add local helpers:

```ts
const mapPrivateMessage = (msg: any): PrivateMessage => ({
  id: msg.id,
  type: msg.type ?? 0,
  content: msg.content,
  status: msg.status,
  isDeleted: msg.is_deleted,
  editedAt: msg.edited_at,
  created: msg.created,
  sender: msg.sender,
  image: msg.image_url
    ? {
        url: msg.image_url,
        width: msg.image_width ?? 0,
        height: msg.image_height ?? 0,
        size: msg.image_size ?? 0,
        mime: msg.image_mime ?? 'image/jpeg',
        name: msg.image_name ?? 'image'
      }
    : null,
  replyTo:
    msg.reply_to_message_id && msg.reply_preview_sender_name
      ? {
          messageId: msg.reply_to_message_id,
          content: msg.reply_preview_content ?? '',
          senderName: msg.reply_preview_sender_name,
          selectedText: msg.reply_selected_text
        }
      : null
})
```

- [x] **Step 4: Implement cursor branches**

In `getConversationMessages`, implement:

```ts
const { page, limit, beforeId, afterId } = input
const otherUser =
  conversation.user_a_id === uid ? conversation.user_b : conversation.user_a

if (afterId) {
  const data = await prisma.user_private_message.findMany({
    where: { conversation_id: conversationId, id: { gt: afterId } },
    include: { sender: { select: { id: true, name: true, avatar: true } } },
    orderBy: { id: 'asc' },
    take: limit
  })
  return {
    messages: data.map(mapPrivateMessage),
    total: data.length,
    hasMoreBefore: false,
    otherUser
  }
}

if (beforeId) {
  const data = await prisma.user_private_message.findMany({
    where: { conversation_id: conversationId, id: { lt: beforeId } },
    include: { sender: { select: { id: true, name: true, avatar: true } } },
    orderBy: { id: 'desc' },
    take: limit + 1
  })
  const hasMoreBefore = data.length > limit
  const messages = data.slice(0, limit).reverse().map(mapPrivateMessage)
  return { messages, total: messages.length, hasMoreBefore, otherUser }
}
```

For initial fetch, keep `skip` compatibility but map new fields and return `hasMoreBefore: data.length < total`.

- [x] **Step 5: Keep no-store GET**

Confirm `app/api/message/conversation/[id]/route.ts` GET returns through the existing `jsonNoStore` helper for every branch.

- [x] **Step 6: Run GREEN**

Run:

```bash
pnpm test tests/unit/api/conversation-messages.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add app/api/message/conversation/[id]/service.ts app/api/message/conversation/[id]/route.ts tests/unit/api/conversation-messages.test.ts
git commit -m "perf(message): load chat history with cursors"
```

## Task 3: Sending Replies And Image Messages

**Files:**
- Modify: `app/api/message/conversation/[id]/service.ts`
- Modify: `app/api/message/conversation/service.ts`
- Modify: `tests/unit/api/conversation-service.test.ts`

**Interfaces:**
- Consumes `sendPrivateMessageSchema` from Task 1.
- Produces `sendMessage(conversationId, input, uid)` that supports text, image, reply previews, and transactional unread update.

- [x] **Step 1: Write failing send tests**

Extend `tests/unit/api/conversation-service.test.ts` mock with:

```ts
user_private_message: {
  findFirst: vi.fn(),
  create: vi.fn()
},
user_conversation: {
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn()
},
_tx: {
  user_private_message: { create: vi.fn() },
  user_conversation: { update: vi.fn() }
}
```

Add:

```ts
it('sends a text reply with server-generated preview and unread increment', async () => {
  prismaMock.user_conversation.findUnique.mockResolvedValue({
    id: 5,
    user_a_id: 1007,
    user_b_id: 8,
    user_a: { id: 1007, name: 'Saya', avatar: '/saya.webp' },
    user_b: { id: 8, name: 'Mio', avatar: '/mio.webp' }
  })
  prismaMock.user_private_message.findFirst.mockResolvedValue({
    id: 3,
    conversation_id: 5,
    sender_id: 8,
    content: 'hello original',
    type: 0,
    is_deleted: false,
    sender: { name: 'Mio' }
  })
  prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock._tx))
  prismaMock._tx.user_private_message.create.mockResolvedValue({
    id: 9,
    type: 0,
    content: 'reply',
    status: 0,
    is_deleted: false,
    edited_at: null,
    image_url: null,
    image_width: null,
    image_height: null,
    image_size: null,
    image_mime: null,
    image_name: null,
    reply_to_message_id: 3,
    reply_preview_content: 'hello',
    reply_preview_sender_name: 'Mio',
    reply_selected_text: 'hello',
    created: new Date('2026-06-30T10:00:00.000Z'),
    sender: { id: 1007, name: 'Saya', avatar: '/saya.webp' }
  })

  const { sendMessage } = await import(
    '~/app/api/message/conversation/[id]/service'
  )
  const result = await sendMessage(
    5,
    { type: 0, content: 'reply', replyToMessageId: 3, replySelectedText: 'hello' },
    1007
  )

  expect(prismaMock._tx.user_private_message.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        reply_to_message_id: 3,
        reply_preview_content: 'hello',
        reply_preview_sender_name: 'Mio',
        reply_selected_text: 'hello'
      })
    })
  )
  expect(prismaMock._tx.user_conversation.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ user_b_unread_count: { increment: 1 } })
    })
  )
  expect(result).toMatchObject({ id: 9, replyTo: { messageId: 3 } })
})
```

Add tests for rejecting a reply target in another conversation or deleted target, and sending image metadata with `type: 1`.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test tests/unit/api/conversation-service.test.ts
```

Expected: FAIL because `sendMessage` does not support reply/image metadata or transactions.

- [x] **Step 3: Implement reply preview helper**

In `app/api/message/conversation/[id]/service.ts`, add:

```ts
const buildReplyPreview = async (
  conversationId: number,
  replyToMessageId?: number,
  replySelectedText?: string
) => {
  if (!replyToMessageId) return null

  const replyTarget = await prisma.user_private_message.findFirst({
    where: { id: replyToMessageId, conversation_id: conversationId },
    include: { sender: { select: { name: true } } }
  })

  if (!replyTarget) return '回复的消息不存在'
  if (replyTarget.is_deleted) return '无法回复已删除的消息'

  const selected = replySelectedText?.trim().slice(0, 500) || null
  const fallback =
    replyTarget.type === 1 && !replyTarget.content.trim()
      ? '[图片]'
      : replyTarget.content.trim().slice(0, 500)

  return {
    reply_to_message_id: replyTarget.id,
    reply_preview_content: selected ?? fallback,
    reply_preview_sender_name: replyTarget.sender.name,
    reply_selected_text: selected
  }
}
```

- [x] **Step 4: Make send transactional**

In `sendMessage`, build `messageData`, then:

```ts
const created = await prisma.$transaction(async (tx) => {
  const message = await tx.user_private_message.create({
    data: messageData,
    include: { sender: { select: { id: true, name: true, avatar: true } } }
  })

  await tx.user_conversation.update({
    where: { id: conversationId },
    data: {
      last_message_id: message.id,
      last_message_time: message.created,
      ...(isUserA
        ? { user_b_unread_count: { increment: 1 } }
        : { user_a_unread_count: { increment: 1 } })
    }
  })

  return message
})

return mapPrivateMessage(created)
```

For image messages, write `image_url`, `image_width`, `image_height`, `image_size`, `image_mime`, and `image_name` from validated input.

- [x] **Step 5: Update conversation list summary**

In `app/api/message/conversation/service.ts`, include last message `type` and summarize:

```ts
const summarizeLastMessage = (message?: { type?: number; content: string }) => {
  if (!message) return ''
  if (message.type === 1 && !message.content.trim()) return '[图片]'
  return message.content
}
```

- [x] **Step 6: Run GREEN**

Run:

```bash
pnpm test tests/unit/api/conversation-service.test.ts tests/unit/api/conversation-messages.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add app/api/message/conversation/[id]/service.ts app/api/message/conversation/service.ts tests/unit/api/conversation-service.test.ts
git commit -m "feat(message): send replies and image messages"
```

## Task 4: Private Chat Image Upload

**Files:**
- Create: `app/api/message/conversation/[id]/image/service.ts`
- Create: `app/api/message/conversation/[id]/image/route.ts`
- Modify: `validations/conversation.ts`
- Test: `tests/unit/api/conversation-image-upload.test.ts`

**Interfaces:**
- Produces `uploadConversationImage(conversationId, file, uid): PrivateMessageImage | string`.
- The route accepts `FormData` with `image`.

- [x] **Step 1: Write failing upload service tests**

Create `tests/unit/api/conversation-image-upload.test.ts` with mocked Prisma and S3 helper:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user_conversation: { findUnique: vi.fn() }
}))

const s3Mock = vi.hoisted(() => ({
  uploadImageToS3: vi.fn(),
  deleteFileFromS3: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: prismaMock }))
vi.mock('~/lib/s3', () => s3Mock)

describe('conversation image upload service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user_conversation.findUnique.mockResolvedValue({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8
    })
  })

  it('rejects uploads when the user is not in the conversation', async () => {
    prismaMock.user_conversation.findUnique.mockResolvedValue({
      id: 5,
      user_a_id: 1,
      user_b_id: 2
    })
    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )

    const file = new File(['x'], 'a.png', { type: 'image/png' })
    await expect(uploadConversationImage(5, file, 1007)).resolves.toBe(
      '会话不存在或无权访问'
    )
  })

  it('rejects files over 8 MB', async () => {
    const { uploadConversationImage } = await import(
      '~/app/api/message/conversation/[id]/image/service'
    )
    const file = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png'
    })

    await expect(uploadConversationImage(5, file, 1007)).resolves.toBe(
      '图片大小不能超过 8 MB'
    )
  })
})
```

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test tests/unit/api/conversation-image-upload.test.ts
```

Expected: FAIL because the upload service does not exist.

- [x] **Step 3: Implement upload service**

Create `app/api/message/conversation/[id]/image/service.ts`:

```ts
import sharp from 'sharp'
import { prisma } from '~/prisma/index'
import { uploadImageToS3 } from '~/lib/s3'
import type { PrivateMessageImage } from '~/types/api/conversation'

const MAX_IMAGE_SIZE = 8 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif'
])

export const uploadConversationImage = async (
  conversationId: number,
  file: File,
  uid: number
): Promise<PrivateMessageImage | string> => {
  const conversation = await prisma.user_conversation.findUnique({
    where: { id: conversationId }
  })

  if (
    !conversation ||
    (conversation.user_a_id !== uid && conversation.user_b_id !== uid)
  ) {
    return '会话不存在或无权访问'
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return '仅支持 JPG、PNG、WebP、AVIF 图片'
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return '图片大小不能超过 8 MB'
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const metadata = await sharp(buffer, { animated: true }).metadata()
  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]
  const key = `conversation/${conversationId}/${uid}-${Date.now()}-${crypto.randomUUID()}.${ext}`
  const url = await uploadImageToS3(key, buffer, file.type)

  return {
    url,
    width: metadata.width ?? 1,
    height: metadata.height ?? 1,
    size: file.size,
    mime: file.type,
    name: file.name.slice(0, 255)
  }
}
```

- [x] **Step 4: Implement upload route**

Create `app/api/message/conversation/[id]/image/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { verifyKunCsrf } from '~/app/api/utils/verifyKunCsrf'
import { PERSONALIZED_API_CACHE_CONTROL } from '~/app/api/utils/cacheHeaders'
import { uploadConversationImage } from './service'

const jsonNoStore = (body: unknown) =>
  NextResponse.json(body, {
    headers: { 'Cache-Control': PERSONALIZED_API_CACHE_CONTROL }
  })

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const csrfError = verifyKunCsrf(req)
  if (csrfError) return jsonNoStore(csrfError)

  const payload = await verifyHeaderCookie(req)
  if (!payload) return jsonNoStore('用户未登录')

  const { id } = await params
  const conversationId = Number(id)
  if (!Number.isInteger(conversationId)) return jsonNoStore('无效的会话 ID')

  const formData = await req.formData()
  const file = formData.get('image')
  if (!(file instanceof File)) return jsonNoStore('请上传图片')

  const response = await uploadConversationImage(conversationId, file, payload.uid)
  return jsonNoStore(response)
}
```

- [x] **Step 5: Run GREEN**

Run:

```bash
pnpm test tests/unit/api/conversation-image-upload.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add app/api/message/conversation/[id]/image tests/unit/api/conversation-image-upload.test.ts
git commit -m "feat(message): upload private chat images"
```

## Task 5: Composer Reply, Plus Menu, And Image Preview

**Files:**
- Modify: `components/message/chat/ChatInput.tsx`
- Create: `components/message/chat/ChatAttachmentMenu.tsx`
- Create: `components/message/chat/ChatReplyPreview.tsx`
- Modify: `components/message/chat/ChatContainer.tsx`
- Modify: `tests/unit/chat-input.test.tsx`

**Interfaces:**
- Consumes `replyTarget: PrivateMessage | null`.
- Produces `onCancelReply()`, `onMessageSent(message: PrivateMessage)`, image upload and send payload.

- [x] **Step 1: Write failing composer tests**

Extend `tests/unit/chat-input.test.tsx` to mock `kunFetchPost` for upload and send. Add:

```ts
it('sends reply metadata with the message payload', async () => {
  const { textarea } = await renderChatInput({
    replyTarget: {
      id: 3,
      type: 0,
      content: 'original',
      status: 0,
      isDeleted: false,
      editedAt: null,
      created: '2026-06-30T09:00:00.000Z',
      sender: { id: 8, name: 'Mio', avatar: '/mio.webp' },
      image: null,
      replyTo: null
    },
    replySelectedText: 'orig'
  })
  await typeContent(textarea, 'reply')
  await keyDownEnter(textarea)

  expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
    '/message/conversation/5',
    expect.objectContaining({
      content: 'reply',
      replyToMessageId: 3,
      replySelectedText: 'orig'
    })
  )
})
```

Add tests for image-only send and empty text with no image staying disabled.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test tests/unit/chat-input.test.tsx
```

Expected: FAIL because `ChatInput` has no reply/image props.

- [x] **Step 3: Create attachment menu**

Create `components/message/chat/ChatAttachmentMenu.tsx`:

```tsx
'use client'

import { ImageIcon } from 'lucide-react'

interface Props {
  isOpen: boolean
  onPickImage: () => void
}

export const ChatAttachmentMenu = ({ isOpen, onPickImage }: Props) => {
  if (!isOpen) return null

  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 rounded-xl border border-default-200 bg-content1 p-2 shadow-xl">
      <button
        type="button"
        className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm transition-colors hover:bg-default-100 focus:bg-default-100"
        onClick={onPickImage}
      >
        <ImageIcon className="size-4" />
        图片
      </button>
    </div>
  )
}
```

- [x] **Step 4: Create reply preview component**

Create `components/message/chat/ChatReplyPreview.tsx`:

```tsx
'use client'

import { X } from 'lucide-react'
import { Button } from '@heroui/react'

interface Props {
  senderName: string
  content: string
  onCancel?: () => void
}

export const ChatReplyPreview = ({ senderName, content, onCancel }: Props) => (
  <div className="mb-2 flex items-start gap-2 rounded-lg border-l-3 border-primary bg-primary-50/70 px-3 py-2 text-sm dark:bg-primary-500/10">
    <div className="min-w-0 flex-1">
      <div className="font-medium text-primary">{senderName}</div>
      <div className="truncate text-default-500">{content || '[图片]'}</div>
    </div>
    {onCancel && (
      <Button isIconOnly size="sm" variant="light" aria-label="取消回复" onPress={onCancel}>
        <X className="size-4" />
      </Button>
    )}
  </div>
)
```

- [x] **Step 5: Update composer**

In `ChatInput.tsx`, add props for reply state, file picker, upload call to `/message/conversation/${conversationId}/image`, image preview, and send payload:

```ts
const payload = {
  type: selectedImage ? 1 : 0,
  content: trimmedContent || undefined,
  image: uploadedImage ?? undefined,
  replyToMessageId: replyTarget?.id,
  replySelectedText
}
```

Keep the existing IME and duplicate-send lock logic.

- [x] **Step 6: Wire container reply state**

In `ChatContainer.tsx`, keep:

```ts
const [replyDraft, setReplyDraft] = useState<{
  message: PrivateMessage
  selectedText: string | null
} | null>(null)
```

Pass `replyDraft` to `ChatInput`, clear it after successful send, and pass `onReply` to `ChatMessage`.

- [x] **Step 7: Run GREEN**

Run:

```bash
pnpm test tests/unit/chat-input.test.tsx
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add components/message/chat/ChatInput.tsx components/message/chat/ChatAttachmentMenu.tsx components/message/chat/ChatReplyPreview.tsx components/message/chat/ChatContainer.tsx tests/unit/chat-input.test.tsx
git commit -m "feat(message): add chat composer attachments and replies"
```

## Task 6: Message Row Reply Actions, Images, And Read Indicators

**Files:**
- Modify: `components/message/chat/ChatMessage.tsx`
- Modify or create: `tests/unit/chat-message-menu.test.tsx`

**Interfaces:**
- Consumes `PrivateMessage.image`, `PrivateMessage.replyTo`, `isOwn`, and `onReply(message, selectedText)`.
- Produces menu actions `回复` and `回复选中文本`, image rendering, and own-message read badge.

- [x] **Step 1: Write failing row/menu tests**

Create `tests/unit/chat-message-menu.test.tsx` with JSDOM mocks and assert:

```ts
it('shows reply action for a message context menu', async () => {
  // Render ChatMessage with a text message.
  // Fire context menu on the bubble.
  // Expect textContent to contain '回复'.
})

it('calls onReply with selected text when reply selected text is clicked', async () => {
  // Mock window.getSelection to intersect content and return 'selected'.
  // Open menu and click '回复选中文本'.
  // Expect onReply(message, 'selected').
})

it('renders a read indicator for own read messages', async () => {
  // Render own message with status 1.
  // Expect aria-label or title to include '已读'.
})
```

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test tests/unit/chat-message-menu.test.tsx
```

Expected: FAIL because reply actions and read labels do not exist.

- [x] **Step 3: Add message UI**

In `ChatMessage.tsx`:

- Add `onReply: (message: PrivateMessage, selectedText: string | null) => void`.
- Add menu buttons for `回复` and conditional `回复选中文本`.
- Render `message.replyTo` with `ChatReplyPreview`.
- Render `message.image` above caption with constrained `<img loading="lazy">`.
- Render own-message status with `Check` for unread and `CheckCheck` for read.
- Keep copy/edit/delete behavior intact.

- [x] **Step 4: Run GREEN**

Run:

```bash
pnpm test tests/unit/chat-message-menu.test.tsx tests/unit/chat-input.test.tsx
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add components/message/chat/ChatMessage.tsx tests/unit/chat-message-menu.test.tsx
git commit -m "feat(message): add reply menu and read indicators"
```

## Task 7: Frontend Cursor History And Status Refresh

**Files:**
- Modify: `components/message/chat/ChatContainer.tsx`
- Modify: `app/message/chat/[conversationId]/page.tsx`
- Modify: `tests/unit/chat-container-realtime.test.tsx`

**Interfaces:**
- Consumes `ConversationMessagesResponse.hasMoreBefore`.
- Produces older-history requests using `beforeId`, not `page`.

- [x] **Step 1: Write failing container tests**

In `tests/unit/chat-container-realtime.test.tsx`, add:

```ts
it('loads older history with beforeId instead of page skip', async () => {
  const { container } = await renderChat()
  fetchMock.kunFetchGet.mockResolvedValueOnce({
    messages: [],
    total: 0,
    hasMoreBefore: false,
    otherUser
  })

  // Trigger the IntersectionObserver callback exposed by the test mock.
  // Expect:
  expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
    '/message/conversation/5',
    expect.objectContaining({ beforeId: 1, limit: 30 })
  )
})
```

Update existing mocked responses to include `hasMoreBefore`.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test tests/unit/chat-container-realtime.test.tsx
```

Expected: FAIL because older history still uses `page`.

- [x] **Step 3: Implement before cursor**

In `ChatContainer.tsx`:

- Remove `page` as the primary history cursor.
- Compute `oldestMessageId` from loaded messages.
- Request older messages with `{ beforeId: oldestMessageId, limit: 30 }`.
- Set `hasMore` from `response.hasMoreBefore`.
- Preserve scroll-height anchoring after prepending.
- When new fetched messages include existing messages with changed `status`, merge by id so read indicators update.

- [x] **Step 4: Update initial page props**

In `app/message/chat/[conversationId]/page.tsx`, continue calling `{ page: 1, limit: 30 }` for first load and pass `response.hasMoreBefore`.

- [x] **Step 5: Run GREEN**

Run:

```bash
pnpm test tests/unit/chat-container-realtime.test.tsx tests/unit/api/conversation-messages.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/message/chat/ChatContainer.tsx app/message/chat/[conversationId]/page.tsx tests/unit/chat-container-realtime.test.tsx
git commit -m "perf(message): use cursor history in chat UI"
```

## Task 8: Documentation Sync And Verification

**Files:**
- Modify: `docs/modules/app-router.md`
- Modify: `docs/modules/frontend-content.md`
- Modify: `docs/modules/api-services.md`
- Modify: `docs/modules/data-cache-upload.md`
- Modify: `docs/project/testing.md`
- Optional Modify: `.codex/skills/otoame-frontend/SKILL.md`, `.codex/skills/otoame-api/SKILL.md`, `.codex/skills/otoame-data-cache/SKILL.md`, `.codex/skills/otoame-testing/SKILL.md` only if docs reveal recurring future-agent rules not already covered.

**Interfaces:**
- Consumes final behavior from Tasks 1-7.
- Produces updated maintainer docs.

- [x] **Step 1: Update docs**

Document:

- Message read indicators and `status`.
- Reply and selected-text reply behavior.
- Plus menu and image message flow.
- Private chat upload ownership and S3 compensation.
- `beforeId`/`afterId` cursor rules and no-store headers.
- New test files and commands.

- [x] **Step 2: Run targeted tests**

Run:

```bash
pnpm test tests/unit/api/conversation-messages.test.ts tests/unit/api/conversation-service.test.ts tests/unit/api/conversation-image-upload.test.ts
pnpm test tests/unit/chat-input.test.tsx tests/unit/chat-container-realtime.test.tsx tests/unit/chat-message-menu.test.tsx
```

Expected: PASS.

- [x] **Step 3: Run broader message tests**

Run:

```bash
pnpm test tests/unit/message-nav.test.tsx tests/unit/user-message-bell.test.tsx tests/unit/message-realtime-sync.test.tsx tests/unit/conversation-list-realtime.test.tsx
```

Expected: PASS.

- [x] **Step 4: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit docs**

```bash
git add docs/modules/app-router.md docs/modules/frontend-content.md docs/modules/api-services.md docs/modules/data-cache-upload.md docs/project/testing.md .codex/skills
git commit -m "docs(message): document im enhancement behavior"
```

Only include `.codex/skills` paths if they actually changed.

## Self-Review Checklist

- Spec coverage: Tasks 1-3 cover schema, replies, read status data, and image message persistence; Task 4 covers upload; Tasks 5-7 cover UI/UX and cursor performance; Task 8 covers docs and verification.
- Placeholder scan: clean.
- Type consistency: `PrivateMessage.image`, `PrivateMessage.replyTo`, `beforeId`, `afterId`, and `hasMoreBefore` are introduced before being consumed.
- Commit boundaries: design docs are already separate; implementation commits are feature/perf-focused; docs sync is last and separate.
