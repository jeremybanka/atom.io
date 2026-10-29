import { useAtomicRef, useLoadable } from "@atom.io/react"
import { atomFamily, type Loadable, setState } from "atom.io"
import type { ReactNode } from "react"
import { useRef } from "react"

import { pollJob } from "./helpers.ts"
import type { Job } from "./services.ts"

const jobAtoms = atomFamily<Loadable<Job | null>, string, Error>({
	key: `job`,
	default: null,
	catch: [Error],
})
const pollingAtoms = atomFamily<HTMLOutputElement | null, string>({
	key: `polling`,
	default: null,
	effects: (jobId) => [
		({ onSet }) => {
			let stop = () => {}
			onSet(({ newValue, oldValue }) => {
				if (newValue === oldValue) return
				stop()
				stop = newValue
					? pollJob(jobId, {
							onRequest: (request) => {
								setState(jobAtoms, jobId, request)
							},
						})
					: () => {}
			})
			return () => {
				stop()
			}
		},
	],
})
function JobProgressView({ jobId }: { jobId: string }) {
	const node = useAtomicRef(pollingAtoms, jobId, useRef)
	const job = useLoadable(jobAtoms, jobId, null)
	return (
		<output ref={node}>
			{job.error ? `Failed` : (job.value?.progress ?? `Loading`)}
		</output>
	)
}
export function JobProgress({ jobId }: { jobId: string }): ReactNode {
	return <JobProgressView key={jobId} jobId={jobId} />
}
