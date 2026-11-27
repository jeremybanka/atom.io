import type { FutureActivity } from "atom.io/introspection"

const CYCLE_MS = 1_000
const WINDBACK_MS = 500
// The strip preserves the supplied GIF's composited frames and timing.
export const EXPLOSION_FRAMES = 17
export const EXPLOSION_MS = EXPLOSION_FRAMES * 100

export type CardFeedbackState = {
	future: `loading` | `windback` | `done` | `complete` | undefined
	caught:
		| { phase: `true` }
		| { phase: `burst` | `revealing`; replay: number }
		| undefined
}

interface CardFeedback {
	future(
		pending: boolean,
		completed: boolean,
		events?: ReadonlySet<FutureActivity>,
	): void
	error(caught: boolean, animate: boolean): void
	imageLoaded(replay: number): void
	finishError(replay: number): void
	dispose(): void
}

export function createCardFeedback(
	clock: Pick<Window, `setTimeout` | `clearTimeout`>,
	reducedMotion: MediaQueryList,
	onChange: (state: CardFeedbackState) => void,
): CardFeedback {
	let state: CardFeedbackState = { future: undefined, caught: undefined }
	let phaseTimer: number | undefined
	let pending = false
	let windback = false
	let completed = false
	const show = (future: CardFeedbackState[`future`]) => {
		if (state.future === future) return
		state = { ...state, future }
		onChange(state)
	}
	const hold = (duration: number, next: () => void) => {
		phaseTimer = clock.setTimeout(() => {
			phaseTimer = undefined
			next()
		}, duration)
	}
	const advance = () => {
		if (windback) {
			windback = false
			show(`windback`)
			hold(WINDBACK_MS, advance)
		} else if (pending) show(`loading`)
		else if (completed) {
			show(`done`)
			hold(CYCLE_MS, () => {
				show(`complete`)
			})
		} else show(undefined)
	}
	let lastReplay = 0
	let explosionTimer: number | undefined
	const showError = (caught: CardFeedbackState[`caught`]) => {
		state = { ...state, caught }
		onChange(state)
	}
	const finishError = (replay: number) => {
		const { caught } = state
		if (!caught || caught.phase === `true` || caught.replay !== replay) return
		clock.clearTimeout(explosionTimer)
		showError({ phase: `true` })
	}
	return {
		future(
			nextPending: boolean,
			nextCompleted: boolean,
			events?: ReadonlySet<FutureActivity>,
		): void {
			const started =
				events?.has(`started`) === true || (nextPending && !pending)
			pending = nextPending
			completed = nextCompleted
			if (started) {
				clock.clearTimeout(phaseTimer)
				windback = false
				show(`loading`)
				hold(CYCLE_MS, advance)
			}
			if (
				events?.has(`replaced`) &&
				(state.future === `loading` || state.future === `windback`)
			)
				windback = true
			if (phaseTimer === undefined && state.future === `loading`) advance()
			else if (!state.future && completed) {
				if (events?.has(`resolved`)) advance()
				else show(`complete`)
			} else if (
				!completed &&
				(state.future === `done` || state.future === `complete`)
			) {
				clock.clearTimeout(phaseTimer)
				phaseTimer = undefined
				show(undefined)
			}
		},
		error(caught: boolean, animate: boolean): void {
			clock.clearTimeout(explosionTimer)
			if (!caught) showError(undefined)
			else if (!animate || reducedMotion.matches) showError({ phase: `true` })
			else showError({ phase: `burst`, replay: ++lastReplay })
		},
		imageLoaded(replay: number): void {
			const { caught } = state
			if (caught?.phase !== `burst` || caught.replay !== replay) return
			if (reducedMotion.matches) {
				finishError(replay)
				return
			}
			showError({ phase: `revealing`, replay })
			// Finish if the stylesheet does not dispatch an animation event.
			explosionTimer = clock.setTimeout(() => {
				finishError(replay)
			}, EXPLOSION_MS + 100)
		},
		finishError,
		dispose(): void {
			clock.clearTimeout(phaseTimer)
			clock.clearTimeout(explosionTimer)
			state = { future: undefined, caught: undefined }
		},
	}
}
