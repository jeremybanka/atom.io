import { createMarkdownCollaborationHttpServer } from "./http-server.ts"

const portArgument = process.argv.indexOf(`--port`)
const configuredPort =
	portArgument === -1 ? process.env.PORT : process.argv[portArgument + 1]
const PORT = Number.parseInt(configuredPort ?? `3000`, 10)
if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65_535) {
	throw new Error(`PORT must be an integer between 1 and 65535.`)
}
const server = await createMarkdownCollaborationHttpServer({ port: PORT })
console.log(
	`Markdown collaboration server listening on http://localhost:${PORT}`,
)

const shutdown = async (): Promise<void> => {
	await server.close()
}
process.once(`SIGINT`, () => void shutdown())
process.once(`SIGTERM`, () => void shutdown())
