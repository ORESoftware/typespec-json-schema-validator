#!/usr/bin/env python3
"""Verify an exact offline mirror of private Oreslang Git tree without credentials."""
from pathlib import Path
import hashlib
import os
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "ci" / "ores-pr785-fulltree-manifest.tsv"
SOURCE = ROOT / "ores-source-fulltree"

def fail(message: str) -> None:
    raise SystemExit("ores full-tree gate: " + message)

headers = {}
entries = []
for raw in MANIFEST.read_text(encoding="utf-8").splitlines():
    if raw.startswith("# "):
        key, value = raw[2:].split("=", 1)
        headers[key] = value
    elif raw:
        mode, sha, name = raw.split("\t", 2)
        components = Path(name).parts
        if not components or any(x in ("..", ".") for x in components) or Path(name).is_absolute():
            fail("unsafe path " + name)
        if mode not in ("100644", "100755") or len(sha) != 40:
            fail("unsupported git entry " + name)
        entries.append((mode, sha, name))

if len(entries) != int(headers["file_count"]):
    fail("manifest count mismatch")
if len({path for _, _, path in entries}) != len(entries):
    fail("manifest has duplicate paths")
seen = set()
for mode, expected, name in entries:
    path = SOURCE / name
    if not path.is_file() or path.is_symlink():
        fail("missing/unexpected path: " + name)
    data = path.read_bytes()
    sha = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    if sha != expected:
        fail("blob SHA mismatch: " + name)
    executable = bool(path.stat().st_mode & 0o111)
    if executable != (mode == "100755"):
        fail("mode mismatch: " + name)
    seen.add(name)
extra = {str(p.relative_to(SOURCE)) for p in SOURCE.rglob("*") if p.is_file()} - seen
if extra:
    fail("unlisted files: " + ", ".join(sorted(extra)[:10]))

with tempfile.TemporaryDirectory(prefix="ores-git-index-") as d:
    env = dict(os.environ, GIT_INDEX_FILE=str(Path(d) / "index"))
    subprocess.run(["git", "read-tree", "--empty"], cwd=ROOT, env=env, check=True)
    records = "".join(mode + " " + sha + "\t" + name + "\n" for mode, sha, name in entries)
    subprocess.run(["git", "update-index", "--index-info"], input=records,
                   text=True, cwd=ROOT, env=env, check=True)
    tree = subprocess.check_output(["git", "write-tree"], cwd=ROOT, env=env, text=True).strip()
if tree != headers["source_tree"]:
    fail("reconstructed tree " + tree + " differs from pinned " + headers["source_tree"])
print("Exact private-source Git tree verified: " + tree + ", " + str(len(entries)) + " files")
