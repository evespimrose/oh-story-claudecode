# 중국어→한국어 현지화 진행상황 보고서

## 기준 시점

본 보고서는 `2026-08-22` 현재 `main` 브랜치의 실제 저장소 상태를 기준으로 갱신했다. Batch 29~33의 템플릿 현지화는 커밋 `012150c`로, Batch 34의 story-review AI 문체 참조 문서는 `d5b2e93`으로 원격에 푸시되었다. Batch 35의 quality 문서 현지화는 커밋 `90a993f`로 원격에 푸시되었다. Batch 36의 character-relations·dialogue-mastery 현지화는 현재 작업 중이다.

## 작업 원칙

이번 단계의 기준은 다음과 같다.

> 실행 기능에 직접 연결된 문자열은 보존하고, 그 밖의 문서 본문·주석·예시·인용·설명은 한국어로 현지화한다.

따라서 외부 사이트의 URL·필드명·선택자·정규식 대상·테스트 픽스처처럼 기능에 직접 연결된 문자열은 임의로 번역하지 않는다. 반면 문서 설명, 표의 항목, 중국어 원문 예시, 장르 용어 해설은 한국어 독자가 자연스럽게 이해할 수 있도록 재구성한다. `demo/` 본문은 기존 프로젝트 규칙에 따라 수정하지 않는다.

## Batch 28: 스크래퍼 주석·로그 현지화

이번 배치에서는 다음 파일의 중국어 주석과 사용자 표시 로그를 한국어로 현지화했다.

| 파일 | 처리 내용 | 기능 보존 항목 |
|---|---|---|
| `skills/story-long-scan/scripts/fanqie-rank-scraper.js` | 판치에 순위 수집 방식, 상세 파싱, 연결 오류, 품질 경고, 저장 로그와 사용법 주석을 번역 | URL, `__INITIAL_STATE__`, JSON 필드, 정규식, 장르·채널 ID, CLI 옵션, 출력 파일명 형식 |
| `skills/story-short-scan/scripts/cdp-utils.js` | CDP 공통 유틸리티의 주석과 JSDoc을 번역 | `agent-browser`, base64 인자, `evalJSONBase64`, 경로, 옵션, 반환 객체 키 |
| `skills/story-short-scan/scripts/dz-browse-scraper.js` | 점중 단편 수집 주석, 연결 오류, 채널 전환, 품질 경고와 저장 로그를 번역 | `/book/{id}`, URL, DOM 선택자, 정규식, `bookId`, 채널 ID·탭 값 |
| `skills/story-short-scan/scripts/heiyan-booklist-scraper.js` | 흑암 API 수집의 로그인 안내, 페이지 처리, 필드 품질 게이트, 채널 필터와 상세 수집 로그를 번역 | API URL, `Admin-Token`, Bearer 인증, JSON 키, `--channel`, `--pages`, `--detail`, 분류 값 |

중국어 잔존 검색 결과는 기능 문자열·사이트명·실제 출력 파일명·분류 값·정규식 대상에 집중되어 있으며, 이를 일반 설명 문장과 구분해 보존했다. 네 파일 모두 `node --check`를 통과했고 `git diff --check`도 통과했다. `demo/` 본문은 수정하지 않았다. 이번 배치는 `8662413` 커밋으로 커밋·푸시 완료했다.

## Batch 29~33: story-setup 템플릿 현지화 완료

`skills/story-setup/references/templates/agents/chapter-extractor.md` 전체를 첫 대상으로 선정해 frontmatter 설명, 역할 정의, 분석 범위, 입력 형식, 객관적 사실 묘사, 서사 프레임 금지, 시간 순서, 정보 충실도, JSON 출력 설명, 사건 지점 밀도·유형·인용 규칙, 역할 추출 규칙, 별칭 처리, 품질 검사, 도메인 경계와 후반 Markdown 출력 템플릿을 한국어로 현지화했다.

기능 계약인 frontmatter 키, `tools`·`disallowedTools`, 모델·턴 설정, JSON 키와 출력 구조, `OUTPUT_MODE: json`, `major|supporting|minor`, `基调：`, `主题标签` 및 사건 유형·주제·기조의 원문 열거값은 보존했다. 이후 `story-explorer.md`, `story_hook_core.js`, `consistency-checker.md`, `story-researcher.md`, `guard-outline-before-prose.sh`, `story-outline.md`까지 현지화했다. 템플릿의 설명·주석·사용자 표시 문장은 한국어화했지만 파서와 호출부가 의존할 수 있는 고정 표식은 유지했다.

