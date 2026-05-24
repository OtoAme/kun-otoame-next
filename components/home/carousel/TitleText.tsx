const TITLE_PART_RE = /(\s*・\s*|[A-Za-z0-9][A-Za-z0-9.,:;!?'"()[\]{}+/#&@-]*)/g

interface Props {
  title: string
}

export const KunCarouselTitleText = ({ title }: Props) =>
  title.split(TITLE_PART_RE).map((part, index) => {
    if (!part) {
      return null
    }

    if (part.includes('・')) {
      return (
        <span
          aria-hidden="true"
          className="kun-home-carousel-title-separator"
          key={`${part}-${index}`}
        >
          ·
        </span>
      )
    }

    if (/^[A-Za-z0-9]/.test(part)) {
      return (
        <span
          className="kun-home-carousel-title-latin"
          key={`${part}-${index}`}
        >
          {part}
        </span>
      )
    }

    return <span key={`${part}-${index}`}>{part}</span>
  })
