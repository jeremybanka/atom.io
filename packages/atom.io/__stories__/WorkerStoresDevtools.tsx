import type { AtomIODevtoolsTarget } from "@atom.io/spa-devtools"
import { AtomIODevtools } from "@atom.io/spa-devtools/react"
import { Silo } from "atom.io"
import { useEffect, useMemo, useState } from "react"

function createPageStore(): Silo {
	const page = new Silo({
		name: `storybook-worker-stores-page`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	page.atom<string>({ key: `location`, default: `Main thread` })
	return page
}

type WorkerValues = { count: number; doubled: number }

export function WorkerStoresDevtools(): React.JSX.Element {
	const [page] = useState(createPageStore)
	const [worker, setWorker] = useState<Worker>()
	const [values, setValues] = useState<WorkerValues>()
	useEffect(() => {
		const instance = new Worker(
			new URL(`../../spa-devtools/exhibits/worker/worker.ts`, import.meta.url),
			{ type: `module` },
		)
		const update = ({ data }: MessageEvent<WorkerValues>) => {
			setValues(data)
		}
		instance.addEventListener(`message`, update)
		setWorker(instance)
		return () => {
			instance.removeEventListener(`message`, update)
			instance.terminate()
		}
	}, [])
	const stores = useMemo<readonly AtomIODevtoolsTarget[] | undefined>(() => {
		if (!worker) return undefined
		return [
			{
				id: `storybook-worker`,
				label: `Counter worker`,
				kind: `remote`,
				connect() {
					const { port1, port2 } = new MessageChannel()
					worker.postMessage({ type: `connect`, port: port2 }, [port2])
					return port1
				},
			},
			{
				id: `storybook-page`,
				label: `Page store`,
				kind: `local`,
				store: page.store,
			},
		]
	}, [page, worker])

	return (
		<section style={{ padding: `2rem`, maxWidth: `22rem` }}>
			<h1>Worker stores</h1>
			<button
				type="button"
				disabled={!values}
				onClick={() => {
					worker?.postMessage({ type: `increment` })
				}}
			>
				Increment in worker
			</button>
			<p>
				<output aria-label="Worker values">
					{values
						? `Count: ` + values.count + ` · Doubled: ` + values.doubled
						: `Waiting for the worker…`}
				</output>
			</p>
			<p>
				Switch between the page and worker in the store picker. In the worker’s
				Atoms tab, edit <strong>count</strong> and press Enter.
			</p>
			{stores && <AtomIODevtools stores={stores} />}
		</section>
	)
}
