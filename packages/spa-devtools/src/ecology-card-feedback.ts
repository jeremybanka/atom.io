import type { FutureActivity } from "atom.io/introspection"

import kablooey from "./assets/kablooey.gif"

const CYCLE_MS = 1_000
const WINDBACK_MS = 500
const EXPLOSION_MS = 1_700
let explosionSerial = 0

interface CardFeedback {
	future(
		pending: boolean,
		caught: boolean,
		events?: ReadonlySet<FutureActivity>,
	): void
	error(caught: boolean, animate: boolean): void
	dispose(): void
}

export function createCardFeedback(
	button: HTMLButtonElement,
	reducedMotion: MediaQueryList,
): CardFeedback {
	const view = button.ownerDocument.defaultView!
	let phase: `loading` | `windback` | `done` | undefined
	let phaseTimer: number | undefined
	let indicator: HTMLSpanElement | undefined
	let pending = false
	let windback = false
	let successful = false
	const show = (next: typeof phase) => {
		phase = next
		if (next) {
			if (!indicator) {
				const document = button.ownerDocument
				indicator = document.createElement(`span`)
				indicator.dataset[`futureIndicator`] = ``
				indicator.setAttribute(`aria-hidden`, `true`)
				const loading = document.createElement(`span`)
				loading.dataset[`loadingGlyph`] = ``
				const done = document.createElement(`span`)
				done.dataset[`doneGlyph`] = ``
				done.textContent = `✓`
				indicator.append(loading, done)
				button.append(indicator)
			}
			button.dataset[`future`] = next
			button.setAttribute(
				`aria-description`,
				next === `done`
					? `Load complete`
					: next === `windback`
						? `Load restarted`
						: `Loading`,
			)
		} else {
			indicator?.remove()
			indicator = undefined
			delete button.dataset[`future`]
			button.removeAttribute(`aria-description`)
		}
	}
	const hold = (duration: number, next: () => void) => {
		phaseTimer = view.setTimeout(() => {
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
		else if (successful) {
			show(`done`)
			hold(CYCLE_MS, () => {
				show(undefined)
			})
		} else show(undefined)
	}
	let explosion: HTMLImageElement | undefined
	let explosionTimer: number | undefined
	const clearExplosion = () => {
		view.clearTimeout(explosionTimer)
		explosion?.remove()
		explosion = undefined
		button.style.removeProperty(`--ecology-explosion-duration`)
	}
	return {
		future(
			nextPending: boolean,
			caught: boolean,
			events?: ReadonlySet<FutureActivity>,
		): void {
			const started =
				events?.has(`started`) === true || (nextPending && !pending)
			const resolved = events?.has(`resolved`) === true
			const settled = resolved || (pending && !nextPending)
			pending = nextPending
			if (started) {
				view.clearTimeout(phaseTimer)
				windback = false
				successful = false
				show(`loading`)
				hold(CYCLE_MS, advance)
			}
			if (
				events?.has(`replaced`) &&
				(phase === `loading` || phase === `windback`)
			)
				windback = true
			if (settled) successful = resolved && !caught && !events?.has(`rejected`)
			if (phaseTimer === undefined && phase === `loading`) advance()
		},
		error(caught: boolean, animate: boolean): void {
			clearExplosion()
			if (!caught) {
				delete button.dataset[`caught`]
				return
			}
			button.dataset[`caught`] = `true`
			if (!animate || reducedMotion.matches) return
			const image = button.ownerDocument.createElement(`img`)
			explosion = image
			image.alt = ``
			image.dataset[`explosion`] = ``
			button.dataset[`caught`] = `burst`
			const finish = () => {
				if (explosion !== image) return
				clearExplosion()
				button.dataset[`caught`] = `true`
			}
			image.addEventListener(
				`load`,
				() => {
					if (explosion !== image) return
					button.style.setProperty(
						`--ecology-explosion-duration`,
						`${EXPLOSION_MS}ms`,
					)
					button.dataset[`caught`] = `revealing`
					explosionTimer = view.setTimeout(finish, EXPLOSION_MS)
				},
				{ once: true },
			)
			image.addEventListener(`error`, finish, { once: true })
			image.src = `${kablooey}#${++explosionSerial}`
			button.append(image)
		},
		dispose(): void {
			view.clearTimeout(phaseTimer)
			indicator?.remove()
			clearExplosion()
		},
	}
}
