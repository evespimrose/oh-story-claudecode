#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const USAGE = `Usage: node check-ai-patterns.js [--check] [--json] [--fail-on=blocking|all] <file...>

Detect high-risk AI-flavor prose patterns that need human rewrite:
  - negative setup followed by positive flip in the same sentence
  - comma/semicolon/colon + positive flip
  - sentence break + positive flip
  - repeated negative setup followed by positive flip
  - em-dash (기능에 따라 재작성), 짧은 마침표 (연속된 짧은 서술 문장), 긴 단락 (장면에 따라 구분)
  - 미세한 동작 반복 (「했다/잠깐 했다」 식 가벼운 보어의 고밀도, 전보체 지문)
  - 추상적 요약 반복 (운명/바둑판/이 순간 드디어 깨달음/이제 막 시작, AI 종료 어조)
  - 관용구 밀도 과다 (마치/한 줄기/깊게 숨을 쉬었다/차분한 파도 같은 금지 어휘의 집중)
  - 비유 밀도 과다 (같은/마치/흡사/그러한 식의 비유 표지가 연달아 나타남)
  - 해석 연쇄 밀도 과높음 (알다/이해하다/이는 의미한다/반드시/필요하다 등 판단 연결 집중)
  - 시스템 공지 공식 문체 과밀 (대괄호 시스템/규칙 행 강제 규칙 용어 집중)
  - 과도한 정련 짧은 문단 (긴 본문 내 짧은 서술 문단 과밀 및 자연스러운 연결 부족)
  - 낮은 연결 밀도 (따옴표 외 서술 기능어/구어적 연결 부족 및 중장문 부족, 개요/전보체처럼)
  - 감시카메라식 동작 목록 (같은 문단 내 연속 배치된 동작 동사, 시점 온도/감정 완화 부족)
  - 음량 대비 공명 (목소리가 높지 않음/크지 않음…그런데…, 실전 누락 문형)
  - 부정 대구 (X가 없고, Y가 없고…연쇄 / X가 없고…다만 Y 먼저 부정 후 긍정, 실전 누락 문형)
  - 정연한 병렬 (X에 대해 X가 아니고, 어떻게 X / 같은 동사 「V하지 않고 A, V하지 않고 B」, 대사 포함, advisory)
  - 역순 대조 (A이다, B가 아니다 — not-is의 역순 변형, 실전 누락 문형)
  - 예고식 총괄 마무리 (문말 화면 아무도 모르고/이제 막 시작/정면으로…압박해온다, 실전 누락 문형)
  - 장편 마무리 상태 요약 (문말 윈도우 이 밤은 정해진 것일까/이 모든 것이 끝났을까/새로운 인생이 이제 시작됐을까/운명의 톱니바퀴)
  - 인용부호 강조 남용 (서술 내 1-4자 단어에 인용부호 강조, 밀도형)

Each finding carries severity: blocking by default for generation/deslop cleanup (not-is-comparison / em-dash / voice-contrast / negation-parade / reverse-not-is / trailer-ending / trailer-summary). This is a local style/readability gate, not an AIGC detector score; functional human text can be marked for review instead of hard-edited for a detector.
또는 advisory (period-stutter / long-paragraph / micro-action-tic / action-list-tic / abstract-summary-tic / cliche-density-tic / metaphor-density-tic / reasoning-chain-tic / system-notice-formality-tic / overcompressed-prose-tic / low-connective-density-tic / quote-emphasis-tic / formulaic-parallelism, 는 힌트이며, justified 의 긴 추론/분위기 단락은 유지할 수 있음).
--fail-on=blocking 은 blocking finding 이 나타날 때만 종료 코드 1로 끝냄; 기본값 --fail-on=all 은 발견사항이 있으면 종료 코드 1로 끝냄.

