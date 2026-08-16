#!/bin/bash
# test-prose-backstop-hook.sh — regression tests for check-prose-after-write.sh
# 핵심 보장: ① 비본문 파일(코드/세부 시놉시스/설정/시놉시스/분리된 본문)을 절대 과도하게 캡처하지 않음. ② 실제 본문 백스톱(Backstop) 트리거.
# ③ 하드 시그널(절단/거절 표현/기술 용어/반복)에 대한 경량 콘텐츠 캡처, 깨끗한 본문(대구+대화+서스펜스)은 무반응.
# 과도한 캡처는 경로 게이트로 검증(인터프리터 비의존), 콘텐츠 캡처는 내장 Python 사용(parity 테스트와 동일 소스).
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$REPO_ROOT" ] && { echo "Error: not in a git repository" >&2; exit 1; }
HOOK="$REPO_ROOT/skills/story-setup/references/templates/hooks/check-prose-after-write.sh"
[ -f "$HOOK" ] || { echo "FAIL: hook not found: $HOOK" >&2; exit 1; }

bash -n "$HOOK" || { echo "FAIL: hook has syntax errors" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# 실제 도서 구조: 설정.md + 시놉시스/ + 본문/
mkdir -p "$TMP/특정_도서/본문" "$TMP/특정_도서/시놉시스" "$TMP/docs/본문" "$TMP/분리/본문"
printf '# 설정\n주인공 장천.\n' > "$TMP/특정_도서/설정.md"
printf '## 세부 시놉시스(제1장)\n- 사건 흐름: 이번 장 세부 시놉시스, AI로서 더 이상 진행할 수 없습니다. 그는 주먹을 꽉 쥐었다. 그는 주먹을 꽉 쥐었다.\n' > "$TMP/특정_도서/시놉시스/세부_시놉시스_제001장.md"
printf '# 시놉시스\n제1장 제2장 세부 시놉시스 이번 장 다음 장\n' > "$TMP/특정_도서/시놉시스/시놉시스.md"
printf '# 권별 시놉시스\n이번 권 세부 시놉시스.\n' > "$TMP/특정_도서/시놉시스/권별_시놉시스_제1권.md"
printf 'const x=1; // 세부 시놉시스 이번 장 다음 장 AI로서 더 이상 진행할 수 없습니다 반복반복반복\n' > "$TMP/특정_도서/x.js"
printf '## 본문\n세부 시놉시스에 따라, AI로서 더 이상 진행할 수 없습니다.\n' > "$TMP/docs/본문.md"   # 본문.md이지만 설정.md 파일이 인접하지 않음
printf '## 제5장\n세부 시놉시스에 따라, AI로서 더 이상 진행할 수 없습니다.\n' > "$TMP/분리/본문/제005장.md" # 본문/제N장 형식이지만 도서 구조가 없음
printf '그' > "$TMP/특정_도서/본문/제001장_절단.md"                            # 실제 본문, 매우 짧음 → 트리거 발생

run() { CLAUDE_PROJECT_DIR="$TMP" CLAUDE_TOOL_INPUT="{\"tool_input\":{\"file_path\":\"$1\"}}" bash "$HOOK" 2>/dev/null; }

fails=0
expect_silent() {
  local out; out="$(run "$1")"
  if [ -n "$out" ]; then echo "FAIL: 비본문 파일에서 과도한 캡처 발생: $1" >&2; echo "$out" | head -2 >&2; fails=$((fails+1)); fi
}
expect_fire() {
  local out; out="$(run "$1")"
  if [ -z "$out" ]; then echo "FAIL: 실제 본문에서 백스톱이 작동하지 않음: $1" >&2; fails=$((fails+1)); fi
}

# ① 다음 비본문 파일들을 절대 캡처하지 않음(기술 용어/반복/거절 표현 텍스트 포함, 스캔되지 않았음을 증명)
expect_silent "$TMP/특정_도서/시놉시스/세부_시놉시스_제001장.md"
expect_silent "$TMP/특정_도서/시놉시스/시놉시스.md"
expect_silent "$TMP/특정_도서/시놉시스/권별_시놉시스_제1권.md"
expect_silent "$TMP/특정_도서/x.js"
expect_silent "$TMP/어떤책/설정.md"
expect_silent "$TMP/docs/본문.md"
expect_silent "$TMP/유리/본문/제005장.md"
# ② 실제 본문(매우 짧음→저장 신호)은 반드시 트리거되어야 함
expect_fire "$TMP/어떤책/본문/제001장_잘림.md"

# ③ 콘텐츠 필터: 실제 본문 내의 하드 신호는 반드시 감지되어야 하며 유형이 정확해야 함. 깨끗한 본문(대구+AI 캐릭터 대화+서스펜스 엔딩)은 무시됨.
expect_fire_kw() {
  local out; out="$(run "$1")"
  if ! printf '%s' "$out" | grep -q "$2"; then
    echo "FAIL: 콘텐츠 필터가 「$2」를 감지하지 못함: $1" >&2; printf '%s\n' "$out" | head -4 >&2; fails=$((fails+1))
  fi
}
# bash 문자열 반복으로 본문 채우기(python stdout 미사용: Windows runner의 python < 3.15 텍스트 stdout은
# cp1252이므로, 한글 작성 시 UnicodeEncodeError가 발생함. 스크립트 내의 UTF-8 바이트 리터럴을 printf로 직접 출력해야 안정적임).
PAD() { local s='강진은 주먹을 꽉 쥐고 천천히 문으로 향하며 마음속으로 다음 수를 계산했다.'; printf '%s' "$s$s$s$s$s$s$s$s"; }
# 깨끗함: 긴 본문 + 대구 + AI 캐릭터 대화(「AI로서...」는 따옴표 안에 있어 예외) + 서스펜스 엔딩 문장 부호 → 완전 무시
{ printf '# 제10장 결전\n\n'; PAD; printf '\n살거나, 죽거나.\n싸우거나, 도망치거나.\n「AI 집사로서, 마지막까지 당신과 함께하겠습니다.」\n그는 마침내 발걸음을 멈췄다.\n'; } > "$TMP/어떤책/본문/제10장_결전.md"
expect_silent "$TMP/어떤책/본문/제10장_결전.md"
# 잘림: 끝에 문장 부호 없음
{ printf '# 제11장\n\n'; PAD; printf '\n그는 힘껏 달려들어 주먹으로'; } > "$TMP/어떤책/본문/제11장_잘림.md"
expect_fire_kw "$TMP/어떤책/본문/제11장_잘림.md" 잘림
# 생성 거부 문구 / AI 자기 지칭(서술문, 대화 아님)
{ printf '# 제12장\n\n'; PAD; printf '\nAI로서 이 부분의 콘텐츠를 계속 생성할 수 없습니다.\n'; } > "$TMP/어떤책/본문/제12장_거부.md"
expect_fire_kw "$TMP/어떤책/본문/제12장_거부.md" 메타 정보 유출
# 엔지니어링 용어가 본문에 유출됨
{ printf '# 제13장\n\n'; PAD; printf '\n이 장의 세부 시놉시스 구성상, 그가 등장할 차례다.\n그가 등장했다.\n'; } > "$TMP/어떤 책/본문/제013장_공정 단어.md"
expect_fire_kw "$TMP/어떤 책/본문/제013장_공정 단어.md" 공정 단어
# 인접한 전체 행 반복(8자 이상의 가시 문자)
{ printf '# 제14장\n\n'; PAD; printf '\n그는 주먹을 꽉 쥐고 한 걸음씩 다가가 천천히 압박했다.\n그는 주먹을 꽉 쥐고 한 걸음씩 다가가 천천히 압박했다.\n그는 멈췄다.\n'; } > "$TMP/어떤 책/본문/제014장_반복.md"
expect_fire_kw "$TMP/어떤 책/본문/제014장_반복.md" 반복

if [ "$fails" -ne 0 ]; then
  echo "Prose backstop hook tests FAILED ($fails)." >&2
  exit 1
fi
echo "Prose backstop hook regression tests passed."
