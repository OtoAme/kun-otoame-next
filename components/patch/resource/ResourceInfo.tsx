'use client'

import { Chip } from '@heroui/react'
import { KunPatchAttribute } from '~/components/kun/PatchAttribute'
import type { PatchResource } from '~/types/api/patch'
import { readPublicMirrorFacts } from './publicMirrorFacts'

interface Props {
  resource: PatchResource
}

export const ResourceInfo = ({ resource }: Props) => {
  const facts = readPublicMirrorFacts(resource)
  return (
    <div className="min-w-0 space-y-2">
      <KunPatchAttribute
        types={resource.type}
        languages={resource.language}
        platforms={resource.platform}
        chipContentClassName="font-medium"
      />
      {facts.staffMaintained || facts.hasStaffBackup ? (
        <div className="flex flex-wrap gap-1">
          {facts.staffMaintained ? (
            <Chip size="sm" variant="flat">
              站方维护
            </Chip>
          ) : null}
          {facts.hasStaffBackup ? (
            <Chip size="sm" variant="flat">
              站方已备份
              {facts.backupDates[0] ? ` ${facts.backupDates[0]}` : ''}
            </Chip>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
