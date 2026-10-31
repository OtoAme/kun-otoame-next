'use client'

import type { ReactNode } from 'react'

import {
  UserPicker,
  type FilterChip,
  type FilterContext
} from '~/components/dashboard/page/SearchableListPage'
import { Checkbox } from '~/components/dashboard/ui/checkbox'
import { Input } from '~/components/dashboard/ui/input'
import { Label } from '~/components/dashboard/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import {
  RESOURCE_SECTION_MAP,
  SUPPORTED_LANGUAGE,
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM,
  SUPPORTED_PLATFORM_MAP,
  SUPPORTED_TYPE,
  SUPPORTED_TYPE_MAP,
  type ResourceSection
} from '~/constants/resource'
import { RESOURCE_STATUS_MAP } from '~/constants/admin'
import {
  formatShanghaiCalendarDate,
  isValidMoemoepointDate
} from '~/utils/moemoepointDateRange'
import {
  getChineseSupportOptions,
  getResourceTypeGroups
} from '~/utils/resourceFormRules'
import type { ListFilters } from '~/hooks/dashboard/useSearchableList'
import type { SearchableListConfig } from '~/hooks/dashboard/useSearchableList'

type Options = Record<string, string>

const SEARCH_FIELD_LABELS: Options = {
  all: '全部',
  text: '名称与备注',
  game: '游戏名称',
  link: '下载链接或 Hash',
  id: '资源 ID'
}
const PUBLISHER_LABELS: Options = { official: '官方', user: '用户' }
const HEALTH_LABELS: Options = {
  broken: '有失效链接',
  attention: '有疑似失效或有争议链接',
  healthy: '全部链接正常'
}
const RATING_LABELS: Options = {
  all: '全部分级',
  sfw: '仅全年龄',
  nsfw: '仅成人'
}
const SORT_LABELS: Options = {
  created_desc: '发布时间（新到旧）',
  created_asc: '发布时间（旧到新）',
  download_desc: '下载次数（多到少）',
  download_asc: '下载次数（少到多）'
}
const STATUS_VALUES = ['0', '1', '2']

const oneOf = (labels: Options) => (raw: string) => (raw in labels ? raw : null)

// Canonical, deduplicated, allow-listed comma list; null when nothing valid.
const listOf = (allowed: readonly string[]) => (raw: string) => {
  const values = allowed.filter((value) => raw.split(',').includes(value))
  return values.length ? values.join(',') : null
}

const date = (raw: string) => (isValidMoemoepointDate(raw) ? raw : null)

const userId = (raw: string) => (/^[1-9]\d{0,6}$/.test(raw) ? raw : null)

const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) =>
  formatShanghaiCalendarDate(new Date(Date.now() - days * DAY_MS))

export const RESOURCE_LIST_CONFIG: SearchableListConfig = {
  endpoint: '/admin/resource',
  field: 'resources',
  fallbackError: '获取资源列表失败，请稍后重试',
  filters: {
    searchField: oneOf(SEARCH_FIELD_LABELS),
    section: oneOf(RESOURCE_SECTION_MAP),
    status: listOf(STATUS_VALUES),
    publisher: oneOf(PUBLISHER_LABELS),
    type: listOf(SUPPORTED_TYPE),
    language: listOf(SUPPORTED_LANGUAGE),
    platform: listOf(SUPPORTED_PLATFORM),
    health: oneOf(HEALTH_LABELS),
    from: date,
    to: date,
    rating: oneOf(RATING_LABELS),
    sort: oneOf(SORT_LABELS),
    // Publisher is a filter, so it combines with a keyword search.
    userId,
    userName: (raw) => raw.slice(0, 17) || null
  },
  displayOnly: ['userName'],
  // Management lists show every content rating unless one is chosen.
  defaultParams: { rating: 'all', searchField: 'all' }
}

const split = (value: string | undefined) => (value ? value.split(',') : [])

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
      </legend>
      {children}
    </fieldset>
  )
}

