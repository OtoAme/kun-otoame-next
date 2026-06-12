import { Button } from '@heroui/button'
import { ChevronRight } from 'lucide-react'
import { ResourceCard } from '~/components/resource/ResourceCard'
import Link from 'next/link'
import { HomeHero } from './hero/HomeHero'
import { HomeGalgameGrid } from './HomeGalgameGrid'
import type { HomeResource } from '~/types/api/home'

interface Props {
  galgames: GalgameCard[]
  resources: HomeResource[]
}

export const HomeContainer = ({ galgames, resources }: Props) => {
  return (
    <div className="mx-auto space-y-8 max-w-7xl">
      <HomeHero />

      <section className="kun-home-game-section space-y-6">
        <div className="flex items-center space-x-4">
          <h2 className="kun-home-section-title text-lg font-bold sm:text-2xl">
            最新游戏
          </h2>
          <Button
            className="kun-home-section-more-button"
            variant="light"
            as={Link}
            color="primary"
            endContent={<ChevronRight className="size-4" />}
            href="/otomegame"
          >
            查看更多
          </Button>
        </div>
        <HomeGalgameGrid galgames={galgames} />
      </section>

      <section className="space-y-6">
        <div className="flex items-center space-x-4">
          <h2 className="kun-home-section-title text-lg font-bold sm:text-2xl">
            最新补丁
          </h2>
          <Button
            className="kun-home-section-more-button"
            variant="light"
            as={Link}
            color="primary"
            endContent={<ChevronRight className="size-4" />}
            href="/resource"
          >
            查看更多
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:gap-6 md:grid-cols-2">
          {resources.map((resource) => (
            <ResourceCard key={resource.id} resource={resource} />
          ))}
        </div>
      </section>
    </div>
  )
}
