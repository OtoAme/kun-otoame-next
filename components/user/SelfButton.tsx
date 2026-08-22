'use client'

import { Button } from '@heroui/button'
import { BadgeCheck, Pencil, ReceiptText, Shield } from 'lucide-react'
import { useRouter } from '@bprogress/next'
import type { UserInfo } from '~/types/api/user'
import { canAccessAdmin } from '~/constants/user'

interface Props {
  user: UserInfo
}

export const SelfButton = ({ user }: Props) => {
  const router = useRouter()
  const isShowAdminButton =
    user.id === user.requestUserUid && canAccessAdmin(user.role)

  return (
    <div className="w-full space-y-3">
      <div className="flex space-x-3">
        <Button
          startContent={<Pencil className="size-4" />}
          color="primary"
          variant="flat"
          className="kun-user-primary-flat"
          fullWidth
          onPress={() => router.push('/settings/user')}
        >
          编辑信息
        </Button>

        <Button
          startContent={<ReceiptText className="size-4" />}
          color="primary"
          variant="flat"
          className="kun-user-primary-flat"
          fullWidth
          onPress={() => router.push('/moemoepoint')}
        >
          萌萌点明细
        </Button>
      </div>

      {isShowAdminButton && (
        <Button
          startContent={<Shield className="size-4" />}
          color="primary"
          fullWidth
          onPress={() => router.push('/admin')}
        >
          管理后台
        </Button>
      )}

      {user.role < 2 && (
        <Button
          startContent={<BadgeCheck className="size-4" />}
          color="primary"
          fullWidth
          onPress={() => router.push('/apply')}
        >
          申请成为创作者
        </Button>
      )}
    </div>
  )
}
