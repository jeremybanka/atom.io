import resumable from "@atom.io/resumable/astro"
import { defineConfig } from "astro/config"

export default defineConfig({ integrations: [resumable()] })
