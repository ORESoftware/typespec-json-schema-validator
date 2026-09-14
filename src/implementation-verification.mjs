import { spawnSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  behaviorByOperation,
  behaviorContractDigest,
  normalizeBehaviorContract,
} from './behavior-contract.mjs';
import { canonicalStringify, isPlainObject, sha256, stableFindingFingerprint } from './canonical.mjs';

export const IMPLEMENTATION_PROOF_MANIFEST_SCHEMA =
  'ores.typespec-json-schema-validator.implementation-proof-manifest/v1';
export const IMPLEMENTATION_PROOF_AUTHORITY = 'consumer-authored-implementation-proof-plan';
export const IMPLEMENTATION_VERIFICATION_RECEIPT_SCHEMA =
  'ores.typespec-json-schema-validator.implementation-verification-receipt/v1';

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REVISION = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const RUST_SYMBOL = /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*$/u;
const KANI_HARNESS = /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*$/u;

export class ImplementationVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImplementationVerificationError';
  }
}

function fail(message) {
  throw new ImplementationVerificationError(message);
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

function normalizedRelativePath(value, label, suffix) {
  const path = nonEmptyString(value, label);
  if (
    path.includes('\\')
    || path.startsWith('/')
    || /^[A-Za-z]:\//u.test(path)
    || path.endsWith('/')
    || path.includes('//')
  ) {
    fail(`${label} must be a normalized relative POSIX path`);
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(`${label} must be a normalized relative POSIX path`);
  }
  if (suffix && !path.endsWith(suffix)) fail(`${label} must end in ${suffix}`);
  return path;
}

function normalizeProof(value, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  if (value.tool === 'kani') {
    exactKeys(value, ['tool', 'source', 'sourceSha256', 'manifestPath', 'harness', 'package'], label);
    if (!DIGEST.test(value.sourceSha256 ?? '')) fail(`${label}.sourceSha256 must be sha256:<64 lowercase hex>`);
    if (!KANI_HARNESS.test(value.harness ?? '')) fail(`${label}.harness must be a Rust path`);
    const packageName = value.package === null ? null : nonEmptyString(value.package, `${label}.package`);
    return Object.freeze({
      tool: 'kani',
      source: normalizedRelativePath(value.source, `${label}.source`, '.rs'),
      sourceSha256: value.sourceSha256,
      manifestPath: normalizedRelativePath(value.manifestPath, `${label}.manifestPath`, '.toml'),
      harness: value.harness,
      package: packageName,
    });
  }
  if (value.tool === 'verus') {
    exactKeys(value, ['tool', 'source', 'sourceSha256'], label);
    if (!DIGEST.test(value.sourceSha256 ?? '')) fail(`${label}.sourceSha256 must be sha256:<64 lowercase hex>`);
    return Object.freeze({
      tool: 'verus',
      source: normalizedRelativePath(value.source, `${label}.source`, '.rs'),
      sourceSha256: value.sourceSha256,
    });
  }
  fail(`${label}.tool must be kani or verus`);
}

function normalizeOperation(value, index) {
  const label = `manifest.operations[${index}]`;
  exactKeys(value, ['operationId', 'language', 'implementation', 'proofs'], label);
  if (value.language !== 'rust') fail(`${label}.language must be rust`);
  exactKeys(value.implementation, ['source', 'sourceSha256', 'symbol'], `${label}.implementation`);
  if (!DIGEST.test(value.implementation.sourceSha256 ?? '')) {
    fail(`${label}.implementation.sourceSha256 must be sha256:<64 lowercase hex>`);
  }
  if (!RUST_SYMBOL.test(value.implementation.symbol ?? '')) {
    fail(`${label}.implementation.symbol must be a Rust path`);
  }
  if (!Array.isArray(value.proofs) || value.proofs.length === 0) {
    fail(`${label}.proofs must be a non-empty array`);
  }
  const proofs = value.proofs.map((proof, proofIndex) => normalizeProof(proof, `${label}.proofs[${proofIndex}]`));
  const proofKeys = proofs.map((proof) =>
    proof.tool === 'kani'
      ? `${proof.tool}\u0000${proof.source}\u0000${proof.harness}`
      : `${proof.tool}\u0000${proof.source}`);
  if (new Set(proofKeys).size !== proofKeys.length) fail(`${label}.proofs contains duplicate proof targets`);
  return Object.freeze({
    operationId: nonEmptyString(value.operationId, `${label}.operationId`),
    language: 'rust',
    implementation: Object.freeze({
      source: normalizedRelativePath(value.implementation.source, `${label}.implementation.source`, '.rs'),
      sourceSha256: value.implementation.sourceSha256,
      symbol: value.implementation.symbol,
    }),
    proofs: Object.freeze(proofs),
  });
}

export function normalizeImplementationProofManifest(value) {
  exactKeys(
    value,
    ['schema', 'authority', 'behaviorContractDigest', 'formalVerificationId', 'repository', 'revision', 'operations'],
    'manifest',
  );
  if (value.schema !== IMPLEMENTATION_PROOF_MANIFEST_SCHEMA) fail('manifest.schema is unsupported');
  if (value.authority !== IMPLEMENTATION_PROOF_AUTHORITY) fail('manifest.authority is unsupported');
  if (!DIGEST.test(value.behaviorContractDigest ?? '')) {
    fail('manifest.behaviorContractDigest must be sha256:<64 lowercase hex>');
  }
  if (!DIGEST.test(value.formalVerificationId ?? '')) {
    fail('manifest.formalVerificationId must be sha256:<64 lowercase hex>');
  }
  if (!REVISION.test(value.revision ?? '')) fail('manifest.revision must be a 40- or 64-hex git object id');
  if (!Array.isArray(value.operations) || value.operations.length === 0) {
    fail('manifest.operations must be a non-empty array');
  }
  const operations = value.operations.map(normalizeOperation);
  const ids = operations.map((item) => item.operationId);
  if (new Set(ids).size !== ids.length) fail('manifest.operations contains duplicate operationId values');
  return Object.freeze({
    schema: IMPLEMENTATION_PROOF_MANIFEST_SCHEMA,
    authority: IMPLEMENTATION_PROOF_AUTHORITY,
    behaviorContractDigest: value.behaviorContractDigest,
    formalVerificationId: value.formalVerificationId,
    repository: nonEmptyString(value.repository, 'manifest.repository'),
    revision: value.revision,
    operations: Object.freeze(operations.sort((a, b) => a.operationId.localeCompare(b.operationId))),
  });
}

export function implementationProofManifestDigest(value) {
  return `sha256:${sha256(canonicalStringify(normalizeImplementationProofManifest(value)))}`;
}

export function behaviorDigestForImplementationVerification(value) {
  return `sha256:${behaviorContractDigest(value)}`;
}

function makeFinding(ruleId, message, pointer, extra = {}) {
  const finding = {
    ruleId,
    severity: 'error',
    resolutionState: 'unexplained',
    comparison: 'implementation-verification',
    pointer,
    message,
    ...extra,
  };
  return Object.freeze({ ...finding, fingerprint: stableFindingFingerprint(finding) });
}

async function readPinnedSource(root, pathValue, expectedDigest) {
  const absoluteRoot = resolve(root);
  const path = resolve(absoluteRoot, pathValue);
  const local = relative(absoluteRoot, path);
  if (local === '' || local === '..' || isAbsolute(local) || local.startsWith('../') || local.startsWith('..\\')) {
    throw new ImplementationVerificationError('implementation proof source escaped the trusted root');
  }
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new ImplementationVerificationError(`${pathValue} must be a singly linked regular non-symlink file`);
  }
  const text = await readFile(path, 'utf8');
  const digest = `sha256:${sha256(text)}`;
  if (digest !== expectedDigest) {
    throw new ImplementationVerificationError(`${pathValue} digest does not match its manifest pin`);
  }
  return { path, text, digest };
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

function execute(spawn, command, args, root, timeoutMs) {
  return spawn(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function proofSourceHasBinding(text, operationId, behaviorDigest) {
  return (
    text.includes(`TJSV_OPERATION_ID: ${operationId}`)
    && text.includes(`TJSV_BEHAVIOR_DIGEST: ${behaviorDigest}`)
  );
}

export async function verifyImplementationProofs({
  root = '.',
  behaviorContract,
  formalReceipt,
  manifest,
  cargoBin = 'cargo',
  verusBin = 'verus',
  gitBin = 'git',
  timeoutMs = 600_000,
  spawn = spawnSync,
} = {}) {
  const contract = normalizeBehaviorContract(behaviorContract);
  const normalizedManifest = normalizeImplementationProofManifest(manifest);
  const expectedBehaviorDigest = behaviorDigestForImplementationVerification(contract);
  const findings = [];
  const proofRuns = [];
  const tools = {};

  if (normalizedManifest.behaviorContractDigest !== expectedBehaviorDigest) {
    findings.push(makeFinding(
      'implementation-behavior-digest-mismatch',
      'implementation manifest is not bound to the supplied behavioral authority',
      '#/manifest/behaviorContractDigest',
    ));
  }

  if (!isPlainObject(formalReceipt)
    || formalReceipt.status !== 'passed'
    || formalReceipt.verificationId !== normalizedManifest.formalVerificationId
    || formalReceipt.behaviorContractDigest !== expectedBehaviorDigest) {
    findings.push(makeFinding(
      'implementation-formal-receipt-mismatch',
      'L4 implementation evidence requires the exact passed L3 formal receipt for the same behavioral authority',
      '#/formalReceipt',
    ));
  }

  const gitHeadResult = execute(spawn, gitBin, ['rev-parse', 'HEAD'], root, timeoutMs);
  const gitStatusResult = execute(spawn, gitBin, ['status', '--porcelain=v1', '--untracked-files=all'], root, timeoutMs);
  const gitHead = typeof gitHeadResult.stdout === 'string' ? gitHeadResult.stdout.trim() : '';
  const gitDirty = typeof gitStatusResult.stdout === 'string' ? gitStatusResult.stdout.trim() !== '' : true;
  if (gitHeadResult.status !== 0 || gitHead !== normalizedManifest.revision) {
    findings.push(makeFinding(
      'implementation-revision-mismatch',
      'checked-out git revision does not match manifest.revision',
      '#/manifest/revision',
    ));
  }
  if (gitStatusResult.status !== 0 || gitDirty) {
    findings.push(makeFinding(
      'implementation-working-tree-dirty',
      'implementation verification requires a clean working tree, including untracked files',
      '#/git',
    ));
  }

  const behaviors = behaviorByOperation(contract);
  const needsKani = normalizedManifest.operations.some((operation) => operation.proofs.some((proof) => proof.tool === 'kani'));
  const needsVerus = normalizedManifest.operations.some((operation) => operation.proofs.some((proof) => proof.tool === 'verus'));

  if (needsKani) {
    const probe = execute(spawn, cargoBin, ['kani', '--version'], root, timeoutMs);
    tools.kani = Object.freeze({ executable: cargoBin, available: probe.status === 0, versionProbe: commandEvidence(probe) });
    if (probe.status !== 0) {
      findings.push(makeFinding('implementation-kani-unavailable', 'cargo kani is required by the implementation manifest', '#/tools/kani'));
    }
  }
  if (needsVerus) {
    const probe = execute(spawn, verusBin, ['--version'], root, timeoutMs);
    tools.verus = Object.freeze({ executable: verusBin, available: probe.status === 0, versionProbe: commandEvidence(probe) });
    if (probe.status !== 0) {
      findings.push(makeFinding('implementation-verus-unavailable', 'verus is required by the implementation manifest', '#/tools/verus'));
    }
  }

  for (const operation of normalizedManifest.operations) {
    if (!behaviors.has(operation.operationId)) {
      findings.push(makeFinding(
        'implementation-operation-missing',
        `${operation.operationId} is absent from the behavioral authority`,
        `#/operations/${operation.operationId}`,
      ));
      continue;
    }

    try {
      const implementationSource = await readPinnedSource(
        root,
        operation.implementation.source,
        operation.implementation.sourceSha256,
      );
      const leaf = operation.implementation.symbol.split('::').at(-1);
      const escapedLeaf = leaf.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const symbolPattern = new RegExp(`\\b(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+${escapedLeaf}\\b`, 'u');
      if (!symbolPattern.test(implementationSource.text)) {
        findings.push(makeFinding(
          'implementation-symbol-missing',
          `${operation.operationId} implementation symbol was not found in the pinned Rust source`,
          `#/operations/${operation.operationId}/implementation/symbol`,
        ));
      }
    } catch {
      findings.push(makeFinding(
        'implementation-source-invalid',
        `${operation.operationId} implementation source could not be admitted`,
        `#/operations/${operation.operationId}/implementation`,
      ));
    }

    for (const proof of operation.proofs) {
      let proofSource;
      try {
        proofSource = await readPinnedSource(root, proof.source, proof.sourceSha256);
      } catch {
        findings.push(makeFinding(
          'implementation-proof-source-invalid',
          `${operation.operationId} ${proof.tool} proof source could not be admitted`,
          `#/operations/${operation.operationId}/proofs`,
          { tool: proof.tool },
        ));
        continue;
      }
      if (!proofSourceHasBinding(proofSource.text, operation.operationId, expectedBehaviorDigest)) {
        findings.push(makeFinding(
          'implementation-proof-binding-missing',
          `${operation.operationId} ${proof.tool} proof source must embed the operation id and behavioral digest binding markers`,
          `#/operations/${operation.operationId}/proofs`,
          { tool: proof.tool },
        ));
        continue;
      }

      let result;
      let target;
      if (proof.tool === 'kani') {
        const args = ['kani', '--manifest-path', proof.manifestPath, '--harness', proof.harness];
        if (proof.package !== null) args.push('-p', proof.package);
        result = execute(spawn, cargoBin, args, root, timeoutMs);
        target = proof.harness;
      } else {
        result = execute(spawn, verusBin, [proof.source], root, timeoutMs);
        target = proof.source;
      }
      const evidence = commandEvidence(result);
      proofRuns.push(Object.freeze({
        operationId: operation.operationId,
        tool: proof.tool,
        proofMode: proof.tool === 'kani' ? 'model-checking' : 'deductive',
        target,
        ...evidence,
      }));
      if (result.status !== 0) {
        findings.push(makeFinding(
          'implementation-proof-failed',
          `${operation.operationId} ${proof.tool} verification failed`,
          `#/operations/${operation.operationId}/proofs`,
          { tool: proof.tool, target },
        ));
      }
    }
  }

  const unsigned = {
    schema: IMPLEMENTATION_VERIFICATION_RECEIPT_SCHEMA,
    status: findings.length === 0 ? 'passed' : 'stopped_for_evaluation',
    assuranceLevel: findings.length === 0 ? 'L4' : null,
    authority: IMPLEMENTATION_PROOF_AUTHORITY,
    behaviorContractDigest: expectedBehaviorDigest,
    formalVerificationId: normalizedManifest.formalVerificationId,
    implementationManifestDigest: implementationProofManifestDigest(normalizedManifest),
    repository: normalizedManifest.repository,
    revision: normalizedManifest.revision,
    git: {
      head: gitHead || null,
      clean: gitStatusResult.status === 0 && !gitDirty,
      headProbe: commandEvidence(gitHeadResult),
      statusProbe: commandEvidence(gitStatusResult),
    },
    tools,
    proofRuns: Object.freeze(proofRuns),
    findings: Object.freeze(findings),
  };
  return Object.freeze({
    ...unsigned,
    verificationId: `sha256:${sha256(canonicalStringify(unsigned))}`,
  });
}
