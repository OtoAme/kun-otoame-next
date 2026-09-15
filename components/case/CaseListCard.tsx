'use client'

import Link from 'next/link'
import { Chip } from '@heroui/react'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import {
  caseKindLabel,
  caseResolutionLabel,
  caseStatusLabel,
  caseTargetText
} from './caseDisplay'
import type { CaseListItem, CaseStatus } from '~/types/api/case'

const STATUS_CHIP_COLORS: Record<
  CaseStatus,
  'default' | 'primary' | 'warning' | 'success' | 'danger'
> = {
  open: 'primary',
  waiting_owner: 'primary',
  waiting_reporter: 'warning',
  resolved: 'success',
  rejected: 'danger',
  merged: 'default'
}

interface Props {
  item: CaseListItem
}

export const CaseListCard = ({ item }: Props) => {
  const resolutionLabel = caseResolutionLabel(item.resolution)

  return (
    <Link
      href={`/issue/${item.id}`}
      className="block rounded-2xl border border-default-200 p-4 transition-colors hover:bg-default-50"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip size="sm" variant="flat" color="default">
          {caseKindLabel(item.kind)}
        </Chip>
        <Chip size="sm" variant="flat" color={STATUS_CHIP_COLORS[item.status]}>
          {caseStatusLabel(item.status)}
        </Chip>
        {resolutionLabel && (
          <Chip size="sm" variant="bordered">
            {resolutionLabel}
          </Chip>
        )}
        {item.subscriberCount !== null && (
          <span className="text-xs text-default-400">
            {item.subscriberCount} 人报告
          </span>
        )}
        <span className="ml-auto text-xs text-default-400">
          {formatChinaDateTime(item.created)}
        </span>
      </div>

      <p className="mt-2 break-words text-sm font-medium">
        {caseTargetText(item)}
      </p>

      {item.latestMessage?.body && (
        <p className="mt-1 truncate text-sm text-default-500">
          {item.latestMessage.body}
        </p>
      )}
    </Link>
  )
}
