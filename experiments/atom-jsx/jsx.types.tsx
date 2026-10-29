import type { ReadableToken, TransactionToken } from "atom.io"

import type { VNode } from "./runtime.ts"
import { project } from "./runtime.ts"

// Compile-only contracts: tsc checks the valid forms and every expected rejection.
export function checkJSXTypes(
	countAtom: ReadableToken<number>,
	pointAtom: ReadableToken<{ x: number; y: number }>,
	labelAtom: ReadableToken<string>,
	commandTransaction: TransactionToken<() => void>,
): VNode {
	// @ts-expect-error Object-valued tokens need a projection to become children.
	const objectChild = <output>{pointAtom}</output>
	// @ts-expect-error Transactions are not readable state.
	const transactionChild = <output>{commandTransaction}</output>
	// @ts-expect-error A class name must resolve to a string.
	const numericClass = <output className={countAtom} />
	const pointProjection = project(pointAtom, (point) => point)
	// @ts-expect-error Projections must also resolve to renderable children.
	const objectProjection = <output>{pointProjection}</output>
	void [objectChild, transactionChild, numericClass, objectProjection]
	return (
		<output className={labelAtom}>
			{countAtom}
			{project(pointAtom, ({ x, y }) => `${x}, ${y}`)}
		</output>
	)
}
