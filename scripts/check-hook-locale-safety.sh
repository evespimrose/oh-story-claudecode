#!/bin/bash
# check-hook-locale-safety.sh — Windows 중문 GBK 로캘 환경에서 배포 hook의 바이트 안전성을 보호합니다.
#
# 배경(issue #164와 유사): 배포 hook은 사용자 Windows Git Bash에서 실행됩니다. 사용자가 GBK/GB2312
# 로캘을 설정하면, gawk/GNU sed/GNU grep 및 bash 와일드카드가 UTF-8 중문 내용/경로를 멀티바이트로 잘못 디코딩하여,
# 가드(guard)가 자동으로 무력화(오탐지 또는 미탐지)될 수 있습니다. 해결책은 hook 내에서 `export LC_ALL=C`를 설정하여 바이트 매칭을 수행하는 것입니다.
#
# 이 가드는 로캘과 무관한 정적 검사(모든 CI 환경에서 실행 가능)이며, 동작 수준의 회귀 테스트인
# scripts/test-hook-encoding-portable.sh(실제 GBK 로캘 환경에서 hook을 엔드 투 엔드로 실행)와 상호 보완적입니다.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "Error: not in a git repository"
  exit 1
fi
HOOKS_DIR="$REPO_ROOT/skills/story-setup/references/templates/hooks"

echo "Hook locale-safety Guard"
echo "========================"

fail=0

# Check 1: 중문 내용/경로를 처리하는 모든 배포 hook은 반드시 export LC_ALL=C를 수행하여 GBK 로캘 환경에서 바이트 매칭을 수행해야 합니다.
# Python이 내장된 hook(guard-outline/validate-story-commit)은 export 위치가 별도로 지정되어 있으나(각 파일 주석 참조),
# 모두 해당 export가 반드시 포함되어야 합니다.
# 목록을 더 이상 수동으로 작성하지 않습니다. hooks 최상위의 *.sh를 직접 열거하며(lib/는 Check 3의 per-command LC_ALL=C에서 관리), 새로 추가된 hook은
# 자동으로 검사 대상에 포함됩니다. 이전 수동 목록에서는 check-prose-after-write.sh가 누락되었는데, 이 파일의 `case "$BASE" in 정문.md)` 부분은
# 전적으로 export LC_ALL=C를 통한 바이트 비교에 의존하므로, 등록 누락은 이 가드가 해당 파일을 전혀 감지하지 못함을 의미합니다.
# 최소 목록에는 '반드시 존재해야 함'이라는 의미만 유지합니다. hook이 실수로 삭제되었을 때 열거되지 않아 정상으로 오인(False Pass)되는 상황을 방지하기 위함입니다.
REQUIRED_LOCALE_HOOKS="check-prose-after-write detect-story-gaps guard-outline-before-prose validate-story-commit session-start session-end pre-compact post-compact"
for h in $REQUIRED_LOCALE_HOOKS; do
  if [ ! -f "$HOOKS_DIR/$h.sh" ]; then
    echo "FAIL: 예상되는 로캘 민감 hook이 존재하지 않음: $h.sh"
    fail=1
  fi
done
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if ! grep -qE '^[[:space:]]*export[[:space:]]+LC_(ALL|CTYPE)=C\b' "$f"; then
    echo "FAIL: $(basename "$f")에 export LC_ALL=C가 누락됨(GBK 로캘 환경에서 중문 매칭 오류 발생, issue #164와 유사)"
    fail=1
  fi
done < <(find "$HOOKS_DIR" -maxdepth 1 -name '*.sh' -type f | sort)
[ "$fail" -eq 0 ] && echo "OK: 로캘 민감 hook에 모두 export LC_ALL=C가 적용됨"

# Check 2: 배포 hook의 정규식에서 전각 문자가 포함된 대괄호 문자 집합(예: [：:]) 사용을 금지합니다. 전각 문자가 포함된
# 문자 집합은 UTF-8 로캘에서만 올바르게 작동하며, C/GBK 로캘에서는 단일 바이트로 분리되어 매칭에 실패합니다. 대신 택일형 (：|:)을 사용해야 합니다.
# 바이트 매칭을 사용하여 `[` 뒤에 전각 콜론/세미콜론/쉼표/마침표 등 일반적인 전각 문장 부호가 오는지 검사하고, 전체 행 주석은 건너뜁니다.
# 디렉터리를 "$HOOKS_DIR"/*.sh가 아닌 -r(--include와 함께 사용)에 전달해야 합니다. 후자는 최상위 파일만 확장하므로 -r이 무의미해지기 때문입니다.
# lib/common.sh, lib/sentinel.sh 내의 문자 그룹을 하나도 스캔할 수 없습니다.
BRACKET_HITS="$(LC_ALL=C grep -rnE '\[[^]]*(：|；|，|。|！|？|、)' "$HOOKS_DIR" --include='*.sh' 2>/dev/null \
  | grep -vE ':[0-9]+:[[:space:]]*#' || true)"
if [ -n "$BRACKET_HITS" ]; then
  echo "FAIL: 배포 hook 정규식에 전각 문자가 포함된 대괄호 문자 그룹이 발견되었습니다(C/GBK 로캘에서 매칭 누락 발생 가능, 대신 교체 패턴 (A|B) 사용):"
  echo "$BRACKET_HITS"
  fail=1
else
  echo "OK: 전각 문자가 포함된 대괄호 문자 그룹이 발견되지 않았습니다"
fi

# Check 3: hooks/lib/ 하위의 함수 라이브러리는 자체적으로 export LC_ALL=C를 수행하지 않으며(호출 측에서 로캘 결정), 중국어 도서명/경로를 처리할 때
# 사용하는 sed/grep은 반드시 명령별(per-command)로 LC_ALL=C를 추가해야 합니다. 그렇지 않으면 GBK 환경에서 trim 시 illegal byte sequence 오류가 발생하거나,
# .active-book 내용이 비워지거나, find로 찾은 첫 번째 도서로 잘못 파싱될 수 있습니다.
# common.sh만 하드코딩하지 않고 lib/ 전체를 스캔합니다. sentinel.sh 역시 session-start에서 재사용되므로, 파일명을 하드코딩하면
# 새로 추가된 함수 라이브러리가 자동으로 검사에서 제외되기 때문입니다.
if [ -d "$HOOKS_DIR/lib" ]; then
  # grep -n으로 파일명 접두사(-H)를 포함하고, 주석 행은 :[0-9]+:[[:space:]]*#를 사용하여 제외합니다.
  BARE_TEXT_TOOL="$(grep -HnE '(^|[^=[:alnum:]_])(sed|grep)[[:space:]]' "$HOOKS_DIR/lib"/*.sh 2>/dev/null \
    | grep -vE 'LC_ALL=C' | grep -vE ':[0-9]+:[[:space:]]*#' || true)"
  if [ -n "$BARE_TEXT_TOOL" ]; then
    echo "FAIL: hooks/lib에 LC_ALL=C가 추가되지 않은 sed/grep이 있습니다(GBK 환경에서 중국어 도서명 처리 시 깨짐 발생):"
    echo "$BARE_TEXT_TOOL"
    fail=1
  else
    echo "OK: hooks/lib의 모든 sed/grep에 LC_ALL=C가 적용되었습니다"
  fi
fi

exit "$fail"
