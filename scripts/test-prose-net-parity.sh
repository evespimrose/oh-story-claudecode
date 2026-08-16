#!/bin/bash
# test-prose-net-parity.sh — 정문 폴백 「경량 결정성 네트」 네 플랫폼 parity 감시
# 네트는 각 플랫폼에 구현되어 있습니다: ① Claude check-prose-after-write.sh 내장 python; ② Codex story_codex_hook.py; ③ OpenCode plugin.ts; ④ ZCode story_zcode_hook.js.
# (③④의 순수 로직은 각각 story_hook_core.js companion을 공유하며, 바이트 수준에서 일치합니다.)
# 네 개 파일은 모두 동시에 검증하고 동시에 배포해야 합니다. 본 테스트는 5단계 보증을 제공합니다:

#   A. 규범 문자열 일치(CI 안전, 제로 런타임 의존성): 각 net 정규식/상수/임계값의 규범 텍스트는 네 파일에 모두 나타나야 합니다.
#      한 곳을 수정하고 다른 곳을 빠뜨리면 fail입니다——직접 드리프트를 앵커링합니다(check-hook-regex-sync.sh의 방식 참조).
#   B. 기능 parity(best-effort, TS 런타임이 없으면 자동 건너뜀): codex python 네트, opencode TS 네트,
#      zcode JS 네트이 동일한 fixture 그룹에서 문자 단위로 일치합니다.
#   C. 명령 함수 parity(CI 강력한 보증): 본문 대상 추출, apply-patch 대상, git commit 감지 세 개의 순수 함수
#      codex python과 zcode JS 간의 문자 단위 정확한 일치——이전의 보호되지 않은, 이미 표류한 수기 로직을 잠금.
#   D. Claude 핵심으로의 귀환 보호(CI 강력 보장)：Claude의 4개 bash hook은 더 이상 heredoc python을 내장하지 않음,
#      대신 본 디렉터리의 동일한 node 공유 핵심 story_hook_core.js(story_hook_cli.js를 통함)를 호출. zcode/opencode
#      동일 파일, 이미 B/C에 의해 codex로 잠김, 따라서 claude==codex 구조적 폐루프. 두 가지 회귀 방지 규칙：hook 내에서 더 이상
#      heredoc python이 나타나면 안 되며, 반드시 story_hook_cli.js를 통해 핵심을 호출해야 함. 바이트 일치는 별도로 check-shared-files가 보장.
#   E. Prose-net parity（CI 하드 보장）：staged markdown warnings와 대강 차단 판정이 일관되지 않음——codex
#      python과 JS core 각각 하나의 구현을 가지고 있으며, fixture 위에서 문자 단위로 비교（대소문자 변형 적중, 경고/차단 문안）,
#      의미/문안은 JS core를 기준으로 합니다. Claude 측 이 두 가지는 별도의 순수 bash 구현（validate-story-commit.sh의
#      grep 세션, guard-outline-before-prose.sh의 판정 세션）을 가지고 있으며, 클라이언트 간 문자 단위 잠금이 없고, 동작은
#      check-story-setup-deployment.sh / test-hook-encoding-portable.sh의 실행 회귀 커버에 의해 결정됩니다.
#   F. Claude bash 본문 가드 ↔ JS core 동작 parity(CI 강제 보증): 「동일 프로젝트 동일 쓰기에서
#      bash 차단 여부 == JS 핵심 차단 여부」를 장면별로 비교하고, 각 장면의 예상 방향을 고정(그렇지 않으면 양쪽 모두 차단 누락
#      도 diff가 깔끔해짐). E가 언급한 빈틈 메우기 — #283에서 다른 세 엔드포인트에 추적 게이트 추가할 때 Claude 쪽에서 무음 누락
#      된 전체 버전(issue #305)이 바로 bash 측에 크로스 엔드포인트 assertion이 전혀 없었기 때문.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$ROOT" ] && { echo "Error: not in a git repository" >&2; exit 1; }

CLAUDE="$ROOT/skills/story-setup/references/templates/hooks/check-prose-after-write.sh"
CODEX="$ROOT/skills/story-setup/references/codex/hooks/story_codex_hook.py"
OPENCODE="$ROOT/skills/story-setup/references/opencode/plugin.ts"
ZCODE="$ROOT/skills/story-setup/references/zcode/hooks/story_zcode_hook.js"
ZCODE_CORE="$ROOT/skills/story-setup/references/zcode/hooks/story_hook_core.js"
OPENCODE_CORE="$ROOT/skills/story-setup/references/opencode/story_hook_core.js"
CLAUDE_CORE="$ROOT/skills/story-setup/references/templates/hooks/story_hook_core.js"
CLAUDE_COMMIT="$ROOT/skills/story-setup/references/templates/hooks/validate-story-commit.sh"
CLAUDE_GAPS="$ROOT/skills/story-setup/references/templates/hooks/detect-story-gaps.sh"
CLAUDE_GUARD="$ROOT/skills/story-setup/references/templates/hooks/guard-outline-before-prose.sh"
for f in "$CLAUDE" "$CODEX" "$OPENCODE" "$ZCODE" "$ZCODE_CORE" "$OPENCODE_CORE" "$CLAUDE_CORE" "$CLAUDE_COMMIT" "$CLAUDE_GAPS" "$CLAUDE_GUARD"; do
  [ -f "$f" ] || { echo "FAIL: missing impl: $f" >&2; exit 1; }
done

fails=0

# ── A. 규범 문자열 세 엔드포인트 일관성 ──────────────────────────────────────────────
# 각 net 정규식의 정규화 부분 문자열(패턴을 유일하게 고정하기에 충분함) + 주요 상수/임계값. 세 파일 모두에서 grep -F로 찾을 수 있어야 함.
CANON=(
  # 약한 신호(거부 문구 / AI 자기 지칭)
  # 모델 접미사 선택 부분은 AI 자기 지칭의 필수 요소(AI 언어 모델/AI 어시스턴트/AI 모델/인공지능 언어 모델로서),
  # 이것이 없으면 전방 탐색 단언이 「AI」 직후에 「언어/조수/모델」을 볼 수 있어서 가장 전형적인 성능 저하 시작 유형 누락.
  '(일개)?(AI|인공지능|대?언어모델|지능조수|채팅조수)(?:언어모델|대?모델|조수|로봇)?(?='
  '나(는|가) (계속(쓰|창작|생성|하|출력)?(을|를) (할 수 없|못하)'
  "Sure|Certainly|Here'?s|As an AI|I (?:cannot|can't|am unable|apologize)"
  # 하드 신호(자리 표시자 / 엔지니어링 용어 / 깨진 텍스트)
  '(여기|아래|이곳|다음|이후)?[^）)]{0,10}(생략|건너뜀|넘어감)'
  '(TODO|자리 표시자|placeholder|작성 필요|여기 작성|여기 작성 필요)'
  '(세부 개요|플롯 포인트|권 개요|기능 레이블|목표 감정|글자 수 목표|챕터 시작 훅|챕터 끝 훅|작업 설명)'
  # 상수 / 임계값(종료 구두점 집합 자르기, 대화 인용부호, 반복 최소 표시 길이)
  '。！？…"』」）)!?.~—'
  '「'
  '>= 8'
  # 글자 수 미달: 세부 개요 「글자 수 목표」 추출 + 90% 기준
  '글자 수 목표[^0-9]{0,6}(\d{3,6})'
)
for needle in "${CANON[@]}"; do
  for f in "$CLAUDE" "$CODEX" "$OPENCODE" "$ZCODE"; do
    if grep -Fq "$needle" "$f"; then
      continue
    fi
    # ZCode's net constants/patterns live in the shared story_hook_core.js companion
    # that story_zcode_hook.js requires; accept a hit there as satisfying this file.
    if [ "$f" = "$ZCODE" ] && grep -Fq "$needle" "$ZCODE_CORE"; then
      continue
    fi
    # OpenCode's plugin.ts likewise imports the net from its own shared story_hook_core.js
    # companion (byte-identical to ZCode's); accept a hit there as satisfying plugin.ts.
    if [ "$f" = "$OPENCODE" ] && grep -Fq "$needle" "$OPENCODE_CORE"; then
      continue
    fi
    # Claude's check-prose-after-write.sh now delegates the net/wordcount patterns to the
    # same shared story_hook_core.js (loaded via story_hook_cli.js); accept a hit there.
    if [ "$f" = "$CLAUDE" ] && grep -Fq "$needle" "$CLAUDE_CORE"; then
      continue
    fi
    echo "FAIL: net 규범 문자열 누락/편차 — 「${needle}」이(가) $(basename "$f")에 나타나지 않음" >&2
    fails=$((fails + 1))
  done
done
# 반복 임계값은 JS에서 `sa.length >= 8`로, python에서 `len(sa) >= 8`으로 작성됨; 위의 '>= 8'이 둘 다 포함함.

