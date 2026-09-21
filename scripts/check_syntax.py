"""Read-only Python/ESM syntax baseline. Run: python scripts/check_syntax.py."""
import ast
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def check_module(node, source):
    # Explicit module mode avoids automatic .js format detection.
    return subprocess.run(
        [node, "--input-type=module", "--check"],
        input=source,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        cwd=ROOT,
        timeout=20,
    )


def main():
    node = shutil.which("node")
    if not node:
        print("FAIL: Node.js is not available on PATH.", file=sys.stderr)
        return 1

    failures = 0
    try:
        valid = check_module(node, "export {};")
        invalid = check_module(node, "try {} finally {} finally {}")
        if valid.returncode != 0 or invalid.returncode == 0 or "SyntaxError" not in invalid.stderr:
            print("FAIL: Node syntax-check self-test failed.", file=sys.stderr)
            return 1
        print("PASS: checker accepts valid ESM and rejects invalid syntax")

        python_files = sorted(ROOT.glob("*.py")) + sorted((ROOT / "scripts").glob("*.py"))
        for filename in python_files:
            try:
                ast.parse(filename.read_text(encoding="utf-8-sig"), filename=str(filename))
                print(f"PASS: {filename.relative_to(ROOT)}")
            except (SyntaxError, UnicodeError) as error:
                failures += 1
                print(f"FAIL: {filename.relative_to(ROOT)}: {error}", file=sys.stderr)

        for filename in sorted((ROOT / "public").rglob("*.js")):
            if "vendor" in filename.relative_to(ROOT / "public").parts or filename.name.endswith(".min.js"):
                continue
            result = check_module(node, filename.read_text(encoding="utf-8-sig"))
            if result.returncode:
                failures += 1
                print(f"FAIL: {filename.relative_to(ROOT)}\n{result.stderr}", file=sys.stderr)
            else:
                print(f"PASS: {filename.relative_to(ROOT)}")
    except (OSError, subprocess.TimeoutExpired) as error:
        print(f"FAIL: unable to complete checks: {error}", file=sys.stderr)
        return 1

    print(f"Syntax baseline: {'FAILED' if failures else 'PASSED'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
