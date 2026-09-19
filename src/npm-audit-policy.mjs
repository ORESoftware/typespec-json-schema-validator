import { createHash } from 'node:crypto';

export const RECEIPT_SCHEMA = 'tjsv-npm-production-audit-receipt/v1';
export const EXCEPTION_SCHEMA = 'tjsv-npm-audit-exceptions/v1';

const ENFORCED_SEVERITIES = new Set(['high', 'critical']);

const MS_PER_DAY = 86_400_000;

/** Default number of days before an exception expiry at which the gate starts warning. */
export const DEFAULT_EXPIRY_WARNING_DAYS = 30;

/** Maximum accepted early-warning window, in days. */
export const MAX_EXPIRY_WARNING_DAYS = 365;

/**
 * Ordered remediation for an exception that has expired, or is about to.
 * Upgrading past the advisory is always preferred over renewing a waiver.
 */
export const EXCEPTION_REMEDIATION = [
  'upgrade the affected production dependency to a release outside the advisory range (preferred; check for a patched upstream version first)',
  'only when no patched release exists, renew the exact advisory/package exception in security/npm-audit-exceptions.json with a new canonical RFC3339 UTC expiry, owner, rationale, and current reachability evidence',
  'never widen an exception to a severity, package, or advisory wildcard, and never use `npm audit fix --force`',
  'see docs/npm-production-audit.md for the full procedure',
];

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

export function normalizeExpiryWarningDays(value) {
  if (value === undefined || value === null) return DEFAULT_EXPIRY_WARNING_DAYS;
  const days = typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : value;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > MAX_EXPIRY_WARNING_DAYS) {
    throw new TypeError(
      `expiry warning window must be an integer number of days between 0 and ${MAX_EXPIRY_WARNING_DAYS}`,
    );
  }
  return days;
}

export function validateAuditEnvironment({ npmVersion, registry }) {
  const version = requireNonemptyString(npmVersion, 'npm version');
  if (version === 'unavailable' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new TypeError('npm version must be an available semantic version');
  }

  const registryText = requireNonemptyString(registry, 'npm registry');
  if (registryText === 'unavailable') throw new TypeError('npm registry must be available');
  let registryUrl;
  try {
    registryUrl = new URL(registryText);
  } catch {
    throw new TypeError('npm registry must be an absolute URL');
  }
  if (registryUrl.protocol !== 'https:') throw new TypeError('npm registry must use HTTPS');
  if (registryUrl.username || registryUrl.password || registryUrl.search || registryUrl.hash) {
    throw new TypeError('npm registry URL must not contain credentials, query parameters, or fragments');
  }
  return { npmVersion: version, registry: registryUrl.href };
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
  expiryWarningDays,
}) {
  const tool = validateAuditEnvironment({ npmVersion, registry });
  const warningDays = normalizeExpiryWarningDays(expiryWarningDays);
  if (auditExitCode !== 0 && auditExitCode !== 1) {
    return {
      schema: RECEIPT_SCHEMA,
      status: 'failed',
      zeroUnwaivedHighOrCritical: false,
      failure: `npm audit infrastructure exit ${auditExitCode}`,
      findings: [],
      exceptionsApplied: [],
      tool,
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
  const exceptionsExpiringSoon = [];
  const unwaived = [];
  const nowMs = Date.parse(timestamp);

  for (const finding of findings) {
    if (!ENFORCED_SEVERITIES.has(finding.severity)) continue;
    const exception = exceptionsByKey.get(`${finding.advisoryId}\u0000${finding.package}`);
    if (!exception) {
      unwaived.push({ ...finding, reason: 'no-exact-exception', remediation: EXCEPTION_REMEDIATION });
      continue;
    }
    const expiresMs = Date.parse(exception.expiresAt);
    if (expiresMs <= nowMs) {
      unwaived.push({
        ...finding,
        reason: 'exception-expired',
        exceptionExpiresAt: exception.expiresAt,
        exceptionOwner: exception.owner,
        remediation: EXCEPTION_REMEDIATION,
      });
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

    const remainingMs = expiresMs - nowMs;
    if (remainingMs <= warningDays * MS_PER_DAY) {
      exceptionsExpiringSoon.push({
        advisoryId: finding.advisoryId,
        package: finding.package,
        owner: exception.owner,
        expiresAt: exception.expiresAt,
        daysRemaining: Math.floor(remainingMs / MS_PER_DAY),
        warningWindowDays: warningDays,
        remediation: EXCEPTION_REMEDIATION,
      });
    }
  }

  exceptionsExpiringSoon.sort((left, right) => {
    return left.expiresAt.localeCompare(right.expiresAt)
      || left.package.localeCompare(right.package)
      || left.advisoryId.localeCompare(right.advisoryId);
  });

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
      expiryWarningDays: warningDays,
    },
    tool,
    inputs: { packageLockDigest, packageJsonDigest, auditDocumentDigest },
    metadata: auditDocument.metadata,
    findings,
    unwaivedHighOrCritical: unwaived,
    exceptionsApplied,
    exceptionsExpiringSoon,
  };
}

/**
 * Build the operator-facing alert for a receipt whose exceptions have expired, or
 * are inside the early-warning window. Pure: no I/O, no network, no clock read.
 */
export function buildExceptionExpiryAlert(receipt) {
  const source = requireObject(receipt, 'audit receipt');
  const expiringSoon = Array.isArray(source.exceptionsExpiringSoon) ? source.exceptionsExpiringSoon : [];
  const expired = (Array.isArray(source.unwaivedHighOrCritical) ? source.unwaivedHighOrCritical : [])
    .filter((finding) => finding && finding.reason === 'exception-expired');

  if (expiringSoon.length === 0 && expired.length === 0) {
    return { alert: false, title: null, body: null, expired: [], expiringSoon: [] };
  }

  const lines = [];
  if (expired.length > 0) {
    lines.push('## Expired advisory exceptions (the gate is failing closed now)', '');
    for (const finding of expired) {
      lines.push(`- \`${finding.package}\` ${finding.severity} \`${finding.advisoryId}\` — exception expired \`${finding.exceptionExpiresAt}\``);
    }
    lines.push('');
  }
  if (expiringSoon.length > 0) {
    lines.push('## Advisory exceptions expiring soon (the gate will fail closed on that date)', '');
    for (const entry of expiringSoon) {
      lines.push(`- \`${entry.package}\` \`${entry.advisoryId}\` — expires \`${entry.expiresAt}\` (${entry.daysRemaining} day(s) left, owner ${entry.owner})`);
    }
    lines.push('');
  }
  lines.push('## Remediation, in order', '');
  for (const step of EXCEPTION_REMEDIATION) lines.push(`1. ${step}`);
  lines.push(
    '',
    'This gate fails closed on a calendar date, so every repository pinning this action fails on that date even with no code change.',
  );

  const title = expired.length > 0
    ? 'TJSV npm advisory exception expired: production audit gate is failing closed'
    : 'TJSV npm advisory exception expiring soon: production audit gate will fail closed';

  return { alert: true, title, body: `${lines.join('\n')}\n`, expired, expiringSoon };
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
