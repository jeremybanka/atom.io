import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { build } from "esbuild"
import { chromium } from "playwright"
import { compile } from "../src/compiler.ts"

const bundle = await build({
	entryPoints: [resolve(import.meta.dirname, `../__tests__/layout-browser.tsx`)],
	tsconfigRaw: {},
	bundle: true,
	write: false,
	format: `esm`,
	platform: `browser`,
	define: { "import.meta.env.DEV": `false` },
	alias: {
		"@atom.io/spa/jsx-runtime": resolve(
			import.meta.dirname,
			`../src/jsx-runtime.ts`,
		),
	},
	plugins: [
		{
			name: `spa`,
			setup(builder) {
				builder.onLoad({ filter: /\.tsx$/ }, async ({ path }) => ({
					contents: compile(await readFile(path, `utf8`), path).code,
					loader: `ts`,
				}))
			},
		},
	],
})
const server = createServer((req, res) => {
	if (req.url === `/app.js`) {
		res.setHeader(`content-type`, `application/javascript`)
		res.end(bundle.outputFiles[0].text)
	} else {
		res.setHeader(`content-type`, `text/html`)
		res.end(`<script type="module" src="/app.js"></script>`)
	}
})
await new Promise((ready) => server.listen(0, `127.0.0.1`, ready))
let browser
try {
	browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
		args: [`--enable-unsafe-swiftshader`],
	})
	const page = await browser.newPage()
	const errors = []
	page.on(`pageerror`, (error) => {
		errors.push(error.message)
		console.error(error.stack)
	})
	await page.goto(`http://127.0.0.1:${server.address().port}`)
	await page.waitForTimeout(100)
	const before = await page.evaluate(() => window.layoutTest.inspect())

	await page.evaluate(() => window.layoutTest.update(1))
	await page.waitForTimeout(80)
	const during = await page.evaluate(() => window.layoutTest.inspect())

	assert.ok(
		during.marker.x > before.marker.x + 1 && during.marker.x < 240,
		`Shared marker must move through an intermediate position`,
	)
	assert.ok(
		during.panel.width > 300 && during.panel.width < 500,
		`Container width must project through intermediate sizes`,
	)
	assert.ok(
		during[`animated-layout`].width > 40 && during[`animated-layout`].width < 80,
		`Reactive Motion properties must share layout's transform renderer`,
	)
	assert.equal(during.unrelated.x, before.unrelated.x)
	assert.equal(during[`other-root`].x, before[`other-root`].x)
	assert.ok(during[`floating-layout`].translate)
	await page.screenshot({ path: `/tmp/spa-layout-intermediate.png` })
	await page.waitForTimeout(450)
	const after = await page.evaluate(() => window.layoutTest.inspect())

	assert.ok(after.marker.x > 240)
	assert.ok(Math.abs(after[`animated-layout`].y - 320) < 1)
	assert.ok(Math.abs(after.panel.width - 500) < 0.5)
	assert.ok(Math.abs(after.nested.x - before.nested.x - 120) < 1)
	assert.ok(Math.abs(after.nested.y - before.nested.y) < 1)
	await page.evaluate(() => {
		window.retainedNode = document.querySelector(`#retained`)
		window.layoutTest.show(false)
	})
	assert.equal(await page.locator(`#retained`).count(), 1)
	await page.waitForTimeout(50)
	assert.ok(
		Number(
			await page
				.locator(`#retained`)
				.evaluate((element) => getComputedStyle(element).opacity),
		) < 0.99,
		`Motion exit opacity must continue while layout owns projection`,
	)
	await page.evaluate(() => window.layoutTest.show(true))
	await page.waitForTimeout(300)
	assert.equal(
		await page.evaluate(
			() => document.querySelector(`#retained`) === window.retainedNode,
		),
		true,
	)
	await page.evaluate(() => {
		document.querySelector(`#nested-parent`).style.width = `300px`
	})
	await page.waitForTimeout(80)
	const resizing = await page.evaluate(() => window.layoutTest.inspect())
	assert.ok(
		resizing[`nested-parent`].width > 288 &&
			resizing[`nested-parent`].width < 360,
	)
	await page.waitForTimeout(400)
	assert.ok(
		Math.abs(
			(await page.evaluate(() => window.layoutTest.inspect()))[`nested-parent`]
				.width - 360,
		) < 1,
	)
	await page.evaluate(() => {
		document.body.style.height = `1400px`
		window.scrollTo(0, 90)
	})
	await page.evaluate(() => window.layoutTest.update(0))
	await page.waitForTimeout(400)
	assert.ok(
		Math.abs(
			(await page.evaluate(() => window.layoutTest.inspect())).marker.y + 82,
		) < 1,
	)
	await page.evaluate(() => {
		window.scrollTo(0, 0)
	})
	await page.evaluate(() => window.layoutTest.update(0))
	await page.waitForTimeout(70)
	await page.evaluate(() => window.layoutTest.update(1))
	await page.waitForTimeout(450)
	assert.ok(
		(await page.evaluate(() => window.layoutTest.inspect())).marker.x > 240,
	)
	await page.emulateMedia({ reducedMotion: `reduce` })
	await page.evaluate(() => window.layoutTest.update(0))
	await page.waitForTimeout(40)
	const reduced = await page.evaluate(() => window.layoutTest.inspect())
	assert.ok(reduced.marker.x < 20)
	assert.ok(Math.abs(reduced.panel.width - 300) < 0.5)
	await page.emulateMedia({ reducedMotion: `no-preference` })
	await page.evaluate(() => window.layoutTest.update(1))
	await page.waitForTimeout(60)
	await page.evaluate(() => window.layoutTest.dispose())
	const disposed = await page.evaluate(() => window.layoutTest.afterDispose())
	await page.waitForTimeout(450)
	assert.equal(
		await page.evaluate(() => window.layoutTest.afterDispose()),
		disposed,
	)
	assert.ok(disposed.includes(`rotate(8deg)`))
	await page.evaluate(() => {
		window.layoutRegression = window.layoutTest.regressions()
	})
	const authoredStyles = async () => {
		for (const source of [`inline`, `stylesheet`]) {
			const style = await page
				.locator(`#authored-${source}`)
				.evaluate((node) => {
					const computed = getComputedStyle(node)
					return [computed.opacity, computed.pointerEvents, computed.visibility]
				})
			assert.deepEqual(style, [`0.15`, `none`, `hidden`], source)
		}
	}
	const origins = async () => {
		for (const origin of [`fixed`, `percent`, `stylesheet`]) {
			const geometry = await page.evaluate((originKind) => {
				return [false, true].map((projected) => {
					const node = document.getElementById(
						`origin-${originKind}-${projected}`,
					)
					const rect = node.getBoundingClientRect()
					return [rect.x, rect.y, rect.width, rect.height]
				})
			}, origin)
			geometry[0].forEach((value, index) => {
				assert.ok(
					Math.abs(value - geometry[1][index]) < 0.5,
					`${origin}: ${JSON.stringify(geometry)}`,
				)
			})
		}
	}
	await page.waitForTimeout(80)
	await authoredStyles()
	await origins()
	await page.evaluate(() => window.layoutRegression.resize(200))
	await page.waitForTimeout(50)
	await authoredStyles()
	await page.waitForTimeout(250)
	await authoredStyles()
	await origins()
	await page.evaluate(() => window.layoutRegression.resize(300, true))
	await page.waitForTimeout(300)
	await origins()
	const motion = page.locator(`#removable-motion`)
	assert.equal(
		await motion.evaluate((node) => getComputedStyle(node).opacity),
		`0.2`,
	)
	await page.evaluate(() => window.layoutRegression.removeMotion())
	await page.waitForTimeout(300)
	await page.evaluate(() => window.layoutRegression.resize(150))
	await page.waitForTimeout(300)
	assert.equal(
		await motion.evaluate((node) => getComputedStyle(node).opacity),
		`0.6`,
	)
	assert.ok(
		await motion.evaluate((node) => {
			const matrix = new DOMMatrix(getComputedStyle(node).transform)
			return (
				Math.abs(matrix.e) < 0.01 &&
				Math.abs(matrix.a - Math.cos((5 * Math.PI) / 180)) < 0.001
			)
		}),
		`Removing motion must restore authored transforms through later layout renders`,
	)
	await page.evaluate(() => window.layoutRegression.removeLayout())
	await page.waitForTimeout(80)
	await page.evaluate(() => window.layoutRegression.resize(250))
	await page.waitForTimeout(300)
	assert.ok(
		await page.locator(`#persistent-motion`).evaluate((node) => {
			const computed = getComputedStyle(node)
			return (
				Math.abs(new DOMMatrix(computed.transform).e - 30) < 0.01 &&
				computed.opacity === `0.7`
			)
		}),
		`Removing layout props must preserve remaining animated properties`,
	)
	await page.evaluate(() => window.layoutRegression.dispose())
	await page.evaluate(() => {
		window.sceneClock = window.layoutTest.sceneClock()
	})
	await page.waitForTimeout(250)
	const clock = await page.evaluate(() => window.sceneClock.inspect())
	for (const [name, samples] of Object.entries(clock.samples)) {
		assert.ok(
			samples.length > 1 && samples.length < 100,
			`${name}: ${samples.length} callbacks in ${new Set(samples.map(({ frame }) => frame)).size} browser frames`,
		)
		assert.equal(
			new Set(samples.map(({ frame }) => frame)).size,
			samples.length,
			`${name} must run at most once per browser frame`,
		)
		for (let index = 1; index < samples.length; index++) {
			assert.ok(samples[index].time > samples[index - 1].time, name)
			if (name === `canvas`) {
				assert.ok(
					Math.abs(
						samples[index].delta -
							(samples[index].time - samples[index - 1].time) / 1000,
					) < 0.000001,
					`Canvas delta must track the scene clock in seconds`,
				)
			}
		}
	}
	assert.equal(clock.samples.canvas[0].delta, 0)
	for (const sample of clock.samples.direct) {
		for (const name of [`scene`, `canvas`]) {
			const other = clock.samples[name].find(
				({ frame }) => frame === sample.frame,
			)
			assert.ok(other && Math.abs(other.time - sample.time) < 0.000001)
		}
	}
	assert.equal(
		clock.tick,
		Object.values(clock.samples).reduce(
			(total, samples) => total + samples.length,
			0,
		),
	)
	await page.locator(`#scene-clock-input`).click({ force: true })
	assert.equal(
		(await page.evaluate(() => window.sceneClock.inspect())).clicks,
		1,
	)
	await page.evaluate(() => window.sceneClock.disposeOnNextFrame())
	await page.waitForFunction(() => window.sceneClock.inspect().cleanups === 1)
	const stopped = await page.evaluate(() => window.sceneClock.inspect().samples)
	await page.waitForTimeout(80)
	assert.deepEqual(
		await page.evaluate(() => window.sceneClock.inspect().samples),
		stopped,
		`Disposing the root from a frame callback must stop all scene callbacks`,
	)
	await page.evaluate(() => window.sceneClock.dispose())
	await page.evaluate(() => {
		window.forms = window.layoutTest.forms()
	})
	const rejected = page.locator(`#form-reject`)
	await rejected.focus()
	await rejected.press(`End`)
	await rejected.pressSequentially(`d`)
	assert.equal(await rejected.inputValue(), `abc`)
	let form = await page.evaluate(() => window.forms.inspect())
	assert.ok(form.edits.includes(`input:abcd`))
	assert.ok(form.edits.includes(`parent:abcd`))
	await page.locator(`#form-accept`).fill(`accepted`)
	assert.equal(
		(await page.evaluate(() => window.forms.inspect())).text,
		`accepted`,
	)
	assert.equal(await rejected.inputValue(), `accepted`)
	await page.locator(`#form-area`).fill(`area`)
	assert.equal((await page.evaluate(() => window.forms.inspect())).text, `area`)
	const number = page.locator(`#form-number`)
	await number.focus()
	await number.press(`End`)
	await number.pressSequentially(`1`)
	assert.equal(await number.inputValue(), `01`)
	assert.equal((await page.evaluate(() => window.forms.inspect())).number, 1)
	await page.locator(`#form-checked`).click()
	assert.equal(await page.locator(`#form-checked`).isChecked(), false)
	assert.ok(
		(await page.evaluate(() => window.forms.inspect())).edits.includes(
			`checked:true`,
		),
	)
	await page.locator(`#form-radio-b`).click()
	assert.equal(await page.locator(`#form-radio-a`).isChecked(), true)
	assert.equal(await page.locator(`#form-radio-b`).isChecked(), false)
	await page.locator(`#form-stopped`).fill(`rejected`)
	await page.waitForFunction(
		() => document.querySelector(`#form-stopped`).value === `fixed`,
	)
	assert.ok(
		(await page.evaluate(() => window.forms.inspect())).edits.includes(
			`stopped:rejected`,
		),
	)
	await page.evaluate(() => window.forms.options())
	assert.equal(await page.locator(`#form-select`).inputValue(), `b`)
	await page.locator(`#form-default`).fill(`edited`)
	await page.evaluate(() => window.forms.clearAttributes())
	assert.equal(
		await page.locator(`#form-attributes`).getAttribute(`title`),
		null,
	)
	assert.equal(await page.locator(`#form-default`).inputValue(), `edited`)
	await page.evaluate(() => window.forms.autofocus())
	assert.equal(await page.evaluate(() => document.activeElement.id), `form-auto`)
	form = await page.evaluate(() => window.forms.inspect())
	assert.ok(form.edits.includes(`focus`) && form.edits.includes(`blur`))
	await page.evaluate(() => window.forms.dispose())
	await page.reload()
	await page.waitForTimeout(100)
	assert.ok(
		(await page.evaluate(() => window.layoutTest.fail())).includes(`finite`),
	)
	assert.equal(await page.evaluate(() => window.layoutTest.empty()), true)
	await page.waitForTimeout(400)
	assert.deepEqual(errors, [])
	console.log(
		`DOM layout projection, shared identity, nested transforms, independent Floating UI translate, interruption, reduced motion, scene clock cadence/timing, and teardown passed.`,
	)
} finally {
	await browser?.close()
	await new Promise((done) => server.close(done))
}
