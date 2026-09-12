#!/usr/bin/env node
import { main } from '../src/cli.mjs';

const argv = [process.argv[0], process.argv[1], 'legal-rollout', ...process.argv.slice(2)];
process.exitCode = await main(argv, process.env);
