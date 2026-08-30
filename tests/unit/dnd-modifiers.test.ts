import { describe, expect, it } from 'vitest'
import type { ClientRect, Modifier } from '@dnd-kit/core'
import { restrictToParentElement } from '~/utils/dndModifiers'

type ModifierArguments = Parameters<Modifier>[0]

const rect = (
  left: number,
  top: number,
  width: number,
  height: number
): ClientRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height
})

/** The grid a submission gallery card is dragged inside. */
const container = rect(0, 0, 400, 300)
/** The second card of the first row, so there is room to clamp on every side. */
const card = rect(100, 0, 100, 100)

const args = (
  overrides: Partial<ModifierArguments> = {}
): ModifierArguments => ({
  activatorEvent: null,
  active: null,
  activeNodeRect: null,
  draggingNodeRect: null,
  containerNodeRect: null,
  over: null,
  overlayNodeRect: null,
  scrollableAncestors: [],
  scrollableAncestorRects: [],
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
  windowRect: null,
  ...overrides
})

const drag = (x: number, y: number) =>
  restrictToParentElement(
    args({
      containerNodeRect: container,
      draggingNodeRect: card,
      transform: { x, y, scaleX: 1, scaleY: 1 }
    })
  )

describe('restrictToParentElement', () => {
  it('leaves a drag that stays inside the parent alone', () => {
    expect(drag(50, 50)).toEqual({ x: 50, y: 50, scaleX: 1, scaleY: 1 })
  })

  it('pins the card against the edge it was dragged past', () => {
    // Left: the card starts 100px in, so that is as far left as it can travel.
    expect(drag(-200, 0).x).toBe(-100)
    // Right: 400 - 200, the gap between the card's right edge and the grid's.
    expect(drag(300, 0).x).toBe(200)
    expect(drag(0, -50).y).toBe(0)
    expect(drag(0, 400).y).toBe(200)
  })

  it('clamps both axes of the same drag independently', () => {
    expect(drag(-200, 400)).toEqual({
      x: -100,
      y: 200,
      scaleX: 1,
      scaleY: 1
    })
  })

  it('keeps the scale the sortable strategy asked for', () => {
    const scaled = restrictToParentElement(
      args({
        containerNodeRect: container,
        draggingNodeRect: card,
        transform: { x: -200, y: 0, scaleX: 0.5, scaleY: 2 }
      })
    )
    expect(scaled).toEqual({ x: -100, y: 0, scaleX: 0.5, scaleY: 2 })
  })

  it('passes the transform through before both rects are measured', () => {
    const transform = { x: 999, y: 999, scaleX: 1, scaleY: 1 }
    expect(
      restrictToParentElement(args({ containerNodeRect: container, transform }))
    ).toBe(transform)
    expect(
      restrictToParentElement(args({ draggingNodeRect: card, transform }))
    ).toBe(transform)
  })
})
