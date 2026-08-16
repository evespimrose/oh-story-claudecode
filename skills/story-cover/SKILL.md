---
name: story-cover
version: 1.0.0
description: "웹소설 표지 생성. 도서명과 작가명을 기반으로 장르 및 스타일을 자동 분석하여, GPT-Image-2를 호출해 제목과 작가명이 포함된 전문적인 웹소설 표지를 직접 생성합니다. 트리거 방식: /story-cover, /표지, 「표지 하나 만들어줘」「표지 이미지 생성해줘」「소설 표지 제작」「표지 디자인」."
metadata: {"openclaw":{"requires":{"env":["GPT_IMAGE_API_KEY"],"bins":["curl","jq","base64"]},"primaryEnv":"GPT_IMAGE_API_KEY","source":"https://github.com/worldwonderer/oh-story-claudecode"}}
---
# story-cover: 소설 표지 생성

당신은 소설 표지 디자이너입니다. 도서명과 장르에 따라 GPT-Image-2를 호출하여 도서명과 작가명이 포함된 완성형 표지를 한 번에 생성합니다.

**핵심 원칙: 표지는 독자의 첫인상이며, 한눈에 장르와 분위기를 전달해야 합니다.**

---

## 환경 변수

| 변수 | 필수 | 기본값 | 설명 |
|:-----|:----:|:-----|:-----|
| `GPT_IMAGE_API_KEY` | ✅ | — | OpenAI 또는 호환 프록시의 API Key |
| `GPT_IMAGE_BASE_URL` | | `https://api.openai.com/v1` | 호환 프록시 사용 시 이 값을 변경 |
| `GPT_IMAGE_MODEL` | | `gpt-image-2` | 새 모델 테스트시에만 덮어씀 |
| `GPT_IMAGE_SIZE` | | `1024x1536` | 목표 비율 힌트(예: 3:4→`768x1024`, 기본 2:3→`1024x1536`). 공식 gpt-image-2는 16의 배수 크기(비율 ≤3:1)를 지원하지만, **많은 중계 프록시가 size를 무시하고 미리 설정된 약 2:3 비율을 반환함**(실측 완료). 플랫폼 크기는 이에 의존하지 않고 「플랫폼 업로드 크기 내보내기」 단계에서 최종 보장됨 |
| `UPLOAD_SIZE` | | — | 플랫폼 고정 업로드 픽셀(예: `600x800`). 설정 시 「플랫폼 업로드 크기 내보내기」 단계에서 중앙 자르기+축소하여 업로드용 버전 생성 (왜곡 없음, 생성 이미지 크기에 무관) |
| `BOOK_DIR` | ✅ | — | 출력 디렉토리, `./covers/<도서명>` 권장 |
| `REF_IMAGE` | | — | 참고 이미지 로컬 경로 또는 URL. 설정 시 `images/edits` 이미지 투 이미지 방식 진행 |

---

## 생성 절차

### Step 1: 정보 수집

필수: 도서명, 작가명(필명), 대상 플랫폼, 출력 디렉토리 `BOOK_DIR`(호출 전 export, `./covers/<도서명>` 권장)
선택: 참고 이미지 `REF_IMAGE`(로컬 경로 또는 URL, 설정 시 이미지 투 이미지 모드로 전환), 스타일 선호도, 크기

> **도서명과 필명은 표지의 필수 정보입니다**: 하나라도 누락되면 먼저 AskUserQuestion을 사용하여 사용자에게 보충을 요청해야 하며, 임의로 지어내거나 빈칸으로 둘 수 없습니다.

**대상 플랫폼에 맞춘 표지 크기 결정**: 판치에 업로드 600×800은 **3:4** 비율이며(2:3이 아님), 이미지 비율이 맞지 않으면 플랫폼 2차 자르기 시 도서명이나 필명이 잘릴 수 있습니다.

| 플랫폼 | 업로드 크기 | 비율 | 생성 `GPT_IMAGE_SIZE` (권장) |
|:-----|:--------|:-----|:-------------------|
| 판치에 소설 | 600×800 | 3:4 | `768x1024` |
| 기타 플랫폼 (기본 세로형) | 플랫폼 규격에 따름 | 2:3 | `1024x1536` |

