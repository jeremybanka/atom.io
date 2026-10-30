import integration, { resumablePlugin } from "@atom.io/resumable/astro"
import { defineConfig } from "astro/config"

export const config = defineConfig({
	integrations: [integration()],
	vite: { plugins: [resumablePlugin()] },
})
// @ts-expect-error Plugin declarations must retain their types in an Astro-only consumer.
void resumablePlugin().nonexistentPluginMember
