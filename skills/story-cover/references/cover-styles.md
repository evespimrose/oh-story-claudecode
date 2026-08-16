# 소설 표지 시각 스타일 라이브러리
각 장르 웹소설 표지 시각 스타일 정의로, GPT-Image-2 영어 프롬프트 구성에 사용한다.

---

## 플랫폼 스타일

### 판치에 소설

시각: 고채도 고대비 / 인물 60% 이상 차지하며 얼굴 선명 / 제목 크고 굵으며 광 효과(금/빨/흰) / 증명사진 구도 + 화려한 배경
키워드: `vibrant saturated colors, eye-catching bold design, character portrait dominating frame, mass-market novel cover style, high contrast`

### 치디엔

시각: 섬세하고 정교한 사실주의 일러스트 / 구도에 계층 풍부 / 제목은 전통 붓 해체체 / 색상 차분 / 인물과 장면 균형 잡히고 영화감 있음
키워드: `polished refined illustration, detailed cinematic composition, epic atmospheric, mature sophisticated style, premium quality`

### 진장

시각: 부드러운 톤(분/보라/하늘/따뜻한 흰) / 아름다운 화풍에 큰 눈과 정교한 이목구비 / 꽃잎 보케 실크 보석 장식 / 중앙 대칭에 화면 깔끔 / 제목은 우아한 행서나 세로 원형체
키워드: `dreamy ethereal aesthetic, soft pastel tones, elegant romantic, delicate beauty, flower petals and bokeh`

### 즈후 옌옌

시각: 많은 여백의 미니멀 / 차가운 색(회/파/흰/어두운) / 분위기 > 인물 디테일, 장면/물건/추상적 이미지 많이 사용 / 제목은 모던 심플 산세리프 / 독립 영화 포스터 질감
키워드: `minimalist literary style, clean composition with negative space, subtle moody atmosphere, independent film poster aesthetic`

### 치마오

시각: 극도로 채도 높고 강렬한 임팩트 / 인물 화려한 복식과 장비 풍부 / 화염 뇌전 영력 특수효과 / 제목 대형 발광 비중 큼 / 포스터 느낌 정보 밀도 높음
키워드: `striking high-impact design, vivid dramatic colors, spectacular visual effects, attention-grabbing poster style`

### 치웨이마오

시각: 일러스트 애니메이션 2D / 색상 밝고 선 명확 / Q판 요소 / 제목 카툰 손그림풍 / 가볍고 발랄
키워드: `anime illustration style, vibrant colorful, detailed character art, Japanese light novel aesthetic`

---

## 장르 추론 규칙

| 키워드 | 장르 | 스타일 태그 |
|:-------|:-----|:---------|
| 선/도/검/령/수/종/천/제/존/신 | 판타지/선협 | xianxia fantasy |
| 도시/총재/캠퍼스/환생/시스템/학원/의사/병왕 | 도시 | urban modern |
| 비/황/후/궁/적/서/후/조/봉/란 | 고대 로맨스 | ancient romance |
| 총재/계약/대역 시집/달콤한 로맨스/아내/육아/번개 결혼 | 현대 로맨스 | modern romance |
| 괴담/사건/탐정/서스펜스/추리/밀실/연쇄 | 미스터리 스릴러 | mystery thriller |
| 성간/포스트 아포칼립스/메카/사이버/폐허/진화 | SF | sci-fi |
| 드래곤/기사/마법/이세계/엘프/영주 | 서양 판타지 | western fantasy |
| 삼국/대명/대당/전장/장군/모사 | 역사 | historical epic |
| 귀신/강시/음양/풍수/도굴/저주 | 초자연 공포 | supernatural horror |
| 귀여움/고양이/부둥부둥/어린아이/전생 | 라이트 노벨 | light novel |

---

## 프롬프트 구성 공식

```
[플랫폼 스타일] + [텍스트 레이어: 제목+작가명+폰트 디자인] + [장르 스타일 태그] + [인물 묘사]
+ [배경 요소] + [색상 지시] + [광 효과 지시] + [범용 수식어]
```

범용 수식어: `professional book cover design, high detail digital painting, portrait orientation 2:3 ratio, no watermark`

텍스트 레이어 필수 지정: 제목 내용+위치(top center)+폰트 스타일+색상; 작가명 내용+위치(bottom center)+폰트 스타일+색상

---

## 프롬프트 팁

### 텍스트 렌더링

GPT-Image-2는 중국어를 직접 렌더링할 수 있다. 형식:
```
Title text '제목' at top center in {폰트 스타일}
Author name '작가명' at bottom center in {폰트 스타일}
```

### 인물 묘사는 구체적으로

"a man" 이렇게 말고:
```
a young man in flowing white silk robes with gold embroidery,
long black hair tied in a topknot with a jade crown,
piercing dark eyes, confident expression,
holding a glowing blue spirit sword
```

### 배경 3층 구조

전경(인물/소품) → 중경(장면: 산봉/건물/숲) → 원경(분위기: 운해/성화/불꽃)

### 광 효과

| 광 효과 | 키워드 | 느낌 |
|------|--------|------|
| 신성 | `dramatic golden light from above` | 신성감 |
| 신비 | `cold moonlight from the left casting long shadows` | 신비감 |
| 따뜻 | `warm sunset glow backlighting the figure` | 따뜻한 느낌 |
| SF | `neon blue and purple lights from below` | SF 느낌 |

### 실사 사진 느낌 피하기

`digital painting style` 추가. 웹소설 표지는 일러스트 느낌이 필요하다.

### 구도 변형

| 유형 | 키워드 | 적 용 |
|:-----|:-------|:-----|
| 인물 클로즈업 | `close-up portrait, face filling upper half` | 캐릭터 강조 |
| 전신샷 | `full body shot, dynamic pose` | 복장과 동작 보여주기 |
| 순수 장면 | `no human figure, landscape composition` | 미스터리/SF |
| 듀오 | `two figures facing each other` | 로맨스류 |