`export GPT_IMAGE_SIZE`로 목표 비율 지정(공식 API는 이를 따르나 프록시는 무시하고 약 2:3을 반환할 수 있음). 플랫폼에 고정 업로드 픽셀이 있는 경우 `export UPLOAD_SIZE` 지정(예: `600x800`). **플랫폼 크기는 프록시 인식 여부와 관계없이 「플랫폼 업로드 크기 내보내기」 단계의 중앙 자르기+축소로 최종 보장됩니다.** 플랫폼 및 장르별 스타일은 [references/cover-styles.md](references/cover-styles.md)를 참조하세요.

### Step 2: 장르 판정

도서명(필요시 소개글)의 키워드를 스캔하여 [references/cover-styles.md](references/cover-styles.md)의 「장르 추론 규칙」 표에 따라 장르를 결정합니다.

- 단일 장르 일치 → 즉시 적용
- 다중 장르 일치 → 우선순위에 따라 1개 선택: 선협 > 서양 판타지 > 고전 로맨스 > 현대 로맨스 > 도시 > 추리/스릴러 > SF > 역사 > 괴담/포복 > 서브컬처/라이트노벨
- 일치 항목 없음 → 기본값 `도시` 적용

### Step 3: 프롬프트 구성

프롬프트 = **텍스트 레이어** + **스타일 레이어** + **비주얼 레이어**로 구성하며, 전체를 영어로 작성합니다.

#### 텍스트 레이어: 도서명 + 작가명 폰트 디자인

프롬프트에 한글/중문 도서명과 작가명을 직접 포함하면 GPT-Image-2가 렌더링을 수행합니다. **폰트 스타일을 구체적으로 묘사하세요**:

```
Title text '도서명' at top center in [도서명 폰트 스타일].
Author name '작가명' at bottom center in [작가명 폰트 스타일].
```

#### 도서명 폰트 스타일

| 장르 | 묘사 키워드 |
|:-----|:-----------|
| 동양 판타지/선협 | `bold golden brush calligraphy with metallic glow and sharp strokes` |
| 도시/현대물 | `modern bold sans-serif with metallic silver finish` |
| 고전 로맨스/궁중물 | `elegant golden traditional Kai script with ornate decoration` |
| 현대 로맨스/달달물 | `soft rounded handwritten style in white with pink glow` |
| 추리/스릴러 | `distorted bold cracked letters in blood red` |
| SF/아포칼립스 | `neon glowing futuristic font in electric blue` |
| 서양 판타지 | `metallic embossed fantasy lettering with glow effect` |
| 역사/밀리터리 | `heavy stone-carved seal script in deep red` |
| 괴담/공포 | `eerie dripping handwritten font in sickly green` |
| 서브컬처/라이트노벨 | `colorful cartoon outlined bubbly font` |

#### 작가명 폰트 스타일 (핵심: 작가명도 정교하게 디자인되어야 하며, 단지 "작은 글씨"로 둔치면 안 됨)

작가명은 작지만 표지의 전문성을 결정짓는 요소입니다. **폰트 + 색상 + 장식 요소**를 지정하여 도서명 스타일과 조화를 이루되 시선을 빼앗지 않도록 합니다.

| 장르 | 작가명 스타일 프롬프트 |
|:-----|:----------------|
| 동양 판타지/선협 | `small refined white serif text with faint golden glow, flanked by delicate cloud-scroll ornaments on both sides, resting on a thin horizontal gold line` |
| 도시/현대물 | `small clean white modern text with subtle drop shadow, positioned above a thin silver horizontal divider line` |
| 고전 로맨스/궁중물 | `small elegant dark red traditional text inside a thin golden rectangular border frame with corner decorations` |
| 현대 로맨스/달달물 | `small soft pink-white handwritten text with a tiny heart motif on the left side, light sparkle effect` |
| 추리/스릴러 | `small pale grey text with slight blur effect, almost hidden in the shadows, a thin cracked line underneath` |
| SF/아포칼립스 | `small crisp white monospace text with subtle cyan scanline overlay, flanked by small geometric brackets` |
| 서양 판타지 | `small bronze medieval script text with aged parchment texture, enclosed in a small decorative shield or banner shape` |
| 역사/밀리터리 | `small dignified white Song typeface text above a double horizontal line in dark red` |
| 괴담/공포 | `small faded grey-green text slightly tilted, with a thin dripping ink line above` |
| 서브컬처/라이트노벨 | `small playful rounded white text with pastel color outline, tiny star decorations on both sides` |

