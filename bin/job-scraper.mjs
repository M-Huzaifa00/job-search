#!/usr/bin/env node
// Thin launcher so `npx job-scraper ...` / `npm link` work. Node >= 22.18 runs the TypeScript source directly.
import '../src/cli.ts';