## Batch 34: story-review AI 문체 참조 문서 현지화 진행 중

`skills/story-review/references/anti-ai-writing.md`와 `banned-words.md`를 한국어 중심으로 현지화했다. `anti-ai-writing.md`에서는 남아 있던 비기능성 중국어 설명과 혼합 문장을 정리하고, `banned-words.md`에서는 AI 금지 문식의 설명·처리 원칙·교체 전략을 번역했다.

`check-ai-patterns.js`가 실제로 사용하는 중국어 금지 패턴, 정규식 기반 문장 예시, `formulaic-parallelism`, `cliche-density-tic`, `metaphor-density-tic` 같은 detector ID, `——`/`—`/`--` 검사 토큰과 `地/得`·`的` 등의 언어 패턴은 기능 계약으로 보존했다. 두 파일의 동명 사본도 shared-file guard 규칙에 맞춰 `story-deslop`, `story-long-write`, `story-short-analyze`, `story-short-write`에 동기화했다.

## Batch 35: story-review 품질 검사 문서 현지화 진행 중

`skills/story-review/references/quality-checklist.md`와 `quality-rubric.md`의 제목, 목차, 검사 항목, 5차원 평가 기준, PASS/WARN/FAIL 판정표, Findings Schema, Verdict, 장편·단편 전용 검사와 독자 계약 심사 설명을 한국어로 현지화했다. `第[一二三四五六七八九十百千万两0-9]+章|上一章|上章|前一章|本章|这一章|前文|后文|伏笔|细纲|读者` 정규식, `番茄`, `爽文`, `知乎盐言` 같은 플랫폼·장르 식별자, `critical|high|medium|low`, `rewrite|compress|de_ai|polish`, `APPROVE|CONCERNS|REJECT` 같은 기능·상태 토큰은 보존했다. 일반 설명에 남은 혼합 문장은 번역했으며, 실제 검사 대상인 중국어 예시와 정규식은 변경하지 않았다.

품질 문서의 구조 검증 결과 `quality-checklist.md`는 제목 30개와 표 78행, 코드 펜스 2개를 유지했고 `quality-rubric.md`는 제목 6개와 표 25행, 코드 펜스 2개를 유지했다. `git diff --check`도 통과했다. 이번 변경은 아직 커밋·푸시하지 않았다.

## Batch 36: character-relations·dialogue-mastery 현지화 착수

`skills/story-review/references/character-relations.md`는 기존 장편 참조본의 한국어 현지화 내용을 기준으로 리뷰 참조본에 반영하기 시작했다. 관계 유형, 감정선, 남성향·여성향 로맨스, 빙의·수라장, 호감도, 인물 행동 자가 점검, 조연 버퍼, 경쟁자·친족선, 남성향 연애물 공략과 최종 체크리스트가 대상이다. 다만 기준본에도 기능성 중국어 토큰과 일부 혼합 문장이 남아 있어, 다음 단계에서 문맥별 전수 정리해야 한다.

`dialogue-mastery.md`는 이미 현지화된 장편 참조본을 리뷰 참조본과 단편 쓰기 참조본에 반영했다. 권력 게임·반전·심리적 단절 대화, 잠재의도·의제, 감정 연속성, 정보·세계관 전달, 인물별 말투, 탄막·군중 대화, 리듬·분량·개그 사용 규칙을 포함한다. 남은 중국어는 예시 대사와 기능상 보존 대상이거나 일부 혼합 문장이므로, 최종 검수에서 분리한다.

이번 Batch 36은 아직 커밋·푸시하지 않았다.

## 완료된 커밋

| 커밋 | 내용 | 상태 |
|---|---|---|
| `ee4c0df` | 기존 한국어 번역 전수 검수 1차. 장편·단편·리뷰·설정 참조본의 문체, 용어, 중국어 잔재 수정 | 원격 반영 완료 |
| `d3183f1` | 중국어 문서 현지화 1차: `artifact-protocols`, `banned-words`, `character-basics`, `character-relations`, `cross-book-recall` | 원격 반영 완료 |
| `3e6f8fb` | 중국어 문서 현지화 2차: `emotional-arc-design` | 원격 반영 완료 |
| `5b7f673` | 중국어 문서 현지화 3차: `genre-catalog`, `genre-core-mechanics` | 원격 반영 완료 |

위 커밋들은 모두 `origin/main`에 순차적으로 푸시했다. 각 커밋은 작은 배치로 생성했다. Batch 36의 character-relations·dialogue-mastery 변경과 이 보고서 갱신은 현재 커밋·푸시 대기 상태다.

