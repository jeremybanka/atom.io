// Shared by the CLI runner and the interactive browser check.
export async function check(page, baseURL = `http://127.0.0.1:4381`) {
	const errors = []
	page.on(`pageerror`, (error) => errors.push(error.message))
	page.on(`console`, (message) => {
		if (message.type() === `error`) errors.push(message.text())
	})
	await page.goto(baseURL)
	await page.waitForFunction(
		() => document.querySelectorAll(`astro-island:not([ssr])`).length === 4,
	)
	const buttons = page
		.locator(`astro-island`)
		.filter({ hasNot: page.locator(`#probe`) })
		.locator(`button`)
	const before = await buttons.allTextContents()
	if (JSON.stringify(before) !== JSON.stringify([`2`, `10`, `20`]))
		throw new Error(`initial state: ${before}`)
	await buttons.nth(0).click()
	await page.waitForFunction(
		() => document.querySelector(`button`).textContent === `3`,
	)
	if (
		JSON.stringify(await buttons.allTextContents()) !==
		JSON.stringify([`3`, `10`, `20`])
	)
		throw new Error(`island state leaked`)
	const result = await page.evaluate(async () => {
		if (document.querySelector(`[data-lines]`).value !== `\nfirst line`)
			throw new Error(`textarea newline`)
		const input = document.querySelector(`[data-row="a"]`)
		input.focus()
		input.setSelectionRange(0, 1)
		document.querySelector(`[data-reorder]`).click()
		await Promise.resolve()
		const preserved =
			document.querySelectorAll(`[data-row]`)[1] === input &&
			document.activeElement === input &&
			input.selectionStart === 0 &&
			input.selectionEnd === 1
		document.querySelector(`[data-remove]`).click()
		await Promise.resolve()
		document.querySelector(`[data-stats]`).click()
		return {
			preserved,
			stats: document.querySelector(`[data-stats]`).textContent,
			namespace: document.querySelector(`[data-namespace]`).namespaceURI,
			ids: [...document.querySelectorAll(`h2`)].map((node) => node.id),
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
		.evaluate((element) => element.dispatchEvent(new Event(`astro:unmount`)))
	if (await page.locator(`astro-island`).first().locator(`button`).count())
		throw new Error(`island disposal failed`)
	return { ...result, errors }
}