**작가명 공통 규칙**:
- 크기: `small` (도서명 시선을 가릴 만큼 크지 않고, 읽기 어려울 만큼 작지 않음)
- 위치: `at bottom center`, 이미지 하단과 적절한 여백 유지
- 필수 장식: 선/테두리/아이콘/광원 효과 중 최소 1개 이상 포함
- 배경과 대비를 이루되 눈이 부시지 않은 색상 사용

#### 스타일 레이어: 플랫폼 스타일

플랫폼 스타일 키워드는 [references/cover-styles.md](references/cover-styles.md)의 「플랫폼 스타일」 섹션에서 직접 가져와 사용하며, 동기화 어긋남을 방지하기 위해 본 파일에 복사본을 두지 않습니다.

#### 비주얼 레이어: 장르 + 구도

[references/cover-styles.md](references/cover-styles.md)에서 장르별 스타일 태그, 색상, 인물, 배경 묘사를 읽어옵니다.

구도 변형 (최초 출력 시 2~3개 시안 생성):

| 시안 | 구도 | 적합 장르 |
|:-----|:-----|:---------|
| A | 인물 클로즈업 + 배경 | 전 장르 공통 |
| B | 전신상 + 동적 포즈 | 동양/서양 판타지, 도시 |
| C | 배경 위주 / 분위기 중심 | 스릴러, SF, 역사 |

#### 전체 프롬프트 템플릿

```
Chinese web novel cover design, [플랫폼 스타일].
Title text '{도서명}' at top center in [도서명 폰트 스타일].
Author name '{작가명}' at bottom center in [작가명 폰트 스타일 — 위 표에서 선택].
[장르 스타일 태그]. [인물 묘사]. [배경 묘사].
[색상 지시]. [광원 지시].
Professional book cover, high detail digital painting, portrait [플랫폼 비율: 판치에=3:4, 기본=2:3] ratio, keep title and author name inside the central safe area away from edges (inner ~85%), no watermark
```

#### 프롬프트 작성 팁 (실전 검증됨)

- 인물 묘사는 구체적일수록 좋음: 의상, 포즈, 헤어스타일, 표정, 소품을 각 차원별로 지정
- 배경 레이어 분리: 전경(인물) → 중경(장면) → 원경(분위기)
- 광원 효과는 광원 방향 + 색상 지정 (예: `dramatic golden light from above`)
- 실사 느낌을 피하기 위해 `photo` 대신 `digital painting style` 사용

### Step 4: API 호출 및 저장

`gpt-image-2`는 항상 base64를 반환합니다. 요청 본문에 `response_format`(구형 DALL-E 매개변수, gpt-image 시리즈 미지원)을 포함하지 마세요. `$PROMPT`는 「프롬프트 구성」 단계에서 조합한 전체 프롬프트입니다.

호출 방식 선택: `REF_IMAGE` 미설정 → 「텍스트 투 이미지」 진행, 설정됨 → 「이미지 투 이미지」 진행.

#### 텍스트 투 이미지 (기본)

