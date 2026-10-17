import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canCheckResourceLink,
  canManageResource,
  canManageResourceLink
} from '~/components/patch/resource/resourcePermissions'

const redis = vi.hoisted(() => ({ eval: vi.fn() }))
vi.mock('~/lib/redis', () => ({
  redis,
  getPrefixedRedisKey: (key: string) => `fixture:${key}`,
  runRedisCommand: (run: () => unknown) => run()
}))
import { checkLinkHealthRateLimit } from '~/app/api/patch/resource/link/rateLimit'

beforeEach(() => vi.clearAllMocks())

describe('signed-in link inspection is independent of management', () => {
  it.each([
    ['user', 1], ['user', 2], ['touchgal', 1], ['touchgal', 2]
  ] as const)('allows a non-owner role %s/%s to check without edit or owner powers', (storage, userRole) => {
    const input = { storage, content: 'https://pan.quark.cn/s/SYN', resourceUserId: 7, userId: 8, userRole }
    expect(canCheckResourceLink(input)).toBe(true)
    expect(canManageResourceLink(input)).toBe(false)
    expect(canManageResource(input)).toBe(false)
  })

  it.each([
    [0, 1], [0, 3], [-1, 1], [8, 0]
  ] as const)('denies inspection for uid %s and role %s', (userId, userRole) => {
    expect(canCheckResourceLink({
      storage: 'user', content: 'https://pan.quark.cn/s/SYN', resourceUserId: 7, userId, userRole
    })).toBe(false)
  })

  it.each([
    'https://pan.baidu.com/s/1SYN',
    'https://pan.quark.cn/s/SYN',
    'http://drive.uc.cn/s/SYN',
    'https://caiyun.139.com/front/#/detail?linkID=SYN',
    'https://yun.139.com/m/i?SYN',
    'https://share.123pan.cn/s/SYN',
    '链接：https://pan.quark.cn/s/SYN 提取码：SYN'
  ])('allows a supported share regardless of storage: %s', (content) => {
    for (const storage of ['user', 'touchgal', 's3'])
      expect(canCheckResourceLink({ content, storage, resourceUserId: 7, userId: 8, userRole: 1 })).toBe(true)
    expect(canCheckResourceLink({ content, storage: 'user', resourceUserId: 7, userId: 0, userRole: 1 })).toBe(false)
  })

  it.each([
    'https://pan.otoame.top/s/SYN',
    'https://1drv.ms/f/SYN',
    'https://fixture.s3.example.test/file.zip',
    'https://example.test/s/SYN',
    'magnet:?xt=urn:btih:SYN',
    'magnet:?xt=urn:btih:SYN&tr=https://pan.quark.cn/s/SYN',
    'ftp://fixture.test/?share=https://pan.quark.cn/s/SYN',
    'https:pan.quark.cn/s/SYN',
    'https:////pan.quark.cn/s/SYN',
    'not a URL',
    'https://pan.quark.cn/',
    'https://pan.baidu.com/s/SYN',
    'https://drive.uc.cn/drive',
    'https://caiyun.139.com/m/i',
    'https://www.123pan.com/',
    'https://pan.quark.cn.evil.test/s/SYN',
    'https://evil.test/?url=https://pan.quark.cn/s/SYN',
    'https://pan.quark.cn@evil.test/s/SYN',
    'https://SYN:SYN@pan.quark.cn/s/SYN',
    'https://pan.quark.cn:8443/s/SYN',
    'https://pan.quark.cn/s/',
    'ftp://pan.quark.cn/s/SYN'
  ])('offers no inspection to any owner or staff for %s', (content) => {
    for (const [userId, userRole] of [[8, 1], [7, 2], [8, 3]] as const)
      expect(canCheckResourceLink({ content, storage: 'touchgal', resourceUserId: 7, userId, userRole })).toBe(false)
  })

  it('keeps the shared per-user limit at 30 attempts per 60 seconds', async () => {
    redis.eval.mockResolvedValueOnce([30, 60000]).mockResolvedValueOnce([31, 59001])
    expect(await checkLinkHealthRateLimit(8)).toBeNull()
    expect(await checkLinkHealthRateLimit(8)).toBe(60)
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('EXPIRE',KEYS[1],60)"),
      1,
      'fixture:link-health:user:8'
    )
  })
})
