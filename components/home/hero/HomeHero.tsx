import { Button } from '@heroui/button'
import { Tooltip } from '@heroui/tooltip'
import { Card, CardBody } from '@heroui/card'
import { Chip } from '@heroui/chip'
import { Sparkles, Mail } from 'lucide-react'
import { KunCarousel } from '../carousel/KunCarousel'
import { getKunPosts } from '../carousel/mdx'
import { RandomGalgameButton } from '../carousel/RandomGalgameButton'
import { Telegram } from '~/components/kun/icons/Telegram'
import { KunHomeNavigationItems } from '../NavigationItems'
import { kunMoyuMoe } from '~/config/moyu-moe'
import NextLink from 'next/link'

export const HomeHero = () => {
  const posts = getKunPosts()

  return (
    <div className="w-full mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 sm:gap-6 min-h-[300px]">
        <div className="flex-col justify-center hidden space-y-2 sm:flex sm:space-y-6">
          <Card className="kun-home-hero-card h-full border-none bg-gradient-to-br from-primary-500/20 via-secondary-500/20 to-success-500/20">
            <div aria-hidden className="kun-home-hero-flower-slot" />
            <CardBody className="kun-home-hero-content flex justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="kun-home-hero-sparkle w-5 h-5 text-primary-500" />
                <Chip
                  color="primary"
                  variant="flat"
                  classNames={{
                    base: 'kun-home-hero-welcome-chip',
                    content: 'kun-home-hero-welcome-chip-content'
                  }}
                >
                  欢迎来到 OtoAme
                </Chip>
              </div>

              <div className="space-y-4">
                <h1 className="kun-home-hero-title py-1 text-3xl font-bold text-transparent xl:text-4xl bg-gradient-to-r from-primary-500 to-secondary-500 bg-clip-text">
                  一站式乙女游戏文化社区
                </h1>
                <p className="kun-home-hero-subtitle text-md text-default-600">
                  高质量视觉小说分享站 · 永久免费 · 开源
                </p>
              </div>

              <div className="flex items-center gap-2">
                <RandomGalgameButton
                  color="primary"
                  variant="solid"
                  className="kun-home-hero-primary-button"
                >
                  随机一部游戏
                </RandomGalgameButton>
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
              </div>
            </CardBody>
          </Card>

          <div className="grid grid-cols-3 gap-3 sm:gap-6">
            <KunHomeNavigationItems buttonSize="lg" />
          </div>
        </div>

        <KunCarousel posts={posts} />
      </div>
    </div>
  )
}
