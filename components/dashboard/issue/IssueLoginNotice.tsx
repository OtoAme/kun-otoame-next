import Link from 'next/link'
import { LogIn } from 'lucide-react'

import { Button } from '~/components/dashboard/ui/button'
import { Card, CardContent } from '~/components/dashboard/ui/card'

/** 未登录兜底：/issue 归 middleware 鉴权，这里给登录引导而不是报错。 */
export function IssueLoginNotice() {
  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted">
          <LogIn className="size-5 text-muted-foreground" aria-hidden />
        </span>
        <h1 className="text-base font-semibold">请先登录</h1>
        <p className="text-sm text-muted-foreground">
          登录后才能查看和跟进自己提交的问题。还没有账号的话，可以先注册。
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <Button asChild>
            <Link href="/login" prefetch={false}>
              登录
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/register" prefetch={false}>
              注册账号
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