The script reports findings only. It never rewrites text, because the safe fix is
contextual: usually delete the negative setup, write the positive term directly,
or show it via action/detail.`;

const STOP_CHARS = new Set(['。', '！', '？', '!', '?', '\n']);
const SOFT_SEPARATORS = new Set(['，', ',', '、', '；', ';', '：', ':']);
const HARD_SEPARATORS = new Set(['。', '.', '！', '!', '？', '?']);
const MAX_NEGATIVE_SPAN = 80;
const MAX_POSITIVE_SPAN = 80;

// 단편 마침표: 연속 STUTTER_MIN_RUN 개의 「서술」 짧은 문장(각 문장 가시 문자 수 ≤ STUTTER_MAX_SENTENCE)이 숨을 쉬지 않음.
// 서술 문장만 세고, 대화/댓글/시스템 안내 건너뛰기(연속된 짧은 문장은 이러한 장르의 정상적인 형태이며 단편 마침표로 간주하지 않음).
const STUTTER_MIN_RUN = 6;
const STUTTER_MAX_SENTENCE = 5;
// 긴 단락: 단일 단락 원본 문자 수가 임계값을 초과하면 샷 단위로 단락을 나누도록 안내(모바일 읽기 보수적 임계값, 정상 단락은 이보다 훨씬 낮음).
const LONG_PARAGRAPH_CHARS = 200;

// 미세 반복 동작: 「V했다/V했다 한 번/팍 두 번/조금 풀었다」 식 가벼운 보어가 서사에서 고밀도로 반복되어
// 과도하게 삭제된 텔레그램체 지문을 형성하기 쉬움. 따옴표 밖 서사만 검사; 밀도와 횟수 두 임계값을 동시에 달성할 때만 보고,
// 단일 출현은 정상 중국어임.
const MICRO_TIC_PATTERN = /완료(?:[하나둘셋몇반])?[아래진원길소리눈입기회]/g;
const MICRO_TIC_MIN_HITS = 5;
const MICRO_TIC_PER_KILO = 6;

// CCTV 카메라식 동작 목록: 같은 연속 구간에 일반적인 동작 동사를 쌓아놓음(손을 뻗다/들어올리다/가져오다/열다/내려놓다/몸을 돌리다 등),
// 쉼표/중점으로 연결하여 단계를 표로 나타낼 때, 읽는 느낌이 시점 없는 온도감의 감시 기록처럼 느껴진다. 충고만 제공합니다.
// 싸움/추격 등 기능적 동작 편성은 유지하거나 수동 검토할 수 있습니다.
const ACTION_LIST_VERB_PATTERN = /팔을뻗다|손을들다|손을내밀다|집어올리다|집어오다|꺼내다|가져오다|주머니에서꺼내다|손으로더듬다|집어올리다|쥐다|잡다|비틀다|누르다|밀어내다|열다|열다|닫다|내려놓다|건네다|들어올리다|열다|열다|열다|돌리다|쏟아내다|들어올리다|몸을돌리다|고개를돌리다|고개를들다|고개를숙이다|허리를굽히다|몸을구부리다|걸어가다|걸어가다|앉다|일어나다|쳐다보다|바라보다|응시하다|훑다/g;
const ACTION_LIST_MIN_HITS = 5;
const ACTION_LIST_MIN_SEPARATORS = 4;

// 추상적 요약 반복: 템플릿화된 문단은 종종 캐릭터의 현재 경험을 「운명/체스판/
// 이 순간 드디어 깨달았다/방금 시작되었다」라는 저자의 요약으로 끌어올린다. 개별 단어는 소재에 서비스할 수 있으나, 고밀도로 모일 때만 보고합니다.
const ABSTRACT_SUMMARY_PATTERNS = [
  /이 순간[，,]?[^\n。！？!?]{0,24}(?:드디어|비로소)(?:깨달았다|깨닫게 된다)/g,
  /이 순간부터/g,
  /(?:운명|숙명)[^\n。！？!?]{0,28}(?:톱니바퀴|바둑판|이빨|뒤바꾸다|밀어붙이다|정해진)/g,
  /벌써[^\n。！？!?]{0,8}(?:깔아놓다|준비해놓다)[^\n。！？!?]{0,8}(?:바둑판|게임)/g,
  /전례 없는(?:결의|명석함|용기|힘|공포|평온|신념)/g,
  /(?:반격|복수|전쟁|대결|이야기|운명)[^\n。！？!?]{0,12}이제야막시작되다/g,
  /(?:새로운 시작|완전히 새로운 시작)/g,
];
const ABSTRACT_SUMMARY_MIN_HITS = 3;
const ABSTRACT_SUMMARY_PER_KILO = 4;

// 템플릿 사용 빈도: 단일 「마치/한 줄기」는 정상적인 중국어일 수 있지만, 높은 밀도로 집중될 때 템플릿 음성이 형성됩니다.
// 단어 목록은 이 repo의 banned-words에서 이미 명확하게 높은 위험으로 표시된 형태만 수집하며, 일반적인 기능어를 무분별하게 포함시키지 않습니다.
const CLICHE_PATTERNS = [
  /마치|마치|마치|마치/g,
  /한줄기|한움큼|다소|약간|희미하다/g,
  /깊게숨을쉬다|천천히|미묘하게|살짝|담담하게/g,
  /눈빛이 스쳐 지나가거나|입꼬리가 올라가거나|눈빛이 미세하게 번쩍이거나|손가락 마디가 창백해지거나|눈빛이 예리하거나|눈빛이 날카로워지거나/g,
  /가슴 속에서 솟아오르거나|가슴이 철렁했거나|가슴이 철렁 내려앉았거나|마음으로 모든 것을 깨닫았거나|가슴속으로 중얼거리거나|가슴이 철렁 내려앉았거나/g,
  /의심의 여지가 없거나|놀라울 정도로 자명하거나|쉽게 눈에 띄지 않거나|명백하게 드러나거나|의심할 여지가 없거나|부인할 수 없거나/g,
  /소리는 작지만[،,]?담담한|감정이 드러나지 않는|담담한|목소리가 평탄한|감정을 알 수 없는/g,
  /언제부턴가|손쉽게 얻을 수 있는|소리 없이 출렁이는|침묵(?:이[^。！？!?\n]{0,16})?퍼져나가는|말로 표현하기 어려운/g,
  /~한 냄새를 풍기는|차가운 빛|유독 눈에 띄는|깊고 차가운/g,
];
const CLICHE_DENSITY_MIN_HITS = 8;
const CLICHE_DENSITY_PER_KILO = 12;

// 비유 밀도: 단일 일상적 비유는 장면에 효과적; "마치/마치/마치/마치" 같은 표현이 반복될 때,
// AI식 수사 누적이 되기 쉬움. 권고만 제공, 수정 방법은 필요한 수량까지 삭제하고 구체적 장면으로 돌아가기,
// "처럼"을 다른 비유 표현으로 바꾸는 것이 아닙니다.
const METAPHOR_MARKER_PATTERN = /마치|마치도|그러한 것처럼|마치|마찬가지로|꼭|(?<![불머리사진영상촬영초상])처럼(?![얼굴상징])/g;
const METAPHOR_LIKE_PHRASE_PATTERN = /(?:죽은|물|얼음|불|물결|돌|나무|기계|종이|철|유령|시체|칼|바늘|그물|벽)처럼/g;
const METAPHOR_DENSITY_MIN_HITS = 7;
const METAPHOR_DENSITY_PER_KILO = 3;

// 설명 연결 밀도: 흔한 "그는 알았다/그는 깨달았다/이것은 의미한다/반드시 필요하다"
// 독자를 위해 연속으로 추론을 대체하면 읽는 감각이 보고서 같습니다. 단일 판단 단어는 추론에 도움이 될 수 있지만, 높은 밀도로 집중되어야만 현재 상황의 증거로 돌아가도록 암시합니다.
const REASONING_CHAIN_PATTERNS = [
  { key: 'mental', core: true, pattern: /(?<![不没未无])(?:他|她|我)?(?:알다|이해하다|인식하다|명확하다|판단하다|확인하다|분석하다)/g },
  { key: 'connector', core: true, pattern: /이는 의미한다|즉|다시 말해|진정한 문제(?:는)?|문제는|핵심은|이 경우|이 논리에 따르면|이렇게만|여기까지 생각하면/g },
  { key: 'modal', core: true, pattern: /(?:(?<!불)(?:반드시|필요하다|해야 한다|~이면|그러면|가능하다|할 수 있다|할 수 있다|할 수 없다)|할 수 없다)[^。！？!?\n]{0,16}(?:판단|확인|감당|유지|안정시키다|통제|확대|통제 불능|야기하다|초래하다|이해|기본값|귀가|입장|점검|선별|감소|수립|위험|결과|질서|책임)/g },
  { key: 'abstract', core: false, pattern: /(?:과제|조건|위험|출처|논리|상황|결과|책임|질서|규칙|정보 부족|의사결정 능력)/g },
];
const REASONING_CHAIN_MIN_HITS = 8;
const REASONING_CHAIN_CORE_MIN_HITS = 4;
const REASONING_CHAIN_MIN_BUCKETS = 2;
const REASONING_CHAIN_PER_KILO = 18;

// 시스템 공지 공문 톤: 대괄호 규칙/패널 행의 하드 규칙 단어만 참조.
// 이것은 특정 주제 용어 목록이 아닙니다. 단일 엄격한 규칙, 일상 서술 또는 일반 대화는 트리거되지 않습니다.
const NOTICE_FORMAL_PATTERNS = [
  /불가|필수|금지|금지|엄격히 금지|해야 함|필요|꼭 필요/g,
  /현재|본 공지|본 규칙|본 시스템|알림|작업 실패|임시 권한|권한|상태|레벨/g,
  /유지|공용 영역|질서|우선|처벌|처벌|위반|명령|실행/g,
  /간주됨|동일하게 계산됨|계산됨|부담|책임|단위|회수|전달|스크린샷/g,
];
const NOTICE_FORMAL_CORE_PATTERN = /불가|필수|불가능|금지|엄격히금지|마땅하다|필요|필요|반드시|간주|동일하게포함|포함/g;
const NOTICE_FORMAL_MIN_LINES = 4;
const NOTICE_FORMAL_MIN_HITS = 12;
const NOTICE_FORMAL_CORE_MIN_HITS = 5;
const NOTICE_FORMAL_PER_KILO = 60;

// 과도한 압축 단문: 과도한 처리 샘플에서 흔히 15자 이내 서술 단락이 대량으로 나타나며, "의/었/그냥/으며/었/네/걸/아" 등
// 자연 연결이 부족함; 대조 텍스트는 보통 더 많은 자연 연결을 유지함. 이 항목은 advisory만 수행하며, 기계적 물타기는 금지.
const OVERCOMPRESSED_PROSE_PARTICLE_PATTERN = /[의었그냥으며네걸아야마]/g;
const OVERCOMPRESSED_PROSE_MIN_CHARS = 1200;
const OVERCOMPRESSED_PROSE_MIN_PARAS = 45;
const OVERCOMPRESSED_PROSE_SHORT_MAX_CHARS = 15;
const OVERCOMPRESSED_PROSE_SHORT_RATIO = 0.58;
const OVERCOMPRESSED_PROSE_PARTICLE_PER_KILO = 85;

// 낮은 연결 밀도: 단순 낮은 기능어는 많은 중장 문장이 있는 텍스트를 잘못 포착함;
// 따라서 "중장문 부족"을 중첩하고 인용부호 외부 서술만 확인해야 합니다. 이는 과도하게 압축된 짧은 윈도우의 보충으로, 자문 용도일 뿐입니다.
const LOW_CONNECTIVE_FUNCTION_TERMS = ['의', '었다', '그러면', '에', '이다', '도', '모두', '여전히', '또', '把', '被', '주다', '이것', '그것', '안쪽', '이후', '때', '지금', '때문에', '그래서', '하지만', '그러나', '그 다음', '이미', '아니면', '일어나다', '나오다', '계속되다'];
const LOW_CONNECTIVE_PLAIN_TERMS = ['的', '了', '就', '也', '还', '又', '这个', '那个', '东西', '事情', '时候', '里面', '以后', '一下', '一点', '有点', '还是'];
const LOW_CONNECTIVE_MIN_CHARS = 800;
const LOW_CONNECTIVE_FUNCTION_PER_KILO = 100;
const LOW_CONNECTIVE_PLAIN_PER_KILO = 65;
const LOW_CONNECTIVE_LONG_SENTENCE_CHARS = 30;
const LOW_CONNECTIVE_LONG_SENTENCE_RATIO = 0.08;

// either-or「not A then B / not A also is B」에서 바짝 붙은「是」는 연결사의 일부이며, 긍정 동사가 아닙니다.
// 「不」을 포함한 경우 「not A, also not B」의 두 번째 부정 구간을 기존 배제 방식에 따라 반전으로 계산하지 않습니다.
const COMPACT_EITHER_OR_PREV = new Set(['不', '就', '也']);
// 문장 끝의 어기조사/수사적 의문; 「…, is that right / right? / hmm」는 수사적 의문 어미이지, 부정 뒤의 긍정 전환이 아닙니다.
const TAG_PARTICLES = new Set(['마', '바', '마']);
// 단락 시작 확인 표현; 「아니 첫 방문이 아니다. 맞다, 그는 여전히 기억했다……」에서의 「맞다/그래」
// 는 앞 내용을 승인하는 표현이지, 「아니 A, B다」의 긍정 전환이 아닙니다.
const AFFIRMATION_TAG_PARTICLES = new Set(['의', '아', '야', '네']);
const AFFIRMATION_TAG_BOUNDARY = new Set(['', '，', ',', '。', '.', '！', '!', '？', '?', '、', '；', ';', '：', ':', '\n', '\r', '\t', ' ']);

// 쌍을 이루는 따옴표(대사/시스템 알림/댓글)의 문자 쌍, stripQuoted와 quotedRanges가 같은 출처를 공유합니다.
// 따옴표 조각은 줄을 넘지 않습니다(문자 클래스에서 \n 제외): 본문에서 닫는 따옴표를 빠뜨리는 것이 흔합니다(여러 문단의 대사가 마지막 문단에서만 마무리됨,
// 전각과 반각 따옴표 혼용으로도 빠지곤 함). 줄을 넘는 쌍을 허용하면, 닫혀 있지 않은 하나의 열린 따옴표가 뒤에 있는 수백 개에서 수천 개의 문자를 모두
// 「인용 부호 내」에서는 quotedRanges의 소비자(not-is 줄 간 스캔)가 전체 서술을 자동으로 제외하도록 합니다.
const QUOTE_PAIRS = [['「', '」'], ['『', '』'], ['【', '】'], ['"', '"'], [''', '''], ['"', '"'], ["'", "'"]];
const QUOTE_SOURCES = QUOTE_PAIRS.map(([open, close]) => `${escapeRegExp(open)}[^${escapeRegExpCharClass(close)}\\n]*${escapeRegExp(close)}`);

// ---- 실전 테스트 누락 문장 유형(출처: 실전 저술에서 포착한 실제 누락 예문; 2026-07 보정) ----
// 보정 기준선: 《만강》 원문 정문 20장(제1/10/20/…/190장) + demo 이전 20장.
// blocking 규칙은 실제 말뭉치 명중률 ≈0(20장마다 ≤1건 및 인적 판정으로 해당 문장 유형 확인); 데이터는 각 규칙 주석 참조.

// 음량 대조 패턴(실제 누락 A): "음량이 크지 않지만 첫 문장이 홀로 전체 홀을 압도했다."
// 이전 네트 패턴은 음량 밀도 버킷의 "음량이 크지 않지만 ~을 가져"만 있고, 음량 단어/전환 단어가 바뀌면 누락됨.
// 인용부호 외 서술은 곳곳에 차단됨; 수정 방법은 사전 铺垫을 삭제하고 음성이 현장에 직접 떨어지는 구체적 효과를 작성함.
// 보정: 《만강》 20장 0개 명중, 데모 전 20장 0개 명중.
const VOICE_CONTRAST_PATTERN = /음성(?:그리고)?이(?:크지|높지|크지)[^。！？!?\n]{0,16}않[다지만편]/g;

// 부정 대구(실전 누락 B): 「반주 없이, 화성 없이, 프롬프터 없이.」같은 문장에 ≥2개의 「없이X,」 연속 배열;
// 변형 「그는 기교를 자랑하지 않았고, 그런 식의 기세를 보이지 않았다. 그는 그저 노래했을 뿐」먼저 부정으로 부연 설명한 후, 「그저/그저만/오직」으로 긍정으로 마무리.
// 「없음/없다」 구간만 수집하고, 「안 X」 구간은 수집하지 않음——실제 인물 서술에서 「울지도 않고 떼도 쓰지도 않으며」 같은 표현이 너무 흔해서 수집해봤자 오탐 대비 효과 없음.
// 단독 「없다」는 두 가지 비부정 용법도 차단해야 함, 그렇지 않으면 정상적인 서술이 대구로 판정됨:
//   1) 접착 어근(침몰/수몰/매몰/출몰/은몰…)——앞글자 제외, 「배가 안개 속에 침몰했고, 돌아보는 사람 없고, …오직…」은 해당 안 함;
//   2) 시간 관용구(没多久/没过多久/没等X)—— 후행 글자 제외, 「没多久，没等她撑伞，…只有…」은 해당 안 함.
// 「没有X」 구문은 이 두 가지 중의성을 포함하지 않음(점착 형태소 후행에 「有」이 나올 수 없음, 시간 관용구는 이미 후행 글자 제외로 커버됨),
// 첫 번째 연쇄 방식은 여전히 보호 메커니즘을 추가하지 않음.
// 보정: 《만강》20장 0건 적중, demo 전 20장 0건 적중.
const NEGATION_PARADE_PATTERNS = [
  /(?:없는[^。！？!?\n，,]{1,12}[，,]){2}/g,
  /(?<![沉淹埋出隐湮吞覆漫泯])没(?!有?过?多久)(?:有)?[^。！？!?\n，,]{1,12}[，,]\s*没(?!有?过?多久)(?:有)?[^。！？!?\n，,]{1,16}[，,。.][^。！？!?\n，,]{0,6}只(?:是|会|有)/g,
];
const CROSS_NEGATION_START = /^아니라[^。！？!?\n]{1,24}[。！？!?]?$/;
const CROSS_NEGATION_MIDDLE = /^(?:도|역시)아니라[^。！？!?\n]{1,24}[。！？!?]?$/;
const CROSS_NEGATION_END = /^단지[^。！？!?\n]{1,32}[。！？!?]?$/;

// 두 가지 흔한 대칭 구조인데 직접 오류로 판정할 수 없는 경우. 권장 사항으로만 처리. blocking 규칙과 다르게 여기서는 의도적으로 스캔
// 댓글: 자연스러운 주문 「매운맛 없이, 파 없이」는 객체 최단 길이로 제외; 더 긴 동사 목록은 의미론 검토 판단 기능으로 전달합니다.
const DECISION_FRAME_PATTERN = /至于([\u3400-\u9fff]{1,3})불\1[，,]\s*어떻게\1/g;
const REPEATED_NEGATIVE_VERB_PATTERN = /불([\u3400-\u9fff]{1,2})([\u3400-\u9fff]{2,8})[，,]\s*불\1([\u3400-\u9fff]{2,8})/g;

// 역순 대비 톤 (실전 누락 C): 「진짜 목소리지, 음성 보정으로 만들어진 게 아니야」——not-is-comparison의 역순 변형.
// not-is의 제외 인프라 재사용: 인용부호 내 제거 (maskQuoted), 「네/맞아」 확인 태그 (isAffirmationTagAt);
// 선행 문자 제외 대상을 양자택일의 부/취/야에서 전체「X是」연결사/부사 합성어로 확대(还是/只是/可是/但是/
// 于是/倒是/像是/若是/要是/正是/便是/总是/老是/更是/最是/算是/怕是/凡是/或是/即是/自是/
// 참으로/원래/본래/여전히/혹시/오로지/단지/오직/전부); 「是不是」 의문문 문두와「不是吗/不是么/
// 不是吧」 반문 문미는 별도로 제외.
// 보정: 《만강(万疆)》 20장 0건 발견, demo 전 20장 0건 발견, blocking으로 구현.
const REVERSE_NOT_IS_PATTERN = /是([^。！？!?\n，,]{1,12})[，,]\s*(?:而)?不是([^。！？!?\n]{1,20})/g;
const REVERSE_NOT_IS_PREV_EXCLUDE = new Set([...COMPACT_EITHER_OR_PREV, '여전히', '오직', '가능', '그러나', '~에서', '도리어', '같이', '만약', '만약', '바로', '곧', '항상', '늙은', '더욱', '최고', '계산', '두려워', '모든', '또는', '즉', '자신', '정말', '원래', '본래', '여전히', '혹시', '오로지', '오직', '단지', '전부']);

// 예고식 완결 마무리(실전 누락 D): 「아무도 모르지만, 이제 겨우 시작이야.」「한 번의…충격 릴레이, 정면으로…천천히 밀려오고 있다.」
// 장 끝에서 독자에게 다음 장의 방향을 예고하는 것이 AI 마무리 어조다. 문말 윈도우만 검사(인용부호 제거 후 표시된 글자 수, 행 단위로 정수화).
// 본문 중간의 「아무도 모르지만」은 대부분 일반 서술이므로 오인하지 않음; 인용부호 내 대사(「아무도 모르지만…」)는 계산하지 않음.
// "정식으로 막을 올리다"는 현장 이벤트의 진행 안내 표현(실제 말뭉치 "종소리가 다시 울리고, 경기가 정식으로 막을 올렸다")이다.
// 내레이터의 예고가 아니므로 후행 lookbehind로 제외한다.
// 검증: 《万疆》 20장에서 "정식으로 막을 올리다" 2개 진행 안내 문장 제외 후 0건, demo 전 20장 0건.
const TRAILER_ENDING_PATTERN = /아무도 모르다|아무도 알지 못하다|누구도 예상하지 못하다|뜻밖에도|(?:이제)?방금 시작(?:되다|하다)|정(?:면으로|향해)[^。！？!?\n]{0,24}(?:누르다|밀려오다|습격하다|위협하다)(?:했다|해오다|오다)|(?<!정식으로)막을 올리다(?:서막|장막)|곧(?:시작|다가올|내려올)/g;
const TRAILER_ENDING_WINDOW_CHARS = 600;

// 장 말미 상태 요약체: 세부 구성안 "결말 설정/종결 상태"를 요약 문장으로 그대로 작성하여 장을 마감한다("이 밤은 필연코 아무도 잠들지 못할 것이다"
// 「이 모든 게 끝났다」「새로운 인생이 이제 막 시작된다」「운명의 톱니바퀴」). trailer-ending과 같은 종료 창을 공유하는데,
// 차이점은 이것은 과거를 봉인하고 trailer-ending은 미래를 예고한다는 것. 모두 banned-words에서 이미 이름별로 차단한 형태를 수집한다.
// 「(이|그) 순간…드디어 깨달았다」는 수집하지 않음: 실제 언어 데이터에서는 정상적인 인지 리듬이고, 단편 1인칭 판단 문장도 여전히 판매 포인트
// (short-craft「판단 금언 / 심정 여운」), 밀도형은 advisory의 abstract-summary-tic에서 처리.
// 각 분기는 모두 문장 끝의 단언 위치에 도달해야 함. 그렇지 않으면 조건 종속절(이 모든 게 끝날 때까지, 우리는…), 술어보어 구조가 흡수됨
// (이 모든 것이 매우 명확하게 설명된다), 숙어 교차 매칭 (이 순간… 운명이 정해진다), 계사문 (이 전투의 결과는 정해진 것이다), 
// 및 타동사 용법 (이렇게… 이 주제가 끝났다), 장면 보도 (이렇게… 발표… 원만하게 막을 내린다) 및 부정 인식
// (그는 이 모든 것이 무엇을 의미하는지 알지 못한다)——마지막 클래스는 (?!什么) 간접 의문을 제거하는 방식으로, 이는 도장의 반대편이다.
// 교정 (문말 600자 윈도우, 수동 검토 항목별 적중): qimao 장 중 단락 20000장 적중 1회 (0.005%), 
// heiyan 전체 문서 3999편 적중 22회 (0.550%, 모두 위의 금지된 형태들); 동일 배치에 이미 존재하는 trailer-ending
// 각각 1.345% / 6.602%로 적중——본 규칙의 오탐율이 기존 온라인 동일 윈도우 규칙보다 현저히 작음. 단편은 전체 수거, 
// 기선이 장편 중반보다 자연스럽게 높으므로 두 가지 전체는 각각 집계함.
const TRAILER_SUMMARY_PATTERN = /이(?:밤|날|순간|전투|해|국면|전역)[，,]?[^。！？!?，,\n]{0,6}(?<!명중)(?<!는)필연적[^。！？!?\n]{0,8}[。！]|이렇게[，,][^。！？!?，,\n]{0,8}(?:모든|전부)[^。！？!?，,\n]{0,4}(?:끝났다|낙막|종료)[。！]|이 모든[，,]?[^。！？!?，,\n]{0,6}(?:모두)?(?:의미하다|뜻하다|끝났다)(?!의)(?:(?!무엇)[^。！？!?\n]){0,6}[。！]|(?:새로운 장|새로운 여정|새로운 장|새로운 인생)[^。！？!?\n]{0,6}(?:시작|개시|전개)|운명[^。！？!?\n]{0,6}톱니바퀴/g;

// 따옴표 강조 오용(실전 누락 E, advisory 밀도형, 스타일 metaphor-density-tic):
// 서술에서 짧은 단어에 따옴표 강조(그는 "감시자"로 초대되었다). 서술층 1-4자 쌍 따옴표 구간만 집계;
// 제외 항목: 【】시스템 패널 캐리어, 인용 동사(말하다|도다|묻다|외치다|답하다|읽다|부르다|돌아오다|고함|중얼거리다, 세밀하게 욕하다|쓰다|읽다|노래하다)
// 앞 6자/뒤 3자에 인접한 극히 짧은 대사, 인용부호 내 문장 부호가 있는 대사, 인용부호 밖에 서술이 없는 행(독립 대사/
// 댓글 흐름/의성어 연발), 인용부호 중첩(대사 내 강조). 전문에 ≥3곳 있으면 1개 항목 보고——단일 강조는
// 정상 수사법이고, 밀도가 높아야 템플릿 톤입니다.
// 보정: demo 앞 20장 0장 임계값 초과; 《万疆》20장 2장 임계값 초과(포스터 문구 "나는 번성의 도시에 있다" 시리즈,
// "도전장" 등의 인용 전달 매체도 실제 사람들이 이렇게 작성하므로, 이 규칙은 자문(advisory) 수준만 제공하고 차단(blocking)으로 상향하지 않습니다.
const QUOTE_EMPHASIS_MIN_HITS = 3;
const QUOTE_EMPHASIS_MAX_VISIBLE = 4;
const QUOTE_EMPHASIS_SPEECH_VERB_PATTERN = /[말하다 도다 묻다 외치다 대답하다 읽다 외치다 욕하다 써내다 읽다 부르다 중얼거리다]/;

const options = {
  json: false,
  files: [],
  failOn: 'all',
};

for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === '--check') {
    // Accepted for symmetry with normalize-punctuation.js; detection is always check-only.
  } else if (arg === '--json') {
    options.json = true;
  } else if (arg.startsWith('--fail-on=')) {
    const v = arg.slice('--fail-on='.length);
    if (v !== 'blocking' && v !== 'all') die(`--fail-on must be 'blocking' or 'all'`);
    options.failOn = v;
  } else if (arg === '-h' || arg === '--help') {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  } else if (arg.startsWith('-')) {
    die(`Unknown option: ${arg}`);
  } else {
    options.files.push(arg);
  }
}

if (options.files.length === 0) {
  die('No files provided');
}

let failed = false;
const allFindings = [];

for (const file of options.files) {
  const fullPath = path.resolve(file);
  let input;
  try {
    input = fs.readFileSync(fullPath, 'utf8');
  } catch (error) {
    failed = true;
    if (!options.json) console.error(`${file}: unable to read (${error.message})`);
    continue;
  }

  const findings = scanDocument(input).map((finding) => ({ file, ...finding }));
  allFindings.push(...findings);
}

if (options.json) {
  process.stdout.write(`${JSON.stringify({ findings: allFindings }, null, 2)}\n`);
} else {
  for (const finding of allFindings) {
    console.log(`${finding.file}:${finding.line}:${finding.column}: [${finding.severity}] ${finding.type}: ${finding.message} (${finding.excerpt})`);
  }
}

if (failed) process.exit(2);
// --fail-on=blocking은 차단(blocking) 발견 시에만 종료 코드 1로 반환(자문은 보고만 함); 기본값 all은 「모든 발견 시 1」 정책을 유지합니다.
const hasBlocking = allFindings.some((f) => f.severity === 'blocking');
if (options.failOn === 'blocking' ? hasBlocking : allFindings.length > 0) process.exit(1);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeRegExpCharClass(text) {
  return text.replace(/[\\\]^-]/g, '\\$&');
}

function die(message) {
  console.error(message);
  console.error(USAGE.trimEnd());
  process.exit(2);
}

function scanDocument(input) {
  const lines = input.split(/\r?\n/);
  const findings = [];
  let fence = null;
  let inFrontMatter = hasYamlFrontMatter(lines);
  let block = [];
  const proseLines = [];

  const flushBlock = () => {
    if (block.length === 0) return;
    findings.push(...scanBlock(block));
    block = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (inFrontMatter) {
      if (index > 0 && trimmed === '---') inFrontMatter = false;
      continue;
    }

    const fenceMarker = parseFenceMarker(trimmed);
    if (fence) {
      if (fenceMarker && fenceMarker.char === fence.char && fenceMarker.length >= fence.length) {
        fence = null;
      }
      continue;
    }

    if (fenceMarker) {
      flushBlock();
      fence = fenceMarker;
      continue;
    }

    block.push({ text: line, lineNo: index + 1 });
    proseLines.push({ text: line, lineNo: index + 1 });
  }

  flushBlock();
  findings.push(...scanProsePatterns(proseLines));
  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}

// 단락 수준 검사: 단편적 문장 부호(연속 짧은 서술문), 긴 단락, 대시(기계적 치환이 아닌 기능 기반 수정).
function scanProsePatterns(proseLines) {
  const findings = [];

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed)) continue;

    const dashPattern = /——|—|--+/g;
    let dash;
    while ((dash = dashPattern.exec(text)) !== null) {
      findings.push({
        line: lineNo,
        column: dash.index + 1,
        type: 'em-dash',
        severity: 'blocking',
        message: '대시를 기능에 맞게 수정: 중단→액션 beat/단문, 음 연장→생략 또는 액션, 삽입 설명→쉼표/콜론; 무조건 문장 부호로 바꾸지 말 것.',
        excerpt: compact(text.slice(Math.max(0, dash.index - 8), dash.index + dash[0].length + 8)),
      });
    }

    if (trimmed.length > LONG_PARAGRAPH_CHARS) {
      findings.push({
        line: lineNo,
        column: 1,
        type: 'long-paragraph',
        severity: 'advisory',
        message: `문단이 너무 깁니다(${trimmed.length} 자）：샷/새 액션/새 단서/시선 전환마다 끊으세요. 한 문단으로 쭉 이어가지 마세요.`,
        excerpt: compact(trimmed.slice(0, 40)),
      });
    }
  }

  findings.push(...findVoiceContrast(proseLines));
  findings.push(...findNegationParade(proseLines));
  findings.push(...findFormulaicParallelism(proseLines));
  findings.push(...findReverseNotIs(proseLines));
  findings.push(...findTrailerEnding(proseLines));
  findings.push(...findQuoteEmphasisTic(proseLines));
  findings.push(...findPeriodStutter(proseLines));
  findings.push(...findMicroActionTic(proseLines));
  findings.push(...findActionListTic(proseLines));
  findings.push(...findAbstractSummaryTic(proseLines));
  findings.push(...findClicheDensityTic(proseLines));
  findings.push(...findMetaphorDensityTic(proseLines));
  findings.push(...findReasoningChainTic(proseLines));
  findings.push(...findNoticeFormalityTic(proseLines));
  findings.push(...findOvercompressedProseTic(proseLines));
  findings.push(...findLowConnectiveDensityTic(proseLines));
  return findings;
}

// 음량 대조 문법(실전 누락 A)：인용부호 밖 서술이 곳곳이 blocking되고, 위치와 발췌는 원문에서 취함
// (maskQuoted 등길 자리지킴으로 오프셋 유지; 적중 구간에 물음표 자리지킴이 없으므로 자리지킴 영역에 들어가지 않음).
function findVoiceContrast(proseLines) {
  const findings = [];

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed)) continue;
    const masked = maskQuoted(text);
    VOICE_CONTRAST_PATTERN.lastIndex = 0;
    let match;
    while ((match = VOICE_CONTRAST_PATTERN.exec(masked)) !== null) {
      findings.push({
        line: lineNo,
        column: match.index + 1,
        type: 'voice-contrast',
        severity: 'blocking',
        message: '음량 대조 문법: "소리가 크지 않다/높지 않다…인데도/하지만…"은 AI 고빈도 대조 템플릿; 음량 铺垫을 삭제하고 소리가 현장에 떨어지는 구체적인 효과를 직접 쓰세요(누가 손을 멈췄는지, 어느 줄이 조용해졌는지).`,
        excerpt: compact(text.slice(match.index, match.index + match[0].length)),
      });
    }
  }

  return findings;
}

