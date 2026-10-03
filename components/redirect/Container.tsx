'use client'

import { Suspense } from 'react'
import { Alert, Image, Link } from '@heroui/react'
import { KunRedirectCard } from './KunRedirectCard'
import { kunMoyuMoe } from '~/config/moyu-moe'

export const KunRedirectContainer = () => {
  return (
    <div className="container mx-auto my-8">
      <div className="flex flex-col items-center justify-center gap-8">
        <div className="text-center">
          <h1 className="mb-2 text-3xl font-medium">外部链接跳转</h1>
          <p className="text-default-500">在您继续前往之前, 请确认下方的链接</p>
        </div>

        <Suspense>
          <KunRedirectCard />
        </Suspense>

        <div className="w-full max-w-2xl">
          <Alert
            description={
              <>
                下载如果出现问题，请移步阅读
                <Link href="/doc/notice/start" size="sm" underline="always">
                  🔗常见问题文章
                </Link>
                查询解决方案。
                <br />
                如果觉得本站好用的话，请把本站分享给更多人，这对我们非常重要，谢谢♥️！！
              </>
            }
            title="公告"
            color="secondary"
            variant="faded"
          />
        </div>

        <div className="w-full max-w-2xl rounded-large">
          {/* <Link isExternal href="https://pan.209911.xyz/"> */}
          <Image alt={kunMoyuMoe.title} src="/images/invite.png" />
          {/* </Link> */}
        </div>
      </div>
    </div>
  )
}
