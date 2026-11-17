import { HomeHero } from './hero/HomeHero'
import { HomePersonalizedContent } from './HomePersonalizedContent'
import { ShoutboxHomeSection } from '~/components/shoutbox/ShoutboxHomeSection'
import type { HomeResource } from '~/types/api/home'

interface Props {
  galgames: GalgameCard[]
  resources: HomeResource[]
}

export const HomeContainer = (_props: Props) => {
  return (
    <div className="mx-auto space-y-8 max-w-7xl">
      <HomeHero />

      <ShoutboxHomeSection />

      <HomePersonalizedContent />
    </div>
  )
}
