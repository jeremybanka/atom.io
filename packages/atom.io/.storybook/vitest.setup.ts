import { beforeEach } from "vitest"

beforeEach(() => {
	// This runs only in the dedicated browser test project, never in the demo app.
	localStorage.clear()
})
