import type { Loadable, ReadableFamilyToken, ReadableToken } from "atom.io"
import type { Accessor, LoadableValue } from "hydrogen"
import { useLoadable } from "hydrogen"

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false
type Expect<T extends true> = T

export function loadableTypes(
	token: ReadableToken<Loadable<string>, any, RangeError>,
	family: ReadableFamilyToken<Loadable<string>, number, RangeError>,
	nullable: ReadableToken<Loadable<string | null>, any, never>,
	optional: ReadableToken<Loadable<string | undefined>, any, never>,
): void {
	const read = useLoadable(token)
	const withFallback = useLoadable(token, `fallback`)
	const member = useLoadable(family, 1)
	const memberWithFallback = useLoadable(family, 1, `fallback`)
	const nullFallback = useLoadable(nullable, null)
	const undefinedFallback = useLoadable(optional, undefined)
	const checks: [
		Expect<
			Equal<
				typeof read,
				Accessor<`LOADING` | LoadableValue<string | RangeError>>
			>
		>,
		Expect<
			Equal<
				typeof withFallback,
				Accessor<LoadableValue<string> & { error?: RangeError }>
			>
		>,
		Expect<Equal<typeof member, typeof read>>,
		Expect<Equal<typeof memberWithFallback, typeof withFallback>>,
		Expect<Equal<ReturnType<typeof nullFallback>[`value`], string | null>>,
		Expect<
			Equal<ReturnType<typeof undefinedFallback>[`value`], string | undefined>
		>,
	] = [true, true, true, true, true, true]
	void checks
	const result = read()
	if (result !== `LOADING`) {
		const value: string | RangeError = result.value
		void value
		// @ts-expect-error Errors are part of value when no fallback is supplied.
		result.error
	}
	const loaded = withFallback()
	const value: string = loaded.value
	const error: RangeError | undefined = loaded.error
	void [value, error]
	// @ts-expect-error A family requires its key.
	useLoadable(family)
	// @ts-expect-error Family keys must match the declared key type.
	useLoadable(family, `wrong`)
	// @ts-expect-error Fallbacks cannot widen the token's value type.
	useLoadable(token, 42)
	// @ts-expect-error Family fallbacks must match the family value type.
	useLoadable(family, 1, 42)
	// @ts-expect-error An accessor must be called before inspecting its result.
	read.loading
}
