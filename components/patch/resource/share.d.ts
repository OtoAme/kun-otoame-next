import type { Control, FieldErrors } from 'react-hook-form'
import type { UseFormSetValue, UseFormWatch } from 'react-hook-form'
import type { ResourceSection } from '~/constants/resource'

interface Fields {
  type: string[]
  name: string
  section: ResourceSection
  patchId: number
  links: {
    id?: number
    storage: string
    hash: string
    content: string
    size: string
    code: string
    password: string
  }[]
  note: string
  language: string[]
  platform: string[]
}

export interface FileStatus {
  file: File
  progress: number
  error?: string
  hash?: string
  filetype?: string
}

export type ErrorType = FieldErrors<Fields>
export type ControlType = Control<Fields, any>
export type SetValueType = UseFormSetValue<Fields>
export type WatchType = UseFormWatch<Fields>
