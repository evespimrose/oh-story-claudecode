#!/bin/bash
# check-python-invocation.sh — 가드: 스킬 문서 내 python3 단독 호출 금지
#
# Windows에서 python.org 설치 후 python3를 실행하면 Microsoft Store 자리 표시자(placeholder)가 실행되어 exit 49로 종료됩니다.
# 조용히 실패함(이슈 #121 참조). 모든 호출은 반드시 python3 -> python -> py 순으로 사용 가능한 인터프리터를 먼저 탐색해야 합니다.
#   for PYBIN in python3 python py; do "$PYBIN" -c "" 2>/dev/null && break; done
#   "$PYBIN" -c "..."
#
# 본 가드는 모든 '단독 호출' 형태를 차단합니다: python3 뒤에 공백과 임의의 인수가 오는 경우(-c / -m / << /
# 스크립트 경로 / 따옴표 등), 그리고 공백 없는 리다이렉션 형태(python3<<'PY' / python3<스크립트) —
# 후자는 유효한 셸 구문이며, 마찬가지로 Store 자리 표시자가 실행됩니다. 탐색 목록인 python3 python py 및
# 설명 텍스트(python3 뒤에 백슬래시 따옴표, 대시, 화살표 등이 공백 없이 붙는 경우)는 영향을 받지 않습니다.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "Error: not in a git repository"
  exit 1
fi

# 단독 호출 형태: python3 + 공백 + 임의의 비공백 인수(-c / -m / << / 스크립트 경로 / 따옴표 포함),
# 또는 python3 뒤에 바로 <가 오는 경우(heredoc python3<<'PY' 및 입력 리다이렉션 python3<스크립트, 공백 없이도 실행됨).
# < 이외의 문자가 붙는 형태(백슬래시 따옴표 / 대시 / 화살표 / 슬래시)는 여전히 설명 텍스트로 간주하여 제외합니다.
PATTERN='python3([[:space:]]+[^[:space:]]|<)'
# 탐색 목록 ... in python3 python py ... 는 허용되는 표기법이므로 탐색 결과에서 제외합니다(PYBIN/c 등의 변수명과 호환).
ALLOW='python3 python py'

echo "Python Invocation Guard"
echo "======================="

# skills/ 문서 + 배포 템플릿 훅(CI 스크립트 자체는 모든 표기법을 허용하며 스캔하지 않음)
hits="$(grep -rnE "$PATTERN" "$REPO_ROOT/skills" 2>/dev/null | grep -vF "$ALLOW" || true)"

if [ -n "$hits" ]; then
  echo "FAIL: python3 단독 호출 발견(Windows에서 exit 49 발생):"
  echo "$hits"
  echo
  echo "인터프리터 탐색 형태로 변경하세요:"
  echo '  for PYBIN in python3 python py; do "$PYBIN" -c "" 2>/dev/null && break; done'
  echo '  "$PYBIN" -c "..."'
  exit 1
fi

echo "OK: python3 단독 호출이 발견되지 않음"
echo

# 두 번째 가드: 배포형 훅에 내장된 python은 텍스트 모드 stdout 출력(print(/sys.stdout.write)을 사용할 수 없습니다.
# Windows 중국어 시스템의 python stdout 기본값은 cp936이며, 텍스트 모드는 중국어 경로를 GBK로 인코딩합니다. 이는 스크립트의 UTF-8
# 리터럴 바이트와 일치하지 않아 가드가 조용히 실패하게 됩니다(이슈 #164). 값을 셸에 전달하려면 반드시 UTF-8 바이트를 직접 작성해야 합니다.
#   sys.stdout.buffer.write(value.encode("utf-8"))
# print(`는 `printf `(괄호 없음)를 오탐하지 않으며, `sys.stdout.write(`는 허용된
# `sys.stdout.buffer.write(`(.buffer가 중간에 추가됨)를 오탐하지 않습니다.
HOOKS_DIR="$REPO_ROOT/skills/story-setup/references/templates/hooks"
TEXT_STDOUT='print\(|sys\.stdout\.write\('

echo "Hook stdout-encoding Guard"
echo "=========================="
if [ -d "$HOOKS_DIR" ]; then
  enc_hits="$(grep -rnE "$TEXT_STDOUT" "$HOOKS_DIR" --include='*.sh' 2>/dev/null || true)"
else
  enc_hits=""
fi

if [ -n "$enc_hits" ]; then
  echo "FAIL: hook 내장 python이 텍스트 모드 stdout 출력을 사용했습니다(Windows 중국어 시스템에서는 GBK로 인코딩되어 가드가 무력화됩니다):"
  echo "$enc_hits"
  echo
  echo "shell에 전달할 값을 UTF-8 바이트로 직접 작성하세요:"
  echo '  sys.stdout.buffer.write(value.encode("utf-8"))'
  exit 1
fi

echo "OK: hook 내장 python에서 텍스트 모드 stdout 출력이 발견되지 않았습니다"
