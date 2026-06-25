'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRewritePatchStore } from '~/store/rewriteStore'
import { PatchHeaderTabs } from './Tabs'
import { PatchHeaderInfo } from './Info'
import { KunAutoImageViewer } from '~/components/kun/image-viewer/AutoImageViewer'
import { KunNull } from '~/components/kun/Null'
import { PatchViewBeacon } from '~/components/patch/view/PatchViewBeacon'
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
  const [displayPatch, setDisplayPatch] = useState(patch)
  const [selected, setSelected] = useState('introduction')
  const isNsfwBlocked = useMemo(
    () => displayPatch.contentLimit === 'nsfw' && !nsfwAllowed,
    [displayPatch.contentLimit, nsfwAllowed]
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
      id: displayPatch.id,
      uniqueId: displayPatch.uniqueId,
      vndbId: displayPatch.vndbId ?? '',
      vndbRelationId: displayPatch.vndbRelationId ?? '',
      bangumiId: displayPatch.bangumiId ? String(displayPatch.bangumiId) : '',
      steamId: displayPatch.steamId ? String(displayPatch.steamId) : '',
      dlsiteCode: displayPatch.dlsiteCode ?? '',
      dlsiteCircleName: '',
      dlsiteCircleLink: '',
      vndbTags: [],
      vndbDevelopers: [],
      bangumiTags: [],
      bangumiDevelopers: [],
      steamTags: [],
      steamDevelopers: [],
      steamAliases: [],
      name: displayPatch.name,
      introduction: displayPatch.introduction,
      officialUrl: intro.officialUrl,
      alias: displayPatch.alias,
      tag: displayPatch.tags,
      contentLimit: displayPatch.contentLimit,
      released: intro.released,
      isDuplicate: displayPatch.isDuplicate,
      images: intro.images.map((img) => ({
        id: img.id,
        url: img.url,
        thumbnail_url: img.thumbnailUrl,
        is_nsfw: img.isNSFW
      })),
      bannerUrl: displayPatch.banner
    })
  }, [displayPatch, intro, setData])

  useEffect(() => {
    if (displayPatch.contentLimit !== 'nsfw') {
      return
    }

    if (isNsfwBlocked) {
      document.title = ''
      return
    }

    document.title = `${getPatchPageTitle(displayPatch)} - ${kunMoyuMoe.titleShort}`
  }, [displayPatch, isNsfwBlocked])

  const handleViewed = () => {
    setDisplayPatch((currentPatch) => ({
      ...currentPatch,
      view: currentPatch.view + 1
    }))
  }

  return (
    <div className="relative w-full mx-auto max-w-7xl">
      <PatchViewBeacon
        uniqueId={displayPatch.uniqueId}
        currentView={displayPatch.view}
        onViewed={handleViewed}
      />

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
            patch={displayPatch}
            handleClickDownloadNav={handleClickDownloadNav}
          />

          <div ref={tabsRef} className="scroll-mt-24">
            <PatchHeaderTabs
              id={displayPatch.id}
              vndbId={displayPatch.vndbId || ''}
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
