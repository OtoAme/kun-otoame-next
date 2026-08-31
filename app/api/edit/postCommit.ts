import { CompanyResolutionAmbiguityError } from '~/app/api/company/identity/resolver'
import { CompanyEnsureAmbiguityError } from './companyEnsureHelper'
import type { EditPostCommitWarning } from '~/types/api/edit'

const COMPANY_AMBIGUITY_MESSAGE = '游戏内容已保存，但部分会社需要管理员维护。'
const EXTERNAL_DATA_ERROR_MESSAGE =
  '游戏内容已保存，但部分外部数据未能完成处理，请稍后检查。'

export const toEditPostCommitWarning = (
  error: unknown
): EditPostCommitWarning =>
  error instanceof CompanyResolutionAmbiguityError ||
  error instanceof CompanyEnsureAmbiguityError
    ? {
        kind: 'company-ambiguity',
        message: COMPANY_AMBIGUITY_MESSAGE
      }
    : {
        kind: 'external-data-error',
        message: EXTERNAL_DATA_ERROR_MESSAGE
      }

export const runEditPostCommitTask = async (
  task: () => Promise<unknown>,
  context: { action: string; patchId: number; uniqueId: string }
) => {
  try {
    await task()
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Failed to ${context.action} after saving a patch`, {
      patchId: context.patchId,
      uniqueId: context.uniqueId,
      error
    })
  }
}
