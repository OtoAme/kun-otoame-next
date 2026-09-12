import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/redis', () => ({
  getOrSet: vi.fn(),
  delKvPattern: vi.fn()
}))
vi.mock('~/app/api/utils/purgeCloudflareCache', () => ({
  purgePublicApiCache: vi.fn()
}))
import {
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
  addShoutboxRetentionMonths,
  getShoutboxExpiry
} from '~/utils/shoutboxTime'
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
    expect(SHOUTBOX_PAGE_SIZE).toBe(6)
    expect(SHOUTBOX_BLOCKED_KEYWORDS).toEqual([])
    expect(getShoutboxStatusLabel(3, false)).toBe('违规删除')
    expect(getShoutboxStatusLabel(3, true)).toBe('已撤回')
    expect(ADMIN_LOG_TYPE_MAP).toMatchObject({
      shoutbox_official_publish: '发布官方小喇叭',
      shoutbox_official_update: '更新官方小喇叭'
    })
  })

  it('uses Shanghai calendar months and clamps month ends', () => {
    const created = new Date('2026-01-31T15:59:59.999Z')
    const expiry = addShoutboxRetentionMonths(created, 3)

    expect(expiry.toISOString()).toBe('2026-04-30T15:59:59.999Z')
    expect(getShoutboxExpiry(created).toISOString()).toBe(expiry.toISOString())
  })

  it('reserves one first-page slot for a pinned message', () => {
    expect(getShoutboxPageWindow(1, true)).toEqual({ skip: 0, take: 5 })
    expect(getShoutboxPageWindow(2, true)).toEqual({ skip: 5, take: 6 })
    expect(getShoutboxPageWindow(10, false)).toEqual({ skip: 54, take: 6 })
    expect(getShoutboxPageCount(61)).toBe(10)
    expect(getShoutboxPageCount(0)).toBe(0)
  })

  it('validates user payload and keeps list page rules explicit', () => {
    expect(
      shoutboxCreateSchema.safeParse({
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        content: '  一条消息  ',
        patchId: '8'
      })
    ).toMatchObject({
      success: true,
      data: {
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        content: '一条消息',
        patchId: 8
      }
    })
    expect(shoutboxListSchema.safeParse({ page: 11, limit: 6 }).success).toBe(
      false
    )
    expect(
      shoutboxListSchema.safeParse({ page: 11, limit: 6, patch: 'Abc12345' })
        .success
    ).toBe(true)
    expect(shoutboxListSchema.safeParse({ page: 1, limit: 5 }).success).toBe(
      false
    )
    expect(
      shoutboxListSchema.safeParse({ page: 1, limit: 6, patch: 'bad' }).success
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
  })
})
