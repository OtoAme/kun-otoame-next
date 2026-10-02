'use client'

import { Button } from '@heroui/button'
import { Tooltip } from '@heroui/tooltip'
import { Mail } from 'lucide-react'
import NextLink from 'next/link'
import { Telegram } from '~/components/kun/icons/Telegram'
import { kunMoyuMoe } from '~/config/moyu-moe'

export const HeroContactButtons = () => {
  return (
    <>
      <Tooltip showArrow content="Telegram 频道">
        <Button
          isIconOnly
          as={NextLink}
          href={kunMoyuMoe.domain.telegram_group}
          variant="flat"
          color="secondary"
          className="kun-home-hero-icon-button"
        >
          <Telegram />
        </Button>
      </Tooltip>
      <Tooltip showArrow content="联系我们">
        <Button
          isIconOnly
          as={NextLink}
          href="mailto:contact@otoame.com"
          variant="flat"
          color="secondary"
          className="kun-home-hero-icon-button"
        >
          <Mail className="w-5 h-5" />
        </Button>
      </Tooltip>
    </>
  )
}