// 부정 대구(실전 누락 B)：동일 문장 내 「X가 없고,」 연쇄 / 선부정 후 「오직」으로 긍정을 맺음.
// 같은 텍스트 구간에서 중복 매칭될 수 있으므로, 구간 기준으로 중복 제거하여 한 번만 보고합니다.
function findNegationParade(proseLines) {
  const findings = [];

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed)) continue;
    const masked = maskQuoted(text);

    const spans = [];
    for (const pattern of NEGATION_PARADE_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(masked)) !== null) {
        spans.push([match.index, match.index + match[0].length]);
      }
    }
    spans.sort((a, b) => a[0] - b[0]);

    let lastEnd = -1;
    for (const [start, end] of spans) {
      if (start < lastEnd) {
        lastEnd = Math.max(lastEnd, end);
        continue;
      }
      lastEnd = end;
      findings.push({
        line: lineNo,
        column: start + 1,
        type: 'negation-parade',
        severity: 'blocking',
        message: '부정 배열: 「X가 없고, Y도 없고…」/「X가 없고, Y도 없고, 단지 Z일 뿐」은 AI의 고빈도 배열 패턴입니다. 부정 목록을 삭제하고 현장에서 실제로 있는 것을 직접 작성하세요. 최대 정보량이 가장 많은 부정 표현 하나만 남겨두세요.',
        excerpt: compact(text.slice(start, end)),
      });
    }
  }

  return findings;
}

