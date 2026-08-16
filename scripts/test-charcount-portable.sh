#!/bin/bash
# test-charcount-portable.sh — 3대 플랫폼 + Windows에서 '크로스 플랫폼 문자 수 통계' 명령이
# Microsoft Store 자리 표시자 프로그램 시나리오에서도 중국어 문자 수를 정확하게 계산하는지 검증합니다.
#
# 배경: 스킬 문서에서 모델이 아래 탐지 명령을 사용하여 글자 수를 통계하도록 요구합니다. Windows에서 python.org 설치 후
# `python3`가 Microsoft Store 자리 표시자 프로그램으로 연결되어 exit 49와 함께 아무 표시 없이 실패하므로, 반드시
# python3 -> python -> py 순서로 실제 사용 가능한 인터프리터를 탐색해야 합니다. GitHub windows-latest에 기본 포함된
# python3가 있으므로, `--stub` 모드에서 exit 49를 반환하는 가짜 python3를 인위적으로 삽입하여 실제 오류를 재현합니다.
#
# 사용법:
#   bash scripts/test-charcount-portable.sh           # 실제 인터프리터 사용
#   bash scripts/test-charcount-portable.sh --stub     # Store 자리 표시자 프로그램 시뮬레이션(exit 49)
#
# 주의: 아래 PROBE/COUNT 두 줄은 스킬 문서의 명령과 토씨 하나 틀리지 않고 일치해야 합니다(story-short-write,
# story-long-write, narrative-writer, style-profile-generator). check-python-invocation.sh는
# 문서가 단순한 python3로 되돌아가지 않도록 방어하며, 본 스크립트는 이 명령이 실제로 정확한 결과를 출력하는지 검증합니다.
set -euo pipefail

STUB=0
[ "${1:-}" = "--stub" ] && STUB=1

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 중국어 디렉터리 + 중국어 파일명으로 issue #121의 경로 시나리오 재현
BOOK_DIR="$WORK/소설 프로젝트/제1권"
mkdir -p "$BOOK_DIR"
# 12개 코드 포인트: 중국어 글자 수 테스트(6) + ABC(3) + 123(3), 끝 줄 바꿈 없음
printf '%s' '중국어 글자 수 테스트 ABC123' > "$BOOK_DIR/본문.md"
EXPECT=12

# 먼저 실제 사용 가능한 인터프리터를 기억합니다. stub은 독립적으로 동작해야 하며, 현재 머신에
# python3와 python/py가 동시에 설치되어 있다고 가정하지 않습니다(일부 macOS 환경에는 python3만 있음).
REAL_PYTHON=""
for candidate in python3 python py; do
  if "$candidate" -c "" >/dev/null 2>&1; then
    REAL_PYTHON="$(command -v "$candidate")"
    break
  fi
done
[ -n "$REAL_PYTHON" ] || { echo "FAIL: no working Python interpreter" >&2; exit 1; }

if [ "$STUB" -eq 1 ]; then
  # PATH 맨 앞에 항상 exit 49를 반환하는 가짜 python3를 삽입하여 Windows Store 자리 표시자 프로그램을 재현합니다.
  FAKEBIN="$WORK/fakebin"
  mkdir -p "$FAKEBIN"
  printf '#!/bin/sh\nexit 49\n' > "$FAKEBIN/python3"
  printf '#!/bin/sh\nexec "%s" "$@"\n' "$REAL_PYTHON" > "$FAKEBIN/python"
  chmod +x "$FAKEBIN/python3"
  chmod +x "$FAKEBIN/python"
  PATH="$FAKEBIN:$PATH"
  export PATH
  echo "[stub] python3가 이제 exit 49로 고정되었습니다(Microsoft Store 자리 표시자 프로그램 시뮬레이션)"
fi

# === 스킬 문서와 토씨 하나 틀리지 않고 일치하는 탐지 + 통계 명령어 ===
# 상대 경로를 사용하여 통계(먼저 도서 디렉터리로 cd 한 후 파일명 전달) — 이것이 바로 스킬 내 모델의 사용법입니다:
# 먼저 프로젝트/본문 디렉터리로 cd 한 후 상대 경로를 사용합니다. Windows Git Bash에서 절대 POSIX 경로
# (/tmp/..., /c/...)를 네이티브 Windows Python에 직접 전달하면 C:\tmp\...로 해석되어 파일을 찾을 수 없게 됩니다.
# 상대 경로는 자식 프로세스의 실제 cwd에 따라 해석되므로, 세 플랫폼에서 모두 동일하게 작동합니다.
for PYBIN in python3 python py; do "$PYBIN" -c "" 2>/dev/null && break; done
GOT="$(cd "$BOOK_DIR" && "$PYBIN" -c "from pathlib import Path; print(len(Path('본문.md').read_text(encoding='utf-8')))")"
# === 명령어 종료 ===

echo "selected interpreter: $PYBIN"
echo "char count: $GOT (expect $EXPECT)"

fail=0
if [ "$GOT" != "$EXPECT" ]; then
  echo "FAIL: 글자 수 불일치(중국어 경로 또는 인터프리터 문제)"
  fail=1
fi
if [ "$STUB" -eq 1 ] && [ "$PYBIN" = "python3" ]; then
  echo "FAIL: stub 모드에서 여전히 손상된 python3가 선택됨, 폴백 체인이 작동하지 않음"
  fail=1
fi
if [ "$fail" -eq 0 ]; then
  echo "PASS"
fi
exit "$fail"
