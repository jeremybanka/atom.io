#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# This experiment is deliberately outside the workspace package graph.
npm ci --ignore-scripts --no-audit --no-fund
npm run check
REPEATS=5 CASES=store-200 PROFILES=slow4g VARIANTS=spa-eager,spa-preload,spa-islands,qwik-default,resume-cold,resume-preload OUTPUT=results-main.json node benchmark.mjs
REPEATS=3 CASES=store-12,store-1000 PROFILES=slow4g VARIANTS=spa-eager,resume-cold,resume-preload OUTPUT=results-scale.json node benchmark.mjs
node early.mjs
node bench-ssr.mjs
node summarize.mjs results-main.json > summary-main.json
node summarize.mjs results-scale.json > summary-scale.json