function findFormulaicParallelism(proseLines) {
  const findings = [];

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed)) continue;
    for (const [pattern, message] of [
      [DECISION_FRAME_PATTERN, '「X를 X하지 않는 것에 대해, 어떻게 X하는가」는 같은 결정을 정돈된 카테고리로 분해합니다. 단순히 세부 개요를 반복한 것이라면 캐릭터의 현재 판단이나 직접적인 행동 하나로 압축하세요.'],
      [REPEATED_NEGATIVE_VERB_PATTERN, '같은 동사의 「V하지 않고 A, V하지 않고 B」는 부정 목록으로 쓰기 쉽습니다. 대사도 문맥에 따라 재검토하고, 실제로 기능하는 항목 하나만 유지하면 됩니다.'],
    ]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        findings.push({
          line: lineNo,
          column: match.index + 1,
          type: 'formulaic-parallelism',
          severity: 'advisory',
          message,
          excerpt: compact(match[0]),
        });
      }
    }
  }

  // 구간을 넘나드는 「A가 아니다 / B도 아니다 / 단지 C일 뿐」은 세부 개요 반복일 수도 있고, 정상적인 표현일 수도 있습니다.
  // Assertion, suspense elimination, or emotional progression. Pure syntax cannot reliably distinguish, so only advisory is given, delegated to semantic review.
  const window = [];
  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed) continue;
    if (isDivider(trimmed) || isStructural(trimmed)) {
      window.length = 0;
      continue;
    }
    if (window.length && lineNo - window[window.length - 1].lineNo > 2) window.length = 0;
    window.push({ text: maskQuoted(trimmed), original: trimmed, lineNo });
    if (window.length > 3) window.shift();
    if (window.length !== 3) continue;
    if (!CROSS_NEGATION_START.test(window[0].text)
      || !CROSS_NEGATION_MIDDLE.test(window[1].text)
      || !CROSS_NEGATION_END.test(window[2].text)) continue;
    findings.push({
      line: window[0].lineNo,
      column: 1,
      type: 'formulaic-parallelism',
      severity: 'advisory',
      message: '연속 문단의 「not… / not… / only…」는 대칭적 부정 나열일 수도, 해명이나 긴장 완화를 담당할 수도 있습니다. 전체 맥락을 읽고, 반복 구조나 화면 전개가 지연될 때만 수정하세요.',
      excerpt: compact(window.map((entry) => entry.original).join(' / ')),
    });
  }

  return findings;
}

