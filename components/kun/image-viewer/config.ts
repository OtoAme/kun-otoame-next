import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import Download from 'yet-another-react-lightbox/plugins/download'
import type { LightboxExternalProps } from 'yet-another-react-lightbox'

/**
 * Shared configuration for Lightbox components
 * Ensures consistency between AutoImageViewer and explicit ImageViewer
 */
export const lightboxConfig: Partial<LightboxExternalProps> = {
  plugins: [Zoom, Download],
  animation: { fade: 300 },
  carousel: {
    finite: true,
    preload: 2,
    imageProps: {
      style: {
        maxWidth: 'none',
        maxHeight: 'none',
        width: '80%',
        height: '80%',
        objectFit: 'contain'
      }
    }
  },
  zoom: {
    maxZoomPixelRatio: 3,
    scrollToZoom: true
  },
  controller: {
    closeOnBackdropClick: true,
    closeOnPullUp: false,
    closeOnPullDown: false
  },
  styles: {
    container: { backgroundColor: 'rgba(0, 0, 0, .7)' }
  }
}
