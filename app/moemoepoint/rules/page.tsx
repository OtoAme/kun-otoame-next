import { MoemoepointRules } from '~/components/moemoepoint/Rules'
import { kunMetadata } from './metadata'
import type { Metadata } from 'next'

export const metadata: Metadata = kunMetadata

// 纯静态说明页, 不查库, 公开可索引。
export default function MoemoepointRulesPage() {
  return <MoemoepointRules />
}
