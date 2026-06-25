import { type ReadableToken, Silo, type WritableToken } from "atom.io"
import { animateMini as animateControls } from "motion"
import type { VNode } from "preact"
import * as React from "react"

import {
	type LazinessObservation,
	type ObservedSelectorGraphEdge,
	observeLaziness,
} from "./understand-atom-light-observers"
import {
	createUnderstandAtomLazinessScene,
	type LazinessActivity,
	type LazinessCacheState,
	type LazinessSceneState,
	type UnderstandAtomLazinessScene,
} from "./understand-atom-sandbox-three"
import css from "./UnderstandAtomSandbox.module.css"

export type UnderstandAtomSandboxProps = {
	concept: `laziness`
}

type LazinessRuntime = {
	countAtom: WritableToken<number>
	doubledSelector: ReadableToken<number>
	metrics: {
		computeCount: number
	}
	silo: Silo
}

function prefersReducedMotion(): boolean {
	return matchMedia(`(prefers-reduced-motion: reduce)`).matches
}

function createLazinessRuntime(): LazinessRuntime {
	const metrics = { computeCount: 0 }
	const silo = new Silo({
		name: `understand-laziness-${Math.random().toString(36).slice(2)}`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const countAtom = silo.atom<number>({
		key: `count`,
		default: 0,
	})
	const doubledSelector = silo.selector<number>({
		key: `doubled`,
		get: ({ get }) => {
			metrics.computeCount++
			return get(countAtom) * 2
		},
	})
	return { countAtom, doubledSelector, metrics, silo }
}

function observeRuntime(runtime: LazinessRuntime): LazinessObservation {
	return observeLaziness({
		computeCount: runtime.metrics.computeCount,
		countAtom: runtime.countAtom,
		doubledSelector: runtime.doubledSelector,
		store: runtime.silo.store,
	})
}

function cacheStateFromObservation(
	observation: LazinessObservation,
): LazinessCacheState {
	if (observation.doubled.cache.status === `cached`) {
		return `fresh`
	}
	if (
		observation.selectorGraph.length > 0 ||
		observation.selectorRoots.length > 0
	) {
		return `evicted`
	}
	return `empty`
}

function didInvalidateSelectorCache(
	before: LazinessObservation,
	after: LazinessObservation,
): boolean {
	return (
		before.doubled.cache.status === `cached` &&
		before.selectorRoots.includes(before.count.key) &&
		(after.doubled.cache.status === `missing` ||
			after.computeCount > before.computeCount)
	)
}

function createSceneState(
	observation: LazinessObservation,
	activity: Pick<LazinessSceneState, `activity` | `activityId`> & {
		cacheInvalidated?: boolean
	},
): LazinessSceneState {
	return {
		...activity,
		cacheInvalidated: activity.cacheInvalidated ?? false,
		cacheState: cacheStateFromObservation(observation),
		computeCount: observation.computeCount,
		count:
			observation.count.cache.status === `cached`
				? observation.count.cache.value
				: 0,
		doubled:
			observation.doubled.cache.status === `cached`
				? observation.doubled.cache.value
				: null,
		rootObserverKeys: observation.rootObserverKeys,
		selectorGraph: observation.selectorGraph,
		selectorObserverKeys: observation.doubled.subscriberKeys,
		selectorRoots: observation.selectorRoots,
		subscribed:
			observation.doubled.subscriberKeys.includes(`understand-laziness`),
	}
}

function createInitialSceneState(runtime: LazinessRuntime): LazinessSceneState {
	runtime.silo.getState(runtime.countAtom)
	return createSceneState(observeRuntime(runtime), {
		activity: `idle`,
		activityId: 0,
	})
}

function doubledBadgeValue(
	cacheState: LazinessCacheState,
	doubled: null | number,
): string {
	if (cacheState === `fresh`) {
		return String(doubled ?? 0)
	}
	return cacheState
}

function graphBadgeValue(edges: readonly ObservedSelectorGraphEdge[]): string {
	if (edges.length === 0) {
		return `empty`
	}
	return edges
		.map(({ selectorKey, sourceKey }) => `${sourceKey} -> ${selectorKey}`)
		.join(`, `)
}

function listBadgeValue(values: readonly string[], empty: string): string {
	return values.length > 0 ? values.join(`, `) : empty
}

export function UnderstandAtomSandbox({
	concept,
}: UnderstandAtomSandboxProps): VNode {
	const runtimeRef = React.useRef<LazinessRuntime | null>(null)
	runtimeRef.current ??= createLazinessRuntime()
	const runtime = runtimeRef.current

	const hostRef = React.useRef<HTMLElement | null>(null)
	const stageRef = React.useRef<HTMLElement | null>(null)
	const controlsRef = React.useRef<HTMLElement | null>(null)
	const sceneRef = React.useRef<UnderstandAtomLazinessScene | null>(null)
	const unsubscribeRef = React.useRef<null | (() => void)>(null)
	const activityIdRef = React.useRef(0)
	const [sceneState, setSceneState] = React.useState(() =>
		createInitialSceneState(runtime),
	)

	const nextActivity = React.useCallback(
		(
			activity: LazinessActivity,
		): Pick<LazinessSceneState, `activity` | `activityId`> => {
			activityIdRef.current++
			return { activity, activityId: activityIdRef.current }
		},
		[],
	)

	React.useEffect(() => {
		const host = hostRef.current
		const stage = stageRef.current
		if (!host || !stage) {
			return
		}

		const scene = createUnderstandAtomLazinessScene(host, stage, sceneState, {
			reducedMotion: prefersReducedMotion(),
		})
		sceneRef.current = scene
		return () => {
			sceneRef.current = null
			scene.dispose()
		}
	}, [])

	React.useEffect(() => {
		sceneRef.current?.update(sceneState)
	}, [sceneState])

	React.useEffect(() => {
		const controls = controlsRef.current
		if (!controls || prefersReducedMotion()) {
			return
		}
		const controlsAnimation = animateControls(
			controls,
			{ opacity: [0, 1], transform: [`translateY(6px)`, `translateY(0)`] },
			{ duration: 0.28, ease: `easeOut` },
		)
		return () => {
			controlsAnimation.stop()
		}
	}, [])

	React.useEffect(() => {
		return () => {
			unsubscribeRef.current?.()
		}
	}, [])

	const handleIncrement = () => {
		const before = observeRuntime(runtime)
		runtime.silo.setState(runtime.countAtom, (count) => count + 1)
		const after = observeRuntime(runtime)
		setSceneState(
			createSceneState(after, {
				...nextActivity(`increment`),
				cacheInvalidated: didInvalidateSelectorCache(before, after),
			}),
		)
	}

	const handleRead = () => {
		runtime.silo.getState(runtime.doubledSelector)
		setSceneState(
			createSceneState(observeRuntime(runtime), nextActivity(`read`)),
		)
	}

	const handleToggleSubscription = () => {
		if (unsubscribeRef.current) {
			unsubscribeRef.current()
			unsubscribeRef.current = null
			setSceneState(
				createSceneState(observeRuntime(runtime), nextActivity(`unsubscribe`)),
			)
			return
		}

		unsubscribeRef.current = runtime.silo.subscribe(
			runtime.doubledSelector,
			() => undefined,
			`understand-laziness`,
		)
		setSceneState(
			createSceneState(observeRuntime(runtime), nextActivity(`subscribe`)),
		)
	}

	return (
		<understand-atom-sandbox class={css.class} data-concept={concept}>
			<back-fill />
			<sandbox-header>
				<span>laziness sandbox</span>
				<sandbox-badges>
					<sandbox-badge>
						<span>count</span>
						<strong>{sceneState.count}</strong>
					</sandbox-badge>
					<sandbox-badge>
						<span>doubled</span>
						<strong>
							{doubledBadgeValue(sceneState.cacheState, sceneState.doubled)}
						</strong>
					</sandbox-badge>
					<sandbox-badge>
						<span>computes</span>
						<strong>{sceneState.computeCount}</strong>
					</sandbox-badge>
				</sandbox-badges>
			</sandbox-header>
			<sandbox-stage
				ref={stageRef}
				aria-label="Interactive laziness flowchart"
				tabIndex={0}
			>
				<sandbox-canvas ref={hostRef} aria-hidden="true" />
				<sandbox-scroll-spacer aria-hidden="true" />
			</sandbox-stage>
			<sandbox-inspector>
				<sandbox-badge>
					<span>selectorGraph</span>
					<strong>{graphBadgeValue(sceneState.selectorGraph)}</strong>
				</sandbox-badge>
				<sandbox-badge>
					<span>selectorAtoms</span>
					<strong>{listBadgeValue(sceneState.selectorRoots, `empty`)}</strong>
				</sandbox-badge>
				<sandbox-badge>
					<span>observers</span>
					<strong>{listBadgeValue(sceneState.rootObserverKeys, `none`)}</strong>
				</sandbox-badge>
			</sandbox-inspector>
			<sandbox-controls ref={controlsRef}>
				<button title="Increment count" type="button" onClick={handleIncrement}>
					+ count
				</button>
				<button title="Read doubled" type="button" onClick={handleRead}>
					read doubled
				</button>
				<button
					aria-pressed={sceneState.subscribed}
					title={sceneState.subscribed ? `Unsubscribe` : `Subscribe`}
					type="button"
					onClick={handleToggleSubscription}
				>
					{sceneState.subscribed ? `unsubscribe` : `subscribe`}
				</button>
			</sandbox-controls>
		</understand-atom-sandbox>
	)
}