# ── B. 기능 parity(codex python 망 vs opencode TS 망), best-effort ──
# TS 실행: node 기본 타입 제거 우선(node ≥ 22.6의 --experimental-strip-types), 아니면 npx esbuild;
# 둘 다 없으면 B를 건너뜀(A가 이미 CI 안전 보장을 제공함).
run_functional() {
  command -v node >/dev/null 2>&1 || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  local tmp; tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  cat > "$tmp/fixtures.json" <<'EOF'
{
  "clean": "강진이 눈을 떴지만 아직 날이 밝지 않았다.\n그는 빨라야 하고, 준해야 하고, 이겨야 한다. 이것이 유일한 살 길이다.\n「AI 집사로서 무의미한 시도는 그만두라고 조언합니다.」\n그는 주먹을 쥐고 문 쪽으로 걸어갔다.",
  "truncate": "강진이 주먹을 쥐고 천천히 문 쪽으로 걸어갔다.\n강진이 달려가 한 주먹을 날렸다.",
  "refuse": "밤의 어둠이 내려앉았다.\nAI로서 이 부분의 창작을 계속할 수 없습니다.",
  "ai_selfref_model": "밤의 어둠이 내려앉았다.\nAI 언어 모델로서 다음 전개에 폭력 표현이 포함되어 있음을 알려드립니다.",
  "ai_selfref_assistant": "그가 문을 밀고 들어왔다.\nAI 어시스턴트로서 이 콘텐츠는 민감한 주제를 다루고 있습니다.",
  "ai_selfref_era_ok": "인공지능 시대의 산물인 그는 고독함에 익숙했다.\n그는 불을 껐다.",
  "terminal_banner_ok": "그는 손을 들어 광화면에 얹었다.\n【딩! 작업 완료, 보상이 지급되었습니다】",
  "terminal_ascii_quote_ok": "그는 일어나 문을 밀어 열었다.\n그가 말했다: \"나 돌아왔어.\"",
  "toxic_quote_codename_ok": "그는 담배꽁초를 재떨이에 눌러 끄웠다.\n이 전투는 필연적으로 「블러드 슬로터」의 시작이었고, 아무도 나중에 그렇게 될 줄은 몰랐다.",
  "engword": "가로등이 하나둘 켜졌다.\n본장 세부 시놉시스의 플롯 포인트에 따르면 그가 등장할 차례였다.",
  "repeat": "그는 주먹을 쥐고 한 발씩 다가갔다. 천천히 다가갔다.\n그는 주먹을 쥐고 한 발씩 다가갔다. 천천히 다가갔다.\n그는 마침내 멈추었다.",
  "placeholder": "그는 문을 열었다.\n（여기서는 삼백 자의 격투 장면을 생략합니다）그는 이겼다.",
  "english_ai": "그가 말했다.\nI cannot continue writing this scene for you.",
  "parallel": "죽거나 살거나.\n싸우거나 도망치거나.\n이기거나 지거나.\n그는 선택을 했다.",
  "danmaku": "앞에 주의!\n앞에 주의! 경고.\n이 부분에서 나 울었어.\n작가 추가 연재!",
  "toxic_voice": "그가 입을 열었다.\n목소리는 크지 않았지만, 첫 마디가 홀 전체를 단단히 눌러 담았다.",
  "toxic_negation": "반주도 없고, 화음도 없고, 프롬프터도 없었다.\n무대 아래가 3초간 고요해졌다.",
  "toxic_cross_negation": "펑펑 우는 것도 아니었다.\n\n목청을 내질러 놓치기 싫다고 외치는 것도 아니었다.\n\n단지 한 사람이 멀어졌고, 원래 있던 자리에 남겨진 사람은 여전히 서 있었을 뿐이다.",
  "toxic_cross_negation_dialogue_ok": ""펑펑 우는 것도 아니었다."\n\n"목청을 내질러 놓치기 싫다고 외치는 것도 아니었다."\n\n"단지 아쉬웠을 뿐이야."",
  "toxic_reverse_notis": "진짜 목소리였지, 음성 보정으로 만든 게 아니었다.\n그는 목청을 가다듬고 계속 불렀다.",
  "toxic_forward_notis": "퇴로를 생각해본 적이 없었던 게 아니라, 처음부터 퇴로가 없었다.\n그가 문을 닫았다.",
  "toxic_trailer": "그는 마이크를 내려놓고 무대 아래로 허리를 굽혔다.\n아무도 몰랐다. 이게 겨우 시작일 뿐이었다.",
  "toxic_trailer_summary": "그는 마이크를 내려놓고 무대 아래로 허리를 굽혔다.\n모든 게 끝났다.",
  "toxic_trailer_summary_fate": "그녀는 영수증을 접어 가방 속에 다시 집어넣었다.\n이 밤은 누구도 잠을 이루지 못할 운명이었다.",
  "toxic_bare_realize_ok": "그 순간 나는 드디어 깨달았다. 어머니가 예전에 왜 밤마다 우셨는지.\n나는 외투를 집어 들고 현관 쪽으로 걸어갔다.",
  "toxic_summary_subclause_ok": "이 모든 것이 끝나면 우리는 평온하고 행복한 삶을 살 수 있을 거야.\n그가 문을 닫았다.",
  "toxic_summary_idiom_ok": "이 순간 세상의 모든 사람이 운명의 결말을 받아들였다!\n그가 몸을 돌려 떠났다.",
  "toxic_dialogue_ok": "「아무도 모르지.」\n그가 웃고는 계속 앞으로 나아갔다.",
  "toxic_eitheror_ok": "산다든지 죽든지, 그가 받아들였다.\n그가 문을 밀고 들어갔다.",
  "toxic_affirm_ok": "그래, 그의 잘못이 아니야.\n그가 불을 껐다.",
  "toxic_shibushi_ok": "그는 자신이 잘못 들었나 싶었고, 조명이 너무 밝아서 그런 건 아닐까 생각했다.\n그는 눈을 비볐다.",
  "toxic_question_ok": "그가 한 건지, 내가 한 건 아닌지 확실하지 않았다.\n그는 명확히 말할 수 없었다.",
  "toxic_rhetorical_ok": "꽤 좋은 일이지 않은가.\n그는 고개를 끄덕였다.",
  "toxic_curtain_ok": "종소리가 다시 울렸고, 경기가 정식으로 시작되었다.\n그는 무대 위로 올라섰다.",
  "toxic_quote_mid_ok": "그녀의 목소리는 별로 좋지 않았고, 사람들에게 '명장면'으로 잘려 나갔지만, 그녀는 신경 쓰지 않았다.\n무대 아래에서는 박수도 없었고, '앙코르' 소리도 없었고, 오직 여기저기서 터져 나오는 기침소리만 들렸다.",
  "toxic_multi_tail_ok": "그것은 그의 잘못이지, 내 잘못이 아니다, 그렇지 않은가.\n그는 고개를 끄덕였다.",
  "toxic_exempt_marker_ok": "# 제1장\n<!-- 제거:건너뛰기 -->\n반주 없이, 화성 없이, 프롬프터 없이.",
  "toxic_exempt_fullwidth_ok": "# 제1장\n<!-- 제거：건너뛰기 -->\n반주 없이, 화성 없이, 프롬프터 없이.",
  "toxic_exempt_other_nets": "# 제1장\n<!-- 제거:건너뛰기 -->\n반주 없이, 화성 없이, 프롬프터 없이.\n이 장의 상세 구성안의 플롯 포인트에 따르면 그가 나타날 순서다.",
"toxic_astral_window_ok": "아무도 그가 몇 년을 연습했는지 알 수 없다.\n"1행😀😀😀😀😀😀😀😀😀😀"\n"2행😀😀😀😀😀😀😀😀😀😀"\n"3행😀😀😀😀😀😀😀😀😀😀"\n"4행😀😀😀😀😀😀😀😀😀😀"\n"5행😀😀😀😀😀😀😀😀😀😀"\n"6행😀😀😀😀😀😀😀😀😀😀"\n"7행😀😀😀😀😀😀😀😀😀😀"\n"8행😀😀😀😀😀😀😀😀😀😀"\n"9행😀😀😀😀😀😀😀😀😀😀"\n"10행😀😀😀😀😀😀😀😀😀😀"\n"11행😀😀😀😀😀😀😀😀😀😀"\n"12행😀😀😀😀😀😀😀😀😀😀"\n"13행😀😀😀😀😀😀😀😀😀😀"\n"14행😀😀😀😀😀😀😀😀😀😀"\n"15행😀😀😀😀😀😀😀😀😀😀"\n"16행😀😀😀😀😀😀😀😀😀😀"\n"17행😀😀😀😀😀😀😀😀😀😀"\n"18행😀😀😀😀😀😀😀😀😀😀"\n"19행😀😀😀😀😀😀😀😀😀😀"\n"20행😀😀😀😀😀😀😀😀😀😀"\n"21행😀😀😀😀😀😀😀😀😀😀"\n"22행😀😀😀😀😀😀😀😀😀😀"\n"23행😀😀😀😀😀😀😀😀😀😀"\n"24행😀😀😀😀😀😀😀😀😀😀"\n"25행😀😀😀😀😀😀😀😀😀😀"\n"26행😀😀😀😀😀😀😀😀😀😀"\n"27행😀😀😀😀😀😀😀😀😀😀"\n"28행😀😀😀😀😀😀😀😀😀😀"\n"29행😀😀😀😀😀😀😀😀😀😀"\n"30행😀😀😀😀😀😀😀😀😀😀"",
  "toxic_trailer_window_ok": "아무도 그가 몇 년을 연습했는지 알 수 없었다.\n강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다. 강천은 이 영상을 반복해서 편집했다. 새벽부터 날이 밝을 때까지 편집하며 매 프레임을 정교하게 다듬었다.\n그는 건반 뚜껑을 덮고 일어섰다."
}
EOF

  python3 - "$CODEX" "$tmp/fixtures.json" > "$tmp/py.txt" <<'PY'
import importlib.util, sys, json
spec = importlib.util.spec_from_file_location("ch", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
fx = json.load(open(sys.argv[2], encoding='utf-8'))
# stdout.buffer를 사용하여 UTF-8 바이트를 직접 쓰기: Windows runner의 python<3.15 텍스트 stdout은 cp1252이므로
# 중국어 findings를 포함한 print는 UnicodeEncodeError가 발생합니다(Node 측 console.log의 UTF-8 출력과 맞추기 위해).
for k in sorted(fx):
    line = k + " | " + " ;; ".join(m.prose_net_findings(fx[k]))
    sys.stdout.buffer.write((line + "\n").encode("utf-8"))
PY

  node - "$ZCODE" "$tmp/fixtures.json" > "$tmp/zcode.txt" <<'JS'
const hook = require(process.argv[2])
const fx = require(process.argv[3])
for (const k of Object.keys(fx).sort()) {
  console.log(k, "|", hook.proseNetFindings(fx[k]).join(" ;; "))
}
JS
  if ! diff "$tmp/py.txt" "$tmp/zcode.txt" >/dev/null; then
    echo "FAIL: 기능 parity 불일치(codex python 네트워크 vs zcode JS 네트워크):" >&2
    diff "$tmp/py.txt" "$tmp/zcode.txt" >&2 || true
    return 3
  fi

  # 독성 문장식 fixture 공수 전환 단언(양쪽 동일 오류도 diff 통과 가능하므로 예상 출력에 명시적 단언):
  # 정례(사용자 실제 수집 독성 문장)는 해당 규칙에 적중; 반례(대화 내/either-or/확인 표현/~인가/
  # 윈도우 외부 trailer)는 완전 침묵해야 함.
  grep -q '^toxic_voice | 제2행 독성 문장식\[voice-contrast\]' "$tmp/py.txt" || { echo "FAIL: 독성 문장식 정례 voice-contrast 미적중「음성이 높지 않은데…그런데」" >&2; return 3; }
  grep -q '^toxic_negation | 첫 번째 줄 독성 문장\[negation-parade\]' "$tmp/py.txt" || { echo "FAIL: 독성 문장 긍정 사례 negation-parade 미매칭「없다…없다…」" >&2; return 3; }
  grep -q '^toxic_cross_negation | $' "$tmp/py.txt" || { echo "FAIL: 구간 간「아니다/또한 아니다/단지」는 심층 의미 검증이 필요하며, 가벼운 차단 네트워크에 포함되면 안 됨" >&2; return 3; }
  grep -q '^toxic_reverse_notis | 첫 번째 줄 독성 문장\[reverse-not-is\]' "$tmp/py.txt" || { echo "FAIL: 독성 문장 긍정 사례 reverse-not-is 미매칭「진짜 목소리, 음성 보정 아님」" >&2; return 3; }
  grep -q '^toxic_forward_notis | 첫 번째 줄 독성 문장\[not-is-comparison\]' "$tmp/py.txt" || { echo "FAIL: 독성 문장 긍정 사례 not-is-comparison 미매칭「아니라…, 오히려…」" >&2; return 3; }
  grep -q '^toxic_trailer | 두 번째 줄 독성 문장\[trailer-ending\]' "$tmp/py.txt" || { echo "FAIL: 독성 문장 긍정 사례 trailer-ending 미매칭「아무도 모르지, 이제 막 시작됐어」" >&2; return 3; }
  grep -q '^toxic_trailer_summary | 2번째 줄 toxic 패턴\[trailer-summary\]' "$tmp/py.txt" || { echo "FAIL: toxic 패턴 정상 사례 trailer-summary가 「이제 모든 것이 끝났다」를 감지하지 못함" >&2; return 3; }
  grep -q '^toxic_trailer_summary_fate | 2번째 줄 toxic 패턴\[trailer-summary\]' "$tmp/py.txt" || { echo "FAIL: toxic 패턴 정상 사례 trailer-summary가 「이 밤은 반드시 누구도 잠들지 못할 것이다」를 감지하지 못함" >&2; return 3; }
  grep -q '^toxic_bare_realize_ok | $' "$tmp/py.txt" || { echo "FAIL: 「그 순간…드디어 깨달았다」심판 금언이 오탐지됨（단편 판매 포인트, 본 규칙은 인식 비트를 인정하지 않음）" >&2; return 3; }
  grep -q '^toxic_summary_subclause_ok | $' "$tmp/py.txt" || { echo "FAIL: 조건절「이 모든 것이 끝나면, …」이 오탐지됨（문장 끝 단언 위치에 도달하지 못함）" >&2; return 3; }
  grep -q '^toxic_summary_idiom_ok | $' "$tmp/py.txt" || { echo "FAIL: 성어「명중주정」이 trailer-summary로 교차 매칭됨" >&2; return 3; }
  grep -q '^toxic_dialogue_ok | $' "$tmp/py.txt" || { echo "FAIL: 대화 내 「아무도 모른다」가 오탐(쌍따옴표를 제거해야 함)" >&2; return 3; }
  grep -q '^toxic_cross_negation_dialogue_ok | $' "$tmp/py.txt" || { echo "FAIL: 3단 대화 내 부정이 hook 후 오탐(의미 심사는 대사 advisory 담당)" >&2; return 3; }
  grep -q '^toxic_eitheror_ok | $' "$tmp/py.txt" || { echo "FAIL: either-or「A가 아니면 B」가 오탐" >&2; return 3; }
  grep -q '^toxic_affirm_ok | $' "$tmp/py.txt" || { echo "FAIL: 확인 표현「그래, 아니라…」가 오탐" >&2; return 3; }
  grep -q '^toxic_shibushi_ok | $' "$tmp/py.txt" || { echo "FAIL: 의문「~인가」가 오탐" >&2; return 3; }
  grep -q '^toxic_question_ok | $' "$tmp/py.txt" || { echo "실패: 「그것이…」의문문 시작이 오탐지됨" >&2; return 3; }
  grep -q '^toxic_rhetorical_ok | $' "$tmp/py.txt" || { echo "실패: 반문 끝 「…，그렇지 않은가」이 오탐지됨" >&2; return 3; }
  grep -q '^toxic_curtain_ok | $' "$tmp/py.txt" || { echo "실패: 사회자 인사말 「공식적으로 막이 열리다」이 오탐지됨" >&2; return 3; }
  grep -q '^toxic_trailer_window_ok | $' "$tmp/py.txt" || { echo "FAIL: 문말 600자 윈도우 외부의 '사람이 모를'이 오탐지됨" >&2; return 3; }
  grep -q '^toxic_quote_mid_ok | $' "$tmp/py.txt" || { echo "FAIL: 문장 중간 인용구 세그먼트가 등길이 자리표로 잘리지 않아 규칙이 인용구를 넘어 가짜 명중을 만듦" >&2; return 3; }
  grep -q '^toxic_multi_tail_ok | $' "$tmp/py.txt" || { echo "FAIL: 중간 대조항이 있는 반문 꼬리말「…, 아닌가요」가 오탐되었습니다" >&2; return 3; }
  grep -q '^toxic_exempt_marker_ok | $' "$tmp/py.txt" || { echo "FAIL: 「제거:건너뛰기」로 표시된 본문 악문체가 후행 네트 면제되지 않았습니다" >&2; return 3; }
  grep -q '^toxic_exempt_fullwidth_ok | $' "$tmp/py.txt" || { echo "FAIL: 전각 콜론 면제 표시「제거：건너뛰기」가 적용되지 않았습니다" >&2; return 3; }
  grep -q '^toxic_exempt_other_nets | 제4행 엔지니어링 용어 누수' "$tmp/py.txt" || { echo "FAIL: 면제 표시가 악문체 외의 네트까지 꺼뜨려서는 안 됩니다(엔지니어링 용어 누락 검출)" >&2; return 3; }
  grep '^toxic_exempt_other_nets' "$tmp/py.txt" | grep -q '악문체' && { echo "FAIL: 면제 표시가 있을 때 악문체가 여전히 역추적되었습니다" >&2; return 3; }
  grep -q '^toxic_astral_window_ok | $' "$tmp/py.txt" || { echo "FAIL: 따옴표 내 이모지의 위치 길이가 UTF-16 코드 단위로 정렬되지 않았으며, trailer 윈도우 절단점이 편차 발생" >&2; return 3; }
  grep -q '^toxic_quote_codename_ok | $' "$tmp/py.txt" || { echo "FAIL: 따옴표 위치가 trailer-summary의 문장 끝 [。！] 위장 종료 기호로 치환됨（위치 문자가 규칙 수락 범위에 포함됨）" >&2; return 3; }

  # AI 자기지칭（약신호）방어 변환: 모델 번호 접미사가 있는 가장 전형적인 퇴화된 시작 문구는 반드시 매칭되어야 하며, 거부 문구가 없어도 매칭되어야 함
  # （이전의 refuse fixture는 「거부 문구 생성」규칙에 의해 캐치되었으나, AI 자기지칭 규칙은 커버되지 않았음）; 복합 명사는 오탐지하지 않음.
  grep -q '^ai_selfref_model | 제2행 메타정보 유출（AI 자기지칭）' "$tmp/py.txt" || { echo "FAIL: AI 자기지칭이 「AI 언어 모델입니다」와 매칭되지 않음（거부 문구 없음）" >&2; return 3; }
  grep -q '^ai_selfref_assistant | 2번째 줄 메타데이터 누출(AI 자기참조)' "$tmp/py.txt" || { echo "FAIL: AI 자기참조가 「AI 어시스턴트로서」를 감지하지 못함" >&2; return 3; }
  grep -q '^ai_selfref_era_ok | $' "$tmp/py.txt" || { echo "FAIL: 복합 명사 「인공지능 시대의 산물」이 AI 자기참조에 의해 오탐지됨" >&2; return 3; }

  # 수미 문장부호 제거: 】(장 끝 시스템 공지 템플릿의 종료 기호)와 ASCII " (ascii 인용부호 모드의 닫는 인용부호)를 모두 종료로 간주
  # 심화 스캔 oracle check-degeneration.js의 findTruncation과 일치; 실제 수미는 truncate fixture로 별도 잠금
  grep -q '^terminal_banner_ok | $' "$tmp/py.txt" || { echo "FAIL: 【…】로 끝나는 장 끝 시스템 공지가 의심스러운 수미로 오판됨" >&2; return 3; }
  grep -q '^terminal_ascii_quote_ok | $' "$tmp/py.txt" || { echo "FAIL: ASCII로 끝나는 인용부호가 있는 대화가 잘못 판단되어 유사 절단으로 표시됨" >&2; return 3; }
  grep -q '^truncate | 제2행 의사절단' "$tmp/py.txt" || { echo "FAIL: 실제 절단(끝에 구두점 없음)이 감지되지 않음" >&2; return 3; }

  # TS 변환: 타입을 제거하면 됨(net 함수는 RegExp/String/Set/Array만 사용). node 기본 타입 제거 우선
  # (node ≥ 22.6의 --experimental-strip-types), 그렇지 않으면 설치된 esbuild 바이너리 사용.
  # `npx --yes esbuild` 사용 안 함: CI 전체 플랫폼 node 20에서 반복적인 네트워크 다운로드는 느리고 불안정함 — B는 개발 중 확인 용도,
  # CI의 결정성 보장은 A(규범 문자열 3단 일치)가 담당하며, TS 런타임이 없으면 B는 자동으로 건너뜁니다.
  cp "$OPENCODE" "$tmp/p.ts"
  # plugin.ts imports the core from ./lib/story_hook_core.js (the deploy target — a lib/
  # subdir escapes OpenCode's single-level .opencode/plugins/*.js plugin auto-discovery);
  # mirror that layout here so the copied plugin's import resolves.
  mkdir -p "$tmp/lib"
  cp "$OPENCODE_CORE" "$tmp/lib/story_hook_core.js"
  # plugin.ts imports the net from ./lib/story_hook_core.js; re-export it from that companion
  # so the type-stripped module exposes the exact function OpenCode runs at deploy time.
  printf "\nexport { proseNetFindings as _net } from './lib/story_hook_core.js'\n" >> "$tmp/p.ts"
  local ran=0
  if node --experimental-strip-types -e '' >/dev/null 2>&1; then
    node --experimental-strip-types --input-type=module -e "
      import { _net } from '$tmp/p.ts';
      import fs from 'node:fs';
      const fx = JSON.parse(fs.readFileSync('$tmp/fixtures.json','utf-8'));
      for (const k of Object.keys(fx).sort()) console.log(k, '|', _net(fx[k]).join(' ;; '));
    " > "$tmp/ts.txt" 2>/dev/null && ran=1
  fi
  if [ "$ran" -eq 0 ] && command -v esbuild >/dev/null 2>&1; then
    if esbuild "$tmp/p.ts" --format=esm --platform=node --log-level=silent --outfile="$tmp/p.mjs" >/dev/null 2>&1; then
      node --input-type=module -e "
        import { _net } from '$tmp/p.mjs';
        import fs from 'node:fs';
        const fx = JSON.parse(fs.readFileSync('$tmp/fixtures.json','utf-8'));
        for (const k of Object.keys(fx).sort()) console.log(k, '|', _net(fx[k]).join(' ;; '));
      " > "$tmp/ts.txt" 2>/dev/null && ran=1
    fi
  fi
  [ "$ran" -eq 0 ] && return 2

  if ! diff "$tmp/py.txt" "$tmp/ts.txt" >/dev/null; then
    echo "FAIL: 기능 parity 불일치(codex python 네트워크 vs opencode TS 네트워크):" >&2
    diff "$tmp/py.txt" "$tmp/ts.txt" >&2 || true
    return 3
  fi
  return 0
}

# ── C. 명령 함수 parity(codex python vs zcode JS), CI 강제 보장 ─────────────────
# 본문 대상 추출(리다이렉션/tee/touch/cp·mv), apply-patch 대상, git commit 감지 세 개의 순함수
# (명령 문자열 → 값)가 다음 fixture에서 그대로 일치합니다. 이전에는 py/js 수작업만 있었고 보호 메커니즘이 없어 이미 표류했습니다(cp·mv
# 메타데이터, git 제어 키워드(then/do/else/elif), 서브셸 괄호). node+python3은 CI의 모든 플랫폼에 설치되어 있으므로 필수 요구사항입니다.
# 주: fixture는 양쪽 끝에서 수렴한 부분집합을 취함; 따옴표 내 구분자(echo "a; git commit")와 명령 치환($(git commit))
# 양쪽 끝이 원래 같지 않음(py는 shlex로 따옴표를 존중하고, js는 단순 분할), 이 네트워크의 책임이 아니며, advisory에만 영향을 주고 차단에는 영향을 주지 않음.
run_cmd_parity() {
  command -v node >/dev/null 2>&1 || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  local tmp; tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  cat > "$tmp/cmd.json" <<'EOF'
{
  "redirect": "echo x > book/정문/제1장.md",
  "append": "cat a >> 정문.md",
  "tee": "echo x | tee book/정문/제2장.md",
  "tee_a": "printf y | tee -a 정문.md",
  "touch": "touch book/정문/제3장.md",
  "cp": "cp src.md book/정문/제4장.md",
  "mv2": "mv 정문.md",
  "cp_flag": "cp -f a.md 정문.md",
  "mention": "grep -n book/정문/제1장.md notes.md",
  "redirect_quoted_space": "cat draft.md > \"my book/정문/제1장_x.md\"",
  "redirect_fullwidth_space": "cat draft.md > book/정문/제003장　개국.md",
  "tee_quoted_space": "printf x | tee 'my book/정문/제1장_x.md'",
  "cp_quoted_space": "cp draft.md \"my book/정문/제1장_x.md\"",
  "cp_quoted_operator": "cp draft.md \"book|archive/정문/제11장.md\"",
  "patch_add": "*** Begin Patch\n*** Add File: book/정문/제5장.md\n+정문\n*** End Patch",
  "patch_move": "*** Begin Patch\n*** Update File: draft.md\n*** Move to: book/정문/제6장.md\n+정문\n*** End Patch",
  "patch_move_delete": "*** Begin Patch\n*** Delete File: draft.md\n*** Move to: book/정문/제7장.md\n*** End Patch",
  "patch_move_out": "*** Begin Patch\n*** Update File: book/정문/제8장.md\n*** Move to: draft.md\n+x\n*** End Patch",
  "patch_delete_only": "*** Begin Patch\n*** Delete File: book/정문/제9장.md\n*** End Patch",
  "patch_multi_move": "*** Begin Patch\n*** Add File: notes.md\n+x\n*** Update File: draft.md\n*** Move to: book/정문/제10장.md\n+정문\n*** End Patch",
  "patch_context_move": "*** Begin Patch\n*** Update File: book/정문/제12장.md\n@@\n *** Move to: notes.md\n+정문\n*** End Patch",
  "commit_plain": "git commit -m x",
  "commit_chain": "git add . && git commit -m x",
  "commit_if": "if true; then git commit -m x; fi",
  "commit_for": "for f in *; do git commit -am x; done",
  "commit_subshell": "(cd sub && git commit)",
  "commit_env": "FOO=1 git commit",
  "commit_config": "git -c user.name=x commit",
  "commit_C": "git -C sub commit -m y",
  "noncommit_echo": "echo git commit docs",
  "noncommit_status": "git status && echo done"
}
EOF
  python3 - "$CODEX" "$tmp/cmd.json" > "$tmp/cpy.txt" <<'PY'
import importlib.util, sys, json
spec = importlib.util.spec_from_file_location("ch", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
fx = json.load(open(sys.argv[2], encoding='utf-8'))
for k in sorted(fx):
    c = fx[k]
    line = f"{k} :: pros=[{'|'.join(m.extract_prose_targets_from_command(c))}] patch=[{'|'.join(m.extract_apply_patch_targets(c))}] commit={'1' if m.is_git_commit_command(c) else '0'}"
    sys.stdout.buffer.write((line + "\n").encode("utf-8"))
PY
  node - "$ZCODE" "$tmp/cmd.json" > "$tmp/cjs.txt" <<'JS'
const h = require(process.argv[2])
const fx = require(process.argv[3])
for (const k of Object.keys(fx).sort()) {
  const c = fx[k]
  console.log(`${k} :: pros=[${h.extractProseTargets(c).join("|")}] patch=[${h.extractPatchTargets(c).join("|")}] commit=${h.isGitCommitCommand(c) ? "1" : "0"}`)
}
JS
  if ! diff "$tmp/cpy.txt" "$tmp/cjs.txt" >/dev/null; then
    echo "FAIL: 명령 함수 parity 불일치(codex python vs zcode JS):" >&2
    diff "$tmp/cpy.txt" "$tmp/cjs.txt" >&2 || true
    return 3
  fi
  # 방공 전환: 공백/전각 공백이 있는 대상은 전체 구간을 추출해야 함(양쪽 끝 오류도 diff 통과 가능). 문자 클래스 \s는
  # 「제003장　개국.md」를 「제003장」로 잘라내고, 인용부호를 클래스 외부로 제외하면 인용부호 경로 전체를 추출할 수 없음 → 무시하고 진행.
  grep -q 'redirect_quoted_space :: pros=\[my book/정문/제1장_x.md\]' "$tmp/cpy.txt" \
    || { echo "실패: 공백이 있는 인용부호 리다이렉트 대상이 전체 구간으로 추출되지 않음(인용부호가 무시됨)" >&2; return 3; }
  grep -q 'redirect_fullwidth_space :: pros=\[book/정문/제003장　개국.md\]' "$tmp/cpy.txt" \
    || { echo "FAIL: 전각 공백 장 이름이 \\s로 잘림 (U+3000은 shell 단어 구분자가 아님)" >&2; return 3; }
  grep -q 'tee_quoted_space :: pros=\[my book/정문/제1장_x.md\]' "$tmp/cpy.txt" \
    || { echo "FAIL: 공백이 있는 따옴표 tee 대상이 전체로 추출되지 않음" >&2; return 3; }
  grep -q 'cp_quoted_space :: pros=\[my book/정문/제1장_x.md\]' "$tmp/cpy.txt" \
    || { echo "FAIL: cp의 따옴표 대상이 공백으로 잘려서 마지막 위치에 다른 책의 경로가 포함됨" >&2; return 3; }
  grep -q 'cp_quoted_operator :: pros=\[book|archive/정문/제11장.md\]' "$tmp/cpy.txt" \
    || { echo "FAIL: cp 인용부호 대상의 | 가 오류로 shell 파이프로 절단되었으며, 정문 보호가 조용히 통과시킴" >&2; return 3; }
  # 방공전(apply_patch 이전 형태): `*** Move to:` 는 Update/Delete File 섹션의 하위 명령어이며, 저장 경로는
  # 목적지입니다. Add/Update File에서만 「Update draft.md + Move to 서/정문/제N장.md」 에서 추출된 것은 소스
  # draft.md → 세부강목 전체 공백 통과, 쓰기 후 최후 대응 네트워크 스캔의 대상은 이미 존재하지 않는 소스(양쪽 동일 오류, diff 도 보이지 않음).
  grep -q 'patch_move :: pros=\[\] patch=\[book/정문/제6장.md\]' "$tmp/cpy.txt" \
    || { echo "FAIL: apply_patch의 *** Move to: 대상이 목표 테이블에 들어가지 않음(소스가 이동되고 대상만 저장됨)" >&2; return 3; }
  grep -q 'patch_move_delete :: pros=\[\] patch=\[book/정문/제7장.md\]' "$tmp/cpy.txt" \
    || { echo "FAIL: *** Delete File: + *** Move to:의 대상이 목표 테이블에 들어가지 않음" >&2; return 3; }
  grep -q 'patch_move_out :: pros=\[\] patch=\[draft.md\]' "$tmp/cpy.txt" \
    || { echo "FAIL: 정문/에서 이동할 때 소스가 여전히 쓰기 대상으로 처리됨(소스가 존재하지 않으므로 대상만 판정되어야 함)" >&2; return 3; }
  grep -q 'patch_delete_only :: pros=\[\] patch=\[\]' "$tmp/cpy.txt" \
    || { echo "FAIL: 순수 *** Delete File: 대상 테이블에 진입하면 안 됨(삭제는 쓰기가 아니므로 삭제 오보만 발생시킬 것임)" >&2; return 3; }
  grep -q 'patch_multi_move :: pros=\[\] patch=\[notes.md|book/정문/제10장.md\]' "$tmp/cpy.txt" \
    || { echo "FAIL: 한 패치 내에서 Add 섹션과 Move 섹션의 대상이 동시에 모두 캡처되지 않음(Move는 같은 섹션의 소스만 치환해야 함)" >&2; return 3; }
  grep -q 'patch_context_move :: pros=\[\] patch=\[book/정문/제12장.md\]' "$tmp/cpy.txt" \
    || { echo "FAIL: patch 컨텍스트 라인의 리터럴 *** Move to가 제어 명령으로 오인되어 실제 정문 대상이 치환됨" >&2; return 3; }

  # ReDoS 회귀(shellWords): 호출자가 먼저 [;&|\n]으로 분할하면 따옴표 내의 |를 분할하고 닫지 않은 "를 남깁니다.
  # 기존 /"(?:\\.|[^"])*"|'[^']*'|[^\s]+/ 에서 \\. 와 [^"] 모두 역슬래시를 처리할 수 있으며, 각 역슬래시는 검색 공간을 두 배로 만듭니다.
  # 이 백여 글자의 커밋 명령은 실제로 수십 초의 CPU를 소모했습니다(zcode hooks.json의 timeoutMs 15000을 초과하여 종료됨).
  # 선형 수동 토큰화는 밀리초 단위로 판정을 완료해야 하므로 2초의 예산을 제공합니다(Python 쪽 shlex는 이미 선형이므로 함께 시간을 측정하여 드리프트 방지).
  node - "$ZCODE" > "$tmp/redos.txt" <<'JS' || return 3
const h = require(process.argv[2])
const cmd = 'git commit -m "fix: 정규식 이스케이프 커버리지 ' + Array.from({ length: 18 }, () => "\\\\x").join(" ") + ' covered | see README"'
const t0 = Date.now()
const hit = h.isGitCommitCommand(cmd)
const ms = Date.now() - t0
if (!hit) { console.error("FAIL: git commit 감지 실패 - 이스케이프/파이프가 포함된 커밋 명령 누락"); process.exit(3) }
if (ms > 2000) { console.error(`FAIL: shellWords 역추적 폭발(${ms}ms > 2000ms) - 호스트 hook이 시간 초과로 종료됨`); process.exit(3) }
console.log(`redos_budget :: ${ms}ms`)
JS
  python3 - "$CODEX" >> "$tmp/redos.txt" <<'PY' || return 3
import importlib.util, sys, time
spec = importlib.util.spec_from_file_location("ch", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cmd = 'git commit -m "fix: 정규식 이스케이프 커버 ' + " ".join([r"\\x"] * 18) + ' covered | see README"'
t0 = time.time()
hit = m.is_git_commit_command(cmd)
ms = int((time.time() - t0) * 1000)
# 실패 메시지는 stderr.buffer를 통해 UTF-8로 직접 쓰기: Windows python의 텍스트 stderr는 cp1252이므로 중문은 UnicodeEncodeError 발생
if not hit:
    sys.stderr.buffer.write("FAIL: py 쪽 git commit 감지 실패 - 이스케이프/파이프가 포함된 커밋 명령 누락\n".encode("utf-8")); sys.exit(3)
if ms > 2000:
    sys.stderr.buffer.write(f"FAIL: Python 측 git commit 감지가 비선형으로 성능이 저하됨({ms}ms > 2000ms)\n".encode("utf-8")); sys.exit(3)
PY
  return 0
}

# ── D. Claude 핵심 회귀 가드(CI 하드 보장) ─────────────────────────────────────────────
# Claude의 4개 bash hook(check-prose-after-write / guard-outline-before-prose /
# validate-story-commit / detect-story-gaps)는 더 이상 heredoc python을 내장하지 않고, 같은 디렉터리의 단일 node
# 공유 핵 story_hook_core.js(story_hook_cli.js를 통해)를 호출함 ── 본문 네트워크/글자 수/대강 구성 가드/git-commit 감지/
# 연속성. 이 코어와 OpenCode/ZCode는 동일한 파일입니다(check-shared-files가 바이트 일치 보장), Part B/C에서
# codex로 잠금 처리되었으므로 claude==codex 구조적 폐루프이며, heredoc을 다시 추출하여 재실행할 필요가 없습니다. 여기서 두 가지 회귀 방지 규칙을 지킵니다:
# ① 4개의 hook에서 heredoc python이 다시 나타나면 안 됩니다(누군가 수동으로 5번째 구현으로 회귀하는 것을 방지); ② 반드시
# story_hook_cli.js를 통해 코어를 검증해야 합니다. 바이트 일치는 check-shared-files에서 별도로 보장합니다.
run_claude_core_check() {
  local hooks_dir cli bad=0 hook
  hooks_dir="$(dirname "$CLAUDE")"
  cli="$hooks_dir/story_hook_cli.js"
  [ -f "$cli" ] || { echo "FAIL: story_hook_cli.js 누락(Claude 검증 브릿지)" >&2; return 3; }
  [ -f "$hooks_dir/story_hook_core.js" ] || { echo "FAIL: story_hook_core.js 누락됨(Claude 공유 핵심 복사본)" >&2; return 3; }
  if command -v node >/dev/null 2>&1; then
    node --check "$cli" >/dev/null 2>&1 || { echo "FAIL: story_hook_cli.js node 구문 오류" >&2; return 3; }
  fi
  for hook in check-prose-after-write guard-outline-before-prose validate-story-commit detect-story-gaps; do
    if grep -q "<<'PY'" "$hooks_dir/$hook.sh"; then
      echo "FAIL: $hook.sh 내부에 heredoc python 포함됨(node 공유 핵심 story_hook_cli.js로 변경해야 함)" >&2; bad=1
    fi
    grep -q 'story_hook_cli\.js' "$hooks_dir/$hook.sh" || { echo "FAIL: $hook.sh가 story_hook_cli.js를 통해 핵심 검증되지 않음" >&2; bad=1; }
  done
  [ "$bad" -eq 0 ] || return 3
  return 0
}

# ── E. 미정렬 parity(codex python vs JS core), CI 강제 보증 ─────────────────────
# staged markdown warnings와 대안 차단 판정 통합 부재: codex python(staged_markdown_warnings / prose_block_reason)와 JS core(stagedMarkdownWarnings / proseBlockReason)가 각각 구현되어 있으며,
# 의미/문안은 JS core를 기준으로 하고, 여기서는 fixture 상에서 글자 단위로 비교하여 드리프트를 방지합니다. Claude 측의 순수 bash 구현은 이 범위에 포함되지 않으며,
# check-story-setup-deployment.sh / test-hook-encoding-portable.sh 실행 회귀 커버로 검증됩니다.
# fixture는 최소한 다음을 커버해야 합니다: ① name 필드 대소문자 변형(NAME/전각 공백 보충)이 일치하게 명중——필드가 있으면 경고하지 않음;

# ② 누락된 필드/하드코딩된 속성의 중문 경고 문안(헤더/푸터 프레임 포함)이 정확히 일치; ③ 장문 누락된 세부 개요/세부 개요 있음, 단문 누락된 소절 개요/신호 없음 4가지 차단 판정과 차단 문안이 정확히 일치; ④ 독성 문식 미해결 항목 4가지:
# 미해결 항목 차단, 「제거:스킵」로 표기/전각 콜론「제거：스킵」면제 처리, 이전 챕터에 손상된 바이트 대체 디코딩 계속 스캔.
# 유효한 미해결 항목 차단, 「제거:스킵」/전각 콜론「제거：스킵」 면제 적용, 이전 장 손상된 바이트 대체 디코딩 후 계속 스캔.
run_uncored_parity() {
  command -v node >/dev/null 2>&1 || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  command -v git >/dev/null 2>&1 || return 1
  local tmp; tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  # E1: staged markdown warnings —— 독립적인 git 저장소를 생성하고 고정 파일 집합을 stage
  local repo="$tmp/repo"
  mkdir -p "$repo/book/정문" "$repo/설정"
  git -C "$repo" init -q
  printf '키: 180\n문을 밀고 들어갔다.\n나이　：18\n' > "$repo/book/본문/제1장.md"
  printf 'NAME：린원\n' > "$repo/설정/주인공.md"            # 대소문자 변형: 필드 있음, 경고 없음
  printf '　이름 ：수리\n' > "$repo/설정/조연.md"          # 전각 공백 채우기: 필드 있음, 경고 없음
  printf '소개：이름 필드 없음\n' > "$repo/설정/악역.md"     # 필드 누락: 경고
  # 캐릭터 카드 축소: 설정/캐릭터|인물 하위 디렉터리 내 파일 + 설정/ 직속 평면 캐릭터 카드의 name 필드만 확인; 
  # 프로젝트 레벨 설정 파일(관계/문체/소재 포지셔닝…)과 비역할 하위 디렉터리는 검사하지 않음. 네 엔드포인트(bash/OpenCode/JS/py)
  # 동일한 기준으로 여기서는 py↔js 두 엔드를 고정하여, 어느 한쪽이 "전체 설정/ 일괄 처리" 거짓 경고 버전으로 롤백되는 것을 방지합니다.
  mkdir -p "$repo/설정/역할" "$repo/설정/월드빌딩"
  printf '소개: 이름 필드가 없는 캐릭터 카드\n' > "$repo/설정/역할/신입.md"  # 캐릭터 카드 하위 디렉터리: 필드 누락, 경고 발생
  printf '# 캐릭터 관계도\n' > "$repo/설정/관계.md"                     # 프로젝트 레벨 설정 파일: 경고 없음
  printf '# 문체\n' > "$repo/설정/문체.md"                           # 프로젝트 수준 설정 파일: 경고 없음
  printf '# 지리\n' > "$repo/설정/세계관/지리.md"                    # 비캐릭터 하위 디렉토리: 전체 디렉토리 스킵
  git -C "$repo" add -A

  python3 - "$CODEX" "$repo" > "$tmp/spy.txt" <<'PY'
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("ch", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
out = m.staged_markdown_warnings(Path(sys.argv[2]))
sys.stdout.buffer.write((out + "\n").encode("utf-8"))
PY
  node - "$CLAUDE_CORE" "$repo" > "$tmp/sjs.txt" <<'JS'
const core = require(process.argv[2])
console.log(core.stagedMarkdownWarnings(process.argv[3]))
JS
  if ! diff "$tmp/spy.txt" "$tmp/sjs.txt" >/dev/null; then
    echo "FAIL: staged warnings parity 불일치(codex python vs JS core):" >&2
    diff "$tmp/spy.txt" "$tmp/sjs.txt" >&2 || true
    return 3
  fi
  # 방공 전환(양쪽 모두 빈 문자열 출력해도 diff 통과): 명중/미명중 단언과 통일된 중문 문안이 실제로 존재하는지 확인
  grep -q '정문 하드코딩 캐릭터 속성, 설정 파일을 참조해야 함' "$tmp/spy.txt" || { echo "FAIL: staged warnings 통일 문안으로 하드코딩 속성 보고 안 됨" >&2; return 3; }
  grep -q '반파.md: 설정 파일에 name/이름 필수 필드가 누락되었습니다.' "$tmp/spy.txt" || { echo "FAIL: staged warnings에서 name 필드 누락을 통일된 문안으로 보고하지 않음" >&2; return 3; }
  grep -q '주인공.md' "$tmp/spy.txt" && { echo "FAIL: 대문자 NAME:은 필드가 존재하는 것으로 간주해야 함(대소문자 구분 안 함)" >&2; return 3; }
  grep -q '조연.md' "$tmp/spy.txt" && { echo "FAIL: 전각 공백이 채워진 이름 :은 필드가 존재하는 것으로 간주해야 함" >&2; return 3; }
  grep -q '설정/캐릭터/신입.md: 설정 파일에 name/이름 필수 필드가 누락되었습니다.' "$tmp/spy.txt" || { echo "FAIL: 설정/캐릭터 하위 디렉터리의 캐릭터 카드는 여전히 name 필드를 확인해야 함" >&2; return 3; }
  grep -q '관계.md' "$tmp/spy.txt" && { echo "FAIL: 프로젝트 수준 설정 파일 관계.md는 캐릭터 카드로서 name을 확인해서는 안 됨" >&2; return 3; }
  grep -q '문풍.md' "$tmp/spy.txt" && { echo "FAIL: 프로젝트 레벨 설정 파일 문풍.md는 캐릭터 카드로 검사되면 안 됨" >&2; return 3; }
  grep -q '지리.md' "$tmp/spy.txt" && { echo "FAIL: 설정/ 아래 비캐릭터 서브디렉토리는 전체 디렉토리를 건너뛰어야 함" >&2; return 3; }

  # E2: 대강/추적 차단 판정 —— 장편 세부 대강 없음(차단)/세부 대강 있음(통과), 단편 소절 대강 없음(차단)/설정 신호 없음(통과),
  #     독성 문법 미처리(이전 장에 미처리 있으면 차단 / "불순물 제거:건너뛰기" 표시 시 면제 통과 / 전각 콜론「불순물 제거：건너뛰기」면제 통과 /
  #     이전 장에 나쁜 바이트 대체 디코딩 후 계속 스캔해도 차단), 신규 도서 스캐폴딩 없을 시에도 먼저 세부 대강 생성 필수(차단)
  local blk="$tmp/blk"
  mkdir -p "$blk/long/정문" "$blk/long/대강" "$blk/short" "$blk/short2" \
    "$blk/long2/정문" "$blk/long2/대강" "$blk/long3/정문" "$blk/long3/대강"
  : > "$blk/long/대강/세강_제2장.md"
  : > "$blk/short/설정.md"
  : > "$blk/short2/기타.md"
  : > "$blk/long2/대강/세부강_제2장.md"
  printf '%s\n' '# 제1장 구' '' '음성이 크지 않지만 날카로운 기세가 묻어난다.' > "$blk/long2/정문/제1장_구.md"
  : > "$blk/long3/대강/세부강_제2장.md"
  printf '%s\n' '# 제1장 구' '<!-- 제거:건너뛰기 -->' '음성이 크지 않지만 날카로운 기세가 묻어난다.' > "$blk/long3/정문/제1장_구.md"
  mkdir -p "$blk/long4/정문" "$blk/long4/대강" "$blk/long5/정문" "$blk/long5/대강"
  : > "$blk/long4/대강/세강_제2장.md"
  printf '%s\n' '# 제1장 이전' '<!-- 제거: 스킵 -->' '음성이 크지 않지만 거칠게 들린다.' > "$blk/long4/본문/제1장_이전.md"
  : > "$blk/long5/대강/세강_제2장.md"
  { printf '%s\n' '# 제1장 이전' '음성이 크지 않지만 거칠게 들린다.'; printf '\xff\n'; } > "$blk/long5/본문/제1장_이전.md"
  for book in long long2 long3 long4 long5; do
    mkdir -p "$blk/$book/추적"
    printf '%s\n' '{"schema_version":4,"state_revision":0,"last_committed_chapter":1}' > "$blk/$book/추적/_tracking-state.json"
    printf '%s\n' '> 상태 리비전: 0' > "$blk/$book/추적/컨텍스트.md"
  done
  # 이전 장 본문이 존재하고 state 커밋 진행도가 뒤처짐: 다음 장 초기 생성을 반드시 차단해야 함.
  mkdir -p "$blk/long6/본문" "$blk/long6/개요" "$blk/long6/추적"
  : > "$blk/long6/개요/세부개요_제2장.md"
  printf '%s\n' '# 제1장 구판' '그는 문을 닫았다.' > "$blk/long6/정문/제1장_구판.md"
  printf '%s\n' '{"schema_version":4,"state_revision":0,"last_committed_chapter":0}' > "$blk/long6/추적/_tracking-state.json"
  printf '%s\n' '> 상태 수정판: 0' > "$blk/long6/추적/컨텍스트.md"
  # 표준 케이스: agent가 {책}/정문/제N장.md를 직접 최초 생성하는데, 책 디렉토리에 아직 개요/추적/설정 스캐폴드가 없어도 반드시 fail closed되어야 함.
  # 상대 대상의 cwd 의미론은 각 호스트 adapter가 별도로 담당하며, 핵심 보안 강화를 약화시켜 문제를 덮을 수 없음.
  mkdir -p "$blk/bare/본문"

  python3 - "$CODEX" "$blk" > "$tmp/bpy.txt" <<'PY'
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("ch", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
root = Path(sys.argv[2])
for rel in ["long/본문/제1장_기.md", "long/본문/제2장_승.md", "short/본문.md", "short2/본문.md", "long2/본문/제2장_신.md", "long3/본문/제2장_신.md", "long4/본문/제2장_신.md", "long5/본문/제2장_신.md", "long6/본문/제2장_신.md", "bare/본문/제1장_기.md"]:
    reason = m.prose_block_reason(root, root / rel)
    sys.stdout.buffer.write((f"{rel} :: {reason if reason else '-'}\n").encode("utf-8"))
PY
  node - "$CLAUDE_CORE" "$blk" > "$tmp/bjs.txt" <<'JS'
const path = require("node:path")
const core = require(process.argv[2])
const root = process.argv[3]
for (const rel of ["long/본문/제1장_기.md", "long/본문/제2장_승.md", "short/본문.md", "short2/본문.md", "long2/본문/제2장_신.md", "long3/본문/제2장_신.md", "long4/본문/제2장_신.md", "long5/본문/제2장_신.md", "long6/본문/제2장_신.md", "bare/본문/제1장_기.md"]) {
  const reason = core.proseBlockReason(root, path.join(root, rel))
  console.log(`${rel} :: ${reason || "-"}`)
}
JS
  if ! diff "$tmp/bpy.txt" "$tmp/bjs.txt" >/dev/null; then
    echo "FAIL: 개요 차단 parity 불일치(codex python vs JS core):" >&2
    diff "$tmp/bpy.txt" "$tmp/bjs.txt" >&2 || true
    return 3
  fi
  grep -q '제1장_기.md :: ⛔' "$tmp/bpy.txt" || { echo "FAIL: 장편 세부 개요 미차단" >&2; return 3; }
  grep -q '제2장_승.md :: -' "$tmp/bpy.txt" || { echo "FAIL: 장편에 세부 개요가 있는데 잘못 차단됨" >&2; return 3; }
  grep -q 'short/정문.md :: ⛔' "$tmp/bpy.txt" || { echo "FAIL: 단편의 소절 개요 부족이 차단되지 않음" >&2; return 3; }
  grep -q 'short2/정문.md :: -' "$tmp/bpy.txt" || { echo "FAIL: 설정 신호가 없는 정문.md가 잘못 차단됨" >&2; return 3; }
  grep -q '독성 문장식 미결제' "$tmp/bpy.txt" || { echo "FAIL: 이전 장의 독성 문장식 미결제가 미결제 필터에 의해 차단되지 않음" >&2; return 3; }
  grep -q 'long3/정문/제2장_신.md :: -' "$tmp/bpy.txt" || { echo "FAIL: 「제맛:건너뛰기」 면제 표시된 이전 장이 여전히 미결제 필터에 의해 잘못 차단됨" >&2; return 3; }
  grep -q 'long4/정문/제2장_신.md :: -' "$tmp/bpy.txt" || { echo "FAIL: 전각 콜론 면제 표시「제거:건너뛰기」가 미지급 게이트웨이에서 인정되지 않음" >&2; return 3; }
  grep -q 'long5/정문/제2장_신.md :: ⛔' "$tmp/bpy.txt" || { echo "FAIL: 이전 장에 손상된 바이트가 있을 때 양쪽 끝에서 디코딩을 대체하고 계속 스캔해야 함(전체 허용 불가)" >&2; return 3; }
  grep -q 'long6/정문/제2장_신.md :: ⛔.*반드시 먼저 제1장 추적 트랜잭션을 커밋해야 함' "$tmp/bpy.txt" || { echo "FAIL: state의 last_committed_chapter가 정문보다 뒤떨어져 있을 때 다음 장이 차단되지 않음" >&2; return 3; }
  grep -q 'bare/정문/제1장_시.md :: ⛔' "$tmp/bpy.txt" || { echo "FAIL: 새 책에 대강/추적/설정 스캐폴딩이 없을 때 첫 장 보호 실패 열림" >&2; return 3; }

  # E3: 추적 상태 판정 parity. 누락, 손상된 JSON, 이전 schema, 파생 revision 불일치,
  #     수정 버전 누락, 장 번호 누락, 제출 지연 및 유효 state는 통과시켜 Codex Python과 3개 플랫폼 JS core의 편차를 방지합니다.
  local cp="$tmp/checkpoints"
  mkdir -p "$cp"/{missing,malformed,old,mismatch,norevision,nolast,behind,valid,revised}/tracking
  for name in malformed old mismatch norevision nolast behind valid revised; do
    printf '%s\n' '> 상태 수정: 0' > "$cp/$name/tracking/context.md"
  done
  printf '%s\n' '{not-json' > "$cp/malformed/tracking/_tracking-state.json"
  printf '%s\n' '{"schema_version":3,"state_revision":0,"last_committed_chapter":7}' > "$cp/old/tracking/_tracking-state.json"
  printf '%s\n' '{"schema_version":4,"state_revision":1,"last_committed_chapter":7}' > "$cp/mismatch/추적/_tracking-state.json"
  printf '%s\n' '{"schema_version":4,"last_committed_chapter":7}' > "$cp/norevision/추적/_tracking-state.json"
  printf '%s\n' '{"schema_version":4,"state_revision":0}' > "$cp/nolast/추적/_tracking-state.json"
  printf '%s\n' '{"schema_version":4,"state_revision":0,"last_committed_chapter":6}' > "$cp/behind/추적/_tracking-state.json"
  printf '%s\n' '{"schema_version":4,"state_revision":0,"last_committed_chapter":7}' > "$cp/valid/추적/_tracking-state.json"
  # 재작업/이름 변경/원본 보관: 챕터 번호가 추적 범위 내임(예상 7 < 마지막 9), 파일명은 새로우나 해당 챕터는 이미 제출됨,
  # 순서 검증은 항상 거짓을 반환하므로 통과 허용 필요——그렇지 않으면 workflow-revision의 「원본 보관」 단계가 세 플랫폼에서 강제 차단됨.
  printf '%s\n' '{"schema_version":4,"state_revision":0,"last_committed_chapter":9}' > "$cp/revised/추적/_tracking-state.json"
  python3 - "$CODEX" "$cp" > "$tmp/cpy.txt" <<'PY'
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("ch", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
root = Path(sys.argv[2])
# B/C 섹션과 동일: Windows runner의 python<3.15 텍스트 stdout은 cp1252,
# 중국어가 포함된 issue를 직접 print하면 UnicodeEncodeError 발생, stdout.buffer를 통해 UTF-8로 직접 작성 필요.
for name, expected in [("missing", None), ("malformed", None), ("old", None), ("mismatch", None), ("norevision", None), ("nolast", 7), ("behind", 7), ("valid", 7), ("revised", 7)]:
    issue = m.tracking_checkpoint_issue(root / name, require_state=True, expected_last_committed=expected)
    sys.stdout.buffer.write((f"{name} :: {issue or '-'}" + "\n").encode("utf-8"))
PY
  node - "$CLAUDE_CORE" "$cp" > "$tmp/cjs.txt" <<'JS'
const path = require("node:path")
const core = require(process.argv[2])
const root = process.argv[3]
for (const [name, expected] of [["missing", null], ["malformed", null], ["old", null], ["mismatch", null], ["norevision", null], ["nolast", 7], ["behind", 7], ["valid", 7], ["revised", 7]]) {
  const issue = core.trackingCheckpointIssue(path.join(root, name), true, expected)
  console.log(`${name} :: ${issue || "-"}`)
}
JS
  if ! diff "$tmp/cpy.txt" "$tmp/cjs.txt" >/dev/null; then
    echo "FAIL: 추적 체크포인트 parity 불일치 (codex python vs JS core):" >&2
    diff "$tmp/cpy.txt" "$tmp/cjs.txt" >&2 || true
    return 3
  fi
  grep -q 'missing :: .*_tracking-state.json 누락' "$tmp/cpy.txt" || { echo "FAIL: 누락된 state가 실패 처리되지 않음" >&2; return 3; }
  grep -q 'malformed :: .*파싱 불가' "$tmp/cpy.txt" || { echo "FAIL: 잘못된 JSON이 실패 처리되지 않음" >&2; return 3; }
  grep -q 'old :: .*schema_version=4' "$tmp/cpy.txt" || { echo "FAIL: 이전 schema가 실패 처리되지 않음" >&2; return 3; }
  grep -q 'mismatch :: .*상태 리비전.*mode=revision 트랜잭션 재구성 파생 뷰' "$tmp/cpy.txt" || { echo "FAIL: 파생 revision 불일치가 mode=revision 재구성 작업을 받지 않음" >&2; return 3; }
  grep -q 'norevision :: .*정수 state_revision 누락' "$tmp/cpy.txt" || { echo "FAIL: state_revision 누락으로 실패 처리 안 됨" >&2; return 3; }
  grep -q 'nolast :: .*정수 last_committed_chapter 누락' "$tmp/cpy.txt" || { echo "FAIL: last_committed 누락으로 실패 처리 안 됨" >&2; return 3; }
  grep -q 'behind :: .*7장을 먼저 커밋하고 트랜잭션 추적 필요' "$tmp/cpy.txt" || { echo "FAIL: 뒤처진 장 번호로 실패 처리 안 됨" >&2; return 3; }
  grep -q 'valid :: -' "$tmp/cpy.txt" || { echo "FAIL: 유효한 state가 잘못 차단됨" >&2; return 3; }
  grep -q 'revised :: -' "$tmp/cpy.txt" || { echo "FAIL: 재작업/백업 완료된 장 번호가 잘못 차단됨(workflow-revision 백업 원고가 중단됨)" >&2; return 3; }

  # E4: 연속 쓰기 상태 카드가 예산을 초과할 때 Python/JS 양쪽 끝에서 모두 경고하고, mtime 우발적 트리거에 의존하면 안 됨.
  local hot="$tmp/hot-context"
  mkdir -p "$hot/book/정문" "$hot/book/추적"
  printf '%s\n' '# 제1장 시작' '정문.' > "$hot/book/정문/제001장_시작.md"
  printf '%s\n' '{"schema_version":4,"state_revision":0,"last_committed_chapter":1}' > "$hot/book/추적/_tracking-state.json"
  python3 - "$hot/book/추적/상하문.md" <<'PY'
from pathlib import Path
import sys
Path(sys.argv[1]).write_bytes(("> 상태 수정: 0\n" + "상태" * 7000).encode("utf-8"))
PY
  python3 - "$CODEX" "$hot" > "$tmp/hpy.txt" <<'PY'
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("ch", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
# findings 실행 중 한글 포함; Windows 텍스트 stdout은 cp1252이므로 buffer를 통해 직접 UTF-8 작성해야 함.
for finding in m.continuity_findings(Path(sys.argv[2])):
    sys.stdout.buffer.write((finding + "\n").encode("utf-8"))
PY
  node - "$CLAUDE_CORE" "$hot" > "$tmp/hjs.txt" <<'JS'
const core = require(process.argv[2])
for (const finding of core.continuityFindings(process.argv[3])) console.log(finding)
JS
  if ! diff "$tmp/hpy.txt" "$tmp/hjs.txt" >/dev/null; then
    echo "실패: 핫 컨텍스트 초과 예산 parity 불일치(codex python vs JS core):" >&2
    diff "$tmp/hpy.txt" "$tmp/hjs.txt" >&2 || true
    return 3
  fi
  grep -q '속성 쓰기 상태 카드 예산 12288 바이트 초과' "$tmp/hpy.txt" || { echo "실패: 핫 컨텍스트 초과 예산 경고 없음" >&2; return 3; }
  return 0
}

set +e
run_functional
rc=$?
set -e
case "$rc" in
  0) echo "기능 parity: codex python 웹 == opencode TS 웹 == zcode JS 웹(39개 fixture 글자 단위 일치, 독성 구문 정반대 예제/AI 자기참조/절단 종료 및 면제 표시 포함)." ;;
  2) echo "기능 parity: 건너뜀 (TS 런타임 없음; 규범 문자열 검사는 이미 CI 보안 보증 완료)." ;;
  *) fails=$((fails + 1)) ;;
esac

set +e
run_cmd_parity
rc_cmd=$?
set -e
case "$rc_cmd" in
  0) echo "명령 함수 parity: codex python == zcode JS (31 fixtures: 본문 추출/apply-patch/git commit 감지 문자 단위 동등성, 따옴표 내 연산자/공백/전각 공백 대상, apply_patch 이동 및 문맥 의사 명령, ReDoS 예산)." ;;
  1) echo "명령 함수 parity: 건너뜀 (node/python3 런타임 없음)." ;;
  *) fails=$((fails + 1)) ;;
esac

set +e
run_claude_core_check
rc_claude=$?
set -e
case "$rc_claude" in
  0) echo "Claude 핵심 회귀: 4개 bash hook 내장 python 없음, 모두 story_hook_cli.js를 통해 공유 핵심 호출 (OpenCode/ZCode와 동일 사본, B/C 잠금으로 codex에 고정)." ;;
  *) fails=$((fails + 1)) ;;
