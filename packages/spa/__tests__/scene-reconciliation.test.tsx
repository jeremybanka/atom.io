import { Silo } from "atom.io"
import Konva from "konva"
import * as THREE from "three"
import { expect, it, vi } from "vitest"

import { useGetter } from "../src/index.ts"
import { jsx } from "../src/jsx-runtime.ts"
import { konvaRenderer, Rect } from "../src/konva.ts"
import { createSceneRenderer, sceneComponent } from "../src/renderer.ts"
import { Group, threeRenderer } from "../src/three.ts"

it.each([true, false])(
	`does not resync unchanged scene child lists (wrapped: %s)`,
	(wrapped) => {
		const silo = new Silo({
			name: `scene-list`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const idsAtom = silo.atom<number[]>({
			key: `ids`,
			default: Array.from({ length: 100 }, (_, index) => index),
		})
		const revisionAtom = silo.atom<number>({ key: `revision`, default: 0 })
		type Node = { children: Node[]; x?: number }
		const children = vi.fn((parent: Node, nodes: Node[]) => {
			parent.children = nodes
		})
		const renderer = createSceneRenderer<Node>({
			create: () => ({ children: [] }),
			update(node, props) {
				node.x = props[`x`]
			},
			children,
			destroy() {},
		})
		const Item = wrapped ? sceneComponent<{ x: number }>(`item`) : `item`
		const parent: Node = { children: [] }
		const root = renderer.render(
			() => {
				const getIds = useGetter(idsAtom)
				const getRevision = useGetter(revisionAtom)
				return jsx(`group`, {
					children: () =>
						getIds().map((id) =>
							jsx(Item, { key: id, x: id === getRevision() ? 1 : 0 }),
						),
				})
			},
			parent,
			{ store: silo.store },
		)
		const group = parent.children[0]
		const original = [...group.children]
		try {
			children.mockClear()
			silo.setState(revisionAtom, 1)
			root.flush()
			expect(children).not.toHaveBeenCalled()
			expect(group.children[1].x).toBe(1)
			expect(group.children[0].x).toBe(0)
			silo.setState(idsAtom, (ids) => [...ids].reverse())
			root.flush()
			expect(children).toHaveBeenCalledExactlyOnceWith(
				group,
				[...original].reverse(),
				[...original].reverse(),
			)
			children.mockClear()
			silo.setState(idsAtom, [101, 102, 103])
			root.flush()
			expect(
				children.mock.calls.filter(([node]) => node === group),
			).toHaveLength(1)
		} finally {
			root.dispose()
		}
	},
)

it.each([`konva`, `three`] as const)(
	`keeps unchanged %s child arrays intact and restacks reorders once`,
	(engine) => {
		const silo = new Silo({
			name: engine,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const idsAtom = silo.atom<number[]>({ key: `ids`, default: [1, 2, 3] })
		const revisionAtom = silo.atom<number>({ key: `revision`, default: 0 })
		const placeholderAtom = silo.atom<boolean>({
			key: `placeholder`,
			default: false,
		})
		const farbling = vi
			.spyOn(Konva.Util, `isCanvasFarblingActive`)
			.mockReturnValue(false)
		const autoDraw = Konva.autoDrawEnabled
		Konva.autoDrawEnabled = false
		const parent = engine === `konva` ? new Konva.Group() : new THREE.Group()
		const root =
			engine === `konva`
				? konvaRenderer.render(
						() => {
							const getIds = useGetter(idsAtom),
								getRevision = useGetter(revisionAtom),
								getPlaceholder = useGetter(placeholderAtom)
							return () => [
								getPlaceholder() ? null : false,
								...getIds().map((id) => (
									<Rect key={id} x={getRevision() === id ? 1 : 0} />
								)),
							]
						},
						parent as Konva.Group,
						{ store: silo.store },
					)
				: threeRenderer.render(
						() => {
							const getIds = useGetter(idsAtom),
								getRevision = useGetter(revisionAtom),
								getPlaceholder = useGetter(placeholderAtom)
							return () => [
								getPlaceholder() ? null : false,
								...getIds().map((id) => (
									<Group
										key={id}
										position={[getRevision() === id ? 1 : 0, 0, 0]}
									/>
								)),
							]
						},
						parent as THREE.Group,
						{ store: silo.store },
					)
		const original = [...parent.children]
		const array = parent.children
		const splice = vi.spyOn(array, `splice`)
		const renumber =
			engine === `konva`
				? vi.spyOn(parent as Konva.Group, `_setChildrenIndices`)
				: undefined
		const zIndices =
			engine === `konva`
				? original.map((child) => vi.spyOn(child as Konva.Node, `zIndex`))
				: []
		try {
			silo.setState(revisionAtom, 1)
			root.flush()
			silo.setState(placeholderAtom, true)
			root.flush()
			expect(parent.children).toBe(array)
			expect(splice).not.toHaveBeenCalled()
			expect(renumber?.mock.calls.length ?? 0).toBe(0)
			silo.setState(idsAtom, [3, 1, 2])
			root.flush()
			expect([...parent.children]).toEqual([
				original[2],
				original[0],
				original[1],
			])
			if (engine === `konva`) {
				expect(renumber).toHaveBeenCalledOnce()
				for (const spy of zIndices) expect(spy).not.toHaveBeenCalled()
				expect(
					(parent as Konva.Group).children.map((child) => child.index),
				).toEqual([0, 1, 2])
			} else expect(splice).toHaveBeenCalledOnce()
		} finally {
			for (const spy of zIndices) spy.mockRestore()
			renumber?.mockRestore()
			splice.mockRestore()
			root.dispose()
			Konva.autoDrawEnabled = autoDraw
			farbling.mockRestore()
		}
	},
)
