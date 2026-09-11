import { ErrorComponent } from '~/components/error/ErrorComponent'
import { StickerAdmin } from '~/components/admin/stickers/Container'
import { kunGetStickerPacks } from './actions'
import { kunMetadata } from './metadata'
import type { Metadata } from 'next'

export const revalidate = 0

export const metadata: Metadata = kunMetadata

export default async function Kun() {
  const response = await kunGetStickerPacks()
  if (typeof response === 'string') {
    return <ErrorComponent error={response} />
  }

  return <StickerAdmin initialPacks={response.packs} />
}
