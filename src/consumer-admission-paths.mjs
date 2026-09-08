import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

function within(parent, child, paths) {
  const local = paths.relative(parent, child);
  return local === '' || (local !== '..' && !local.startsWith(`..${paths.sep}`) && !paths.isAbsolute(local));
}

/** Input roles outrank receipt-shaped content. Check before creating any output. */
export function assertIndependentOutput(output, inputs, paths = path) {
  if (!paths.isAbsolute(output) || !Array.isArray(inputs) || inputs.length === 0 ||
      inputs.some((input) => typeof input !== 'string' || !paths.isAbsolute(input))) {
    throw new TypeError('absolute output and nonempty absolute input paths are required');
  }
  for (const input of inputs) {
    if (within(input, output, paths) || within(output, input, paths)) {
      throw new Error('verification output overlaps a configured input');
    }
  }
}

// Resolve existing ancestors without creating missing components. A dangling
// link or unreadable topology cannot establish an independent destination.
async function physicalPath(candidate) {
  let current = candidate;
  const missing = [];
  for (;;) {
    try {
      return path.resolve(await realpath(current), ...missing);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await lstat(current);
        throw new Error('unresolvable existing path component');
      } catch (inspection) {
        if (inspection.code !== 'ENOENT') throw inspection;
      }
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** Read-only preflight; unsafe paths must not reach the failure-receipt writer. */
export async function preflightAdmissionOutput(workspace, output, inputs) {
  assertIndependentOutput(output, inputs);
  const physicalOutput = await physicalPath(output);
  const physicalInputs = await Promise.all(inputs.map(physicalPath));
  if (![physicalOutput, ...physicalInputs].every((item) => within(workspace, item, path))) {
    throw new Error('action paths must remain inside the workspace');
  }
  assertIndependentOutput(physicalOutput, physicalInputs);
}
