import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const BACKEND_URL = `http://localhost:3000`

const proxyBackend = () => ({
	[`/health`]: {
		changeOrigin: true,
		target: BACKEND_URL,
	},
	[`/socket.io`]: {
		changeOrigin: true,
		target: BACKEND_URL,
		ws: true,
	},
})

export default defineConfig({
	plugins: [react()],
	preview: { proxy: proxyBackend() },
	server: { proxy: proxyBackend() },
})
