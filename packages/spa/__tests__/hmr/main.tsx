import { render } from "@atom.io/spa"
import { threeRenderer } from "@atom.io/spa/three"

import App from "./App.tsx"
import { Scene } from "./Scene.tsx"
import {
	cleanups,
	firstCountAtom,
	firstHistoryTimeline,
	firstStore,
	parents,
	refs,
	secondCountAtom,
	secondHistoryTimeline,
	secondStore,
} from "./state.ts"

const persistentSubscribers = [
	firstStore.store.atoms.get(firstCountAtom.key)!.subject.subscribers.size,
	secondStore.store.atoms.get(secondCountAtom.key)!.subject.subscribers.size,
]
const first = render(
	() => (
		<App name="first" token={firstCountAtom} history={firstHistoryTimeline} />
	),
	document.getElementById(`first`)!,
	{ store: firstStore.store },
)
const second = render(
	() => (
		<App name="second" token={secondCountAtom} history={secondHistoryTimeline} />
	),
	document.getElementById(`second`)!,
	{ store: secondStore.store },
)
const scene = threeRenderer.render(
	() => <Scene token={firstCountAtom} />,
	parents.get(`standalone`)!,
	{ store: firstStore.store },
)
Object.assign(window, {
	hmrTest: {
		stats() {
			return {
				persistentSubscribers,
				first: firstStore.getState(firstCountAtom),
				second: secondStore.getState(secondCountAtom),
				cleanups: { ...cleanups },
				subscribers: [
					firstStore.store.atoms.get(firstCountAtom.key)!.subject.subscribers
						.size,
					secondStore.store.atoms.get(secondCountAtom.key)!.subject.subscribers
						.size,
				],
				positions: [...parents].map(([name, parent]) => [
					name,
					parent.children[0]?.position.x,
				]),
				refs: Object.entries(refs).map(([name, element]) => [
					name,
					element === document.querySelector(`[data-hmr="${name}"]`),
				]),
			}
		},
		dispose() {
			first.dispose()
			second.dispose()
			scene.dispose()
		},
	},
})
