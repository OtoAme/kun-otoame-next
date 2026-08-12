import { describe, expect, it } from 'vitest'
import { canManageResource } from '~/components/patch/resource/resourcePermissions'

describe('resource permissions', () => {
  it('allows the resource owner to manage their resource', () => {
    expect(
      canManageResource({ resourceUserId: 7, userId: 7, userRole: 1 })
    ).toBe(true)
  })

  it('allows administrators to manage another user resource', () => {
    expect(
      canManageResource({ resourceUserId: 7, userId: 8, userRole: 3 })
    ).toBe(true)
  })

  it('does not allow guests or other ordinary users to manage it', () => {
    expect(
      canManageResource({ resourceUserId: 7, userId: 0, userRole: 1 })
    ).toBe(false)
    expect(
      canManageResource({ resourceUserId: 7, userId: 8, userRole: 2 })
    ).toBe(false)
  })
})
