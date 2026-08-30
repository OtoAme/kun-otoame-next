import type { ClientRect, Modifier } from '@dnd-kit/core'
import type { Transform } from '@dnd-kit/utilities'

/**
 * Clamps a drag translation so the dragged rect stays inside a boundary.
 *
 * Each axis is handled independently: a drag that leaves the boundary on one
 * side is pinned flush against that side rather than cancelled, so the pointer
 * can keep moving along the other axis. The comparison is against the current
 * translated edges, which is why the pinned value is a delta between two edges
 * rather than the boundary coordinate itself.
 */
const clampTransformToRect = (
  transform: Transform,
  rect: ClientRect,
  boundary: ClientRect
): Transform => {
  const clamped = { ...transform }

  if (rect.top + transform.y <= boundary.top) {
    clamped.y = boundary.top - rect.top
  } else if (rect.bottom + transform.y >= boundary.bottom) {
    clamped.y = boundary.bottom - rect.bottom
  }

  if (rect.left + transform.x <= boundary.left) {
    clamped.x = boundary.left - rect.left
  } else if (rect.right + transform.x >= boundary.right) {
    clamped.x = boundary.right - rect.right
  }

  return clamped
}

/**
 * Keeps a drag inside the draggable's own parent element.
 *
 * Without a modifier the active item's transform follows the pointer without a
 * bound, so a card can be dragged out of its grid — and because the surrounding
 * HeroUI Card clips its overflow, the part that left the grid is simply cut off
 * mid-drag. There is nowhere outside the grid to drop onto anyway, so the
 * boundary costs nothing.
 *
 * `containerNodeRect` is the rect of the active node's parent element, which for
 * a sortable grid is the grid itself. A drag that has not measured yet passes
 * through untouched.
 */
export const restrictToParentElement: Modifier = ({
  containerNodeRect,
  draggingNodeRect,
  transform
}) =>
  draggingNodeRect && containerNodeRect
    ? clampTransformToRect(transform, draggingNodeRect, containerNodeRect)
    : transform
