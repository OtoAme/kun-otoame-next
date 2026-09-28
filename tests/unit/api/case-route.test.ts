import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn(),
  createCase: vi.fn(),
  listCases: vi.fn(),
  getCase: vi.fn(),
  appendCaseMessage: vi.fn(),
  resolveCase: vi.fn(),
  reopenCase: vi.fn(),
  getAdminCases: vi.fn(),
  getAdminCaseDetail: vi.fn(),
  handleCaseAsAdmin: vi.fn(),
  handleCaseResource: vi.fn(),
  handleCaseContent: vi.fn(),
  setCaseMessageHidden: vi.fn()
}))

vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))
vi.mock('~/app/api/case/service', () => mocks)

import { GET as caseDetailGET } from '~/app/api/case/[id]/route'
import { POST as caseMessagePOST } from '~/app/api/case/[id]/message/route'
import { POST as caseReopenPOST } from '~/app/api/case/[id]/reopen/route'
import { POST as caseResolvePOST } from '~/app/api/case/[id]/resolve/route'
import {
  GET as caseListGET,
  POST as caseCreatePOST
} from '~/app/api/case/route'
import { GET as adminCaseDetailGET } from '~/app/api/admin/case/[id]/route'
import { POST as adminCaseContentPOST } from '~/app/api/admin/case/[id]/content/route'
import { POST as adminCaseHandlePOST } from '~/app/api/admin/case/[id]/handle/route'
import { POST as adminCaseMessageHidePOST } from '~/app/api/admin/case/[id]/message-hide/route'
import { POST as adminCaseResourcePOST } from '~/app/api/admin/case/[id]/resource/route'
import { GET as adminCaseListGET } from '~/app/api/admin/case/route'

const serviceMocks = [
  mocks.createCase,
  mocks.listCases,
  mocks.getCase,
  mocks.appendCaseMessage,
  mocks.resolveCase,
  mocks.reopenCase,
  mocks.getAdminCases,
  mocks.getAdminCaseDetail,
  mocks.handleCaseAsAdmin,
  mocks.handleCaseResource,
  mocks.handleCaseContent,
  mocks.setCaseMessageHidden
]

const postRequest = (url: string, body: unknown) =>
  new NextRequest(`https://example.test${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

const getRequest = (url: string) =>
  new NextRequest(`https://example.test${url}`)

const pathParams = (id: string) => ({
  params: Promise.resolve({ id })
})

const noStore = (response: Response) => {
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
}

const validCreateBody = () => ({
  kind: 'other',
  targetType: 'patch',
  targetId: 10,
  content: '条目资料需要进一步核对'
})

const validPathRoutes = [
  {
    name: 'user detail',
    service: mocks.getCase,
    run: (id = '12') =>
      caseDetailGET(getRequest(`/api/case/${id}`), pathParams(id))
  },
  {
    name: 'user message',
    service: mocks.appendCaseMessage,
    run: (id = '12') =>
      caseMessagePOST(
        postRequest(`/api/case/${id}/message`, { content: '回复内容' }),
        pathParams(id)
      )
  },
  {
    name: 'user resolve',
    service: mocks.resolveCase,
    run: (id = '12') =>
      caseResolvePOST(
        postRequest(`/api/case/${id}/resolve`, {
          resolution: 'out_of_scope',
          content: '说明'
        }),
        pathParams(id)
      )
  },
  {
    name: 'user reopen',
    service: mocks.reopenCase,
    run: (id = '12') =>
      caseReopenPOST(
        postRequest(`/api/case/${id}/reopen`, { content: '还没有修好' }),
        pathParams(id)
      )
  },
  {
    name: 'admin detail',
    service: mocks.getAdminCaseDetail,
    run: (id = '12') =>
      adminCaseDetailGET(getRequest(`/api/admin/case/${id}`), pathParams(id))
  },
  {
    name: 'admin handle',
    service: mocks.handleCaseAsAdmin,
    run: (id = '12') =>
      adminCaseHandlePOST(
        postRequest(`/api/admin/case/${id}/handle`, {
          action: 'resolve',
          resolution: 'out_of_scope',
          content: '说明'
        }),
        pathParams(id)
      )
  },
  {
    name: 'admin resource',
    service: mocks.handleCaseResource,
    run: (id = '12') =>
      adminCaseResourcePOST(
        postRequest(`/api/admin/case/${id}/resource`, {
          action: 'move',
          targetPatchId: 20
        }),
        pathParams(id)
      )
  },
  {
    name: 'admin message hide',
    service: mocks.setCaseMessageHidden,
    run: (id = '12') =>
      adminCaseMessageHidePOST(
        postRequest(`/api/admin/case/${id}/message-hide`, {
          messageId: 61,
          hidden: true
        }),
        pathParams(id)
      )
  },
  {
    name: 'admin content',
    service: mocks.handleCaseContent,
    run: (id = '12') =>
      adminCaseContentPOST(
        postRequest(`/api/admin/case/${id}/content`, {
          action: 'delete'
        }),
        pathParams(id)
      )
  }
] as const

const userRoutes = [
  {
    name: 'create',
    service: mocks.createCase,
    run: () => caseCreatePOST(postRequest('/api/case', validCreateBody()))
  },
  {
    name: 'list',
    service: mocks.listCases,
    run: () => caseListGET(getRequest('/api/case?tab=reported&page=1&limit=20'))
  },
  ...validPathRoutes.filter(({ name }) => name.startsWith('user '))
] as const

const adminRoutes = [
  {
    name: 'list',
    service: mocks.getAdminCases,
    run: () =>
      adminCaseListGET(
        getRequest('/api/admin/case?status=open&page=1&limit=20')
      )
  },
  ...validPathRoutes.filter(({ name }) => name.startsWith('admin '))
] as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 3 })
  for (const service of serviceMocks) service.mockResolvedValue({ ok: true })
})

