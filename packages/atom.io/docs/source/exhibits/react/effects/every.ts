export function every(delay: number, tick: () => void): () => void {
	if (typeof window === `undefined`) return () => {}
	const timer = setInterval(tick, delay)
	return () => {
		clearInterval(timer)
	}
}
