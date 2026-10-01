import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

const fetchMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))

vi.mock('~/utils/kunFetch', () => ({ kunFetchPost: fetchMock }))
vi.mock('react-hot-toast', () => ({ default: toastMock }))
vi.mock('zustand/middleware', () => ({
  persist: (initializer: unknown) => initializer,
  createJSONStorage: vi.fn()
}))

vi.mock('@heroui/card', () => {
  const Section = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    Card: Section,
    CardBody: Section,
    CardFooter: Section,
    CardHeader: Section
  }
})

vi.mock('@heroui/input', () => {
  type Props = {
    label: string
    value?: string
    defaultValue?: string
    isDisabled?: boolean
    isInvalid?: boolean
    errorMessage?: string
    onValueChange?: (value: string) => void
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  }
  const Field = ({ multiline, ...props }: Props & { multiline?: boolean }) => {
    const Tag = multiline ? 'textarea' : 'input'
    return (
      <>
        <Tag
          aria-label={props.label}
          aria-invalid={props.isInvalid}
          value={props.value ?? props.defaultValue ?? ''}
          disabled={props.isDisabled}
          onChange={() => {}}
          onInput={(event) => {
            props.onValueChange?.(event.currentTarget.value)
            props.onChange?.(
              event as unknown as React.ChangeEvent<HTMLInputElement>
            )
          }}
        />
        {props.isInvalid && <span role="alert">{props.errorMessage}</span>}
      </>
    )
  }
  return {
    Input: (props: Props) => <Field {...props} />,
    Textarea: (props: Props) => <Field {...props} multiline />
  }
})

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    disabled,
    isLoading
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    disabled?: boolean
    isLoading?: boolean
  }) => (
    <button disabled={isDisabled || disabled || isLoading} onClick={onPress}>
      {children}
    </button>
  )
}))

vi.mock('@heroui/modal', () => {
  const CloseContext = React.createContext(() => {})
  const Section = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    Modal: ({
      children,
      isOpen,
      onOpenChange
    }: {
      children?: React.ReactNode
      isOpen: boolean
      onOpenChange: (open: boolean) => void
    }) =>
      isOpen ? (
        <CloseContext.Provider value={() => onOpenChange(false)}>
          <div role="dialog">{children}</div>
        </CloseContext.Provider>
      ) : null,
    ModalContent: ({
      children
    }: {
      children: (onClose: () => void) => React.ReactNode
    }) => <>{children(React.useContext(CloseContext))}</>,
    ModalBody: Section,
    ModalFooter: Section,
    ModalHeader: Section,
    useDisclosure: () => {
      const [isOpen, setIsOpen] = React.useState(false)
      return {
        isOpen,
        onOpen: () => setIsOpen(true),
        onOpenChange: () => setIsOpen((open) => !open)
      }
    }
  }
})

import { Username } from '~/components/settings/user/Username'
import { Bio } from '~/components/settings/user/Bio'
import { useUserStore } from '~/store/userStore'

const initialUser = useUserStore.getState().user
const balance = { total: 70, reserved: 0, available: 70 }

