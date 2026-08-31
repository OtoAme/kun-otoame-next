import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastMock = vi.hoisted(() => vi.fn())

vi.mock('react-hot-toast', () => ({ default: toastMock }))

import { showEditPostCommitWarnings } from '~/components/edit/utils/showEditPostCommitWarnings'
import { toEditPostCommitWarning } from '~/app/api/edit/postCommit'
import { CompanyEnsureAmbiguityError } from '~/app/api/edit/companyEnsureHelper'

describe('showEditPostCommitWarnings', () => {
  beforeEach(() => {
    toastMock.mockReset()
  })

  it('shows every committed-action warning without using an error toast', () => {
    showEditPostCommitWarnings([
      {
        kind: 'company-ambiguity',
        message: '游戏内容已保存，但部分会社需要管理员维护。'
      },
      {
        kind: 'external-data-error',
        message: '游戏内容已保存，但部分外部数据未能完成处理，请稍后检查。'
      }
    ])

    expect(toastMock).toHaveBeenNthCalledWith(
      1,
      '游戏内容已保存，但部分会社需要管理员维护。',
      { duration: 8000, icon: '⚠️' }
    )
    expect(toastMock).toHaveBeenNthCalledWith(
      2,
      '游戏内容已保存，但部分外部数据未能完成处理，请稍后检查。',
      { duration: 8000, icon: '⚠️' }
    )
  })

  it('does nothing when the committed action has no warnings', () => {
    showEditPostCommitWarnings([])

    expect(toastMock).not.toHaveBeenCalled()
  })
})

describe('toEditPostCommitWarning', () => {
  it('classifies legacy company ensure ambiguity as a company warning', () => {
    const warning = toEditPostCommitWarning(
      new CompanyEnsureAmbiguityError([
        {
          submittedNames: ['Shared Studio'],
          matchedCompanies: [
            { id: 1, name: 'First Studio' },
            { id: 2, name: 'Second Studio' }
          ]
        }
      ])
    )

    expect(warning).toEqual({
      kind: 'company-ambiguity',
      message: '游戏内容已保存，但部分会社需要管理员维护。'
    })
  })
})
