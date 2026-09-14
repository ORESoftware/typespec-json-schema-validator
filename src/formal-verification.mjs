import { spawnSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { compile, NodeHost } from '@typespec/compiler';

import {
  behaviorByOperation,
  behaviorContractDigest,
  normalizeBehaviorContract,
} from './behavior-contract.mjs';
import { canonicalStringify, isPlainObject, sha256, stableFindingFingerprint } from './canonical.mjs';
import { getTypeSpecBehavior, getTypeSpecBehaviorRef } from './typespec-behavior.mjs';

export const FORMAL_MANIFEST_SCHEMA =
  'ores.typespec-json-schema-validator.formal-manifest/v1';
export const FORMAL_AUTHORITY = 'independently-authored-formal-authority';
export const FORMAL_VERIFICATION_RECEIPT_SCHEMA =
  'ores.typespec-json-schema-validator.formal-verification-receipt/v1';

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export class FormalVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FormalVerificationError';
  }
}

function fail(message) {
  throw new FormalVerificationError(message);
}

function exactKeys(value, keys, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    fail(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${label} must be a non-empty string`);
  if (/[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must not contain control characters`);
  return value;
}

function normalizedRelativePath(value, label) {
  const path = nonEmptyString(value, label);
  if (path.includes('\\') || path.startsWith('/') || path.endsWith('/') || path.includes('//')) {
    fail(`${label} must be a normalized relative POSIX path`);
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(`${label} must be a normalized relative POSIX path`);
  }
  if (!path.endsWith('.dfy')) fail(`${label} must name a .dfy file`);
  return path;
}

function normalizeFormalOperation(value, index) {
  const label = `manifest.operations[${index}]`;
  exactKeys(value, [
    'operationId', 'language', 'source', 'module', 'symbol', 'sourceSha256', 'verifyIncludedFiles',
  ], label);
  const operationId = nonEmptyString(value.operationId, `${label}.operationId`);
  if (value.language !== 'dafny') fail(`${label}.language must be dafny`);
  const module = nonEmptyString(value.module, `${label}.module`);
  const symbol = nonEmptyString(value.symbol, `${label}.symbol`);
  if (!module.split('.').every((part) => IDENTIFIER.test(part))) fail(`${label}.module is not a valid Dafny module path`);
  if (!IDENTIFIER.test(symbol)) fail(`${label}.symbol is not a valid Dafny identifier`);
  if (!DIGEST.test(value.sourceSha256 ?? '')) fail(`${label}.sourceSha256 must be sha256:<64 lowercase hex>`);
  if (typeof value.verifyIncludedFiles !== 'boolean') fail(`${label}.verifyIncludedFiles must be boolean`);
  return Object.freeze({
    operationId,
    language: 'dafny',
    source: normalizedRelativePath(value.source, `${label}.source`),
    module,
    symbol,
    sourceSha256: value.sourceSha256,
    verifyIncludedFiles: value.verifyIncludedFiles,
  });
}

export function normalizeFormalManifest(value) {
  exactKeys(value, ['schema', 'authority', 'behaviorContractDigest', 'operations'], 'manifest');
  if (value.schema !== FORMAL_MANIFEST_SCHEMA) fail('manifest.schema is unsupported');
  if (value.authority !== FORMAL_AUTHORITY) fail('manifest.authority is unsupported');
  if (!DIGEST.test(value.behaviorContractDigest ?? '')) {
    fail('manifest.behaviorContractDigest must be sha256:<64 lowercase hex>');
  }
  if (!Array.isArray(value.operations) || value.operations.length === 0) {
    fail('manifest.operations must be a non-empty array');
  }
  const operations = value.operations.map(normalizeFormalOperation);
  const ids = operations.map((item) => item.operationId);
  if (new Set(ids).size !== ids.length) fail('manifest.operations contains duplicate operationId values');
  const proofTargets = operations.map((item) => `${item.source}\u0000${item.module}\u0000${item.symbol}`);
  if (new Set(proofTargets).size !== proofTargets.length) {
    fail('manifest.operations contains duplicate source/module/symbol proof targets');
  }
  return Object.freeze({
    schema: FORMAL_MANIFEST_SCHEMA,
    authority: FORMAL_AUTHORITY,
    behaviorContractDigest: value.behaviorContractDigest,
    operations: Object.freeze(operations.sort((a, b) => a.operationId.localeCompare(b.operationId))),
  });
}

