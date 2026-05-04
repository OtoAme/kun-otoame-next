'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRewritePatchStore } from '~/store/rewriteStore'
import { PatchHeaderTabs } from './Tabs'
import { PatchHeaderInfo } from './Info'
import { KunAutoImageViewer } from '~/components/kun/image-viewer/AutoImageViewer'
import { KunNull } from '~/components/kun/Null'
import { kunMoyuMoe } from '~/config/moyu-moe'
import { getPatchPageTitle } from '~/utils/patch/getPatchPageTitle'
import type { Patch, PatchIntroduction } from '~/types/api/patch'

interface PatchHeaderProps {
  patch: Patch
  intro: PatchIntroduction
  uid?: number
  nsfwAllowed: boolean
}

export const PatchHeaderContainer = ({
  patch,
  intro,
  uid,
  nsfwAllowed
}: PatchHeaderProps) => {
  const resourceSectionTabsId = 'patch-resource-section-tabs'
  const { setData } = useRewritePatchStore()
  const searchParams = useSearchParams()
  const [selected, setSelected] = useState('introduction')
  const isNsfwBlocked = useMemo(
    () => patch.contentLimit === 'nsfw' && !nsfwAllowed,
    [patch.contentLimit, nsfwAllowed]
  )
  const tabsRef = useRef<HTMLDivElement>(null)

  const scrollToResourceSectionTabs = () => {
    const resourceSectionTabs = document.getElementById(resourceSectionTabsId)
    if (resourceSectionTabs) {
      resourceSectionTabs.scrollIntoView({ behavior: 'smooth' })
      return true
    }
    return false
  }

  const handleClickDownloadNav = () => {
    if (selected === 'resources') {
      if (!scrollToResourceSectionTabs()) {
        tabsRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
      return
    }

    setSelected('resources')

    let retryTimes = 0
    const scrollWhenReady = () => {
      if (scrollToResourceSectionTabs()) {
        return
      }

      retryTimes += 1
      if (retryTimes > 12) {
        tabsRef.current?.scrollIntoView({ behavior: 'smooth' })
        return
      }

      setTimeout(scrollWhenReady, 50)
    }

    setTimeout(scrollWhenReady, 0)
  }

  useEffect(() => {
    setData({
      id: patch.id,
      uniqueId: patch.uniqueId,
      vndbId: patch.vndbId ?? '',
      vndbRelationId: patch.vndbRelationId ?? '',
      bangumiId: patch.bangumiId ? String(patch.bangumiId) : '',
      steamId: patch.steamId ? String(patch.steamId) : '',
      dlsiteCode: patch.dlsiteCode ?? '',
      dlsiteCircleName: '',
      dlsiteCircleLink: '',
      vndbTags: [],
      vndbDevelopers: [],
      bangumiTags: [],
      bangumiDevelopers: [],
      steamTags: [],
      steamDevelopers: [],
      steamAliases: [],
      name: patch.name,
      introduction: patch.introduction,
      officialUrl: intro.officialUrl,
      alias: patch.alias,
      tag: patch.tags,
      contentLimit: patch.contentLimit,
      released: intro.released,
      isDuplicate: patch.isDuplicate,
      images: intro.images.map((img) => ({
        id: img.id,
        url: img.url,
        is_nsfw: img.isNSFW
      })),
      bannerUrl: patch.banner
    })
  }, [])

  useEffect(() => {
    if (patch.contentLimit !== 'nsfw') {
      return
    }

    if (isNsfwBlocked) {
      document.title = ''
      return
    }

    document.title = `${getPatchPageTitle(patch)} - ${kunMoyuMoe.titleShort}`
  }, [isNsfwBlocked, patch])

  return (
    <div className="relative w-full mx-auto max-w-7xl">
      {isNsfwBlocked ? (
        <KunNull
          message={
            !uid ? '请登录后查看' : '请在右上角菜单开启 NSFW 内容显示后查看'
          }
        />
      ) : (
        <>
          <KunAutoImageViewer />

          <PatchHeaderInfo
            patch={patch}
            handleClickDownloadNav={handleClickDownloadNav}
          />

          <div ref={tabsRef} className="scroll-mt-24">
            <PatchHeaderTabs
              id={patch.id}
              vndbId={patch.vndbId || ''}
              intro={intro}
              uid={uid}
              selected={selected}
              setSelected={setSelected}
            />
          </div>
        </>
      )}
    </div>
  )
}
