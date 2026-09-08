import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { sha256 } from './canonical.mjs';

const DATA_DECLARATION_KINDS = new Set(['alias', 'enum', 'model', 'scalar', 'union']);
const NON_SCHEMA_DECLARATION_KINDS = new Set(['const', 'dec', 'fn', 'interface', 'op']);
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.typespec-json-schema-validator',
  'dist',
  'generated',
  'node_modules',
  'out',
  'target',
  'temp',
  'tmp',
]);

// Mirror the official TypeSpec scanner's identifier profile: ASCII identifiers
// use letters, `_`, and `$` (plus digits after the first character); every
// assigned non-ASCII code point is accepted except controls, private-use and
// surrogate code points, noncharacters, Pattern_White_Space, U+FFFD, and
// unassigned code points. This is intentionally broader than JavaScript's
// `ID_Start` / `ID_Continue` profile because TypeSpec also supports emoji and
// other assigned Unicode code points.
const DISALLOWED_NON_ASCII_IDENTIFIER =
  /[\p{Control}\p{Private_Use}\p{Surrogate}\p{Noncharacter_Code_Point}\p{Pattern_White_Space}\p{Unassigned}]/u;

function identifierCodePointLength(source, offset, allowAsciiDigit) {
  const codePoint = source.codePointAt(offset);
  if (codePoint === undefined) {
    return 0;
  }
  if (codePoint <= 0x7f) {
    const character = String.fromCodePoint(codePoint);
    const valid = /[A-Za-z_$]/u.test(character) || (allowAsciiDigit && /[0-9]/u.test(character));
    return valid ? 1 : 0;
  }
  if (codePoint === 0xfffd) {
    return 0;
  }
  const character = String.fromCodePoint(codePoint);
  return DISALLOWED_NON_ASCII_IDENTIFIER.test(character) ? 0 : character.length;
}

function scanIdentifier(source, offset) {
  let cursor = offset;
  let width = identifierCodePointLength(source, cursor, false);
  if (width === 0) {
    return null;
  }
  cursor += width;
  while (cursor < source.length) {
    width = identifierCodePointLength(source, cursor, true);
    if (width === 0) {
      break;
    }
    cursor += width;
  }
  return source.slice(offset, cursor);
}

function decodeQuoted(raw, quote) {
  if (quote === '`') {
    return raw;
  }
  try {
    return JSON.parse(`"${raw.replaceAll('"', '\\"')}"`);
  } catch {
    return raw;
  }
}

