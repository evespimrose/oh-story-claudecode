#!/bin/bash
# test-degeneration.sh — regression tests for the model-degeneration detector.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "Error: not in a git repository" >&2
  exit 1
fi

SCRIPT="$REPO_ROOT/skills/story-deslop/scripts/check-degeneration.js"
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

POS="$TMP_DIR/degen-positive.md"
NEG="$TMP_DIR/degen-negative.md"
OUT="$TMP_DIR/out.json"

# Positive: 인접 행 전체 반복 + 긴 문장 3회 반복 + AI 자기 참조 + 괄호 생략 자리 표시자 + 끝부분 절단.
cat > "$POS" <<'EOF'
그는 주먹을 꽉 쥐고 천천히 일어섰다. 눈에는 분함이 가득했다.
그는 주먹을 꽉 쥐고 천천히 일어섰다. 눈에는 분함이 가득했다.
그녀는 밤새 내린 창밖의 폭우를 바라보며 마음이 텅 빈 것 같았다.
잠시 후.
그녀는 밤새 내린 창밖의 폭우를 바라보며 마음이 텅 빈 것 같았다.
또 잠시 후.
그녀는 밤새 내린 창밖의 폭우를 바라보며 마음이 텅 빈 것 같았다.
AI 언어 모델로서 이 내용을 계속 생성할 수 없습니다.
(이하 500자 생략)
그는 몸을 돌려 천천히 문 쪽으로 걸어갔다. 손은 여전히
EOF

# Negative: 대중적인 웹 소설 장르 내의 '정상적인 반복'은 보고하지 않아야 함 - 댓글 사과 도배, 짧은 문장 대구, 대화 반복.
cat > "$NEG" <<'EOF'
그는 제자리에 서서 그 메시지를 바라보며 한참 동안 움직이지 않았다.
"죄송합니다."
"죄송합니다."
"죄송합니다."
기다릴게. 기다릴게. 기다릴게.
바람이 너무 세서 눈을 뜰 수가 없었다.
인공지능 시대의 산물로서 그는 고독에 익숙해져 있었다.
"인공지능으로서 항상 곁에 있어 줄게요."
이 순간, 그는 마침내 무엇이 진정한 내려놓음인지 깨달았다.
EOF

set +e
node "$SCRIPT" --json "$POS" > "$OUT"
pos_status=$?
set -e
if [ "$pos_status" -ne 1 ]; then
  echo "FAIL: expected degeneration detector to exit 1 on positive fixture, got $pos_status" >&2
  cat "$OUT" >&2 || true
  exit 1
fi

