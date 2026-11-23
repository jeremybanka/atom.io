import type { Component as SpaComponent, RootOptions } from "@atom.io/spa"
import type { RootStore } from "atom.io/internal"
import type { FunctionComponent } from "react"
import type { Component as SolidComponent } from "solid-js"

import type { ExhibitFramework } from "../../scripts/exhibit-sandboxes.ts"

export async function mountExhibitPreview(
	framework: ExhibitFramework,
	component: unknown,
	host: HTMLElement,
	store: RootStore,
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
			store,
			capabilities: preview.capabilities ?? [],
			onError,
		}).dispose
	}

	if (framework === `solid`) {
		const [{ render, createComponent }, { StoreProvider }] = await Promise.all([
			import(`@solidjs/web`),
			import(`@atom.io/solid`),
		])
		return render(
			() =>
				createComponent(StoreProvider, {
					store,
					get children() {
						return createComponent(component as SolidComponent, {})
					},
				}),
			host,
			undefined,
			{ onError },
		)
	}

	const [{ createElement }, { createRoot }, { StoreProvider }] =
		await Promise.all([
			import(`react`),
			import(`react-dom/client`),
			import(`@atom.io/react`),
		])
	const root = createRoot(host, { onUncaughtError: onError })
	root.render(
		createElement(StoreProvider, {
			store,
			children: createElement(component as FunctionComponent),
		}),
	)
	return () => {
		root.unmount()
	}
}
