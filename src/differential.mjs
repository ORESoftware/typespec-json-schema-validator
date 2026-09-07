/**
 * Differential validation between the two independent contract authorities.
 *
 * The structural comparison in `parity.mjs` answers "do the two documents say the same
 * thing?". This module answers the complementary, decidable question: "is there a JSON value
 * the two authorities disagree about?". Every divergence carries the witness instance that
 * proves it, so a reviewer never has to reason about whether a formatting difference matters.
 *
 * Both directions are exercised. The independently authored JSON Schema (lane A) validates
 * instances derived from the TypeSpec-generated witness (lane B), and lane B validates
 * instances derived from lane A. Neither lane is treated as the winner: a divergence stops
 * evaluation and reports both verdicts.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { canonicalStringify, isPlainObject, stableFindingFingerprint } from './canonical.mjs';
import {
  SchemaResolver,
  SchemaResolutionError,
  UnsupportedKeywordError,
  validateInstance,
} from './instance-validator.mjs';
import { buildProbes } from './witness.mjs';

/** Instance expectations expressed by corpus directory layout. */
const EXPECTATION_DIRECTORIES = Object.freeze({ valid: 'accepted', invalid: 'rejected' });

function makeFinding(input) {
  const finding = {
    severity: 'error',
    resolutionState: 'unexplained',
    comparison: 'differential-instance-validation',
    ...input,
  };
  finding.fingerprint = stableFindingFingerprint(finding);
  return finding;
}

/**
 * Build a resolver plus a declaration lookup for one schema collection.
 *
 * @param {object} collection Result of `loadSchemaCollection`.
 * @returns {{ resolver: SchemaResolver, baseFor: (declaration: object) => string }}
 */
export function buildLaneResolver(collection) {
  const resolver = new SchemaResolver();
  const basesByPath = new Map();
  for (const document of collection.documents) {
    const record = resolver.addDocument(document.document, document.relativePath ?? document.path);
    basesByPath.set(document.path, record.base);
  }
  return {
    resolver,
    baseFor(declaration) {
      return basesByPath.get(declaration.source) ?? [...basesByPath.values()][0];
    },
  };
}

async function readJsonFile(path) {
  const raw = await readFile(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON instance in ${path}: ${error.message}`, { cause: error });
  }
}

async function collectCorpusFrom(directory, declaration, expectation, root, corpus) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
      continue;
    }
    const path = join(directory, entry.name);
    corpus.push({
      declaration,
      expectation,
      path,
      relativePath: relative(root, path).replaceAll('\\', '/'),
      instance: await readJsonFile(path),
    });
  }
}

/**
 * Load an explicit instance corpus.
 *
 * Layout, relative to the corpus root:
 *   `<Declaration>/valid/*.json`   instances both authorities must accept
 *   `<Declaration>/invalid/*.json` instances both authorities must reject
 *   `<Declaration>/*.json`         instances with no stated expectation; only lane
 *                                  disagreement is reported
 *
 * @returns {Promise<Array<{declaration: string, expectation: string|null, path: string, instance: unknown}>>}
 */
export async function loadInstanceCorpus(input) {
  if (!input) {
    return [];
  }
  const root = resolve(input);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`instance corpus must be a directory: ${root}`);
  }
  const corpus = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }
    const declaration = entry.name;
    const declarationDirectory = join(root, declaration);
    await collectCorpusFrom(declarationDirectory, declaration, null, root, corpus);
    for (const [directoryName, expectation] of Object.entries(EXPECTATION_DIRECTORIES)) {
      await collectCorpusFrom(join(declarationDirectory, directoryName), declaration, expectation, root, corpus);
    }
  }
  return corpus;
}

function summarizeErrors(errors, limit = 3) {
  return errors.slice(0, limit).map((error) => ({
    keyword: error.keyword,
    instancePath: error.instancePath || '#',
    schemaPointer: error.schemaPointer,
    message: error.message,
  }));
}

function truncateInstance(instance, maxBytes = 2048) {
  const encoded = canonicalStringify(instance);
  if (encoded.length <= maxBytes) {
    return instance;
  }
  return { truncated: true, bytes: encoded.length, preview: `${encoded.slice(0, maxBytes)}…` };
}

function verdictFor({ schema, instance, resolver, base, formatAssertion }) {
  try {
    const result = validateInstance({ schema, instance, resolver, base, formatAssertion, maxErrors: 8 });
    return { valid: result.valid, errors: summarizeErrors(result.errors), refused: null };
  } catch (error) {
    if (error instanceof UnsupportedKeywordError || error instanceof SchemaResolutionError) {
      return { valid: null, errors: [], refused: { name: error.name, message: error.message } };
    }
    throw error;
  }
}

