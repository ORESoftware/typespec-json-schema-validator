# Container runtime contract

The `test/fixtures/container-runtime-contract` fixture applies the peer-authority and Contract IR rules from [issue #20](https://github.com/ORESoftware/typespec-json-schema-validator/issues/20) to OCI image execution metadata.

The TypeSpec source and the authored JSON Schema are independent authorities. The JSON Schema is not generated from TypeSpec, and the TypeSpec witness is not promoted to authority. A downstream image policy, deployment generator, or admission controller may consume the emitted Contract IR only after the exact current inputs produce a passing parity receipt.

## Execution profiles

`ores.container-runtime-contract/v1` records:

- the runtime base capability (`shell`, `distroless`, or `scratch`);
- whether launch uses a version-controlled exec wrapper or a direct binary;
- the exec-form `ENTRYPOINT` and `CMD` argument vectors;
- the supported OCI platforms (`linux/amd64` and `linux/arm64`);
- non-root execution; and
- whether the service remains PID 1.

A shell-capable image should normally use this Dockerfile contract:

```dockerfile
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0555 /usr/local/bin/entrypoint.sh
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/local/bin/service"]
```

The portable wrapper is intentionally small:

```sh
#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  echo "entrypoint: no command configured" >&2
  exit 64
fi

exec "$@"
```

`exec "$@"` preserves the command's argument boundaries, makes the service PID 1, forwards container signals directly, and returns the service exit status. A wrapper should not background the main process. Bash process substitution such as `>(processor)` is not POSIX `sh` syntax and must not appear beneath a `#!/bin/sh` or `#!/usr/bin/env sh` shebang.

Logging the complete command line is disabled by default because arguments can contain credentials or other sensitive values. A repository that needs a diagnostic may expose an explicit opt-in and log only the executable name.

Distroless and scratch images have no shell. Their production target should keep a direct exec-form binary entrypoint instead of weakening the runtime solely to host a script. A repository may additionally expose a non-production `shell-runtime` target for wrapper integration tests, but the default hardened target remains shell-free.

## Build evidence

A conforming repository runs both the ordinary Docker CLI path and Buildx multi-platform path:

```sh
docker build --progress=plain -t service:local .

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --progress=plain \
  --output type=oci,dest=/tmp/service.oci.tar \
  .
```

The first command catches normal developer and single-platform CI regressions. The second proves that every base image, downloaded architecture-specific tool, Rust build stage, and final runtime can resolve for both supported architectures.

## Emit parity evidence

```sh
npx tsjsv check \
  --typespec=test/fixtures/container-runtime-contract/main.tsp \
  --schema=test/fixtures/container-runtime-contract/authored.schema.json \
  --instances=test/fixtures/container-runtime-contract/instances \
  --report=.typespec-json-schema-validator/container-runtime-report.json \
  --contract-ir=.typespec-json-schema-validator/container-runtime-ir.json
```

The recorded corpus includes a valid shell-wrapper profile, a valid distroless direct-binary profile, and an invalid profile with no `cmd` member. Contract IR emission remains fail-closed: any authority drift, corpus disagreement, missing differential evidence, or changed exact input produces a non-admissible result.

The schema records the structural contract shared by the two authorities. Cross-field deployment policy still verifies that `exec_wrapper` is used only where the runtime has a shell, that direct-binary mode is used for hardened shell-free targets, and that the Docker image metadata matches the retained receipt and Contract IR digests.
