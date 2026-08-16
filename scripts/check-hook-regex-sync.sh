#!/bin/bash
# check-hook-regex-sync.sh — 동작 수준 검증 detect-story-gaps.sh의 복선 상태 감지
#
# 설계 의도: SessionStart hook는 만료되었거나 비정상적인 복선만 알림하여, 장편에서 정상
# 현재 합법적 상태(매장됨/회수됨/포기)를 문제로 오판하지 않으며, daily 프로세스의 전체 복선 감사를 유발하지 않습니다.
# 본 스크립트는 실제 hook fixture를 실행하여, 정상 상태는 알람하지 않고 만료/비정상 상태는 알람하는지 검증합니다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

HOOK_FILE="$REPO_ROOT/skills/story-setup/references/templates/hooks/detect-story-gaps.sh"
COMMON_FILE="$REPO_ROOT/skills/story-setup/references/templates/hooks/lib/common.sh"
PROTOCOL_FILE="$REPO_ROOT/skills/story-long-write/scripts/tracking_commit.py"

for file in "$HOOK_FILE" "$COMMON_FILE" "$PROTOCOL_FILE"; do
  if [ ! -f "$file" ]; then
    echo "FAIL: required file not found: $file"
    exit 1
  fi
done

STATUS_ENUM=$(sed -n 's/^FORESHADOW_STATUSES = (\(.*\))$/\1/p' "$PROTOCOL_FILE" 2>/dev/null | head -1 | tr -d '" ' | tr ',' '/' || true)
if [ -z "$STATUS_ENUM" ]; then
  echo "FAIL: No foreshadow status enum found in protocol file"
  exit 1
fi

echo "Protocol defines status values: $STATUS_ENUM"

TMP_DIR=$(mktemp -d)
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

setup_fixture() {
  local name="$1"
  local foreshadow_body="$2"
  local root="$TMP_DIR/$name"
  mkdir -p "$root/.claude/hooks/lib" "$root/book/추적" "$root/book/정문" "$root/book/설정" "$root/book/대강"
  cp "$HOOK_FILE" "$root/.claude/hooks/detect-story-gaps.sh"
  cp "$COMMON_FILE" "$root/.claude/hooks/lib/common.sh"
  chmod +x "$root/.claude/hooks/detect-story-gaps.sh"
  touch "$root/.story-deployed"
  cat > "$root/book/추적/컨텍스트.md" <<'CTX'
# 작성 진행 상황
## 현재 위치
- 장: 제1장
CTX
  # 헤더 상태 열거형은 $STATUS_ENUM에서 확장되며, 더 이상 별도로 복사하지 않습니다: 프로토콜과 상태를 추가할 때 fixture도 함께 변경됩니다.
  # 그렇지 않으면 새로운 상태가 행위 수준의 fixture에 의해 도달되지 않습니다(헤더 행 자체는 hook의 ^상태\{ 분기로 건너뜁니다).
  cat > "$root/book/추적/복선.md" <<EOF_FORESHADOW
# 복선 추적

## 복선 상태 표

| ID | 복선 내용 | 매설 장절 | 예상 회수 장절 | 상태{$STATUS_ENUM} | 중요도{높음/중간/낮음} |
|----|---------|---------|-------------|-----------------------------|----------------|
$foreshadow_body
EOF_FORESHADOW
  printf '%s' "$root"
}

run_hook() {
  local root="$1"
  (cd "$root" && bash .claude/hooks/detect-story-gaps.sh)
}

assert_no_foreshadow_warn() {
  local case_name="$1"
  local body="$2"
  local root output
  root=$(setup_fixture "$case_name" "$body")
  output=$(run_hook "$root" || true)
  if echo "$output" | grep -q '복선'; then
    echo "FAIL: $case_name should not emit foreshadow warning"
    echo "Output:"
    echo "$output"
    exit 1
  fi
  echo "  OK no warn: $case_name"
}

assert_foreshadow_warn() {
  local case_name="$1"
  local body="$2"
  local root output
  root=$(setup_fixture "$case_name" "$body")
  output=$(run_hook "$root" || true)
  if ! echo "$output" | grep -q '만료되었거나 비정상적인 복선 항목이 감지됨'; then
    echo "FAIL: $case_name should emit overdue/abnormal foreshadow warning"
    echo "Output:"
    echo "$output"
    exit 1
  fi
  echo "  OK warn: $case_name"
}

assert_no_foreshadow_warn "header-only" ""

plain_header_root="$TMP_DIR/plain-header"
mkdir -p "$plain_header_root/.claude/hooks/lib" "$plain_header_root/book/추적" "$plain_header_root/book/본문" "$plain_header_root/book/설정" "$plain_header_root/book/개요"
cp "$HOOK_FILE" "$plain_header_root/.claude/hooks/detect-story-gaps.sh"
cp "$COMMON_FILE" "$plain_header_root/.claude/hooks/lib/common.sh"
chmod +x "$plain_header_root/.claude/hooks/detect-story-gaps.sh"
cat > "$plain_header_root/book/추적/복선.md" <<'EOF_PLAIN_HEADER'
# 복선 추적

