import { describe, expect, it } from 'vitest'
import {
  chatReviewTargets,
  getChatSyncInterval,
  mergeChatMessages
} from '~/utils/privateChatSync'
import type { PrivateMessage } from '~/types/api/conversation'

const message = (
  id: number,
  extra: Partial<PrivateMessage> = {}
): PrivateMessage => ({
  id,
  type: 0,
  content: `body ${id}`,
  status: 0,
  isDeleted: false,
  image: null,
  images: [],
  replyTo: null,
  editedAt: null,
  created: new Date(1000 - id),
  sender: { id: 2, name: 'Synthetic', avatar: '' },
  ...extra
})

describe('private chat merge invariants', () => {
  it('orders by message number and merges over 80 messages with gaps and reversed timestamps', () => {
    const all = Array.from({ length: 130 }, (_, index) =>
      message(index * 2 + 1)
    )
    const deleted = new Set<number>()
    const cache = new Map<number, PrivateMessage>()
    let result = mergeChatMessages(
      all.slice(30, 80),
      all.slice(80, 130),
      [],
      [],
      deleted,
      cache
    )
    result = mergeChatMessages(result, all.slice(0, 30), [], [], deleted, cache)
    result = mergeChatMessages(
      result,
      all.slice(80, 130),
      [],
      [],
      deleted,
      cache
    )
    expect(result.map((item) => item.id)).toEqual(all.map((item) => item.id))
  })

  it('permanently scrubs deleted payloads, quote previews and caches against late responses', () => {
    const target = message(1, {
      type: 1,
      image: {
        url: '/private.webp',
        name: 'private',
        width: 1,
        height: 1,
        size: 1,
        mime: 'image/webp'
      }
    })
    const reply = message(2, {
      replyTo: {
        messageId: 1,
        content: 'private',
        senderName: 'Synthetic',
        selectedText: 'private',
        image: target.image
      }
    })
    const deleted = new Set<number>()
    const cache = new Map<number, PrivateMessage>([[1, target]])
    let result = mergeChatMessages([target, reply], [], [], [1], deleted, cache)
    result = mergeChatMessages(
      result,
      [target],
      [target, reply],
      [],
      deleted,
      cache
    )
    expect(result[0]).toMatchObject({
      isDeleted: true,
      content: '',
      images: [],
      image: null,
      sticker: null,
      replyTo: null
    })
    expect(result[1].replyTo).toBeNull()
    expect(cache.has(1)).toBe(false)
  })

  it('updates reviewed quote targets without inserting unloaded history or reverting edits', () => {
    const reply = message(8, {
      replyTo: {
        messageId: 1,
        content: 'old',
        senderName: 'Synthetic',
        selectedText: 'old'
      }
    })
    const edited = message(1, { content: 'new', editedAt: new Date(5000) })
    const deleted = new Set<number>()
    const cache = new Map<number, PrivateMessage>()
    let result = mergeChatMessages([reply], [], [edited], [], deleted, cache)
    result = mergeChatMessages(result, [], [message(1)], [], deleted, cache)
    expect(result).toHaveLength(1)
    expect(result[0].replyTo).toMatchObject({
      content: 'new',
      selectedText: null
    })
  })

  it('prioritizes operation targets without truncating visible targets or references', () => {
    const visible = Array.from({ length: 120 }, (_, index) =>
      message(index + 1)
    )
    visible[0].replyTo = {
      messageId: 500,
      content: '',
      senderName: '',
      selectedText: null
    }
    const ids = chatReviewTargets([119, 600, 119, 0], visible)
    expect(ids.slice(0, 2)).toEqual([119, 600])
    expect(ids).toHaveLength(122)
    expect(ids).toContain(500)
  })

  it.each([
    [0, 2000],
    [59999, 2000],
    [60000, 5000],
    [179999, 5000],
    [180000, 15000],
    [600000, 15000]
  ])('uses a shared quiet origin at %sms', (elapsed, expected) =>
    expect(getChatSyncInterval(1000, 1000 + elapsed)).toBe(expected)
  )
})
