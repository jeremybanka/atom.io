import { defineConfig } from "astro/config"
import resumable from "resumability/astro"

export default defineConfig({ integrations: [resumable()] })