| ID | 이름 | 복선 | 회수 | 상태 | 비고 |
|----|------|------|------|------|------|
| F001 | 옥패 | 1장 | 20장 | 복선됨 | ok |
EOF_PLAIN_HEADER
plain_header_output=$(run_hook "$plain_header_root" || true)
if echo "$plain_header_output" | grep -q '복선'; then
  echo "FAIL: plain-header should not emit foreshadow warning"
  echo "Output:"
  echo "$plain_header_output"
  exit 1
fi
echo "  OK no warn: plain-header"

assert_no_foreshadow_warn "normal-open-planted" "| F002 | 정상 개방 복선 | 1장 | 20장 | 복선됨 | 높음 |"
assert_no_foreshadow_warn "closed-recovered" "| F003 | 회수된 복선 | 1장 | 3장 | 회수됨 | 낮음 |"
assert_no_foreshadow_warn "closed-abandoned" "| F006 | 중단된 복선 | 1장 | 3장 | 중단 | 낮음 |"
assert_foreshadow_warn "overdue" "| F004 | 만료된 복선 | 1장 | 2장 | 만료됨 | 높음 |"
assert_foreshadow_warn "retired-unplanted-status" "| F001 | 아직 제대로 설정되지 않음 | 5장 | 10장 | 미설정 | 중간 |"
assert_foreshadow_warn "unknown-status" "| F005 | 비정상 상태 | 1장 | 2장 | 상태 손상 | 높음 |"

# Guard against reverting to the old broad regex or warning wording.
if grep -q "상태\.\*(미설정|설정됨|만료됨)" "$HOOK_FILE"; then
  echo "FAIL: old broad foreshadow regex is still present in hook"
  exit 1
fi
if grep -q 'Open foreshadowing[[:space:]]threads' "$HOOK_FILE"; then
  echo "FAIL: old open-foreshadow warning wording is still present in hook"
  exit 1
fi

# Ensure every protocol status is explicitly classified by the hook's awk classifier:
# either an explicit warn state (status == "X") or an explicit normal state (status != "X").
# The old second clause grepped PROTOCOL_FILE — the very file STATUS_ENUM was extracted
# from — so it always matched and the whole loop could never fail. A status added to the
# protocol without teaching the hook falls into the classifier's else branch and gets
# reported as 비정상 on every SessionStart; that drift must turn this check red.
for state in $(echo "$STATUS_ENUM" | tr '/' ' '); do
  if ! grep -qF "status == \"$state\"" "$HOOK_FILE" \
    && ! grep -qF "status != \"$state\"" "$HOOK_FILE"; then
    echo "FAIL: protocol status not classified by hook: $state"
    echo "  add status == \"$state\" (warn) or status != \"$state\" (normal) to the 복선 awk in $HOOK_FILE"
    exit 1
  fi
done

echo ""
echo "OK: hook foreshadow detection warns only on overdue/abnormal states"

# ── 독성 js↔py 동기화 잠금 ─────────────────────────────────────────────────────
# 쓰기 후 본문 네트워크의 결정성 독성 규칙이 두 곳에 각각 한 份 동형 구현으로 존재합니다: JS 공유 핵심 story_hook_core.js
# （Claude/OpenCode/ZCode 세 가지 복사본 바이트 일치는 check-shared-files.sh에 의해 보장됨）와 codex
# story_codex_hook.py (회합 말 재스캔 중지). 각 정규식/상수/문안의 표준 텍스트는 반드시 두 파일에 모두
# 한 글자도 정확히 일치하게 나타나야 하며, 한쪽만 수정하면 fail 발생 - test-prose-net-parity.sh의 fixture 수준
# 기능 패리티를 상호 보완 (여기서는 소스 텍스트 고정, 저기서는 동작 출력 고정).
JS_CORE="$REPO_ROOT/skills/story-setup/references/templates/hooks/story_hook_core.js"
PY_HOOK="$REPO_ROOT/skills/story-setup/references/codex/hooks/story_codex_hook.py"
for file in "$JS_CORE" "$PY_HOOK"; do
  if [ ! -f "$file" ]; then
    echo "FAIL: required file not found: $file"
    exit 1
  fi
done

