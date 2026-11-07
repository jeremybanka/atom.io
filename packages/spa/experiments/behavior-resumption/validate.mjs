import fs from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium } from "playwright"
import shell from "@sparticuz/chromium"
import { server } from "./serve.mjs"

const args = shell.args.filter(
	(x) =>
		!["--disable-web-security", "--allow-running-insecure-content"].includes(x),
)
const executablePath = await shell.executablePath()
const results = []
async function check(name, run) {
	const browser = await chromium.launch({ executablePath, args })
	const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
	const errors = []
	page.on("pageerror", (error) => errors.push(error.message))
	await page.addInitScript(() => {
		window.__setups = 0
		window.__resumeErrors = []
		document.addEventListener("resume-error", (e) =>
			window.__resumeErrors.push(e.detail),
		)
	})
	try {
		await run(page)
		assert.deepEqual(errors, [])
		results.push({ name, pass: true })
	} catch (error) {
		results.push({ name, pass: false, error: String(error) })
		throw error
	} finally {
		await browser.close()
	}
}
const url = (variant, scenario = "store-12") =>
	`http://127.0.0.1:4174/${variant}-${scenario}.html`
try {
	await fs.mkdir("screenshots", { recursive: true })
	let visible, baselineImage
	for (const variant of ["spa-eager", "resume-cold", "resume-preload"]) {
		await check(`${variant}: identical visible output`, async (page) => {
			await page.goto(url(variant))
			await page.waitForLoadState("networkidle")
			const text = await page.locator("#app").innerText()
			const png = await page.screenshot({
				fullPage: true,
				path: `screenshots/${variant}.png`,
			})
			if (visible) {
				assert.equal(text, visible)
				assert.deepEqual(png, baselineImage)
			} else {
				visible = text
				baselineImage = png
			}
		})
	}

	await check(
		"cold: no code download or component setup before interaction",
		async (page) => {
			await page.goto(url("resume-cold", "store-1000"))
			await page.waitForLoadState("networkidle")
			assert.deepEqual(
				await page.evaluate(() => ({
					setups: window.__setups,
					stats: window.__resumeStats ?? null,
					code: performance
						.getEntriesByType("resource")
						.filter((r) => r.name.endsWith(".js"))
						.map((r) => r.name),
				})),
				{ setups: 0, stats: null, code: [] },
			)
			await page.evaluate(() =>
				document.querySelector('[data-product="999"]').click(),
			)
			await page.waitForFunction(
				() => document.querySelector("#cart").textContent === "1",
			)
			assert.deepEqual(await page.evaluate(() => window.__resumeStats), {
				stores: 1,
				cells: 2,
				bindings: 2,
				handlerCalls: 1,
				domWrites: 2,
			})
			assert.equal(await page.locator('[data-quantity="999"]').innerText(), "1")
			assert.equal(await page.evaluate(() => window.__setups), 0)
		},
	)

	await check(
		"server state restored; shared cart; untouched nodes preserved",
		async (page) => {
			await page.goto(url("resume-preload", "seeded-12"))
			await page.waitForLoadState("networkidle")
			assert.equal(await page.evaluate(() => window.__resumeStats ?? null), null)
			await page.evaluate(() => {
				window.__original = [...document.querySelectorAll("#app *")]
				window.__text = Array.from(document.querySelector("#cart").childNodes)
			})
			await page.locator('[data-product="0"]').click()
			await page.waitForFunction(
				() => document.querySelector("#cart").textContent === "12",
			)
			assert.equal(await page.locator('[data-quantity="0"]').innerText(), "8")
			assert.equal(await page.locator('[data-quantity="1"]').innerText(), "7")
			await page.locator('[data-product="1"]').click()
			await page.waitForFunction(
				() => document.querySelector("#cart").textContent === "13",
			)
			assert.equal(await page.locator('[data-quantity="1"]').innerText(), "8")
			assert.equal(
				await page.evaluate(() =>
					[...document.querySelectorAll("#app *")].every(
						(node, i) => node === window.__original[i],
					),
				),
				true,
			)
			assert.equal(
				await page.evaluate(
					() =>
						Array.from(document.querySelector("#cart").childNodes).every(
							(node, i) => node === window.__text[i],
						) &&
						document.querySelector("#cart").childNodes.length ===
							window.__text.length,
				),
				true,
			)
			assert.deepEqual(await page.evaluate(() => window.__resumeStats), {
				stores: 1,
				cells: 3,
				bindings: 3,
				handlerCalls: 2,
				domWrites: 4,
			})
			assert.equal(await page.evaluate(() => window.__setups), 0)
		},
	)

	await check(
		"forty queued clicks during delayed import are retained",
		async (page) => {
			let requests = 0
			await page.route("**/resume/cart.js", async (route) => {
				requests++
				await new Promise((resolve) => setTimeout(resolve, 250))
				await route.continue()
			})
			await page.goto(url("resume-cold"))
			await page.evaluate(() => {
				for (let i = 0; i < 20; i++) {
					document.querySelector('[data-product="0"]').click()
					document.querySelector('[data-product="1"]').click()
				}
			})
			await page.waitForFunction(
				() => document.querySelector("#cart").textContent === "40",
			)
			assert.equal(await page.locator('[data-quantity="0"]').innerText(), "20")
			assert.equal(await page.locator('[data-quantity="1"]').innerText(), "20")
			assert.equal(requests, 1)
			assert.deepEqual(await page.evaluate(() => window.__resumeStats), {
				stores: 1,
				cells: 3,
				bindings: 3,
				handlerCalls: 40,
				domWrites: 80,
			})
		},
	)

	await check(
		"removed button while import is pending does not update state",
		async (page) => {
			await page.route("**/resume/cart.js", async (route) => {
				await new Promise((resolve) => setTimeout(resolve, 200))
				await route.continue()
			})
			await page.goto(url("resume-cold"))
			await page.evaluate(() => {
				const button = document.querySelector('[data-product="0"]')
				button.click()
				button.remove()
			})
			await page.waitForLoadState("networkidle")
			assert.equal(await page.locator("#cart").innerText(), "0")
			assert.equal(await page.evaluate(() => window.__resumeStats.cells), 0)
			await page.locator('[data-product="1"]').click()
			await page.waitForFunction(
				() => document.querySelector("#cart").textContent === "1",
			)
		},
	)

	await check(
		"missing snapshot surfaces an error, does not mutate; another card still works",
		async (page) => {
			await page.goto(url("resume-cold"))
			await page.evaluate(() => {
				document.querySelector("#resume-state-q0").remove()
			})
			await page.locator('[data-product="0"]').click()
			await page.waitForFunction(() => window.__resumeErrors.length === 1)
			assert.equal(await page.locator("#cart").innerText(), "0")
			await page.locator('[data-product="1"]').click()
			await page.waitForFunction(
				() => document.querySelector("#cart").textContent === "1",
			)
		},
	)

	await check(
		"keyboard activation works through the same lazy click entry",
		async (page) => {
			await page.goto(url("resume-cold"))
			await page.locator('[data-product="0"]').focus()
			await page.keyboard.press("Enter")
			await page.waitForFunction(
				() => document.querySelector("#cart").textContent === "1",
			)
			await page.keyboard.press("Space")
			await page.waitForFunction(
				() => document.querySelector("#cart").textContent === "2",
			)
		},
	)

	await check(
		"failed module download is surfaced; Chromium requires reload to recover",
		async (page) => {
			let attempts = 0
			await page.route("**/resume/cart.js", async (route) => {
				if (++attempts === 1) await route.abort("failed")
				else await route.continue()
			})
			await page.goto(url("resume-cold"))
			await page.locator('[data-product="0"]').click()
			await page.waitForFunction(() => window.__resumeErrors.length === 1)
			assert.equal(await page.locator("#cart").innerText(), "0")
			await page.locator('[data-product="0"]').click()
			await page.waitForFunction(() => window.__resumeErrors.length === 2)
			assert.equal(attempts, 1) // Chromium caches the failed import for this document.
			assert.equal(await page.locator("#cart").innerText(), "0")
			await page.reload()
			await page.locator('[data-product="0"]').click()
			await page.waitForFunction(
				() => document.querySelector("#cart").textContent === "1",
			)
			assert.equal(attempts, 2)
		},
	)

	await check(
		"disabled, submit and invalid-address buttons do not load behavior",
		async (page) => {
			await page.goto(url("resume-cold"))
			await page.evaluate(() => {
				const button = document.querySelector('[data-product="0"]')
				button.disabled = true
				button.click()
				button.disabled = false
				button.type = "submit"
				button.click()
				button.type = "button"
				for (const address of [
					"https://example.invalid/cart.js#run",
					"/resume/../cart.js#run",
					"/resume/cart.js",
					"/elsewhere/cart.js#run",
				]) {
					button.setAttribute("data-resume-click", address)
					button.click()
				}
			})
			await page.waitForTimeout(100)
			assert.equal(await page.evaluate(() => window.__resumeStats ?? null), null)
			assert.equal(
				await page.evaluate(
					() =>
						performance
							.getEntriesByType("resource")
							.filter((entry) => entry.name.endsWith(".js")).length,
				),
				0,
			)
			assert.equal(await page.locator("#cart").innerText(), "0")
		},
	)

	await check(
		"missing handler export reports an error without poisoning the queue",
		async (page) => {
			await page.goto(url("resume-cold"))
			await page
				.locator('[data-product="0"]')
				.evaluate((button) =>
					button.setAttribute("data-resume-click", "/resume/cart.js#missing"),
				)
			await page.locator('[data-product="0"]').click()
			await page.waitForFunction(() => window.__resumeErrors.length === 1)
			assert.equal(await page.locator("#cart").innerText(), "0")
			await page.locator('[data-product="1"]').click()
			await page.waitForFunction(
				() => document.querySelector("#cart").textContent === "1",
			)
		},
	)

	const { render } = await import("./build/spike.mjs")
	for (const value of [NaN, Infinity, -Infinity]) {
		for (const field of ["initialQuantity", "initialCart"]) {
			assert.throws(
				() =>
					render({
						count: 1,
						work: 0,
						precomputed: false,
						below: false,
						[field]: value,
					}),
				/finite initial values/,
			)
		}
	}
	results.push({
		name: "server rejects non-finite initial values before rendering",
		pass: true,
	})

	const meta = JSON.parse(await fs.readFile("build/cart.js.meta.json", "utf8"))
	assert(
		!Object.keys(meta.inputs).some((file) =>
			/packages\/spa\/src\/(dom|core|server-renderer)\.ts|spike\/server\.tsx/.test(
				file,
			),
		),
	)
	assert(
		Object.keys(meta.inputs).some((file) =>
			/atom.io\/src\/internal\/store\/store.ts/.test(file),
		),
	)
	results.push({
		name: "handler imports atom.io; no SPA hydrate/core/server component in client graph",
		pass: true,
	})
} finally {
	server.close()
	await fs.writeFile("validation.json", JSON.stringify(results, null, 2))
	console.log(JSON.stringify(results, null, 2))
}
