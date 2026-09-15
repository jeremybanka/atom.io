---
"create-atom.io": patch
---

Upgrade comline to 0.7.0, report ignored options on stderr, and accept kebab-case option aliases and --template alongside existing camelCase options and short flags. Honor the -- delimiter so project directory names can be passed literally.

Simplify the CLI implementation with shared utilities and tests for both one-shot and interactive use. Remove the programmatic createAtom entry point and automatic config-file discovery; create projects through the CLI and supply options through flags or interactive prompts.
