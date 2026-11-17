import { render, useGetter } from "@atom.io/spa"
import { jsx } from "@atom.io/spa/jsx-runtime"
import { Silo } from "atom.io"
import { afterEach, expect, it, vi } from "vitest"

import { createGraphContext } from "../src/ecology-graph.ts"
import type { EcologyScene } from "../src/EcologyScene.tsx"
import { EcologyViewport } from "../src/EcologyViewport.tsx"
import { useTools } from "../src/store.ts"

type Props = Parameters<typeof EcologyViewport>[0]
type SceneModule = { EcologyScene: typeof EcologyScene }
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.doUnmock(`../src/EcologyScene.tsx`)
	document.body.replaceChildren()
})

function fixture() {
	let resolve!: (module: SceneModule) => void, reject!: (error: Error) => void
	vi.doMock(
		`../src/EcologyScene.tsx`,
		() =>
			new Promise<SceneModule>((yes, no) => {
				resolve = yes
				reject = no
			}),
	)
	const silo = new Silo({
		name: `viewport`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const workspaceAtom = silo.atom<string>({ key: `workspace`, default: `graph` })
	const scene = vi.fn((props: Props) =>
		jsx(`ecology-scene`, {
			get "data-workspace"() {
				return props.workspace
			},
		}),
	)
	const host = document.createElement(`main`)
	document.body.append(host)
	const root = render(
		() => {
			const getWorkspace = useGetter(workspaceAtom)
			return jsx(EcologyViewport, {
				tools: useTools(silo.store),
				context: createGraphContext(),
				cylinderHeight: 8,
				slots: 0,
				generation: 0,
				card: () => {
					throw new Error(`no cards`)
				},
				visible: () => false,
				items: [],
				edges: [],
				traced: new Set<string>(),
				command: { sequence: 0, action: `fit` },
				get workspace() {
					return getWorkspace()
				},
			})
		},
		host,
		{ store: silo.store },
	)
	cleanups.push(root.dispose)
	return {
		root,
		host,
		scene,
		load: async () => {
			await vi.waitFor(() => {
				expect(resolve).toBeDefined()
			})
			resolve({ EcologyScene: scene })
			await vi.dynamicImportSettled()
			root.flush()
		},
		fail: async () => {
			await vi.waitFor(() => {
				expect(reject).toBeDefined()
			})
			reject(new Error(`offline`))
			await vi.dynamicImportSettled()
			root.flush()
		},
		workspace: (value: string) => {
			silo.setState(workspaceAtom, value)
			root.flush()
		},
	}
}

it(`loads graphics on mount and forwards reactive props without remounting the scene`, async () => {
	const f = fixture()
	expect(f.host.textContent).toContain(`Loading graph`)
	expect(f.host.querySelector(`[aria-busy=true]`)).not.toBeNull()
	await f.load()
	expect(f.host.querySelector(`[aria-busy]`)).toBeNull()
	expect(
		f.host.querySelector(`ecology-scene`)?.getAttribute(`data-workspace`),
	).toBe(`graph`)
	f.workspace(`list`)
	expect(
		f.host.querySelector(`ecology-scene`)?.getAttribute(`data-workspace`),
	).toBe(`list`)
	expect(f.scene).toHaveBeenCalledOnce()
})
it(`keeps module load failures local to the graph`, async () => {
	const f = fixture()
	await f.fail()
	expect(f.host.textContent).toContain(
		`3D view unavailable. Use the accessible node list below.`,
	)
	expect(f.host.querySelector(`[aria-busy]`)).toBeNull()
	expect(f.scene).not.toHaveBeenCalled()
})
it.each([`load`, `fail`] as const)(
	`ignores a late %s after disposal`,
	async (finish) => {
		const f = fixture()
		f.root.dispose()
		await f[finish]()
		expect(f.host.childNodes).toHaveLength(0)
		expect(f.scene).not.toHaveBeenCalled()
	},
)
