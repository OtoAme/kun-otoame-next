import { Checkbox, Chip } from '@heroui/react'
import { KunAvatar } from '~/components/kun/floating-card/KunAvatar'
import { Card, CardBody } from '@heroui/card'
import { ThumbsUp } from 'lucide-react'
import { formatDate } from '~/utils/time'
import {
  KUN_GALGAME_RATING_PLAY_STATUS_MAP,
  KUN_GALGAME_RATING_RECOMMEND_MAP,
  KUN_GALGAME_RATING_SPOILER_MAP
} from '~/constants/galgame'
import Link from 'next/link'
import { RatingEdit } from './RatingEdit'
import type { AdminRating } from '~/types/api/admin'

const recommendColor: Record<
  string,
  'success' | 'primary' | 'default' | 'warning' | 'danger'
> = {
  strong_yes: 'success',
  yes: 'primary',
  neutral: 'default',
  no: 'warning',
  strong_no: 'danger'
}

interface Props {
  rating: AdminRating
  isSelected: boolean
  isSelectionDisabled?: boolean
  onSelectionChange: (isSelected: boolean) => void
  onRefresh: () => Promise<void> | void
}

export const RatingCard = ({
  rating,
  isSelected,
  isSelectionDisabled,
  onSelectionChange,
  onRefresh
}: Props) => {
  return (
    <Card className={isSelected ? 'ring-2 ring-primary-300' : undefined}>
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-1 gap-4">
            <div className="relative flex-shrink-0 min-w-12 pb-6">
              <KunAvatar
                uid={rating.user.id}
                avatarProps={{
                  name: rating.user.name,
                  src: rating.user.avatar
                }}
              />
              <Checkbox
                aria-label={`选择评价 ${rating.id}`}
                className="absolute left-0 bottom-0"
                isDisabled={isSelectionDisabled}
                isSelected={isSelected}
                onValueChange={onSelectionChange}
              />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-semibold">{rating.user.name}</h2>
                <span className="text-small text-default-500">
                  评价在{' '}
                  <Link
                    className="text-primary-500"
                    href={`/${rating.uniqueId}`}
                  >
                    {rating.patchName}
                  </Link>
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Chip
                  color={recommendColor[rating.recommend] ?? 'default'}
                  variant="flat"
                  size="sm"
                >
                  {KUN_GALGAME_RATING_RECOMMEND_MAP[rating.recommend] ?? rating.recommend}
                </Chip>
                <Chip variant="flat" size="sm">
                  评分 {rating.overall}/10
                </Chip>
                <span className="text-tiny text-default-400">
                  {KUN_GALGAME_RATING_PLAY_STATUS_MAP[rating.playStatus] ?? rating.playStatus}
                </span>
                {rating.spoilerLevel !== 'none' && (
                  <span className="text-tiny text-warning-500">
                    {KUN_GALGAME_RATING_SPOILER_MAP[rating.spoilerLevel] ?? rating.spoilerLevel}
                  </span>
                )}
              </div>
              <p className="mt-1">{rating.shortSummary}</p>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-1 text-small text-default-500">
                  <ThumbsUp size={14} />
                  {rating.like}
                </div>
                <span className="text-small text-default-500">
                  {formatDate(rating.created, {
                    isPrecise: true,
                    isShowYear: true
                  })}
                </span>
              </div>
            </div>
          </div>

          <RatingEdit initialRating={rating} onSuccess={onRefresh} />
        </div>
      </CardBody>
    </Card>
  )
}
