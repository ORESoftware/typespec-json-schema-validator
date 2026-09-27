import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FLAGS2ENV_REBUILD_COMMAND,
  flags2envBootstrapMessage,
  isUnavailableFlags2envNativeBinding,
  loadCliEntrypoints,
} from '../../src/cli-bootstrap.mjs';

function missingBindingError() {
  return new Error(
    "Cannot find module './build/Release/flags2env.node'\n" +
      'Require stack:\n' +
      '- /tmp/node_modules/@oresoftware/f2e/clients/nodejs/lib.mjs',
  );
}

test('detects the missing flags2env native binding through nested causes', () => {
  const error = new Error('CLI bootstrap failed', {
    cause: new Error('parser import failed', {
      cause: missingBindingError(),
    }),
  });

  assert.equal(isUnavailableFlags2envNativeBinding(error), true);
});

test('does not classify unrelated module failures as flags2env bootstrap failures', () => {
  assert.equal(
    isUnavailableFlags2envNativeBinding(new Error("Cannot find package '@typespec/compiler'")),
    false,
  );
});

test('bootstrap message contains the approved single-package native rebuild', () => {
  const message = flags2envBootstrapMessage();

  assert.match(message, /@oresoftware\/f2e native parser is unavailable/u);
  assert.ok(message.includes(FLAGS2ENV_REBUILD_COMMAND));
  assert.equal(
    FLAGS2ENV_REBUILD_COMMAND,
    'npm rebuild @oresoftware/f2e --foreground-scripts --no-audit --no-fund',
  );
});

test('entrypoint loader converts missing native binding into actionable typed error', async () => {
  await assert.rejects(
    loadCliEntrypoints({
      cliUrl: 'test:cli',
      configUrl: 'test:config',
      importer: async (url) => {
        if (url === 'test:cli') {
          throw missingBindingError();
        }

        return { runConfigCommand() {} };
      },
    }),
    (error) => {
      assert.equal(error.code, 'TJSV_FLAGS2ENV_NATIVE_UNAVAILABLE');
      assert.ok(error.message.includes(FLAGS2ENV_REBUILD_COMMAND));
      assert.equal(error.cause instanceof Error, true);
      return true;
    },
  );
});

test('entrypoint loader preserves unrelated import failures unchanged', async () => {
  const failure = new Error('unrelated import failure');

  await assert.rejects(
    loadCliEntrypoints({
      cliUrl: 'test:cli',
      configUrl: 'test:config',
      importer: async (url) => {
        if (url === 'test:cli') {
          throw failure;
        }

        return { runConfigCommand() {} };
      },
    }),
    (error) => {
      assert.equal(error, failure);
      return true;
    },
  );
});

test('entrypoint loader returns both public CLI entrypoints on success', async () => {
  const main = () => 0;
  const runConfigCommand = () => 0;
  const result = await loadCliEntrypoints({
    cliUrl: 'test:cli',
    configUrl: 'test:config',
    importer: async (url) => {
      if (url === 'test:cli') {
        return { main };
      }

      return { runConfigCommand };
    },
  });

  assert.equal(result.main, main);
  assert.equal(result.runConfigCommand, runConfigCommand);
});
