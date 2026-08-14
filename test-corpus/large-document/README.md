# Large-document corpus

This harness pins Project Gutenberg ebook #100, _The Complete Works of William Shakespeare_, for large collaborative-document tests without adding its 5.6 MB payload or generated variants to git.

`pnpm corpus:large:prepare` is the clean-checkout preparation command. It downloads only the digest-pinned first-party GitHub Release asset into the external user cache, then verifies the byte count and SHA-256 before accepting it. Live Gutenberg access happens only when an operator explicitly adds the `--source=upstream` option while refreshing the corpus.

`pnpm corpus:large:verify` requires the corpus and fails if it is absent or invalid. Adding `--if-present` makes absence an intentional, successful `SKIPPED` result while corruption remains a failure. `pnpm test:large-document` requires the corpus, re-verifies it before parsing, derives all variants, compares every byte count and digest with the manifest, and reports the results.

Set `ATOM_IO_LARGE_DOCUMENT_CACHE` to choose another cache root. The default is the platform's user cache directory, outside this repository. The workflow uses a runner-temporary cache whose key contains both corpus identity and digest; a restored entry is always re-verified.

The manifest records the canonical landing and source URLs, provenance, retrieval date, byte and line counts, digest, first-party mirror, and public-domain note. Project Gutenberg identifies this edition as public domain in the United States. Users elsewhere remain responsible for their jurisdiction.

Generated variants cover heading-heavy Markdown, a single enormous paragraph, a single enormous fenced block, repeated content beyond 50 MiB, and adversarial Unicode/grapheme sequences. Generated files and their deterministic report stay in the external cache.
