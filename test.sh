#!/usr/bin/env bash
###############################################################################
# test.sh - the full local test cycle (no GitHub Actions, PLAN §0.7)
#
#   ./test.sh            format, lint, typecheck, unit (incl. content validation),
#                        clean-room + secret checks, build, Playwright smoke (LLM_MODE=mock)
#   ./test.sh --quick    everything except the build and the Playwright smoke
###############################################################################
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
QUICK=0
for a in "$@"; do
    case "$a" in
        --quick) QUICK=1 ;;
        -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
        *) echo "unknown option: $a" >&2; exit 2 ;;
    esac
done

step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
[[ -d node_modules ]] || { step "npm ci"; npm ci --no-audit --no-fund; }

step "clean-room check";  scripts/check-cleanroom.sh
step "secret check";      scripts/check-secrets.sh
if command -v shellcheck >/dev/null; then
    step "shellcheck";    shellcheck -S warning install.sh build.sh test.sh scripts/*.sh
fi
step "format";            npx prettier --check . --log-level warn
step "lint";              npm run -s lint
step "typecheck";         npm run -s typecheck
step "unit tests";        npx vitest run
if [[ $QUICK == 0 ]]; then
    step "build";         npm run -s build
    step "playwright smoke (mock LLM)"; npx playwright test e2e/smoke.spec.ts --trace off
fi
printf '\n\033[1;32mtest.sh: all green (%s)\033[0m\n' "$(scripts/version.sh)"
