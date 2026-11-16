import { spawn } from 'node:child_process'
import { mkdir, lstat, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { assertContainer, LABEL } from './config.mjs'

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => {
      stdout += data
    })
    child.stderr.on('data', (data) => {
      stderr += data
    })
    child.stdin.on('error', () => {})
    child.on('error', () =>
      reject(new Error(`无法执行 ${command}，请检查安装和执行权限。`))
    )
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(options.input ?? '')
  })

export const checked = async (runner, command, args, options, label) => {
  const result = await runner(command, args, options)
  // Tool errors can contain SQL, credentials or an environment dump. Keep
  // their output out of the setup terminal and report the failed operation.
  if (result.code !== 0)
    throw new Error(`${label}失败（退出码 ${result.code}）。`)
  return result.stdout.trim()
}

export const fileInfo = async (path) => {
  const parent = dirname(path)
  if (parent !== path) {
    const info = await fileInfo(parent)
    if (info && !info.isDirectory())
      throw new Error('本地文件的父路径不是目录。')
  }
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error(`拒绝使用符号链接：${path}`)
    return info
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export const privateDirectory = async (path) => {
  const info = await fileInfo(path)
  if (info && !info.isDirectory()) throw new Error('本地状态路径不是目录。')
  if (!info) {
    await privateDirectory(dirname(path))
    try {
      await mkdir(path, { mode: 0o700 })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      await fileInfo(path)
    }
  }
}

export const readText = async (path, optional = false) => {
  const info = await fileInfo(path)
  if (!info && optional) return null
  if (!info?.isFile()) throw new Error(`本地文件缺失或类型不符：${path}`)
  return readFile(path, 'utf8')
}

export const readJson = async (path, optional = false) => {
  const text = await readText(path, optional)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`本地状态文件无效：${path}`)
  }
}

export const writePrivate = async (path, text) => {
  await privateDirectory(dirname(path))
  const info = await fileInfo(path)
  if (info && !info.isFile()) throw new Error('拒绝覆盖非普通文件。')
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export const writeJson = (path, value) =>
  writePrivate(path, JSON.stringify(value, null, 2) + '\n')

export const withLock = async (path, action, waitMs = 0) => {
  await privateDirectory(dirname(path))
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      await mkdir(path, { mode: 0o700 })
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (Date.now() >= deadline)
        throw new Error(
          `操作锁已存在，请等待当前操作结束；中断后须核对进程再清理：${path}`
        )
      await pause(50)
    }
  }
  try {
    await writeFile(join(path, 'pid'), String(process.pid), { mode: 0o600 })
    return await action()
  } finally {
    await rm(path, { recursive: true })
  }
}

export const portAvailable = (port) =>
  new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () =>
      server.close(() => resolve(true))
    )
  })

export const INSPECT_FORMAT =
  '{"id":{{json .Id}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}'

export class Docker {
  constructor(runner = run) {
    this.runner = runner
    this.endpoint = null
    this.run = async (command, args, options = {}) => {
      const endpoint = await this.localEndpoint()
      return runner(command, ['--host', endpoint, ...args], {
        ...options,
        env: {
          ...process.env,
          DOCKER_HOST: endpoint,
          DOCKER_CONTEXT: '',
          DOCKER_TLS_VERIFY: '',
          DOCKER_CERT_PATH: ''
        }
      })
    }
  }

  async localEndpoint() {
    if (!this.endpoint)
      this.endpoint = (async () => {
        const selected = process.env.DOCKER_CONTEXT
        const host =
          !selected && process.env.DOCKER_HOST
            ? process.env.DOCKER_HOST
            : await checked(
                this.runner,
                'docker',
                [
                  'context',
                  'inspect',
                  '--format',
                  '{{(index .Endpoints "docker").Host}}',
                  ...(selected ? [selected] : [])
                ],
                {},
                '读取 Docker 端点'
              )
        if (!/^unix:\/\/\/[^\0\r\n]+$/.test(host)) {
          throw new Error(
            'worktree 管理器只支持本机 Unix socket Docker 端点，拒绝操作远程或 TCP context。'
          )
        }
        return host
      })()
    return this.endpoint
  }

  command(args, input, label = 'Docker 操作') {
    return checked(this.run, 'docker', args, { input }, label)
  }