## 이번 단계에서 현지화한 주요 내용

`story-long-write` 참고자료에 남아 있던 중국어 설명, 템플릿 항목, 감정선·장르·캐릭터 설계 표, 작품 분석과 비교 자료에 관한 설명을 한국어로 옮겼다. 특히 중국어식 지시문과 설명문을 한국어의 동사 중심 문장으로 재구성했으며, 「追妻火葬场」처럼 직역하면 어색한 장르명은 한국 독자가 이해할 수 있는 표현으로 풀어 썼다.

기존 전수 검수 커밋에서는 `进行`, `关于`, `对于`가 포함된 번역 잔재와 중국어 문장 예시를 우선 교정했다. 동일 내용의 `story-setup` 중복 참조본에도 같은 표현을 적용해 용어 불일치를 줄였다.

## Batch 37: 절정 역추론·AB 대개요 및 플랫폼 rubric 검토

`skills/story-review/references/plot-core-methods.md`의 절정 역추론·AB 대개요 구간을 현지화했다. 절정에서 앞부분의 포석을 역추적하는 핵심 발상, A/B 표식의 의미와 실행, `ABABAB` 배열 순서를 한국어로 재구성했으며, 문서 내부 링크·비율·고정 표식은 보존했다.

`fanqie.md`, `qidian.md`, `zhihu.md`는 이미 한국어 중심으로 현지화되어 있어 이번 단계에서는 전면 재작성하지 않고 플랫폼명·`PASS`/`FAIL`·수치 기준·`advisory only`·참조 agent명과 같은 기능·평가 토큰을 유지하는 계획으로 확정했다. 세 문서의 남은 작업은 용어 통일과 `quality-rubric.md` 기준과의 교차 검수다.

`character-relations.md`는 기존 장편 기준본을 리뷰 참조본에 반영했으나, 기준본 자체에 남은 중국어 설명과 일부 혼합 문장은 추가 정리가 필요하다. 이번 커밋은 해당 기준본 반영과 Batch 37 진행분을 포함하며, 비기능성 중국어 설명의 최종 전수 정리는 다음 배치의 잔여 과제로 남긴다.

## Batch 38: 감정선·수라장 잔여 규칙 및 전수 조사 계획

`character-relations.md`의 남성향·여성향 감정선 논리, 빙의·게임 세계 인물 선택, 정보 격차, 수라장 마무리 전략을 추가 현지화했다. ‘트로피’, ‘연결’, 관계 단계, 사업선 연결, 내부 갈등에서 공동 대응으로의 전환처럼 문맥 의존성이 큰 표현은 한국어 독자가 즉시 이해할 수 있도록 재구성했다. 기능상 고정될 수 있는 장르명·예시·참조 표식은 보존한다.

`skills/` 전체 비기능성 중국어 설명은 다음 순서로 전수 조사한다. 먼저 `git ls-files`로 `demo/`를 제외한 추적 파일을 확정하고, Markdown·TOML·JSON·JavaScript·Python·셸을 유형별로 분류한다. 각 파일의 중국어 포함 줄을 일반 설명, 주석·로그, 예시·인용, URL·경로·선택자·정규식·필드명·테스트 픽스처로 나눈다. 일반 설명과 주석·로그만 번역하고, 실행 계약과 테스트 데이터는 보호한다. 이후 동일 basename 참조본은 기준본을 정해 동기화하되, 의도적으로 다른 문서는 별도 diff 검토를 거친다.

일괄 번역은 1차로 문서 본문과 제목, 2차로 표·체크리스트·예시 설명, 3차로 주석·사용자 표시 로그, 4차로 동명 참조본 동기화 순서로 진행한다. 각 배치는 1~3개 파일로 제한하고 `demo/` 무수정, 기능 토큰 해시·개수, Markdown 구조, 언어별 문법 검증, `git diff --check`를 통과한 뒤 커밋한다.

## Batch 39: plot 잔여 구간·감정선·skills 전수 조사 착수

`plot-core-methods.md`의 지도 전환 세부 설계, 일상물 개요 프레임워크, 대형 플롯 기대감 설계 구간을 한국어로 현지화했다. 지도 4세력 프레임워크, 지위·환경 동시 상승, 특수 유형 처리, 일상물의 창작 경로·개요 추론·지점 형식, 대형 플롯의 하향식 설계와 사례를 포함한다. `ABABAB` 배열, 작품명·곡명과 같은 예시 고유명은 보존했다.

