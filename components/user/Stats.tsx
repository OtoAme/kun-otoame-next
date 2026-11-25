import { Card, CardBody } from '@heroui/card'
import { Library, MessageCircle, Puzzle, Star } from 'lucide-react'
import { PROFILE_CONTRIBUTIONS } from '~/constants/user'
import type { UserInfo } from '~/types/api/user'

const icons = {
  patch_resource: Puzzle,
  patch: Library,
  patch_comment: MessageCircle,
  patch_rating: Star
}

export const UserStats = ({ user }: { user: UserInfo }) => {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {PROFILE_CONTRIBUTIONS.map(({ key, label }) => {
        const Icon = icons[key]
        return (
          <Card key={key} className="w-full">
            <CardBody className="flex flex-row items-center gap-4 p-4">
              <Icon className="kun-user-stat-icon size-8 text-primary" />
              <div>
                <p className="text-xl font-bold">{user._count[key]}</p>
                <p className="text-small text-default-500">{label}</p>
              </div>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}
