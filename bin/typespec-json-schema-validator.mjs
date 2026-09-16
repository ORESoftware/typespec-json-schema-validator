#!/usr/bin/env node
import { main } from '../src/cli.mjs';
import { runConfigCommand } from '../src/config-cli.mjs';

process.exitCode = process.argv[2] === 'config'
  ? await runConfigCommand(process.argv)
  : await main(process.argv);
