'use client'

import { Chip } from '@heroui/react'
import Link from 'next/link'
import { SUPPORTED_RESOURCE_LINK_MAP } from '~/constants/resource'
import { formatTimeDifference } from '~/utils/time'
import { ResourceEdit } from './ResourceEdit'
import { KunUser } from '~/components/kun/floating-card/KunUser'
import type { AdminResource } from '~/types/api/admin'

interface RenderCellOptions {
  onResourceUpdated?: (resource: AdminResource) => void
  onResourceDeleted?: (resourceId: number) => void
}

export const RenderCell = (
  resource: AdminResource,
  columnKey: string,
  options: RenderCellOptions = {}
) => {
  const sectionLabel = resource.section === 'patch' ? '补丁' : '资源'

  switch (columnKey) {
    case 'name':
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="whitespace-normal break-words text-sm font-medium leading-5 text-default-900 [overflow-wrap:anywhere]">
            {resource.name || '未命名资源'}
          </p>
          <Link
            href={`/${resource.uniqueId}`}
            className="w-fit max-w-full whitespace-normal break-words text-xs leading-5 text-default-500 [overflow-wrap:anywhere] hover:text-primary-500"
          >
            {resource.patchName}
          </Link>
        </div>
      )
    case 'section':
      return (
        <Chip size="sm" variant="flat" color="secondary">
          {sectionLabel}
        </Chip>
      )
    case 'user':
      return (
        <div className="min-w-[7rem] whitespace-normal break-words [overflow-wrap:normal]">
          <KunUser
            user={resource.user}
            userProps={{
              name: resource.user.name,
              classNames: {
                name: 'whitespace-normal break-words [overflow-wrap:normal]'
              },
              avatarProps: {
                src: resource.user.avatar
              }
            }}
          />
        </div>
      )
    case 'storage':
      return (
        <div className="flex flex-wrap gap-1">
          {resource.links.map((link) => (
            <Chip key={link.id} color="primary" variant="flat">
              {SUPPORTED_RESOURCE_LINK_MAP[link.storage]}
            </Chip>
          ))}
        </div>
      )
    case 'size':
      return (
        <div className="flex flex-wrap gap-1">
          {resource.links.map((link) => (
            <Chip key={link.id} size="sm" variant="flat">
              {link.size}
            </Chip>
          ))}
        </div>
      )
    case 'created':
      return (
        <Chip size="sm" variant="light">
          {formatTimeDifference(resource.created)}
        </Chip>
      )
    case 'actions':
      return (
        <ResourceEdit
          initialResource={resource}
          onResourceUpdated={options.onResourceUpdated}
          onResourceDeleted={options.onResourceDeleted}
        />
      )
    default:
      return (
        <Chip color="primary" variant="flat">
          未知
        </Chip>
      )
  }
}
