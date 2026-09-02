/** @jsxImportSource preact */

declare const reset: () => void

// @exhibit-region start reset-button
const resetButton = (
	<button type="button" class="flat" onClick={reset}>
		Reset
	</button>
)
// @exhibit-region end reset-button

void resetButton
