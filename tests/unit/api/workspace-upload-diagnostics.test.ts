import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  finalize: vi.fn(),
  cleanup: vi.fn(),
  remove: vi.fn(),
  count: vi.fn()
}))
vi.mock('~/lib/s3', () => ({
  cleanupLocalUpload: mocks.cleanup,
  deleteFileFromS3: mocks.remove,
  uploadFileToS3: vi.fn()
}))
vi.mock('~/lib/redis', () => ({
  consumeUpload: vi.fn(),
  finalizeUpload: mocks.finalize,
  releaseUploadConsumeLock: vi.fn()
}))
vi.mock('~/prisma/index', () => ({
  prisma: { patch_resource_link: { count: mocks.count } }
}))
vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: vi.fn(),
  invalidatePatchListCaches: vi.fn()
}))
import {
  cleanupUploadedResourceDirs,
  deletePatchResourceLink,
  finalizeUploadedResources
} from '~/app/api/patch/resource/_helper'
import {
  createWorkspaceDiagnostics,
  workspaceDiagnosticScope
} from '~/app/api/workspace/diagnostics'

const resource = {
  uploadId: 'UPLOAD_ID_CANARY',
  consumeToken: 'TOKEN_CANARY',
  s3Key: 'OBJECT_KEY_CANARY',
  downloadLink: 'https://pan.xunlei.com/s/URL_CANARY?pwd=CODE_CANARY',
  localDir: '/tmp/LOCAL_PATH_CANARY',
  hash: 'HASH_CANARY',
  size: 'SIZE_CANARY'
}
const context = {
  userId: 8,
  patchId: 5,
  resourceId: 7,
  untrusted: 'CONTEXT_CANARY'
}
const failure = () =>
  Object.assign(new Error('ERROR_CANARY'), {
    sql: 'SQL_CANARY',
    params: ['PARAM_CANARY']
  })
const expectSafe = (operation: string) => {
  expect(console.error).toHaveBeenCalledWith(
    '[Resource]',
    expect.objectContaining({ operation, result: 'failed' })
  )
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
    'CANARY'
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.count.mockResolvedValue(0)
  mocks.finalize.mockResolvedValue({ ok: true })
  mocks.cleanup.mockResolvedValue(undefined)
  vi.stubEnv(
    'NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL',
    'http://127.0.0.1:59440/synthetic'
  )
  vi.stubEnv('KUN_VISUAL_NOVEL_IMAGE_BED_URL', 'http://127.0.0.1:59440/images')
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('resource upload diagnostic redaction without changed compensation', () => {
  it.each(['rejection', 'not-finalized'])(
    'keeps finalize %s nonfatal without logging the upload registration or raw error',
    async (mode) => {
      if (mode === 'rejection') mocks.finalize.mockRejectedValue(failure())
      else
        mocks.finalize.mockResolvedValue({
          ok: false,
          code: 'RESULT_CODE_CANARY'
        })
      await expect(
        finalizeUploadedResources([resource], context)
      ).resolves.toBeUndefined()
      expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith(
        resource.uploadId,
        resource.consumeToken
      )
      expectSafe('upload.finalize_failed')
      expect(console.error).toHaveBeenCalledWith(
        '[Resource]',
        expect.objectContaining({
          actorId: 8,
          patchId: 5,
          resourceId: 7,
          itemIndex: 0
        })
      )
    }
  )
  it('keeps local cleanup nonfatal and uses the actual workspace correlation context', async () => {
    mocks.cleanup.mockRejectedValue(failure())
    const scope = createWorkspaceDiagnostics(
      new NextRequest('https://workspace.test/api/workspace/resources/7'),
      true
    )
    scope.actorId = 8
    await workspaceDiagnosticScope.run(scope, () =>
      cleanupUploadedResourceDirs([resource], context)
    )
    expect(mocks.cleanup).toHaveBeenCalledExactlyOnceWith(resource.localDir)
    expectSafe('upload.cleanup_failed')
    expect(console.error).toHaveBeenCalledWith(
      '[Resource]',
      expect.objectContaining({ requestId: scope.requestId, resourceId: 7 })
    )
  })
  it('refuses invalid deletion locations without echoing the location', async () => {
    await deletePatchResourceLink(resource.downloadLink)
    expect(mocks.remove).not.toHaveBeenCalled()
    expectSafe('delete_link.invalid_location')
  })
  it('still protects referenced files and deletes only an actual accepted object key', async () => {
    mocks.count.mockResolvedValueOnce(1)
    await deletePatchResourceLink('http://127.0.0.1:59440/synthetic/key')
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
    await deletePatchResourceLink('http://127.0.0.1:59440/synthetic/key', [2])
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('key')
  })
})
