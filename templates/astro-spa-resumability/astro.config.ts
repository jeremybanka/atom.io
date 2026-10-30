import spa from "@atom.io/spa/astro"
import { defineConfig } from "astro/config"
import resumability from "resumability/astro"

export default defineConfig({ integrations: [resumability(), spa()] })
