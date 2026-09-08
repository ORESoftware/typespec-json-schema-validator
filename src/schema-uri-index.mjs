import { assertSchemaNodeSyntax } from './schema-syntax.mjs';
export { SchemaSyntaxError } from './schema-syntax.mjs';

/** A URI must identify one schema location, never whichever file was loaded last. */
export class SchemaIdentityError extends Error {
  constructor(uri, previous, incoming) {
    super(`conflicting JSON Schema identity ${uri}: ${previous.record.path ?? '<anonymous>'}${previous.pointer} and ${incoming.record.path ?? '<anonymous>'}${incoming.pointer}`);
    this.name = 'SchemaIdentityError';
    this.uri = uri;
    this.firstSource = previous.record.path;
    this.firstPointer = previous.pointer;
    this.secondSource = incoming.record.path;
    this.secondPointer = incoming.pointer;
  }
}

/**
 * Stage an explicit resource or pointer/anchor alias without mutating the committed
 * index. Re-registration is harmless only for the exact same document location.
 * Equal JSON bodies or a shared JavaScript object at two pointers are not identity.
 */
export function registerSchemaUri(pending, committed, uri, entry) {
  // Syntax is checked before either map is touched. SchemaResolver calls this for
  // every reachable schema node, so malformed identifiers, keyword shapes, and
  // Unicode-incompatible regexes cannot enter a partially registered graph.
  assertSchemaNodeSyntax(entry.schema, {
    pointer: entry.pointer,
    source: entry.record.path ?? '<anonymous>',
  });

  const previous = pending.get(uri) ?? committed.get(uri);
  if (previous !== undefined && (
    previous.record !== entry.record || previous.pointer !== entry.pointer || previous.schema !== entry.schema
  )) {
    throw new SchemaIdentityError(uri, previous, entry);
  }
  pending.set(uri, entry);
}
