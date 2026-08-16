#!/bin/bash
# test-ai-patterns.sh — regression tests for the deterministic AI-pattern detector.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "Error: not in a git repository" >&2
  exit 1
fi

SCRIPT="$REPO_ROOT/skills/story-deslop/scripts/check-ai-patterns.js"
DETECTOR_COPIES=(
  "$REPO_ROOT/skills/story-deslop/scripts/check-ai-patterns.js"
  "$REPO_ROOT/skills/story-long-write/scripts/check-ai-patterns.js"
  "$REPO_ROOT/skills/story-review/scripts/check-ai-patterns.js"
  "$REPO_ROOT/skills/story-short-write/scripts/check-ai-patterns.js"
)
for detector_copy in "${DETECTOR_COPIES[@]}"; do
  node --check "$detector_copy" >/dev/null
  cmp -s "$SCRIPT" "$detector_copy" || {
    echo "FAIL: detector copy drifted from story-deslop source: $detector_copy" >&2
    exit 1
  }
done
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

FIXTURE="$TMP_DIR/fixture.md"
OUT="$TMP_DIR/out.json"

cat > "$FIXTURE" <<'EOF'
---
title: A가 아니라 B이다
---
혹시 여기서는 보고하면 안 되는 건가?
그는 무관심한 것이 아니라 절망한 것이다.
그녀는 두려워하는 것이 아니라 지친 것이다.
그는 멍청한 것이 아니라 너무 급한 것이다.
그는 무관심한 것이 아니라 절망하고 있는 것이다.
이것은 평범한 죽이 아니다!
약이다.
그녀는 가고 싶지 않아서가 아니라, 감히 가지 못해서도 아니다.
그는 너를 싫어하는 것이 아니라 지쳐 있을 뿐이다.
그가 떠난 게 아니라 다만 아무도 눈치채지 못했을 뿐이다.
그가 싫어하는 게 아니라 그래서 동의했다.
그녀가 화난 게 아니라 오히려 좀 걱정했다.
그가 우는 것도 아니고 떼를 쓰는 것도 아니다.
이 일은 참인 것도 아니고 거짓인 것도 아니다.
이건 당신 것이 아니잖아요?
그는 바보가 아니잖아요?
그는 바보가 아니죠.
그렇지 않아요.
그는 처음 온 게 아니에요.

그래, 그는 여전히 현관의 그 불빛을 기억하고 있었다.
그가 듣지 못한 게 아니었다. 맞아, 그냥 뒤돌아보지 않았을 뿐이었다.
그가 응하고 싶지 않은 게 아니었다. 그래, 말이 입까지 올라왔다가 다시 삼켜버렸을 뿐이었다.
```
그는 냉담한 게 아니라 절망해 있었다.
```
~~~md
그것은 일반적인 표현이 아니라 코드 예제이다.
~~~
EOF

set +e
node "$SCRIPT" --json "$FIXTURE" > "$OUT"
status=$?
set -e

if [ "$status" -ne 1 ]; then
  echo "FAIL: expected detector to exit 1 for positive findings, got $status" >&2
  cat "$OUT" >&2 || true
  exit 1
fi

