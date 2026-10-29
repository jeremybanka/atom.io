// Application helpers shared by both sides of the effects guide.
// They own mechanics; the exhibits decide when to create, update, and stop them.
import { type Job, readJob, saveDraft } from "./services.ts"

export function debounce<T>(callback: (value: T) => void, delay: number) {
	let timer: ReturnType<typeof setTimeout> | undefined
	const cancel = () => {
		clearTimeout(timer)
	}
	return Object.assign(
		(value: T) => {
			cancel()
			timer = setTimeout(() => callback(value), delay)
		},
		{ cancel },
	)
}

// Debounce edits, serialize writes, and report only the latest edit's status.
// cancel() drops unsent work; it cannot undo a write already sent to the server.
export function createAutosaver(
	draftId: string,
	report: (status: string) => void,
) {
	let revision = 0
	let queue = Promise.resolve()
	const save = debounce(
		({ text, version }: { text: string; version: number }) => {
			queue = queue.then(async () => {
				if (version !== revision) return
				report(`Saving`)
				try {
					await saveDraft(draftId, text)
					if (version === revision) report(`Saved`)
				} catch {
					if (version === revision) report(`Failed`)
				}
			})
		},
		400,
	)
	return {
		schedule(text: string) {
			const version = ++revision
			report(`Waiting`)
			save({ text, version })
		},
		cancel() {
			++revision
			save.cancel()
		},
	}
}

// Publish each request for Loadable consumers, or its outcome for React state.
// Requests never overlap. Completion or failure stops the loop; cleanup aborts it.
export function pollJob(
	jobId: string,
	callbacks: {
		onRequest?: (request: Promise<Job>) => void
		onResult?: (job: Job) => void
		onError?: (error: unknown) => void
	},
): () => void {
	const controller = new AbortController()
	let timer: ReturnType<typeof setTimeout> | undefined
	async function poll() {
		const request = readJob(jobId, controller.signal)
		callbacks.onRequest?.(request)
		try {
			const job = await request
			if (controller.signal.aborted) return
			callbacks.onResult?.(job)
			if (!job.complete)
				timer = setTimeout(() => {
					void poll()
				}, 1000)
		} catch (error) {
			if (!controller.signal.aborted) callbacks.onError?.(error)
		}
	}
	void poll()
	return () => {
		controller.abort()
		clearTimeout(timer)
	}
}

export function connectToRoom(
	roomId: string,
	onMessage: (message: string) => void,
): () => void {
	const url = new URL(
		`/chat/${encodeURIComponent(roomId)}`,
		window.location.href,
	)
	url.protocol = window.location.protocol === `https:` ? `wss:` : `ws:`
	const socket = new WebSocket(url)
	let active = true
	socket.onmessage = (event) => {
		if (active) onMessage(String(event.data))
	}
	return () => {
		active = false
		socket.onmessage = null
		socket.close()
	}
}

export function observeVisibility(
	node: Element | null,
	report: (visible: boolean) => void,
): () => void {
	if (!node) return () => {}
	let active = true
	const observer = new IntersectionObserver(([entry]) => {
		if (active) report(entry?.isIntersecting ?? false)
	})
	observer.observe(node)
	return () => {
		active = false
		observer.disconnect()
	}
}