  async inspect(name) {
    const result = await this.run('docker', [
      'container',
      'inspect',
      '--format',
      INSPECT_FORMAT,
      name
    ])
    if (result.code !== 0) {
      if (/No such (object|container)/i.test(result.stderr)) return null
      throw new Error('无法读取 Docker 容器，请检查 Docker Desktop 和权限。')
    }
    try {
      return JSON.parse(result.stdout)
    } catch {
      throw new Error('Docker 容器元数据无效。')
    }
  }

  async verify(resource) {
    const info = await this.inspect(resource.name)
    assertContainer(info, resource.labels, resource.id)
    return info
  }

  async inspectVolume(name, expected) {
    const result = await this.run('docker', [
      'volume',
      'inspect',
      '--format',
      '{{json .Labels}}',
      name
    ])
    if (result.code !== 0) {
      if (/No such volume/i.test(result.stderr)) return false
      throw new Error('无法读取 Docker 数据卷。')
    }
    let labels
    try {
      labels = JSON.parse(result.stdout)
    } catch {
      throw new Error('Docker 数据卷元数据无效。')
    }
    if (
      Object.entries(expected).some(([key, value]) => labels?.[key] !== value)
    )
      throw new Error('同名数据卷来源不明，拒绝操作。')
    return true
  }

  async volume(name, labels) {
    const result = await this.run('docker', [
      'volume',
      'inspect',
      '--format',
      '{{json .Labels}}',
      name
    ])
    if (result.code === 0) {
      let actual
      try {
        actual = JSON.parse(result.stdout)
      } catch {
        throw new Error('Docker 数据卷元数据无效。')
      }
      for (const [key, value] of Object.entries(labels)) {
        if (actual?.[key] !== value)
          throw new Error('同名数据卷来源不明，拒绝挂载。')
      }
    } else if (/No such volume/i.test(result.stderr)) {
      await this.command([
        'volume',
        'create',
        ...Object.entries(labels).flatMap(([key, value]) => [
          '--label',
          `${key}=${value}`
        ]),
        name
      ])
      await this.volume(name, labels)
    } else throw new Error('无法读取 Docker 数据卷。')
  }

  async ensure(resource, args, persist) {
    let info = await this.inspect(resource.name)
    if (info) assertContainer(info, resource.labels, resource.id)
    else {
      if (resource.id)
        throw new Error('已登记容器被删除，拒绝自动重建或更换数据库。')
      await this.volume(resource.volume, resource.labels)
      const id = await this.command(
        [
          'container',
          'create',
          '--pull=never',
          '--name',
          resource.name,
          ...Object.entries(resource.labels).flatMap(([key, value]) => [
            '--label',
            `${key}=${value}`
          ]),
          '--mount',
          `type=volume,src=${resource.volume},dst=/data`,
          ...args
        ],
        undefined,
        '创建容器（请先准备所需镜像）'
      )
      if (!/^[a-f0-9]{64}$/.test(id))
        throw new Error('Docker 未返回有效容器标识。')
      resource.id = id
      await persist()
      info = await this.verify(resource)
    }
    if (!resource.id) {
      resource.id = info.id
      await persist()
    }
    if (!info.running) {
      await this.command(['start', resource.id], undefined, '启动容器')
      info = await this.verify(resource)
    }
    return info
  }

  async psql(resource, database, user, input) {
    const info = await this.verify(resource)
    if (!info.running) throw new Error('PostgreSQL 容器未运行。')
    return this.command(
      [
        'exec',
        '-i',
        resource.id,
        'psql',
        '-X',
        '-qAt',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        user,
        '-d',
        database
      ],
      input,
      '数据库准备'
    )
  }

  async ready(resource, command, input, expected = '') {
    for (let attempt = 0; attempt < 60; attempt++) {
      await this.verify(resource)
      const result = await this.run(
        'docker',
        ['exec', '-i', resource.id, ...command],
        { input }
      )
      if (result.code === 0 && (!expected || result.stdout.trim() === expected))
        return
      await pause(250)
    }
    throw new Error(
      `${resource.name} 未在就绪检查期限内响应，请检查本次容器后重试。`
    )
  }
}

export const resourceLabels = (identity, nonce, kind) => ({
  [`${LABEL}.repo`]: identity.repoId,
  [`${LABEL}.owner`]: kind === 'postgres' ? identity.repoId : identity.id,
  [`${LABEL}.nonce`]: nonce,
  [`${LABEL}.kind`]: kind
})
