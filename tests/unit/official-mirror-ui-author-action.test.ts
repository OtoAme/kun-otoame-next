import { describe, expect, it } from 'vitest'
import {
  authorResourceLocked,
  closedAuthorConfirm,
  confirmedExitAction,
  interpretPatchAuthorResponse,
  interpretWorkspaceAuthorResponse,
  patchAuthorRequest,
  reduceAuthorConfirm,
  workspaceAuthorRequest
} from '~/components/patch/resource/authorResourceAction'

const balance = { total: 8, reserved: 1, available: 7 }

describe('author resource exit contract', () => {
  it('sends handover and delete only as DELETE query actions', () => {
    expect(patchAuthorRequest(12, 'handover')).toEqual({
      method: 'DELETE',
      url: '/patch/resource',
      query: { resourceId: 12, action: 'handover' }
    })
    expect(patchAuthorRequest(12, 'delete')).toEqual({
      method: 'DELETE',
      url: '/patch/resource',
      query: { resourceId: 12, action: 'delete' }
    })
    expect(workspaceAuthorRequest(12, 'handover')).toEqual({
      method: 'DELETE',
      url: '/workspace/resources/12',
      query: { action: 'handover' }
    })
    expect(JSON.stringify(patchAuthorRequest(12, 'handover'))).not.toContain(
      'handed_over'
    )
    expect(JSON.stringify(workspaceAuthorRequest(12, 'delete'))).not.toContain(
      'body'
    )
  })

  it('reads patch success from action and ignores deleted:true as handover', () => {
    expect(
      interpretPatchAuthorResponse('handover', {
        action: 'handed_over',
        balanceUserId: 4,
        moemoepointBalance: balance,
        deleted: true
      })
    ).toEqual({
      ok: true,
      action: 'handed_over',
      balanceUserId: 4,
      moemoepointBalance: balance
    })
    expect(
      interpretPatchAuthorResponse('handover', {
        deleted: true,
        balanceUserId: 4,
        moemoepointBalance: balance
      }).ok
    ).toBe(false)
    expect(
      interpretPatchAuthorResponse('delete', {
        action: 'deleted',
        balanceUserId: 4,
        moemoepointBalance: balance
      }).ok
    ).toBe(true)
    expect(
      interpretPatchAuthorResponse('delete', '您没有权限操作该链接')
    ).toEqual({ ok: false, message: '您没有权限操作该链接' })
  })

  it('keeps workspace handover distinct from deletion', () => {
    expect(
      interpretWorkspaceAuthorResponse('handover', {
        deleted: false,
        handedOver: true,
        moemoepointBalance: balance
      })
    ).toMatchObject({ ok: true, action: 'handed_over' })
    expect(
      interpretWorkspaceAuthorResponse('handover', {
        deleted: true,
        handedOver: false
      }).ok
    ).toBe(false)
    expect(
      interpretWorkspaceAuthorResponse('delete', {
        deleted: true,
        handedOver: false
      })
    ).toMatchObject({ ok: true, action: 'deleted' })
    expect(
      interpretWorkspaceAuthorResponse('delete', {
        deleted: true,
        handedOver: true
      }).ok
    ).toBe(false)
  })

  it('does not write when confirmation is cancelled or the live action changed', () => {
    const opened = reduceAuthorConfirm(closedAuthorConfirm(), {
      type: 'open',
      action: 'handover'
    })
    expect(opened.write).toBeNull()
    expect(
      reduceAuthorConfirm(opened.state, { type: 'cancel' }).write
    ).toBeNull()
    const pending = reduceAuthorConfirm(opened.state, { type: 'confirm', live: 'handover' })
    expect(pending.write).toBe('handover')
    expect(
      reduceAuthorConfirm(pending.state, { type: 'cancel' }).write
    ).toBeNull()
    expect(
      reduceAuthorConfirm(opened.state, { type: 'confirm', live: 'delete' }).write
    ).toBeNull()
  })

  it('locks a handed-over author and keeps admin delete explicit', () => {
    const author = {
      userId: 4,
      userRole: 2,
      resourceUserId: 4,
      hasStaffBackup: true,
      staffMaintained: true
    }
    expect(authorResourceLocked(author)).toBe(true)
    expect(confirmedExitAction(author)).toBeNull()
    expect(
      confirmedExitAction({ ...author, staffMaintained: false })
    ).toBe('handover')
    expect(
      confirmedExitAction({
        userId: 9,
        userRole: 3,
        resourceUserId: 4,
        hasStaffBackup: true,
        staffMaintained: false
      })
    ).toBe('delete')
  })
})
