import { describe, expect, it } from 'vitest'
import { decodePatchSubmissionPayload } from '~/app/api/patch-submission/payloadCodec'

const payload = {
  name: 'Game',
  introduction: 'A complete introduction',
  vndbId: '',
  vndbRelationId: '',
  bangumiId: '',
  steamId: '',
  dlsiteCode: '',
  dlsiteCircleName: '',
  dlsiteCircleLink: '',
  vndbTags: [],
  vndbDevelopers: [],
  bangumiTags: [],
  bangumiDevelopers: [],
  steamTags: [],
  steamDevelopers: [],
  steamAliases: [],
  officialUrl: '',
  alias: [],
  tag: [],
  released: '',
  contentLimit: 'sfw',
  isDuplicate: false
}

describe('patch submission payload codec', () => {
  it('decodes current database JSON and applies compatible defaults', () => {
    const result = decodePatchSubmissionPayload({
      name: 'Draft',
      introduction: ''
    })

    expect(result).toMatchObject({
      success: true,
      data: { name: 'Draft', contentLimit: 'sfw', isDuplicate: false }
    })
  })

  it('rejects damaged database JSON', () => {
    expect(
      decodePatchSubmissionPayload({ introduction: 'missing name' })
    ).toEqual(expect.objectContaining({ success: false }))
  })

  it('can enforce the frozen submission completeness contract', () => {
    expect(
      decodePatchSubmissionPayload(
        { ...payload, introduction: 'short' },
        { complete: true }
      )
    ).toEqual(expect.objectContaining({ success: false }))
    expect(decodePatchSubmissionPayload(payload, { complete: true })).toEqual({
      success: true,
      data: payload
    })
  })
})
