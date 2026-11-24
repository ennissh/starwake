#!/usr/bin/env bash
# Secret check for a public repo (R6). Uses gitleaks when installed (on tracked files);
# otherwise a built-in scan for common credential shapes and committed env/save files.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if command -v gitleaks >/dev/null 2>&1; then
    gitleaks dir . --no-banner --redact
    exit $?
fi
fail=0
# Files that must never be tracked.
if bad="$(git ls-files | grep -E '(^|/)\.env$|(^|/)data/|\.pem$|\.key$|id_rsa|\.p12$' || true)" && [[ -n "$bad" ]]; then
    echo "secret check: these files must not be committed:" >&2; echo "$bad" >&2; fail=1
fi
pattern='(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}|gho_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{32,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35})'
if hits="$(git ls-files -z | xargs -0 grep -nIE "$pattern" -- 2>/dev/null | grep -v '^scripts/check-secrets.sh:' || true)" && [[ -n "$hits" ]]; then
    echo "secret check: credential-shaped strings found:" >&2; echo "$hits" >&2; fail=1
fi
[[ $fail == 0 ]] && echo "secret check: ok (built-in; install gitleaks for a deeper scan)"
exit $fail