---

## 스타일 라이브러리

### 판타지 / 선협

**태그**: `xianxia Chinese fantasy art style, ethereal atmosphere`
**색상**: 청람+금색+현흑, 한색 위주, 금색/따뜻한 색 광원 포인트
**인물**: 남-긴 머리 상투/가발, 검이나 법기 들고, 옷깃 휘날림 | 여-선녀 치마 휘날리며, 영수 동반, 연꽃 장식
**배경**: 운해, 선산, 고건물 누각, 영력 광 효과
**광 효과**: `divine golden light rays, mystical mist, spiritual energy glow`
**예시**:
```
Chinese web novel cover, xianxia fantasy style.
Title text '검도독존' at top center in bold golden brush calligraphy with metallic glow and sharp strokes.
Author name '청초초육' at bottom center in small refined white serif text with faint golden glow, flanked by delicate cloud-scroll ornaments, resting on a thin horizontal gold line.
A young swordsman in flowing white robes standing on a mountain peak,
holding a glowing blue spirit sword, long black hair flowing in the wind.
Ethereal clouds swirling below, dramatic golden divine light from above,
spiritual energy particles. Dark misty mountain peaks in background.
Color palette: deep blue, gold, white, black.
Professional book cover, high detail digital painting, portrait 2:3 ratio, no watermark
```

### 도시

**태그**: `modern urban contemporary style, clean cinematic composition`
**색상**: 남색+회색+금색, 네온 포인트(야경)/따뜻한 주황(황혼)
**인물**: 남-정장/캐주얼 의상에 깔끔하고 뚜렷한 윤곽 | 여-패션한 코디에 자신 있는 표정
**배경**: 도시 스카이라인, 고급 사무실, 캠퍼스, 네온 가로등
**광 효과**: `sharp city lights, sunset glow reflecting on glass buildings, neon rim light`

### 고대 로맨스 / 궁중 암투

**태그**: `ancient Chinese romance palace drama, elegant classical beauty`
**색상**: 정홍+금색+묵흑, 화려하고 무게감
**인물**: 여-화려한 예복과 봉관 장신구 정교한 메이크업 | 남-황제/장군의 위엄 또는 온화함
**배경**: 궁전, 정원, 붉은 담장, 주렴, 병풍, 등불
**광 효과**: `warm lantern light, golden candle glow, silk fabric shimmering`

### 현대 로맨스 / 달콤한 로맨스

**태그**: `modern romance cover art, soft dreamy warm atmosphere`
**색상**: 분홍+따뜻한 흰+연금, 따뜻하고 부드러움
**인물**: 듀오 구도 위주, 달콤한 인터랙션 (포옹/시선 교차/손잡기)
**배경**: 카페, 정원, 아늑한 실내, 석양 해변
**광 효과**: `soft warm backlighting, dreamy bokeh, gentle sunset glow`

### 미스터리 / 추리

**태그**: `dark mystery thriller, noir atmosphere, high contrast shadows`
**색상**: 검정+짙은 회+어두운 파랑, 피빨강/차가운 흰 포인트
**인물**: 실루엣/반가면/뒷모습, 침착하거나 긴장
**배경**: 비 오는 밤 거리, 낡은 건물, 밀실, 어두운 골목
**광 효과**: `dramatic chiaroscuro, single spotlight, rain-slicked reflections`

### SF / 포스트 아포칼립스

**태그**: `sci-fi cyberpunk, futuristic technology, post-apocalyptic`
**색상**: 남색+검정+은색, 네온 블루/전자 보라/에너지 그린 포인트
**인물**: 메카 슈트/전술복/실험실복, SF 무기/홀로그램 인터페이스
**배경**: 우주, 폐허 도시, 실험실, 우주 정거장
**광 효과**: `holographic blue glow, neon rim lighting, energy arcs`

### 서양 판타지

**태그**: `western high fantasy, epic medieval atmosphere`
**색상**: 남색+어두운 금+은백, 불꽃 빨강/마법 보라 포인트
**인물**: 기사 갑옷/법사 로브/유령 가죽 갑옷, 용/그리핀 동반
**배경**: 성, 용의 둥지, 마법진, 넓은 평야
**광 효과**: `magic spell glow, dramatic stormy sky, firelight from torches`

### 역사 / 군사

**태그**: `historical Chinese war epic, grand battlefield panorama`
**색상**: 철회+어두운 붉은+누르스름, 금갑 광택/봉화 주황 포인트
**인물**: 장군 갑옷/모사 로브, 무기 소지
**배경**: 전장, 성벽, 군영, 봉화
**광 효과**: `dramatic battlefield firelight, smoke-filled sky, sunset over war`

### 초자연 / 공포

**태그**: `Chinese supernatural horror, eerie ghostly atmosphere`
**색상**: 묵흑+유령 녹색+어두운 붉은, 종이 흰/촛불 노랑 포인트
**인물**: 도사 복장/평범한 사람이 괴이에 빠짐, 귀신 그림자/종이 인형/강시
**배경**: 묘지, 고사찰, 어두운 골목, 관
**광 효과**: `eerie green glow, flickering candlelight, cold ghostly luminescence`

### 라이트 노벨 / 서브컬처

**태그**: `anime light novel cover, vibrant colorful moe style`
**색상**: 밝고 다채로움, 별빛/꽃잎 포인트
**인물**: Q판/귀여움 캐릭터, 고양이 귀/날개 등 귀여운 속성
**배경**: 판타지 월드, 캠퍼스, 이세계, 성화
**광 효과**: `sparkly star effects, magical particle effects, soft luminous glow`