/**
 * Run the differential lane over every declaration present in both lanes.
 *
 * @param {object} input
 * @param {object} input.generatedCollection Loaded TypeSpec-generated schema collection (lane B).
 * @param {object} input.authoredCollection Loaded independently authored schema collection (lane A).
 * @param {Array<{typespec: string, generated: string, authored: string}>} input.declarationMap
 * @param {Array<object>} [input.corpus] Explicit instance corpus.
 * @param {number} [input.maxProbes] Synthesized probes per declaration per lane.
 * @param {number} [input.maxFindings]
 * @param {boolean} [input.formatAssertion] Assert known `format` values in both lanes.
 * @returns {{ findings: Array<object>, summary: object, declarations: Array<object> }}
 */
export function crossValidate({
  generatedCollection,
  authoredCollection,
  declarationMap,
  corpus = [],
  maxProbes = 64,
  maxFindings = 250,
  formatAssertion = false,
}) {
  const findings = [];
  const generatedLane = buildLaneResolver(generatedCollection);
  const authoredLane = buildLaneResolver(authoredCollection);
  const generatedByName = new Map(generatedCollection.declarations.map((item) => [item.name, item]));
  const authoredByName = new Map(authoredCollection.declarations.map((item) => [item.name, item]));

  const perDeclaration = [];
  let probesEvaluated = 0;
  let agreements = 0;
  let divergences = 0;
  let refusals = 0;

  const corpusByAuthoredName = new Map();
  for (const item of corpus) {
    const list = corpusByAuthoredName.get(item.declaration) ?? [];
    list.push(item);
    corpusByAuthoredName.set(item.declaration, list);
  }
  const consumedCorpus = new Set();

  const pairs = declarationMap
    .filter((entry) => generatedByName.has(entry.generated) && authoredByName.has(entry.authored))
    .sort((left, right) => left.typespec.localeCompare(right.typespec));

  for (const pair of pairs) {
    const generated = generatedByName.get(pair.generated);
    const authored = authoredByName.get(pair.authored);
    const generatedBase = generatedLane.baseFor(generated);
    const authoredBase = authoredLane.baseFor(authored);

    const probes = [
      ...buildProbes({
        schema: generated.schema,
        base: generatedBase,
        resolver: generatedLane.resolver,
        lane: 'generated',
        declaration: pair.generated,
        maxProbes,
      }),
      ...buildProbes({
        schema: authored.schema,
        base: authoredBase,
        resolver: authoredLane.resolver,
        lane: 'authored',
        declaration: pair.authored,
        maxProbes,
      }),
    ];

    const corpusItems = [
      ...(corpusByAuthoredName.get(pair.authored) ?? []),
      ...(pair.generated === pair.authored ? [] : corpusByAuthoredName.get(pair.generated) ?? []),
      ...(pair.typespec === pair.authored ? [] : corpusByAuthoredName.get(pair.typespec) ?? []),
    ];
    for (const item of corpusItems) {
      consumedCorpus.add(item.path);
      probes.push({
        id: `corpus:${item.relativePath ?? item.path}`,
        origin: 'corpus',
        lane: 'corpus',
        declaration: pair.authored,
        mutation: null,
        pointer: null,
        instance: item.instance,
        expectation: item.expectation,
        source: item.relativePath ?? item.path,
        synthesisComplete: true,
      });
    }

    const seen = new Set();
    let declarationProbes = 0;
    let declarationDivergences = 0;
    let declarationRefusals = 0;

    for (const probe of probes) {
      const encoding = canonicalStringify(probe.instance);
      // Equal JSON values do not make independent expectations interchangeable.
      // A synthetic probe may precede a contradictory fixture, and every corpus
      // source must retain its own diagnostic even when another source is equal.
      const carriesExpectation = probe.origin === 'corpus'
        || probe.origin.startsWith('declared-example') || probe.origin === 'declared-default';
      if (!carriesExpectation && seen.has(encoding)) {
        continue;
      }
      seen.add(encoding);

      const authoredVerdict = verdictFor({
        schema: authored.schema,
        instance: probe.instance,
        resolver: authoredLane.resolver,
        base: authoredBase,
        formatAssertion,
      });
      const generatedVerdict = verdictFor({
        schema: generated.schema,
        instance: probe.instance,
        resolver: generatedLane.resolver,
        base: generatedBase,
        formatAssertion,
      });

      declarationProbes += 1;
      probesEvaluated += 1;

      if (authoredVerdict.refused || generatedVerdict.refused) {
        declarationRefusals += 1;
        refusals += 1;
        if (findings.length < maxFindings) {
          findings.push(
            makeFinding({
              ruleId: 'differential-validation-refused',
              declaration: pair.authored,
              pointer: authored.pointer,
              message: `differential validation could not be performed for ${pair.authored}: ${
                (authoredVerdict.refused ?? generatedVerdict.refused).message
              }`,
              left: authoredVerdict.refused ?? null,
              right: generatedVerdict.refused ?? null,
            }),
          );
        }
        continue;
      }

      if (authoredVerdict.valid === generatedVerdict.valid) {
        agreements += 1;
        if (probe.origin === 'corpus' && probe.expectation) {
          const expectedValid = probe.expectation === 'accepted';
          if (authoredVerdict.valid !== expectedValid && findings.length < maxFindings) {
            findings.push(
              makeFinding({
                ruleId: expectedValid ? 'corpus-instance-rejected' : 'corpus-instance-accepted',
                declaration: pair.authored,
                pointer: authored.pointer,
                message: `corpus instance ${probe.source} is declared ${probe.expectation} but both authorities returned ${
                  authoredVerdict.valid ? 'accepted' : 'rejected'
                }`,
                left: { authority: 'authored-json-schema', valid: authoredVerdict.valid, errors: authoredVerdict.errors },
                right: { authority: 'typespec-generated-json-schema', valid: generatedVerdict.valid, errors: generatedVerdict.errors },
                instance: truncateInstance(probe.instance),
              }),
            );
          }
        }
        if (
          (probe.origin.startsWith('declared-example') || probe.origin === 'declared-default') &&
          authoredVerdict.valid === false &&
          findings.length < maxFindings
        ) {
          findings.push(
            makeFinding({
              ruleId: 'declared-example-rejected',
              declaration: pair.authored,
              pointer: authored.pointer,
              message: `${probe.lane} declaration ${pair.authored} carries an ${probe.origin} that neither authority accepts`,
              left: { authority: 'authored-json-schema', valid: false, errors: authoredVerdict.errors },
              right: { authority: 'typespec-generated-json-schema', valid: false, errors: generatedVerdict.errors },
              instance: truncateInstance(probe.instance),
            }),
          );
        }
        continue;
      }

      divergences += 1;
      declarationDivergences += 1;
      if (findings.length < maxFindings) {
        findings.push(
          makeFinding({
            ruleId: 'instance-verdict-divergence',
            declaration: pair.authored,
            pointer: authored.pointer,
            message: `authorities disagree about an instance of ${pair.authored}: authored ${
              authoredVerdict.valid ? 'accepts' : 'rejects'
            }, TypeSpec-generated ${generatedVerdict.valid ? 'accepts' : 'rejects'} (probe ${probe.id})`,
            left: { authority: 'authored-json-schema', valid: authoredVerdict.valid, errors: authoredVerdict.errors },
            right: {
              authority: 'typespec-generated-json-schema',
              valid: generatedVerdict.valid,
              errors: generatedVerdict.errors,
            },
            witness: {
              probeId: probe.id,
              origin: probe.origin,
              lane: probe.lane,
              mutation: probe.mutation,
              pointer: probe.pointer,
              synthesisComplete: probe.synthesisComplete !== false,
              instance: truncateInstance(probe.instance),
            },
          }),
        );
      }
    }

    perDeclaration.push({
      typespec: pair.typespec,
      generated: pair.generated,
      authored: pair.authored,
      probes: declarationProbes,
      divergences: declarationDivergences,
      refusals: declarationRefusals,
      behaviorallyIndistinguishable: declarationDivergences === 0 && declarationRefusals === 0,
    });
  }

  for (const item of corpus) {
    if (consumedCorpus.has(item.path)) {
      continue;
    }
    if (findings.length < maxFindings) {
      findings.push(
        makeFinding({
          ruleId: 'corpus-declaration-unknown',
          declaration: item.declaration,
          pointer: '#',
          message: `instance corpus targets declaration ${item.declaration}, which is not present in both authorities (${item.relativePath ?? item.path})`,
        }),
      );
    }
  }

  return {
    findings,
    declarations: perDeclaration,
    summary: {
      comparedDeclarations: perDeclaration.length,
      probesEvaluated,
      agreements,
      divergences,
      refusals,
      corpusInstances: corpus.length,
      maxProbesPerDeclarationPerLane: maxProbes,
      formatAssertion,
      behaviorallyIndistinguishableDeclarations: perDeclaration.filter((entry) => entry.behaviorallyIndistinguishable).length,
    },
  };
}

/**
 * Convenience wrapper used by the `validate` command: run only the differential lane.
 */
export async function runDifferential({
  generatedCollection,
  authoredCollection,
  declarationMap,
  instances,
  maxProbes,
  maxFindings,
  formatAssertion,
}) {
  const corpus = await loadInstanceCorpus(instances);
  return crossValidate({
    generatedCollection,
    authoredCollection,
    declarationMap,
    corpus,
    maxProbes,
    maxFindings,
    formatAssertion,
  });
}

export const INTERNAL = Object.freeze({ EXPECTATION_DIRECTORIES, truncateInstance, isPlainObject, basename });
