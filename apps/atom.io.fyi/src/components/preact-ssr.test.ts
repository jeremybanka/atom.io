import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"

import { h, type VNode } from "preact"

// Exercise the renderer Astro actually resolves, including its transitive version.
const requireFromIntegration = createRequire(
	import.meta.resolve(`@astrojs/preact/server.js`),
)
const { renderToStringAsync } = requireFromIntegration(
	`preact-render-to-string`,
) as { renderToStringAsync: (node: VNode) => Promise<string> }

await test(`Astro's renderer preserves Preact component HTML for hydration`, async () => {
	function Navigation(): VNode {
		return h(`docs-navigation`, null, h(`a`, { href: `#effects` }, `Effects`))
	}
	assert.equal(
		await renderToStringAsync(h(Navigation, {})),
		`<docs-navigation><a href="#effects">Effects</a></docs-navigation>`,
	)
})

await test(`Astro's renderer preserves static code exhibits`, async () => {
	assert.equal(
		await renderToStringAsync(h(`code-block`, null, h(`pre`, null, `example`))),
		`<code-block><pre>example</pre></code-block>`,
	)
})
