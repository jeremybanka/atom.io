import {
	type ClientResumption,
	createResumption,
	currentResumption,
	resumable as read,
} from "./client.ts"
import type { Json, ResumableOptions, Resumption } from "./types.ts"

export type * from "./client.ts"
export { createResumption, currentResumption } from "./client.ts"

export interface AstroBrowserResumption extends ClientResumption {
	readonly canResume: boolean
	invalidate(): void
	resumeWhen(check: () => boolean): () => void
	capture(): void
}
const applications = new WeakMap<Document, AstroBrowserResumption>()

/** Import a boundary's explicit prefetches and its own renderer seed. */
export function captureElement(scope: ClientResumption, element: Element): void {
	const explicit = element.closest(`astro-resumption`)
	if (explicit) scope.add(explicit)
	const seed = element.getAttribute(`data-resumability`)
	if (seed !== null) scope.add(JSON.parse(seed))
}

/** The Astro application owns ordinary browser reads, independent of a state library. */
export function browserResumption(document: Document): AstroBrowserResumption {
	let application = applications.get(document)
	if (application) return application
	const scope = createResumption()
	const checks = new Set<() => boolean>()
	const scripts = new WeakSet<Element>()
	const seeds = new WeakMap<Element, string>()
	let initial = true,
		disposed = false
	const canResume = () => initial && [...checks].every((check) => check())
	const capture = () => {
		for (const script of document.querySelectorAll(
			`script[data-resumability-page]`,
		)) {
			if (!scripts.has(script)) {
				scope.add(JSON.parse(script.textContent))
				scripts.add(script)
			}
		}
		for (const element of document.querySelectorAll(
			`[data-resumability]:not([data-resumability-private])`,
		)) {
			const payload = element.getAttribute(`data-resumability`)!
			if (seeds.get(element) !== payload) {
				scope.add(JSON.parse(payload))
				seeds.set(element, payload)
			}
		}
	}
	const invalidate = () => {
		initial = false
	}
	const pagehide = (event: PageTransitionEvent) => {
		if (!event.persisted) application!.dispose()
	}
	application = {
		...scope,
		get canResume() {
			return canResume()
		},
		invalidate,
		capture,
		resumeWhen(check) {
			checks.add(check)
			return () => {
				checks.delete(check)
			}
		},
		read(options) {
			capture()
			return scope.run(() => scope.read(options), { resume: canResume() })
		},
		run(compute, options) {
			capture()
			return scope.run(compute, options ?? { resume: canResume() })
		},
		dispose() {
			if (disposed) return
			disposed = true
			scope.dispose()
			checks.clear()
			document.removeEventListener(`astro:before-swap`, invalidate)
			document.defaultView?.removeEventListener(`pagehide`, pagehide)
			applications.delete(document)
		},
	}
	applications.set(document, application)
	document.addEventListener(`astro:before-swap`, invalidate)
	document.defaultView?.addEventListener(`pagehide`, pagehide)
	return application
}

/** Astro's compiler uses this entrypoint for unscoped browser reads. */
export function resumable<T, Wire extends Json = Json>(
	options: ResumableOptions<T, Wire>,
	scope?: Resumption,
): T | Promise<T> {
	return read(
		options,
		scope ?? currentResumption() ?? browserResumption(document),
	)
}
