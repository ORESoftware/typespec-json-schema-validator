import { createHash } from 'node:crypto';

export const RECEIPT_SCHEMA = 'tjsv-npm-production-audit-receipt/v1';
export const EXCEPTION_SCHEMA = 'tjsv-npm-audit-exceptions/v1';

const ENFORCED_SEVERITIES = new Set(['high', 'critical']);

export function sha256Utf8(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireNonemptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value.trim();
}

function normalizeIsoDate(value, label) {
  const text = requireNonemptyString(value, label);
  const date = new Date(text);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== text) {
    throw new TypeError(`${label} must be canonical RFC3339 UTC`);
  }
  return text;
}

export function parseExceptionLedger(value) {
  const ledger = requireObject(value, 'exception ledger');
  if (ledger.schema !== EXCEPTION_SCHEMA) {
    throw new TypeError(`exception ledger schema must be ${EXCEPTION_SCHEMA}`);
  }
  if (!Array.isArray(ledger.exceptions)) {
    throw new TypeError('exception ledger exceptions must be an array');
  }

  const seen = new Set();
  const exceptions = ledger.exceptions.map((entry, index) => {
    const item = requireObject(entry, `exception[${index}]`);
    const advisoryId = requireNonemptyString(item.advisoryId, `exception[${index}].advisoryId`);
    const packageName = requireNonemptyString(item.package, `exception[${index}].package`);
    const owner = requireNonemptyString(item.owner, `exception[${index}].owner`);
    const rationale = requireNonemptyString(item.rationale, `exception[${index}].rationale`);
    const reachabilityEvidence = requireNonemptyString(
      item.reachabilityEvidence,
      `exception[${index}].reachabilityEvidence`,
    );
    const expiresAt = normalizeIsoDate(item.expiresAt, `exception[${index}].expiresAt`);
    const key = `${advisoryId}\u0000${packageName}`;
    if (seen.has(key)) throw new TypeError(`duplicate exception for ${advisoryId} / ${packageName}`);
    seen.add(key);
    return { advisoryId, package: packageName, owner, rationale, reachabilityEvidence, expiresAt };
  });

  return { schema: EXCEPTION_SCHEMA, exceptions };
}

function advisoryIdFor(via, vulnerability) {
  if (via && typeof via === 'object' && !Array.isArray(via)) {
    if (via.source !== undefined && via.source !== null) return `npm:${String(via.source)}`;
    if (typeof via.url === 'string' && via.url.trim()) return via.url.trim();
    if (typeof via.title === 'string' && via.title.trim()) return `title:${via.title.trim()}`;
  }
  const range = typeof vulnerability.range === 'string' ? vulnerability.range : 'unknown-range';
  return `aggregate:${vulnerability.name ?? 'unknown'}:${vulnerability.severity ?? 'unknown'}:${range}`;
}

function advisoryIdentity(advisory) {
  if (!advisory || typeof advisory !== 'object' || Array.isArray(advisory)) return null;
  if (advisory.source !== undefined && advisory.source !== null) return `npm:${String(advisory.source)}`;
  if (typeof advisory.url === 'string' && advisory.url.trim()) return advisory.url.trim();
  if (typeof advisory.title === 'string' && advisory.title.trim()) return `title:${advisory.title.trim()}`;
  return JSON.stringify(advisory);
}

function resolveAdvisories(packageName, vulnerabilities, active = new Set()) {
  if (active.has(packageName)) return [];
  const vulnerability = vulnerabilities[packageName];
  if (!vulnerability || typeof vulnerability !== 'object' || Array.isArray(vulnerability)) return [];

  const nextActive = new Set(active);
  nextActive.add(packageName);
  const via = Array.isArray(vulnerability.via) ? vulnerability.via : [];
  const advisories = [];

  for (const entry of via) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      advisories.push(entry);
      continue;
    }
    if (typeof entry === 'string' && vulnerabilities[entry]) {
      advisories.push(...resolveAdvisories(entry, vulnerabilities, nextActive));
    }
  }

  const unique = new Map();
  for (const advisory of advisories) {
    const key = advisoryIdentity(advisory);
    if (key && !unique.has(key)) unique.set(key, advisory);
  }
  return [...unique.values()];
}

function sortedStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === 'string').sort();
}

function findingFor(packageName, vulnerability, via) {
  const advisory = via && typeof via === 'object' && !Array.isArray(via) ? via : null;
  const severity = String(advisory?.severity ?? vulnerability.severity ?? 'unknown').toLowerCase();
  const advisoryPackage = typeof advisory?.name === 'string'
    ? advisory.name
    : (typeof advisory?.dependency === 'string' ? advisory.dependency : packageName);
  return {
    advisoryId: advisoryIdFor(advisory, vulnerability),
    advisoryUrl: typeof advisory?.url === 'string' ? advisory.url : null,
    advisoryPackage,
    package: packageName,
    dependency: typeof advisory?.dependency === 'string' ? advisory.dependency : packageName,
    severity,
    title: typeof advisory?.title === 'string' ? advisory.title : null,
    vulnerableRange: typeof advisory?.range === 'string'
      ? advisory.range
      : (typeof vulnerability.range === 'string' ? vulnerability.range : null),
    directDependency: vulnerability.isDirect === true,
    propagated: advisory !== null && advisoryPackage !== packageName,
    viaPackages: sortedStrings(vulnerability.via),
    nodes: sortedStrings(vulnerability.nodes),
    effects: sortedStrings(vulnerability.effects),
    productionScope: true,
    actionReachability: 'conservatively-reachable',
    fixAvailable: vulnerability.fixAvailable ?? false,
  };
}

