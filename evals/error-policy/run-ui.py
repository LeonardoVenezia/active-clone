"""Reap bundler helper processes when the local browser harness finishes."""
import ctypes
import os
import subprocess
import sys

# Linux child-subreaper prevents the offline bundler helper becoming detached.
if sys.platform == "linux":
    ctypes.CDLL(None).prctl(36, 1, 0, 0, 0)
result = subprocess.run(["node", "evals/error-policy/ui.cjs"])
if sys.platform == "linux":
    while True:
        try:
            os.waitpid(-1, 0)
        except ChildProcessError:
            break
sys.exit(result.returncode)
