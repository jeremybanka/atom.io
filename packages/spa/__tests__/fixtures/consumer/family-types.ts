import type { Accessor, TimelineControls } from "@atom.io/spa"
import { useGetter, useRef, useSetter, useTimeline } from "@atom.io/spa"
import type {
	ReadableFamilyToken,
	RegularAtomFamilyToken,
	Setter,
	TimelineFamilyToken,
	WritableFamilyToken,
} from "atom.io"

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false
type Expect<T extends true> = T

export function familyTypes(
	readable: ReadableFamilyToken<number, 1 | 2, RangeError>,
	writable: WritableFamilyToken<number, readonly [string, number]>,
	elements: RegularAtomFamilyToken<HTMLInputElement | null, boolean>,
	timelines: TimelineFamilyToken<null>,
): void {
	const read = useGetter(readable, 1)
	const write = useSetter(writable, [`row`, 1])
	const ref = useRef(elements, false)
	const history = useTimeline(timelines, null)
	const checks: [
		Expect<Equal<typeof read, Accessor<number | RangeError>>>,
		Expect<Equal<typeof write, (value: number | Setter<number>) => void>>,
		Expect<Equal<typeof ref, (element: HTMLInputElement | null) => void>>,
		Expect<Equal<typeof history, TimelineControls>>,
	] = [true, true, true, true]
	void checks
	const { getCursor, getLength, canUndoTransaction } = history
	const cursor: number = getCursor()
	const length: number = getLength()
	const canUndo: boolean = canUndoTransaction()
	void [cursor, length, canUndo]
	write((previous) => previous + 1)
	ref(document.createElement(`input`))
	ref(null)
	history.undo()
	// @ts-expect-error A family requires a key.
	useGetter(readable)
	// @ts-expect-error Keys cannot widen the family's declared key type.
	useGetter(readable, 3)
	// @ts-expect-error A member token does not accept a family key.
	useGetter({ type: `atom`, key: `member` }, 1)
	// @ts-expect-error A writable family requires a key.
	useSetter(writable)
	// @ts-expect-error Tuple keys retain their element types.
	useSetter(writable, [1, `row`])
	// @ts-expect-error Read-only selector families cannot be written.
	useSetter(readable, 1)
	// @ts-expect-error Values retain their family type.
	write(`wrong`)
	// @ts-expect-error Updaters must return the family's value type.
	write(() => `wrong`)
	// @ts-expect-error A ref family requires a key.
	useRef(elements)
	// @ts-expect-error Ref keys retain their type, including false.
	useRef(elements, `wrong`)
	// @ts-expect-error Refs retain the specific element type.
	ref(document.createElement(`div`))
	// @ts-expect-error Timeline families require keys.
	useTimeline(timelines)
	// @ts-expect-error Null keys must not widen to arbitrary strings.
	useTimeline(timelines, `wrong`)
}