// 역순 대비 톤(실전 누락 C): 「is A, not B」. 기반 시설 재사용 not-is-comparison 제외:
// 인용부호 내 분리, 「yes/yeah」 확인 표현; 앞 글자 복합어와 반문 어미는 REVERSE_NOT_IS_PREV_EXCLUDE 주석 참조.
function findReverseNotIs(proseLines) {
  const findings = [];

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed)) continue;
    const masked = maskQuoted(text);
    REVERSE_NOT_IS_PATTERN.lastIndex = 0;
    let match;
    while ((match = REVERSE_NOT_IS_PATTERN.exec(masked)) !== null) {
      const start = match.index;
      // 「just is/also is/still is/only is/but is…」의 「is」는 복합어 일부이며, 긍정 계동사가 아닙니다.
      if (REVERSE_NOT_IS_PREV_EXCLUDE.has(masked[start - 1])) continue;
      // "是不是…" 의문문 시작 패턴.
      if (masked[start + 1] === '不') continue;
      // "是的，…不是…" 확인 연결 표현 (not-is 판정 재사용).
      if (isAffirmationTagAt(masked, start)) continue;
      // "…，不是吗/不是么/不是吧" 반문 종료 표현.
      if (/^[吗么吧]/.test(match[2])) continue;
      findings.push({
        line: lineNo,
        column: start + 1,
        type: 'reverse-not-is',
        severity: 'blocking',
        message: '역순 대비 문체: 「A이고, B가 아니다」와 「A가 아니고, B이다」가 같은 계열; 뒤에 붙은 부정을 삭제하고, A의 구체적 모습을 직접 쓰거나 세부 사항으로 독자가 스스로 대비하게 하세요.',
        excerpt: compact(text.slice(start, start + match[0].length)),
      });
    }
  }

  return findings;
}

// 예고식 요약 마무리(실전 누락 D): 파일 끝 구간만 검사합니다. 파일 끝에서 거슬러올라가며 서술 행을 수집합니다.
// 인용부호를 제거한 후 보이는 글자 수가 구간 크기에 도달할 때까지(행 단위로 올림, 경계 행은 전체 계산).
function findTrailerEnding(proseLines) {
  const windowLines = [];
  let accumulated = 0;

  for (let i = proseLines.length - 1; i >= 0 && accumulated < TRAILER_ENDING_WINDOW_CHARS; i -= 1) {
    const { text } = proseLines[i];
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed)) continue;
    windowLines.unshift(proseLines[i]);
    accumulated += visibleLength(stripQuoted(trimmed));
  }

  const findings = [];
  for (const { text, lineNo } of windowLines) {
    const masked = maskQuoted(text);
    TRAILER_ENDING_PATTERN.lastIndex = 0;
    let match;
    while ((match = TRAILER_ENDING_PATTERN.exec(masked)) !== null) {
      findings.push({
        line: lineNo,
        column: match.index + 1,
        type: 'trailer-ending',
        severity: 'blocking',
        message: '예고식 요약 마무리: 「아무도 몰랐다/방금 시작됐다/정말로…압박해온다」는 AI 장 끝 예고 문체입니다; 마무리는 구체적 동작, 장면 또는 한 줄의 대사에서 멈추고, 독자를 위해 다음 장을 예고하지 마세요.',
        excerpt: compact(text.slice(match.index, match.index + match[0].length)),
      });
    }
    TRAILER_SUMMARY_PATTERN.lastIndex = 0;
    let summaryMatch;
    while ((summaryMatch = TRAILER_SUMMARY_PATTERN.exec(masked)) !== null) {
      findings.push({
        line: lineNo,
        column: summaryMatch.index + 1,
        type: 'trailer-summary',
        severity: 'blocking',
        message: '장 끝 상태 요약체: 「이 밤은 반드시…/이 모든 것이 끝났다/새로운 인생이 이제 시작된다/운명의 톱니바퀴」는 세부 계획의 수렴 상태를 그대로 요약 문장으로 썼습니다; 수렴 상태는 기획 기준이고, 정문은 마지막 구체적 동작, 장면 또는 대사에 이르러야 하며, 독자를 위해 도장 찍지 마세요.',
        excerpt: compact(text.slice(summaryMatch.index, summaryMatch.index + summaryMatch[0].length)),
      });
    }
  }

  return findings;
}

// 따옴표 강조 남용(실전 누락 E): 서술 계층 1~4자 쌍 따옴표 강조 구간을 통계하며, 전문에서 한 줄만 보고
// (밀도형 분포 지문). 대사류 제외는 QUOTE_EMPHASIS_* 상수 주석 참조.
function findQuoteEmphasisTic(proseLines) {
  let hits = 0;
  let firstLine = null;
  const samples = [];

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed)) continue;
    // 따옴표 밖에 서술이 없는 줄(독립 대사/댓글 흐름/의성어 연발「"딩동~""딩동~"」)은 통째로 건너뜀:
    // 강조 남용은 서술 계층 지문이므로, 서술이 없으면 강조도 무관.
    if (visibleLength(stripQuoted(trimmed)) === 0) continue;
    const ranges = quotedRanges(text);

    for (const [start, end] of ranges) {
      if (text[start] === '【') continue; // 시스템 패널/공지 요소, 강조 따옴표가 아님
      // 인용부호 중첩: 대사 내부의 강조는 캐릭터 언어에 속하므로 서사층 강조 남용으로 계산하지 않습니다.
      if (ranges.some(([s2, e2]) => s2 <= start && end <= e2 && (s2 !== start || e2 !== end))) continue;
      const inner = text.slice(start + 1, end - 1);
      const visible = visibleLength(inner);
      if (visible < 1 || visible > QUOTE_EMPHASIS_MAX_VISIBLE) continue;
      if (/[。！？!?…，,；;：:]/.test(inner)) continue; // 문장 부호가 포함된 것은 대사/방송이지, 강조가 아님
      const before = text.slice(Math.max(0, start - 6), start);
      const after = text.slice(end, end + 3);
      if (QUOTE_EMPHASIS_SPEECH_VERB_PATTERN.test(before) || QUOTE_EMPHASIS_SPEECH_VERB_PATTERN.test(after)) continue; // 인용 동사 인접 = 매우 짧은 대사
      hits += 1;
      if (firstLine === null) firstLine = lineNo;
      if (samples.length < 6 && !samples.includes(inner)) samples.push(inner);
    }
  }

  if (hits < QUOTE_EMPHASIS_MIN_HITS) return [];

  return [{
    line: firstLine,
    column: 1,
    type: 'quote-emphasis-tic',
    severity: 'advisory',
    message: `인용부호 강조 남용: 서사 내에서 1-4자 짧은 단어에 인용부호 강조 ${hits}곳; 진정한 반어/인용 필요한 한두 곳만 남기고, 나머지는 인용부호를 제거하고 직접 작성하거나, 구체적인 동작으로 바꿔 독자가 직접 감상하도록 하세요.`,
    excerpt: compact(samples.join(' ')),
  }];
}

// 미동작 반복: 인용부호 외 서사에서 「了X양사」경량 보어의 밀도를 통계합니다. 횟수와 천 글자당 밀도 이중 기준,
// 전체 문서에서 한 건만 보고합니다 (이는 분포 수준 지문이며, 위치별 문제가 아닙니다).
function findMicroActionTic(proseLines) {
  let hits = 0;
  let narrativeChars = 0;
  let firstLine = null;
  const samples = [];

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed)) continue;
    const narrative = stripQuoted(trimmed);
    narrativeChars += visibleLength(narrative);
    MICRO_TIC_PATTERN.lastIndex = 0;
    let match;
    while ((match = MICRO_TIC_PATTERN.exec(narrative)) !== null) {
      hits += 1;
      if (firstLine === null) firstLine = lineNo;
      if (samples.length < 6 && !samples.includes(match[0])) samples.push(match[0]);
    }
  }

  if (narrativeChars === 0 || hits < MICRO_TIC_MIN_HITS) return [];
  const perKilo = (hits / narrativeChars) * 1000;
  if (perKilo < MICRO_TIC_PER_KILO) return [];

  return [{
    line: firstLine,
    column: 1,
    type: 'micro-action-tic',
    severity: 'advisory',
    message: `미동작 반복: 「了下/了一下」식 경량 보어 ${hits}처(${perKilo.toFixed(1)}/천 글자); 동일한 반응 패턴의 고밀도 재현은 기계식 지문이므로, 동작 비트를 통합하고 구체적 세부사항으로 교체하며, 모든 동작마다 가벼운 반응 꼬리를 붙이지 마세요.`,
    excerpt: compact(samples.join(' ')),
  }];
}

