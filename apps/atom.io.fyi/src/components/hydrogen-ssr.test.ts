import assert from "node:assert/strict"
import { test } from "node:test"

import type { VNode } from "hydrogen"
import renderer from "hydrogen/astro-server"
import { jsx } from "hydrogen/jsx-runtime"

// Exercise the renderer Astro actually resolves, including hydration markers.
async function markup(Component: () => VNode): Promise<string> {
	const { html } = await renderer.renderToStaticMarkup.call(
		{} as any,
		Component,
		{},
		{},
	)
	assert.match(html, /<!--w:/)
	return html.replaceAll(/<!--[\s\S]*?-->/g, ``)
}
await test(`Astro's renderer preserves hydrogen component HTML for hydration`, async () => {
	function Navigation(): VNode {
		return jsx(`docs-navigation`, {
			children: jsx(`a`, { href: `#effects`, children: `Effects` }),
		})
	}
	assert.equal(
		await markup(Navigation),
		`<docs-navigation><a href="#effects">Effects</a></docs-navigation>`,
	)
})
await test(`Astro's renderer preserves static code exhibits`, async () => {
	assert.equal(
		await markup(() =>
			jsx(`code-block`, { children: jsx(`pre`, { children: `example` }) }),
		),
		`<code-block><pre>example</pre></code-block>`,
	)
})
