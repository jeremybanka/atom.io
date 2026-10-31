import { defineConfig } from "astro/config"
import resumability from "resumability/astro"

export default defineConfig({ integrations: [resumability()] })