esac

# F. Claude bash 본문 가드 ↔ JS core proseBlockReason 동작 parity (CI 강제 보증).
# 대강/세부 차단은 node가 없는 런타임에서도 막아야 하므로 guard-outline-before-prose.sh는 순수 bash로
# 판정합니다. 추적 체크포인트는 JSON을 파싱해야 하므로 story_hook_cli.js를 통해 공유 코어를 호출해야 합니다. 두 경로가 하나의 BLOCKING
# 가드에 섞여 있는데, 이전까지 bash 쪽에 대한 교차 플랫폼 단언 커버리지가 없었습니다. #283에서 다른 세 플랫폼에 추적 게이트를 추가했지만 Claude 쪽은 조용히 놓쳤습니다
# (이슈 #305). 여기서는 「같은 프로젝트 같은 쓰기에서 bash 차단 여부 == JS 코어 차단 여부」를 각 시나리오별로 비교하며
# 어느 한쪽이라도 단독으로 변경되면 빨강색으로 표시됩니다.
run_bash_guard_parity() {
  command -v node >/dev/null 2>&1 || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  local tmp; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN

  # scenario|last_committed|ctx_revision|schema|outline_ch|target_ch|target_exists|split_lib|state
  # state=none일 때 last/ctx/schema는 무의미합니다. target_exists=1이면 계속 작성 경로를 진행합니다(세부 대강은 판단하지 않지만 추적은 여전히 판단).
  local scenarios="
nostate|-|-|-|1|1|0|0|none
nooutline|-|-|-|-|1|0|0|none
importwindow|-|-|-|-|1|0|1|none
importstate|0|0|4|1|3|0|1|yes
valid|0|0|4|1|1|0|0|yes
skipahead|0|0|4|3|3|0|0|yes
existing|1|0|4|1|1|1|0|yes
existing_mismatch|1|9|4|1|1|1|0|yes
badschema|0|0|3|1|1|0|0|yes
revisionbackup|5|0|4|3|3|0|0|yes
"
  local out_bash="$tmp/bash.txt" out_js="$tmp/js.txt"
  : > "$out_bash"; : > "$out_js"

  local line
  while IFS='|' read -r name last ctx schema outline target exists lib state; do
    [ -n "${name:-}" ] || continue
    local proj="$tmp/$name" book="$tmp/$name/책"
    mkdir -p "$book/개요" "$book/본문" "$book/추적"
    [ "$lib" = "1" ] && mkdir -p "$proj/분해문고/책"
    [ "$outline" != "-" ] && printf '# 상세 개요\n' > "$book/개요/상세개요_제00${outline}장.md"
    if [ "$state" = "yes" ]; then
      printf '{"schema_version":%s,"state_revision":0,"last_committed_chapter":%s}\n' "$schema" "$last" \
        > "$book/추적/_tracking-state.json"
      printf '> 상태 수정: %s.\n' "$ctx" > "$book/추적/컨텍스트.md"
    fi
    local abs="$book/본문/제00${target}장_테스트.md"
    [ "$exists" = "1" ] && printf '# 제%s장 테스트\n본문.\n' "$target" > "$abs"

    # bash 측: exit 2 = 차단, 0 = 허용
    local payload code
    payload=$(python3 -c 'import json,sys;print(json.dumps({"tool_input":{"file_path":sys.argv[1]}}))' "$abs")
    ( cd "$proj" && CLAUDE_PROJECT_DIR="$proj" CLAUDE_TOOL_INPUT="$payload" bash "$CLAUDE_GUARD" ) >/dev/null 2>&1
    code=$?
    if [ "$code" = 2 ]; then printf '%s :: block\n' "$name" >> "$out_bash"
    else printf '%s :: pass\n' "$name" >> "$out_bash"; fi

    # JS 핵심부
    node - "$CLAUDE_CORE" "$proj" "$abs" "$name" >> "$out_js" <<'JS'
const core = require(process.argv[2])
const reason = core.proseBlockReason(process.argv[3], process.argv[4])
console.log(`${process.argv[5]} :: ${reason ? "block" : "pass"}`)
JS
  done <<< "$scenarios"

  if ! diff "$out_bash" "$out_js" >/dev/null; then
    echo "FAIL: 본문 가드 parity 불일치(Claude bash guard vs JS core):" >&2
    diff "$out_bash" "$out_js" >&2 || true
    return 3
  fi
  # 정렬만으로는 부족: 양쪽이 동시에 차단 누락해도 diff가 깔끔합니다. 각 시나리오의 예상 방향을 고정하세요.
  local expect="nostate block
nooutline block
importwindow pass
importstate block
valid pass
skipahead block
existing pass
existing_mismatch block
badschema block
revisionbackup pass"
  while read -r want_name want_verdict; do
    [ -n "$want_name" ] || continue
    grep -qx "$want_name :: $want_verdict" "$out_bash" || {
      echo "FAIL: 시나리오 $want_name 예상값 $want_verdict, 실제 결과: $(grep "^$want_name ::" "$out_bash")" >&2
      return 3
    }
  done <<< "$expect"

  # node 부재 시 추적 게이트는 fail-open이어야 합니다(개요 게이트는 순수 bash로만 차단).
  local nonode="$tmp/nonode"; mkdir -p "$nonode"
  local proj="$tmp/nostate" abs="$tmp/nostate/책/본문/제001장_테스트.md"
  local payload; payload=$(python3 -c 'import json,sys;print(json.dumps({"tool_input":{"file_path":sys.argv[1]}}))' "$abs")
  ( cd "$proj" && PATH="$nonode:/usr/bin:/bin" CLAUDE_PROJECT_DIR="$proj" CLAUDE_TOOL_INPUT="$payload" \
      bash "$CLAUDE_GUARD" ) >/dev/null 2>&1
  [ $? -eq 0 ] || { echo "FAIL: node 부재 시 추적 게이트가 fail-open되지 않음(BLOCKING 경로는 node 존재 여부에 의존하면 안 됨)" >&2; return 3; }
  return 0
}

set +e
run_uncored_parity
rc_uncored=$?
set -e
case "$rc_uncored" in
  0) echo "parity 미통과: codex python == JS core(staged warnings 대소문자 변체/문안 + 개요 차단 9개 판정 독성 문구 결함 게이트/스캐폴딩 부재 fail-closed/문안 글자 단위 일치)." ;;
  1) echo "parity 미통과: 건너뜀(node/python3/git 런타임 부재)." ;;
  *) fails=$((fails + 1)) ;;
esac

set +e
run_bash_guard_parity
rc_guard=$?
set -e
case "$rc_guard" in
 0) echo "산문 검증 parity: Claude bash guard == JS core (10개 엔지니어링 시나리오: 상태 없음/세부 계획 부족/import 창 열림/챕터 스킵/계속 작성/파생 수정 불일치/잘못된 schema/재작업 백업, node 미실행 fail-open 포함)." ;;
 1) echo "산문 검증 parity: 스킵됨 (node/python3 런타임 없음)." ;;
  *) fails=$((fails + 1)) ;;
esac

if [ "$fails" -ne 0 ]; then
  echo "Prose net parity tests FAILED ($fails)." >&2
  exit 1
fi
echo "Prose net parity tests passed."
