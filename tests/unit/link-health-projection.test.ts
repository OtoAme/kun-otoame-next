import { beforeEach, describe, expect, it, vi } from 'vitest'
const raw = vi.hoisted(() => vi.fn())
vi.mock('~/prisma/index', () => ({ prisma: { $queryRaw: raw } }))
import {
  getLinkCheckInputSignature,
  getLinkDisputeSources,
  projectLinkHealth,
  type HealthLinkRow
} from '~/app/api/patch/resource/linkHealthProjection'
import { linkHealthTransitionRecordSchema } from '~/validations/linkHealth'

const now = new Date('2026-10-09T12:00:00Z')
const row = (): HealthLinkRow => ({
  id: 3,
  storage: 'user',
  content: 'https://pan.quark.cn/s/SyntheticShare',
  code: 'code-a',
  password: 'secret',
  size: '1 GB',
  hash: '',
  sort_order: 0,
  download: 0,
  version: 2,
  evidence_round: 4,
  health: 'suspect',
  health_changed_at: new Date('2026-10-09T10:00:00Z'),
  verified_at: null,
  content_changed_at: null,
  reports: [
    { user_id: 7, link_version: 2 },
    { user_id: 7, link_version: 2 },
    { user_id: 8, link_version: 2 },
    { user_id: 9, link_version: 1 }
  ],
  check: null
})
const withCheck = (): HealthLinkRow => {
  const link = row()
  link.check = {
    link_id: 3,
    patch_id: 1,
    resource_id: 2,
    link_version: 2,
    evidence_round: 3,
    health: 'ok',
    health_changed_at: null,
    request_id: '123e4567-e89b-42d3-a456-426614174000',
    input_signature: getLinkCheckInputSignature(link, 'quark'),
    requested_at: new Date('2026-10-09T10:59:59Z'),
    completed_at: new Date('2026-10-09T11:00:01Z'),
    checked_at: new Date('2026-10-09T11:00:00Z'),
    verdict: 'available',
    provider: 'quark',
    reason: 'share_available',
    cached: false,
    failed: false
  }
  return link
}
beforeEach(() => raw.mockReset())

