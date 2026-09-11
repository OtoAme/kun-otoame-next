import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminUser } from '~/types/api/admin'
import { adminUpdateUserSchema } from '~/validations/admin'

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  post: vi.fn(),
  onUpdated: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchPut: mocks.put,
  kunFetchPost: mocks.post
}))

vi.mock('~/components/dashboard/ui/input', () => ({
  Input: ({ onChange, ...props }: React.ComponentProps<'input'>) => (
    <input
      {...props}
      onInput={(event) =>
        onChange?.(event as React.ChangeEvent<HTMLInputElement>)
      }
    />
  )
}))

vi.mock('~/components/dashboard/ui/textarea', () => ({
  Textarea: ({ onChange, ...props }: React.ComponentProps<'textarea'>) => (
    <textarea
      {...props}
      onInput={(event) =>
        onChange?.(event as React.ChangeEvent<HTMLTextAreaElement>)
      }
    />
  )
}))

// Exercise the dialog's controlled state without testing Radix portals/focus.
vi.mock('~/components/dashboard/ui/dialog', async () => {
  const ReactModule = await import('react')
  const Context = ReactModule.createContext({
    open: false,
    onOpenChange: (_open: boolean) => {}
  })
  const Block = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    Dialog: ({
      open,
      onOpenChange,
      children
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
      children?: React.ReactNode
    }) => (
      <Context.Provider value={{ open, onOpenChange }}>
        {children}
      </Context.Provider>
    ),
    DialogTrigger: ({ children }: { children: React.ReactElement }) => {
      const { onOpenChange } = ReactModule.useContext(Context)
      return ReactModule.cloneElement(
        children as React.ReactElement<React.ComponentProps<'button'>>,
        { onClick: () => onOpenChange(true) }
      )
    },
    DialogContent: ({
      children,
      onEscapeKeyDown,
      showCloseButton = true
    }: {
      children?: React.ReactNode
      onEscapeKeyDown?: (event: React.KeyboardEvent) => void
      showCloseButton?: boolean
    }) => {
      const { open, onOpenChange } = ReactModule.useContext(Context)
      if (!open) return null
      return (
        <div
          role="dialog"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            onEscapeKeyDown?.(event)
            if (!event.defaultPrevented) onOpenChange(false)
          }}
        >
          {children}
          {showCloseButton ? (
            <button onClick={() => onOpenChange(false)}>关闭弹窗</button>
          ) : null}
        </div>
      )
    },
    DialogHeader: Block,
    DialogTitle: Block,
    DialogDescription: Block,
    DialogFooter: Block
  }
})

// Keep option values, disabled state and label associations as native controls.
vi.mock('~/components/dashboard/ui/select', async () => {
  const ReactModule = await import('react')
  const SelectTrigger = (_props: { id?: string }) => null
  const SelectContent = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  )
  return {
    Select: ({
      value,
      onValueChange,
      disabled,
      children
    }: {
      value: string
      onValueChange: (value: string) => void
      disabled?: boolean
      children?: React.ReactNode
    }) => {
      const elements = ReactModule.Children.toArray(children).filter(
        ReactModule.isValidElement
      ) as React.ReactElement<{ id?: string; children?: React.ReactNode }>[]
      const trigger = elements.find((element) => element.type === SelectTrigger)
      const content = elements.find((element) => element.type === SelectContent)
      return (
        <select
          id={trigger?.props.id}
          value={value}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {content?.props.children}
        </select>
      )
    },
    SelectTrigger,
    SelectContent,
    SelectItem: (props: React.ComponentProps<'option'>) => (
      <option {...props} />
    ),
    SelectValue: () => null
  }
})

import { UserEditDialog } from '~/components/dashboard/user/UserEditDialog'

const user = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: 17,
  name: '原用户名',
  email: 'original@example.com',
  enable2FA: true,
  bio: '原简介',
  avatar: '',
  role: 2,
  status: 0,
  dailyImageCount: 7,
  created: '2026-09-01T00:00:00.000Z',
  _count: { patch: 2, patch_resource: 3 },
  ...overrides
})

type PendingWrite = {
  method: 'PUT' | 'POST'
  path: string
  body: Record<string, unknown>
  resolve: (value: Record<string, unknown> | string) => void
  reject: (error: Error) => void
}

