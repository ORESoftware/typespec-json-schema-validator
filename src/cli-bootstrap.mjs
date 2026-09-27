export const FLAGS2ENV_REBUILD_COMMAND =
  'npm rebuild @oresoftware/f2e --foreground-scripts --no-audit --no-fund';

const FLAGS2ENV_NATIVE_MARKERS = Object.freeze([
  'flags2env.node',
  '@oresoftware/f2e',
]);

function errorMessages(error) {
  const messages = [];
  const seen = new Set();
  let current = error;

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (typeof current.message === 'string') {
      messages.push(current.message);
    }
    current = current.cause;
  }

  return messages;
}

export function isUnavailableFlags2envNativeBinding(error) {
  const messages = errorMessages(error);

  return messages.some((message) =>
    FLAGS2ENV_NATIVE_MARKERS.every((marker) => message.includes(marker)) ||
    message.includes("Cannot find module './build/Release/flags2env.node'"),
  );
}

export function flags2envBootstrapMessage() {
  return [
    'tjsv: @oresoftware/f2e native parser is unavailable.',
    'The package was likely installed with lifecycle scripts disabled before the reviewed native dependency was rebuilt.',
    `Rebuild only the approved native parser dependency with: ${FLAGS2ENV_REBUILD_COMMAND}`,
  ].join(' ');
}

export async function loadCliEntrypoints({ cliUrl, configUrl, importer = importModule }) {
  try {
    const [cliModule, configModule] = await Promise.all([
      importer(cliUrl),
      importer(configUrl),
    ]);

    return {
      main: cliModule.main,
      runConfigCommand: configModule.runConfigCommand,
    };
  } catch (error) {
    if (!isUnavailableFlags2envNativeBinding(error)) {
      throw error;
    }

    const bootstrapError = new Error(flags2envBootstrapMessage(), { cause: error });
    bootstrapError.code = 'TJSV_FLAGS2ENV_NATIVE_UNAVAILABLE';
    throw bootstrapError;
  }
}

async function importModule(url) {
  return import(url);
}
