import { Prisma } from '@prisma/client'
import { beforeEach, expect, it, vi } from 'vitest'
const mocked = vi.hoisted(() => ({ transaction: vi.fn(), wait: vi.fn() }))
vi.mock('~/prisma/index', () => ({
  prisma: { $transaction: mocked.transaction }
}))
vi.mock('node:timers/promises', () => ({ setTimeout: mocked.wait }))
import { runResourceMutation } from '~/app/api/patch/resource/mutation'
const error = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('synthetic raw query conflict', {
    code: 'P2010',
    clientVersion: '7.8.0',
    meta: {
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: { originalCode: code, kind: 'postgres' }
      }
    }
  })
beforeEach(() => vi.resetAllMocks())
it.each(['40P01', '40001'])(
  'restarts only a fully rolled-back transaction for canonical nested SQLSTATE %s',
  async (code) => {
    const work = vi.fn(async () => ({ committed: true }))
    mocked.transaction
      .mockRejectedValueOnce(error(code))
      .mockImplementationOnce((work) => work({}))
    expect(await runResourceMutation(work)).toEqual({ committed: true })
    expect(mocked.transaction).toHaveBeenCalledTimes(2)
    expect(mocked.wait).toHaveBeenCalledExactlyOnceWith(50)
  }
)
it('does not retry arbitrary P2010 or keep retrying beyond the existing bound', async () => {
  const syntax = error('42601')
  mocked.transaction.mockRejectedValue(syntax)
  await expect(runResourceMutation(vi.fn())).rejects.toBe(syntax)
  expect(mocked.transaction).toHaveBeenCalledOnce()
  expect(mocked.wait).not.toHaveBeenCalled()
  mocked.transaction.mockReset()
  mocked.transaction.mockRejectedValue(error('40P01'))
  await expect(runResourceMutation(vi.fn())).rejects.toMatchObject({
    status: 503
  })
  expect(mocked.transaction).toHaveBeenCalledTimes(3)
  expect(mocked.wait.mock.calls).toEqual([[50], [100]])
})