`character-relations.md`에서는 인물 행동 자가 점검, 조연 공략 완충 지대, 신분 인식 차이, 적이자 친구 관계, 경쟁자·가족선, 남성향 연애 공략, 호감도 단계·커플 행동 문턱의 혼합 문장을 한국어로 정리했다. 이후 5종 감정선 템플릿과 인물 목표 독립성·관계선 설계 후반은 계속 검수한다.

`skills/` 전체 1차 조사에서는 `demo/`를 제외한 추적 파일을 경로 안전 방식으로 검사했으며 중국어 포함 후보 221개를 확인했다. 후보에는 Markdown 본문뿐 아니라 TOML·JSON·JavaScript·Python·셸의 URL·경로·필드·선택자·정규식·테스트 데이터가 함께 포함되어 있으므로, 단순 문자 치환을 금지하고 유형별로 번역한다. 1차 실행 대상은 분량이 큰 참조 문서가 아니라 현재 우선순위가 높은 `story-review` 및 `story-short-*` 참조 문서로 고정하고, 이후 대형 문서를 1~3개씩 처리한다.

## Batch 40: 핵심 문서 1차 일괄 번역 착수

`skills/story-review/references/tracking-transaction.md`를 한국어 중심으로 현지화된 장편 기준본과 동기화해 1차 핵심 문서 배치에 포함했다. 트랜잭션 상태, 추적 경로, 출력 계약과 같은 기능 요소는 보호하고, 설명 문장과 운영 지침은 한국어 기준으로 맞춘다.

이번 배치에서는 `plot-core-methods.md`와 `character-relations.md`의 잔여 중국어를 계속 분리했다. 일반 설명은 한국어로 옮기고, 작품·플랫폼 고유명, 검색·검사 패턴, 경로·필드·정규식·상태값은 보존한다.

`skills/` 전수 조사 후보는 이전 경로 안전 스캔 기준 221개다. 1차 일괄 번역 순서는 `story-review` 핵심 참조 문서와 `story-short-*`의 공용 참조 문서, 이후 `story-setup`·`story-long-*` 대형 문서 순으로 진행한다. 각 배치는 1~3개 파일로 제한하고 동명 사본·기능 토큰·문법 검증을 함께 수행한다.

## Batch 41: story-short 공용 문서와 플랫폼 rubric 교차 검수

`story-short-write/references/output-contract.md`를 1차 공용 문서로 현지화하고 `story-short-analyze/references/output-contract.md`와 바이트 동기화했다. 출력 계약의 frontmatter 설명, 파이프라인·파일 트리 설명, 파일명 규약, `_meta.json` 스키마 개요, 인수 검증 연결 지점, 하위 소비 규격의 설명과 제목을 한국어로 정리했다. `拆文库/{书名}/`, `原文/`, `拆文报告.md`, `情节节点.md`, `写作手法.md`, `_meta.json` 및 JSON 필드·Stage·CLI 경로는 실행 계약이므로 보존했다. 동기화 사본은 `scripts/check-shared-files.sh`로 관리한다.

플랫폼 rubric 교차 검수에서는 `fanqie.md`의 제목을 ‘판치에 단편 품질 기준’으로 바로잡고, `qidian.md`의 ‘장미 훅’을 ‘장 끝 훅’으로 수정했으며, `zhihu.md`의 1인칭·여운·몰입감 표현을 통일했다. 세 문서의 `PASS`/`FAIL`, `advisory only`, `blocking`, 수치 기준, 플랫폼명과 참조 agent명은 보존했다. 현재 rubric은 기능 판정 용어와 한국어 설명의 기준이 일치한다.

`story-short-*` 1차 문서 우선순위는 `output-contract.md` → `hooks-paragraph.md` → `short-format.md` → `short-deslop.md` → `banned-words.md` → `real-market-data.md` 순으로 확정했다. 공용 사본은 먼저 기준본을 번역한 뒤 byte-equal 동기화하고, 공용이 아닌 `material-decomposition.md`, `quality-checklist.md`, `genre-readers.md`, `emotional-methods.md`는 각 skill의 문맥을 확인한 뒤 별도 처리한다.

## Batch 42: 단편 규칙 문서 마무리 및 장편 핵심 문서 착수

