import { describe, expect, it } from 'vitest'
import { recognizeLinkCheckProvider } from '~/utils/recognizeLinkCheckProvider'

describe('recognizeLinkCheckProvider', () => {
  it.each([
    ['https://pan.quark.cn/s/SYN', 'quark'],
    ['http://pan.quark.cn/s/SYN', 'quark'],
    ['https://123pan.cn/s/SYN', 'pan123'],
    ['https://www.123pan.cn/s/SYN', 'pan123'],
    ['https://share.123pan.cn/s/SYN', 'pan123'],
    ['https://drive.uc.cn/s/SYN', 'uc'],
    ['https://pan.baidu.com/s/1SYN', 'baidu'],
    ['https://caiyun.139.com/front/#/detail?linkID=SYN', 'caiyun'],
    ['https://yun.139.com/m/i?SYN', 'caiyun'],
    ['https://www.123pan.com/s/SYN', 'pan123'],
    ['https://123684.com/123pan/SYN', 'pan123']
  ] as const)('recognizes %s as %s', (url, provider) => {
    expect(recognizeLinkCheckProvider(url)).toBe(provider)
  })

  it.each([
    'https://caiyun.139.com/m/i?bad%2Fid',
    'https://caiyun.139.com/front/#/detail?linkID=',
    'https://pan.quark.cn:8443/s/SYN',
    'https://SYN:SYN@pan.quark.cn/s/SYN',
    'https://pan.quark.cn.evil.invalid/s/SYN',
    'https://arbitrary.123pan.com/s/SYN',
    'https://example.com/s/SYN',
    'magnet:?xt=SYN'
  ])('returns null for %s', (url) => {
    expect(recognizeLinkCheckProvider(url)).toBeNull()
  })
})