describe('safe current-input link health projection', () => {
  it('returns only the safe current-version maintenance restriction with its own revision', () => {
    const link = { ...row(), maintenance_controls: [
      { link_version: 1, revision: 99, frozen: true, events: [] },
      { link_version: 2, revision: 4, frozen: false, events: [{ state:'snoozed',snoozed_until:new Date(now.getTime()+1) }] }
    ] }
    expect(projectLinkHealth(link,7,undefined,null,now).maintenance).toEqual({revision:4,restriction:'snoozed',resumesAt:new Date(now.getTime()+1).toISOString()})
    expect(projectLinkHealth(link,7,undefined,null,new Date(now.getTime()+1)).maintenance).toEqual({revision:4,restriction:null,resumesAt:null})
    expect(projectLinkHealth(row(),7,undefined,null,now).maintenance).toEqual({revision:0,restriction:null,resumesAt:null})
  })
  it.each([
    'https://pan.otoame.top/s/SYN',
    'https://fixture.s3.example.test/SYN.zip',
    'https://1drv.ms/f/SYN',
    'https://example.test/s/SYN',
    'https://pan.quark.cn.evil.test/s/SYN',
    'https://pan.quark.cn/'
  ])('never derives support from ownership or an old quark observation for %s', (content) => {
    const link = { ...withCheck(), content }
    for (const storage of ['user', 'touchgal']) {
      link.storage = storage
      for (const viewer of [{ uid: 88, role: 1 }, { uid: 7, role: 2 }, { uid: 88, role: 3 }]) {
        const projected = projectLinkHealth(link, 7, viewer, null, now)
        expect(projected.capabilities.canCheck).toBe(false)
        expect(projected.capabilities.canEdit).toBe(viewer.uid === 7 || viewer.role >= 3)
        for (const secret of [content, link.code, link.password])
          expect(JSON.stringify(projected)).not.toContain(secret)
      }
    }
  })

  it.each([
    ['user', 1], ['user', 2], ['touchgal', 1], ['touchgal', 2]
  ] as const)('offers role %s/%s inspection without ownership or arbitration capabilities', (storage, role) => {
    for (const health of ['suspect', 'disputed']) {
      const link = { ...row(), storage, health }
      const projected = projectLinkHealth(link, 7, { uid: 88, role }, null, now)
      expect(projected.capabilities).toEqual({
        canCheck: true, canEdit: false, ownerActions: [], resolveActions: []
      })
      for (const secret of [link.content, link.code, link.password])
        expect(JSON.stringify(projected)).not.toContain(secret)
    }
  })

  it('keeps feedback distinct across rounds and capability ownership distinct from staff inspection', () => {
    const link = row()
    expect(projectLinkHealth(link, 7, undefined, null, now)).toMatchObject({
      recentReportCount: 2,
      capabilities: {
        ownerActions: [],
        resolveActions: [],
        canCheck: false,
        canEdit: false
      }
    })
    expect(
      projectLinkHealth(link, 7, { uid: 7, role: 1 }, null, now).capabilities
        .ownerActions
    ).toEqual(['verify', 'confirm_broken'])
    expect(
      projectLinkHealth(link, 7, { uid: 8, role: 3 }, null, now).capabilities
    ).toEqual({
      ownerActions: [],
      resolveActions: [],
      canCheck: true,
      canEdit: true
    })
    const text = JSON.stringify(
      projectLinkHealth(link, 7, { uid: 7, role: 1 }, null, now)
    )
    for (const secret of [link.content, link.code, link.password])
      expect(text).not.toContain(secret)
  })

  it('shows an observation across its own round transition but marks the exact one-hour boundary stale', () => {
    const summary = projectLinkHealth(withCheck(), 7, undefined, null, now)
    expect(summary.latestCheck).toMatchObject({
      verdict: 'available',
      checkedAt: '2026-10-09T11:00:00.000Z',
      stale: true
    })
    expect(summary.latestCheck).not.toHaveProperty('inputSignature')
    expect(summary.latestCheck).not.toHaveProperty('requestId')
  })

  it('hides obsolete-address, changed-passcode and malformed persisted observations', () => {
    const link = withCheck()
    expect(
      projectLinkHealth({ ...link, version: 3 }, 7, undefined, null, now)
        .latestCheck
    ).toBeNull()
    expect(
      projectLinkHealth({ ...link, code: 'code-b' }, 7, undefined, null, now)
        .latestCheck
    ).toBeNull()
    link.check!.checked_at = new Date('2026-10-10T00:00:00Z')
    expect(
      projectLinkHealth(link, 7, undefined, null, now).latestCheck
    ).toBeNull()
    link.check!.cached = true
    expect(
      projectLinkHealth(link, 7, undefined, null, now).latestCheck
    ).toBeNull()
  })

  it('keeps failed attempts distinct and does not invent an observation time', () => {
    const link = withCheck()
    link.content = 'https://example.test/unsupported'
    Object.assign(link.check!, {
      verdict: 'unknown',
      provider: null,
      reason: 'unavailable',
      failed: true,
      checked_at: null,
      input_signature: getLinkCheckInputSignature(link, null)
    })
    expect(
      projectLinkHealth(link, 7, undefined, null, now).latestCheck
    ).toMatchObject({
      verdict: 'unknown',
      checkedAt: null,
      failed: true,
      attemptedAt: '2026-10-09T10:59:59.000Z'
    })
  })

  it('takes only the latest present durable conflict context and never falls back from a corrupt context', async () => {
    const link = { ...row(), health: 'disputed', resourceId: 2, patchId: 1 }
    raw.mockResolvedValue([
      {
        target_id: 3,
        context: {
          patchId: 1,
          resourceId: 2,
          linkId: 3,
          linkVersion: 2,
          evidenceRound: 4,
          health: 'disputed',
          healthChangedAt: '2026-10-09T10:00:00.000Z',
          source: 'owner_verification'
        }
      }
    ])
    expect((await getLinkDisputeSources([link])).get(3)).toBe(
      'owner_verification'
    )
    raw.mockResolvedValue([{ target_id: 3, context: null }])
    expect((await getLinkDisputeSources([link])).size).toBe(0)
  })

  it('validates actual transition rounds instead of accepting arbitrary audit JSON', () => {
    const from = {
      patchId: 1,
      resourceId: 2,
      linkId: 3,
      linkVersion: 2,
      evidenceRound: 4,
      health: 'suspect',
      healthChangedAt: '2026-10-09T10:00:00Z'
    }
    const transition = {
      from,
      to: {
        evidenceRound: 5,
        health: 'broken',
        healthChangedAt: '2026-10-09T12:00:00Z'
      },
      cause: 'confirmed_broken',
      machine: null
    }
    expect(linkHealthTransitionRecordSchema.safeParse(transition).success).toBe(
      true
    )
    expect(
      linkHealthTransitionRecordSchema.safeParse({
        ...transition,
        to: { ...transition.to, evidenceRound: 4 }
      }).success
    ).toBe(false)
  })
})
