import { NextResponse } from 'next/server'
import { kunAuthMiddleware } from '~/middleware/auth'
import { verifyKunCsrf } from '~/middleware/_csrf'
import type { NextRequest } from 'next/server'

export const config = {
  matcher: [
    '/admin/:path*',
    '/dashboard/:path*',
    '/preview/:path*',
    '/issue/:path*',
    '/workspace/:path*',
    '/user/:path*',
    '/comment/:path*',
    '/edit/:path*',
    // 大体积上传路由在 handler 内自行校验 CSRF，避免 middleware 缓冲请求体
    '/api/((?!home$|upload/|admin/stickers/import/?$|patch-submission/asset/?$|tag/otomegame|company/otomegame).*)'
  ]
}

export const middleware = async (request: NextRequest) => {
  if (request.nextUrl.pathname.startsWith('/api')) {
    const csrfError = verifyKunCsrf(request)
    if (csrfError) {
      const workspace =
        request.nextUrl.pathname === '/api/workspace' ||
        request.nextUrl.pathname.startsWith('/api/workspace/')
      const requestId = workspace ? crypto.randomUUID() : undefined
      if (requestId)
        console.warn('[Workspace]', {
          requestId,
          operation: 'workspace.csrf',
          route: '/api/workspace/[csrf]',
          status: 403,
          result: 'denied'
        })
      return NextResponse.json(csrfError, {
        status: 403,
        headers: {
          'Cache-Control': 'private, no-store',
          ...(requestId ? { 'X-Request-Id': requestId } : {})
        }
      })
    }
    return NextResponse.next()
  }

  return kunAuthMiddleware(request)
}