node - "$OUT" <<'NODE'
const fs = require('fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const excerpts = report.findings.map((finding) => finding.excerpt);

// Genuine flips that MUST be detected: ~에 불과하지 않고 / "，는" / compact / "；는" / hard-stop + 는.
const expected = [
  '냉담함이 아니라 절망이다',
  '두려움이 아니라 지쳤다',
  '어리석음이 아니라 너무 급하다',
  '냉담함이 아니라; 절망이다',
  '평범한 죽이 아니야! 약이야',
];

// 반드시 플래그되지 않을 자연 문장: 구분자 후의 연결사 끝 是는 긍정 서술어가 아님 (문제 #166 거짓 양성)
// (只是/可是/于是/倒是…) after a separator is not a positive copula (issue #166
// false-positive class). "是不是"/"也不是" 이중 부정도 침묵 상태를 유지해야 함.
const forbidden = [
  '그냥 피곤해',
  '하지만 아무도 발견하지 못했어',
  '그래서 동의했어',
  '오히려 좀 걱정돼',
  // either-or「A가 아니면 B / 둘 다 B」와 문장 끝의 반문「…, 맞죠 / 그치 / 맞아」는 부정 후 반전이 아닙니다.
  '울기만 해도 돼',
  '정말 그래요',
  '그래요',
  '그렇지',
  '그런가요',
  '네, 맞아요',
  '네',
  '맞아요',
];

if (report.findings.length !== expected.length) {
  throw new Error(`expected ${expected.length} findings, got ${report.findings.length}: ${JSON.stringify(excerpts)}`);
}

for (const excerpt of expected) {
  if (!excerpts.includes(excerpt)) {
    throw new Error(`missing expected excerpt: ${excerpt}; got ${JSON.stringify(excerpts)}`);
  }
}

for (const marker of forbidden) {
  if (excerpts.some((excerpt) => excerpt.includes(marker))) {
    throw new Error(`false positive: conjunction "${marker}" was flagged; got ${JSON.stringify(excerpts)}`);
  }
}
NODE

echo "AI pattern detector regression tests passed."

# --- 단락 수준 감지: 짧은 문장 / 긴 단락 / 대시(issue #188) ---
FIXTURE2="$TMP_DIR/fixture-prose.md"
LONG_PARA="그는 긴 복도를 따라 안쪽으로 계속 걸어갔고,"
i=0
while [ "$i" -lt 16 ]; do
  LONG_PARA="${LONG_PARA}단단히 닫혀 있는 나무 문들을 지나갔다,"
  i=$((i + 1))
done
LONG_PARA="${LONG_PARA}마침내 끝에서 멈추어 그 어두운 빨간색을 오래 바라보았다."
{
  # 6개의 연속된 짧은 서술문 → 파편화된 문장 표시
  printf '%s\n' '그는 일어났다.' '그는 걸어갔다.' '문이 열렸다.' '바람이 들어왔다.' '그는 멈추었다.' '마음이 철렁했다.'
  # 6개의 대사 짧은 문장 → 파편화된 문장을 보고해서는 안 됨(연속된 짧은 문장은 대사/댓글의 정상적인 형태)
  printf '%s\n' '"이건 정말 문제없어."' '"조금도 어렵지 않아."' '"난 믿어."' '"긴장하지 마."' '"알겠어."' '"응."'
  # 파단 → em-dash (기능에 따라 재작성, 기계적 대체 금지)
  printf '%s\n' '그녀는 달빛을 이용해 책상 위 그 종이의 모서리를 명확히 봤다—그것은 낡은 종이였다.'
  # 단일 문단 초장문 → long-paragraph
  printf '%s\n' "$LONG_PARA"
} > "$FIXTURE2"

set +e
node "$SCRIPT" --json "$FIXTURE2" > "$OUT"
status=$?
set -e
if [ "$status" -ne 1 ]; then
  echo "FAIL: expected prose detector to exit 1 for positive findings, got $status" >&2
  cat "$OUT" >&2 || true
  exit 1
fi

node - "$OUT" <<'NODE'
const fs = require('fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const counts = report.findings.reduce((m, f) => ((m[f.type] = (m[f.type] || 0) + 1), m), {});

// Exactly one of each new prose type, nothing else. The 6 dialogue lines must NOT
// 碎句号 연속 (연속된 짧은 문장은 대화/채팅의 정상적인 형태 — 서사 문맥만 계산).
if (report.findings.length !== 3) {
  throw new Error(`expected 3 prose findings, got ${report.findings.length}: ${JSON.stringify(report.findings.map((f) => `${f.type}@${f.line}`))}`);
}
for (const type of ['period-stutter', 'em-dash', 'long-paragraph']) {
  if (counts[type] !== 1) throw new Error(`expected exactly 1 ${type}, got ${counts[type] || 0}`);
}
// 碎句号는 반드시 서사 블록(1행)에 플래그를 지정하고, 대사 클러스터(7-12행)에는 지정하면 안 됩니다.
const stutter = report.findings.find((f) => f.type === 'period-stutter');
if (stutter.line !== 1) {
  throw new Error(`period-stutter should start at the narrative block (line 1), got line ${stutter.line}`);
}
NODE

# --- MEDIUM-1: 문장 부호 혼합 줄(서술 + 인용부호 내 객체)은 하나의 인용부호로 전체 줄을 면제할 수 없음(#188 review) ---
FIXTURE3="$TMP_DIR/fixture-mixed-quote.md"
printf '%s\n' '그가 일어섰다. 그는 "문"을 보았다. 바람이 들어왔다. 그는 뒤를 돌았다. 불이 꺼졌다. 가슴이 철렁했다.' > "$FIXTURE3"
set +e
node "$SCRIPT" --json "$FIXTURE3" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const st = r.findings.filter((f) => f.type === 'period-stutter');
if (st.length !== 1) throw new Error('혼합 인용부호 서술이 문장 부호 stuttering을 감지해야 함: ' + JSON.stringify(r.findings.map((f) => f.type)));
if (st[0].severity !== 'advisory') throw new Error('period-stutter는 advisory여야 함');
NODE

# 순수 대사 연속 짧은 문장은 여전히 면제됨(문체 기법).
FIXTURE4="$TMP_DIR/fixture-pure-dialogue.md"
printf '%s\n' '"가자."' '"빨리."' '"뛰어."' '"멈춰."' '"봐."' '"들어."' > "$FIXTURE4"
set +e
pure_out="$(node "$SCRIPT" "$FIXTURE4" 2>&1)"
pure_status=$?
set -e
if [ "$pure_status" -ne 0 ]; then
  echo "FAIL: 순수 대화 짧은 문장이 단편 문장 부호로 오인됨 (exit $pure_status):" >&2
  echo "$pure_out" >&2
  exit 1
fi

# --- markdown 구조 라인은 긴 문단으로 계산되지 않음 (#188 review 새로운 발견) ---
FIXTURE5="$TMP_DIR/fixture-heading.md"
node -e 'process.stdout.write("## " + "긴".repeat(230) + "\n")' > "$FIXTURE5"
set +e
head_out="$(node "$SCRIPT" "$FIXTURE5" 2>&1)"
head_status=$?
set -e
if [ "$head_status" -ne 0 ]; then
  echo "FAIL: markdown 제목이 long-paragraph로 오인됨 (exit $head_status):" >&2
  echo "$head_out" >&2
  exit 1
fi

# --- severity 필드 + --fail-on 의미: advisory(long-paragraph)만 있을 때 기본값으로 종료 코드 1, blocking 모드는 종료 코드 0 ---
FIXTURE6="$TMP_DIR/fixture-advisory.md"
node -e 'process.stdout.write("그는 긴 복도를 따라 계속 안쪽으로 걸어갔고, " + "닫힌 나무 문을 하나씩 통과하며 ".repeat(16) + "결국 끝에서 멈춰 섰다.\n")' > "$FIXTURE6"
set +e
node "$SCRIPT" --json "$FIXTURE6" > "$OUT"
adv_all=$?
node "$SCRIPT" --fail-on=blocking "$FIXTURE6" >/dev/null 2>&1
adv_blk=$?
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!r.findings.length) throw new Error('expected long-paragraph finding');
if (!r.findings.every((f) => f.severity === 'advisory')) {
  throw new Error('long-paragraph-only fixture는 모두 advisory여야 함: ' + JSON.stringify(r.findings.map((f) => f.severity)));
}
NODE
[ "$adv_all" -eq 1 ] || { echo "FAIL: advisory만 있을 때 기본 --fail-on=all은 종료 코드 1이어야 하는데 실제 $adv_all" >&2; exit 1; }
[ "$adv_blk" -eq 0 ] || { echo "FAIL: advisory만 있을 때 --fail-on=blocking은 종료 코드 0이어야 하는데 실제 $adv_blk" >&2; exit 1; }

# blocking（em-dash）：severity=blocking，--fail-on=blocking 종료 코드 1。
FIXTURE7="$TMP_DIR/fixture-blocking.md"
printf '%s\n' '그녀가 멈췄다——아무 말도 하지 않았다.' > "$FIXTURE7"
set +e
node "$SCRIPT" --json "$FIXTURE7" > "$OUT"
node "$SCRIPT" --fail-on=blocking "$FIXTURE7" >/dev/null 2>&1
blk_blk=$?
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const dash = r.findings.find((f) => f.type === 'em-dash');
if (!dash || dash.severity !== 'blocking') throw new Error('em-dash는 blocking이어야 함: ' + JSON.stringify(dash));
NODE
[ "$blk_blk" -eq 1 ] || { echo "FAIL: em-dash --fail-on=blocking 종료 코드가 1이어야 하는데 $blk_blk임" >&2; exit 1; }

echo "산문 패턴(碎句号/긴 단락/파시) 회귀 테스트 통과."

# --- issue #205: 빈 줄을 사이에 두고 있는「A가 아니다./（빈 줄）/B이다」드러내는 문장은 반드시 매칭되어야 함（구 skipGap은 개행문자 하나만 건너뛰어서 누락될 수 있음）---
FIXTURE8="$TMP_DIR/fixture-cross-para.md"
printf '%s\n' '중년 남자가 사라졌다.' '' '끌려가지 않았다.' '' '마치 지우개로 문질러진 것처럼 통째로 없어졌다.' > "$FIXTURE8"
set +e
node "$SCRIPT" --json "$FIXTURE8" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ni = r.findings.filter((f) => f.type === 'not-is-comparison');
if (ni.length !== 1) throw new Error('빈 줄을 사이에 둔 A가 아니다./B이다는 1개의 not-is와 매칭되어야 함: ' + JSON.stringify(r.findings.map((f) => `${f.type}@${f.line}`)));
if (ni[0].line !== 3) throw new Error('not-is는「아니다」가 있는 3번 줄에 위치해야 하는데 실제 ' + ni[0].line);
if (ni[0].severity !== 'blocking') throw new Error('not-is는 blocking이어야 함');
NODE

# 인용부호 내 대사 「A가 아니라 B다」는 구어체 반박이므로, 서술층 AI 대비 문장식(세미콜론과 일관되게 인용부호 내용 제외)으로 간주하지 않습니다.
FIXTURE9="$TMP_DIR/fixture-dialogue-notis.md"
printf '%s\n' '"당신들 봤잖아요, 제가 말썽을 부리는 게 아니라 관리사무소가 불법으로 신체의 자유를 제한하고 있어요."' > "$FIXTURE9"
set +e
dlg_out="$(node "$SCRIPT" "$FIXTURE9" 2>&1)"
dlg_status=$?
set -e
if [ "$dlg_status" -ne 0 ]; then
  echo "FAIL: 인용부호 내 대사 A가 아니라 B다가 오탐지됨 not-is (exit $dlg_status):" >&2
  echo "$dlg_out" >&2
  exit 1
fi

# 인용부호 밖의 서술에 있는 역전 문장은 여전히 반드시 적중해야 합니다(제외 대상은 인용부호 내만 해당, 전체 줄의 서술을 빠뜨리지 마세요).
FIXTURE10="$TMP_DIR/fixture-narration-notis.md"
printf '%s\n' '그는 냉소적으로 웃음을 터뜨렸다. 이것은 우연이 아니라 누군가 계획한 것이다.' > "$FIXTURE10"
set +e
node "$SCRIPT" --json "$FIXTURE10" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ni = r.findings.filter((f) => f.type === 'not-is-comparison');
if (ni.length !== 1) throw new Error('따옴표 외부 서술 반전 문장은 1개의 not-is를 정확히 찾아야 합니다: ' + JSON.stringify(r.findings.map((f) => f.type)));
NODE

# 따옴표가 쌍을 이루지 않는 경우(여러 대사에서 마지막 부분에만 따옴표가 있거나 전각·반각이 섞여 누락되는 경우) not-is 전체를 무음 처리하면 안 됩니다:
# 따옴표 조각은 줄 단위로 종료되며, 닫히지 않은 개시 따옴표는 현재 줄의 나머지 부분만 처리하고, 이후 줄의 서술은 정상적으로 스캔에 참여합니다.
FIXTURE_UNCLOSED_QUOTE="$TMP_DIR/fixture-unclosed-quote-notis.md"
printf '%s\n' \
  '그녀가 드디어 입을 열었다: "더 이상 이 일을 꺼내고 싶지 않아.' \
  '그는 말을 받지 않았다.' \
  '그는 이해하지 못한 것이 아니라 설명하기 귀찮았다.' \
  '그녀가 고개를 숙였다. "그만두자."' > "$FIXTURE_UNCLOSED_QUOTE"
set +e
node "$SCRIPT" --json "$FIXTURE_UNCLOSED_QUOTE" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ni = r.findings.filter((f) => f.type === 'not-is-comparison');
if (ni.length !== 1) throw new Error('미폐쇄 인용문 뒤의 서술 반전 문장은 1개의 not-is를 포함해야 합니다: ' + JSON.stringify(r.findings.map((f) => `${f.type}@${f.line}`)));
if (ni[0].line !== 3) throw new Error('not-is는 「아니다」가 있는 3행에 위치해야 하는데, 실제는 ' + ni[0].line);
NODE

echo "issue #205 (공행 건너뛴 반전 명중 / 인용문 내 대사 면제 / 미폐쇄 인용문이 서술을 삼키지 않음) 회귀 테스트 통과."

# --- issue #205: 미세 동작 반복(「了下/了一下」식 경량 보어 고밀도=텔레그래프체 지문) ---
FIXTURE11="$TMP_DIR/fixture-micro-tic.md"
printf '%s\n' \
  '아버지의 손이 잠깐 멈췄다. 줄이 철환 위에서 반 바퀴 풀렸다.' \
  '그는 줄을 팽팽하게 당기고 줄기 위에 자국을 내었다.' \
  '그는 두 번 쳤고, 손등에 잎이 묻었다.' \
  '어머니가 한참 자르다가 멈췄다. 냄비 뚝배기가 냄비 밑바닥을 긁었다.' \
  '그가 실을 감았다가, 또 돌을 움켜쥐었다.' > "$FIXTURE11"
set +e
node "$SCRIPT" --json "$FIXTURE11" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mt = r.findings.filter((f) => f.type === 'micro-action-tic');
if (mt.length !== 1) throw new Error('고밀도 「了下/了一下」는 1곳의 micro-action-tic을 보고해야 합니다: ' + JSON.stringify(r.findings.map((f) => f.type)));
if (mt[0].severity !== 'advisory') throw new Error('micro-action-tic은 advisory여야 합니다');
NODE

# advisory는 --fail-on=blocking을 트리거하지 않습니다(미동작 반복은 안내이며, 마무리 프로세스를 차단하지 않습니다).
set +e
node "$SCRIPT" --fail-on=blocking "$FIXTURE11" > /dev/null 2>&1
tic_blk=$?
set -e
[ "$tic_blk" -eq 0 ] || { echo "FAIL: micro-action-tic --fail-on=blocking은 0으로 종료되어야 하는데, 실제값 $tic_blk" >&2; exit 1; }

# 낮은 빈도(정상적인 중국어에서 가끔 하나의 「了一下/了一眼」)는 보고하지 않음; 인용부호 내 대사의 「了下/了一下」는 계산하지 않음.
FIXTURE12="$TMP_DIR/fixture-micro-tic-normal.md"
printf '%s\n' \
  '그가 집에 돌아왔을 때, 아버지는 정원에서 수레에 묶을 줄을 매고 있었고, 수레 위에는 방금 꺾어낸 옥수수 대가 몇 다발 쌓여 있었다.' \
  '그는 베이징에 가서 관측소 일을 얘기하겠다고 했고, 아버지의 손이 잠깐 멈췄다가 다시 줄을 팽팽하게 당겼고, 답하지 않았다.' \
  '"잠깐만, 닭장 문 수리를 끝내면 오후도 지나갈 거야."아버지는 닭장 옆에 쭈그리고 앉아 고개를 들지 않았다.' \
  '저녁에 짐을 정리할 때, 그는 끊어진 개울에서 주워온 그 돌멩이를 흘끗 봤고, 외투 주머니에 넣었다.' \
  '어머니가 부엌에서 채소를 자르고 있었는데, 칼이 도마 위에 떨어지는 소리가 평소보다 훨씬 빨랐고, 그는 현관에 서서 한참을 듣다가 안으로 들어갔다.' > "$FIXTURE12"
set +e
node "$SCRIPT" --json "$FIXTURE12" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mt = r.findings.filter((f) => f.type === 'micro-action-tic');
if (mt.length !== 0) throw new Error('낮은 밀도/따옴표 내「했다/했다 한순간」는 micro-action-tic을 보고하면 안 됨: ' + JSON.stringify(mt));
NODE

# issue #205 세 가지: 「한/두」를 생략한 짧은 꼬리(했다/봤다/했다 소리)도 전보체 역방향 지문임;
# PR 문서는 스크립트가 잡아낼 수 없고, 반복 재사용 후에는 기계적으로 보일 대체 템플릿을 권장할 수 없음.
FIXTURE13="$TMP_DIR/fixture-micro-tic-short-tail.md"
printf '%s\n' \
  '그는 입꼬리를 내려당겼고, 그 말을 받지 않았다. 어머니가 그릇을 밀어주었고, 그는 봤다가 다시 옮겼다.' \
  '원문이 울렸고, 아버지는 멈췄으며, 손에 들린 줄이 한 바퀴 감겼고, 줄기를 다시 눌렀다.' \
  '그녀가 책상 위의 봉투를 한눈 훑었고, 웃음이 나왔으며, 손가락 끝이 편지 종이 가장자리에서 멈췄다.' \
  '방 안이 조용해졌고, 냄비 뚜껑이 떨렸으며, 수증기가 벽을 타고 천천히 올라갔다.' > "$FIXTURE13"
set +e
node "$SCRIPT" --json "$FIXTURE13" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mt = r.findings.filter((f) => f.type === 'micro-action-tic');
if (mt.length !== 1) throw new Error('생략된 양사 「了下/了眼/了声」의 고밀도도 micro-action-tic으로 보고해야 합니다: ' + JSON.stringify(r.findings));
if (!mt[0].excerpt.includes('了下') || !mt[0].excerpt.includes('了眼')) {
  throw new Error('micro-action-tic excerpt에는 짧은 꼬리 샘플이 포함되어야 합니다: ' + JSON.stringify(mt[0]));
}
NODE

echo "micro-action-tic (텔레그래프 형식 미동작 반복) regression tests passed."

# --- issue #205: 추상 요약 반복 (운명/체스판/이 순간 드디어 깨달았다/방금 시작됐다) ---
# 후미에 16줄의 중립적 서술 추가: "방금 시작됐다"를 trailer-ending의 문말 600자 윈도우 밖으로 밀어냄.
# 본 fixture를 advisory만 검증하는 abstract-summary-tic으로 유지.
FIXTURE14="$TMP_DIR/fixture-abstract-summary.md"
printf '%s\n' \
  '이 순간부터 모든 준비가 무대 위로 나선다.' \
  '운명은 이미 짜인 바둑판처럼 그를 그 문 앞으로 밀어낸다.' \
  '그는 전례 없는 결의를 드러낸다.' \
  '그에게 속한 반격이 이제 막 시작된다.' > "$FIXTURE14"
for _ in $(seq 1 16); do
  printf '%s\n' '마당의 불이 여전히 켜져 있고, 어머니가 말린 이불을 안고 방으로 들어간다. 그는 문간에서 대나무 장대를 거두는 것을 도와주고, 다시 물독의 뚜껑을 닫는다.' >> "$FIXTURE14"
done
set +e
node "$SCRIPT" --json "$FIXTURE14" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ast = r.findings.filter((f) => f.type === 'abstract-summary-tic');
if (ast.length !== 1) throw new Error('고밀도 추상 요약은 1개의 abstract-summary-tic을 보고해야 함: ' + JSON.stringify(r.findings));
if (ast[0].severity !== 'advisory') throw new Error('abstract-summary-tic의 심각도는 advisory여야 함');
if (!ast[0].excerpt.includes('从这一刻开始') || !ast[0].excerpt.includes('才刚刚开始')) {
  throw new Error('abstract-summary-tic excerpt는 요약 샘플을 포함해야 함: ' + JSON.stringify(ast[0]));
}
NODE

# advisory는 --fail-on=blocking을 트리거하지 않음; 저밀도 주제어와 인용부호 내 대사/인용은 보고되지 않음.
set +e
node "$SCRIPT" --fail-on=blocking "$FIXTURE14" > /dev/null 2>&1
ast_blk=$?
set -e
[ "$ast_blk" -eq 0 ] || { echo "FAIL: abstract-summary-tic --fail-on=blocking은 0으로 종료되어야 하는데, 실제값은 $ast_blk" >&2; exit 1; }

FIXTURE15="$TMP_DIR/fixture-abstract-summary-normal.md"
printf '%s\n' \
  '그녀가 오래된 바둑판을 찬장에서 꺼냈는데, 바둑돌이 두 개가 없어서 단추로 대신했다.' \
  '아버지가 말했다: "이 순간부터 넌 스스로 장부를 기록해야 한다." 그녀가 고개를 끄덕이고 장부를 빈 페이지로 넘겼다.' \
  '집 밖의 비는 멈췄지만, 처마에서는 물이 계속 떨어지고 있었다. 그녀는 먼저 습기가 찬 종이를 창가로 가져가 펼쳤다.' > "$FIXTURE15"
set +e
node "$SCRIPT" --json "$FIXTURE15" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ast = r.findings.filter((f) => f.type === 'abstract-summary-tic');
if (ast.length !== 0) throw new Error('저밀도/인용부호 내 추상 요약 단어는 abstract-summary-tic을 보고해서는 안 됨: ' + JSON.stringify(ast));
NODE

echo "abstract-summary-tic (추상 요약 반복) regression tests passed."


# --- prompt-corpus: 모니터링 카메라식 동작 목록 (토마토 고득점 샘플에서는 이 분포가 0이므로 advisory 알림으로) ---
FIXTURE_ACTION_LIST="$TMP_DIR/fixture-action-list.md"
printf '%s\n' \
  '그녀가 손을 뻗어 탁자 위의 컵을 집어들었고, 옆의 약병을 가져가서 병뚜껑을 열었으며, 약 두 알을 따라 물컵을 들고 고개를 젖혀 삼킨 다음 컵을 내려놓고 의자를 밀어낸 후 몸을 돌려 문 입구로 걸어갔다.' > "$FIXTURE_ACTION_LIST"
set +e
node "$SCRIPT" --json "$FIXTURE_ACTION_LIST" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const al = r.findings.filter((f) => f.type === 'action-list-tic');
if (al.length !== 1) throw new Error('연속 일반 동작 목록은 1개의 action-list-tic을 보고해야 합니다: ' + JSON.stringify(r.findings));
if (al[0].severity !== 'advisory') throw new Error('action-list-tic은 advisory여야 합니다');
if (!al[0].message.includes('모니터링 카메라식 동작 목록')) throw new Error('action-list-tic 메시지는 동작 목록 문제를 설명해야 함: ' + JSON.stringify(al[0]));
NODE

set +e
node "$SCRIPT" --fail-on=blocking "$FIXTURE_ACTION_LIST" > /dev/null 2>&1
action_list_blk=$?
set -e
[ "$action_list_blk" -eq 0 ] || { echo "FAIL: action-list-tic --fail-on=blocking은 0으로 종료되어야 하는데 실제로 $action_list_blk" >&2; exit 1; }

FIXTURE_ACTION_LIST_NORMAL="$TMP_DIR/fixture-action-list-normal.md"
printf '%s\n' \
  '그녀가 약병을 손에 움켜쥐고 있었다. 문 밖에서 다시 한 번 이름을 외쳤고, 의자 다리가 타일 위를 끌리며 귀에 거슬리는 소리를 냈다.' \
  '그녀가 일어서더니 다시 앉았고, 한참 만에 물잔을 밀어냈다.' > "$FIXTURE_ACTION_LIST_NORMAL"
set +e
node "$SCRIPT" --json "$FIXTURE_ACTION_LIST_NORMAL" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const al = r.findings.filter((f) => f.type === 'action-list-tic');
if (al.length !== 0) throw new Error('심리적/환경 완충이 있는 동작 구간은 action-list-tic를 보고하면 안 됨: ' + JSON.stringify(al));
NODE

echo "action-list-tic (모니터링 카메라식 동작 목록) regression tests passed."

# --- issue #205: 반복 밀도 과다 (고위험 반복 표현 집중, 구체적 개선 방향) ---
FIXTURE16="$TMP_DIR/fixture-cliche-density.md"
printf '%s\n' \
  '밤이 조용히 도시를 감싸고, 멀리서 네온사인이 희미하게 깜빡인다.' \
  '린체의 마음속에 말로 표현할 수 없는 정서가 일렁이고, 마치 어떤 전조가 천천히 다가오고 있는 듯하다.' \
  '수완의 눈에 복잡한 빛이 스쳐 지나가고, 입꼬리에 희미한 미소가 떠오른다.' \
  '그녀의 말투는 의심의 여지가 없었고, 목소리에는 감지하기 어려운 냉기가 스며 있었다.' \
  '린저는 깊게 숨을 쉬고 담담하게 입을 열었으며, 말투는 고요하고 파동이 없었다.' \
  '수완의 손가락 관절이 창백해졌고, 눈빛은 날카로웠으며, 침묵이 두 사람 사이에 퍼져나갔다.' > "$FIXTURE16"
set +e
node "$SCRIPT" --json "$FIXTURE16" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cd = r.findings.filter((f) => f.type === 'cliche-density-tic');
if (cd.length !== 1) throw new Error('고밀도 AI 상투적 표현이 1곳에서 cliche-density-tic으로 보고되어야 함: ' + JSON.stringify(r.findings));
if (cd[0].severity !== 'advisory') throw new Error('cliche-density-tic은 advisory여야 함');
if (!cd[0].excerpt.includes('마치') || !cd[0].excerpt.includes('눈빛이 스쳐갔다')) {
  throw new Error('cliche-density-tic excerpt에 상용구 샘플을 포함해야 합니다: ' + JSON.stringify(cd[0]));
}
NODE

# advisory는 --fail-on=blocking을 트리거하지 않음. 저밀도 소재 단어/인용부호 내 인용은 보고하지 않음.
set +e
node "$SCRIPT" --fail-on=blocking "$FIXTURE16" > /dev/null 2>&1
cliche_blk=$?
set -e
[ "$cliche_blk" -eq 0 ] || { echo "FAIL: cliche-density-tic --fail-on=blocking은 0으로 종료되어야 하는데, 실제값 $cliche_blk" >&2; exit 1; }

FIXTURE17="$TMP_DIR/fixture-cliche-density-normal.md"
printf '%s\n' \
  '그녀는 낡은 공책에 "마치 어떤 징조인 듯"라는 한 문장을 베껴 적었고, 옆에 × 표시를 그려서 자신에게 이렇게 쓰지 말라고 상기시켰다.' \
  '창밖의 빗소리가 종이상자를 흠뻑 적셨고, 린저는 맨 위의 서류를 빼내어 난방기 옆에 펼쳤다.' \
  '수완이 말하는 목소리가 크지 않았는데, 사무실이 너무 넓어서 오히려 각 글자가 매우 명확하게 들렸다.' > "$FIXTURE17"
set +e
node "$SCRIPT" --json "$FIXTURE17" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cd = r.findings.filter((f) => f.type === 'cliche-density-tic');
if (cd.length !== 0) throw new Error('낮은 밀도/인용부호 내 중복 단어는 cliche-density-tic을 보고하지 않아야 함: ' + JSON.stringify(cd));
NODE

echo "cliche-density-tic (상투적 표현 밀도 과다) 회귀 테스트 통과"

# --- issue #205：유사 표현 밀도 과다（'같은' 글자 비유가 반복되어 나타나고, 구체적인 이미지로 돌아감）---
FIXTURE_METAPHOR="$TMP_DIR/fixture-metaphor-density.md"
printf '%s\n' \
  '입구의 빗이 아직 그치지 않았다. 가로등은 더러운 물에 잠긴 안구처럼 보이고, 빛의 후광이 사람의 마음을 저릿하게 만든다.' \
  '보안실의 유리창이 마치 기름 때가 낀 것처럼 보여서, 누가 얼굴을 비비면 회색으로 변한다.' \
  '군중이 계단 아래로 몰려 있었고, 마치 물에 흠뻑 젖은 종이 덩어리 같다.' \
  '주언의 목소리는 낡은 엘리베이터 안의 안내 방송 같았고, 목구멍에 걸린 듯하다.' \
  '공고문의 빨간 글씨는 못처럼 보여서, 벽에 하나하나 박혀간다.' \
  '아이의 울음소리는 건물 틈에서 새어나오는 바람처럼, 가늘어서 사람들 등 뒤를 오싹하게 만들었다.' \
  '흉장이 밝혀져, 낡은 휴대폰 화면처럼 투명했다.' > "$FIXTURE_METAPHOR"
set +e
node "$SCRIPT" --json "$FIXTURE_METAPHOR" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const md = r.findings.filter((f) => f.type === 'metaphor-density-tic');
if (md.length !== 1) throw new Error('고밀도 은유는 1개의 metaphor-density-tic을 보고해야 함: ' + JSON.stringify(r.findings));
if (md[0].severity !== 'advisory') throw new Error('metaphor-density-tic은 advisory여야 함');
if (!md[0].excerpt.includes('가로등처럼') || !md[0].excerpt.includes('유리가 마치')) {
  throw new Error('metaphor-density-tic excerpt에는 비유 샘플이 포함되어야 합니다: ' + JSON.stringify(md[0]));
}
NODE

set +e
node "$SCRIPT" --fail-on=blocking "$FIXTURE_METAPHOR" > /dev/null 2>&1
metaphor_blk=$?
set -e
[ "$metaphor_blk" -eq 0 ] || { echo "FAIL: metaphor-density-tic --fail-on=blocking은(는) 0으로 종료되어야 하는데, 실제로는 $metaphor_blk" >&2; exit 1; }

FIXTURE_METAPHOR_NORMAL="$TMP_DIR/fixture-metaphor-density-normal.md"
printf '%s\n' \
  '프로필 사진이 검은 배경에 흰 글씨로 바뀌었고, 저우옌이 2초간 바라봤다.' \
  '그녀는 노트에 "물처럼"이라는 네 글자를 썼다가 빨간색 펜으로 지워버렸다.' \
  '빗소리가 천장을 통해 내려왔는데, 마치 누군가 천천히 콩을 따르는 것 같았다.' \
  '그는 영수증을 주머니에 집어넣고 돌아서서 3단원의 문을 두드렸다.' > "$FIXTURE_METAPHOR_NORMAL"
set +e
node "$SCRIPT" --json "$FIXTURE_METAPHOR_NORMAL" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const md = r.findings.filter((f) => f.type === 'metaphor-density-tic');
if (md.length !== 0) throw new Error('low-density/quote-inside/avatar should not report metaphor-density-tic: ' + JSON.stringify(md));
NODE

echo "metaphor-density-tic (비유 밀도 과다) regression tests passed."

# --- issue #205: 설명 체인 밀도 과다 (논리 보고서 읽기 시의 읽기 순서 처리 힌트) ---
FIXTURE18="$TMP_DIR/fixture-reasoning-chain.md"
cat > "$FIXTURE18" <<'TEXT'
저우옌이 문지기 부스 앞에 서서 단체 메시지가 한 줄씩 튀어나오는 것을 봤다. 그는 지금 가장 중요한 작업이 군중을 진정시키고 공황이 계속 확산되는 것을 피하는 것임을 알고 있었다. 그는 또한 업주들이 계속 북문 앞에 모여 있으면 공공 구역의 질서가 빠르게 통제 불능이 될 것임을 이해했다. 이는 모든 방송 공지가 신중해야 함을 의미했으며, 잘못된 지시는 새로운 사망을 초래할 수 있기 때문이다.

진정한 문제는 그가 완전한 규칙을 갖추지 않았으면서도 규칙의 처벌이 내려지기 전에 판단을 내려야 한다는 것이다. 이런 상황에서 어떤 위로도 오도로 변할 수 있고, 어떤 침묵도 동의로 받아들여질 수 있다. 그는 먼저 누가 아직 밖에 있는지 확인하고, 어떤 건물이 여전히 문을 열 수 있는지 확인해야 한다. 이렇게 해야만 혼란을 통제 가능한 범위로 되돌릴 수 있다.

주언은 가슴패 위의 푸른 빛을 바라보며 현재 상황을 끊임없이 분석했다. 시스템이 제시한 과제는 모든 생존한 주민을 집으로 돌려보내는 것이고, 제약 조건은 자정 이전이며, 위험 요인은 빨간 선 밖과 잘못된 지시다. 이 논리에 따르면, 그는 먼저 이동 중인 사람들을 줄이고, 다음으로 단위 입구에 임시 질서를 수립한 뒤, 마지막으로 각각 호수판을 확인해야 한다.

그는 자신이 단지 실습 물업사원일 뿐이라는 것을 알고 있었지만, 이제 시스템이 책임을 자신에게 맡겼다. 다시 말해, 그는 본래 자신이 져야 할 책임이 아닌 결과를 감수해야 했다. 그는 침착함을 유지해야 하고, 정보를 선별해야 하며, 각 사람의 위험 등급을 판단해야 했다. 여기까지 생각이 미치자, 그는 마침내 깨달았다. 오늘밤의 시험은 정보 부족 상황에서의 의사결정 능력이고, 또한 자신이 공공 질서를 감당할 수 있는지의 시작이었다.
TEXT
set +e
node "$SCRIPT" --json "$FIXTURE18" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rc = r.findings.filter((f) => f.type === 'reasoning-chain-tic');
if (rc.length !== 1) throw new Error('고밀도 해석 체인은 1개의 reasoning-chain-tic을 보고해야 합니다: ' + JSON.stringify(r.findings));
if (rc[0].severity !== 'advisory') throw new Error('reasoning-chain-tic은 advisory여야 합니다');
if (!rc[0].excerpt.includes('그는 알고 있었다') || !rc[0].excerpt.includes('이것은 의미한다')) {
  throw new Error('reasoning-chain-tic excerpt는 추론 체인 샘플을 포함해야 함: ' + JSON.stringify(rc[0]));
}
NODE

# advisory는 --fail-on=blocking을 트리거하지 않음; 동작화 개쓰기/인용 부호 내 인용문은 보고되지 않음.
set +e
node "$SCRIPT" --fail-on=blocking "$FIXTURE18" > /dev/null 2>&1
reason_blk=$?
set -e
[ "$reason_blk" -eq 0 ] || { echo "FAIL: reasoning-chain-tic --fail-on=blocking은 0으로 종료되어야 함, 실제값 $reason_blk" >&2; exit 1; }

FIXTURE19="$TMP_DIR/fixture-reasoning-chain-normal.md"
cat > "$FIXTURE19" <<'TEXT'
주얀이 정문 초소 앞에 서 있었고, 그룹 메시지는 계속 위로 올라가고 있었다.

"주얀, 뭐라고 말해!"

"북문이 도대체 어떻게 된 거야?"

그는 방송 버튼을 누르고 있다가 손을 뗐다. 입구에는 여전히 10여 명이 남아 있었고, 고양이 사료를 안은 여자는 바닥에 쪼그리고 앉아 손이 계속 떨리고 있었다. 개를 산책시키던 할아버지는 개 줄을 손목에 감고, 빨간 줄 바깥의 그 묶음 열쇠를 눈여겨보고 있었다.

주얀은 관리사무소 당번표를 펼쳐서 손톱으로 종이 위를 세 번 그었다. 북문, 3호 빌딩, 어린이 구역. 그는 먼저 밖에 있는 이름들을 동그라미로 표시하고, 다시 펜으로 보이는 건물 번호들을 옆에 적었다.

그는 노트 가장자리에 "이것은 책임을 의미한다"고 적었다가 곧바로 지워 버리고, 3호 빌딩의 세 개 호 번호로 바꿨다.

"모두 북문으로부터 10미터 떨어져 있으세요."그가 말했다. "3호 건물 주민은 먼저 단위 입구로 돌아가되, 엘리베이터에 탑승하지 마세요. 집에 아직 돌아오지 않은 사람이 있으면 단위 번호를 단체 채팅에 올려주되, 도배하지 마세요."
TEXT
set +e
node "$SCRIPT" --json "$FIXTURE19" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rc = r.findings.filter((f) => f.type === 'reasoning-chain-tic');
if (rc.length !== 0) throw new Error('동작화 개서/따옴표 내 해석 체인이 reasoning-chain-tic을 반환해서는 안 됨: ' + JSON.stringify(rc));
NODE

FIXTURE20="$TMP_DIR/fixture-reasoning-chain-domain-words.md"
cat > "$FIXTURE20" <<'TEXT'
입구의 규칙 표지판이 바람에 기울어졌고, 저우옌이 손으로 바로잡았다. 책임 구역 세 글자가 빗물에 노출되어 있었고, 아래에는 낡은 양식이 붙어 있었으며, 위험 경고는 이미 한 모서리가 떨어져 있었다.

보안원이 질서 줄을 반 미터 앞으로 옮겼고, 줄이 타일을 스칠 때 두 줄의 진흙 자국을 남겼다. 저우옌은 펜을 들어 로그북에 책임자 행을 추가하고, 규칙 표지판 아래 못을 다시 눌러 넣었다.

3호 건물 주민들이 여전히 입구에서 막혀 있었다. 어떤 사람은 위험 경고를 가리키며 욕했고, 어떤 사람은 질서 줄을 놓지 않았다. 저우옌은 설명하지 않고 확성기를 노보안원에게 건네주고, 몸을 굽혀 물에 빠진 출입 카드를 줍기 시작했다.

비가 점점 더 내려와 종이 위의 책임 항목이 번져갔고, 규칙이라는 글자가 뭉개져 한 덩어리가 되었다. 질서선 저편에서 아이가 우산을 비스듬히 들고, 신발 끝으로 물웅덩이를 밟고 있었다.
TEXT
set +e
node "$SCRIPT" --json "$FIXTURE20" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rc = r.findings.filter((f) => f.type === 'reasoning-chain-tic');
if (rc.length !== 0) throw new Error('규칙/책임/위험 등 영역 명사가 밀집했지만 추론 연결어가 없을 때 reasoning-chain-tic를 보고하면 안 됨: ' + JSON.stringify(rc));
NODE

FIXTURE20B="$TMP_DIR/fixture-reasoning-chain-negated.md"
cat > "$FIXTURE20B" <<'TEXT'
주언은 규칙 뒤에 또 무엇이 있는지 알 수 없었고, 책임을 어떻게 나눌지도 이해하지 못했다. 위험이 어느 선에서 비롯되는지 아직 파악하지 못했으며, 결과를 판단할 필요도 없었고, 누가 책임을 맡을지 확인할 필요도 없었다.

경비실의 낡은 서식이 빗물에 번져갔고, 작업 항목, 조건 항목, 책임 항목이 뭉개져 함께 붙어 있었다. 노보안이 광고방송을 할지 물었지만, 그는 고개를 저었고, 다만 그 종이를 파일 폴더에 끼워 넣었다.

3호 건물의 사람들이 왜 아직 떠나지 않았는지 알 수 없었고, 질서선이 어떻게 갑자기 반 정도 느슨해졌는지 이해할 수 없었다. 아이의 우산 살이 뒤로 젖혀지고, 신발 끝으로 물웅덩이를 밟고, 출입카드가 바닥 타일에 붙어 있었다.

주언은 이 규칙들이 여전히 유효한지 명확하지 않았고, 각 사람의 위험 원인을 분석할 필요도 없었다. 그는 확성기를 책상 위에 다시 놓고 먼저 북쪽 문의 우산막을 밖으로 조금 당겨냈다.
TEXT
set +e
node "$SCRIPT" --json "$FIXTURE20B" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rc = r.findings.filter((f) => f.type === 'reasoning-chain-tic');
if (rc.length !== 0) throw new Error('모름/불명확함/불필요함 등의 부정적 인식이 해석 체인의 핵심 매칭에 포함되지 않아야 함: ' + JSON.stringify(rc));
NODE

echo "reasoning-chain-tic (해석 체인 밀도 과다) regression tests passed."

# --- issue #205: 시스템 공지문 공문체 과밀도 (대괄호 규칙 행 경질어 과밀도) ---
FIXTURE21="$TMP_DIR/fixture-notice-formality.md"
cat > "$FIXTURE21" <<'TEXT'
【야간에는 본 구역을 떠날 수 없습니다.】

【자정 전에 모든 인원은 등록된 거주지로 돌아와야 합니다.】

【관리 인원은 공용 구역의 질서를 유지해야 합니다. 공용 구역이 통제 불능 상태가 되면 관리 인원이 우선적 처벌을 받습니다.】

【본 공고는 철회할 수 없으며, 전달할 수 없고, 스크린샷을 찍을 수 없습니다.】

【현재 구역: 1호 건물.】

【현재 보안 등급: 0.】

【현재 공용 구역 질서: 혼란.】

【첫째 밤 임무: 반드시 자정 전에 모든 인원을 등록 주소지로 복귀시킬 것.】

【임무 실패: 관리 인원이 우선적으로 처벌을 부담.】

【안내: 관리 인원의 발언은 공용 질서 지시로 간주됩니다. 잘못된 지시로 인한 사망도 동일하게 관리 인원의 책임에 포함됩니다.】
TEXT
set +e
node "$SCRIPT" --json "$FIXTURE21" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const nf = r.findings.filter((f) => f.type === 'system-notice-formality-tic');
if (nf.length !== 1) throw new Error('연속 하드 규칙 공지는 1개의 system-notice-formality-tic을 보고해야 합니다: ' + JSON.stringify(r.findings));
if (nf[0].severity !== 'advisory') throw new Error('system-notice-formality-tic의 severity는 advisory여야 합니다');
if (!nf[0].excerpt.includes('불가') || !nf[0].excerpt.includes('반드시')) {
  throw new Error('system-notice-formality-tic excerpt에는 강제 규칙 키워드 샘플이 포함되어야 합니다: ' + JSON.stringify(nf[0]));
}
NODE

set +e
node "$SCRIPT" --fail-on=blocking "$FIXTURE21" > /dev/null 2>&1
notice_blk=$?
set -e
[ "$notice_blk" -eq 0 ] || { echo "FAIL: system-notice-formality-tic --fail-on=blocking은 종료 코드 0을 반환해야 하는데, 실제값은 $notice_blk입니다" >&2; exit 1; }

FIXTURE22="$TMP_DIR/fixture-notice-natural.md"
cat > "$FIXTURE22" <<'TEXT'
【야간에는 본 구역을 떠날 수 없습니다.】

【자정 전에 모든 인원은 등록된 숙소로 복귀해야 합니다.】

【관리 인원은 공용 구역의 질서를 유지해야 합니다. 공용 구역에서 혼란이 발생할 때는 관리 인원이 먼저 처벌을 받습니다.】

【본 공고는 철회할 수 없으며, 전달할 수 없고, 스크린샷을 찍을 수 없습니다.】

【현재 구역은 1호 건물입니다.】

【현재의 보안 등급은 0입니다.】

【현재 공공 구역의 질서가 매우 혼란스럽습니다.】

【야간 작업은 자정 전에 모든 인원을 등록 숙소로 복귀시키는 것입니다.】

【작업 실패 후 관리자가 먼저 처벌을 받습니다.】

【안내: 관리자가 발출한 지시는 공공 질서 지시입니다. 사망을 야기한 오류 지시도 관리자의 책임에 포함되어야 합니다.】
TEXT
set +e
node "$SCRIPT" --json "$FIXTURE22" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const nf = r.findings.filter((f) => f.type === 'system-notice-formality-tic');
if (nf.length !== 0) throw new Error('구어화 규칙 공지에 system-notice-formality-tic를 포함하면 안 됩니다: ' + JSON.stringify(nf));
NODE

echo "system-notice-formality-tic (시스템 공지 공문체 과다) regression tests passed."

# --- issue #205：장문 과도 축약 단락（읽기 순서 처리 안내；기계적 수채 금지）---
FIXTURE23="$TMP_DIR/fixture-overcompressed-prose.md"
: > "$FIXTURE23"
for _ in $(seq 1 60); do
  cat >> "$FIXTURE23" <<'TEXT'
주언이 고개를 들었다.

TEXT
done
for _ in $(seq 1 40); do
  cat >> "$FIXTURE23" <<'TEXT'
회색 안개가 빨간 선 바깥쪽에 붙어 있고, 북문 등불이 흔들려 차가운 반점이 되며, 발걸음 소리가 문 경비실 앞으로 물러났다.

TEXT
done
set +e
node "$SCRIPT" --json "$FIXTURE23" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const oc = r.findings.filter((f) => f.type === 'overcompressed-prose-tic');
if (oc.length !== 1) throw new Error('장문 단락 과밀 및 자연 연결 부족 시 overcompressed-prose-tic 보고 필요: ' + JSON.stringify(r.findings));
if (oc[0].severity !== 'advisory') throw new Error('overcompressed-prose-tic은(는) advisory여야 합니다');
NODE

set +e
node "$SCRIPT" --fail-on=blocking "$FIXTURE23" > /dev/null 2>&1
overcompressed_blk=$?
set -e
[ "$overcompressed_blk" -eq 0 ] || { echo "FAIL: overcompressed-prose-tic --fail-on=blocking은(는) 0으로 종료되어야 하는데, 실제값은 $overcompressed_blk" >&2; exit 1; }

FIXTURE24="$TMP_DIR/fixture-overcompressed-prose-natural.md"
: > "$FIXTURE24"
for _ in $(seq 1 40); do
  cat >> "$FIXTURE24" <<'TEXT'
주연이 고개를 들었다.

TEXT
done
for _ in $(seq 1 40); do
  cat >> "$FIXTURE24" <<'TEXT'
회색 안개는 여전히 빨간 선 바깥쪽에 붙어 있고, 북문의 등빛은 이미 흐릿한 하나의 차가운 자국으로 변해 있었으며, 발걸음 소리도 문 경비실 앞으로 밀려나 있었다.

TEXT
done
set +e
node "$SCRIPT" --json "$FIXTURE24" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const oc = r.findings.filter((f) => f.type === 'overcompressed-prose-tic');
if (oc.length !== 0) throw new Error('짧은 단락의 비율이 임계값을 초과하지 않았거나 자연스러운 연결이 충분할 때 overcompressed-prose-tic을(를) 보고하면 안 됩니다: ' + JSON.stringify(oc));
NODE

FIXTURE25="$TMP_DIR/fixture-overcompressed-prose-fast-natural.md"
: > "$FIXTURE25"
for _ in $(seq 1 60); do
  cat >> "$FIXTURE25" <<'TEXT'
그는 1초 멈췄다.

TEXT
done
for _ in $(seq 1 40); do
  cat >> "$FIXTURE25" <<'TEXT'
빗은 여전히 문 앞에 내리고 있었고, 등빛도 수증기로 흐려졌으며, 모두들 조금씩 뒤로 물러났다.

TEXT
done
set +e
node "$SCRIPT" --json "$FIXTURE25" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const oc = r.findings.filter((f) => f.type === 'overcompressed-prose-tic');
if (oc.length !== 0) throw new Error('빠른 속도이지만 자연스럽게 연결된 짧은 구간은 overcompressed-prose-tic을 보고해서는 안 됨: ' + JSON.stringify(oc));
NODE

FIXTURE26="$TMP_DIR/fixture-overcompressed-prose-repaired-beats.md"
: > "$FIXTURE26"
for _ in $(seq 1 50); do
  cat >> "$FIXTURE26" <<'TEXT'
저우옌이 고개를 들었을 때 북문 밖 그 도로는 이미 보이지 않았다. 더 이상한 것은 소리도 함께 사라졌다는 것이고, 업주 그룹 채팅에서 물음표를 쏟아내던 것이 3초 멈췄다.

TEXT
done
set +e
node "$SCRIPT" --json "$FIXTURE26" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const oc = r.findings.filter((f) => f.type === 'overcompressed-prose-tic');
if (oc.length !== 0) throw new Error('읽기 순서를 정한 후의 같은 장면 짧은 촬영은 overcompressed-prose-tic을 보고해서는 안 됨: ' + JSON.stringify(oc));
NODE

echo "overcompressed-prose-tic (과도하게 압축된 산문 특성) regression tests passed."

# --- issue #205: 낮은 연결 밀도 + 중장 문장 부족 (R10 보수적 advisory, 단순 낮은 연결만으로는 부족) ---
FIXTURE27="$TMP_DIR/fixture-low-connective-density.md"
: > "$FIXTURE27"
for _ in $(seq 1 50); do
  cat >> "$FIXTURE27" <<'TEXT'
주언이 고개를 들었다. 빨간 점이 높이 뛰었다. 북쪽 문 불빛이 차가웠다. 휴대폰 화면이 꺼졌다. 발걸음이 멈췄다.

TEXT
done
set +e
node "$SCRIPT" --json "$FIXTURE27" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const lc = r.findings.filter((f) => f.type === 'low-connective-density-tic');
if (lc.length !== 1) throw new Error('낮은 연결 밀도이고 중장 문장이 부족하면 low-connective-density-tic 1곳을 보고해야 함: ' + JSON.stringify(r.findings));
if (lc[0].severity !== 'advisory') throw new Error('low-connective-density-tic는 advisory여야 함');
if (!lc[0].message.includes('기계식 주입 금지')) throw new Error('low-connective-density-tic은 기계식 주입 금지를 반드시 알려야 함: ' + JSON.stringify(lc[0]));
NODE

set +e
node "$SCRIPT" --fail-on=blocking "$FIXTURE27" > /dev/null 2>&1
low_connective_blk=$?
set -e
[ "$low_connective_blk" -eq 0 ] || { echo "FAIL: low-connective-density-tic --fail-on=blocking은 0으로 종료되어야 하는데, 실제 $low_connective_blk" >&2; exit 1; }

# 따옴표 안의 대사/채팅/시스템 안내는 본래 간결하므로 저연결 밀도 통계에 포함되지 않음. 그렇지 않으면 문체 특성을 전보체로 잘못 인식할 수 있음.
FIXTURE27B="$TMP_DIR/fixture-low-connective-quoted-stream.md"
: > "$FIXTURE27B"
for _ in $(seq 1 80); do
  cat >> "$FIXTURE27B" <<'TEXT'
"빨간 점이 뛴다. 북문의 불이 꺼진다. 휴대폰 화면이 검어진다. 발걸음이 멈춘다."

TEXT
done
cat >> "$FIXTURE27B" <<'TEXT'
주언이 그룹 메시지를 위로 스크롤했다. 문지기실에는 에어컨 소리만 남았고, 그는 재빨리 입을 열지 않았다.
TEXT
set +e
node "$SCRIPT" --json "$FIXTURE27B" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const lc = r.findings.filter((f) => f.type === 'low-connective-density-tic');
if (lc.length !== 0) throw new Error('따옴표 내 짧은 대사/채팅 흐름은 low-connective-density-tic을 발생시키면 안 됨: ' + JSON.stringify(lc));
NODE

# 설정된 모든 중영문 따옴표는 "따옴표 외 서술"에서 제외되어야 하며, 따옴표 내 regex 메타문자도 제외 처리에 영향을 주면 안 됩니다.
FIXTURE27C="$TMP_DIR/fixture-low-connective-all-quote-pairs.md"
: > "$FIXTURE27C"
for _ in $(seq 1 35); do
  cat >> "$FIXTURE27C" <<'TEXT'
「빨간점[높이뛰기]*。북문 등 차가움+。휴대폰 화면 꺼짐?。」『빨간점[높이뛰기]*。북문 등 차가움+。휴대폰 화면 꺼짐?。』【빨간점[높이뛰기]*。북문 등 차가움+。휴대폰 화면 꺼짐?。】"빨간점[높이뛰기]*。북문 등 차가움+。휴대폰 화면 꺼짐?。"'빨간점[높이뛰기]*。북문 등 차가움+。휴대폰 화면 꺼짐?。'"빨간점[높이뛰기]*。북문 등 차가움+。휴대폰 화면 꺼짐?。"'빨간점[높이뛰기]*。북문 등 차가움+。휴대폰 화면 꺼짐?。'

TEXT
done
cat >> "$FIXTURE27C" <<'TEXT'
주언이 단톡방의 메시지를 위로 올렸다. 문지기 막사 안에는 에어컨 소리만 남아 있었고, 그는 즉시 입을 열지 않았다.
TEXT
set +e
node "$SCRIPT" --json "$FIXTURE27C" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const lc = r.findings.filter((f) => f.type === 'low-connective-density-tic');
if (lc.length !== 0) throw new Error('모든 따옴표 쌍을 제외해야 하며, low-connective-density-tic을 발생시키면 안 됨: ' + JSON.stringify(lc));
NODE

# 단순 기능어/구어 연결이 낮지만 중장문 연결이 충분할 때는 보고하지 않음; 이는 《반룡》 수동 검증 오류 사례의 보호 조건입니다.
FIXTURE28="$TMP_DIR/fixture-low-connective-long-sentences.md"
: > "$FIXTURE28"
for _ in $(seq 1 30); do
  cat >> "$FIXTURE28" <<'TEXT'
주언이 빨간 점 스크린샷을 그룹 채팅에 보냈고, 북문의 차가운 등불이 회색 안개에 흔들려 한 덩어리가 되었으며, 발걸음 소리가 문 경비실 앞에서 움직이지 않았습니다.

TEXT
done
set +e
node "$SCRIPT" --json "$FIXTURE28" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const lc = r.findings.filter((f) => f.type === 'low-connective-density-tic');
if (lc.length !== 0) throw new Error('연결이 낮지만 중장문이 충분할 때는 보고하면 안 됨 low-connective-density-tic: ' + JSON.stringify(lc));
NODE

echo "low-connective-density-tic (낮은 연결 밀도 + 중장문 부족) 회귀 테스트 통과."

# ============================================================
# 실제 테스트 미탐지 문형(A-E): 음량 대비 강조 / 부정 배비 / 역순 대조 / 예고식 수미 / 인용부호 강조 남용
# 정례는 실제 작문에서 포착한 진정한 누락 문장에서 취했으며, 반례는 대화 면제, either-or, 정상 인용 및 실제 언어 자료 경계 문장을 포함합니다.
# ============================================================

# --- 실전 누락 A: voice-contrast(목소리가 크지 않은데…그런데…, blocking) ---
FIXTURE_VOICE="$TMP_DIR/fixture-voice-contrast.md"
printf '%s\n' \
  '목소리가 크지 않은데, 첫 번째 문장이 전체 홀을 단호히 눌렀다.' \
  '"그의 목소리가 크지 않은데, 화난 기세를 풍겼다."옆의 사람이 작게 중얼거렸다.' \
  '그녀의 목소리가 크지 않은데, 객석 앞줄에서 선명하게 들렸다.' > "$FIXTURE_VOICE"
set +e
node "$SCRIPT" --json "$FIXTURE_VOICE" > "$OUT"
node "$SCRIPT" --fail-on=blocking "$FIXTURE_VOICE" >/dev/null 2>&1
voice_blk=$?
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const vc = r.findings.filter((f) => f.type === 'voice-contrast');
if (vc.length !== 1) throw new Error('음량 대비 공동음성이 1곳에서 매칭되어야 함 voice-contrast: ' + JSON.stringify(r.findings.map((f) => `${f.type}@${f.line}`)));
if (vc[0].line !== 1 || vc[0].severity !== 'blocking') throw new Error('voice-contrast는 line 1 blocking이어야 함: ' + JSON.stringify(vc[0]));
// 인용부호 내 대사(line 2)와 전환 없는 평탄한 표현(line 3)은 음량 대비 공동음성으로 간주하지 않음.
if (vc[0].excerpt.includes('화기')) throw new Error('인용부호 내 대사는 voice-contrast에 매칭되지 않아야 함: ' + JSON.stringify(vc[0]));
NODE
[ "$voice_blk" -eq 1 ] || { echo "FAIL: voice-contrast --fail-on=blocking은 종료 코드 1을 반환해야 하지만, 실제값 $voice_blk" >&2; exit 1; }

echo "voice-contrast (음량 대비 창법) regression tests passed."

# --- 실전 누락 B: negation-parade (없는 X, 없는 Y…／없는 X…다만 Y, blocking) ---
FIXTURE_PARADE="$TMP_DIR/fixture-negation-parade.md"
printf '%s\n' \
  '반주 없이, 화음 없이, 프롬프터 없이.' \
  '그는 기교를 자랑하지 않았고, 입만 벌려도 고음을 질러대는 그런 태도는 없었다. 그냥 노래할 뿐, 각 글자를 평탄하게 펼쳤다.' \
  '"밥이 없고, 물이 없으면 우리가 어떻게 밤을 새나?"누군가 외쳤다.' \
  '그는 돌아보지 않았다. 골목에는 등이 없었고, 그는 벽을 더듬으며 걸었다.' \
  '배는 안개 속에 침몰했고, 아무도 돌아보지 않았으며, 강 위에는 떠내려온 나뭇조각만 남았다.' \
  '그의 말은 박수 소리에 묻혔고, 얼마 지나지 않아 무대 위에는 그 혼자만 남았다.' \
  '비가 내린 지 얼마 되지 않아, 그녀가 우산을 펴기도 전에 골목에는 빗소리만 가득했다.' \
  '그는 그녀가 입을 열기도 전에, 그녀의 반응을 기다리지도 않고, 그저 몸을 돌려 걸어갔다.' > "$FIXTURE_PARADE"
set +e
node "$SCRIPT" --json "$FIXTURE_PARADE" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const np = r.findings.filter((f) => f.type === 'negation-parade');
if (np.length !== 3) throw new Error('부정 대구가 3곳의 negation-parade를 명중해야 함: ' + JSON.stringify(r.findings.map((f) => `${f.type}@${f.line}`)));
if (np[0].line !== 1 || np[1].line !== 2 || np[2].line !== 8) throw new Error('negation-parade가 line 1/2와 반복된 「没」의 line 8을 명중해야 함: ' + JSON.stringify(np));
if (!np.every((f) => f.severity === 'blocking')) throw new Error('negation-parade는 blocking이어야 함');
// 인용부호 내 대사(line 3)와 분절된 독립 부정(line 4)은 대구로 간주하지 않음;
// 접착 형태소 「submerge/flood」(line 5/6)와 단일 시간 관용구 「not long after」(line 6/7)은 간주하지 않음;
// 하지만 반복된 「A를 못 기다렸고, B를 못 기다렸고, 그저 C일 뿐이라」는 자체가 목표 병렬 구조이므로 시간 구절로 제외할 수 없습니다.
NODE

echo "negation-parade (부정 병렬) regression tests passed."

# --- 제21장 실전 누락: 문단 간 부정 삼연 + 정연한 결정/부정 나열 ---
# 이 세 가지 유형은 모두 정상 맥락에서 찾을 수 있으므로 advisory만 보내 의미 검수를 진행하고, 가벼운 hook은 강제로 차단하지 않습니다.
FIXTURE_CH21_GAP="$TMP_DIR/fixture-ch21-ai-flavor-gap.md"
printf '%s\n' \
  '찍을지 말지, 어떻게 찍을지는 그가 말을 다 마칠 때까지 기다린 후에 결정하자.' \
  '카메라를 들고 가지 않고, 인터뷰 조명을 들고 가지 않습니다.' \
  '"카메라를 들고 가지 않고, 인터뷰 조명을 들고 가지 않습니다."' \
  '목놓아 우는 것은 아닙니다.' \
  '' \
  '목을 높여 그리워한다고 외치는 것도 아닙니다.' \
  '' \
  '한 사람이 멀리 걸어가고, 원래 있던 곳에 남겨진 사람이 여전히 서 있을 뿐입니다.' \
 '죽느냐 사느냐 그것이 문제로다.' \
 '촬영 방안을 어떻게 정할지는 사람들이 도착한 후에 말하기로 하자.' \
 '"고추를 넣지 마, 파를 넣지 마."' \
 '그는 우산을 안 가져갔다. 그녀는 가방을 안 가져갔다.' \
 '그녀가 집에 돌아가고 싶지 않은 게 아니다.' \
  '어머니가 용서하지 않으려고 한 것도 아니었다.' \
  '다만 막차가 이미 떠나간 것뿐이었다.' > "$FIXTURE_CH21_GAP"
set +e
node "$SCRIPT" --json "$FIXTURE_CH21_GAP" > "$OUT"
node "$SCRIPT" --fail-on=blocking "$FIXTURE_CH21_GAP" >/dev/null 2>&1
ch21_gap_blk=$?
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const np = r.findings.filter((f) => f.type === 'negation-parade');
if (np.length !== 0) throw new Error('교차 구간 부정 삼중 구조는 blocking negation-parade에 진입하면 안 됩니다: ' + JSON.stringify(np));
const fp = r.findings.filter((f) => f.type === 'formulaic-parallelism');
if (fp.length !== 5) throw new Error('결정 프레임워크 + 부정 병렬 + 두 곳의 교차 구간 삼중 구조는 5개의 advisory를 발견해야 합니다: ' + JSON.stringify(r.findings));
if (fp.some((f) => f.severity !== 'advisory')) throw new Error('formulaic-parallelism은 advisory만 가능합니다: ' + JSON.stringify(fp));
if (fp.map((f) => f.line).join(',') !== '1,2,3,4,13') throw new Error('formulaic-parallelism 는 1/2/3/4/13 줄에서 위치해야 함: ' + JSON.stringify(fp));
// either-or, 일반 결정문, 한 글자만 있는 객체의 기능적 단문 대화, 문장 간 독립적 부정은 모두 보고하지 않음.
// 13줄의 정상적인 해석은 보수적으로 표시되지만 절대 blocking 수준으로 상향되어서는 안 됨.
if (r.findings.some((f) => f.line >= 9 && f.line <= 12)) throw new Error('9-12줄 자연 반례가 오보됨: ' + JSON.stringify(r.findings));
NODE
[ "$ch21_gap_blk" -eq 0 ] || { echo "FAIL: 의미형 정렬 병렬은 --fail-on=blocking 을 트리거하지 않아야 함, 실제값 $ch21_gap_blk" >&2; exit 1; }

echo "chapter-21 AI-flavor gap regression tests passed."

# --- 실전 누락 C: reverse-not-is(A이다, B가 아니다 — not-is 역순 변형, blocking) ---
FIXTURE_REVNOTIS="$TMP_DIR/fixture-reverse-not-is.md"
printf '%s\n' \
  '숨이 차오를 대로 차올라, 진짜 성대음이야, 음정 보정으로 나온 게 아니야.' \
  '"내가 먼저 온 거지, 그 사람이 아니야."그녀가 표를 창구에 내팽개쳤다.' \
  '어쨌든 이런 식이 되는 거고, 누구나 바꿀 수 있는 게 아니야.' \
  '그 사람도 지난 2년 동안 배운 거지, 처음부터 아는 게 아니야.' \
  '맞아, 누구나 이런 인내심을 갖춘 건 아니지.' \
  '그는 자기가 등록한 게 아니라고 물었어.' \
  '그는 떠났지, 안 그래?' > "$FIXTURE_REVNOTIS"
set +e
node "$SCRIPT" --json "$FIXTURE_REVNOTIS" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rn = r.findings.filter((f) => f.type === 'reverse-not-is');
if (rn.length !== 1) throw new Error('역순 대비 캐비티가 1개 reverse-not-is를 감지해야 함: ' + JSON.stringify(r.findings.map((f) => `${f.type}@${f.line}`)));
if (rn[0].line !== 1 || rn[0].severity !== 'blocking') throw new Error('reverse-not-is는 line 1 blocking이어야 함: ' + JSON.stringify(rn[0]));
if (!rn[0].excerpt.includes('is genuine voice')) throw new Error('reverse-not-is excerpt는 정예시 단편을 포함해야 함: ' + JSON.stringify(rn[0]));
// 반례는 모두 침묵 유지 필수: 인용부호 내 해명(2), be/also be 합성어(3/4), be ah 확인 표현(5),
// be or not be 의문문(6), is not it 반문 종결(7).
NODE

echo "reverse-not-is (역순 대비 톤) regression tests passed."

# --- 실전 누락 D: trailer-ending(예고식 요약 마무리, 문말 600자 윈도우만 해당, blocking) ---
# 반례: 윈도우 외부 서사의 "아무도 모른다"(1줄), 윈도우 내부 대화의 "아무도 모른다",
# 실제 말뭉치 보도 문장 "경기가 정식으로 개막하다"(《만강》 제120장 원문).
FIXTURE_TRAILER="$TMP_DIR/fixture-trailer-ending.md"
printf '%s\n' '그는 입으로 연주하는 악기를 주머니에 집어넣었다. 아무도 그가 얼마나 오래 연습했는지 모른다.' > "$FIXTURE_TRAILER"
for _ in $(seq 1 16); do
  printf '%s\n' '마당의 불이 여전히 켜져 있었고, 어머니가 말린 이불을 안고 방으로 들어갔으며, 그는 문 앞에서 대나무 장대를 거두는 것을 도와주고, 물통의 뚜껑도 덮어주었다.' >> "$FIXTURE_TRAILER"
done
printf '%s\n' \
  '"아무도 다음 경기가 어디서 있을지 모른다." 노 조가 중얼거리며 악보 받침대를 정리했다.' \
  '종소리가 다시 울려 퍼지고, 경기가 공식적으로 막을 올린다.' \
  '아무도 모른다, 이것이 불과 시작일 뿐이라는 것을.' \
  '현 도시에서 성 방송국으로 향하는 접력이, 천천히 그에게 다가오고 있다.' >> "$FIXTURE_TRAILER"
set +e
node "$SCRIPT" --json "$FIXTURE_TRAILER" > "$OUT"
node "$SCRIPT" --fail-on=blocking "$FIXTURE_TRAILER" >/dev/null 2>&1
trailer_blk=$?
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const te = r.findings.filter((f) => f.type === 'trailer-ending');
if (te.length !== 3) throw new Error('장 끝 예고 톤이 3개의 trailer-ending과 일치해야 함: ' + JSON.stringify(r.findings.map((f) => `${f.type}@${f.line}:${f.excerpt}`)));
if (!te.every((f) => f.severity === 'blocking')) throw new Error('trailer-ending은 blocking이어야 함');
if (te.some((f) => f.line === 1)) throw new Error('윈도우 외부(문두)의 「아무도 모를」은 trailer-ending에 매칭되지 않아야 합니다');
if (te.some((f) => f.excerpt.includes('다음 장'))) throw new Error('대화 내의 「아무도 모를」은 trailer-ending에 매칭되지 않아야 합니다');
if (te.some((f) => f.excerpt.includes('막이 올라오다'))) throw new Error('실제 진행자 멘트 「정식으로 막이 올라오다」는 trailer-ending에 매칭되지 않아야 합니다');
const excerpts = te.map((f) => f.excerpt).join(' | ');
for (const marker of ['아무도 모를', '이제 막 시작이야', '덮어버렸어']) {
  if (!excerpts.includes(marker)) throw new Error(`trailer-ending 양성 예제 누락 ${marker}: ${excerpts}`);
}
NODE
[ "$trailer_blk" -eq 1 ] || { echo "FAIL: trailer-ending --fail-on=blocking은(는) 1로 종료되어야 하는데, 실제값 $trailer_blk" >&2; exit 1; }

echo "trailer-ending (예고식 요약 마무리) 회귀 테스트 통과."

# --- 실전 누락 E: quote-emphasis-tic (서술에서 짧은 단어를 인용부호로 강조, advisory 밀도형) ---
FIXTURE_QUOTE_EMPH="$TMP_DIR/fixture-quote-emphasis.md"
printf '%s\n' \
  '그는 "품질을 관리"하기 위해 초대받은 사람이었고, 오기 전부터 마음 속에 이미 정해진 말을 품고 있었다.' \
  '이 "정체 드러내는 신연기"는 지금 한 프레임씩 촬영되고, 편집되고, 인터넷에 올려지고 있다.' \
  '아무도 말이 없었고, 수천 명이 그 "꽃"에 의자에 못 박혀 있는 듯했다.' \
  '그녀가 "좋아"라고 말하고 몸을 돌려 걸어갔다.' \
  '"응."' \
  '"딩동~""딩동~""딩동~"' \
  '그는 "조용함(静)"을 한 번 읽었고, 다시 "고정(定)"을 썼다.' > "$FIXTURE_QUOTE_EMPH"
set +e
node "$SCRIPT" --json "$FIXTURE_QUOTE_EMPH" > "$OUT"
node "$SCRIPT" --fail-on=blocking "$FIXTURE_QUOTE_EMPH" >/dev/null 2>&1
quote_emph_blk=$?
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const qe = r.findings.filter((f) => f.type === 'quote-emphasis-tic');
if (qe.length !== 1) throw new Error('서술층 인용부호 강조 ≥3곳이 1건의 quote-emphasis-tic 보고: ' + JSON.stringify(r.findings.map((f) => f.type)));
if (qe[0].severity !== 'advisory') throw new Error('quote-emphasis-tic은 advisory여야 함');
if (!qe[0].message.includes('3곳')) throw new Error('인용동사 인접/독립 대사/의성어 연발은 계산 제외, 정확히 3곳이어야 함: ' + JSON.stringify(qe[0]));
if (!qe[0].excerpt.includes('把关')) throw new Error('quote-emphasis-tic excerpt는 「把关」 정상 예를 포함해야 함: ' + JSON.stringify(qe[0]));
NODE
[ "$quote_emph_blk" -eq 0 ] || { echo "FAIL: quote-emphasis-tic --fail-on=blocking은 0으로 종료해야 함, 실제값 $quote_emph_blk" >&2; exit 1; }

# 임계값 미만(3건 미만)은 보고하지 않음: 단일 강조는 정상적인 수사법이며, 실제 말뭉치 경계 문장 포함(《광활한 대지》 제40장 포스터 슬로건).
FIXTURE_QUOTE_EMPH_NORMAL="$TMP_DIR/fixture-quote-emphasis-normal.md"
printf '%s\n' \
  '자정 12시 10분, 번성 관광 공식 웹사이트에 소양의 사진이 나타났고, 손에 들고 있던 포스터는 "나는 번성에 있다"로 바뀌었다.' \
  '그는 "점검"하러 불려온 사람이었고, 오기 전에 이미 준비된 말을 마음속에 품고 있었다.' > "$FIXTURE_QUOTE_EMPH_NORMAL"
set +e
node "$SCRIPT" --json "$FIXTURE_QUOTE_EMPH_NORMAL" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const qe = r.findings.filter((f) => f.type === 'quote-emphasis-tic');
if (qe.length !== 0) throw new Error('3건 미만의 인용 강조는 quote-emphasis-tic을 보고하지 않아야 합니다: ' + JSON.stringify(qe));
NODE

echo "quote-emphasis-tic (인용 강조 오용) 회귀 테스트 통과."

# --- issue #255: 장 끝 상태 요약체(trailer-summary)------------------------------
# 세부 항목 「끝부분 설정/종결 상태」가 그대로 요약 문장으로 장을 마감합니다. trailer-ending과 문말 600자 윈도우를 공유합니다.
FIXTURE_TRAILER_SUMMARY="$TMP_DIR/fixture-trailer-summary.md"
printf '%s\n' \
  '그녀는 영수증을 테이블 위에 펼쳤고, 손가락으로 흰 자국을 눌러냈으며, 종이 끝자락이 땀에 젖어 축축해졌다.' \
  '그는 잔을 집어 들었다가 내려놓았고, 잔 밑바닥이 테이블 위에서 경쾌한 소리를 냈다.' \
  '이 모든 것이 끝났다. 이 밤은 필연코 잠을 이루지 못할 것이다.' > "$FIXTURE_TRAILER_SUMMARY"
set +e
node "$SCRIPT" --json "$FIXTURE_TRAILER_SUMMARY" > "$OUT"
node "$SCRIPT" --fail-on=blocking "$FIXTURE_TRAILER_SUMMARY" >/dev/null 2>&1
trailer_sum_blk=$?
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ts = r.findings.filter((f) => f.type === 'trailer-summary');
if (ts.length < 2) throw new Error('장 끝 "이 모든 것이 끝났다"와 "이 밤은 정해진 것이다"는 각각 한 조건씩 보고해야 함: ' + JSON.stringify(ts));
if (ts.some((f) => f.severity !== 'blocking')) throw new Error('trailer-summary는 blocking이어야 함: ' + JSON.stringify(ts));
NODE
[ "$trailer_sum_blk" -eq 1 ] || { echo "FAIL: trailer-summary --fail-on=blocking은 1로 종료되어야 하는데, 실제 $trailer_sum_blk" >&2; exit 1; }

# 반례: 말뭉치 실측으로 나온 6가지 구조적 오탐 패턴, 하나하나 고정 — 시간 점프("이렇게 시간이 흘러갔다"), 
# 타동 용법("드디어 이 주제가 끝났다"), 장내 공지("발표... 원만히 막을 내렸다"), 조건절("이 모든 것이 끝나면, ..."), 
# 동보(매우 명확하게 설명), 중첩 종속절(모든 것이 끝났다고 생각할 때), 성어 교차 매칭(운명의 결정), \
# 계사(결과는 정해져 있다), 그리고 「(이|그) 순간…드디어 깨달았다」와 나머지 인식 문장 -- 후자는 단편 1인칭 \
# 심판 명언의 형태(short-craft「심판 명언 / 심사 여운」은 판매 포인트), 본 규칙은 모두 수집하지 않습니다. \
FIXTURE_TRAILER_SUMMARY_NORMAL="$TMP_DIR/fixture-trailer-summary-normal.md"
printf '%s\n' \
  '이렇게 해서 일 년의 시간이 지나갔고, 장부는 서랍에서 금고로 옮겨졌다.' \
  '이렇게 해서 주인과 하인 둘 다 자책을 한 번 한 뒤, 이 화제가 끝났다.' \
  '이렇게 해서 네 시 반쯤 지정위원이 이번 맞선 친목 행사가 원만하게 막을 내렸다고 발표했다.' \
  '이 모든 것이 끝나면 우리는 평온하고 행복한 생활을 할 수 있을 거야.' \
  '비록 수제신목이 이 모든 것을 매우 명확하게 설명한 것처럼 보였지만, 결과는 생각과 달랐다.' \
  '그가 이 모든 것이 끝났다고 생각한 그 순간, 문이 다시 밀려 열렸다.' \
  '세상의 이 순간, 모든 사람이 숙명의 결말을 받아들였다!' \
  '장비의 압도적 우위까지 더해지면서, 이 전투의 결과는 이미 정해진 것이나 다름없었다.' \
  '그는 그 종이를 쥐고 있었지만, 이 모든 것이 무엇을 의미하는지 알 수 없었다.' \
  '그녀는 화면을 바라봤지만, 이 모든 것이 무엇을 말해주는지 이해할 수 없었다.' \
  '그 순간 나는 비로소 깨달았다. 어머니가 그 옛날 밤마다 왜 우셨는지를.' \
  '나는 벌떡 고개를 들고 휴대폰을 노려봤다. 드디어 알겠다. 딸이 지난 반년간 왜 자꾸 나를 피했는지를.' \
  '나는 외투를 집어 들고 문 쪽으로 걸어갔고, 돌아서며 그 문을 닫았다.' > "$FIXTURE_TRAILER_SUMMARY_NORMAL"
set +e
node "$SCRIPT" --json "$FIXTURE_TRAILER_SUMMARY_NORMAL" > "$OUT"
set -e
node - "$OUT" <<'NODE'
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ts = r.findings.filter((f) => f.type === 'trailer-summary');
if (ts.length !== 0) throw new Error('구문 인식/시간 전환은 trailer-summary를 보고하면 안 됩니다: ' + JSON.stringify(ts));
NODE

echo "trailer-summary (장 종료 상태 요약) 회귀 테스트 통과."