describe.each([
  {
    label: '用户名',
    Component: Username,
    field: 'name' as const,
    key: 'username',
    max: 17
  },
  { label: '签名', Component: Bio, field: 'bio' as const, key: 'bio', max: 107 }
])('$label settings', ({ label, Component, field, key, max }) => {
  let dom: JSDOM
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    dom = new JSDOM('<!doctype html><div id="root"></div>')
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    useUserStore.setState({
      user: {
        ...initialUser,
        uid: 1,
        name: '当前用户名',
        bio: '当前签名',
        moemoepoint: 100,
        moemoepointAvailable: 100
      }
    })
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const render = () => act(async () => root.render(<Component />))
  const input = () =>
    dom.window.document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[aria-label="${label}"]`
    )!
  const button = (text = '保存') =>
    [...dom.window.document.querySelectorAll('button')].find(
      (element) => element.textContent === text
    )!
  const type = async (value: string) => {
    const prototype =
      field === 'name'
        ? dom.window.HTMLInputElement.prototype
        : dom.window.HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      input(),
      value
    )
    await act(async () => {
      input().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }
  const click = (text = '保存') => act(async () => button(text).click())
  const submit = async () => {
    await click()
    if (field === 'name') await click('确定')
  }

  it('prefills saved text and disables saving until the value changes', async () => {
    await render()
    const saved = useUserStore.getState().user[field]
    expect(input().value).toBe(saved)
    expect(button().disabled).toBe(true)
    await click()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(dom.window.document.querySelector('[role="dialog"]')).toBeNull()

    await type('修改后的内容')
    expect(button().disabled).toBe(false)
    await type(saved)
    expect(button().disabled).toBe(true)
    await type(`  ${saved}  `)
    expect(button().disabled).toBe(true)
  })

  it('keeps invalid changes disabled and explains the validation error', async () => {
    await render()
    for (const value of ['   ', 'a'.repeat(max + 1)]) {
      await type(value)
      expect(button().disabled).toBe(true)
      expect(
        dom.window.document.querySelector('[role="alert"]')?.textContent
      ).toBeTruthy()
    }
    await type('有效的内容')
    expect(button().disabled).toBe(false)
    expect(dom.window.document.querySelector('[role="alert"]')).toBeNull()
  })

  it('prefills asynchronously loaded user data and preserves an edited draft during refresh', async () => {
    useUserStore.setState({ user: initialUser })
    await render()
    expect(button().disabled).toBe(true)
    await act(async () => {
      useUserStore.setState({
        user: {
          ...initialUser,
          uid: 1,
          name: '已加载用户名',
          bio: '已加载签名'
        }
      })
    })
    expect(input().value).toBe(useUserStore.getState().user[field])
    await type('正在编辑')
    await act(async () => {
      useUserStore.setState({
        user: { ...useUserStore.getState().user, [field]: '后台刷新内容' }
      })
    })
    expect(input().value).toBe('正在编辑')
  })

  it('saves normalized text, retains the new value and disables saving again', async () => {
    fetchMock.mockResolvedValue({ balance })
    await render()
    await type('  新内容  ')
    await submit()
    expect(fetchMock).toHaveBeenCalledWith(`/user/setting/${key}`, {
      [key]: '新内容'
    })
    expect(useUserStore.getState().user[field]).toBe('新内容')
    expect(input().value).toBe('新内容')
    expect(button().disabled).toBe(true)
    expect(toastMock.success).toHaveBeenCalledWith(`更新${label}成功`)
    if (field === 'name')
      expect(useUserStore.getState().user.moemoepointAvailable).toBe(70)
  })

  it.each([
    [
      'business rejection',
      () => fetchMock.mockResolvedValue('保存被拒绝'),
      '保存被拒绝'
    ],
    [
      'network failure',
      () => fetchMock.mockRejectedValue(new Error('网络暂时不可用')),
      '网络暂时不可用'
    ]
  ])(
    'preserves saved data and a retryable draft after %s',
    async (_name, fail, message) => {
      fail()
      await render()
      const saved = useUserStore.getState().user[field]
      await type('未保存的内容')
      await submit()
      expect(useUserStore.getState().user[field]).toBe(saved)
      expect(input().value).toBe('未保存的内容')
      expect(input().disabled).toBe(false)
      expect(button().disabled).toBe(false)
      expect(toastMock.error).toHaveBeenCalledWith(message)
      expect(toastMock.success).not.toHaveBeenCalled()
    }
  )

  it('disables interaction while saving and preserves unrelated refreshed user data', async () => {
    let resolve!: (value: unknown) => void
    fetchMock.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    await render()
    await type('提交中的内容')
    if (field === 'name') await click()
    await act(async () => {
      const submitButton = button(field === 'name' ? '确定' : '保存')
      submitButton.click()
      submitButton.click()
    })
    expect(button().disabled).toBe(true)
    expect(input().disabled).toBe(true)
    await click()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      useUserStore.setState({
        user: { ...useUserStore.getState().user, avatar: '新头像' }
      })
      resolve({ balance })
    })
    expect(useUserStore.getState().user.avatar).toBe('新头像')
    expect(input().value).toBe('提交中的内容')
    expect(button().disabled).toBe(true)
  })
})
