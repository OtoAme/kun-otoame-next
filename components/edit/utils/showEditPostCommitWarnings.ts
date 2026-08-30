import toast from 'react-hot-toast'
import type { EditPostCommitWarning } from '~/types/api/edit'

export const showEditPostCommitWarnings = (
  warnings: EditPostCommitWarning[]
) => {
  for (const warning of warnings) {
    toast(warning.message, { duration: 8000, icon: '⚠️' })
  }
}
