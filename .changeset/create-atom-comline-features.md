---
"create-atom.io": minor
---

Upgrade comline to 0.7.0, display warnings for ignored options, accept kebab-case option aliases and --template, and add opt-in shell completion for the installed create-atom.io command. Preserve existing camelCase options and short flags while adopting standard runtime argument and -- delimiter handling.

Completion reserves the completion and hidden protocol command names at the start of an invocation. To create a directory with one of those names, put -- before the directory name.

Disable automatic config-file discovery. Supply options through command-line arguments or interactive prompts instead of create-atom.config.json.
