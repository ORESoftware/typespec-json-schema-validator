"""Independent, source-free POSIX output and descriptor safety oracle.

No private Oreslang code, fixture, Git blobs or generated artifacts are used.
Tests only Bash noclobber and Python O_NOFOLLOW filesystem behavior.
"""
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

if not (sys.flags.isolated and sys.flags.no_site and sys.flags.optimize == 0):
    raise SystemExit("SOURCE_FREE_OUTPUT_REFUSED: python3 -I -S without -O required")

count=0
def passed(ok,label):
    global count
    assert ok,"FAILED: "+label
    count+=1
    print("PASS",label)

def write_exclusive(path):
    bash='set -euo pipefail; umask 077; set -C; printf native-marker >"$1"'
    return subprocess.run(['/usr/bin/bash','--noprofile','--norc','-c',
                           bash,'sourcefree',str(path)],
                          capture_output=True,text=True,timeout=10)

with tempfile.TemporaryDirectory(prefix='source-free-native-output-') as d:
    root=Path(d)
    out=root/'fresh.log'
    p=write_exclusive(out)
    passed(p.returncode==0 and out.read_bytes()==b'native-marker'
           and stat.S_IMODE(out.stat().st_mode)==0o600,
           'exclusive Bash native log created as private regular file')

    p=write_exclusive(out)
    passed(p.returncode!=0 and out.read_bytes()==b'native-marker',
           'existing log refused without modifying prior bytes')

    target=root/'outside.log'
    dangling=root/'dangling.log'
    dangling.symlink_to(target)
    p=write_exclusive(dangling)
    passed(p.returncode!=0 and dangling.is_symlink() and not target.exists(),
           'dangling log symlink refused without writing target')

    target.write_bytes(b'protected-target')
    linked=root/'linked.log'
    linked.symlink_to(target)
    p=write_exclusive(linked)
    passed(p.returncode!=0 and target.read_bytes()==b'protected-target',
           'existing symlink target refused without clobber')

    hard=root/'hard.log'
    os.link(target,hard)
    p=write_exclusive(hard)
    passed(p.returncode!=0 and target.read_bytes()==b'protected-target',
           'hardlink output alias refused without clobber')

    flags=os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK
    try:
        os.open(linked,flags)
        refused=False
    except OSError:
        refused=True
    passed(refused,'O_NOFOLLOW rejects linked leaf instead of reading target')

    fd=os.open(target,flags)
    try:
        before=os.fstat(fd)
        data=os.read(fd,before.st_size+1)
        after=os.fstat(fd)
        good=(stat.S_ISREG(before.st_mode) and before.st_nlink==2
              and data==b'protected-target'
              and before.st_ino==after.st_ino
              and before.st_dev==after.st_dev
              and before.st_mtime_ns==after.st_mtime_ns)
    finally:
        os.close(fd)
    passed(good,'descriptor read binds bytes to stable inode under fstat')

    fifo=root/'untrusted.fifo'
    os.mkfifo(fifo,mode=0o600)
    # An old-style Bash redirection blocks on the FIFO *before* the
    # invoked command/timeout has even started. Prove this is a real hazard.
    blocked=False
    try:
        subprocess.run(['/usr/bin/bash','--noprofile','--norc','-c',
                        'set -C; echo unsafe > "$1"','sourcefree',str(fifo)],
                       capture_output=True,text=True,timeout=0.4)
    except subprocess.TimeoutExpired:
        blocked=True
    passed(blocked,'noclobber still blocks before timeout on existing FIFO')

    fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        try:
            other=os.open('untrusted.fifo',
                          os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,
                          0o600,dir_fd=fd)
            os.close(other)
            refused=False
        except FileExistsError:
            refused=True
    finally:
        os.close(fd)
    passed(refused,'anchored exclusive open refuses FIFO without blocking')

    fd=os.open(fifo,flags)
    try:
        passed(not stat.S_ISREG(os.fstat(fd).st_mode),
               'nonblocking open permits immediate FIFO-type denial')
    finally:
        os.close(fd)

    symlinked_dir=root/'alias'
    symlinked_dir.symlink_to(root,target_is_directory=True)
    unsafe=symlinked_dir/'fresh.log'
    passed(any(not stat.S_ISDIR(os.lstat(parent).st_mode)
               for parent in unsafe.parents),
           'path-ancestor lstat rejects symlinked parent before file open')

print(f"SOURCE_FREE_NATIVE_OUTPUT_{count}_OF_11_PASSED")
