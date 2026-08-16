#!/bin/bash
# test-hook-encoding-portable.sh — Windows 중국어 시스템에서의 배포형 hook 인코딩 견고성 회귀 테스트.
#
# Windows 중국어 환경에는 두 가지 독립적인 인코딩 함정이 있습니다(둘 다 hook을 소리 없이 실패하게 만듭니다. issue #164 참조):
#   1) python stdout 기본값이 cp936(로캘 설정과 무관): print(중국어)가 GBK로 인코딩되어, 스크립트의 UTF-8
#      리터럴 바이트와 불일치 → 비교 결과가 항상 거짓이 됨. 수정 방법: sys.stdout.buffer.write(...encode("utf-8")).
#   2) 사용자가 GBK 로캘(LANG=zh_CN.GBK)을 내보낼 때, gawk/GNU sed/GNU grep/bash 와일드카드
#      UTF-8 내용/경로를 GBK 멀티바이트로 디코딩하면 깨짐. 수정 방법: hook 내에서 export LC_ALL=C를 설정하여 바이트 매칭 수행.
#
# 이 테스트는 두 섹션을 모두 실행합니다:
#   Part 1: PYTHONIOENCODING=gbk를 사용하여 python stdout을 cp936으로 강제 설정하고, 함정 1을 재현(모든 플랫폼에서 실행 가능).
#   Part 2: 실제 GBK 로캘 환경에서 모든 hook을 실행하여 함정 2를 재현(시스템에 zh_CN.GBK 로캘이 설치되어 있어야 함;
#           macOS는 기본 포함, CI ubuntu는 workflow localedef로 생성, Windows Git Bash에 없으면 건너뜀).
#
# 사용법: bash scripts/test-hook-encoding-portable.sh
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "Error: not in a git repository"
  exit 1
fi
HOOKS_DIR="$REPO_ROOT/skills/story-setup/references/templates/hooks"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 사용 가능한 인터프리터 탐색(Windows에서 python3는 Store 플레이스홀더 프로그램일 수 있으며 exit 49를 반환함)
for PYBIN in python3 python py; do "$PYBIN" -c "" 2>/dev/null && break; done

fail=0
pass() { echo "  PASS $1"; }
bad()  { echo "  FAIL $1"; fail=1; }

