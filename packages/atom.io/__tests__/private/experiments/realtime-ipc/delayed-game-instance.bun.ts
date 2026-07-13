const startupDelay: number = Number(
	process.env[`ATOM_IO_TEST_ROOM_STARTUP_DELAY_MS`] ?? 0,
)

if (Number.isFinite(startupDelay) && startupDelay > 0) {
	await new Promise<void>((resolve) => setTimeout(resolve, startupDelay))
}

await import(`./game-instance.bun.ts`)

export {}