function findActionListTic(proseLines) {
  const findings = [];

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed)) continue;
    const narrative = stripQuoted(trimmed).trim();
    if (!narrative) continue;

    ACTION_LIST_VERB_PATTERN.lastIndex = 0;
    const verbs = [];
    let match;
    while ((match = ACTION_LIST_VERB_PATTERN.exec(narrative)) !== null) {
      verbs.push(match[0]);
    }

    if (verbs.length < ACTION_LIST_MIN_HITS) continue;
    const separators = (narrative.match(/[，、；;]/g) || []).length;
    if (separators < ACTION_LIST_MIN_SEPARATORS) continue;

    findings.push({
      line: lineNo,
      column: 1,
      type: 'action-list-tic',
      severity: 'advisory',
      message: `감시 카메라식 동작 목록: 같은 문단의 연속 동작 동사 ${verbs.length}개, 구분자 ${separators}개; 사소한 단계를 통합하고 감정/플롯 기능이 있는 동작만 유지하며, 필요시 캐릭터의 망설임, 오판 또는 환경 피드백으로 완충하세요.`,
      excerpt: compact(verbs.slice(0, 8).join(' ')),
    });
  }

  return findings;
}

// 템플릿 밀도: 따옴표 외부 서술에서 고위험 금지어의 집중도를 통계합니다. 단어 단위 교체기가 아니며, 밀도가 높을 때만
// 형식화된 템플릿 문제를 감지할 때 표시. 수정 방법: 요약을 삭제하고 구체적인 동작/물건/대사로 바꾸기. 동의어 치환이 아님.
function findClicheDensityTic(proseLines) {
  let hits = 0;
  let narrativeChars = 0;
  let firstLine = null;
  const samples = [];

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed)) continue;
    const narrative = stripQuoted(trimmed);
    narrativeChars += visibleLength(narrative);

    for (const pattern of CLICHE_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(narrative)) !== null) {
        hits += 1;
        if (firstLine === null) firstLine = lineNo;
        if (samples.length < 8 && !samples.includes(match[0])) samples.push(match[0]);
      }
    }
  }

  if (narrativeChars === 0 || hits < CLICHE_DENSITY_MIN_HITS) return [];
  const perKilo = (hits / narrativeChars) * 1000;
  if (perKilo < CLICHE_DENSITY_PER_KILO) return [];

  return [{
    line: firstLine,
    column: 1,
    type: 'cliche-density-tic',
    severity: 'advisory',
    message: `반복 표현 밀도가 높음: 위험한 AI 반복 표현 ${hits}곳(${perKilo.toFixed(1)}/천자); 동의어 치환하지 말고, 캐릭터가 현재 볼 수 있는 동작, 물건, 대사, 구체적인 결과로 바꾸세요.`,
    excerpt: compact(samples.join(' ')),
  }];
}

// 비유 밀도: 인용부호 외 서술에서 "~처럼/~같이/~인 듯이/~과 같이" 등의 비유 표지를 통계함.
// 개별 비유는 문제가 아님. 고밀도로 대량 나타날 때만 표시하여 텍스트가 다른 수사 템플릿으로 변환되는 것을 방지.
function findMetaphorDensityTic(proseLines) {
  let hits = 0;
  let narrativeChars = 0;
  let firstLine = null;
  const samples = [];

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed)) continue;
    const narrative = stripQuoted(trimmed);
    narrativeChars += visibleLength(narrative);

    METAPHOR_MARKER_PATTERN.lastIndex = 0;
    let match;
    while ((match = METAPHOR_MARKER_PATTERN.exec(narrative)) !== null) {
      hits += 1;
      if (firstLine === null) firstLine = lineNo;
      const sample = sentenceAround(narrative, match.index);
      if (samples.length < 6 && sample && !samples.includes(sample)) samples.push(sample);
    }

    METAPHOR_LIKE_PHRASE_PATTERN.lastIndex = 0;
    while ((match = METAPHOR_LIKE_PHRASE_PATTERN.exec(narrative)) !== null) {
      const prefix = narrative.slice(Math.max(0, match.index - 8), match.index);
      if (/같이|~처럼|처럼|인 듯이|마치|그처럼|꼭/.test(prefix)) continue;
      hits += 1;
      if (firstLine === null) firstLine = lineNo;
      const sample = sentenceAround(narrative, match.index);
      if (samples.length < 6 && sample && !samples.includes(sample)) samples.push(sample);
    }
  }

  if (narrativeChars === 0 || hits < METAPHOR_DENSITY_MIN_HITS) return [];
  const perKilo = (hits / narrativeChars) * 1000;
  if (perKilo < METAPHOR_DENSITY_PER_KILO) return [];

  return [{
    line: firstLine,
    column: 1,
    type: 'metaphor-density-tic',
    severity: 'advisory',
    message: `비유 밀도 과높: 같은/마치/마냥/처럼 등 비유 표시 ${hits}곳（${perKilo.toFixed(1)}/천 글자）；가장 서사 기능이 큰 소수의 비유만 유지하고, 나머지는 구체적인 동작, 사물, 소리 또는 결과로 돌아가되 새로운 비유로 바꾸지 마세요.`,
    excerpt: compact(samples.join(' | ')),
  }];
}

// 설명 체인 밀도: 따옴표 외 서술에서 "알다/이해하다/이는 의미한다/반드시/필요하다" 등 판단 체인을 통계합니다.
// 전체 글에 한 줄만 보고; 수정은 구조 허사를 보충하는 것이 아니라 판단을 동작, 사물, 대사와 현장 피드백에 떨어뜨리는 것입니다.
function findReasoningChainTic(proseLines) {
  let hits = 0;
  let coreHits = 0;
  let narrativeChars = 0;
  let firstLine = null;
  const samples = [];
  const buckets = new Set();

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed)) continue;
    const narrative = stripQuoted(trimmed);
    narrativeChars += visibleLength(narrative);

    for (const { pattern, key, core } of REASONING_CHAIN_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(narrative)) !== null) {
        hits += 1;
        if (core) coreHits += 1;
        buckets.add(key);
        if (firstLine === null) firstLine = lineNo;
        const sample = compact(match[0]);
        if (samples.length < 8 && !samples.includes(sample)) samples.push(sample);
      }
    }
  }

  if (narrativeChars === 0 || hits < REASONING_CHAIN_MIN_HITS) return [];
  if (coreHits < REASONING_CHAIN_CORE_MIN_HITS || buckets.size < REASONING_CHAIN_MIN_BUCKETS) return [];
  const perKilo = (hits / narrativeChars) * 1000;
  if (perKilo < REASONING_CHAIN_PER_KILO) return [];

  return [{
    line: firstLine,
    column: 1,
    type: 'reasoning-chain-tic',
    severity: 'advisory',
    message: `설명 체인 밀도 과높: 알다/이해하다/이는 의미한다/반드시/필요하다 등 판단 체인 ${hits}곳（${perKilo.toFixed(1)}/천 글자）；논리 보고서처럼 될 때는 판단을 캐릭터가 현재 볼 수 있는 동작, 사물, 대사와 현장 피드백에 떨어뜨리세요.`,
    excerpt: compact(samples.join(' | ')),
  }];
}

// 시스템/규칙 문장이 계속 API 문서나 정부 공문처럼 이어지면 독자가 기계 냄새를 맡기 쉽습니다.
// 문법 수정은 규칙을 삭제하는 것이 아니라 기능을 유지한 후 일부 딱딱한 표현을 쉬운 말이나 구체적 결과로 바꾸는 것입니다.
function findNoticeFormalityTic(proseLines) {
  let hits = 0;
  let noticeChars = 0;
  let noticeLines = 0;
  let coreHits = 0;
  let firstLine = null;
  const samples = [];

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!/^【[^】]+】$/.test(trimmed)) continue;
    noticeLines += 1;
    noticeChars += visibleLength(trimmed);

    NOTICE_FORMAL_CORE_PATTERN.lastIndex = 0;
    while (NOTICE_FORMAL_CORE_PATTERN.exec(trimmed) !== null) coreHits += 1;

    for (const pattern of NOTICE_FORMAL_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(trimmed)) !== null) {
        hits += 1;
        if (firstLine === null) firstLine = lineNo;
        const sample = compact(match[0]);
        if (samples.length < 8 && !samples.includes(sample)) samples.push(sample);
      }
    }
  }

  if (noticeLines < NOTICE_FORMAL_MIN_LINES || noticeChars === 0 || hits < NOTICE_FORMAL_MIN_HITS || coreHits < NOTICE_FORMAL_CORE_MIN_HITS) return [];
  const perKilo = (hits / noticeChars) * 1000;
  if (perKilo < NOTICE_FORMAL_PER_KILO) return [];

  return [{
    line: firstLine,
    column: 1,
    type: 'system-notice-formality-tic',
    severity: 'advisory',
    message: `시스템 공지 공문체가 과밀: 대괄호 규칙 행의 딱딱한 규칙어 ${hits}곳(${perKilo.toFixed(1)}/천자)；캐릭터가 보는 화면/공지/규칙 매체로 유지하되, 매체 내부의 일부 딱딱한 표현만 쉬운 말로 바꾸거나 캐릭터가 현장에서 이해할 수 있는 구체적 결과를 추가하고, 서술자의 설명으로 바꾸지 않기.`,
    excerpt: compact(samples.join(' | ')),
  }];
}

