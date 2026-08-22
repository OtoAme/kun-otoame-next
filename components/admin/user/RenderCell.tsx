'use client'

import { Button, Chip, Tooltip } from '@heroui/react'
import Link from 'next/link'
import { ReceiptText } from 'lucide-react'
import {
  USER_ROLE_MAP,
  USER_STATUS_COLOR_MAP,
  USER_STATUS_MAP
} from '~/constants/user'
import { UserEdit } from './UserEdit'
import { UserDelete } from './UserDelete'
import { GrantMoemoepoint } from './GrantMoemoepoint'
import { KunUser } from '~/components/kun/floating-card/KunUser'
import type { AdminUser as AdminUserType } from '~/types/api/admin'

export const RenderCell = (user: AdminUserType, columnKey: string) => {
  switch (columnKey) {
    case 'user':
      return (
        <KunUser
          user={user}
          userProps={{
            name: user.name,
            description: `补丁数 - ${user._count.patch} | 资源数 - ${user._count.patch_resource}`,
            avatarProps: {
              src: user.avatar
            }
          }}
        />
      )
    case 'role':
      return (
        <Chip color="primary" variant="flat">
          {USER_ROLE_MAP[user.role]}
        </Chip>
      )
    case 'status':
      return (
        <Chip color={USER_STATUS_COLOR_MAP[user.status]} variant="flat">
          {USER_STATUS_MAP[user.status]}
        </Chip>
      )
    case 'actions':
      return (
        <div className="flex items-center gap-2">
          <Tooltip content="查看萌萌点明细">
            <Button
              as={Link}
              href={`/admin/user/${user.id}/moemoepoint`}
              isIconOnly
              size="sm"
              variant="light"
              aria-label={`查看 ${user.name} 的萌萌点明细`}
            >
              <ReceiptText className="size-4" />
            </Button>
          </Tooltip>
          <GrantMoemoepoint user={user} />
          <UserEdit initialUser={user} />
          <UserDelete user={user} />
        </div>
      )
    default:
      return (
        <Chip color="primary" variant="flat">
          咕咕咕
        </Chip>
      )
  }
}