deploy() { # $1 = project root
  mkdir -p "$1/.claude"
  cp -R "$HOOKS_DIR" "$1/.claude/hooks"
  chmod +x "$1/.claude/hooks"/*.sh "$1/.claude/hooks/lib"/*.sh 2>/dev/null || true
}

echo "Hook encoding portability test (issue #164)"
echo "==========================================="
echo "interpreter: $PYBIN"

# ===== Part 1: python stdout cp936 (PYTHONIOENCODING=gbk) =====
echo "--- Part 1: python stdout cp936 simulation (PYTHONIOENCODING=gbk) ---"
P1="$WORK/p1"; deploy "$P1"
mkdir -p "$P1/book/본문" "$P1/book/개요" "$P1/book/추적" "$P1/short"
# 이 섹션은 인코딩/로캘 환경에서의 경로 및 glob 동작을 테스트하며, 추적 게이트를 테스트하는 것이 아닙니다. 유효한 state를 생성하여 상세 개요 게이트가 유일한
# 변수가 되도록 합니다. 이것이 없으면 제1장을 작성할 때 issue #305부터 추가된 추적 체크포인트에 의해 먼저 차단됩니다(state 누락 시 차단).
printf '{"schema_version":4,"state_revision":0,"last_committed_chapter":0}\n' > "$P1/book/추적/_tracking-state.json"
printf '> 상태 리비전: 0.\n' > "$P1/book/추적/컨텍스트.md"
run_guard_py() { # $1 mode(default|gbk)  $2 file_path -> exit code
  local mode="$1" fp="$2" ec=0
  local -a pyenv=()
  [ "$mode" = "gbk" ] && pyenv=(env PYTHONIOENCODING=gbk)
  printf '{"tool_name":"Write","tool_input":{"file_path":"%s","content":"x"}}' "$fp" \
    | CLAUDE_PROJECT_DIR="$P1" ${pyenv[@]+"${pyenv[@]}"} bash "$P1/.claude/hooks/guard-outline-before-prose.sh" \
      >/dev/null 2>&1 || ec=$?
  printf '%s' "$ec"
}
for MODE in default gbk; do
  rm -f "$P1/book/개요/상세_개요_제1장.md"
  [ "$(run_guard_py "$MODE" 'book/본문/제1장_시작.md')" = 2 ] && pass "[$MODE] long blocked, 상세 개요 누락" || bad "[$MODE] long should block when 상세 개요 누락"
  : > "$P1/book/개요/상세_개요_제1장.md"
  [ "$(run_guard_py "$MODE" 'book/본문/제1장_시작.md')" = 0 ] && pass "[$MODE] long 허용됨, 상세 개요 존재함" || bad "[$MODE] 상세 개요가 존재할 때 long을 허용해야 함"
  : > "$P1/short/설정.md"; rm -f "$P1/short/소절_개요.md"
  [ "$(run_guard_py "$MODE" 'short/본문.md')" = 2 ] && pass "[$MODE] short 차단됨, 소절 개요 누락됨" || bad "[$MODE] 소절 개요가 누락되었을 때 short를 차단해야 함"
  : > "$P1/short/소절_개요.md"
  [ "$(run_guard_py "$MODE" 'short/본문.md')" = 0 ] && pass "[$MODE] short 허용됨, 소절 개요 존재함" || bad "[$MODE] 소절 개요가 존재할 때 short를 허용해야 함"
done

# ===== Part 1b: Windows 드라이브 문자 절대 경로 분류 (issue #184, 모든 플랫폼에서 실행 가능) =====
# Windows + Git Bash 환경에서 Claude Code가 드라이브 문자 절대 경로(F:/... 또는 F:\...)를 전달함. 기존 케이스는 /*만 인식하여,
# 이를 상대 경로로 간주하고 $ROOT/F:/...로 결합하여 개요/ 디렉터리를 잘못 찾음 → 상세 개요 누락으로 오탐지. 수정 후 드라이브 문자 경로는 절대 경로로 처리됨.
# POSIX runner에는 실제 드라이브 문자가 없음: 귀류법 사용——fixture를 '기존 코드가 결합하게 될' $ROOT/C:/<book> 아래에만 배치.
#   수정 후: guard가 C:/<book>을 절대 경로로 간주(→ 파일 시스템 루트 /C:/<book>, 존재하지 않음) → fixture를 찾지 못함 → block(2)
#   기존 코드: $ROOT/C:/<book>으로 결합되어 fixture에 매칭됨 → allow(0)
# block(2)를 통해 드라이브 문자 경로가 절대 경로로 처리되었음을 증명함. (실제 Windows에서 동일한 절대 경로 처리는 실제 드라이브 아래의
# 실제 상세 개요를 찾아 허용하게 되므로 방향은 반대이지만, 여기서는 '절대 경로로 분류되는지 여부'라는 수정 사항만 검증함.)
echo "--- Part 1b: Windows drive-letter absolute path classification (issue #184) ---"
if mkdir -p "$P1/C:/book184/개요" 2>/dev/null && : > "$P1/C:/book184/개요/상세_개요_제2장.md" 2>/dev/null; then
  run_guard_drive() { # $1 file_path(JSON-escaped) -> exit code
    local ec=0
    printf '{"tool_name":"Write","tool_input":{"file_path":"%s","content":"x"}}' "$1" \
      | CLAUDE_PROJECT_DIR="$P1" bash "$P1/.claude/hooks/guard-outline-before-prose.sh" >/dev/null 2>&1 || ec=$?
    printf '%s' "$ec"
  }
  [ "$(run_guard_drive 'C:/book184/본문/제2장_x.md')" = 2 ] \
    && pass "[win] forward-slash drive path treated as absolute (not root-joined)" \
    || bad  "[win] forward-slash drive path was root-joined — issue #184 regression"
  # 백슬래시 경로는 실제 JSON에서 이스케이프 처리됨(\\). json.loads가 단일 백슬래시로 해석하여 bash에 전달하고, case 문에서 통합됨.
  [ "$(run_guard_drive 'C:\\book184\\본문\\제2장_x.md')" = 2 ] \
    && pass "[win] backslash drive path treated as absolute (separators normalized)" \
    || bad  "[win] backslash drive path mishandled — issue #184 regression"
  rm -rf "$P1/C:"
else
  echo "  SKIP: 파일 시스템이 ':'을 포함한 디렉터리 이름을 지원하지 않음 (드라이브 문자 fixture 생성 불가)"
fi

# ===== Part 1c: 실제 Windows 드라이브 문자 경로 (cygpath, Windows/MSYS에서만 실행) =====
# 1b는 POSIX 반증입니다. 여기서는 실제 Windows/MSYS 환경에서 cygpath를 사용하여 $P1을 C:/... 드라이브 문자 경로로 매핑합니다.
# 사용자에게 보이는 동작을 직접 검증: 세부 규칙이 있으면 허용, 없으면 차단 — 반대 방식의 분류 반증이 아님. POSIX에 cygpath가 없으면 SKIP.
echo "--- Part 1c: real Windows drive-letter path via cygpath (issue #184) ---"
if command -v cygpath >/dev/null 2>&1; then
  WINROOT="$(cygpath -m "$P1" 2>/dev/null || true)"
  case "$WINROOT" in
    [A-Za-z]:/*)
      mkdir -p "$P1/winbook/본문" "$P1/winbook/개요" "$P1/winbook/추적"
      # 이 섹션은 드라이브 문자 경로 파싱을 테스트하며 추적 게이트(tracking gate)는 테스트하지 않습니다. 유효한 state를 저장하여 세부 게이트(fine-grained gate)가 유일한 변수가 되도록 합니다.
      # last_committed에 현재 섹션의 장 번호보다 큰 값을 할당하며, 장 번호가 추적 범위 내에 있으면 순서 검증을 건너뜁니다.
      printf '{"schema_version":4,"state_revision":0,"last_committed_chapter":50}\n' > "$P1/winbook/추적/_tracking-state.json"
      printf '> 상태 리비전: 0.\n' > "$P1/winbook/추적/컨텍스트.md"
      run_guard_win() { local ec=0; printf '{"tool_name":"Write","tool_input":{"file_path":"%s","content":"x"}}' "$1" \
        | CLAUDE_PROJECT_DIR="$P1" bash "$P1/.claude/hooks/guard-outline-before-prose.sh" >/dev/null 2>&1 || ec=$?; printf '%s' "$ec"; }
      : > "$P1/winbook/개요/세부_개요_제3장.md"
      [ "$(run_guard_win "$WINROOT/winbook/본문/제3장_x.md")" = 0 ] \
        && pass "[win] 스키마가 존재할 때 real drive path 허용" \
        || bad  "[win] 세부 개요가 존재할 때 실제 드라이브 경로를 허용해야 함"
      rm -f "$P1/winbook/개요/상세_개요_제3장.md"
      [ "$(run_guard_win "$WINROOT/winbook/본문/제3장_x.md")" = 2 ] \
        && pass "[win] 상세 개요가 누락되었을 때 real drive path 차단됨" \
        || bad  "[win] 상세 개요가 누락되었을 때 실제 드라이브 경로가 차단되어야 함"
      rm -rf "$P1/winbook"
      ;;
    *)
      echo "  SKIP: cygpath present but did not yield a drive-letter path ($WINROOT)"
      ;;
  esac
else
  echo "  SKIP: cygpath not available (not a Windows/MSYS runner)"
fi

# ===== Part 2: 실제 GBK 로캘에서 모든 hook 실행 =====
echo "--- Part 2: real GBK locale (LANG/LC_ALL=zh_CN.GBK) end-to-end ---"
# '사용 가능한' GBK 계열 로캘 탐색: `locale -a` 목록을 확인하지 않음(Cygwin/MSYS2는 필요에 따라 생성하며 목록에 표시하지 않음),
# 대신 실제로 설정을 시도하여 `locale charmap`이 GB 계열 인코딩을 반환하는지 확인합니다. 이렇게 하면 Linux(localedef로 생성),
# macOS(내장), Windows Git Bash(Cygwin 합성) 세 곳 모두 실제 GBK 환경에서 동작합니다.
detect_gbk_locale() {
  local cand cm
  for cand in zh_CN.GBK zh_CN.gbk zh_CN.GB18030 zh_CN.gb18030 zh_CN.GB2312 zh_CN.gb2312; do
    cm="$(LC_ALL="$cand" locale charmap 2>/dev/null | tr 'a-z' 'A-Z' | tr -d '-')"
    case "$cm" in GBK|GB18030|GB2312) printf '%s' "$cand"; return 0 ;; esac
  done
  return 1
}
GBK_LOCALE="$(detect_gbk_locale || true)"
if [ -z "$GBK_LOCALE" ]; then
  echo "  SKIP: 시스템에 사용 가능한 zh_CN.GBK 유형의 로캘(locale)이 없음 (Part 1에서 Python 레이어는 처리됨, Part 2에는 실제 GBK 로캘 필요)"
else
  echo "  using locale: $GBK_LOCALE"
  GBK() { LANG="$GBK_LOCALE" LC_ALL="$GBK_LOCALE" env "$@"; }
  P2="$WORK/p2"; deploy "$P2"
  git -C "$P2" init -q; git -C "$P2" config user.email t@t.t; git -C "$P2" config user.name t
  # 중국어 도서명을 중간 디렉터리로 사용 - GBK 환경에서 bash 와일드카드(glob)가 NOMATCH되는 시나리오
  BOOK="$P2/계정 관리"; mkdir -p "$BOOK/본문" "$BOOK/개요" "$BOOK/추적" "$BOOK/설정"
  printf '계정 관리\n' > "$P2/.active-book"

  # 2a guard-outline: 중국어 도서명 중간 디렉터리 + 중국어 와일드카드(glob)
  rg() { local ec=0; printf '{"tool_name":"Write","tool_input":{"file_path":"%s","content":"x"}}' "$1" \
    | GBK CLAUDE_PROJECT_DIR="$P2" bash "$P2/.claude/hooks/guard-outline-before-prose.sh" >/dev/null 2>&1 || ec=$?; printf '%s' "$ec"; }
  [ "$(rg '계정 관리/본문/제1장_시작.md')" = 2 ] && pass "[GBK] guard가 누락된 상세 개요를 차단함" || bad "[GBK] guard는 누락된 상세 개요를 차단해야 함"
  : > "$BOOK/개요/상세개요_제1장.md"
  # 상세 개요가 준비되어도 추적 체크포인트가 성립되어야 통과됨(이슈 #305부터 Claude 측에도 이 관문이 있음). 우선 유효한
  # state를 생성함. 그렇지 않으면 아래 두 항목은 중국어 glob이 아닌 추적 관문을 테스트하게 됨. 중국어 도서명 경로는 여기서 node를 통해 공유 코어로 전달되며,
  # 겸사겸사 GBK 로캘 환경에서 node 측이 UTF-8로 경로를 수신하는 케이스를 방어함(bash는 LC_ALL=C로 바이트를 처리하고, node는 로캘과 무관함).
  printf '{"schema_version":4,"state_revision":0,"last_committed_chapter":0}\n' > "$BOOK/추적/_tracking-state.json"
  printf '> 상태 수정: 0.\n' > "$BOOK/추적/컨텍스트.md"
  [ "$(rg '계정 관리/본문/제1장_시작.md')" = 0 ] && pass "[GBK] guard가 존재하는 상세 개요를 허용함 (한국어 glob)" || bad "[GBK] guard는 GBK 환경에서 존재하는 상세 개요를 허용해야 함"
  [ "$(rg '계정 관리/본문/제001장_시작.md')" = 0 ] && pass "[GBK] guard가 제001장 제로 패딩을 허용함" || bad "[GBK] guard는 GBK 환경에서 제001장을 허용해야 함"
  # 추적 관문 자체도 GBK 로캘 환경에서 차단할 수 있어야 함: 중국어 도서명이 node를 통해 state를 파싱하며, 차단 메시지에 중국어 상대 경로가 포함됨.
  mv "$BOOK/추적/_tracking-state.json" "$BOOK/추적/_state.bak"
  [ "$(rg '계정 관리/본문/제1장_시작.md')" = 2 ] && pass "[GBK] guard가 누락된 추적 상태를 차단함 (한국어 도서 경로)" || bad "[GBK] guard는 GBK 환경에서 누락된 추적 상태를 차단해야 함"
  mv "$BOOK/추적/_state.bak" "$BOOK/추적/_tracking-state.json"

  # 2b detect-story-gaps: 정상적인 복선 표에서 오보가 발생하지 않음. 동시에 중국어 도서 목록이 검색 가능함을 증명.
  # F001 상태는 전각 공백 U+3000으로 패딩 처리됨(앞뒤로 하나씩 삽입됨). LC_ALL=C 환경에서도 trim이 전각 공백을 인식하는지 확인.
  cat > "$BOOK/추적/복선.md" <<'EOF'
| ID | 복선 내용 | 설정 장 | 회수 예정 장 | 상태{설정됨/회수됨/만료됨/포기} | 중요도{상/중/하} |
|----|---------|---------|-------------|-----------------------------|----------------|
| F001 | 옥패의 내력 | 제1장 | 제20장 |　설정됨　| 상 |
| F002 | 사문의 과거 | 제3장 | 제25장 | 회수됨 | 중 |
EOF
  out="$(cd "$P2" && GBK CLAUDE_PROJECT_DIR="$P2" bash .claude/hooks/detect-story-gaps.sh 2>&1 || true)"
  echo "$out" | grep -q '복선' && bad "[GBK] detect-story-gaps spuriously warns on normal 복선" || pass "[GBK] detect-story-gaps silent on normal 복선"
  # 실제 간격 생성(본문 > 10, 설정 < 3), 중국어 도서 목록이 실제로 탐색되었음을 증명(그렇지 않으면 위의 "정적" 상태는 가양성임)
  i=1; while [ "$i" -le 11 ]; do : > "$BOOK/본문/제${i}장.md"; i=$((i+1)); done
  out2="$(cd "$P2" && GBK CLAUDE_PROJECT_DIR="$P2" bash .claude/hooks/detect-story-gaps.sh 2>&1 || true)"
  echo "$out2" | grep -q '계정 관리 시켰더니' && pass "[GBK] detect-story-gaps discovers Chinese book + warns on real gap" || bad "[GBK] detect-story-gaps failed to discover Chinese book under GBK"
  rm -f "$BOOK"/본문/제*장.md

  # 2c validate-story-commit: 전각 콜론 + 전각 공백이 포함된 하드코딩된 속성 탐지(C/GBK 영역 하단 대괄호 문자 그룹
  # 전각 콜론 누락, [[:space:]]의 전각 공백 누락 문제를 각각 수정함)
  printf '나이　：18\n' > "$BOOK/본문/제1장_시작.md"
  git -C "$P2" add -A >/dev/null 2>&1
  cout="$(cd "$P2" && GBK CLAUDE_PROJECT_DIR="$P2" STORY_COMMIT_COMMAND='git commit -m x' bash .claude/hooks/validate-story-commit.sh 2>&1 || true)"
  echo "$cout" | grep -q '본문 하드코딩 캐릭터 속성' && pass "[GBK] validate-commit catches fullwidth-colon attr" || bad "[GBK] validate-commit missed fullwidth-colon attr under GBK"

  # 2d lib/common.sh discover_active_book: .active-book이 '짧은 중국어 도서명'을 가리킬 때, GBK 환경의 trim sed
  # illegal byte sequence 오류 발생 → active가 빈 값으로 처리됨 → find로 찾은 첫 번째 도서로 잘못 폴백됨. session-*/
  # pre-compact/post-compact에서 재사용되는 이 공유 경로를 커버함. 확정적 구조: 활성 도서에 추적/본문이 없음(fallback으로
  # 찾을 수 없음), 미끼 도서에 추적/이 있음(fallback 시 미끼 도서만 탐지됨) — 수정 전에는 decoy로, 수정 후에는 .active-book으로 복구.
  P2D="$WORK/p2d"; deploy "$P2D"
  mkdir -p "$P2D/계정 관리 시켰더니/설정" "$P2D/decoy소설/추적"
  printf '계정 관리 시켰더니\n' > "$P2D/.active-book"
  active_path="$(cd "$P2D" && GBK CLAUDE_PROJECT_DIR="$P2D" bash -c 'source ".claude/hooks/lib/common.sh"; discover_active_book' 2>/dev/null)"
  # 바이트 안전 어설션: 활성 도서에 설정/이 있고, 미끼 도서에 추적/이 있음. [ -d ]를 사용하여 바이트 경로를 직접 stat하여 basename이
  # 특정 runner의 GBK 환경에서 멀티바이트를 변환하여 가짜 실패가 발생하는 것을 방지. 수정 전에는 미끼 도서(설정/ 없음)로, 수정 후에는 활성 도서로 복구.
  if [ -d "$active_path/설정" ]; then
    pass "[GBK] common.sh discover_active_book honors short Chinese .active-book"
  else
    bad "[GBK] common.sh discover_active_book dropped short Chinese .active-book (resolved [$active_path])"
  fi
fi

echo ""
if [ "$fail" -eq 0 ]; then
  echo "PASS: hook이 cp936 및 실제 GBK 로캘 모두에서 정상입니다"
else
  echo "FAIL: 특정 인코딩/로캘 모드에서 hook 동작이 일치하지 않습니다 (중국어 인코딩 회귀)"
fi
exit "$fail"
