import Link from 'next/link'
import { Chip } from '@heroui/chip'
import { Gamepad2, Link2 } from 'lucide-react'
import type { HelpPatchLink } from '~/types/api/help'

interface Props {
  patch: HelpPatchLink | null
  gameName: string
  /** Number of reference links on a game the site has no entry for. */
  linkCount?: number
}

/**
 * The game a post is about. A site entry links to its page with the same
 * gamepad mark the shoutbox uses; a name the site has no entry for shows as a
 * plain chip, with a link mark when the poster added reference pages.
 */
export const HelpGameChip = ({ patch, gameName, linkCount = 0 }: Props) => {
  if (patch) {
    return (
      <Chip
        as={Link}
        href={`/${patch.uniqueId}`}
        size="sm"
        variant="flat"
        color="primary"
        title={patch.name}
        startContent={<Gamepad2 className="size-3.5 shrink-0" aria-hidden />}
        classNames={{
          base: 'relative z-10 max-w-[16rem] px-2',
          content: 'truncate'
        }}
      >
        {patch.name}
      </Chip>
    )
  }
  if (!gameName) return null
  return (
    <Chip
      size="sm"
      variant="flat"
      title={`${gameName}（本站尚无此游戏）`}
      startContent={
        linkCount > 0 ? (
          <Link2 className="size-3.5 shrink-0" aria-hidden />
        ) : undefined
      }
      classNames={{ base: 'max-w-[16rem] px-2', content: 'truncate' }}
    >
      {gameName}（本站尚无此游戏）
    </Chip>
  )
}