`hooks-paragraph.md`와 `short-format.md`의 주요 설명·규칙 제목을 한국어화하고, `short-deslop.md`의 단편 전용 AI 문체 제거 원칙·감정 처리·장 끝·블랙리스트·문장부호·자가 점검표를 정리했다. `hooks-paragraph.md`는 `story-short-analyze` 사본과 동기화했다. 기능성 훅 이름, 중국어 탐지 패턴, 정규식, 플랫폼명과 예시 데이터는 보존 대상으로 분리했다.

장편 핵심 문서 1차 실행으로 `story-long-analyze/references/style-profile-protocol.md`의 로드 시점, 산출물 정의, 경로, 예산, 템플릿·대화·감정·모방 원칙 제목을 한국어화했다. `拆文库/{书名}/`, `文风.md`, `文风可用`, `confidence`, Gate와 필드명은 실행 계약이므로 보존한다.

## Batch 43: 장편 프로토콜 세부 현지화

`story-long-analyze/references/style-profile-protocol.md`의 남은 산출물 목록, 템플릿 필드 설명, 대화·감정 교대 패턴, 원문 앵커 구간, confidence 등급, 사용 가능성 의미, 우선 적용·모방 금지 규칙을 한국어로 추가 정리했다. `文风.md`, `拆文库/{书名}/`, `文风可用`, `confidence`, Gate, `narrative-writer` 호출 경로와 원문 예시용 플레이스홀더는 기능·계약 요소로 보존했다.

장편 핵심 프로토콜 문서 계획은 다음 순서로 유지한다. 먼저 `state-tracking.md`와 `reader-contract-and-progression.md`의 상태 전이·독자 진행·재개 계약을 처리하고, 다음으로 `tracking-transaction.md`의 체크포인트·실패 처리·출력 계약을 교차 검수한다. 이후 `writing-craft.md`, `genre-prose-cards.md`, `style-craft.md`를 집필 규칙 배치로 진행한다. 대형 문서인 `plot-frameworks.md`, `commercial-core-methods.md`, `style-genre-modules.md`는 구간별로 나눈다.

장편 문서 진행률은 **프로토콜 1차 문서군 착수 및 style-profile 세부 현지화 단계**다. 아직 모든 장편 핵심 문서가 완료된 것은 아니며, 상태값·필드·경로·템플릿 토큰과 일반 설명을 분리하면서 배치별로 진행한다.

## Batch 44: 1단계 장편 프로토콜 완료 및 2단계 착수

`reader-contract-and-progression.md`의 제도·기관·방관자 설계, 위험 등급 표, 직업·권력 판타지의 스포트라이트 양도, 핵심 자산 교환, 대리 복수, 종국 비축 소진, 군상·스승물 예외, 작품 전환 부채를 한국어로 마무리했다. `state-tracking.md`, `reader-contract-and-progression.md`, `tracking-transaction.md`를 1단계 장편 프로토콜 문서군으로 분류했으며 상태 전이·재개·체크포인트·JSON 계약에 쓰이는 경로·필드·상태값은 보존한다.

1단계 완료 기준은 프로토콜 문서의 일반 설명·표·운영 규칙 현지화, 기능 계약 보호, Markdown 구조 확인이다. `style-profile-protocol.md`의 세부 현지화와 `reader-contract-and-progression.md`의 핵심 잔여 구간까지 반영했으며, `tracking-transaction.md`는 기존 기준본을 유지·대조했다.

2단계 장편 작성 핵심 문서는 `writing-craft.md` → `genre-prose-cards.md` → `style-craft.md` → `commercial-core-methods.md` 순으로 진행한다. 집필 규칙·문체 카드·상업성 핵심 방법론을 각각 1~3개 문서 단위로 번역하고, `plot-frameworks.md`, `style-genre-modules.md` 같은 대형 문서는 절별 배치로 나눈다. 각 문서에서 Gate, 경로, 명령, 필드, 정규식, 상태 토큰, 원문 예시와 일반 설명을 먼저 분리한다.

## Batch 46: 장편 2단계 핵심 문서 착수

`writing-craft.md`의 제목·책임 범위·신체 디테일·관통 소품 설명을 한국어로 정리했고, `style-craft.md`의 남은 혼합 표기와 위험 표현 안내를 다듬었다. `genre-prose-cards.md`는 한국어 기준본과 기능성 소재명·리콜 표식 보존 상태를 확인했다.

`commercial-core-methods.md`는 대형 문서이므로 다음 단위로 분할 번역한다.

