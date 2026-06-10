import { $remark } from '@milkdown/utils'
import breaks from 'remark-breaks'

export const remarkHardBreaks = $remark('remarkHardBreaks', () => breaks)
