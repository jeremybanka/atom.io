import type {
	AtomLifecycleEvent,
	FamilyMetadata,
	MutableAtomFamilyToken,
	MutableAtomToken,
	ReadonlyHeldSelectorFamilyToken,
	ReadonlyHeldSelectorToken,
	ReadonlyPureSelectorFamilyToken,
	ReadonlyPureSelectorToken,
	RegularAtomFamilyToken,
	RegularAtomToken,
	StateUpdate,
	WritableHeldSelectorFamilyToken,
	WritableHeldSelectorToken,
	WritablePureSelectorFamilyToken,
	WritablePureSelectorToken,
} from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import type { Subject } from "atom.io/foundations/subject"
import type { Flat } from "atom.io/foundations/type-utils"

import type { InternalRole } from "./atom/index.ts"
import type { ConstructorOf, Transceiver } from "./mutable/index.ts"
import type { Store } from "./store/index.ts"
import type { Timeline, TimelineFamily } from "./timeline/index.ts"
import type { RootStore, Transaction } from "./transaction/index.ts"
import type { Ctor } from "./utility-types.ts"

export type AtomIOState = {
	key: string
	family?: FamilyMetadata
	install: (store: RootStore) => void
	subject: Subject<StateUpdate<any>>
}
export type RegularAtom<T, E> = Flat<
	AtomIOState & {
		type: `atom`
		default: T | (() => T)
		cleanup?: () => void
		internalRoles?: InternalRole[]
		catch?: readonly Ctor<E>[]
		__T?: T
		__E?: E
	}
>
export type MutableAtom<T extends Transceiver<any, any, any>> = Flat<
	AtomIOState & {
		type: `mutable_atom`
		class: ConstructorOf<T>
		cleanup?: () => void
		__T?: T
	}
>
export type Atom<T, E> =
	| RegularAtom<T, E>
	| (T extends Transceiver<any, any, any> ? MutableAtom<T> : never)

export type WritableHeldSelector<T> = Flat<
	AtomIOState & {
		type: `writable_held_selector`
		const: T
		getFrom: (target: Store) => T
		setSelf: (newValue: T) => void
		__T?: T
	}
>
export type ReadonlyHeldSelector<T> = Flat<
	AtomIOState & {
		type: `readonly_held_selector`
		const: T
		getFrom: (target: Store) => T
		__T?: T
	}
>
export type WritablePureSelector<T, E> = Flat<
	AtomIOState & {
		type: `writable_pure_selector`
		getFrom: (target: Store) => E | T
		setSelf: (newValue: T) => void
		catch?: readonly Ctor<E>[]
		__T?: T
		__E?: E
	}
>
export type ReadonlyPureSelector<T, E> = Flat<
	AtomIOState & {
		type: `readonly_pure_selector`
		getFrom: (target: Store) => E | T
		catch?: readonly Ctor<E>[]
		__T?: T
		__E?: E
	}
>
export type ReadonlySelector<T, E> =
	| ReadonlyHeldSelector<T>
	| ReadonlyPureSelector<T, E>
export type WritableSelector<T, E> =
	| WritableHeldSelector<T>
	| WritablePureSelector<T, E>
export type HeldSelector<T> = ReadonlyHeldSelector<T> | WritableHeldSelector<T>
export type PureSelector<T, E> =
	| ReadonlyPureSelector<T, E>
	| WritablePureSelector<T, E>
export type Selector<T, E> =
	| ReadonlyHeldSelector<T>
	| ReadonlyPureSelector<T, E>
	| WritableHeldSelector<T>
	| WritablePureSelector<T, E>

export type WritableState<T, E> = Atom<T, E> | WritableSelector<T, E>
export type ReadableState<T, E> = Atom<T, E> | Selector<T, E>

// dprint-ignore
export type RegularAtomFamily<T, K extends Canonical, E = never> = Flat<
	RegularAtomFamilyToken<T, K, E> & {
		create: <Key extends K>(key: Key) => RegularAtomToken<T, Key, E>
		default: T | ((key: K) => T)
		install: (store: RootStore) => void
		internalRoles: string[] | undefined
		subject: Subject<AtomLifecycleEvent<RegularAtomToken<T, K, E>>>
	}
>

export type MutableAtomFamily<
	T extends Transceiver<any, any, any>,
	K extends Canonical,
> = Flat<
	MutableAtomFamilyToken<T, K> & {
		create: <Key extends K>(key: Key) => MutableAtomToken<T, Key>
		class: ConstructorOf<T>
		install: (store: RootStore) => void
		internalRoles: string[] | undefined
		subject: Subject<AtomLifecycleEvent<MutableAtomToken<T, K>>>
	}
>

export type AtomFamily<T, K extends Canonical, E> =
	| MutableAtomFamily<T extends Transceiver<any, any, any> ? T : never, K>
	| RegularAtomFamily<T, K, E>

export type WritablePureSelectorFamily<T, K extends Canonical, E> = Flat<
	WritablePureSelectorFamilyToken<T, K, E> & {
		create: <Key extends K>(key: Key) => WritablePureSelectorToken<T, Key, E>
		default: (key: K) => T
		install: (store: RootStore) => void
		internalRoles: string[] | undefined
	}
>

export type WritableHeldSelectorFamily<T, K extends Canonical> = Flat<
	WritableHeldSelectorFamilyToken<T, K> & {
		create: <Key extends K>(key: Key) => WritableHeldSelectorToken<T, Key>
		default: (key: K) => T
		install: (store: RootStore) => void
		internalRoles: string[] | undefined
	}
>

export type ReadonlyPureSelectorFamily<T, K extends Canonical, E> = Flat<
	ReadonlyPureSelectorFamilyToken<T, K, E> & {
		create: <Key extends K>(key: Key) => ReadonlyPureSelectorToken<T, Key, E>
		default: (key: K) => T
		install: (store: RootStore) => void
		internalRoles: string[] | undefined
	}
>

export type ReadonlyHeldSelectorFamily<T, K extends Canonical> = Flat<
	ReadonlyHeldSelectorFamilyToken<T, K> & {
		create: <Key extends K>(key: Key) => ReadonlyHeldSelectorToken<T, Key>
		default: (key: K) => T
		install: (store: RootStore) => void
		internalRoles: string[] | undefined
	}
>

export type PureSelectorFamily<T, K extends Canonical, E> =
	| ReadonlyPureSelectorFamily<T, K, E>
	| WritablePureSelectorFamily<T, K, E>

export type HeldSelectorFamily<T, K extends Canonical> =
	| ReadonlyHeldSelectorFamily<T, K>
	| WritableHeldSelectorFamily<T, K>

export type ReadonlySelectorFamily<T, K extends Canonical, E> =
	| ReadonlyHeldSelectorFamily<T, K>
	| ReadonlyPureSelectorFamily<T, K, E>

export type WritableSelectorFamily<T, K extends Canonical, E> =
	| WritableHeldSelectorFamily<T, K>
	| WritablePureSelectorFamily<T, K, E>

export type SelectorFamily<T, K extends Canonical, E> =
	| HeldSelectorFamily<T, K>
	| PureSelectorFamily<T, K, E>

export type WritableFamily<T, K extends Canonical, E> =
	| AtomFamily<T, K, E>
	| WritableSelectorFamily<T, K, E>
export type ReadableFamily<T, K extends Canonical, E> =
	| AtomFamily<T, K, E>
	| SelectorFamily<T, K, E>

export type AtomIOInternalResource =
	| ReadableFamily<any, any, any>
	| ReadableState<any, any>
	| Timeline<any>
	| TimelineFamily<any, any>
	| Transaction<any>
