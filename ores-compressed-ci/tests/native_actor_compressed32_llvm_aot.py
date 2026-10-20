#!/usr/bin/env python3
"""Compile verifier-approved actor compact32 LLVM IR and execute against ActorArena.c.

This is a backend+runtime integration test. It is NOT Oreslang source-level
Ref<T> admission: the MIR is built by a dedicated trusted test producer until
the real native source frontend can mint checked actor-reference provenance.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys
import tempfile


def run(*args: str, output: Path | None = None) -> subprocess.CompletedProcess[str]:
    process = subprocess.run(
        [str(arg) for arg in args], text=True, capture_output=True, check=False
    )
    if process.returncode:
        raise RuntimeError(
            f"command failed ({process.returncode}): {' '.join(map(str, args))}\n"
            f"stdout:\n{process.stdout}\nstderr:\n{process.stderr}"
        )
    if output is not None and not output.is_file():
        raise RuntimeError(f"compiler did not produce expected output: {output}")
    return process


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--producer", required=True, type=Path)
    parser.add_argument("--clang", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path)
    args = parser.parse_args()

    root = args.root.resolve()
    include = root / "src" / "main" / "cpp"
    runtime = include / "oreslang" / "runtime" / "ActorArena.c"
    driver = root / "tests" / "native_actor_compressed32_llvm_driver.c"
    for path in (args.producer, args.clang, runtime, driver):
        if not path.is_file():
            raise RuntimeError(f"missing exact-source integration input: {path}")

    with tempfile.TemporaryDirectory(prefix="ores-actor-ref32-") as directory:
        temporary = Path(directory)
        llvm_file = temporary / "verified-actor-compact32.ll"
        generated = run(str(args.producer), "--emit-ir").stdout
        if "define i64 @checked_actor_read" not in generated or (
            "@ores_actor_arena_compact_publish_i32" not in generated
        ):
            raise RuntimeError("LLVM producer did not emit verified i32 actor MIR")
        llvm_file.write_text(generated, encoding="utf-8")

        runtime_object = temporary / "arena.o"
        driver_object = temporary / "driver.o"
        llvm_object = temporary / "managed-ref.o"
        executable = temporary / "actor-compact32-aot"
        common = (
            "-O2", "-Wall", "-Wextra", "-Wpedantic", "-Werror",
            f"-I{include}",
        )
        run(str(args.clang), "-std=c11", *common, "-c", str(runtime),
            "-o", str(runtime_object), output=runtime_object)
        run(str(args.clang), "-std=c11", *common, "-c", str(driver),
            "-o", str(driver_object), output=driver_object)
        run(str(args.clang), "-O2", "-Wno-override-module",
            "-c", str(llvm_file), "-o", str(llvm_object), output=llvm_object)
        run(str(args.clang), str(runtime_object), str(driver_object),
            str(llvm_object), "-o", str(executable), output=executable)
        executed = run(str(executable))
        if "LLVM_MANAGED_COMPRESSED32_ACTOR_RUNTIME_PASS" not in executed.stdout:
            raise RuntimeError("native compiled test did not report the expected success")

    print("PASS: verified actor compact32 LLVM i32 load/store against real ActorArena.c")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, OSError) as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
