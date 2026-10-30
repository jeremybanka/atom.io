import { defineConfig } from "astro/config"
import resumability, { resumablePlugin } from "resumability/astro"

export const config = defineConfig({
	integrations: [resumability()],
	vite: { plugins: [resumablePlugin()] },
})
// @ts-expect-error Plugin declarations must retain their types in an Astro-only consumer.
void resumablePlugin().nonexistentPluginMember