export function lexTypeSpec(source, file = '<memory>') {
  const tokens = [];
  const errors = [];
  let index = 0;
  let line = 1;
  let column = 1;

  function advance() {
    const character = source[index];
    index += 1;
    if (character === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    return character;
  }

  function push(kind, value, startIndex, startLine, startColumn, extra = {}) {
    tokens.push({ kind, value, index: startIndex, line: startLine, column: startColumn, file, ...extra });
  }

  while (index < source.length) {
    const character = source[index];

    if (/\s/u.test(character)) {
      advance();
      continue;
    }

    if (character === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') {
        advance();
      }
      continue;
    }

    if (character === '/' && source[index + 1] === '*') {
      const startLine = line;
      const startColumn = column;
      advance();
      advance();
      let closed = false;
      while (index < source.length) {
        if (source[index] === '*' && source[index + 1] === '/') {
          advance();
          advance();
          closed = true;
          break;
        }
        advance();
      }
      if (!closed) {
        errors.push({
          code: 'unterminated-block-comment',
          file,
          line: startLine,
          column: startColumn,
          message: 'unterminated TypeSpec block comment',
        });
      }
      continue;
    }

    if (character === '"' && source.slice(index, index + 3) === '"""') {
      const startIndex = index;
      const startLine = line;
      const startColumn = column;
      advance();
      advance();
      advance();
      let raw = '';
      let closed = false;
      while (index < source.length) {
        if (source.slice(index, index + 3) === '"""') {
          advance();
          advance();
          advance();
          closed = true;
          break;
        }
        raw += advance();
      }
      if (!closed) {
        errors.push({
          code: 'unterminated-string',
          file,
          line: startLine,
          column: startColumn,
          message: 'unterminated TypeSpec triple-quoted string',
        });
      }
      push('string', raw, startIndex, startLine, startColumn, { tripleQuoted: true });
      continue;
    }

    if (character === '"' || character === "'") {
      const quote = character;
      const startIndex = index;
      const startLine = line;
      const startColumn = column;
      advance();
      let raw = '';
      let closed = false;
      while (index < source.length) {
        const current = advance();
        if (current === '\\' && index < source.length) {
          raw += current;
          raw += advance();
          continue;
        }
        if (current === quote) {
          closed = true;
          break;
        }
        raw += current;
      }
      if (!closed) {
        errors.push({
          code: 'unterminated-string',
          file,
          line: startLine,
          column: startColumn,
          message: 'unterminated TypeSpec string literal',
        });
      }
      push('string', decodeQuoted(raw, quote), startIndex, startLine, startColumn, { quote });
      continue;
    }

    if (character === '`') {
      const startIndex = index;
      const startLine = line;
      const startColumn = column;
      advance();
      let raw = '';
      let closed = false;
      while (index < source.length) {
        const current = advance();
        if (current === '\\' && index < source.length) {
          raw += advance();
          continue;
        }
        if (current === '`') {
          closed = true;
          break;
        }
        raw += current;
      }
      if (!closed) {
        errors.push({
          code: 'unterminated-escaped-identifier',
          file,
          line: startLine,
          column: startColumn,
          message: 'unterminated TypeSpec escaped identifier',
        });
      }
      push('identifier', raw, startIndex, startLine, startColumn, { escaped: true });
      continue;
    }

    const identifier = scanIdentifier(source, index);
    if (identifier !== null) {
      const startIndex = index;
      const startLine = line;
      const startColumn = column;
      for (let offset = 0; offset < identifier.length; offset += 1) {
        advance();
      }
      push('identifier', identifier, startIndex, startLine, startColumn);
      continue;
    }

    if (/[0-9]/u.test(character)) {
      const startIndex = index;
      const startLine = line;
      const startColumn = column;
      let value = advance();
      while (index < source.length && /[0-9A-Fa-f_xX.+-]/u.test(source[index])) {
        value += advance();
      }
      push('number', value, startIndex, startLine, startColumn);
      continue;
    }

    const startIndex = index;
    const startLine = line;
    const startColumn = column;
    const three = source.slice(index, index + 3);
    if (three === '...') {
      advance();
      advance();
      advance();
      push('punctuation', three, startIndex, startLine, startColumn);
      continue;
    }
    const two = source.slice(index, index + 2);
    if (['::', '=>', '&&', '||', '==', '!=', '<=', '>=', '@@'].includes(two)) {
      advance();
      advance();
      push('punctuation', two, startIndex, startLine, startColumn);
      continue;
    }
    advance();
    push('punctuation', character, startIndex, startLine, startColumn);
  }

  return { tokens, errors };
}

function combineNamespace(parent, child) {
  if (!parent) {
    return child;
  }
  if (!child) {
    return parent;
  }
  return `${parent}.${child}`;
}

function readQualifiedIdentifier(tokens, startIndex) {
  const first = tokens[startIndex];
  if (!first || first.kind !== 'identifier') {
    return null;
  }
  const parts = [first.value];
  let index = startIndex + 1;
  while (
    tokens[index]?.kind === 'punctuation' &&
    tokens[index]?.value === '.' &&
    tokens[index + 1]?.kind === 'identifier'
  ) {
    parts.push(tokens[index + 1].value);
    index += 2;
  }
  return { value: parts.join('.'), nextIndex: index };
}