export function formalManifestDigest(value) {
  return `sha256:${sha256(canonicalStringify(normalizeFormalManifest(value)))}`;
}

export function behaviorDigestForFormalVerification(value) {
  return `sha256:${behaviorContractDigest(value)}`;
}

function makeFinding(ruleId, message, pointer, extra = {}) {
  const finding = {
    ruleId,
    severity: 'error',
    resolutionState: 'unexplained',
    comparison: 'formal-verification',
    pointer,
    message,
    ...extra,
  };
  return Object.freeze({ ...finding, fingerprint: stableFindingFingerprint(finding) });
}

function typeName(program, type) {
  if (!type) return null;
  if (type.kind === 'Union' && type.variants instanceof Map) {
    const variants = [...type.variants.values()].map((variant) => variant.type);
    const nonNull = variants.filter((variant) => !(variant.kind === 'Intrinsic' && variant.name === 'null'));
    const nullable = nonNull.length !== variants.length;
    if (nonNull.length === 1) return { name: typeName(program, nonNull[0])?.name ?? null, nullable };
  }
  let name = typeof type.name === 'string' && type.name !== '' ? type.name : null;
  if (!name && typeof program?.checker?.getTypeName === 'function') {
    try {
      name = program.checker.getTypeName(type);
    } catch {
      name = null;
    }
  }
  return { name, nullable: false };
}

function sameType(expected, actual) {
  if (expected === actual) return true;
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  return expected.split('.').at(-1) === actual.split('.').at(-1);
}

function walkNamespaces(namespace, prefix = '', output = []) {
  for (const [name, operation] of namespace.operations ?? []) {
    output.push({ qualifiedName: prefix ? `${prefix}.${name}` : name, operation });
  }
  for (const [name, child] of namespace.namespaces ?? []) {
    walkNamespaces(child, prefix ? `${prefix}.${name}` : name, output);
  }
  return output;
}

export async function inspectTypeSpecBehaviorBindings(typespec, behaviorContract) {
  const contract = normalizeBehaviorContract(behaviorContract);
  const behaviors = behaviorByOperation(contract);
  const program = await compile(NodeHost, typespec, { noEmit: true, warningAsError: true });
  const findings = [];
  if (program.diagnostics.length > 0) {
    findings.push(makeFinding(
      'formal-typespec-diagnostics',
      'TypeSpec must compile without diagnostics before formal bindings are admitted',
      '#/typespec',
      { count: program.diagnostics.length },
    ));
    return { program, bindings: [], findings };
  }

  const bindings = [];
  for (const entry of walkNamespaces(program.getGlobalNamespaceType())) {
    const ref = getTypeSpecBehaviorRef(program, entry.operation);
    if (typeof ref !== 'string' || !behaviors.has(ref)) continue;
    const behavior = behaviors.get(ref);
    const embedded = getTypeSpecBehavior(program, entry.operation);
    const parameters = [...(entry.operation.parameters?.properties ?? new Map()).values()];
    const actualInputs = parameters.map((property) => ({
      name: property.name,
      type: typeName(program, property.type)?.name,
      required: property.optional !== true,
    }));
    const output = typeName(program, entry.operation.returnType);
    bindings.push(Object.freeze({ operationId: ref, qualifiedName: entry.qualifiedName }));

    if (actualInputs.length !== behavior.inputs.length) {
      findings.push(makeFinding(
        'formal-typespec-parameter-count-mismatch',
        `${ref} TypeSpec parameter count differs from its behavioral authority`,
        `#/operations/${ref}/inputs`,
      ));
    }
    for (let index = 0; index < Math.min(actualInputs.length, behavior.inputs.length); index += 1) {
      const actual = actualInputs[index];
      const expected = behavior.inputs[index];
      if (actual.name !== expected.name || actual.required !== expected.required || !sameType(expected.type, actual.type)) {
        findings.push(makeFinding(
          'formal-typespec-parameter-mismatch',
          `${ref} TypeSpec parameter ${index} differs from its behavioral authority`,
          `#/operations/${ref}/inputs/${index}`,
        ));
      }
    }
    if (behavior.output === null) {
      if (!['void', 'never'].includes(output?.name ?? '')) {
        findings.push(makeFinding(
          'formal-typespec-result-mismatch',
          `${ref} TypeSpec result differs from its behavioral authority`,
          `#/operations/${ref}/output`,
        ));
      }
    } else if (!sameType(behavior.output.type, output?.name) || behavior.output.nullable !== (output?.nullable === true)) {
      findings.push(makeFinding(
        'formal-typespec-result-mismatch',
        `${ref} TypeSpec result differs from its behavioral authority`,
        `#/operations/${ref}/output`,
      ));
    }
    if (embedded && canonicalStringify(embedded) !== canonicalStringify({
      kind: behavior.kind,
      language: behavior.language,
      executable: behavior.executable,
      inputs: [...behavior.inputs],
      output: behavior.output,
      requires: [...behavior.requires],
      ensures: [...behavior.ensures],
      invariants: [...behavior.invariants],
      expression: behavior.expression,
      algorithm: behavior.algorithm,
      effects: [...behavior.effects],
      errors: [...behavior.errors],
      deterministic: behavior.deterministic,
      idempotent: behavior.idempotent,
      pure: behavior.pure,
    })) {
      findings.push(makeFinding(
        'formal-typespec-embedded-behavior-drift',
        `${ref} embeds behavior that differs from the independently authored behavioral authority`,
        `#/operations/${ref}`,
      ));
    }
  }

  for (const behavior of contract.operations.filter((operation) => operation.language === 'dafny')) {
    const matches = bindings.filter((binding) => binding.operationId === behavior.operationId);
    if (matches.length !== 1) {
      findings.push(makeFinding(
        matches.length === 0 ? 'formal-typespec-binding-missing' : 'formal-typespec-binding-ambiguous',
        `${behavior.operationId} must bind to exactly one TypeSpec operation`,
        `#/operations/${behavior.operationId}`,
        { bindings: matches.length },
      ));
    }
  }
  return { program, bindings: Object.freeze(bindings), findings: Object.freeze(findings) };
}