function SingleSelect({
  id,
  label,
  value,
  options,
  allLabel,
  onChange
}: {
  id: string
  label: string
  value: string | undefined
  options: Options
  allLabel?: string
  onChange: (value: string) => void
}) {
  const ALL = '__all'
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select
        value={value ?? ALL}
        onValueChange={(next) => onChange(next === ALL ? '' : next)}
      >
        <SelectTrigger id={id} size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allLabel && <SelectItem value={ALL}>{allLabel}</SelectItem>}
          {Object.entries(options).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function CheckList({
  name,
  values,
  options,
  selected,
  onChange
}: {
  name: string
  values: readonly string[]
  options: Options
  selected: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      {values.map((value) => {
        const id = `resource-filter-${name}-${value}`
        return (
          <div key={value} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={selected.includes(value)}
              onCheckedChange={(checked) =>
                onChange(
                  checked === true
                    ? [...selected, value]
                    : selected.filter((item) => item !== value)
                )
              }
            />
            <Label htmlFor={id} className="text-sm font-normal">
              {options[value] ?? value}
            </Label>
          </div>
        )
      })}
    </div>
  )
}

/** Type groups follow the front-end publish form for the chosen section. */
function typeGroups(section: string | undefined) {
  const sections: ResourceSection[] =
    section === 'galgame' || section === 'patch'
      ? [section]
      : ['galgame', 'patch']
  return sections.map((key) => {
    const [game, other] = [
      getResourceTypeGroups(key).find((group) => group.key === 'game-types'),
      getResourceTypeGroups(key).find((group) => group.key === 'other-types')
    ]
    const chinese = getChineseSupportOptions(key)
    return {
      section: key,
      groups: [
        game && { title: game.title, values: game.options.map((o) => o.value) },
        chinese.length > 0 && {
          title: '中文支持',
          values: chinese.map((o) => o.value)
        },
        other && {
          title: other.title,
          values: other.options.map((o) => o.value)
        }
      ].filter(Boolean) as { title: string; values: string[] }[]
    }
  })
}

export function ResourceFilterPanel({ filters, setFilters }: FilterContext) {
  const types = split(filters.type)
  const setList = (key: string) => (next: string[]) =>
    setFilters({ [key]: next.join(',') })
  const sections = typeGroups(filters.section)

  return (
    <div className="flex flex-col gap-5">
      <SingleSelect
        id="resource-filter-section"
        label="分区"
        value={filters.section}
        options={RESOURCE_SECTION_MAP}
        allLabel="全部分区"
        onChange={(section) =>
          // Types outside the new section can no longer match.
          setFilters({
            section,
            type: section
              ? types
                  .filter((type) =>
                    typeGroups(section)[0].groups.some((group) =>
                      group.values.includes(type)
                    )
                  )
                  .join(',')
              : (filters.type ?? '')
          })
        }
      />
      <Field label="状态">
        <CheckList
          name="status"
          values={STATUS_VALUES}
          options={RESOURCE_STATUS_MAP as Options}
          selected={split(filters.status)}
          onChange={setList('status')}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor="resource-filter-user"
          className="text-xs text-muted-foreground"
        >
          发布者
        </Label>
        <UserPicker
          id="resource-filter-user"
          className="w-full"
          selected={
            filters.userId
              ? {
                  id: Number(filters.userId),
                  name: filters.userName || `#${filters.userId}`
                }
              : null
          }
          onSelect={(user) =>
            setFilters({
              userId: user ? String(user.id) : '',
              userName: user?.name ?? ''
            })
          }
        />
      </div>
      <SingleSelect
        id="resource-filter-publisher"
        label="发布者身份"
        value={filters.publisher}
        options={PUBLISHER_LABELS}
        allLabel="全部"
        onChange={(publisher) => setFilters({ publisher })}
      />
      {sections.map(({ section, groups }) => (
        <Field
          key={section}
          label={
            sections.length > 1
              ? `类型 · ${RESOURCE_SECTION_MAP[section]}`
              : '类型'
          }
        >
          {groups.map((group) => (
            <div key={group.title} className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">{group.title}</p>
              <CheckList
                name={`type-${section}`}
                values={group.values}
                options={SUPPORTED_TYPE_MAP}
                selected={types}
                onChange={(next) =>
                  setFilters({
                    type: [
                      ...types.filter((type) => !group.values.includes(type)),
                      ...next.filter((type) => group.values.includes(type))
                    ].join(',')
                  })
                }
              />
            </div>
          ))}
        </Field>
      ))}
      <Field label="语言">
        <CheckList
          name="language"
          values={SUPPORTED_LANGUAGE}
          options={SUPPORTED_LANGUAGE_MAP}
          selected={split(filters.language)}
          onChange={setList('language')}
        />
      </Field>
      <Field label="平台">
        <CheckList
          name="platform"
          values={SUPPORTED_PLATFORM}
          options={SUPPORTED_PLATFORM_MAP}
          selected={split(filters.platform)}
          onChange={setList('platform')}
        />
      </Field>
      <SingleSelect
        id="resource-filter-health"
        label="链接健康"
        value={filters.health}
        options={HEALTH_LABELS}
        allLabel="全部"
        onChange={(health) => setFilters({ health })}
      />
      <Field label="发布时间">
        <div className="flex flex-wrap gap-1.5">
          {[7, 30].map((days) => (
            <button
              key={days}
              type="button"
              className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => setFilters({ from: daysAgo(days - 1), to: '' })}
            >
              近 {days} 天
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="resource-filter-from"
              className="text-xs text-muted-foreground"
            >
              起
            </Label>
            <Input
              id="resource-filter-from"
              type="date"
              value={filters.from ?? ''}
              max={filters.to}
              onChange={(event) => setFilters({ from: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="resource-filter-to"
              className="text-xs text-muted-foreground"
            >
              止
            </Label>
            <Input
              id="resource-filter-to"
              type="date"
              value={filters.to ?? ''}
              min={filters.from}
              onChange={(event) => setFilters({ to: event.target.value })}
            />
          </div>
        </div>
      </Field>
      <SingleSelect
        id="resource-filter-rating"
        label="内容分级"
        value={filters.rating}
        options={RATING_LABELS}
        onChange={(rating) =>
          setFilters({ rating: rating === 'all' ? '' : rating })
        }
      />
    </div>
  )
}

/** What the search box matches under each scope. */
const SEARCH_PLACEHOLDERS: Options = {
  all: '资源名称、备注、游戏名或资源 ID',
  text: '资源名称或备注',
  game: '游戏名称',
  link: '下载链接或 Hash',
  id: '资源 ID'
}

/** Placeholder for the resource search box under the chosen scope. */
export const resourceSearchPlaceholder = (filters: ListFilters) =>
  SEARCH_PLACEHOLDERS[filters.searchField || 'all'] ?? SEARCH_PLACEHOLDERS.all

/** Search scope and sort live next to the search box. */
export function ResourceToolbar({ filters, setFilters }: FilterContext) {
  return (
    <>
      <Select
        value={filters.searchField ?? 'all'}
        onValueChange={(searchField) =>
          setFilters({
            searchField: searchField === 'all' ? '' : searchField
          })
        }
      >
        <SelectTrigger className="w-[150px] shrink-0" aria-label="搜索范围">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(SEARCH_FIELD_LABELS).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.sort ?? 'created_desc'}
        onValueChange={(sort) =>
          setFilters({ sort: sort === 'created_desc' ? '' : sort })
        }
      >
        <SelectTrigger className="w-[170px] shrink-0" aria-label="排序">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(SORT_LABELS).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}

const listLabel = (value: string, labels: Options) =>
  value
    .split(',')
    .map((item) => labels[item] ?? item)
    .join('、')

/** Search scope and sort are shown in the toolbar, not as chips. */
export function resourceFilterChips(filters: ListFilters) {
  const chips: FilterChip[] = []
  const add = (key: string, label: string) => chips.push({ key, label })
  if (filters.section) add('section', RESOURCE_SECTION_MAP[filters.section])
  if (filters.status)
    add(
      'status',
      `状态：${listLabel(filters.status, RESOURCE_STATUS_MAP as Options)}`
    )
  if (filters.userId)
    chips.push({
      key: 'userId',
      label: `发布者：${filters.userName || `#${filters.userId}`}`,
      keys: ['userId', 'userName']
    })
  if (filters.publisher)
    add('publisher', `${PUBLISHER_LABELS[filters.publisher]}发布`)
  if (filters.type)
    add('type', `类型：${listLabel(filters.type, SUPPORTED_TYPE_MAP)}`)
  if (filters.language)
    add(
      'language',
      `语言：${listLabel(filters.language, SUPPORTED_LANGUAGE_MAP)}`
    )
  if (filters.platform)
    add(
      'platform',
      `平台：${listLabel(filters.platform, SUPPORTED_PLATFORM_MAP)}`
    )
  if (filters.health) add('health', HEALTH_LABELS[filters.health])
  if (filters.from) add('from', `${filters.from} 起`)
  if (filters.to) add('to', `至 ${filters.to}`)
  if (filters.rating) add('rating', RATING_LABELS[filters.rating])
  return chips
}