describe('case route authentication and private responses', () => {
  it.each(userRoutes)(
    '$name rejects unauthenticated requests',
    async ({ run, service }) => {
      mocks.verifyHeaderCookie.mockResolvedValueOnce(null)

      const response = await run()

      expect(await response.json()).toBe('用户未登录')
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(service).not.toHaveBeenCalled()
    }
  )

  it.each(userRoutes)(
    '$name serves logged-in role 1 with no-store',
    async ({ run, service }) => {
      mocks.verifyHeaderCookie.mockResolvedValueOnce({ uid: 7, role: 1 })

      const response = await run()

      noStore(response)
      expect(service).toHaveBeenCalledOnce()
    }
  )

  it.each(adminRoutes)(
    '$name rejects unauthenticated requests',
    async ({ run, service }) => {
      mocks.verifyHeaderCookie.mockResolvedValueOnce(null)

      const response = await run()

      expect(await response.json()).toBe('用户未登录')
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(service).not.toHaveBeenCalled()
    }
  )

  it.each(adminRoutes)(
    '$name rejects roles 1 and 2 before the service',
    async ({ run, service }) => {
      for (const role of [1, 2]) {
        mocks.verifyHeaderCookie.mockResolvedValueOnce({ uid: 7, role })

        const response = await run()

        expect(await response.json()).toBe('本页面仅管理员可访问')
        expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      }
      expect(service).not.toHaveBeenCalled()
    }
  )

  it.each(adminRoutes)(
    '$name allows roles 3 and 4 with no-store',
    async ({ run, service }) => {
      for (const role of [3, 4]) {
        service.mockClear()
        mocks.verifyHeaderCookie.mockResolvedValueOnce({ uid: 7, role })

        const response = await run()

        noStore(response)
        expect(service).toHaveBeenCalledOnce()
      }
    }
  )
})

describe('case route validation and error strings', () => {
  it('keeps a parser error as a Chinese JSON string and does not call createCase', async () => {
    const response = await caseCreatePOST(
      postRequest('/api/case', { kind: 'unknown', targetType: 'patch' })
    )

    noStore(response)
    expect(typeof (await response.json())).toBe('string')
    expect(mocks.createCase).not.toHaveBeenCalled()
  })

  it('passes service error strings through unchanged', async () => {
    mocks.getCase.mockResolvedValueOnce('问题不存在')

    const response = await caseDetailGET(
      getRequest('/api/case/12'),
      pathParams('12')
    )

    noStore(response)
    expect(await response.json()).toBe('问题不存在')
  })

  it.each(validPathRoutes)(
    '$name rejects invalid path IDs before its service',
    async ({ run, service }) => {
      for (const rawId of ['0', '-1', '1.5', 'NaN', 'Infinity', '2147483648']) {
        service.mockClear()
        const response = await run(rawId)

        noStore(response)
        expect(await response.json()).toBe('问题 ID 格式不正确')
        expect(service).not.toHaveBeenCalled()
      }
    }
  )

  it('rejects malformed user and admin list queries without reading services', async () => {
    const userResponse = await caseListGET(getRequest('/api/case?tab=unknown'))
    noStore(userResponse)
    expect(typeof (await userResponse.json())).toBe('string')
    expect(mocks.listCases).not.toHaveBeenCalled()

    const adminResponse = await adminCaseListGET(
      getRequest('/api/admin/case?limit=101')
    )
    noStore(adminResponse)
    expect(typeof (await adminResponse.json())).toBe('string')
    expect(mocks.getAdminCases).not.toHaveBeenCalled()
  })
})

