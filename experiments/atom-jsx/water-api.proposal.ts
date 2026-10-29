/**
 * Design declarations only. These functions have no implementation or runtime exports.
 * The current JSX transform can typecheck the exhibit but cannot make its reads reactive.
 */
import type {
	ReadableToken,
	RegularAtomToken,
	Setter,
	TimelineToken,
	ViewOf,
	WritableToken,
} from "atom.io"
import type { RootStore } from "atom.io/internal"

import type { Child } from "./runtime.ts"

/** Reads live state. Records a dependency only inside a water DOM computation. */
export type Accessor<T> = () => T

/** Captures the current owner's store and the supplied token during setup. */
export declare function useValue<T, E = never>(
	token: ReadableToken<T, any, E>,
): Accessor<ViewOf<T | E>>

/** Writes through atom.io. No local state or mirrored signal is created. */
export declare function useSetter<T>(
	token: WritableToken<T, any, any>,
): (value: T | Setter<T>) => void

/** Proposed starting shape, retaining the existing atom.io timeline controls. */
export interface TimelineValue {
	readonly at: number
	readonly length: number
	undo(): void
	redo(): void
	clear(): void
	undoTransaction?: () => void
	redoTransaction?: () => void
}

/** Reads track timeline changes; commands operate on the owner's store. */
export declare function useTimeline<M>(
	token: TimelineToken<M>,
): Accessor<TimelineValue>

/** Stable per allocation in an instance; root identity must match during hydration. */
export declare function useId(): string

/** Publish on attach; clear on detach only if this attachment still owns the ref. */
export declare function useRef<E extends Element>(
	token: RegularAtomToken<E | null>,
): (element: E | null) => void

/** Release setup resources when the current owner is disposed. */
export declare function onCleanup(cleanup: () => void): void

export interface RootOptions {
	/** Explicit request or island store; state initialization precedes rendering. */
	store: RootStore
	/** Unique within the document and identical on the server and client. */
	idPrefix: string
}

export interface WaterRoot {
	dispose(): void
	/** Testing and imperative coordination; state writes themselves remain immediate. */
	flush(): void
}

export declare function render(
	setup: () => Child,
	host: Element,
	options: RootOptions,
): WaterRoot

export declare function hydrate(
	setup: () => Child,
	host: Element,
	options: RootOptions,
): WaterRoot

/** Intended for a separate server entrypoint; no DOM or subscriptions are retained. */
export declare function renderToString(
	setup: () => Child,
	options: RootOptions,
): string

/** Proposed compiler/renderer protocol, not component-author APIs. */
export interface RenderOwner {
	readonly store: RootStore
	onCleanup(cleanup: () => void): void
}

/** A DOM destination. Its node or range is separately owned by RenderOwner. */
export interface DomTarget<T> {
	write(value: T): void
}

/**
 * Proposed atom.io bridge: track atom reads, subscribe to used tokens, schedule
 * rereads, write the target, and release subscriptions with the owner.
 * It does not expose a new reactive value or implement an application effects API.
 */
export declare function connect<T>(
	owner: RenderOwner,
	read: () => T,
	target: DomTarget<T>,
): void
