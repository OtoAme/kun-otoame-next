import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { middleware } from '~/middleware'

const { authMiddleware } = vi.hoisted(() => ({ authMiddleware: vi.fn() }))

vi.mock('~/middleware/auth', () => ({
  kunAuthMiddleware: authMiddleware
}))

const reportRequest = (headers: Record<string, string>) =>
  new NextRequest('http://127.0.0.1:33109/api/patch/resource/link/report', {
    method: 'POST',
    headers,
    body: '{}'
  })

const rejectedHeaders: Record<string, string>[] = [
  {
    origin: 'https://invalid.example.test',
    'x-requested-with': 'kun-fetch'
  },
  { origin: 'http://127.0.0.1:33109' }
]

describe('middleware CSRF responses', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV', 'http://127.0.0.1:33109')
    vi.stubEnv('NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD', '')
    authMiddleware.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(rejectedHeaders)(
    'makes a rejected API request private and uncacheable: %j',
    async (headers) => {
      const response = await middleware(reportRequest(headers))

      expect(response.status).toBe(403)
      expect(await response.json()).toBe('非法请求来源')
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('x-middleware-next')).toBeNull()
      expect(authMiddleware).not.toHaveBeenCalled()
    }
  )

  it('keeps the existing configuration error private and uncacheable', async () => {
    vi.stubEnv('NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV', '')
    const response = await middleware(
      reportRequest({
        origin: 'http://127.0.0.1:33109',
        'x-requested-with': 'kun-fetch'
      })
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toBe('服务端未配置允许的请求来源')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(authMiddleware).not.toHaveBeenCalled()
  })

  it('continues a valid API write without changing its middleware response', async () => {
    const response = await middleware(
      reportRequest({
        origin: 'http://127.0.0.1:33109',
        'x-requested-with': 'kun-fetch'
      })
    )

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('Cache-Control')).toBeNull()
    expect(authMiddleware).not.toHaveBeenCalled()
  })

  it('continues an API read without requiring write CSRF headers', async () => {
    const response = await middleware(
      new NextRequest('http://127.0.0.1:33109/api/patch/resource/link/health')
    )

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(authMiddleware).not.toHaveBeenCalled()
  })

  it('returns the original page authentication result', async () => {
    const request = new NextRequest('http://127.0.0.1:33109/dashboard')
    const authResponse = NextResponse.redirect(new URL('/login', request.url))
    authMiddleware.mockResolvedValue(authResponse)

    expect(await middleware(request)).toBe(authResponse)
    expect(authMiddleware).toHaveBeenCalledExactlyOnceWith(request)
  })
})
