import { NextResponse } from 'next/server'
import { kunAuthMiddleware } from '~/middleware/auth'
import { verifyKunCsrf } from '~/middleware/_csrf'
import type { NextRequest } from 'next/server'

export const config = {
  matcher: [
    '/admin/:path*',
    '/user/:path*',
    '/comment/:path*',
    '/edit/:path*',
    // 上传路由在 handler 内自行校验 CSRF，避免 middleware 缓冲大体积 body
    '/api/((?!upload/).*)'
  ]
}

export const middleware = async (request: NextRequest) => {
  if (request.nextUrl.pathname.startsWith('/api')) {
    const csrfError = verifyKunCsrf(request)
    if (csrfError) {
      return NextResponse.json(csrfError, { status: 403 })
    }
    return NextResponse.next()
  }

  return kunAuthMiddleware(request)
}
