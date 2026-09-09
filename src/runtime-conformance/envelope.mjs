import { makeRuntimeFinding } from './findings.mjs';

// These envelopes are closed in schema/runtime-evidence.schema.json. Inspect
// descriptors before normalization: inherited/accessor values are not wire data.
export function readRuntimeEnvelope(value, fields, pointer, name, findings) {
  const entries = [];
  const missing = [];
  const nonData = [];
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !descriptor.enumerable) missing.push(field);
    else if (!Object.hasOwn(descriptor, 'value')) nonData.push(field);
    else entries.push([field, descriptor.value]);
  }
  const unexpected = Object.keys(value).filter(key => !fields.includes(key)).sort();
  const snapshot = Object.fromEntries(entries);
  if (missing.length === 0 && nonData.length === 0 && unexpected.length === 0) return snapshot;

  findings.push(makeRuntimeFinding({
    ruleId: `runtime-${name}-fields-invalid`,
    pointer,
    message: `runtime ${name} must contain exactly its declared own data fields`,
    // Never inspect or retain unknown field values: they can be raw payloads,
    // credentials, or getters. Bound diagnostics independently of input size.
    left: {
      missing: missing.sort(),
      nonData: nonData.sort(),
      unexpected: unexpected.slice(0, 16),
      unexpectedCount: unexpected.length,
    },
    right: [...fields].sort(),
  }));
  return snapshot;
}