describe('dashboard user edit dialog', () => {
  let dom: JSDOM
  let root: Root
  let writes: PendingWrite[]

  beforeEach(() => {
    vi.resetAllMocks()
    writes = []
    for (const [method, mock] of [
      ['PUT', mocks.put],
      ['POST', mocks.post]
    ] as const) {
      mock.mockImplementation(
        (path: string, body: Record<string, unknown>) =>
          new Promise((resolve, reject) => {
            writes.push({ method, path, body, resolve, reject })
          })
      )
    }
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'https://example.com/dashboard/user'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const render = async (target = user()) => {
    await act(async () => {
      root.render(<UserEditDialog user={target} onUpdated={mocks.onUpdated} />)
    })
  }
  const button = (label: string) => {
    const result = [...dom.window.document.querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === label
    )
    expect(result, `button ${label}`).toBeDefined()
    return result!
  }
  const click = async (label: string) => {
    await act(async () => button(label).click())
  }
  const mount = async (target = user()) => {
    await render(target)
    await click('编辑')
  }
  const field = (label: string) => {
    const element = [...dom.window.document.querySelectorAll('label')].find(
      (entry) => entry.textContent?.trim() === label
    )
    expect(element, `field ${label}`).toBeDefined()
    return dom.window.document.getElementById(element!.htmlFor)! as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
  }
  const fill = async (label: string, value: string) => {
    const element = field(label)
    await act(async () => {
      element.value = value
      element.dispatchEvent(
        new dom.window.Event(
          element.tagName === 'SELECT' ? 'change' : 'input',
          {
            bubbles: true
          }
        )
      )
    })
  }
  const form = () => dom.window.document.querySelector('form')!
  const submit = async () => {
    await act(async () => {
      form().dispatchEvent(
        new dom.window.Event('submit', { bubbles: true, cancelable: true })
      )
    })
  }
  const settle = async (value: Record<string, unknown> | string, index = 0) => {
    await act(async () => writes[index].resolve(value))
  }
  const dialog = () => dom.window.document.querySelector('[role="dialog"]')
  const alert = () => dom.window.document.querySelector('[role="alert"]')
  const escape = async () => {
    await act(async () => {
      dialog()!.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true
        })
      )
    })
  }
  const fillDraft = async () => {
    await fill('用户名', 'Alice Smith.')
    await fill('邮箱', 'edited@example.com')
    await fill('角色', '3')
    await fill('状态', '2')
    await fill('今日已用图片次数', '12')
    await fill('新密码', 'Secret123')
    await fill('简介', '尚未保存的简介')
  }
  const expectDraft = () => {
    expect(field('用户名').value).toBe('Alice Smith.')
    expect(field('邮箱').value).toBe('edited@example.com')
    expect(field('角色').value).toBe('3')
    expect(field('状态').value).toBe('2')
    expect(field('今日已用图片次数').value).toBe('12')
    expect(field('新密码').value).toBe('Secret123')
    expect(field('简介').value).toBe('尚未保存的简介')
  }

  it('saves a full admin-schema payload including email and a trimmed name rejected by registration rules', async () => {
    await mount()
    expect((field('用户 ID') as HTMLInputElement).readOnly).toBe(true)
    expect(field('用户 ID').disabled).toBe(true)
    await fill('用户名', '  Alice Smith.  ')
    await fill('邮箱', '  edited@example.com  ')
    await fill('简介', '  新简介  ')
    await fill('角色', '3')
    await fill('状态', '2')
    await submit()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      method: 'PUT',
      path: '/admin/user',
      body: {
        uid: 17,
        name: 'Alice Smith.',
        email: 'edited@example.com',
        role: 3,
        status: 2,
        dailyImageCount: 7,
        bio: '新简介'
      }
    })
    expect(adminUpdateUserSchema.parse(writes[0].body)).toEqual(writes[0].body)
    expect(writes[0].body).not.toHaveProperty('password')
    await settle({})
    expect(dialog()).toBeNull()
    expect(mocks.onUpdated).toHaveBeenCalledExactlyOnceWith(17)
  })

  it.each(['', '   '])(
    'omits an optional password of %j from the update',
    async (password) => {
      await mount()
      await fill('新密码', password)
      await submit()
      expect(writes[0].body).not.toHaveProperty('password')
      expect(adminUpdateUserSchema.safeParse(writes[0].body).success).toBe(true)
    }
  )

  it('trims and sends a valid replacement password', async () => {
    await mount()
    await fill('新密码', '  Secret123  ')
    await submit()
    expect(writes[0].body.password).toBe('Secret123')
  })

  it.each([' ', '名'.repeat(18)])(
    'rejects an invalid trimmed name %j without sending a write',
    async (name) => {
      await mount()
      await fill('用户名', name)
      await submit()
      expect(writes).toHaveLength(0)
      expect(alert()?.textContent).toMatch(/用户名.*1.*17/)
      expect(field('用户名').value).toBe(name)
    }
  )

  it('accepts the 17-character admin name boundary', async () => {
    await mount()
    await fill('用户名', '名'.repeat(17))
    await submit()
    expect(writes[0].body.name).toBe('名'.repeat(17))
  })

  it.each(['', 'invalid-email'])(
    'rejects missing or invalid email %j and keeps the form',
    async (email) => {
      await mount()
      await fill('邮箱', email)
      await submit()
      expect(writes).toHaveLength(0)
      expect(alert()?.textContent).toMatch(/邮箱/)
      expect(dialog()).not.toBeNull()
    }
  )

  it('retains an existing super-admin role when saving unrelated fields', async () => {
    await mount(user({ role: 4 }))
    expect(field('角色').value).toBe('4')
    expect(
      (field('角色') as HTMLSelectElement).querySelector('option[value="4"]')
    ).not.toBeNull()
    await fill('简介', '更新简介')
    await submit()
    expect(writes[0].body.role).toBe(4)
  })

  it.each([1, 2, 3])(
    'does not offer promotion from role %i to super-admin',
    async (role) => {
      await mount(user({ role }))
      const options = [...(field('角色') as HTMLSelectElement).options]
      expect(options.map((option) => option.value)).toEqual(['1', '2', '3'])
      await submit()
      expect(writes[0].body.role).toBe(role)
    }
  )

  it('disables the legacy restricted status while preserving an existing status 1', async () => {
    await mount(user({ status: 1 }))
    const status = field('状态') as HTMLSelectElement
    expect(status.value).toBe('1')
    expect(
      status.querySelector<HTMLOptionElement>('option[value="1"]')?.disabled
    ).toBe(true)
    await submit()
    expect(writes[0].body.status).toBe(1)
  })

  it.each(['', '-1', '51', '1.5'])(
    'rejects daily image count %j without converting it to a different valid count',
    async (count) => {
      await mount()
      await fill('今日已用图片次数', count)
      await submit()
      expect(writes).toHaveLength(0)
      expect(alert()?.textContent).toMatch(/今日已用图片次数/)
      expect(field('今日已用图片次数').value).toBe(count)
    }
  )

  it.each([0, 50])(
    'accepts daily used count boundary %i as a number',
    async (count) => {
      await mount()
      await fill('今日已用图片次数', String(count))
      await submit()
      expect(writes[0].body.dailyImageCount).toBe(count)
    }
  )

  it.each(['abc123'.slice(0, 5), 'lettersOnly', '123456'])(
    'rejects invalid optional password %j without losing it',
    async (password) => {
      await mount()
      await fill('新密码', password)
      await submit()
      expect(writes).toHaveLength(0)
      expect(alert()?.textContent).toMatch(/密码/)
      expect(field('新密码').value).toBe(password)
    }
  )

  it('rejects a bio beyond the admin schema length', async () => {
    await mount()
    await fill('简介', '字'.repeat(108))
    await submit()
    expect(writes).toHaveLength(0)
    expect(alert()?.textContent).toMatch(/简介.*107/)
  })

  it('serializes save against duplicate submits and 2FA disable before rerender', async () => {
    await mount()
    const pendingForm = form()
    const disable2FA = button('关闭两步验证')
    await act(async () => {
      for (let index = 0; index < 2; index += 1) {
        pendingForm.dispatchEvent(
          new dom.window.Event('submit', { bubbles: true, cancelable: true })
        )
      }
      disable2FA.click()
    })
    expect(writes).toHaveLength(1)
    expect(writes[0].method).toBe('PUT')
    expect(button('关闭两步验证').disabled).toBe(true)
    expect(button('取消').disabled).toBe(true)
    expect(field('用户名').disabled).toBe(true)
    await escape()
    expect(dialog()).not.toBeNull()
    await settle({})
    expect(dialog()).toBeNull()
    expect(mocks.onUpdated).toHaveBeenCalledExactlyOnceWith(17)
  })

  it('directly disables 2FA with a shared lock and preserves every other unsaved field', async () => {
    await mount()
    await fillDraft()
    const disable2FA = button('关闭两步验证')
    const pendingForm = form()
    await act(async () => {
      disable2FA.click()
      disable2FA.click()
      pendingForm.dispatchEvent(
        new dom.window.Event('submit', { bubbles: true, cancelable: true })
      )
    })
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      method: 'POST',
      path: '/admin/user/2fa/disable',
      body: { uid: 17 }
    })
    expect(dom.window.document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(button('保存').disabled).toBe(true)
    await escape()
    expect(dialog()).not.toBeNull()
    await settle({})
    expect(mocks.onUpdated).toHaveBeenCalledExactlyOnceWith(17)
    expectDraft()
    expect(dialog()?.textContent).toContain('未启用')
    expect(button('关闭两步验证').disabled).toBe(true)
    expect(button('保存').disabled).toBe(false)
    await submit()
    expect(writes[1].body).toMatchObject({
      name: 'Alice Smith.',
      email: 'edited@example.com',
      role: 3,
      status: 2,
      dailyImageCount: 12,
      password: 'Secret123',
      bio: '尚未保存的简介'
    })
  })

  it.each([
    ['save', 'business'],
    ['save', 'empty'],
    ['save', 'network'],
    ['2fa', 'business'],
    ['2fa', 'empty'],
    ['2fa', 'network']
  ] as const)(
    'keeps the entire draft after %s %s failure and allows an explicit retry',
    async (action, failure) => {
      await mount()
      await fillDraft()
      const start = () => (action === 'save' ? submit() : click('关闭两步验证'))
      await start()
      if (failure === 'network') {
        await act(async () => writes[0].reject(new Error('connection lost')))
      } else {
        await settle(failure === 'business' ? '该操作暂时不可用' : '')
      }
      expect(alert()?.textContent).toBe(
        failure === 'business'
          ? '该操作暂时不可用'
          : failure === 'network'
            ? '网络错误，请稍后重试'
            : action === 'save'
              ? '更新用户失败，请稍后重试'
              : '关闭两步验证失败，请稍后重试'
      )
      expectDraft()
      expect(mocks.onUpdated).not.toHaveBeenCalled()
      expect(button('保存').disabled).toBe(false)
      expect(button('关闭两步验证').disabled).toBe(false)
      await start()
      expect(writes).toHaveLength(2)
      expect(writes[1].body).toEqual(writes[0].body)
      expect(alert()).toBeNull()
      await settle({}, 1)
      expect(mocks.onUpdated).toHaveBeenCalledExactlyOnceWith(17)
      if (action === 'save') expect(dialog()).toBeNull()
      else expectDraft()
    }
  )

  it('preserves a same-ID draft across parent refreshes, including after disabling 2FA', async () => {
    await mount()
    await fillDraft()
    await render(
      user({
        name: '服务端新名字',
        email: 'new@example.com',
        role: 1,
        bio: '服务端新简介',
        dailyImageCount: 1
      })
    )
    expectDraft()
    await click('关闭两步验证')
    await settle({})
    await render(user({ enable2FA: true }))
    expectDraft()
    expect(button('关闭两步验证').disabled).toBe(true)
    await submit()
    expect(writes[1].body.uid).toBe(17)
    expect(writes[1].body.email).toBe('edited@example.com')
  })

  it.each(['save', '2fa'] as const)(
    'closes on a different target during %s and reports only the captured old UID',
    async (action) => {
      await mount()
      await fillDraft()
      if (action === 'save') await submit()
      else await click('关闭两步验证')
      const next = user({
        id: 28,
        name: '另一用户',
        email: 'next@example.com',
        role: 4,
        dailyImageCount: 3
      })
      await render(next)
      expect(dialog()).toBeNull()
      expect(writes[0].body.uid).toBe(17)
      await settle({})
      expect(mocks.onUpdated).toHaveBeenCalledExactlyOnceWith(17)
      expect(dialog()).toBeNull()
      await click('编辑')
      expect(field('用户 ID').value).toBe('28')
      expect(field('用户名').value).toBe('另一用户')
      expect(field('邮箱').value).toBe('next@example.com')
      expect(field('角色').value).toBe('4')
      expect(field('新密码').value).toBe('')
      expect(button('关闭两步验证').disabled).toBe(false)
      await submit()
      expect(writes[1].body.uid).toBe(28)
      expect(writes[1].body).not.toHaveProperty('password')
    }
  )

  it.each(['cancel', 'escape'] as const)(
    'clears the password and takes a fresh snapshot after %s closes the dialog',
    async (method) => {
      await mount()
      await fillDraft()
      if (method === 'cancel') await click('取消')
      else await escape()
      expect(dialog()).toBeNull()
      expect(writes).toHaveLength(0)
      await render(user({ name: '更新后的用户' }))
      await click('编辑')
      expect(field('新密码').value).toBe('')
      expect(field('用户名').value).toBe('更新后的用户')
      expect(alert()).toBeNull()
    }
  )
})