node - "$OUT" <<'NODE'
const fs = require('fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const counts = report.findings.reduce((m, f) => ((m[f.type] = (m[f.type] || 0) + 1), m), {});
const want = { 'verbatim-repeat': 2, 'placeholder-leak': 2, 'truncated': 1 };
if (report.findings.length !== 5) {
  throw new Error(`expected 5 positive findings, got ${report.findings.length}: ${JSON.stringify(report.findings.map((f) => `${f.type}@${f.line}`))}`);
}
for (const [type, n] of Object.entries(want)) {
  if (counts[type] !== n) throw new Error(`expected ${n} ${type}, got ${counts[type] || 0}`);
}
NODE

# Negative fixture must be clean (exit 0). 대중 웹소설의 대구/반복/단막 스팸은 퇴화가 아닙니다.
set +e
neg_out="$(node "$SCRIPT" "$NEG" 2>&1)"
neg_status=$?
set -e
if [ "$neg_status" -ne 0 ]; then
  echo "FAIL: degeneration detector false-positive on legit 반복/대구/단막 prose (exit $neg_status):" >&2
  echo "$neg_out" >&2
  exit 1
fi

# --- AI 자기 참조 (거절 문구 제외): 위 긍정 예시의 29행은 사실 '생성 거절 문구' 규칙에 의해 감지된 것이며, AI 자기 참조 규칙
#     자체는 이전에 커버리지가 전혀 없었습니다. 모델 접미사가 붙은 가장 전형적인 퇴화 시작 문구 (AI 언어 모델/AI 어시스턴트/인공지능 언어 모델/AI 모델)
#     해당 유형 전체가 미검출되어도 그대로 통과되었습니다. 이 항목은 자기 참조만 남기고 '할 수 없습니다/불가능합니다'는 제외하여, 각 항목을 label에 고정합니다.
AI_SELF="$TMP_DIR/ai-selfref.md"
cat > "$AI_SELF" <<'EOF'
AI 언어 모델로서, 사용자님께 주의를 드립니다.
AI 어시스턴트로서, 이 내용은 민감한 주제를 포함하고 있습니다.
인공지능 언어 모델로서, 최선을 다해 이어 쓰기를 도와드리겠습니다.
AI 모델로서, 이 줄거리는 조정이 필요합니다.
그는 불을 껐다.
EOF
set +e
node "$SCRIPT" --json "$AI_SELF" > "$OUT"
ai_self_status=$?
set -e
if [ "$ai_self_status" -ne 1 ]; then
  echo "FAIL: AI 자기 참조 fixture의 종료 코드는 1이어야 하지만, 실제로는 $ai_self_status입니다" >&2
  cat "$OUT" >&2 || true
  exit 1
fi
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const leaks = r.findings.filter((f) => f.type === 'placeholder-leak');
if (leaks.length !== 4) {
  throw new Error(`expected 4 AI 자기 참조 findings, got ${leaks.length}: ${JSON.stringify(leaks.map((f) => `${f.line}:${f.excerpt}`))}`);
}
if (!leaks.every((f) => f.message.includes('AI 자기 참조'))) {
  throw new Error('반드시 AI 자기 참조 규칙에 의해 감지되어야 합니다 (거절 문구 규칙에 의존해서는 안 됨): ' + JSON.stringify(leaks.map((f) => f.message)));
}
NODE

# --- 엔지니어링 용어 유출 meta-leak (issue #173 comment 4814607240) ---
META_POS="$TMP_DIR/meta-positive.md"
META_NEG="$TMP_DIR/meta-negative.md"

# 긍정 예시: 순수 엔지니어링 용어(상세 개요/플롯 포인트) + 챕터 구조어(이번 장/다음 장, 대화 포함) + 시스템 태그어(작업 설명).
cat > "$META_POS" <<'EOF'
## 제5장 진실
그는 주먹을 꽉 쥐고 천천히 일어났다.
이번 장에서 그는 마침내 진실을 발견했다.
"다음 장으로 넘어갈 때군." 그가 낮게 읊조렸다.
시놉시스에 따르면, 그는 먼저 그녀를 찾아가야 했다.
이 복선은 사실 진작에 깔아둔 것이었다.
미션 설명: 그 소녀를 잘 보호할 것.
EOF
set +e
node "$SCRIPT" --json "$META_POS" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const meta = report.findings.filter((f) => f.type === 'meta-leak');
if (meta.length !== 5) {
  throw new Error(`expected 5 meta-leak findings (이번 장/다음 장/시놉시스/복선/미션 설명), got ${meta.length}: ${JSON.stringify(meta.map((f) => f.excerpt))}`);
}
NODE

# 부정 사례: 제목 행 '제N장 장 제목'(## 접두사 없음)은 설정 용어 유출로 간주하지 않아야 함. 일반 본문은 검색 결과 0건이어야 함.
cat > "$META_NEG" <<'EOF'
제1장 군 홍보의 샛별
그는 단상에 서서 아래의 새카맣게 모여든 군중을 바라보았다.
바람이 거세게 불어 깃발이 펄럭이는 소리가 요란했다.
그는 마이크를 꽉 쥐고 깊게 숨을 들이마셨다.
EOF
set +e
meta_neg_out="$(node "$SCRIPT" "$META_NEG" 2>&1)"
meta_neg_status=$?
set -e
if [ "$meta_neg_status" -ne 0 ]; then
  echo "FAIL: meta-leak false-positive on chapter title line / clean prose (exit $meta_neg_status):" >&2
  echo "$meta_neg_out" >&2
  exit 1
fi

# --- 따옴표 행 전체 제외 회귀 테스트: 혼합 행(서술 + 따옴표 내 내용)의 반복은 따옴표 행 전체 제외 규칙으로 건너뛸 수 없음 ---
MIX="$TMP_DIR/mix-repeat.md"
cat > "$MIX" <<'EOF'
그는 쪽지를 펼쳤다. 거기에는 "귀환"이라고 적혀 있었다. 그녀는 밤새 내리는 창밖의 폭우를 바라보며 마음이 텅 빈 것 같았다.
그는 쪽지를 펼쳤다. 거기에는 "귀환"이라고 적혀 있었다. 그녀는 밤새 내리는 창밖의 폭우를 바라보며 마음이 텅 빈 것 같았다.
그는 쪽지를 펼쳤다. 거기에는 "귀환"이라고 적혀 있었다. 그녀는 밤새 내리는 창밖의 폭우를 바라보며 마음이 텅 빈 것 같았다.
EOF
set +e
node "$SCRIPT" --json "$MIX" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rep = r.findings.filter((f) => f.type === 'verbatim-repeat');
if (rep.length === 0) throw new Error('따옴표 행 전체 제외 회귀 테스트: 혼합 행 반복이 검출되지 않음');
if (!rep.every((f) => f.severity === 'blocking')) throw new Error('verbatim-repeat의 severity는 blocking이어야 함');
NODE

# 순수 대사 반복은 여전히 제외(문체적 기법): 동일한 대사 세 줄은 보고하지 않음.
PURE_DLG="$TMP_DIR/pure-dialogue.md"
cat > "$PURE_DLG" <<'EOF'
"난 안 가."
"난 안 가."
"난 안 가."
EOF
set +e
pure_dlg_out="$(node "$SCRIPT" "$PURE_DLG" 2>&1)"
pure_dlg_status=$?
set -e
if [ "$pure_dlg_status" -ne 0 ]; then
  echo "FAIL: 순수 대사 중복이 반복으로 오판됨 (exit $pure_dlg_status):" >&2
  echo "$pure_dlg_out" >&2
  exit 1
fi

# --- severity 필드 + --fail-on 의미: advisory(tier2)만 있을 때 기본 종료 코드 1, --fail-on=blocking 시 0 ---
ADV="$TMP_DIR/advisory-only.md"
cat > "$ADV" <<'EOF'
그는 그 기록을 훑어보며 이 장 이전에 일어난 일을 떠올렸다. 그 복선은 지금까지 아무도 언급하지 않았다.
EOF
set +e
node "$SCRIPT" --json "$ADV" > "$OUT"
adv_all_status=$?
node "$SCRIPT" --fail-on=blocking "$ADV" >/dev/null 2>&1
adv_blocking_status=$?
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (r.findings.length === 0) throw new Error('expected tier2 advisory finding');
if (!r.findings.every((f) => f.severity === 'advisory')) {
  throw new Error('tier2-only fixture는 모두 advisory여야 합니다: ' + JSON.stringify(r.findings.map((f) => f.severity)));
}
NODE
if [ "$adv_all_status" -ne 1 ]; then
  echo "FAIL: advisory-only 기본 --fail-on=all은 1로 종료되어야 하나, 실제로는 $adv_all_status" >&2
  exit 1
fi
if [ "$adv_blocking_status" -ne 0 ]; then
  echo "FAIL: advisory-only --fail-on=blocking은 0으로 종료되어야 하나, 실제로는 $adv_blocking_status" >&2
  exit 1
fi

# --- tier1 프로젝트 단어: 서술행은 blocking, 대사행(작가/시나리오 소재의 정상적인 대사)은 advisory로 강등 ---
TIER1="$TMP_DIR/tier1-dialogue.md"
cat > "$TIER1" <<'EOF'
“오늘의 글자 수 목표는 6,000자다.” 그는 화면을 응시하며 연신 담배를 피워 댔다.
글자 수 목표에 따르면, 그는 아직 6,000자를 더 써야 했다.
EOF
set +e
node "$SCRIPT" --json "$TIER1" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const meta = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).findings.filter((f) => f.type === 'meta-leak');
const dlg = meta.find((f) => f.line === 1);
const nar = meta.find((f) => f.line === 2);
if (!dlg || dlg.severity !== 'advisory') throw new Error('tier1은 대사행에서 advisory여야 합니다: ' + JSON.stringify(dlg));
if (!nar || nar.severity !== 'blocking') throw new Error('tier1은 서술행에서 blocking이어야 합니다: ' + JSON.stringify(nar));
NODE

# --- wiring: check-degeneration.js 복사본을 포함한 skill은 반드시 SKILL.md 워크플로에서 이를 실제로 호출해야 함 ---
for skill_js in $(find "$REPO_ROOT/skills" -name check-degeneration.js); do
  skill_md="$(dirname "$(dirname "$skill_js")")/SKILL.md"
  if [ -f "$skill_md" ] && ! grep -q 'check-degeneration.js' "$skill_md"; then
    echo "FAIL: $skill_md에 check-degeneration.js 복사본이 포함되어 있으나 워크플로에서 호출되지 않음" >&2
    exit 1
  fi
done

echo "Degeneration detector regression tests passed."
