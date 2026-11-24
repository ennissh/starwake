#!/usr/bin/env bash
###############################################################################
# build.sh - test, then build the Starwake image
#
#   ./build.sh --local          test.sh, then a local image for this machine's arch
#                               (tags: ghcr.io/ennissh/starwake:<X.Y.Z-N> and :local)
#   ./build.sh --push           test.sh, then a multi-arch (amd64 + arm64) push to GHCR
#                               (tags: <X.Y.Z-N> and :latest). Needs `docker login ghcr.io`.
#   ./build.sh --release        re-tag the image of this exact commit as <X.Y.Z> (and :stable)
#                               by digest; no rebuild. Bump VERSION afterwards.
# Options:
#   --skip-tests                only for re-running a build right after a green ./test.sh
#   --image NAME                default ghcr.io/ennissh/starwake
#   --ca FILE                   extra CA bundle for npm inside the build (TLS-inspecting proxy);
#                               passed as a BuildKit secret, never stored in the image
###############################################################################
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
MODE="" SKIP_TESTS=0 IMAGE="ghcr.io/ennissh/starwake" CA_FILE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --local|--push|--release) MODE="${1#--}" ;;
        --skip-tests) SKIP_TESTS=1 ;;
        --image) IMAGE="$2"; shift ;;
        --ca) CA_FILE="$2"; shift ;;
        -h|--help) sed -n "2,18p" "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
    shift
done
[[ -n "$MODE" ]] || { echo "choose --local, --push or --release (see --help)" >&2; exit 2; }

VERSION="$(scripts/version.sh)"
SHA="$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ $MODE != local && $VERSION == *-dirty ]]; then
    echo "refusing to $MODE a dirty tree ($VERSION): commit first" >&2; exit 1
fi

if [[ $MODE == release ]]; then
    REL="$(scripts/version.sh --release)"
    echo "promoting $IMAGE:$VERSION → $REL and stable (by digest)"
    docker buildx imagetools create -t "$IMAGE:$REL" -t "$IMAGE:stable" "$IMAGE:$VERSION"
    echo "done. Now bump VERSION to the next release line and commit."
    exit 0
fi

if [[ $SKIP_TESTS == 0 ]]; then ./test.sh; fi

args=(--build-arg "STARWAKE_VERSION=$VERSION" --build-arg "STARWAKE_GIT_SHA=$SHA" --build-arg "STARWAKE_BUILT_AT=$BUILT_AT" -f Dockerfile .)
if [[ -n "$CA_FILE" ]]; then
    [[ -s "$CA_FILE" ]] || { echo "--ca: $CA_FILE not found" >&2; exit 2; }
    args=(--secret "id=build_ca,src=$CA_FILE" --network host
          --build-arg "HTTPS_PROXY=${HTTPS_PROXY:-${https_proxy:-}}" --build-arg "HTTP_PROXY=${HTTP_PROXY:-${http_proxy:-}}"
          --build-arg "NO_PROXY=${NO_PROXY:-${no_proxy:-}}" "${args[@]}")
fi
if [[ $MODE == local ]]; then
    docker build -t "$IMAGE:$VERSION" -t "$IMAGE:local" "${args[@]}"
    echo "built $IMAGE:$VERSION (also :local)"
else
    docker buildx build --platform linux/amd64,linux/arm64 --push \
        -t "$IMAGE:$VERSION" -t "$IMAGE:latest" "${args[@]}"
    echo "pushed $IMAGE:$VERSION and :latest"
fi
