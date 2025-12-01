'use client'

import { Card, CardBody } from '@heroui/card'
import { Chip } from '@heroui/chip'
import { Link } from '@heroui/link'

export const PatchOfficialUrl = ({ url }: { url: string }) => {
  if (!url) return null

  let domain = ''
  try {
    domain = new URL(url).hostname
  } catch { }

  return (
    <div className="w-full mt-4 space-y-4">
      <h2 className="text-xl font-medium">购买正版</h2>
      <Card className="w-full shadow-medium">
        <CardBody className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Chip
              size="sm"
              color="primary"
              variant="flat"
              className="h-6 text-tiny"
            >
              外部链接
            </Chip>
            <span className="text-default-500 text-small">{domain}</span>
          </div>
          <p className="text-small text-default-500 m-0">
            点我前往购买, 游戏官网可能需要代理打开
          </p>
          <Link
            isExternal
            showAnchorIcon
            href={url}
            className="text-medium break-all"
          >
            {url}
          </Link>
        </CardBody>
      </Card>
    </div>
  )
}
