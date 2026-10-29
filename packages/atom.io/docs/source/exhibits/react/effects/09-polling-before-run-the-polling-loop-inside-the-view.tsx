import { useEffect, useState } from "react"

import { pollJob } from "./helpers.ts"
import type { Job } from "./services.ts"

export function JobProgress({ jobId }: { jobId: string }) {
	const [job, setJob] = useState<Job | null>(null)
	const [failed, setFailed] = useState(false)
	useEffect(() => {
		setJob(null)
		setFailed(false)
		return pollJob(jobId, { onResult: setJob, onError: () => setFailed(true) })
	}, [jobId])
	return <output>{failed ? `Failed` : (job?.progress ?? `Loading`)}</output>
}
