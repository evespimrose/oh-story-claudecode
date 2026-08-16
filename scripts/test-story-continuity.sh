#!/bin/bash
# test-story-continuity.sh — detect-story-gaps.sh의 배치 간 연속성 폴백 회귀 테스트
# 보장: ① staleness 추적(본문이 N장까지 업데이트되었으나 context.md가 더 이전) → 연속 작성 상태 정체 후 알림;
#       ② 장 제목 중복 제거(두 장의 이름 충돌) → 개명 알림; ③ missing/mismatched/malformed state → 명확 경고;
#       ④ 정상 프로젝트(state/context revision 일치, context가 본문보다 신규, 제목 유일) 무음.
# codex story_codex_hook.py의 continuity_findings와 동일한 트리거 조건(codex 측은 test-codex-hooks.sh가 적용).
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$REPO_ROOT" ] && { echo "Error: not in a git repository" >&2; exit 1; }
HOOK="$REPO_ROOT/skills/story-setup/references/templates/hooks/detect-story-gaps.sh"
[ -f "$HOOK" ] || { echo "FAIL: hook not found: $HOOK" >&2; exit 1; }
bash -n "$HOOK" || { echo "FAIL: hook has syntax errors" >&2; exit 1; }

# Python 인터프리터가 없으면 스킵합니다(연속성 스캔은 Python 내장; CI의 세 플랫폼 모두 Python이 설치됨).
PYBIN=""
for c in python3 python py; do "$c" -c "" >/dev/null 2>&1 && { PYBIN="$c"; break; }; done
[ -z "$PYBIN" ] && { echo "test-story-continuity: no python interpreter, skipped."; exit 0; }

fails=0
run() { CLAUDE_PROJECT_DIR="$1" bash "$HOOK"; }

# 실제 도서 구조(3개 설정, "본문 많지만 설정 적음" 갭 경고 회피, 연속성만 테스트).
make_book() {
  local root="$1"
  mkdir -p "$root/어떤책/본문" "$root/어떤책/개요" "$root/어떤책/추적" "$root/어떤책/설정"
  printf 'a\n' > "$root/어떤책/설정/인물.md"
  printf 'b\n' > "$root/어떤책/설정/세계관.md"
  printf 'c\n' > "$root/어떤책/설정/힘.md"
  printf '권강\n' > "$root/어떤책/대강/권강.md"
  printf '%s\n' '{"schema_version":4,"state_revision":0,"last_committed_chapter":0}' > "$root/어떤책/추적/_tracking-state.json"
  printf '%s\n' '> 상태 개정판: 0' > "$root/어떤책/추적/컨텍스트.md"
}

# ① 추적 staleness + ② 제목 중복 제거
T1="$(mktemp -d)"; make_book "$T1"
printf '이전 컨텍스트\n' > "$T1/어떤책/추적/컨텍스트.md"
sleep 1
printf '# 제1장 최종 결전\n본문입니다.\n' > "$T1/어떤책/본문/제001장_최종결전.md"
printf '# 제2장 최종 결전\n본문입니다.\n' > "$T1/어떤책/본문/제002장_최종결전.md"
out="$(run "$T1")"
printf '%s' "$out" | grep -q '연쓰기 상태 카드 더 이전' || { echo "FAIL: 추적 staleness 미작동"; echo "$out" >&2; fails=$((fails+1)); }
printf '%s' "$out" | grep -q '제목 중복' || { echo "FAIL: 제목 중복 제거 미작동"; echo "$out" >&2; fails=$((fails+1)); }
rm -rf "$T1"

# ③ mismatched/malformed/missing state는 모두 경고해야 함
for kind in mismatch malformed missing; do
  T_META="$(mktemp -d)"; make_book "$T_META"
  printf '# 제1장 시작\n본문。\n' > "$T_META/어느책/본문/제001장_시작.md"
  case "$kind" in
    mismatch) printf '%s\n' '{"schema_version":4,"state_revision":1,"last_committed_chapter":0}' > "$T_META/어느책/추적/_tracking-state.json" ;;
    malformed) printf '%s\n' '{not-json' > "$T_META/어느책/추적/_tracking-state.json" ;;
    missing) rm -f "$T_META/어느책/추적/_tracking-state.json" ;;
  esac
  out="$(run "$T_META")"
  case "$kind" in
    mismatch) printf '%s' "$out" | grep -q '상태 수정' || { echo "FAIL: mismatched state 미발동"; echo "$out" >&2; fails=$((fails+1)); } ;;
    malformed) printf '%s' "$out" | grep -q '구문 분석 불가' || { echo "FAIL: malformed state 미발동"; echo "$out" >&2; fails=$((fails+1)); } ;;
    missing) printf '%s' "$out" | grep -q '_tracking-state.json 누락' || { echo "FAIL: missing state 미발동"; echo "$out" >&2; fails=$((fails+1)); } ;;
  esac
  rm -rf "$T_META"
done

# ④ 깨끗한 프로젝트: 컨텍스트가 본문보다 최신이고, 제목이 유일함 → 무음
T2="$(mktemp -d)"; make_book "$T2"
printf '# 제1장 시작\n본문입니다.\n' > "$T2/어떤책/본문/제001장_시작.md"
printf '# 제2장 전환\n본문。\n' > "$T2/어떤책/본문/제002장_전환.md"
sleep 1
printf '%s\n' '> 상태 수정: 0' '새로운 컨텍스트, 제2장까지 업데이트됨' > "$T2/어떤책/추적/컨텍스트.md"
out="$(run "$T2")"
[ -z "$out" ] || { echo "실패: 클린 프로젝트는 조용해야 하는데 출력됨:"; echo "$out" >&2; fails=$((fails+1)); }
rm -rf "$T2"

# ⑤ 단편 프로젝트(추적/ 없음): staleness 체크 안 함(컨텍스트.md 없음), 오탐도 없음
T3="$(mktemp -d)"
mkdir -p "$T3/단편/본문" "$T3/단편/설정"
printf 'a\n' > "$T3/단편/설정/인물.md"; printf 'b\n' > "$T3/단편/설정/세계.md"; printf 'c\n' > "$T3/단편/설정/능력.md"
printf '# 제1장 시작\n본문.\n' > "$T3/단편/본문/제001장_시작.md"
mkdir -p "$T3/단편/개요"; printf '개요\n' > "$T3/단편/개요/권개요.md"
out="$(run "$T3")"
printf '%s' "$out" | grep -q '연속 작성 상태 카드가 더 이전' && { echo "FAIL: 단편은 추적 없으면 부실함을 보고하면 안 됨"; echo "$out" >&2; fails=$((fails+1)); } || true
rm -rf "$T3"

if [ "$fails" -ne 0 ]; then
  echo "Story continuity tests FAILED ($fails)." >&2
  exit 1
fi
echo "Story continuity regression tests passed."
