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
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      fail('invalid TOML basic string', manifest, line);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
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
  target[key] = value;
}

export function parseConsumerManifestToml(text, manifest = '.ores-tjsv.toml') {
  const result = { contracts: [] };
  let target = result;
  let section = 'root';
  const lines = String(text).replace(/\r\n?/gu, '\n').split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const line = stripComment(lines[i]).trim();
    if (line === '') continue;
    if (line === '[[contracts]]') {
      target = {};
      result.contracts.push(target);
      section = 'contracts';
      continue;
    }
    const table = line.match(/^\[([a-z_][a-z0-9_]*)\]$/u);
    if (table) {
      if (!['authority', 'defaults'].includes(table[1])) {
        fail(`unsupported table [${table[1]}]`, manifest, lineNo);
      }
      if (Object.hasOwn(result, table[1])) fail(`duplicate table [${table[1]}]`, manifest, lineNo);
      target = {};
      result[table[1]] = target;
      section = table[1];
      continue;
    }
    const assignment = line.match(/^([a-z_][a-z0-9_]*)\s*=\s*(.+)$/u);
    if (!assignment) fail('unsupported TOML syntax', manifest, lineNo);
    put(target, assignment[1], parseValue(assignment[2], manifest, lineNo), manifest, lineNo);
    Object.defineProperty(target, '__section', { value: section, enumerable: false, configurable: true });
  }
  return result;
}
