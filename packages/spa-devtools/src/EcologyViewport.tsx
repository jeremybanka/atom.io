/** @jsxImportSource @atom.io/spa */
import { onCleanup, onMount, type SpaElement } from "@atom.io/spa"
import { jsx } from "@atom.io/spa/jsx-runtime"

import type { EcologyScene } from "./EcologyScene.tsx"
import css from "./EcologyViewport.module.css"
import { useLocal } from "./store.ts"

type SceneProps = Parameters<typeof EcologyScene>[0]
/** Keep the graphics engine out of other debugger views and data-only imports. */
export function EcologyViewport(
	props: SceneProps & { workspace: string },
): SpaElement {
	const [scene, setScene] = useLocal<typeof EcologyScene | undefined>(
		props.tools.store,
		undefined,
	)
	const [failed, setFailed] = useLocal(props.tools.store, false)
	onMount(() => {
		let active = true
		onCleanup(() => {
			active = false
		})
		void import(`./EcologyScene.tsx`)
			.then(({ EcologyScene: component }) => {
				if (active) setScene(() => component)
			})
			.catch(() => {
				if (active) setFailed(true)
			})
	})
	return (
		<ecology-viewport
			class={css.class}
			data-workspace={props.workspace}
			data-loading={!scene()}
			aria-busy={!scene() && !failed() ? `true` : undefined}
		>
			{scene() ? (
				jsx(scene()!, props)
			) : (
				<p role="status">
					{failed()
						? `3D view unavailable. Use the accessible node list below.`
						: `Loading graph…`}
				</p>
			)}
		</ecology-viewport>
	)
}
