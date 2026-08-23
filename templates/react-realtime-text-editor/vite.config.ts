import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const proxyBackend = (backendUrl: string) => ({
	[`/health`]: {
		changeOrigin: true,
		target: backendUrl,
	},
	[`/socket.io`]: {
		changeOrigin: true,
		target: backendUrl,
		ws: true,
	},
})

export default defineConfig(({ mode }) => {
	const backendUrl =
		mode === `browser-conformance`
			? `http://127.0.0.1:3027`
			: (process.env.VITE_BACKEND_URL ?? `http://localhost:3000`)
	return {
		plugins: [react()],
		preview: { proxy: proxyBackend(backendUrl) },
		server: { proxy: proxyBackend(backendUrl) },
	}
})