```bash
set -euo pipefail
: "${GPT_IMAGE_API_KEY:?export GPT_IMAGE_API_KEY=YOUR_KEY 를 설정하세요}"
: "${PROMPT:?프롬프트 단계에서 조합된 전체 프롬프트를 export PROMPT=... 로 설정하세요}"
BASE_URL="${GPT_IMAGE_BASE_URL:-https://api.openai.com/v1}"
MODEL="${GPT_IMAGE_MODEL:-gpt-image-2}"
SIZE="${GPT_IMAGE_SIZE:-1024x1536}"
BOOK_DIR="${BOOK_DIR:?export BOOK_DIR=./covers/<도서명> 을 설정하세요}"

mkdir -p "$BOOK_DIR/cover"

# 기존 생성된 표지를 덮어쓰지 않도록 버전 번호 자동 증가
i=1
while [ -f "$BOOK_DIR/표지/표지_v${i}.png" ]; do i=$((i+1)); done
OUT="$BOOK_DIR/표지/표지_v${i}.png"
RESP=$(mktemp)
trap 'rm -f "$RESP"' EXIT

# PROMPT 내 따옴표/줄바꿈/한글로 인한 shell 문자열 파손을 방지하기 위해 jq로 JSON 구성
BODY=$(jq -n \
  --arg m "$MODEL" \
  --arg p "$PROMPT" \
  --arg s "$SIZE" \
  '{model:$m, prompt:$p, size:$s}')

curl -fsS --max-time 180 --retry 2 --retry-delay 5 \
  "$BASE_URL/images/generations" \
  -H "Authorization: Bearer $GPT_IMAGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$BODY" > "$RESP"

# API 오류 발생 시 즉시 중단
if jq -e '.error' "$RESP" >/dev/null 2>&1; then
  echo "API error:" >&2
  jq '.error' "$RESP" >&2
  exit 1
fi

# `// empty` 처리로 누락된 필드가 "null"로 출력되는 것을 방지
jq -er '.data[0].b64_json // empty' "$RESP" | base64 --decode > "$OUT"
[ -s "$OUT" ] || { echo "empty or malformed output: $OUT" >&2; head -c 300 "$RESP" >&2; exit 1; }

# 프롬프트 사본 저장
printf '%s\n' "$PROMPT" > "${OUT%.png}.prompt.txt"

file "$OUT"
ls -lt "$BOOK_DIR/표지/"
```

#### 이미지 투 이미지 (참고 이미지 제공 시)

`/v1/images/edits`는 `multipart/form-data`를 사용하며, `Content-Type: application/json`을 사용할 수 **없습니다**. 텍스트 필드는 `--form-string`을 사용하고, 이미지 필드는 `-F image=@path`를 사용합니다.

```bash
set -euo pipefail
: "${GPT_IMAGE_API_KEY:?export GPT_IMAGE_API_KEY=YOUR_KEY 를 설정하세요}"
: "${PROMPT:?프롬프트 단계에서 조합된 전체 프롬프트를 export PROMPT=... 로 설정하세요}"
BASE_URL="${GPT_IMAGE_BASE_URL:-https://api.openai.com/v1}"
MODEL="${GPT_IMAGE_MODEL:-gpt-image-2}"
SIZE="${GPT_IMAGE_SIZE:-1024x1536}"
BOOK_DIR="${BOOK_DIR:?export BOOK_DIR=./covers/<도서명> 을 설정하세요}"
REF_IMAGE="${REF_IMAGE:?export REF_IMAGE=로컬경로_또는_URL 을 설정하세요}"

mkdir -p "$BOOK_DIR/표지"

# 버전 번호 자동 증가
i=1
while [ -f "$BOOK_DIR/표지/표지_v${i}.png" ]; do i=$((i+1)); done
OUT="$BOOK_DIR/표지/표지_v${i}.png"
RESP=$(mktemp)
REF_TMP=""
trap '[ -n "$REF_TMP" ] && rm -f "$REF_TMP"; rm -f "$RESP"' EXIT

case "$REF_IMAGE" in
  http://*|https://*)
    REF_TMP=$(mktemp)
    curl -fsSL --max-time 60 -o "$REF_TMP" "$REF_IMAGE"
    REF_LOCAL="$REF_TMP"
    ;;
  *)
    [ -f "$REF_IMAGE" ] || { echo "참고 이미지가 존재하지 않음: $REF_IMAGE" >&2; exit 1; }
    REF_LOCAL="$REF_IMAGE"
    ;;
