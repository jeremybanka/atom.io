#!/usr/bin/env node

import { rmSync } from "node:fs"

rmSync(`.astro/dev.json`, { force: true })
