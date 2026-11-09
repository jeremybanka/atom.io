import fs from "node:fs/promises"
import { chromium } from "playwright"
import shell from "@sparticuz/chromium"
import "./serve.mjs"
const cases = ["store-12", "store-200", "store-1000", "setup-200"]
const profiles = {
	fast: { cpu: 1, latency: 0, download: -1, upload: -1 },
	slow4g: { cpu: 6, latency: 150, download: 200000, upload: 93750 },
}
const executablePath = await shell.executablePath()
const args = shell.args.filter(
	(x) =>
		!["--disable-web-security", "--allow-running-insecure-content"].includes(x),
)
async function sample(variant, scenario, profile, rep) {
	const browser = await chromium.launch({ executablePath, args })
	try {
		const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
		const client = await page.context().newCDPSession(page)
		const p = profiles[profile]
		await client.send("Performance.enable")
		await client.send("Emulation.setCPUThrottlingRate", { rate: p.cpu })
		await client.send("Network.enable")
		await client.send("Network.emulateNetworkConditions", {
			offline: false,
			latency: p.latency,
			downloadThroughput: p.download,
			uploadThroughput: p.upload,
		})
		const pending = new Set()
		let lastNetwork = performance.now()
		page.on("request", (r) => {
			pending.add(r)
			lastNetwork = performance.now()
		})
		for (const event of ["requestfinished", "requestfailed"])
			page.on(event, (r) => {
				pending.delete(r)
				lastNetwork = performance.now()
			})
		const quiet = async () => {
			const start = performance.now()
			while (pending.size || performance.now() - lastNetwork < 500) {
				if (performance.now() - start > 30000)
					throw new Error("Network never became quiet")
				await new Promise((r) => setTimeout(r, 20))
			}
		}
		const errors = []
		page.on("pageerror", (e) => errors.push(e.message))
		page.on("response", (r) => {
			if (r.status() >= 400) errors.push(r.status() + ": " + r.url())
		})
		await page.addInitScript(() => {
			window.__setups = 0
			window.__longtasks = []
			new PerformanceObserver((l) =>
				window.__longtasks.push(
					...l
						.getEntries()
						.map((x) => ({ start: x.startTime, duration: x.duration })),
				),
			).observe({ type: "longtask", buffered: true })
			document.addEventListener(
				"qinit",
				() => (window.__qready = performance.now()),
			)
			window.__clicks = []
			document.addEventListener(
				"click",
				(e) => {
					if (!window.__bulk && e.target.closest("[data-product]")) {
						const start = performance.now()
						const old = document.querySelector("#cart").textContent
						const mo = new MutationObserver(() => {
							if (document.querySelector("#cart").textContent !== old) {
								mo.disconnect()
								const dom = performance.now() - start
								requestAnimationFrame(() =>
									requestAnimationFrame(() =>
										window.__clicks.push({
											dom,
											paint: performance.now() - start,
										}),
									),
								)
							}
						})
						mo.observe(document.querySelector("#cart"), {
							childList: true,
							subtree: true,
							characterData: true,
						})
					}
				},
				true,
			)
		})
		await page.goto(`http://127.0.0.1:4174/${variant}-${scenario}.html`, {
			waitUntil: "load",
		})
		await quiet()
		const metric = async () =>
			Object.fromEntries(
				(await client.send("Performance.getMetrics")).metrics.map((x) => [
					x.name,
					x.value,
				]),
			)
		const read = async () =>
			page.evaluate(() => {
				const nav = performance.getEntriesByType("navigation")[0]
				const resources = performance.getEntriesByType("resource")
				return {
					fcp: performance.getEntriesByName("first-contentful-paint")[0]
						?.startTime,
					load: nav.loadEventEnd,
					dcl: nav.domContentLoadedEventEnd,
					ready: window.__ready ?? window.__qready,
					setups: window.__setups,
					resumed: window.__resumeStats ?? null,
					hydrate:
						performance.getEntriesByName("hydrate-end")[0]?.startTime -
						performance.getEntriesByName("hydrate-start")[0]?.startTime,
					htmlEncoded: nav.encodedBodySize,
					resources: resources.map((r) => ({
						url: r.name.split("/").slice(3).join("/"),
						bytes: r.encodedBodySize,
						transfer: r.transferSize,
						duration: r.duration,
					})),
					longtasks: window.__longtasks,
					now: performance.now(),
				}
			})
		const startup = { ...(await read()), metrics: await metric() }
		let activation = null
		if (scenario === "below-200") {
			const t = await page.evaluate(() => {
				document.querySelector("#catalog").scrollIntoView()
				return performance.now()
			})
			if (variant.startsWith("spa"))
				await page.waitForFunction(() => window.__ready != null)
			await quiet()
			activation = {
				duration: (await page.evaluate(() => performance.now())) - t,
				hydrate: await page.evaluate(
					() =>
						performance.getEntriesByName("hydrate-end")[0]?.startTime -
						performance.getEntriesByName("hydrate-start")[0]?.startTime,
				),
				setups: await page.evaluate(() => window.__setups),
			}
		}
		await page.locator('[data-product="0"]').click()
		await page.waitForFunction(() => window.__clicks.length === 1)
		const first = {
			...(await read()),
			metrics: await metric(),
			click: await page.evaluate(() => window.__clicks[0]),
		}
		for (let i = 0; i < 5; i++) {
			await page.locator('[data-product="0"]').click()
			await page.waitForFunction((n) => window.__clicks.length === n, i + 2)
		}
		const warm = await page.evaluate(() => window.__clicks.slice(1))
		// A dense-use control: execute every card handler once, keeping visible DOM assertions.
		let denseMs = null
		if (variant !== "spa-islands") {
			const denseStart = await page.evaluate(() => {
				window.__bulk = true
				const t = performance.now()
				for (const b of document.querySelectorAll("[data-product]")) b.click()
				return t
			})
			const count = Number(scenario.split("-").pop())
			await page.waitForFunction(
				(n) => document.querySelector("#cart").textContent === String(n + 6),
				count,
			)
			await page.evaluate(
				() =>
					new Promise((r) =>
						requestAnimationFrame(() => requestAnimationFrame(r)),
					),
			)
			denseMs = await page.evaluate((t) => performance.now() - t, denseStart)
		}
		const end = {
			...(await read()),
			metrics: await metric(),
			allQuantitiesCorrect: await page.evaluate(
				(islands) =>
					Array.from(document.querySelectorAll("[data-quantity]")).every(
						(e, i) =>
							Number(e.textContent) === (islands ? 0 : 1) + (i === 0 ? 6 : 0),
					),
				variant === "spa-islands",
			),
			cart: await page.locator("#cart").innerText(),
			quantity0: await page.locator('[data-quantity="0"]').innerText(),
		}
		const result = {
			variant,
			scenario,
			profile,
			rep,
			startup,
			activation,
			first,
			warm,
			denseMs,
			end,
			errors,
			browser: browser.version(),
		}
		return result
	} finally {
		await browser.close()
	}
}
let all = []
const repeats = Number(process.env.REPEATS ?? 3)
const selectedProfiles =
	process.env.PROFILES?.split(",") ?? Object.keys(profiles)