async function readProofSource(root, item) {
  const absoluteRoot = resolve(root);
  const path = resolve(absoluteRoot, item.source);
  const local = relative(absoluteRoot, path);
  if (local === '' || local === '..' || isAbsolute(local) || local.startsWith('../') || local.startsWith('..\\')) {
    throw new FormalVerificationError('formal source escaped the trusted root');
  }
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new FormalVerificationError(`${item.source} must be a singly linked regular non-symlink file`);
  }
  const text = await readFile(path, 'utf8');
  return { path, text, digest: `sha256:${sha256(text)}` };
}

function dafnySymbolPresent(text, moduleName, symbol) {
  const escapedModule = moduleName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const modulePattern = new RegExp(`\\bmodule\\s+${escapedModule.split('.').at(-1)}\\b`, 'u');
  const symbolPattern = new RegExp(`\\b(?:method|function|predicate|lemma)\\s+(?:ghost\\s+)?${escapedSymbol}\\b`, 'u');
  return modulePattern.test(text) && symbolPattern.test(text);
}

function commandEvidence(result) {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return Object.freeze({
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal ?? null,
    stdoutSha256: `sha256:${sha256(stdout)}`,
    stderrSha256: `sha256:${sha256(stderr)}`,
  });
}

export async function verifyFormalContract({
  root = '.',
  typespec,
  behaviorContract,
  manifest,
  dafnyBin = 'dafny',
} = {}) {
  const contract = normalizeBehaviorContract(behaviorContract);
  const normalizedManifest = normalizeFormalManifest(manifest);
  const findings = [];
  const expectedBehaviorDigest = behaviorDigestForFormalVerification(contract);
  if (normalizedManifest.behaviorContractDigest !== expectedBehaviorDigest) {
    findings.push(makeFinding(
      'formal-behavior-digest-mismatch',
      'formal manifest is not bound to the supplied behavioral authority',
      '#/manifest/behaviorContractDigest',
    ));
  }

  const behaviors = behaviorByOperation(contract);
  for (const item of normalizedManifest.operations) {
    const behavior = behaviors.get(item.operationId);
    if (!behavior) {
      findings.push(makeFinding('formal-operation-missing', `${item.operationId} is absent from behavior contract`, `#/operations/${item.operationId}`));
    } else if (behavior.language !== 'dafny') {
      findings.push(makeFinding('formal-language-mismatch', `${item.operationId} behavior language is not dafny`, `#/operations/${item.operationId}/language`));
    }
  }
  for (const behavior of contract.operations.filter((operation) => operation.language === 'dafny')) {
    if (!normalizedManifest.operations.some((item) => item.operationId === behavior.operationId)) {
      findings.push(makeFinding('formal-manifest-operation-missing', `${behavior.operationId} has Dafny behavior but no formal proof target`, `#/operations/${behavior.operationId}`));
    }
  }

  let bindings = [];
  if (typespec) {
    try {
      const inspected = await inspectTypeSpecBehaviorBindings(typespec, contract);
      bindings = inspected.bindings;
      findings.push(...inspected.findings);
    } catch {
      findings.push(makeFinding('formal-typespec-binding-check-failed', 'TypeSpec behavior binding inspection could not be completed', '#/typespec'));
    }
  } else {
    findings.push(makeFinding('formal-typespec-input-missing', 'formal verification requires the current TypeSpec authority', '#/typespec'));
  }

  const sources = new Map();
  for (const item of normalizedManifest.operations) {
    try {
      const source = await readProofSource(root, item);
      sources.set(item.operationId, source);
      if (source.digest !== item.sourceSha256) {
        findings.push(makeFinding('formal-source-digest-mismatch', `${item.source} digest differs from the manifest`, `#/operations/${item.operationId}/sourceSha256`));
      }
      if (!dafnySymbolPresent(source.text, item.module, item.symbol)) {
        findings.push(makeFinding('formal-symbol-missing', `${item.module}.${item.symbol} was not found in ${item.source}`, `#/operations/${item.operationId}/symbol`));
      }
    } catch {
      findings.push(makeFinding('formal-source-unreadable', `${item.source} could not be safely read`, `#/operations/${item.operationId}/source`));
    }
  }

  const versionResult = spawnSync(dafnyBin, ['--version'], { cwd: resolve(root), encoding: 'utf8', timeout: 30_000 });
  const dafnyAvailable = !versionResult.error && versionResult.status === 0;
  if (!dafnyAvailable) {
    findings.push(makeFinding('formal-dafny-unavailable', 'Dafny executable is unavailable or failed its version probe', '#/dafny'));
  }

  const proofRuns = [];
  if (dafnyAvailable) {
    const bySource = new Map();
    for (const item of normalizedManifest.operations) {
      if (!sources.has(item.operationId)) continue;
      const existing = bySource.get(item.source) ?? { path: sources.get(item.operationId).path, verifyIncludedFiles: false, operationIds: [] };
      existing.verifyIncludedFiles ||= item.verifyIncludedFiles;
      existing.operationIds.push(item.operationId);
      bySource.set(item.source, existing);
    }
    for (const [source, target] of [...bySource.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const args = ['verify'];
      if (target.verifyIncludedFiles) args.push('--verify-included-files');
      args.push(target.path);
      const result = spawnSync(dafnyBin, args, { cwd: resolve(root), encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
      const evidence = commandEvidence(result);
      proofRuns.push(Object.freeze({ source, operationIds: Object.freeze([...target.operationIds].sort()), ...evidence }));
      if (result.error || result.status !== 0) {
        findings.push(makeFinding('formal-dafny-verification-failed', `Dafny verification failed for ${source}`, `#/proofRuns/${source}`));
      }
    }
  }

  const sortedFindings = Object.freeze(findings.sort((a, b) => {
    const byRule = a.ruleId.localeCompare(b.ruleId);
    return byRule !== 0 ? byRule : a.pointer.localeCompare(b.pointer);
  }));
  const body = Object.freeze({
    schema: FORMAL_VERIFICATION_RECEIPT_SCHEMA,
    status: sortedFindings.length === 0 ? 'passed' : 'stopped_for_evaluation',
    authority: FORMAL_AUTHORITY,
    behaviorContractDigest: expectedBehaviorDigest,
    formalManifestDigest: formalManifestDigest(normalizedManifest),
    bindings: Object.freeze([...bindings].sort((a, b) => a.operationId.localeCompare(b.operationId))),
    dafny: Object.freeze({
      executable: dafnyBin,
      available: dafnyAvailable,
      versionProbe: commandEvidence(versionResult),
    }),
    proofRuns: Object.freeze(proofRuns),
    findings: sortedFindings,
  });
  return Object.freeze({ ...body, verificationId: `sha256:${sha256(canonicalStringify(body))}` });
}
