import { defineConfig } from "astro/config"
import resumability, { resumablePlugin } from "resumability/astro"
import {
	type AstroBrowserResumption,
	browserResumption,
} from "resumability/astro-client"
import { requestResumption, resumableRenderer } from "resumability/astro-server"

export const config = defineConfig({
	integrations: [resumability()],
	vite: { plugins: [resumablePlugin()] },
})
// @ts-expect-error Plugin declarations must retain their types in an Astro-only consumer.
void resumablePlugin().nonexistentPluginMember

export function hostContracts(document: Document): void {
	const browserOwner: AstroBrowserResumption = browserResumption(document)
	browserOwner.resumeWhen(() => true)()
	requestResumption(new Request(`https://example.test`)).dispose()
	void resumableRenderer
}