1. **상업성 원칙**: 의사결정 라우팅, 금손가락 원리, 핵심 매력, 소재·구조·감정의 상업적 실행 제약.
2. **독자 유지**: 독자 유지의 네 기둥, 지도 전환, 평이한 플롯 전환, 기대감과 추독 관리.
3. **사이다·전환 설계**: 감정 전달, 핵심 소재 순환, 플롯 리듬, 절정과 중후반 이탈 방지.
4. **출력·검증 규칙**: 플랫폼별 적용성, 품질 점검, 핵심 매력 이탈 진단, 금손가락·갈등 균형.

이번 배치에서는 `commercial-core-methods.md`의 상업성 원칙과 독자 유지 앞부분을 한국어로 현지화했다. 기능성 모듈명·경로·수치 기준·플랫폼명·상태 토큰은 보존했으며, 잔여 대형 문서는 다음 배치에서 계속한다.

## Batch 47: commercial-core 후속 구간 및 구조·갈등·감정선 문서 착수

`commercial-core-methods.md`에서 감정 결핍 분석과 사용자 페르소나, 상업화 실행 규칙, 패턴의 다면적 활용, 장 개요 세분화 단계를 한국어로 현지화했다. 이 구간의 기능성 모듈명·경로·수치 기준·플랫폼명·상태 토큰은 보존했다.

2단계 다음 배치로 `outline-structure-theory.md`, `outline-conflict.md`, `emotional-arc-design.md`를 구조·갈등·감정선 배치로 착수한다. 각 문서의 일반 설명·표·예시·체크리스트를 번역하되 개요 필드, Gate, 경로, JSON/YAML 키, 상태값과 템플릿 토큰은 변경하지 않는다. `commercial-core-methods.md`는 이후 사이다·전환 설계 후반, 금손가락·갈등 균형, 플랫폼별 상업화 출력과 품질 체크리스트를 계속 처리한다.

## Batch 48: 구조·갈등·감정선 문서 본문 현지화 착수

`outline-structure-theory.md`에서 심층 구조 설계, 의사결정 라우팅, 1·2·3급 구조, 장편 특수 인식, 주인공·장애물·목표의 기본 구조와 3단계 고도화 규칙을 한국어로 현지화했다. 구조 템플릿명과 기능성 모듈 경로는 보존했다.

`outline-conflict.md`와 `emotional-arc-design.md`는 본문 현지화 대상과 기능 계약을 확인했으며, 다음 배치에서 갈등 엔진·장애물 상승·감정선 단계와 표·예시를 순차적으로 처리한다. `commercial-core-methods.md`의 감정·상업화 규칙은 앞선 배치의 번역분을 유지한다.

## Batch 49: 5막·5단계 구조와 갈등·감정선 본문 현지화

`outline-structure-theory.md`의 5막 구조·인과 사슬, 3막·기승전결·5막의 관계, 5단계 개요 확장법, 암선 설계, 8개 플롯선 배치를 한국어로 현지화했다. `outline-conflict.md`에서는 의사결정 라우팅, 갈등의 4단계 상승, 근본 갈등, 동기 출처, 갈등 출처 분류, 절정 역추론, 메인·서브 플롯과 이중선 구조를 번역했다. `emotional-arc-design.md`에서는 6가지 감정선의 라우팅과 V형·역V형·W형·상승형·지연 만족형·급전환형의 운용 요점·장르 표·분량 배분을 현지화했다.

세 문서의 경로·Gate·JSON/YAML 필드·상태값·정규식·고정 표식·실행 계약과 기능성 원문 예시는 보존한다. 다음 배치에서는 `outline-structure-theory.md`의 다중 플롯·지도 전환 후반, `outline-conflict.md`의 충돌 설계·대항 설계, `emotional-arc-design.md`의 중반 압박·기대감 관리·감정 핵심 공식과 품질 체크리스트를 이어서 처리한다.

## Batch 50: 지도 전환·충돌·감정선 압박 규칙 현지화

`outline-structure-theory.md`의 권별 프레임, 4대 독자 유지 수단, 지도 전환 3법, 최상위 프레임, 인간관계 선행, 다중 플롯 병행·피로 완화와 서양 판타지 요점을 현지화했다. `outline-conflict.md`에서는 문턱 기반 플롯 연장, 3대 추진력 역추론, 충돌 기준·초과 보상·구원물 8법, 대항 설계·악역 시점 정보 격차·주인공 행동력을 번역했다. `emotional-arc-design.md`에서는 중반 압박 4수단, 장르 트랙 전략, 기대감 관리 6법칙과 품질 체크리스트를 한국어로 현지화했다.

