import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/redis', () => ({
  getOrSet: vi.fn(),
  delKvPattern: vi.fn()
}))
vi.mock('~/app/api/utils/purgeCloudflareCache', () => ({
  purgePublicApiCache: vi.fn()
}))
import {
  SHOUTBOX_HOME_LIMIT,
  SHOUTBOX_PAGE_SIZE,
  SHOUTBOX_PRICE,
  SHOUTBOX_BLOCKED_KEYWORDS,
  getShoutboxStatusLabel
} from '~/constants/shoutbox'
import { ADMIN_LOG_TYPE_MAP } from '~/constants/admin'
import {
  getShoutboxPageCount,
  getShoutboxPageWindow
} from '~/app/api/shoutbox/service'
import {
  shoutboxCreateSchema,
  adminShoutboxCreateSchema,
  adminShoutboxListSchema,
  adminShoutboxUpdateSchema,
  shoutboxListSchema
} from '~/validations/shoutbox'

describe('M02 shoutbox shared contract', () => {
  it('keeps fixed approved parameters and status labels', () => {
    expect(SHOUTBOX_PRICE).toBe(50)
    expect(SHOUTBOX_PAGE_SIZE).toBe(20)
    expect(SHOUTBOX_HOME_LIMIT).toBe(15)
    expect(SHOUTBOX_BLOCKED_KEYWORDS).toEqual([])
    expect(getShoutboxStatusLabel(3, false)).toBe('违规删除')
    expect(getShoutboxStatusLabel(3, true)).toBe('已撤回')
    expect(ADMIN_LOG_TYPE_MAP).toMatchObject({
      shoutbox_official_publish: '发布官方小喇叭',
      shoutbox_official_update: '更新官方小喇叭'
    })
  })

  it('reserves one first-page slot for a pinned message', () => {
    expect(getShoutboxPageWindow(1, true)).toEqual({ skip: 0, take: 19 })
    expect(getShoutboxPageWindow(2, true)).toEqual({ skip: 19, take: 20 })
    expect(getShoutboxPageWindow(1, true, SHOUTBOX_HOME_LIMIT)).toEqual({
      skip: 0,
      take: 14
    })
    expect(getShoutboxPageWindow(1, false, SHOUTBOX_HOME_LIMIT)).toEqual({
      skip: 0,
      take: 15
    })
    expect(getShoutboxPageWindow(100, false)).toEqual({ skip: 1980, take: 20 })
    expect(getShoutboxPageCount(61)).toBe(4)
    expect(getShoutboxPageCount(0)).toBe(0)
  })

  it('validates user payload and keeps list page rules explicit', () => {
    expect(
      shoutboxCreateSchema.safeParse({
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        content: '  一条\n消息  ',
        patchId: '8'
      })
    ).toMatchObject({
      success: true,
      data: {
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        content: '一条 消息',
        patchId: 8
      }
    })
    expect(shoutboxListSchema.safeParse({ page: 11, limit: 20 }).success).toBe(
      true
    )
    expect(
      shoutboxListSchema.safeParse({ view: 'home' }).success
    ).toBe(true)
    expect(
      shoutboxListSchema.safeParse({ view: 'home', limit: 15 }).success
    ).toBe(true)
    expect(
      shoutboxListSchema.safeParse({ view: 'home', limit: 20 }).success
    ).toBe(false)
    expect(
      shoutboxListSchema.safeParse({ view: 'home', patch: 'Abc12345' }).success
    ).toBe(false)
    expect(
      shoutboxListSchema.safeParse({ view: 'home', page: 2 }).success
    ).toBe(false)
    expect(
      shoutboxListSchema.safeParse({ page: 11, limit: 20, patch: 'Abc12345' })
        .success
    ).toBe(true)
    expect(shoutboxListSchema.safeParse({ page: 1, limit: 19 }).success).toBe(
      false
    )
    expect(
      shoutboxListSchema.safeParse({ page: 1, limit: 20, patch: 'bad' }).success
    ).toBe(false)
    expect(
      adminShoutboxCreateSchema.safeParse({
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        content: '维护通知',
        link: '/doc/notice/maintenance'
      }).success
    ).toBe(true)
    expect(
      adminShoutboxCreateSchema.safeParse({
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        content: '维护通知',
        link: 'https://evil.example/notice/maintenance'
      }).success
    ).toBe(false)
    expect(
      adminShoutboxUpdateSchema.safeParse({
        shoutboxId: 1,
        action: 'end',
        content: '不应静默忽略'
      }).success
    ).toBe(false)
    expect(adminShoutboxListSchema.parse({}).tab).toBe('official')
    expect(
      adminShoutboxListSchema.safeParse({ tab: 'pending_review' }).success
    ).toBe(true)
    expect(
      adminShoutboxListSchema.parse({ shoutboxId: '42' }).shoutboxId
    ).toBe(42)
    expect(
      adminShoutboxListSchema.safeParse({ shoutboxId: 0 }).success
    ).toBe(false)
    expect(
      adminShoutboxListSchema.safeParse({
        shoutboxId: Number.MAX_SAFE_INTEGER
      }).success
    ).toBe(false)
  })
})
