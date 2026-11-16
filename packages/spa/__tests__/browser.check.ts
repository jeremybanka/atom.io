import type { Page, Route } from "playwright"

declare global {
	interface Window {
		__formFields?: [HTMLInputElement, HTMLInputElement, HTMLTextAreaElement]
		__spaNavigation?: boolean
		hmrSentinel?: number
	}
}
// Shared by the CLI runner and the interactive browser check.
export async function check(
	page: Page,
	baseURL = `http://127.0.0.1:4381`,
): Promise<{
	preserved: boolean
	stats: string | null
	namespace: string | null
	ids: string[]
	errors: string[]
}> {
	const errors: string[] = []
	page.on(`pageerror`, (error) => errors.push(error.message))
	page.on(`console`, (message) => {
		if (message.type() === `error`) errors.push(message.text())
	})
	// Inspect actual browser-parsed SSR before any island code can run.
	const gate = Promise.withResolvers<void>()
	const holdScripts = async (route: Route) => {
		if (route.request().resourceType() === `script`) await gate.promise
		await route.continue()
	}
	await page.route(`**/*`, holdScripts)
	await page.goto(baseURL, { waitUntil: `commit` })
	await page.waitForSelector(`[data-defaults]`)
	const checkForm = () => {
		const form = document.querySelector<HTMLFormElement>(`[data-defaults]`)!
		const fields = [...form.elements] as [
			HTMLInputElement,
			HTMLInputElement,
			HTMLTextAreaElement,
		]
		const attributes = document.querySelector<HTMLElement>(`[data-enumerated]`)!
		if (
			fields[0].value !== `hello <&"` ||
			!fields[1].checked ||
			fields[2].value !== `\nhello <&`
		)
			throw new Error(`form defaults differ from SSR`)
		if (
			!attributes.draggable ||
			attributes.spellcheck ||
			attributes.getAttribute(`draggable`) !== `true` ||
			attributes.getAttribute(`spellcheck`) !== `false`
		)
			throw new Error(`enumerated boolean attributes differ from SSR`)
		if (
			window.__formFields &&
			fields.some((field, index) => field !== window.__formFields![index])
		)
			throw new Error(`hydration replaced form controls`)
		window.__formFields = fields
	}
	await page.evaluate(checkForm)
	gate.resolve()
	await page.waitForFunction(
		() =>
			document.querySelectorAll<HTMLElement>(`astro-island:not([ssr])`)
				.length === 4,
	)
	await page.evaluate(checkForm)
	await page.evaluate(() => {
		const form = document.querySelector<HTMLFormElement>(`[data-defaults]`)!
		;(form.elements[0] as HTMLInputElement).value = `edited`
		;(form.elements[1] as HTMLInputElement).checked = false
		;(form.elements[2] as HTMLTextAreaElement).value = `edited`
		form.reset()
	})
	await page.evaluate(checkForm)
	const buttons = page
		.locator(`astro-island`)
		.filter({ hasNot: page.locator(`#probe`) })
		.locator(`button`)
	const before = await buttons.allTextContents()
	if (JSON.stringify(before) !== JSON.stringify([`2`, `10`, `20`]))
		throw new Error(`initial state: ${JSON.stringify(before)}`)
	await buttons.nth(0).click()
	await page.waitForFunction(
		() => document.querySelector<HTMLElement>(`button`)!.textContent === `3`,
	)
	if (
		JSON.stringify(await buttons.allTextContents()) !==
		JSON.stringify([`3`, `10`, `20`])
	)
		throw new Error(`island state leaked`)
	const result = await page.evaluate(async () => {
		if (
			document.querySelector<HTMLTextAreaElement>(`[data-lines]`)!.value !==
			`\nfirst line`
		)
			throw new Error(`textarea newline`)
		const input = document.querySelector<HTMLInputElement>(`[data-row="a"]`)!
		input.focus()
		input.setSelectionRange(0, 1)
		document.querySelector<HTMLElement>(`[data-reorder]`)!.click()
		await Promise.resolve()
		const preserved =
			document.querySelectorAll<HTMLElement>(`[data-row]`)[1] === input &&
			document.activeElement === input &&
			input.selectionStart === 0 &&
			input.selectionEnd === 1
		document.querySelector<HTMLElement>(`[data-remove]`)!.click()
		await Promise.resolve()
		document.querySelector<HTMLElement>(`[data-stats]`)!.click()
		return {
			preserved,
			stats: document.querySelector<HTMLElement>(`[data-stats]`)!.textContent,
			namespace:
				document.querySelector<HTMLElement>(`[data-namespace]`)!.namespaceURI,
			ids: [...document.querySelectorAll<HTMLElement>(`h2`)].map(
				(node) => node.id,
			),
		}
	})
	if (
		!result.preserved ||
		result.stats !== `2/1` ||
		result.namespace !== `http://www.w3.org/1999/xhtml` ||
		new Set(result.ids).size !== 3 ||
		errors.length
	)
		throw new Error(JSON.stringify({ result, errors }))
	await page
		.locator(`astro-island`)
		.first()
		.evaluate((element: HTMLElement) =>
			element.dispatchEvent(new Event(`astro:unmount`)),
		)
	if (await page.locator(`astro-island`).first().locator(`button`).count())
		throw new Error(`island disposal failed`)
	return { ...result, errors }
}
