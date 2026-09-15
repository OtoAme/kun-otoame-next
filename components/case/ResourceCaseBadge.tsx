'use client'

import { Chip } from '@heroui/react'
import type { PatchCaseSummary } from '~/types/api/case'

interface Props {
  summary: PatchCaseSummary
}

/**
 * 资源卡片公开徽标：只含报告人数与当前处理方，不带正文、身份或任何链接。
 */
export const ResourceCaseBadge = ({ summary }: Props) => {
  return (
    <Chip size="sm" color="warning" variant="flat">
      {summary.ownerType === 'publisher'
        ? `已有 ${summary.reportCount} 人报告，发布者处理中`
        : '站方处理中'}
    </Chip>
  )
}
