import { Chip } from '@heroui/chip'
import { HELP_STATUS_LABELS, type HelpStatus } from '~/constants/help'

export const HelpStatusChip = ({ status }: { status: HelpStatus }) => (
  <Chip
    size="sm"
    variant="flat"
    color={status === 'solved' ? 'success' : 'warning'}
  >
    {HELP_STATUS_LABELS[status]}
  </Chip>
)
