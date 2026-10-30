import { defineConfig } from "astro/config"
import integration, { resumablePlugin } from "resumability/astro"

export const config = defineConfig({
	integrations: [integration()],
	vite: { plugins: [resumablePlugin()] },
})
// @ts-expect-error Plugin declarations must retain their types in an Astro-only consumer.
void resumablePlugin().nonexistentPluginMember