// 긴 텍스트 전체가 너무 "간결"함: 짧은 문단이 많고, 자연스러운 연결이 적어서 가공된 개요/콘티처럼 읽힙니다.
// 문법 수정은 통독 후 끊긴 부분을 보충하는 것이지, 기준값을 맞추려고 전체적으로 "의/었/그래" 같은 것을 넣는 것이 아닙니다.
function findOvercompressedProseTic(proseLines) {
  let narrativeChars = 0;
  let narrativeParas = 0;
  let shortParas = 0;
  let particles = 0;
  let firstLine = null;
  const samples = [];

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed) || /^【[^】]+】$/.test(trimmed)) continue;
    const narrative = stripQuoted(trimmed).trim();
    const len = visibleLength(narrative);
    if (len === 0) continue;

    if (firstLine === null) firstLine = lineNo;
    narrativeParas += 1;
    narrativeChars += len;
    if (len <= OVERCOMPRESSED_PROSE_SHORT_MAX_CHARS) {
      shortParas += 1;
      if (samples.length < 6) samples.push(narrative);
    }

    OVERCOMPRESSED_PROSE_PARTICLE_PATTERN.lastIndex = 0;
    while (OVERCOMPRESSED_PROSE_PARTICLE_PATTERN.exec(narrative) !== null) particles += 1;
  }

  if (narrativeChars < OVERCOMPRESSED_PROSE_MIN_CHARS || narrativeParas < OVERCOMPRESSED_PROSE_MIN_PARAS) return [];
  const shortRatio = shortParas / narrativeParas;
  if (shortRatio < OVERCOMPRESSED_PROSE_SHORT_RATIO) return [];
  const particlePerKilo = (particles / narrativeChars) * 1000;
  if (particlePerKilo >= OVERCOMPRESSED_PROSE_PARTICLE_PER_KILO) return [];

  return [{
    line: firstLine,
    column: 1,
    type: 'overcompressed-prose-tic',
    severity: 'advisory',
    message: `과도하게 간결한 짧은 문단: 서술 문단 ${narrativeParas}개, 이 중 ${shortParas}개≤${OVERCOMPRESSED_PROSE_SHORT_MAX_CHARS}자(${(shortRatio * 100).toFixed(0)}%)；자연스러운 연결 ${particlePerKilo.toFixed(1)}/천자 부족；먼저 통독해서 판단하고, 정말 개요감이 있을 때 끊긴 부분과 필요한 구조 허사를 보충하되, 의도적으로 짧은 장면은 유지하고 기계적으로 물을 붓지 마세요.`,
    excerpt: compact(samples.join(' | ')),
  }];

}

// 낮은 연결 밀도: 긴 텍스트/중단 길이 윈도우에서 인용 부호 외 서술의 기능어와 구어 연결이 모두 낮으고, 중장 이음문이 부족하면
// "개요/전신체" 분포를 보이게 됩니다. 수정 방법은 필요한 연결과 문군을 복구하는 것이지, 전체적으로 단어를 채우는 것이 아닙니다.
function findLowConnectiveDensityTic(proseLines) {
  let bodyChars = 0;
  let functionHits = 0;
  let plainHits = 0;
  let firstLine = null;
  const sentences = [];
  const samples = [];

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed)) continue;

    // 인용 부호 외 서술만 봅니다. 대사/댓글/시스템 방송은 자연스럽게 짧을 수 있으므로, 통계에 포함하면 체재 특성을 전신체로 잘못 판단할 수 있습니다.
    const narrative = stripQuoted(trimmed).trim();
    const narrativeLen = visibleLength(narrative);
    if (narrativeLen === 0) continue;

    if (firstLine === null) firstLine = lineNo;
    bodyChars += narrativeLen;
    functionHits += countTerms(narrative, LOW_CONNECTIVE_FUNCTION_TERMS);
    plainHits += countTerms(narrative, LOW_CONNECTIVE_PLAIN_TERMS);

    for (const sentence of splitSentences(narrative)) {
      const len = visibleLength(sentence);
      if (len === 0) continue;
      sentences.push(len);
      if (len <= 12 && samples.length < 6) samples.push(sentence);
    }
  }

  if (bodyChars < LOW_CONNECTIVE_MIN_CHARS || sentences.length === 0) return [];
  const functionPerKilo = (functionHits / bodyChars) * 1000;
  if (functionPerKilo >= LOW_CONNECTIVE_FUNCTION_PER_KILO) return [];
  const plainPerKilo = (plainHits / bodyChars) * 1000;
  if (plainPerKilo >= LOW_CONNECTIVE_PLAIN_PER_KILO) return [];
  const longSentenceRatio = sentences.filter((len) => len >= LOW_CONNECTIVE_LONG_SENTENCE_CHARS).length / sentences.length;
  if (longSentenceRatio >= LOW_CONNECTIVE_LONG_SENTENCE_RATIO) return [];

  return [{
    line: firstLine,
    column: 1,
    type: 'low-connective-density-tic',
    severity: 'advisory',
    message: `낮은 연결 밀도: 인용 부호 외 서술 기능어 ${functionPerKilo.toFixed(1)}/천 자, 구어 연결 ${plainPerKilo.toFixed(1)}/천 자이며 ≥${LOW_CONNECTIVE_LONG_SENTENCE_CHARS}자 이음문은 ${(longSentenceRatio * 100).toFixed(0)}%만 있습니다. 개요/전신체처럼 보이기 쉽습니다. 정독 후 필요한 연결과 중장 문군을 보충하되, 기계적으로 물을 붓지 마세요.`,
    excerpt: compact(samples.join(' | ')),
  }];
}

// 추상적 요약 반복: 인용 부호 외 서술의 고도 추상 수렴 템플릿을 통계냅니다. 전체 글에서 한 건만 보고하여 역할로 돌아가도록 상기시킵니다.
// 현재 보이는 파일, 동작, 대사 또는 물리적 결과; 운명 같은 거대한 단어로 독자를 위해 요약하지 마세요.
function findAbstractSummaryTic(proseLines) {
  let hits = 0;
  let narrativeChars = 0;
  let firstLine = null;
  const samples = [];

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed || isDivider(trimmed) || isStructural(trimmed)) continue;
    const narrative = stripQuoted(trimmed);
    narrativeChars += visibleLength(narrative);

    for (const pattern of ABSTRACT_SUMMARY_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(narrative)) !== null) {
        hits += 1;
        if (firstLine === null) firstLine = lineNo;
        const sample = compact(match[0]);
        if (samples.length < 6 && !samples.includes(sample)) samples.push(sample);
      }
    }
  }

  if (narrativeChars === 0 || hits < ABSTRACT_SUMMARY_MIN_HITS) return [];
  const perKilo = (hits / narrativeChars) * 1000;
  if (perKilo < ABSTRACT_SUMMARY_PER_KILO) return [];

  return [{
    line: firstLine,
    column: 1,
    type: 'abstract-summary-tic',
    severity: 'advisory',
    message: `추상적 요약 반복: 운명/체스판/이제야 깨달았다/이제 막 시작됐다 등 저자의 요약 ${hits}곳(${perKilo.toFixed(1)}/천자); 현재 보이는 파일, 동작, 대사 또는 물리적 결과로 돌아가기, 독자를 위해 판을 짜지 마세요.`,
    excerpt: compact(samples.join(' | ')),
  }];
}

function findPeriodStutter(proseLines) {
  const findings = [];
  let runLen = 0;
  let runStartLine = null;
  let runSample = [];

  const flush = () => {
    if (runLen >= STUTTER_MIN_RUN) {
      findings.push({
        line: runStartLine,
        column: 1,
        type: 'period-stutter',
        severity: 'advisory',
        message: `짧은 마침표: 연속 ${runLen}개 단문에 쉼표 없음; 목표 문장 길이에 따라 단문을 중장문으로 합치고, 화면과 연결을 복원하기(이 skill 문장길이/밀도 리듬 규칙 참고).`,
        excerpt: compact(runSample.join(' ')),
      });
    }
    runLen = 0;
    runStartLine = null;
    runSample = [];
  };

  for (const { text, lineNo } of proseLines) {
    const trimmed = text.trim();
    if (!trimmed) continue; // 빈 줄은 한 문단 한 줄 편집이므로 서술 연결성을 끊지 않음
    if (isDivider(trimmed) || isStructural(trimmed)) {
      flush(); // 구분선/markdown 구조 줄: 단문 카운트 리셋
      continue;
    }
    const narrative = stripQuoted(trimmed);
    if (visibleLength(narrative) === 0) {
      flush(); // 순수 대화/댓글/시스템 공지: 연속된 짧은 문장이 정상 형태, 단편 문장 카운트 초기화
      continue;
    }
    // 따옴표 외부 서술문만 계산: 혼합 행(서술+따옴표 내 객체/짧은 대사)의 따옴표 외부 부분도 단편 문장 카운트에 포함됨.
    for (const sentence of splitSentences(narrative)) {
      if (visibleLength(sentence) <= STUTTER_MAX_SENTENCE) {
        if (runLen === 0) runStartLine = lineNo;
        runLen += 1;
        if (runSample.length < 6) runSample.push(sentence);
      } else {
        flush();
      }
    }
  }
  flush();
  return findings;
}

function isDivider(trimmed) {
  return /^-{3,}$/.test(trimmed) || /^[*_]{3,}$/.test(trimmed);
}

