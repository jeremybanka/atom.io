import type { Subject } from "atom.io/foundations/subject"

const observerErrorCollectors: unknown[][] = []

export function captureObserverError(error: unknown): void {
	observerErrorCollectors.at(-1)!.push(error)
}

export function isCollectingObserverErrors(): boolean {
	return observerErrorCollectors.length > 0
}

export function collectObserverErrors<T>(run: () => T): {
	errors: unknown[]
	value: T
} {
	const errors: unknown[] = []
	observerErrorCollectors.push(errors)
	try {
		return { errors, value: run() }
	} finally {
		observerErrorCollectors.pop()
	}
}

export function notifySubjectSubscribers<T>(
	subject: Subject<T>,
	value: T,
	shouldNotify: (key: string, subscriber: (value: T) => void) => boolean = () =>
		true,
): void {
	if (!isCollectingObserverErrors()) {
		for (const [key, subscriber] of subject.subscribers) {
			if (shouldNotify(key, subscriber)) subscriber(value)
		}
		return
	}
	for (const [key, subscriber] of subject.subscribers) {
		if (!shouldNotify(key, subscriber)) continue
		try {
			subscriber(value)
		} catch (error) {
			captureObserverError(error)
		}
	}
}
