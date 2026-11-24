"""The data-folder lock must work on Windows, Linux and macOS and never signal other processes."""

import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

from backend.config import ROOT
from backend.storage import DataDirInUse, DataDirLock


class DataDirLockTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="virelix-lock-"))
        self.path = self.tmp / "data" / "server.lock"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_acquire_release_and_reacquire(self):
        lock = DataDirLock(self.path).acquire()
        self.assertTrue(self.path.is_file())
        self.assertEqual(lock.holder_pid(), os.getpid())
        lock.release()
        self.assertFalse(self.path.exists())
        DataDirLock(self.path).acquire().release()

    def test_second_holder_is_refused_and_named(self):
        first = DataDirLock(self.path).acquire()
        try:
            with self.assertRaises(DataDirInUse) as ctx:
                DataDirLock(self.path).acquire()
            self.assertEqual(ctx.exception.pid, os.getpid())
            self.assertIn("Another Virelix server", str(ctx.exception))
            self.assertTrue(DataDirLock.is_held(self.path))
        finally:
            first.release()
        self.assertFalse(DataDirLock.is_held(self.path))

    def test_context_manager(self):
        with DataDirLock(self.path):
            self.assertTrue(DataDirLock.is_held(self.path))
        self.assertFalse(DataDirLock.is_held(self.path))

    def test_stale_file_from_a_dead_process_does_not_block(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_bytes(b"L999999")        # a leftover from a crashed server: nobody holds the OS lock
        DataDirLock(self.path).acquire().release()

    def test_lock_is_released_by_the_os_when_the_holder_dies_and_is_exclusive_across_processes(self):
        code = textwrap.dedent(f"""
            import sys, time
            sys.path.insert(0, {str(ROOT)!r})
            from backend.storage import DataDirLock
            held = DataDirLock({str(self.path)!r}).acquire()  # keep a reference: dropping it closes the file
            print("locked", flush=True)
            time.sleep(60)
        """)
        proc = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(proc.stdout.readline().strip(), "locked")
            with self.assertRaises(DataDirInUse) as ctx:
                DataDirLock(self.path).acquire()
            self.assertEqual(ctx.exception.pid, proc.pid)
        finally:
            proc.kill()                           # simulate a crash: no clean release
            proc.wait(timeout=10)
            proc.stdout.close()
        DataDirLock(self.path).acquire().release()  # the OS freed the lock; no manual cleanup

    def test_no_process_signalling_in_runtime_code(self):
        # os.kill(pid, 0) terminates the target process on Windows; it must never be used to probe.
        offenders = [str(p.relative_to(ROOT)) for base in ("backend", "scripts", "run.py")
                     for p in ([ROOT / base] if (ROOT / base).is_file() else (ROOT / base).rglob("*.py"))
                     if "os.kill" in p.read_text(encoding="utf-8")]
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
