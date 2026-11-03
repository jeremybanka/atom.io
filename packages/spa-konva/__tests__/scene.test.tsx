import { useValue } from "@atom.io/spa"
import { Silo } from "atom.io"
import Konva from "konva"
import { expect, it, vi } from "vitest"

import { Group, konvaRenderer, Rect } from "../src/index.ts"

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
		const read = useValue(xAtom)
		return (
			<Group>
				<Rect
					x={read()}
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
