import { HomeHero } from './hero/HomeHero'
import { HomeContent } from './HomeContent'
import { ShoutboxHomeSection } from '~/components/shoutbox/ShoutboxHomeSection'
import type { HomeResource } from '~/types/api/home'

interface Props {
  galgames: GalgameCard[]
  resources: HomeResource[]
}

export const HomeContainer = (props: Props) => {
  return (
    <div className="mx-auto space-y-8 max-w-7xl">
      <HomeHero />

      <ShoutboxHomeSection />

      <HomeContent {...props} />
    </div>
  )
}
