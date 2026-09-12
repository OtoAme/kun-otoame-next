'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Alert } from '@heroui/alert'
import { Megaphone } from 'lucide-react'
import { isAdminPreviewPath } from '~/constants/routes/matcher'
import { useShoutboxBanner } from '~/hooks/useShoutboxBanner'

/**
 * Site-wide important official message banner for the foreground root layout.
 * Never rendered on the admin preview pages so review comparisons stay clean.
 */
export const ShoutboxBanner = () => {
  const pathname = usePathname()
  const { banner, dismiss } = useShoutboxBanner(!isAdminPreviewPath(pathname))

  if (!banner) {
    return null
  }

  return (
    <Alert
      color="primary"
      variant="flat"
      radius="none"
      icon={<Megaphone className="size-4" aria-hidden />}
      isClosable
      closeButtonProps={{ 'aria-label': '关闭公告' }}
      onClose={dismiss}
      description={
        <>
          <span className="whitespace-pre-wrap break-words">
            {banner.content}
          </span>
          {banner.link ? (
            <Link
              href={banner.link}
              className="ml-2 whitespace-nowrap underline underline-offset-4"
            >
              查看详情
            </Link>
          ) : null}
        </>
      }
      className="border-b border-primary-200"
      classNames={{
        base: 'w-full items-center py-1.5',
        mainWrapper: 'min-w-0 flex-1',
        description: 'text-sm',
        closeButton: 'translate-y-0'
      }}
    />
  )
}
