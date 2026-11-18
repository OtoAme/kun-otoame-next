import { MessageContainer } from '~/components/message/Container'
import { kunMetadata } from './metadata'
import type { Metadata } from 'next'

export const revalidate = 0
export const metadata: Metadata = kunMetadata

export default function Kun() {
  return <MessageContainer type="mention" />
}
