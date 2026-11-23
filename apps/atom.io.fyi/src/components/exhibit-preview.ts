import type { Component as SpaComponent, RootOptions } from "@atom.io/spa"
import type { FunctionComponent } from "react"
import type { Component as SolidComponent } from "solid-js"

import type { ExhibitFramework } from "../../scripts/exhibit-sandboxes.ts"

export async function mountExhibitPreview(
	framework: ExhibitFramework,
	component: unknown,
	host: HTMLElement,
	onError: (error: unknown) => void,
): Promise<() => void> {
	if (typeof component !== `function`)
		throw new TypeError(`The default export must be a function component.`)

	if (framework === `spa`) {
		const [{ render }, { jsx }] = await Promise.all([
			import(`@atom.io/spa`),
			import(`@atom.io/spa/jsx-runtime`),
		])
		const preview = component as SpaComponent & Pick<RootOptions, `capabilities`>
		return render(() => jsx(preview, {}), host, {
			capabilities: preview.capabilities ?? [],
			onError,
		}).dispose
	}

	if (framework === `solid`) {
		const { render, createComponent } = await import(`@solidjs/web`)
		return render(
			() => createComponent(component as SolidComponent, {}),
			host,
			undefined,
			{ onError },
		)
	}

	const [{ createElement }, { createRoot }] = await Promise.all([
		import(`react`),
		import(`react-dom/client`),
	])
	const root = createRoot(host, { onUncaughtError: onError })
	root.render(createElement(component as FunctionComponent))
	return () => {
		root.unmount()
	}
}