export function inventoryTypeSpecSource(source, file = '<memory>') {
  const { tokens, errors } = lexTypeSpec(source, file);
  const declarations = [];
  const outOfScopeDeclarations = [];
  const imports = [];
  const contexts = [];
  let rootNamespace = '';
  let pendingOpen = null;

  function topContext() {
    return contexts.at(-1);
  }

  function allowedDeclarationContext() {
    const top = topContext();
    return top === undefined || top.kind === 'namespace';
  }

  function activeNamespace() {
    const topNamespace = [...contexts].reverse().find((context) => context.kind === 'namespace');
    return topNamespace?.effectiveNamespace ?? topNamespace?.namespace ?? rootNamespace;
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.kind === 'identifier' && token.value === 'import') {
      const imported = tokens[index + 1];
      if (imported?.kind === 'string') {
        imports.push({ specifier: imported.value, file, line: imported.line, column: imported.column });
      }
    }

    if (token.kind === 'identifier' && token.value === 'namespace' && allowedDeclarationContext()) {
      const qualified = readQualifiedIdentifier(tokens, index + 1);
      if (!qualified) {
        errors.push({
          code: 'namespace-name-missing',
          file,
          line: token.line,
          column: token.column,
          message: 'namespace declaration is missing an identifier',
        });
        continue;
      }
      const terminator = tokens[qualified.nextIndex];
      const parent = activeNamespace();
      const fullNamespace = combineNamespace(parent, qualified.value);
      if (terminator?.value === ';') {
        const top = topContext();
        if (top?.kind === 'namespace') {
          top.effectiveNamespace = fullNamespace;
        } else {
          rootNamespace = fullNamespace;
        }
      } else if (terminator?.value === '{') {
        pendingOpen = {
          kind: 'namespace',
          namespace: fullNamespace,
          effectiveNamespace: fullNamespace,
          file,
          line: token.line,
          column: token.column,
        };
      } else {
        errors.push({
          code: 'unsupported-namespace-form',
          file,
          line: token.line,
          column: token.column,
          message: `namespace ${qualified.value} is not followed by ';' or '{'`,
        });
      }
      index = qualified.nextIndex - 1;
      continue;
    }

    if (
      token.kind === 'identifier' &&
      (DATA_DECLARATION_KINDS.has(token.value) || NON_SCHEMA_DECLARATION_KINDS.has(token.value)) &&
      allowedDeclarationContext()
    ) {
      const nameToken = tokens[index + 1];
      if (!nameToken || nameToken.kind !== 'identifier') {
        errors.push({
          code: 'declaration-name-missing',
          file,
          line: token.line,
          column: token.column,
          message: `${token.value} declaration is missing an identifier`,
        });
        continue;
      }
      const namespace = activeNamespace();
      const declaration = {
        kind: token.value,
        name: nameToken.value,
        qualifiedName: combineNamespace(namespace, nameToken.value),
        namespace,
        file,
        line: token.line,
        column: token.column,
      };
      if (DATA_DECLARATION_KINDS.has(token.value)) {
        declarations.push(declaration);
      } else {
        outOfScopeDeclarations.push({ ...declaration, reason: 'not representable as a JSON Schema declaration' });
      }
      pendingOpen = {
        kind: 'declaration',
        declaration: declaration.qualifiedName,
        file,
        line: token.line,
        column: token.column,
      };
      index += 1;
      continue;
    }

    if (token.kind === 'punctuation' && token.value === '{') {
      contexts.push(pendingOpen ?? { kind: 'other', file, line: token.line, column: token.column });
      pendingOpen = null;
      continue;
    }

    if (token.kind === 'punctuation' && token.value === ';') {
      pendingOpen = null;
      continue;
    }

    if (token.kind === 'punctuation' && token.value === '}') {
      if (contexts.length === 0) {
        errors.push({
          code: 'unmatched-closing-brace',
          file,
          line: token.line,
          column: token.column,
          message: 'unmatched closing brace in TypeSpec source',
        });
      } else {
        contexts.pop();
      }
      pendingOpen = null;
    }
  }

  if (contexts.length > 0) {
    for (const context of contexts) {
      errors.push({
        code: 'unclosed-brace',
        file,
        line: context.line,
        column: context.column,
        message: `unclosed ${context.kind} block in TypeSpec source`,
      });
    }
  }

  return { declarations, outOfScopeDeclarations, imports, errors, tokens };
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveRelativeImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) {
    return null;
  }
  const base = resolve(dirname(fromFile), specifier);
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.tsp`, join(base, 'main.tsp')];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      const candidateStat = await stat(candidate);
      if (candidateStat.isFile()) {
        return candidate;
      }
    }
  }
  return null;
}

async function collectDirectoryTypeSpecFiles(root, output = []) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        await collectDirectoryTypeSpecFiles(path, output);
      }
    } else if (entry.isFile() && entry.name.endsWith('.tsp')) {
      output.push(path);
    }
  }
  return output;
}

async function collectImportedFiles(entry) {
  const visited = new Set();
  const pending = [resolve(entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file)) {
      continue;
    }
    visited.add(file);
    const source = await readFile(file, 'utf8');
    const inventory = inventoryTypeSpecSource(source, file);
    for (const imported of inventory.imports) {
      const resolvedImport = await resolveRelativeImport(file, imported.specifier);
      if (resolvedImport && !visited.has(resolvedImport)) {
        pending.push(resolvedImport);
      }
    }
  }
  return [...visited].sort();
}

export async function inventoryTypeSpec(inputPath) {
  const absoluteInput = resolve(inputPath);
  const inputStat = await stat(absoluteInput);
  const projectRoot = inputStat.isDirectory() ? absoluteInput : dirname(absoluteInput);
  const files = inputStat.isDirectory()
    ? await collectDirectoryTypeSpecFiles(absoluteInput)
    : await collectImportedFiles(absoluteInput);

  if (files.length === 0) {
    throw new Error(`no TypeSpec files found under ${absoluteInput}`);
  }

  const declarations = [];
  const outOfScopeDeclarations = [];
  const errors = [];
  const sources = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const inventory = inventoryTypeSpecSource(source, file);
    declarations.push(...inventory.declarations);
    outOfScopeDeclarations.push(...inventory.outOfScopeDeclarations);
    errors.push(...inventory.errors);
    sources.push({
      path: relative(projectRoot, file).replaceAll('\\', '/') || 'main.tsp',
      sha256: sha256(source),
      content: source,
    });
  }

  const qualifiedNames = new Map();
  const simpleNames = new Map();
  for (const declaration of declarations) {
    if (qualifiedNames.has(declaration.qualifiedName)) {
      errors.push({
        code: 'duplicate-qualified-declaration',
        file: declaration.file,
        line: declaration.line,
        column: declaration.column,
        message: `duplicate TypeSpec declaration ${declaration.qualifiedName}`,
      });
    } else {
      qualifiedNames.set(declaration.qualifiedName, declaration);
    }
    const existing = simpleNames.get(declaration.name) ?? [];
    existing.push(declaration);
    simpleNames.set(declaration.name, existing);
  }

  const ambiguities = [];
  for (const [name, candidates] of [...simpleNames.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const qualified = [...new Set(candidates.map((candidate) => candidate.qualifiedName))].sort();
    if (qualified.length > 1) {
      ambiguities.push({
        name,
        qualifiedNames: qualified,
        message: `simple declaration name ${name} is ambiguous across namespaces: ${qualified.join(', ')}`,
      });
    }
  }

  const digestMaterial = sources
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((source) => `${source.path}\0${source.content}`)
    .join('\0');

  return {
    input: absoluteInput,
    projectRoot,
    files: sources.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
    digest: sha256(digestMaterial),
    declarations: declarations.sort((left, right) => left.qualifiedName.localeCompare(right.qualifiedName)),
    outOfScopeDeclarations: outOfScopeDeclarations.sort((left, right) =>
      left.qualifiedName.localeCompare(right.qualifiedName),
    ),
    errors,
    ambiguities,
  };
}

export function declarationKindFamily(kind) {
  if (kind === 'alias' || kind === 'scalar') {
    return 'scalar-like';
  }
  return kind;
}
