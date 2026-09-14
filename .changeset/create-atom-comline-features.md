---
"create-atom.io": minor
---

Upgrade comline to 0.7.0, display warnings for ignored options, accept kebab-case option aliases and --template, and add opt-in shell completion for the installed create-atom.io command. Preserve existing camelCase options, short flags, and the create-atom.config.json filename while adopting standard runtime argument and -- delimiter handling.

Completion reserves the completion and hidden protocol command names at the start of an invocation. To create a directory with one of those names, put -- before the directory name.
