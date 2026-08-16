#!/bin/bash
# Cross-platform launcher for the structured skill Markdown checker.

set -euo pipefail

# `set -e` 환경에서 일반 변수 할당은 명령어 치환의 종료 코드를 상속합니다. git 명령이 실패하면(저장소가 아니거나 git이 없는 경우) 스크립트가 즉시 중단됩니다.
# 이 경우 아래의 진단 분기에 도달할 수 없으므로, `|| true`로 오류를 방지하고 판정은 `-z` 검사에 맡깁니다.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "Error: not in a git repository" >&2
  exit 1
fi

PYBIN=""
for candidate in python3 python py; do
  if "$candidate" -c "" >/dev/null 2>&1; then
    PYBIN="$candidate"
    break
  fi
done
if [ -z "$PYBIN" ]; then
  echo "Error: Python 3 is required for scripts/static-check.py" >&2
  exit 1
fi

exec "$PYBIN" "$REPO_ROOT/scripts/static-check.py" --root "$REPO_ROOT"
