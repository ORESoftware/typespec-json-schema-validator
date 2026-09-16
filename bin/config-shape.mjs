#!/usr/bin/env node

import { runConfigCommand } from '../src/config-cli.mjs';

// `tjsv-config` is a compatibility entrypoint only. The root `.cli-flags.toml`
// remains the sole argv/env/type/default authority; inject the canonical
// `config` command and delegate all parsing/execution to the shared runner.
const argv = [process.argv[0], process.argv[1], 'config', ...process.argv.slice(2)];
process.exitCode = await runConfigCommand(argv);