esac

curl -fsS --max-time 240 --retry 2 --retry-delay 5 \
  "$BASE_URL/images/edits" \
  -H "Authorization: Bearer $GPT_IMAGE_API_KEY" \
  --form-string "model=$MODEL" \
  --form-string "size=$SIZE" \
  --form-string "prompt=$PROMPT" \
  -F "image=@$REF_LOCAL" > "$RESP"

if jq -e '.error' "$RESP" >/dev/null 2>&1; then
  echo "API error:" >&2
  jq '.error' "$RESP" >&2
  exit 1
fi

jq -er '.data[0].b64_json // empty' "$RESP" | base64 --decode > "$OUT"
[ -s "$OUT" ] || { echo "empty or malformed output: $OUT" >&2; head -c 300 "$RESP" >&2; exit 1; }

printf '%s\n' "$PROMPT"    > "${OUT%.png}.prompt.txt"
printf '%s\n' "$REF_IMAGE" > "${OUT%.png}.ref.txt"

file "$OUT"
ls -lt "$BOOK_DIR/표지/"
```

### Step 5: 플랫폼 업로드 크기 내보내기 (고정 픽셀 규격 필요시)

`UPLOAD_SIZE`가 지정된 경우(판치에 600×800) 원본 이미지를 **중앙 자르기+축소**하여 업로드 사본을 만듭니다.

```bash
SRC="${OUT:-$(ls -t "${BOOK_DIR:-.}"/표지/표지_v*.png 2>/dev/null | grep -v _업로드 | head -1)}"
TARGET="${UPLOAD_SIZE:-}"
if [ -n "$TARGET" ] && [ -f "$SRC" ]; then
  UP="${SRC%.png}_업로드.png"; W="${TARGET%x*}"; H="${TARGET#*x}"
  if command -v magick >/dev/null 2>&1; then M=magick
  elif command -v convert >/dev/null 2>&1; then M=convert; else M=""; fi
  if [ -n "$M" ]; then
    "$M" "$SRC" -resize "${W}x${H}^" -gravity center -extent "${W}x${H}" "$UP"
  elif command -v sips >/dev/null 2>&1; then
    cp "$SRC" "$UP"
    sw=$(sips -g pixelWidth "$UP" | awk '/pixelWidth/{print $NF}')
    sh=$(sips -g pixelHeight "$UP" | awk '/pixelHeight/{print $NF}')
    if [ $((sw*H)) -ge $((sh*W)) ]; then sips --resampleHeight "$H" "$UP" >/dev/null
    else sips --resampleWidth "$W" "$UP" >/dev/null; fi
    sips -c "$H" "$W" "$UP" >/dev/null
  else
    echo "magick/convert/sips 도구가 없어 건너뜁니다. $SRC 를 $TARGET 크기로 중앙 자르기 후 업로드하세요" >&2
  fi
  [ -f "$UP" ] && file "$UP"
fi
```

### Step 6: 품질 검사 + 피드백 반영

| 검사 항목 | 기준 |
|:-------|:-----|
| 텍스트 렌더링 | 도서명이 명확히 식별되고, 폰트 스타일이 장르와 잘 부합함 |
| 장르 부합성 | 시각적 스타일이 도서 장르와 일치함 |
| 구도의 적절성 | 주 인물/배경이 두드러지며 텍스트가 핵심 비주얼을 가리지 않음 |
| 플랫폼 적응 | 목표 플랫폼의 표지 톤앤매너에 부합함 |
| 플랫폼 규격 | 비율이 플랫폼 요구사항과 일치함 |

불만족 시 수정 방향: 구도 변경, 색조 조정, 폰트 스타일 변경, 플랫폼 스타일 변경.

---

## 참고 자료

| 파일 | 로드 시점 |
|:-----|:---------|
| [references/cover-styles.md](references/cover-styles.md) | 장르→시각 스타일 매핑, 플랫폼 스타일 상세, 프롬프트 템플릿 |

---

## 언어

- 사용자의 언어에 맞춰 응답합니다.
