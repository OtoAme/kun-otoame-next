'use client'

import { Button } from '@heroui/button'
import { Tooltip } from '@heroui/tooltip'
import { Share2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { kunMoyuMoe } from '~/config/moyu-moe'
import type { PatchResource } from '~/types/api/patch'

/** Share link of one resource card; the game page scrolls to and highlights it. */
export const resourceShareLink = (
  resource: Pick<PatchResource, 'id' | 'section' | 'uniqueId'>
) =>
  `${kunMoyuMoe.domain.main.replace(/\/+$/, '')}/${resource.uniqueId}?tab=resources&resourceSection=${resource.section}&resourceId=${resource.id}`

export const ResourceShareButton = ({
  resource
}: {
  resource: Pick<PatchResource, 'id' | 'section' | 'uniqueId'>
}) => {
  const handleCopy = () => {
    navigator.clipboard
      .writeText(resourceShareLink(resource))
      .then(() => toast.success('资源分享链接已复制'))
      .catch(() => toast.error('复制失败，请更换浏览器后重试'))
  }
  return (
    <Tooltip content="复制分享链接">
      <Button
        size="sm"
        variant="light"
        isIconOnly
        aria-label="复制分享链接"
        onPress={handleCopy}
      >
        <Share2 className="size-4" />
      </Button>
    </Tooltip>
  )
}
