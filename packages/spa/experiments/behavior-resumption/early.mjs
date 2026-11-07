import fs from "node:fs/promises"
import { chromium } from "playwright"
import shell from "@sparticuz/chromium"
import "./serve.mjs"
const executablePath = await shell.executablePath()
const args = shell.args.filter(
	(x) =>
		!["--disable-web-security", "--allow-running-insecure-content"].includes(x),
)
const runs = []
for (let rep = 0; rep < 5; rep++)
	for (const scenario of ["store-200"])
		for (const variant of rep % 2
			? ["resume-preload", "resume-cold", "spa-preload"]
			: ["spa-preload", "resume-cold", "resume-preload"]) {
			const browser = await chromium.launch({ executablePath, args })
			const page = await browser.newPage({
				viewport: { width: 900, height: 700 },
			})
			const client = await page.context().newCDPSession(page)
			await client.send("Network.enable")
			await client.send("Network.emulateNetworkConditions", {
				offline: false,
				latency: 150,
				downloadThroughput: 200000,
				uploadThroughput: 93750,
			})
			await client.send("Emulation.setCPUThrottlingRate", { rate: 6 })
			let resolvePaint
			const paint = new Promise((r) => (resolvePaint = r))
			page.on("console", (m) => {
				if (m.text().startsWith("BENCH_FCP:"))
					resolvePaint(Number(m.text().split(":")[1]))
			})
			const errors = []
			page.on("pageerror", (e) => errors.push(e.message))
			await page.addInitScript(() => {
				window.__setups = 0
				new PerformanceObserver((l) => {
					for (const e of l.getEntries())
						if (e.name === "first-contentful-paint")
							console.log("BENCH_FCP:" + e.startTime)
				}).observe({ type: "paint", buffered: true })
				window.__event = null
				document.addEventListener(
					"click",
					(e) => {
						const b = e.target.closest("[data-product]")
						window.__event = {
							target: b?.getAttribute("data-product") ?? "other",
							timestamp: e.timeStamp,
							processing: performance.now(),
						}
						if (b) {
							const obs = new MutationObserver(() => {
								if (document.querySelector("#cart")?.textContent === "1") {
									obs.disconnect()
									window.__event.dom = performance.now()
									requestAnimationFrame(() =>
										requestAnimationFrame(
											() => (window.__event.paint = performance.now()),
										),
									)
								}
							})
							obs.observe(document.querySelector("#cart"), {
								subtree: true,
								childList: true,
								characterData: true,
							})
						}
					},
					true,
				)
			})
			const startEpoch = Date.now()
			const nav = page.goto(
				`http://127.0.0.1:4174/${variant}-${scenario}.html`,
				{ waitUntil: "load" },
			)
			await new Promise((r) => setTimeout(r, 550))
			const sent = Date.now()
			const fcp = null
			await Promise.all([
				client.send("Input.dispatchMouseEvent", {
					type: "mousePressed",
					x: 90,
					y: 290,
					button: "left",
					clickCount: 1,
					timestamp: sent / 1000,
				}),
				client.send("Input.dispatchMouseEvent", {
					type: "mouseReleased",
					x: 90,
					y: 290,
					button: "left",
					clickCount: 1,
					timestamp: sent / 1000 + 0.001,
				}),
			])
			await nav
			try {
				await page.waitForFunction(() => window.__event?.paint != null, null, {
					timeout: 2500,
				})
			} catch {}
			const r = await page.evaluate(() => ({
				event: window.__event,
				fcp: performance.getEntriesByName("first-contentful-paint")[0]
					?.startTime,
				cart: document.querySelector("#cart")?.textContent,
				ready: window.__ready ?? window.__qready,
				resumed: window.__resumeStats ?? null,
				setups: window.__setups,
				timeOrigin: performance.timeOrigin,
				hydrationStart:
					performance.getEntriesByName("hydrate-start")[0]?.startTime,
				hydrationEnd: performance.getEntriesByName("hydrate-end")[0]?.startTime,
			}))
			const result = {
				variant,
				scenario,
				rep,
				requestedDelayFromGotoMs: 550,
				actualDelayFromGotoMs: sent - startEpoch,
				sentFromNavigation: sent - r.timeOrigin,
				...r,
				latencyMs:
					r.event?.paint != null ? r.event.paint - r.event.timestamp : null,
				lost: r.cart !== "1",
				errors,
			}
			runs.push(result)
			await fs.writeFile("results-early.json", JSON.stringify(runs, null, 2))
			console.log(JSON.stringify(result))
			await browser.close()
		}
process.exit()