describe('case route input ownership', () => {
  it.each([true, false])(
    'uses the path and authenticated actor to set hidden=%s',
    async (hidden) => {
      const response = await adminCaseMessageHidePOST(
        postRequest('/api/admin/case/42/message-hide', {
          caseId: 999,
          messageId: 61,
          hidden,
          adminId: 99,
          adminRole: 4
        }),
        pathParams('42')
      )
      noStore(response)
      expect(mocks.setCaseMessageHidden).toHaveBeenCalledWith(
        { caseId: 42, messageId: 61, hidden },
        7,
        3
      )
    }
  )

  it.each([
    { messageId: 61 },
    { messageId: 0, hidden: true },
    { messageId: 61, hidden: 'false' }
  ])(
    'rejects an invalid message visibility request %j before writing',
    async (body) => {
      const response = await adminCaseMessageHidePOST(
        postRequest('/api/admin/case/42/message-hide', body),
        pathParams('42')
      )
      expect(typeof (await response.json())).toBe('string')
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(mocks.setCaseMessageHidden).not.toHaveBeenCalled()
    }
  )

  it('strips server-derived fields before creating a case', async () => {
    const response = await caseCreatePOST(
      postRequest('/api/case', {
        ...validCreateBody(),
        ownerType: 'publisher',
        ownerId: 99,
        public: true,
        source: 'system',
        patchId: 99,
        reporterId: 99,
        dedupKey: 'forged'
      })
    )

    noStore(response)
    // The caller's role only exempts administrators from the reply cap (D29).
    expect(mocks.createCase).toHaveBeenCalledWith(
      {
        kind: 'other',
        targetType: 'patch',
        targetId: 10,
        content: '条目资料需要进一步核对',
        imageKeys: []
      },
      7,
      { role: 3 }
    )
  })

  it.each([
    {
      name: 'user message',
      run: () =>
        caseMessagePOST(
          postRequest('/api/case/42/message', {
            caseId: 999,
            content: '回复内容'
          }),
          pathParams('42')
        ),
      service: mocks.appendCaseMessage,
      expected: [{ caseId: 42, content: '回复内容', imageKeys: [] }, 7, 3]
    },
    {
      name: 'user resolve',
      run: () =>
        caseResolvePOST(
          postRequest('/api/case/42/resolve', {
            caseId: 999,
            resolution: 'out_of_scope',
            content: '说明'
          }),
          pathParams('42')
        ),
      service: mocks.resolveCase,
      expected: [{ caseId: 42, resolution: 'out_of_scope', content: '说明' }, 7]
    },
    {
      name: 'admin handle',
      run: () =>
        adminCaseHandlePOST(
          postRequest('/api/admin/case/42/handle', {
            caseId: 999,
            action: 'resolve',
            resolution: 'out_of_scope',
            content: '说明'
          }),
          pathParams('42')
        ),
      service: mocks.handleCaseAsAdmin,
      expected: [
        {
          caseId: 42,
          action: 'resolve',
          resolution: 'out_of_scope',
          content: '说明'
        },
        7,
        3
      ]
    },
    {
      name: 'admin resource',
      run: () =>
        adminCaseResourcePOST(
          postRequest('/api/admin/case/42/resource', {
            caseId: 999,
            action: 'move',
            targetPatchId: 20
          }),
          pathParams('42')
        ),
      service: mocks.handleCaseResource,
      expected: [
        { caseId: 42, action: 'move', targetPatchId: 20, content: '' },
        7,
        3
      ]
    },
    {
      name: 'admin content',
      run: () =>
        adminCaseContentPOST(
          postRequest('/api/admin/case/42/content', {
            caseId: 999,
            action: 'delete'
          }),
          pathParams('42')
        ),
      service: mocks.handleCaseContent,
      expected: [{ caseId: 42, action: 'delete', content: '' }, 7, 3]
    }
  ] as const)(
    '$name injects the path ID and ignores body caseId',
    async ({ run, service, expected }) => {
      const response = await run()

      noStore(response)
      expect(service).toHaveBeenCalledWith(...expected)
    }
  )
})

describe('admin handled case route contract', () => {
  it.each([
    {
      name: 'role 4 user violation after existing user management handling',
      role: 4,
      body: {
        caseId: 999,
        action: 'resolve',
        resolution: 'handled',
        content: '已在既有用户管理入口完成处置',
        handledUserConfirmed: true
      },
      expected: {
        caseId: 42,
        action: 'resolve',
        resolution: 'handled',
        content: '已在既有用户管理入口完成处置',
        handledUserConfirmed: true
      }
    },
    {
      name: 'role 3 other patch handled without user confirmation',
      role: 3,
      body: {
        caseId: 999,
        action: 'resolve',
        resolution: 'handled',
        content: '条目已处理'
      },
      expected: {
        caseId: 42,
        action: 'resolve',
        resolution: 'handled',
        content: '条目已处理'
      }
    }
  ] as const)(
    '$name passes the confirmation fields to the service',
    async ({ role, body, expected }) => {
      mocks.verifyHeaderCookie.mockResolvedValueOnce({ uid: 7, role })

      const response = await adminCaseHandlePOST(
        postRequest('/api/admin/case/42/handle', body),
        pathParams('42')
      )

      noStore(response)
      expect(mocks.handleCaseAsAdmin).toHaveBeenCalledWith(expected, 7, role)
    }
  )
})
