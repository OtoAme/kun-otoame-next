import type { Metadata } from 'next'
import { DashboardStickers } from '~/components/dashboard/sticker/DashboardStickers'

export const metadata: Metadata = { title: '贴纸' }

export default function DashboardStickersPage() {
  return <DashboardStickers />
}
