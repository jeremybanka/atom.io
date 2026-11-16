import assert from "node:assert/strict"

import { type Browser, chromium, type Page } from "playwright"

export const cpuRate = Number(
	process.argv.find((arg) => arg.startsWith(`--cpu-throttle=`))?.split(`=`)[1] ??
		process.env[`SPA_DEVTOOLS_CPU_THROTTLE`] ??
		1,
)
assert.ok(Number.isFinite(cpuRate) && cpuRate >= 1 && cpuRate <= 6)
export function browserArtifacts(path: string): string {
	return cpuRate === 1 ? path : `${path}-cpu${cpuRate}`
}
/** Keep the browser sandbox enabled in both ordinary and CPU-throttled regressions. */
export async function launchBrowser(): Promise<Browser> {
	const browser = await chromium.launch({
		chromiumSandbox: true,
		...(process.env[`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`]
			? { executablePath: process.env[`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`] }
			: {}),
	})
	if (cpuRate === 1) return browser
	const applied = new WeakSet<Page>()
	const throttle = async (page: Page) => {
		if (!applied.has(page)) {
			applied.add(page)
			const session = await page.context().newCDPSession(page)
			await session.send(`Emulation.setCPUThrottlingRate`, { rate: cpuRate })
		}
		return page
	}
	const newContext = browser.newContext.bind(browser)
	browser.newContext = async (...args) => {
		const context = await newContext(...args)
		const newPage = context.newPage.bind(context)
		context.newPage = async (...options) => throttle(await newPage(...options))
		return context
	}
	const newPage = browser.newPage.bind(browser)
	browser.newPage = async (...args) => throttle(await newPage(...args))
	return browser
}
