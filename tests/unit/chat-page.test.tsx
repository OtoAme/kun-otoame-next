import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React

const mocks = vi.hoisted(() => ({
  kunGetConversationMessagesAction: vi.fn(),
  KunBreadcrumbTitle: vi.fn(() => <div data-testid="chat-breadcrumb-title" />)
}))

vi.mock('~/app/message/chat/actions', () => ({
  kunGetConversationMessagesAction: mocks.kunGetConversationMessagesAction
}))

vi.mock('~/components/error/ErrorComponent', () => ({
  ErrorComponent: ({ error }: { error: string }) => (
    <div data-testid="chat-error">{error}</div>
  )
}))

vi.mock('~/components/kun/BreadcrumbTitle', () => ({
  KunBreadcrumbTitle: mocks.KunBreadcrumbTitle
}))

vi.mock('~/components/message/chat/ChatContainer', () => ({
  ChatContainer: ({ conversationId }: { conversationId: number }) => (
    <div data-testid="chat-container">{conversationId}</div>
  )
}))

describe('/message/chat/[conversationId] page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects malformed conversation IDs before loading initial messages', async () => {
    mocks.kunGetConversationMessagesAction.mockResolvedValue({
      messages: [],
      total: 0,
      hasMoreBefore: false,
      otherUser: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    })

    const { default: Page } = await import(
      '~/app/message/chat/[conversationId]/page'
    )
    const element = (await Page({
      params: Promise.resolve({ conversationId: '5abc' })
    })) as React.ReactElement<{ error: string }>

    expect(mocks.kunGetConversationMessagesAction).not.toHaveBeenCalled()
    expect(element.props.error).toBe('无效的会话 ID')
  })

  it('renders a conversation without registering a breadcrumb title', async () => {
    mocks.kunGetConversationMessagesAction.mockResolvedValue({
      messages: [],
      total: 0,
      hasMoreBefore: false,
      otherUser: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    })

    const { default: Page } = await import(
      '~/app/message/chat/[conversationId]/page'
    )
    const element = (await Page({
      params: Promise.resolve({ conversationId: '5' })
    })) as React.ReactElement<{ conversationId: number; className?: string }>

    expect(mocks.kunGetConversationMessagesAction).toHaveBeenCalledWith(5, {
      page: 1,
      limit: 30
    })
    expect(mocks.KunBreadcrumbTitle).not.toHaveBeenCalled()
    expect(element.props.conversationId).toBe(5)
    expect(element.props.className).toBe(
      'h-[calc(100dvh_-_192px_-_var(--message-chat-top-reserve))]'
    )
  })
})
