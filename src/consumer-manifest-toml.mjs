export class ConsumerManifestSyntaxError extends Error {
  constructor(message, manifest, line) {
    super(message);
    this.name = 'ConsumerManifestSyntaxError';
    this.manifest = manifest;
    this.line = line;
  }
}

function fail(message, manifest, line) {
  throw new ConsumerManifestSyntaxError(message, manifest, line);
}

function record() {
  return Object.create(null);
}

function stripComment(line) {
  let quote = null;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}

function parseValue(raw, manifest, line) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) {
      fail('invalid TOML basic string', manifest, line);
    }
    try {
      return JSON.parse(value);
    } catch {
      fail('invalid TOML basic string', manifest, line);
    }
  }
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) {
      fail('invalid TOML literal string', manifest, line);
    }
    const inner = value.slice(1, -1);
    if (inner.includes("'")) fail('invalid TOML literal string', manifest, line);
    return inner;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^[+-]?(?:0|[1-9](?:_?\d)*)$/u.test(value)) {
    const parsed = Number(value.replaceAll('_', ''));
    if (Number.isSafeInteger(parsed)) return parsed;
    fail('integer is outside the safe integer range', manifest, line);
  }
  fail('manifest v1 accepts only strings, booleans, and integers', manifest, line);
}

function put(target, key, value, manifest, line) {
  if (Object.hasOwn(target, key)) fail(`duplicate key ${key}`, manifest, line);
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

export function parseConsumerManifestToml(text, manifest = '.ores-tjsv.toml') {
  const result = record();
  result.contracts = [];
  let target = result;
  const lines = String(text)
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const line = stripComment(lines[i]).trim();
    if (line === '') continue;
    if (line === '[[contracts]]') {
      target = record();
      result.contracts.push(target);
      continue;
    }
    const table = line.match(/^\[([a-z_][a-z0-9_]*)\]$/u);
    if (table) {
      if (!['authority', 'defaults'].includes(table[1])) {
        fail(`unsupported table [${table[1]}]`, manifest, lineNo);
      }
      if (Object.hasOwn(result, table[1])) fail(`duplicate table [${table[1]}]`, manifest, lineNo);
      target = record();
      result[table[1]] = target;
      continue;
    }
    const assignment = line.match(/^([a-z_][a-z0-9_]*)\s*=\s*(.+)$/u);
    if (!assignment) fail('unsupported TOML syntax', manifest, lineNo);
    put(target, assignment[1], parseValue(assignment[2], manifest, lineNo), manifest, lineNo);
  }
  return result;
}
