import { render, renderHook } from "@testing-library/react"
import { Silo } from "atom.io"
import { createKeyContext, StoreProvider } from "atom.io/react"
import { setTestLogLevel } from "atom.io/testing"
import { StrictMode } from "react"
import { renderToString } from "react-dom/server"
import { vitest } from "vitest"

afterEach(() => vitest.restoreAllMocks())

describe(`createKeyContext`, () => {
	it(`returns the nearest provided key`, () => {
		const DocumentKey = createKeyContext<string>(`DocumentKey`, `fallback`)
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

	it(`prefers a provided key over the fallback without warning`, () => {
		const DocumentKey = createKeyContext<string>(`DocumentKey`, `fallback`)
		const Consumer = () => <span>{DocumentKey.use()}</span>
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

	it(`warns once across consumers, rerenders, and remounts`, () => {
		const DocumentKey = createKeyContext<string>(`DocumentKey`, `fallback`)
		const logger = setTestLogLevel(null)
		const warn = vitest.spyOn(logger, `warn`)
		const Consumer = () => <span>{DocumentKey.use()}</span>
		const consumers = (
			<>
				<Consumer />
				<Consumer />
			</>
		)
		const { getAllByText, rerender, unmount } = render(consumers)

		expect(getAllByText(`fallback`)).toHaveLength(2)
		expect(warn).toHaveBeenCalledWith(
			`💁`,
			`key`,
			`DocumentKey`,
			`used its fallback because DocumentKey.use() was called outside <DocumentKey.Provider>:`,
			`fallback`,
		)
		expect(warn).toHaveBeenCalledOnce()

		rerender(consumers)
		unmount()
		render(<Consumer />)
		expect(warn).toHaveBeenCalledOnce()
	})

	it(`warns once in StrictMode`, () => {
		const DocumentKey = createKeyContext<string>(`DocumentKey`, `fallback`)
		const logger = setTestLogLevel(null)
		const warn = vitest.spyOn(logger, `warn`)
		const Consumer = () => <span>{DocumentKey.use()}</span>

		render(
			<StrictMode>
				<Consumer />
			</StrictMode>,
		)

		expect(warn).toHaveBeenCalledOnce()
	})

	it(`warns during server rendering`, () => {
		const DocumentKey = createKeyContext<string>(`DocumentKey`, `fallback`)
		const logger = setTestLogLevel(null)
		const warn = vitest.spyOn(logger, `warn`)
		const Consumer = () => <span>{DocumentKey.use()}</span>

		expect(renderToString(<Consumer />)).toContain(`fallback`)
		expect(warn).toHaveBeenCalledOnce()
	})

	it(`warns once for each atom.io store`, () => {
		const DocumentKey = createKeyContext<string>(`DocumentKey`, `fallback`)
		const uno = new Silo({
			name: `uno`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		const dos = new Silo({
			name: `dos`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const unoWarn = vitest
			.spyOn(uno.store.logger, `warn`)
			.mockImplementation(() => {})
		const dosWarn = vitest
			.spyOn(dos.store.logger, `warn`)
			.mockImplementation(() => {})
		const Consumer = () => <span>{DocumentKey.use()}</span>

		render(
			<>
				<StoreProvider store={uno.store}>
					<Consumer />
					<Consumer />
				</StoreProvider>
				<StoreProvider store={dos.store}>
					<Consumer />
					<Consumer />
				</StoreProvider>
			</>,
		)

		expect(unoWarn).toHaveBeenCalledOnce()
		expect(dosWarn).toHaveBeenCalledOnce()
	})

	it(`returns undefined without warning when no fallback is supplied`, () => {
		const OptionalKey = createKeyContext<string>(`OptionalKey`)
		const logger = setTestLogLevel(null)
		const warn = vitest.spyOn(logger, `warn`)
		const { result } = renderHook(() => OptionalKey.use())

		expect(result.current).toBeUndefined()
		expect(warn).not.toHaveBeenCalled()
	})

	it(`preserves the key type across its provider and hook`, () => {
		const NumericKey = createKeyContext<number>(`NumericKey`, 0)
		const OptionalNumericKey = createKeyContext<number>(`OptionalNumericKey`)

		function TypeExamples() {
			const key = NumericKey.use()
			const optionalKey = OptionalNumericKey.use()
			expectTypeOf(key).toEqualTypeOf<number>()
			expectTypeOf(optionalKey).toEqualTypeOf<number | undefined>()
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
