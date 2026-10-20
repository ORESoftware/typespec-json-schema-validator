"""Independent synthetic Bash/Python bootstrap-security canary.

This PUBLIC test contains no private Oreslang source, binary, generated
artifact, test fixture, Git blob, or authorization receipt. It validates
general Linux startup and file-link semantics only, not the Zorde gate.
"""
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

if not (sys.flags.isolated and sys.flags.no_site and sys.flags.optimize == 0):
    raise SystemExit("SOURCE_FREE_REFUSED: python3 -I -S without -O required")


def run(args, env=None, cwd=None):
    return subprocess.run(args, cwd=cwd, env=env, capture_output=True,
                          text=True, timeout=15, check=False)


def checked_regular_paths(*paths):
    for path in paths:
        leaf = path.lstat()
        if not stat.S_ISREG(leaf.st_mode) or leaf.st_nlink != 1:
            raise ValueError("linked or nonregular executable")
        for parent in path.parents:
            if not stat.S_ISDIR(parent.lstat().st_mode):
                raise ValueError("symlinked or nondirectory ancestor")


passed = 0

def success(condition, label):
    global passed
    assert condition, "FAIL " + label
    passed += 1
    print("PASS", label)

with tempfile.TemporaryDirectory(prefix="sourcefree-bash-startup-") as tmp:
    root = Path(tmp)
    marker_bad = root / "bad-marker"
    old = root / "old-startup.sh"
    old.write_text("printf injected > " + str(marker_bad) + "\\n")
    env_bad = {"PATH": "/usr/bin:/bin", "BASH_ENV": str(old), "ENV": str(old)}
    p = run(["/usr/bin/bash", "--noprofile", "--norc", "-c", ":"], env_bad)
    success(p.returncode == 0 and not marker_bad.exists()
            and Path(str(marker_bad) + "n").read_text() == "injected",
            "old escaped-newline fixture produces a false-negative marker")

    marker = root / "startup-executed"
    startup = root / "startup.sh"
    startup.write_text("printf injected > " + str(marker) + "\n")
    inherited = {"PATH": "/usr/bin:/bin", "BASH_ENV": str(startup),
                 "ENV": str(startup), "GIT_DIR": "/untrusted/repo",
                 "PYTHONOPTIMIZE": "1", "NODE_OPTIONS": "--inspect"}
    control = run(["/usr/bin/bash", "--noprofile", "--norc", "-c", ":"],
                  inherited)
    success(control.returncode == 0 and marker.read_bytes() == b"injected",
            "positive control proves inherited Bash startup executes")
    marker.unlink()

    scripts = root / "scripts"
    scripts.mkdir(mode=0o700)
    launcher = scripts / "launcher.py"
    launcher.write_text("print('synthetic')\n")
    gate = scripts / "gate.sh"
    gate.write_text('test -z "${BASH_ENV:-}" && '
                    'test -z "${GIT_DIR:-}" && '
                    'test -z "${NODE_OPTIONS:-}" && '
                    "printf SAFE")
    gate.chmod(0o700)
    checked_regular_paths(launcher, gate)
    success(True, "real unique executable files and ancestors accepted")

    approved_env = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8",
                    "LC_ALL": "C.UTF-8"}
    p = run(["/usr/bin/bash", "--noprofile", "--norc", str(gate)],
            approved_env, root)
    success(p.returncode == 0 and p.stdout == "SAFE"
            and not marker.exists(), "fresh child Bash strips startup and code-injection env")

    linked_launcher = scripts / "linked-launcher.py"
    linked_launcher.symlink_to(launcher)
    try:
        checked_regular_paths(linked_launcher, gate)
        refused = False
    except ValueError:
        refused = True
    success(refused, "linked launcher refused")

    linked_gate = scripts / "linked-gate.sh"
    linked_gate.symlink_to(gate)
    try:
        checked_regular_paths(launcher, linked_gate)
        refused = False
    except ValueError:
        refused = True
    success(refused, "linked Bash gate refused")

    alias = root / "alias"
    alias.symlink_to(scripts, target_is_directory=True)
    try:
        checked_regular_paths(alias / launcher.name, alias / gate.name)
        refused = False
    except ValueError:
        refused = True
    success(refused, "symlinked script ancestor refused")

    hard_gate = scripts / "hard-gate.sh"
    os.link(gate, hard_gate)
    try:
        checked_regular_paths(launcher, gate)
        refused = False
    except ValueError:
        refused = True
    success(refused, "hardlinked executable refused")
    hard_gate.unlink()

    for args, label in [
        (["-I", "-S", "-O"], "optimized Python denied"),
        (["-S"], "nonisolated Python denied"),
        (["-I"], "Python without no-site denied"),
    ]:
        p = run([sys.executable, *args, __file__], {"PATH": "/usr/bin:/bin"})
        success(p.returncode == 2 and "SOURCE_FREE_REFUSED" in p.stderr,
                label)

print("SOURCE_FREE_BOOTSTRAP_11_OF_11_PASSED")