다음 배치에서는 `outline-structure-theory.md`의 비교 작품 리듬 이식·세부 개요 분할·장 위치와 강약, `outline-conflict.md`의 감정선·금손가락·순환·동기·플롯 조직 후반, `emotional-arc-design.md`의 감정 핵심 공식·전반응-재현-후반응·감정 이입·연애 감정 설계·기대감의 기반 메커니즘을 처리한다.

## Batch 51: 비교 리듬·갈등 후반·연애 감정 설계 현지화

`outline-structure-theory.md`에서 비교 작품의 1급 플롯 단위, 핵심 지점법, 리듬 이식 5단계, 세부 개요 배치 경계, 장 위치와 강약 조절을 한국어로 현지화했다. 기능 경로인 `剧情/`, `cross-book-recall.md`, `workflow-setup.md#phase-3大纲搭建`과 템플릿 표식은 보존했다.

`outline-conflict.md`에서는 일선·감정선 결합, 연애선 4단계, 금손가락·신분, 사이다 순환, 인물 꿈·곤경 순환을 현지화했다. `emotional-arc-design.md`에서는 감정 핵심 공식, 전반응-재현-후반응 구조, 남성향 연애 감정 설계와 감정 조율의 통합 관점을 번역했다.

다음 배치에서는 `outline-structure-theory.md`의 세부 개요 배치 설명·장 위치 후반·품질 체크리스트, `outline-conflict.md`의 핵심 소재 3분법·장르별 순환·설정 추론·플롯 조직, `emotional-arc-design.md`의 소규모 감정 구조·죽음의 대가·감정 이입·기대감 기반 메커니즘·통합 관점 표를 이어서 처리한다.

## Batch 52: 세부 개요·핵심 소재·감정 메커니즘 현지화

`outline-structure-theory.md`에서 플롯 단위별 세부 개요 배치, 장르별 장 위치 비중·글자 수 예산, 구조 품질 체크리스트를 한국어로 현지화했다. `outline-conflict.md`에서는 핵심 소재 3분법, 장르별 순환 핵심, 설정 기반 플롯 추론, 정보 전달 순서 체계를 번역했다. `emotional-arc-design.md`에서는 작은 것으로 큰 감정을 만드는 구조, 죽음의 대가·접착제·장기 유지, 감정 이입 문체, 기대감 유지의 기반 메커니즘을 현지화했다.

기능 보호 항목인 `workflow-setup.md#phase-3大纲搭建`, `剧情/`, `cross-book-recall.md`, `Σ` 계약, 경로·필드·상태값·정규식·Gate·플레이스홀더는 변경하지 않았다. 다음 배치에서는 세 문서의 남은 일반 설명·예시·통합 관점 표와 전체 용어 일치성을 전수 검수한다.

## 2단계 장편 핵심 문서 전체 상태

| 문서군 | 상태 | 이번 기준의 처리 범위 | 잔여 작업 |
|---|---|---|---|
| `writing-craft.md` | 전수 검수 진행 | 책임 범위·신체 디테일·관통 소품 등 주요 규칙 현지화, 혼합 예시·템플릿 토큰 분류 | `设定.md`, `细纲`, `正文` 등 프로젝트 경로·원문 예시를 제외한 후반 혼합 설명 정리 |
| `genre-prose-cards.md` | 전수 검수 완료 | 세부 개요·신뢰도·소재 카드·경성 규칙의 혼합 설명 현지화, 경로·카드 식별자 보존 | 카드별 하위 문서와 원문 소재명은 별도 전수 대조 |
| `style-craft.md` | 전수 검수 완료 | 위험 표현 설명·혼합 표기 검수 | `仿佛`, `犹如`, `地/得` 등 실제 탐지 패턴과 예시 문자열은 기능 데이터로 보존 |
| `commercial-core-methods.md` | 전수 검수 진행 | 상업성 원칙·독자 유지·감정·상업화 실행, 클리셰 전복·반복 인식·리듬·복선 설명 현지화 | 후반 판매 포인트·금손가락·독자 유지 예시의 기능성/비기능성 최종 대조 |
| `outline-structure-theory.md` | 전수 검수 진행 | 구조 선택·비교 리듬·지도 전환·세부 개요·장 위치·품질 체크리스트 | 기능 경로 외 잔여 예시·설명 최종 대조 |
| `outline-conflict.md` | 전수 검수 진행 | 갈등 엔진·감정선·금손가락·순환·동기·플롯 조직·체크리스트 | 초기 구조 표와 예시의 비기능성 문장 최종 대조 |
| `emotional-arc-design.md` | 전수 검수 진행 | 감정선 단계·압박·감정 공식·연애 감정·기대감·체크리스트 | 다이어그램 표기·남은 예시·용어 최종 대조 |

