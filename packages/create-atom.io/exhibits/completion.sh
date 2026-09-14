#!/usr/bin/env bash

# Install the command on PATH. Package-manager create wrappers do not load these
# completions themselves.
npm install --global create-atom.io@latest

# Choose only the integration you use, then open a new shell.
# Bash needs Bash 4+ and bash-completion 2.18+ enabled.
create-atom.io completion install bash

# Alternatives:
# create-atom.io completion install zsh
# create-atom.io completion install fish
# create-atom.io completion install nushell
# create-atom.io completion install carapace

# Print an integration file instead of installing it:
# create-atom.io completion bash

# To create a project whose directory name collides with a completion command:
# create-atom.io -- completion
