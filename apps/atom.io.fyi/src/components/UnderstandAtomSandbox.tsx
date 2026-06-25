import { type ReadableToken, Silo, type WritableToken } from "atom.io"
import { animateMini as animateControls } from "motion"
import type { VNode } from "preact"
import * as React from "react"

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
	store: Silo
}

function prefersReducedMotion(): boolean {
	return matchMedia(`(prefers-reduced-motion: reduce)`).matches
}

function createLazinessRuntime(): LazinessRuntime {
	const metrics = { computeCount: 0 }
	const store = new Silo({
		name: `understand-laziness-${Math.random().toString(36).slice(2)}`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const countAtom = store.atom<number>({
		key: `count`,
		default: 0,
	})
	const doubledSelector = store.selector<number>({
		key: `doubled`,
		get: ({ get }) => {
			metrics.computeCount++
			return get(countAtom) * 2
		},
	})
	return { countAtom, doubledSelector, metrics, store }
}

function createInitialSceneState(runtime: LazinessRuntime): LazinessSceneState {
	return {
		activity: `idle`,
		activityId: 0,
		cacheState: `empty`,
		computeCount: runtime.metrics.computeCount,
		count: runtime.store.getState(runtime.countAtom),
		doubled: null,
		subscribed: false,
	}
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
		runtime.store.setState(runtime.countAtom, (count) => count + 1)
		const count = runtime.store.getState(runtime.countAtom)
		setSceneState((prev) => {
			const cacheState = prev.subscribed
				? `fresh`
				: prev.cacheState === `empty`
					? `empty`
					: `evicted`
			return {
				...prev,
				...nextActivity(`increment`),
				cacheState,
				computeCount: runtime.metrics.computeCount,
				count,
			}
		})
	}

	const handleRead = () => {
		const doubled = runtime.store.getState(runtime.doubledSelector)
		setSceneState((prev) => ({
			...prev,
			...nextActivity(`read`),
			cacheState: `fresh`,
			computeCount: runtime.metrics.computeCount,
			count: runtime.store.getState(runtime.countAtom),
			doubled,
		}))
	}

	const handleToggleSubscription = () => {
		if (unsubscribeRef.current) {
			unsubscribeRef.current()
			unsubscribeRef.current = null
			setSceneState((prev) => ({
				...prev,
				...nextActivity(`unsubscribe`),
				computeCount: runtime.metrics.computeCount,
				count: runtime.store.getState(runtime.countAtom),
				subscribed: false,
			}))
			return
		}

		unsubscribeRef.current = runtime.store.subscribe(
			runtime.doubledSelector,
			({ newValue }) => {
				setSceneState((prev) => ({
					...prev,
					...nextActivity(`increment`),
					cacheState: `fresh`,
					computeCount: runtime.metrics.computeCount,
					count: runtime.store.getState(runtime.countAtom),
					doubled: newValue,
					subscribed: true,
				}))
			},
			`understand-laziness`,
		)
		const doubled = runtime.store.getState(runtime.doubledSelector)
		setSceneState((prev) => ({
			...prev,
			...nextActivity(`subscribe`),
			cacheState: `fresh`,
			computeCount: runtime.metrics.computeCount,
			count: runtime.store.getState(runtime.countAtom),
			doubled,
			subscribed: true,
		}))
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
