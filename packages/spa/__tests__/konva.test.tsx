import { useGetter } from "@atom.io/spa"
import { Silo } from "atom.io"
import Konva from "konva"
import { expect, it, vi } from "vitest"

import { Group, konvaRenderer, Rect } from "../src/konva.ts"

it(`updates native attrs and event handlers and removes owned nodes`, () => {
	vi.spyOn(Konva.Util, `isCanvasFarblingActive`).mockReturnValue(false)
	const silo = new Silo({
		name: `konva-test`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const xAtom = silo.atom<number>({ key: `x`, default: 10 })
	const click = vi.fn()
	let rect!: Konva.Rect
	function App() {
		const getX = useGetter(xAtom)
		return (
			<Group>
				<Rect
					x={getX()}
					width={20}
					height={30}
					onClick={click}
					ref={(node) => {
						if (node) rect = node
					}}
				/>
			</Group>
		)
	}
	const parent = new Konva.Group()
	const root = konvaRenderer.render(() => <App />, parent, { store: silo.store })
	expect(rect.x()).toBe(10)
	rect.fire(`click`)
	expect(click).toHaveBeenCalledTimes(1)
	silo.setState(xAtom, 42)
	root.flush()
	expect(rect.x()).toBe(42)
	root.dispose()
	expect(parent.getChildren()).toHaveLength(0)
	rect.fire(`click`)
	expect(click).toHaveBeenCalledTimes(1)
})

it(`routes pointer capture and transform completion with optional native events`, () => {
	vi.spyOn(Konva.Util, `isCanvasFarblingActive`).mockReturnValue(false)
	const captured = vi.fn()
	const ended = vi.fn()
	const parent = new Konva.Group()
	const root = konvaRenderer.render(
		() => (
			<Rect
				onGotPointerCapture={(event) => {
					captured(event.evt.pointerId, event.currentTarget)
				}}
				onTransformEnd={(event) => {
					ended(event.evt?.type, event.currentTarget)
				}}
			/>
		),
		parent,
	)
	const rect = parent.getChildren()[0]
	try {
		rect.fire(`gotpointercapture`, {
			evt: new PointerEvent(`gotpointercapture`, { pointerId: 42 }),
		})
		expect(captured).toHaveBeenCalledExactlyOnceWith(42, rect)
		rect.fire(`transformend`, { evt: new MouseEvent(`mouseup`) })
		expect(ended).toHaveBeenLastCalledWith(`mouseup`, rect)
		rect.fire(`transformend`, { evt: undefined })
		expect(ended).toHaveBeenLastCalledWith(undefined, rect)
		expect(ended).toHaveBeenCalledTimes(2)
	} finally {
		root.dispose()
	}
})
