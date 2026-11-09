import { defineConfig } from "vite"
import { qwikVite } from "@builder.io/qwik/optimizer"
export default defineConfig({
	plugins: [
		qwikVite({
			srcDir: "src",
			client: { input: "src/root.tsx", outDir: "../dist/qwik" },
			ssr: { input: "src/entry.ssr.tsx", outDir: "../build-qwik" },
			lint: false,
		}),
	],
	build: { minify: "esbuild", target: "es2022" },
})
