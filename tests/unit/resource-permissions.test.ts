import { describe, expect, it } from 'vitest'
import {
  canManageResource,
  canManageResourceLink,
  canCheckResourceLink
} from '~/components/patch/resource/resourcePermissions'

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

  it('reserves ordinary-link verification to its publisher while staff can inspect it', () => {
    const staff = { storage: 'user', resourceUserId: 7, userId: 8, userRole: 3 }
    expect(canManageResourceLink(staff)).toBe(false)
    expect(canCheckResourceLink(staff)).toBe(true)
    expect(canManageResourceLink({ ...staff, userId: 7, userRole: 1 })).toBe(
      true
    )
  })

  it('reserves resource-disk actions to staff even when the publisher owns the resource', () => {
    const publisher = {
      storage: 'touchgal',
      resourceUserId: 7,
      userId: 7,
      userRole: 2
    }
    expect(canManageResourceLink(publisher)).toBe(false)
    expect(canCheckResourceLink(publisher)).toBe(false)
    expect(canManageResourceLink({ ...publisher, userRole: 3 })).toBe(true)
    expect(canCheckResourceLink({ ...publisher, userId: 0, userRole: 3 })).toBe(
      false
    )
  })
})
