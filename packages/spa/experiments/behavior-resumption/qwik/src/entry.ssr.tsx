import { renderToStream } from "@builder.io/qwik/server"

import { App } from "./root.tsx"

export async function render(
	props: any,
	preload = true,
): Promise<{ html: string }> {
	let html = ``
	await renderToStream(<App {...props} />, {
		stream: {
			write(s: string) {
				html += s
			},
		},
		containerTagName: `div`,
		containerAttributes: { id: `app` },
		base: `/qwik/build/`,
		preloader: preload ? undefined : false,
		qwikLoader: `module`,
	})
	return { html }
}