TOXIC_SYNC=(
  # 정규식 (JS 리터럴과 Python raw string의 공통 텍스트)
  '소리(?:그리고)?없는[크고큼][^。！？!?\n]{0,16}[그런데하지만그렇지]'
  '(?:없는[^。！？!?\n，,]{1,12}[，,]){2}'
  '는[^。！？!?\n，,]{1,12}[，,]\s*(?:그렇지)?아닌[^。！？!?\n]{1,20}'
  '아닌[^。！？!?\n]{1,16}[，,]\s*(?:그렇지)?는'
  '아무도 모르는|누구도 모르는|누구도 예상 못 한|뜻밖에도|(?:이렇게)?방금 시작(?:되었|했)|정(?:향해서|향하여)[^。！？!?\n]{0,24}(?:압|몰|습|들이)(?:쳐왔|쳐왔|왔)|(?<!정식)막을 올(?:리기|리기)|곧(?:시작|다가올|닥칠)'
  '이(?:밤|날|순간|전투|해|국면|전쟁)[，,]?[^。！？!?，,\n]{0,6}(?<!명중)(?<!는)운명[^。！？!?\n]{0,8}[。！]'
  '이렇게[，,][^。！？!?，,\n]{0,8}(?:모두|전체)[^。！？!?，,\n]{0,4}(?:끝났다|막을 내리다|막을 내렸다)[。！]'
  '이 모든[，,]?[^。！？!?，,\n]{0,6}(?:都)?(?:말해주다|의미하다|끝났다)(?!의)(?:(?!뭔가)[^。！？!?\n]){0,6}[。！]'
  '(?:새로운 장|새로운 여행|완전히 새로운 장|새로운 인생)[^。！？!?\n]{0,6}(?:시작하다|시작되다|펼쳐지다)|운명[^。！？!?\n]{0,6}톱니'
  '.*[，,]\s*(?:而)?아니라([^。！？!?\n]*)$'
  # 상수（문말 창, 문장 경계, 의문 종료/확인 표현 제외 세트）
  'TOXIC_TRAILER_WINDOW = 600'
  '，,。.！!？?；;：:、…—~ \t　'
  '"마", "바", "마"'
  '"의", "아", "야", "네"'
  # 문안(findings 행 형식과 각 규칙 수정법, 초기화 요구사항 + 완전 스캔 안내, 양끝은 정확히 일치해야 함)
  '행 독성 문장식['
  '「~하지 않고…그런데 Y」같은 대비 표현을 삭제하고, 구체적인 효과나 동작을 직접 작성하세요.'
  '「~가 없고…, ~가 없고…」같은 배치법을 하나만 남기거나 모두 삭제하고, 긍정적인 현장 세부사항으로 다시 작성하세요.'
  '부정적 준비 표현을 삭제하고, 긍정적 항목을 직접 작성하거나 동작 세부사항으로 바꾸세요.'
  '장 끝 예고 표현을 삭제하고, 진행 중인 동작이나 화면으로 장을 마무리하세요.'
  '장 끝 상태 요약 문장을 삭제하고, 상태 마무리는 세부 계획의 기준이므로 본문은 구체적인 동작, 화면 또는 대사로 마무리하세요.'
  '독성 패턴은 결정론적 AI 지문입니다: 이 장을 초기화한 후 계속 진행하세요. 전체 검사: node <skill>/scripts/check-ai-patterns.js --check <본문_파일>'
  '처리되지 않은 독성 패턴 미해결 사항,'
  '제거: 건너뛰기'
  '제거(：|:)건너뛰기'
  '\r?\n'
)
toxic_fail=0
for needle in "${TOXIC_SYNC[@]}"; do
  for file in "$JS_CORE" "$PY_HOOK"; do
    if ! grep -Fq -- "$needle" "$file"; then
      echo "FAIL: 독성 패턴 표준 문자열 누락/변동 — 「${needle}」이(가) $(basename "$file")에 나타나지 않음"
      toxic_fail=1
    fi
  done
done

# 미해결 항목이 Claude bash 쪽에 별도 사전 구현이 있습니다(guard-outline-before-prose.sh: 이전 장에서 발견 +
# 처음 6줄 예외 창 + 차단 텍스트, 유해 문구 스캔 자체는 공유 핵심 prose-toxic 통해), 예외 표시와 항목 텍스트는
# js/py 세 곳과 반드시 동기화되어야 합니다.
GUARD_SH="$REPO_ROOT/skills/story-setup/references/templates/hooks/guard-outline-before-prose.sh"
GATE_SYNC=(
  '제거(：|:)건너뛰기'
  '미정화 유해 문구 미해결 항목'
  '<!-- 맛 제거: 건너뛰기 --> 후 재시도'
)
for needle in "${GATE_SYNC[@]}"; do
  for file in "$JS_CORE" "$PY_HOOK" "$GUARD_SH"; do
    if ! grep -Fq -- "$needle" "$file"; then
      echo "FAIL: Hook 규범 문자열 누락/변동 — 「${needle}」이(가) $(basename "$file")에 나타나지 않음"
      toxic_fail=1
    fi
  done
done
if [ "$toxic_fail" -ne 0 ]; then
  exit 1
fi

echo "OK: 정규식/상수/텍스트 js↔py 완벽 동기화 (Hook 마커/텍스트 포함 bash 전치 3곳 동기화)"
