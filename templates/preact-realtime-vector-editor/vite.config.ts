import preact from "@preact/preset-vite"
import { defineConfig } from "vite"

const BACKEND_URL = `http://localhost:3000`

const proxyBackend = () => ({
	[`/health`]: { changeOrigin: true, target: BACKEND_URL },
	[`/socket.io`]: { changeOrigin: true, target: BACKEND_URL, ws: true },
})

export default defineConfig({
	plugins: [preact()],
	preview: { proxy: proxyBackend() },
	server: { proxy: proxyBackend() },
})
