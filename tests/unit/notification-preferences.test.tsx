import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'
import { NOTIFICATION_EVENTS } from '~/constants/notification'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  state: {
    canEdit: true,
    saving: false,
    status: 'ready',
    error: null,
    conflicts: [],
    drafts: { 'notification:like': { value: false } },
    snapshot: { items: { 'email-notice': { value: false } } }
  }
}))
vi.mock('~/hooks/useAccountPreferences', () => ({
  useAccountPreferences: () => mocks.state
}))
vi.mock('~/utils/preferenceClient', () => ({
  savePreferenceDrafts: mocks.save,
  editPreference: vi.fn(),
  discardPreferenceDrafts: vi.fn(),
  confirmPreferenceConflicts: vi.fn(),
  refreshPreferences: vi.fn()
}))
vi.mock('@heroui/card', () => ({
  Card: ({ children }: any) => <section>{children}</section>,
  CardBody: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <header>{children}</header>,
  CardFooter: ({ children }: any) => <footer>{children}</footer>
}))
vi.mock('@heroui/react', () => ({
  Switch: (props: { 'aria-label'?: string }) => (
    <input type="checkbox" aria-label={props['aria-label']} />
  )
}))
vi.mock('@heroui/button', () => ({
  Button: ({ children, onPress }: any) => (
    <button onClick={onPress}>{children}</button>
  )
}))

afterEach(() => vi.unstubAllGlobals())
it('lists only configurable subscriptions and saves them independently of email preferences', async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://example.test/settings/user'
  })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const { NotificationPreferences } = await import(
    '~/components/settings/user/NotificationPreferences'
  )
  const { EmailNotice } = await import('~/components/settings/user/EmailNotice')
  const root = createRoot(document.getElementById('root')!)
  try {
    await act(async () =>
      root.render(
        <>
          <NotificationPreferences />
          <EmailNotice />
        </>
      )
    )
    const sections = document.querySelectorAll('section')
    const groups = [...sections[0].querySelectorAll('fieldset')]
    expect(groups.every((group) => group.querySelector('input'))).toBe(true)
    for (const event of Object.values(NOTIFICATION_EVENTS)) {
      if (event.optional) {
        expect(
          sections[0].querySelector(`input[aria-label="${event.label}"]`)
        ).not.toBeNull()
      } else {
        expect(sections[0].textContent).not.toContain(event.label)
      }
    }
    expect(sections[1].querySelector('button')).toBeNull()
    await act(async () => sections[0].querySelector('button')!.click())
    expect(mocks.save).toHaveBeenCalledOnce()
    const keys = mocks.save.mock.calls[0][0]
    expect(keys).toContain('notification:like')
    expect(keys.every((key: string) => key.startsWith('notification:'))).toBe(
      true
    )
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
  }
})