export function collectAuditFindings(auditDocument) {
  const audit = requireObject(auditDocument, 'npm audit document');
  const vulnerabilities = requireObject(audit.vulnerabilities, 'npm audit vulnerabilities');
  requireObject(audit.metadata, 'npm audit metadata');

  const findings = [];
  for (const packageName of Object.keys(vulnerabilities).sort()) {
    const vulnerability = requireObject(vulnerabilities[packageName], `vulnerability ${packageName}`);
    const advisories = resolveAdvisories(packageName, vulnerabilities);
    if (advisories.length === 0) {
      findings.push(findingFor(packageName, vulnerability, null));
      continue;
    }
    for (const advisory of advisories) findings.push(findingFor(packageName, vulnerability, advisory));
  }

  const unique = new Map();
  for (const finding of findings) {
    const key = `${finding.advisoryId}\u0000${finding.package}\u0000${finding.vulnerableRange ?? ''}`;
    if (!unique.has(key)) unique.set(key, finding);
  }
  return [...unique.values()].sort((left, right) => {
    return left.package.localeCompare(right.package)
      || left.advisoryId.localeCompare(right.advisoryId)
      || String(left.vulnerableRange).localeCompare(String(right.vulnerableRange));
  });
}

export function evaluateAudit({
  auditDocument,
  exceptionLedger,
  now,
  auditExitCode,
  npmVersion,
  registry,
  packageLockDigest,
  packageJsonDigest,
  auditDocumentDigest,
}) {
  if (auditExitCode !== 0 && auditExitCode !== 1) {
    return {
      schema: RECEIPT_SCHEMA,
      status: 'failed',
      zeroUnwaivedHighOrCritical: false,
      failure: `npm audit infrastructure exit ${auditExitCode}`,
      findings: [],
      exceptionsApplied: [],
      tool: { npmVersion, registry },
      inputs: { packageLockDigest, packageJsonDigest, auditDocumentDigest },
    };
  }

  const timestamp = normalizeIsoDate(now, 'now');
  const ledger = parseExceptionLedger(exceptionLedger);
  const findings = collectAuditFindings(auditDocument);
  const exceptionsByKey = new Map(
    ledger.exceptions.map((entry) => [`${entry.advisoryId}\u0000${entry.package}`, entry]),
  );
  const exceptionsApplied = [];
  const unwaived = [];

  for (const finding of findings) {
    if (!ENFORCED_SEVERITIES.has(finding.severity)) continue;
    const exception = exceptionsByKey.get(`${finding.advisoryId}\u0000${finding.package}`);
    if (!exception) {
      unwaived.push({ ...finding, reason: 'no-exact-exception' });
      continue;
    }
    if (Date.parse(exception.expiresAt) <= Date.parse(timestamp)) {
      unwaived.push({ ...finding, reason: 'exception-expired', exceptionExpiresAt: exception.expiresAt });
      continue;
    }
    exceptionsApplied.push({
      advisoryId: finding.advisoryId,
      package: finding.package,
      owner: exception.owner,
      rationale: exception.rationale,
      expiresAt: exception.expiresAt,
      reachabilityEvidence: exception.reachabilityEvidence,
    });
  }

  const zeroUnwaivedHighOrCritical = unwaived.length === 0;
  return {
    schema: RECEIPT_SCHEMA,
    status: zeroUnwaivedHighOrCritical ? 'passed' : 'stopped_for_evaluation',
    zeroUnwaivedHighOrCritical,
    failure: null,
    auditExitCode,
    auditedAt: timestamp,
    scope: {
      dependencyClass: 'production',
      npmArguments: ['audit', '--omit=dev', '--json', '--audit-level=high'],
      actionReachabilityPolicy: 'all production-installed vulnerable paths are conservatively reachable unless an exact exception proves otherwise',
    },
    tool: { npmVersion, registry },
    inputs: { packageLockDigest, packageJsonDigest, auditDocumentDigest },
    metadata: auditDocument.metadata,
    findings,
    unwaivedHighOrCritical: unwaived,
    exceptionsApplied,
  };
}

export function failedAuditReceipt({ reason, npmVersion, registry, packageLockDigest, packageJsonDigest, auditExitCode = null }) {
  return {
    schema: RECEIPT_SCHEMA,
    status: 'failed',
    zeroUnwaivedHighOrCritical: false,
    failure: requireNonemptyString(reason, 'failure reason'),
    auditExitCode,
    findings: [],
    exceptionsApplied: [],
    tool: { npmVersion, registry },
    inputs: { packageLockDigest, packageJsonDigest, auditDocumentDigest: null },
  };
}