따라서 2단계는 **최종 전수 검수 진행 단계**다. `genre-prose-cards.md`와 `style-craft.md`는 이번 기준의 전수 검수를 마쳤고, `writing-craft.md`·`commercial-core-methods.md` 및 구조·갈등·감정선 문서는 원문 예시·도표·후반 설명의 세부 대조가 남아 있다. 모든 일반 설명이 제거되고 기능 보호 목록이 확정되기 전에는 2단계 전체 완료로 표시하지 않는다.

## 미완료 및 다음 대상

`skills/` 전체에서 중국어 문자가 남아 있는 후보는 100개 이상으로 확인됐다. 다만 이 후보에는 문서 본문뿐 아니라 실행 코드의 외부 사이트 필드명·선택자·URL, 테스트 문자열, 스크래퍼 식별자가 함께 포함되어 있다. 다음 작업에서는 후보 파일을 작은 배치로 직접 읽어 기능 연결 문자열과 문서 언어를 분리한다.

Batch 29~33까지 `skills/story-setup/references/templates/`의 주요 agent·hook·rule 문서 현지화를 완료했고, Batch 34에서 `anti-ai-writing.md`와 `banned-words.md`, Batch 35에서 `quality-checklist.md`와 `quality-rubric.md`, Batch 36에서 `character-relations.md`와 `dialogue-mastery.md`를 착수했다. Batch 37에서는 `plot-core-methods.md`의 절정 역추론·AB 대개요를 처리하고 플랫폼별 rubric의 현지화 상태를 점검했다. Batch 38에서는 감정선·수라장 세부 규칙과 skills 전체 전수 조사 계획을 반영했다. Batch 39에서는 plot 잔여 구간과 인물 행동·호감도 구간을 추가 현지화하고, `skills/` 전체 후보 221개에 대한 유형별 일괄 번역 계획을 실제 조사 단계로 옮겼다. Batch 40에서는 `tracking-transaction.md`를 1차 핵심 문서 배치로 동기화했다. Batch 41에서는 `story-short-*` 공용 `output-contract.md`를 현지화·동기화하고 세 플랫폼 rubric의 용어 교차 검수를 완료했다. 다음 우선순위는 `character-relations.md`의 남은 감정선·인물 규칙 정리, `plot-core-methods.md` 후속 구간, 플랫폼 rubric 교차 검수와 tracking 문서다. 각 파일에서 URL·필드명·선택자·정규식·CLI 옵션·출력 파일명·고유명은 기능 보호 예외로 분리한다.

## 검증 상태

Batch 28의 네 스크립트와 Batch 31의 `story_hook_core.js`는 `node --check`를 통과했다. Batch 33의 `guard-outline-before-prose.sh`는 Windows Git Bash `bash -n`을 통과했으며, `story-outline.md`는 제목 18개·코드 펜스 4개와 기능 필드를 유지했다. Batch 34의 AI 문체 참조본과 Batch 35의 quality 문서는 `git diff --check`를 통과했으며, Batch 35는 `90a993f`로 원격에 반영됐다. Batch 36~54의 변경은 `git diff --check`를 통과했다. `character-relations.md`의 감정선·수라장·인물 행동·호감도 구간은 추가 현지화했으며, 5종 감정선 템플릿과 인물 목표·관계선 후반에는 잔여 중국어 설명이 남아 있다. `skills/` 전수 조사는 후보 221개를 확인했지만 기능 문자열 분류와 번역은 단계별로 계속 진행한다. Batch 35의 `quality-checklist.md`는 제목 30개·표 78행·코드 펜스 2개, `quality-rubric.md`는 제목 6개·표 25행·코드 펜스 2개를 유지했다. 동명 참조본은 기존 shared-file 규칙에 따라 관리하며, 전체 `check-shared-files.sh`에서 보고되는 스크립트 drift는 별도 잔여 과제다. `demo/` 본문은 이번 단계에서 변경하지 않았다.

## 주의사항

이 보고서의 “완료”는 해당 배치의 문서 현지화가 원격에 반영됐다는 뜻이며, `skills/` 전체의 중국어가 모두 제거됐다는 뜻은 아니다. 중국어 한자어·사자성어가 한국어에서도 널리 쓰이는 경우는 문맥상 남길 수 있지만, 중국에서만 통용되는 표현이나 문장·인용·설명은 계속 한국어로 바꾼다.