const selectedCases = process.env.CASES?.split(",") ?? cases
const selectedVariants = process.env.VARIANTS?.split(",")
for (let rep = 0; rep < repeats; rep++)
	for (const profile of selectedProfiles)
		for (const scenario of selectedCases) {
			const vs = selectedVariants
				? [...selectedVariants]
				: scenario === "below-200"
					? ["spa-eager", "spa-visible", "qwik-default"]
					: ["spa-eager", "qwik-default"]
			if (rep % 2) vs.reverse()
			for (const variant of vs) {
				try {
					const r = await sample(variant, scenario, profile, rep)
					all.push(r)
					await fs.writeFile(
						process.env.OUTPUT ?? "results.json",
						JSON.stringify(all, null, 2),
					)
					console.log(
						JSON.stringify({
							variant,
							scenario,
							profile,
							rep,
							fcp: r.startup.fcp,
							scriptMs: r.startup.metrics.ScriptDuration * 1000,
							hydrate: r.startup.hydrate,
							first: r.first.click.paint,
							bytes:
								r.startup.resources.reduce(
									(sum, resource) => sum + resource.bytes,
									0,
								) + r.startup.htmlEncoded,
							errors: r.errors,
						}),
					)
				} catch (e) {
					console.error("FAILED", variant, scenario, profile, rep, e)
					process.exitCode = 1
					break
				}
			}
		}
process.exit(process.exitCode ?? 0)
