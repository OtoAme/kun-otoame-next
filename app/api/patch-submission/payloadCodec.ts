import {
  patchSubmissionDraftPayloadSchema,
  patchSubmissionPayloadSchema
} from '~/validations/patchSubmission'
import type { PatchSubmissionPayload } from '~/types/api/patchSubmission'

export type PatchSubmissionPayloadDecodeResult =
  | { success: true; data: PatchSubmissionPayload }
  | { success: false; message: string }

/** Database JSON is untrusted at every read boundary, including review. */
export const decodePatchSubmissionPayload = (
  value: unknown,
  options: { complete?: boolean } = {}
): PatchSubmissionPayloadDecodeResult => {
  const schema = options.complete
    ? patchSubmissionPayloadSchema
    : patchSubmissionDraftPayloadSchema
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    return {
      success: false,
      message:
        parsed.error.errors[0]?.message ??
        (options.complete ? '投稿内容不完整' : '投稿内容已损坏')
    }
  }
  return { success: true, data: parsed.data }
}
