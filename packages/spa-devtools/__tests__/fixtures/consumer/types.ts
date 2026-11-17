import "@atom.io/spa-devtools/css"

import type { Component } from "@atom.io/spa"
import {
	AtomIODevtools,
	type AtomIODevtoolsHandle,
	type AtomIODevtoolsProps,
	captureEcologySnapshot,
	type EcologyRootTrace,
	type EcologySnapshot,
	mountAtomIODevtools,
	traceEcologyRoots,
} from "@atom.io/spa-devtools"
import type { Silo } from "atom.io"

export const component: Component<AtomIODevtoolsProps> = AtomIODevtools
export const props: AtomIODevtoolsProps = { hideByDefault: true }
export const mount: (
	host: Element,
	options?: AtomIODevtoolsProps,
) => AtomIODevtoolsHandle = mountAtomIODevtools

export function ecology(
	store: Silo[`store`],
): [EcologySnapshot, EcologyRootTrace] {
	const snapshot = captureEcologySnapshot(store)
	return [snapshot, traceEcologyRoots(snapshot, `selected`)]
}
