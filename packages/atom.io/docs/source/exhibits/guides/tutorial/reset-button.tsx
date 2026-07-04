/** @jsxImportSource preact */

declare const reset: () => void

const resetButton = (
	// @exhibit-region start reset-button
	<button type="button" class="flat" onClick={reset}>
		Reset
	</button>
	// @exhibit-region end reset-button
)

void resetButton
