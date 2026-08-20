import { MoemoepointRankingContainer } from '~/components/ranking/MoemoepointRankingContainer'
import { getMoemoepointRanking } from '~/app/api/moemoepoint/query'
import type { Metadata } from 'next'

const PAGE_SIZE = 30

export const revalidate = 0

export const metadata: Metadata = {
  title: '萌萌点排行榜',
  description: '按照萌萌点总额从高到低查看 OtoAme 社区用户排行榜'
}

export default async function MoemoepointRankingPage() {
  const initialData = await getMoemoepointRanking({ page: 1, limit: PAGE_SIZE })
  return (
    <MoemoepointRankingContainer
      initialData={initialData}
      pageSize={PAGE_SIZE}
    />
  )
}
