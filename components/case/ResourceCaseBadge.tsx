'use client'

import { Chip } from '@heroui/react'
import { CASE_KIND_LABELS } from '~/constants/case'
import type { PatchCaseSummary } from '~/types/api/case'

interface Props {
  summary: PatchCaseSummary
}

/**
 * 资源卡片公开徽标：只含问题类型、报告人数与当前处理方，不带正文、身份或任何链接。
 */
export const ResourceCaseBadge = ({ summary }: Props) => {
  const handler =
    summary.ownerType === 'publisher' ? '发布者处理中' : '网站管理员处理中'
  return (
    <Chip size="sm" color="warning" variant="flat">
      {`${CASE_KIND_LABELS[summary.kind]} · 已有 ${summary.reportCount} 人报告，${handler}`}
    </Chip>
  )
}