// markdown 구조 행(제목/목록/인용/표)은 서술 본문이 아니므로, 긴 문단/단편 문장 부호/대시 검사는 건너뜀.
function isStructural(trimmed) {
  return /^(#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s|\|)/.test(trimmed)
    || /^제[영일이삼사오육칠팔구십백천만\d]+장(?:\s|_|$)/.test(trimmed);
}

// 쌍을 이루는 따옴표 내 부분(대사/시스템 공지) 제거, 따옴표 외부 서술만 남김. 단편 문장 판정용: 순수 대화/댓글 연속 짧은 문장
// 체재가 정상 형태(면제)이지만, 「서술 + 인용부호 내 객체/짧은 대사」혼합 줄의 인용부호 외 서술은 여전히 단문 개수 계산에 포함됩니다.
function stripQuoted(text) {
  let out = text;
  for (const src of QUOTE_SOURCES) out = out.replace(new RegExp(src, 'g'), '');
  return out;
}

// 쌍을 이루는 인용부호 조각(인용부호 포함)을 같은 길이의 물음표 자리 표시자로 교체: 인용부호 내 대사/방송을 면제하면서도 원문 오프셋을 유지합니다.
// 각 위치의 blocking 규칙 정위와 원문 발췌 추출용 오프셋(stripQuoted는 위치를 이동시키므로 정위에 부적합).
// 자리 표시 문자는 「？」이지 「。」이 아닙니다: 자리 표시는 각 규칙의 [^。！？!?…] 부정 클래스를 차단해야 하면서(？와 마침표는 모든 규칙의 부정 클래스에서 동등), 어떤 규칙의 수락 위치에도 해당되지 않아야 합니다. 마침표 자리 표시는 trailer-summary의 문말을
// (계속)
// [。！] 종료 기호를 위조하여 「이 전투는 필연코 「혈도」의 시작이고, …」 같은 인용부호 안에 코드명/별명을 넣은 서술을 
// 오탐지되지 않도록 하되, 보고된 『이 전투는 필연코。』가 원문에서 grep으로 검색되지 않습니다. 점유 길이는 변하지 않으므로 오프셋과 발췌 윈도우가 드리프트하지 않습니다.
function maskQuoted(text) {
  let out = text;
  for (const src of QUOTE_SOURCES) {
    out = out.replace(new RegExp(src, 'g'), (m) => '？'.repeat(m.length));
  }
  return out;
}

// 인용부호 내 부분(인용부호 포함)의 [start, end) 구간을 반환하며, not-is 비교 문장 면제 대사용입니다.
function quotedRanges(text) {
  const ranges = [];
  for (const src of QUOTE_SOURCES) {
    const re = new RegExp(src, 'g');
    let match;
    while ((match = re.exec(text)) !== null) ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function insideRanges(pos, ranges) {
  return ranges.some(([start, end]) => pos >= start && pos < end);
}

function splitSentences(trimmed) {
  return trimmed
    .split(/[。！？!?]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sentenceAround(text, index) {
  let start = index;
  while (start > 0 && !STOP_CHARS.has(text[start - 1])) start -= 1;
  let end = index;
  while (end < text.length && !STOP_CHARS.has(text[end])) end += 1;
  return compact(text.slice(start, end).trim());
}

function visibleLength(sentence) {
  const matched = sentence.match(/[一-鿿Ａ-ｚA-Za-z0-9]/g);
  return matched ? matched.length : 0;
}

function countTerms(text, terms) {
  let count = 0;
  for (const term of terms) {
    let index = text.indexOf(term);
    while (index !== -1) {
      count += 1;
      index = text.indexOf(term, index + term.length);
    }
  }
  return count;
}

function parseFenceMarker(trimmedLine) {
  const match = /^(?:`{3,}|~{3,})/.exec(trimmedLine);
  if (!match) return null;
  return { char: match[0][0], length: match[0].length };
}

function hasYamlFrontMatter(lines) {
  if (!lines[0] || lines[0].trim() !== '---') return false;
  let sawYamlField = false;
  for (let i = 1; i < Math.min(lines.length, 40); i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '---') return sawYamlField;
    if (/^[A-Za-z0-9_-]+:\s*/.test(trimmed)) sawYamlField = true;
  }
  return false;
}

function scanBlock(block) {
  const text = block.map((entry) => entry.text).join('\n');
  const lineStarts = [];
  let cursor = 0;

  for (const entry of block) {
    lineStarts.push({ offset: cursor, lineNo: entry.lineNo });
    cursor += entry.text.length + 1;
  }

  return findNotIsComparisons(text, (offset) => positionForOffset(lineStarts, offset));
}

function positionForOffset(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const current = lineStarts[mid];
    const next = lineStarts[mid + 1];

    if (offset < current.offset) {
      high = mid - 1;
    } else if (next && offset >= next.offset) {
      low = mid + 1;
    } else {
      return {
        line: current.lineNo,
        column: offset - current.offset + 1,
      };
    }
  }

  return { line: lineStarts[0].lineNo, column: 1 };
}

function findNotIsComparisons(text, getPosition) {
  const findings = [];
  const quoted = quotedRanges(text);
  let offset = 0;

  while (offset < text.length) {
    const start = text.indexOf('아니', offset);
    if (start === -1) break;

    // 따옴표 내는 대사/시스템 안내: 구어에서 「아니A, B야」는 자연스러운 해명/반문이므로 서술층 AI 대조 문법으로 간주하지 않음
    // （마침표와 일관되게 따옴표 내용 제외）。
    if (insideRanges(start, quoted)) {
      offset = start + 2;
      continue;
    }

    // Avoid the common yes/no question fragment "아닌가".
    if (start > 0 && text[start - 1] === '는') {
      offset = start + 2;
      continue;
    }

    const candidate = text.slice(start);
    const markerEnd = findPositiveFlipEnd(candidate);

    if (markerEnd === -1) {
      offset = start + 2;
      continue;
    }

    const raw = trimTrailingNoise(extractFinding(candidate, markerEnd));
    if (raw.length >= 4) {
      const position = getPosition(start);
      findings.push({
        line: position.line,
        column: position.column,
        type: 'not-is-comparison',
        severity: 'blocking',
        message: '높은 빈도의 AI 대비 문장 구조; 부정 서술을 삭제하고 후속 항목을 직접 작성하거나 동작/세부 사항 표현으로 변경하세요.',
        excerpt: compact(raw),
      });
    }

    offset = start + Math.max(raw.length, 2);
  }

  return findings;
}

function findPositiveFlipEnd(candidate) {
  let index = 2; // "아니다" 다음
  let scanned = 0;
  let crossedSeparator = false;

  while (index < candidate.length && scanned <= MAX_NEGATIVE_SPAN) {
    const char = candidate[index];

    if (startsWithAt(candidate, index, '그러나')) return index + 2;

    if (SOFT_SEPARATORS.has(char)) {
      const next = skipGap(candidate, index + 1);
      if (startsWithAt(candidate, next, '그러나')) return next + 2;
      if (candidate[next] === '이다' && !TAG_PARTICLES.has(candidate[next + 1]) && !isAffirmationTagAt(candidate, next)) return next + 1;
      crossedSeparator = true;
    }

    if (HARD_SEPARATORS.has(char)) {
      const next = skipGap(candidate, index + 1);
      if (candidate[next] === '이다' && !TAG_PARTICLES.has(candidate[next + 1]) && !isAffirmationTagAt(candidate, next)) return next + 1;
      if (char !== '.') break;
      crossedSeparator = true;
    }

    if (STOP_CHARS.has(char)) break;

    // "不是A是B"와 같은 축약형을 포착하되, 첫 번째 절 내에서만 —
    // 구분자 이전. 구분자 뒤의 연결사(只是/可是/但是/还是/于是/倒是/总是…)의 끝 "是"
    // 는 긍정이 아니라 그 단어의 일부입니다.
    // copula (issue #166 false-positive class). Post-separator flips are still
    // 구분자 인접("，是"/"，而是")일 때 구분자 분기에서 포착됨
    // 위의 내용을 참조하며, "，他是"/"，那是"와 같은 주어-현재 뒤집기는 의도적으로 제외됩니다.
    // caught here — there is no separator-local way to tell them from a
    // conjunction without a word list, and on a hard rescan-to-0 gate a false
    // positive (forcing a rewrite of good prose) costs more than missing this
    // 더 드문 형태입니다. "아니면 A이면 B이다 / 역시 B이다" 어느-또는 관용구의 "是"는 계사가 아닌 就是/也是 접속사의 일부이므로 就/也도 제외됩니다. 또한 두 번째 부정 절("A가 아니면, B도 아니다") 내부의 "是"를 뒤집기로 간주하지 마세요.
    // '就是'/'也是' 접속사이지 동사가 아니므로 '就'/'也'도 제외됩니다. 또한 두 번째 부정 구문("不是A，也不是B") 내부의 "是"를 반전으로 처리하지 마세요.
    // 두 번째 부정 구문("不是A，也不是B") 내부의 "是"를 반전으로 처리하지 마세요.
    if (char === '是' && !COMPACT_EITHER_OR_PREV.has(candidate[index - 1]) && !crossedSeparator) {
      return index + 1;
    }

    index += 1;
    scanned += 1;
  }

  return -1;
}

function extractFinding(candidate, markerEnd) {
  let end = markerEnd;
  const limit = Math.min(candidate.length, markerEnd + MAX_POSITIVE_SPAN);

  while (end < limit) {
    if (STOP_CHARS.has(candidate[end])) break;
    end += 1;
  }

  return candidate.slice(0, end);
}

function startsWithAt(text, index, needle) {
  return text.slice(index, index + needle.length) === needle;
}

function isAffirmationTagAt(text, index) {
  if (text[index] !== '是') return false;
  const particle = text[index + 1];
  if (!AFFIRMATION_TAG_PARTICLES.has(particle)) return false;
  const boundary = text[index + 2] || '';
  return AFFIRMATION_TAG_BOUNDARY.has(boundary);
}

// 줄 내 공백과 줄바꿈(빈 줄/단락 간격 포함)을 건너뛰고, 다음 의미 있는 문자에서 멈춤. 기존 구현은 줄바꿈 하나만 처리해서,
// 빈 줄을 걸친 「A가 아니다. (빈 줄) B이다」 같은 분절 공시 문장을 놓침.
function skipGap(text, index) {
  while (index < text.length && (isInlineSpace(text[index]) || text[index] === '\n')) index += 1;
  return index;
}

function isInlineSpace(char) {
  return char === ' ' || char === '\t' || char === '\r';
}

function trimTrailingNoise(text) {
  return text.replace(/[\s|）)【\]]+$/u, '');
}

function compact(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}
