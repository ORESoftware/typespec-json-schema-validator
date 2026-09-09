# Release process

A release is eligible only when the candidate `main` revision has both:

1. an independent clean-clone verification covering install, syntax, CLI audit,
   unit tests, real-emitter integration tests, the full repository check, and a
   zero-finding example receipt; and
2. a successful hosted GitHub Actions workflow on the exact same commit.

## Registry and authority policy

The canonical package is the public npm package
`@oresoftware/typespec-json-schema-validator`; `package.json` must retain
`publishConfig.access = "public"`. A future GitHub Packages copy may be a
verified mirror, but it must not become a second mutable release authority.
Every consumer should bind an immutable version and the registry integrity
value or an equivalent reviewed lockfile.

The canonical executable is `tjsv`. The `tsjsv` and
`typespec-json-schema-validator` command names are compatibility aliases for the
same packaged file; a release must not let them diverge.

## Executable preflight

Run:

```sh
npm ci
npm run test:all
npm run release:preflight
```

`release:preflight` performs more than `npm pack --dry-run`:

- requires a clean tracked Git checkout and records the exact source commit;
- creates one real npm tarball and admits a bounded, duplicate-free file
  inventory;
- requires the public API, type declarations, schemas, canonical CLI, flags
  contract, license, agent pointer, and README;
- refuses development trees, decrypted environment files, npm credentials,
  private-key formats, lockfiles, tests, temporary output, and release scripts;
- recomputes and verifies npm's SHA-1 and SHA-512 tarball metadata and records a
  SHA-256 plus a deterministic file-manifest digest;
- installs the tarball into a clean temporary consumer with lifecycle scripts
  disabled;
- imports the root and three public subpath APIs; and
- runs `doctor --quiet` through `tjsv` and both compatibility aliases.

The command writes a mode-`0600` ignored receipt under
`tmp/release-preflight/<commit>/` and emits the same secret-free receipt to
stdout. Its schema is `ores.tjsv-release-preflight/v1`. A preflight receipt is
candidate evidence only; it is not proof that a registry publication or
provenance attestation exists.

## Publication

Only after the exact candidate commit passes the complete hosted matrix:

1. review the preflight receipt and tarball inventory;
2. create a signed or GitHub-attested `v<package-version>` tag on that exact
   commit;
3. publish the public npm package with provenance and immutable versioning;
4. verify the registry-reported integrity and install the registry artifact in
   a new clean consumer, rather than reusing the local tarball;
5. record the tag SHA, workflow run, npm version, integrity, tarball SHA-256,
   manifest SHA-256, and clean-consumer evidence in the GitHub release and
   Linear issue; and
6. refuse publication when the tag, package version, source revision, or any
   retained digest disagrees.

A GitHub source release alone does not imply that an npm artifact was
published. A successful local tarball preflight does not authorize use of an
npm credential, create a tag, or perform publication from a pull request.
