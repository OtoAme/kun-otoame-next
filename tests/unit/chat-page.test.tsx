import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React

const mocks = vi.hoisted(() => ({
  kunGetConversationMessagesAction: vi.fn()
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
  KunBreadcrumbTitle: ({ title }: { title: string }) => <div>{title}</div>
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
})
