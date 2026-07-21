import { render, renderHook, waitFor } from "@testing-library/react"
import { createKeyContext } from "atom.io/react"
import { setTestLogLevel } from "atom.io/testing"
import { vitest } from "vitest"

afterEach(() => vitest.restoreAllMocks())

describe(`createKeyContext`, () => {
	it(`returns the nearest provided key`, () => {
		const DocumentKey = createKeyContext<string>(`DocumentKey`)
		const Consumer = () => <span>{DocumentKey.use()}</span>
		const logger = setTestLogLevel(null)
		const warn = vitest.spyOn(logger, `warn`)

		const { getByText } = render(
			<DocumentKey.Provider value="outer">
				<DocumentKey.Provider value="inner">
					<Consumer />
				</DocumentKey.Provider>
			</DocumentKey.Provider>,
		)

		expect(getByText(`inner`)).toBeTruthy()
		expect(warn).not.toHaveBeenCalled()
	})

	it(`throws a clear error when strict consumption has no provider`, () => {
		const DocumentKey = createKeyContext<string>(`DocumentKey`)

		expect(() => renderHook(() => DocumentKey.use())).toThrow(
			`atom.io: DocumentKey.use() was called outside <DocumentKey.Provider>. Wrap this component in the provider or pass a fallback key to DocumentKey.use(fallback).`,
		)
	})

	it(`prefers a provided key over the fallback without warning`, () => {
		const DocumentKey = createKeyContext<string>(`DocumentKey`)
		const Consumer = () => <span>{DocumentKey.use(`fallback`)}</span>
		const logger = setTestLogLevel(null)
		const warn = vitest.spyOn(logger, `warn`)
		const { getByText } = render(
			<DocumentKey.Provider value="provided">
				<Consumer />
			</DocumentKey.Provider>,
		)

		expect(getByText(`provided`)).toBeTruthy()
		expect(warn).not.toHaveBeenCalled()
	})

	it(`returns and warns about a fallback key when no provider exists`, async () => {
		const DocumentKey = createKeyContext<string>(`DocumentKey`)
		const logger = setTestLogLevel(null)
		const warn = vitest.spyOn(logger, `warn`)
		const Consumer = () => <span>{DocumentKey.use(`fallback`)}</span>
		const { getByText, rerender } = render(<Consumer />)

		expect(getByText(`fallback`)).toBeTruthy()
		await waitFor(() => {
			expect(warn).toHaveBeenCalledWith(
				`💁`,
				`key`,
				`DocumentKey`,
				`used a fallback because DocumentKey.use() was called outside <DocumentKey.Provider>:`,
				`fallback`,
			)
		})

		rerender(<Consumer />)
		expect(warn).toHaveBeenCalledOnce()
	})

	it(`accepts undefined as an intentional fallback key`, async () => {
		const OptionalKey = createKeyContext<string | undefined>(`OptionalKey`)
		const logger = setTestLogLevel(null)
		const warn = vitest.spyOn(logger, `warn`)
		const { result } = renderHook(() => OptionalKey.use(undefined))

		expect(result.current).toBeUndefined()
		await waitFor(() => {
			expect(warn).toHaveBeenCalledOnce()
		})
	})

	it(`preserves the key type across its provider and hook`, () => {
		const NumericKey = createKeyContext<number>(`NumericKey`)

		function TypeExamples() {
			const strictKey = NumericKey.use()
			const fallbackKey = NumericKey.use(1)
			expectTypeOf(strictKey).toEqualTypeOf<number>()
			expectTypeOf(fallbackKey).toEqualTypeOf<number>()
			// @ts-expect-error The fallback must match the context key.
			NumericKey.use(`wrong`)
			return null
		}

		const validProvider = <NumericKey.Provider value={1} />
		// @ts-expect-error The provider value must match the context key.
		const invalidProvider = <NumericKey.Provider value="wrong" />

		expect(TypeExamples).toBeTypeOf(`function`)
		expect(validProvider).toBeTruthy()
		expect(invalidProvider).toBeTruthy()
	})
})
