# 중국어→한국어 현지화 작업 목록

> 최종 갱신 기준: 2026-08-17
> 기준 브랜치: `main`
> 기준 커밋: `5b7f673` (`localize-chinese-docs-batch-3`)
> 진행상황 보고서: `TRANSLATION_PROGRESS_REPORT.md`

## 작업 원칙

- 실행 기능에 직접 연결된 URL, 외부 API 필드명, CSS 선택자, 정규식 대상 문자열, 사이트 식별자, 테스트 픽스처는 보존합니다.
- 그 밖의 문서 본문, 주석, 예시, 인용, 표 항목, 설명문은 한국어로 현지화합니다.
- 한국에서 널리 쓰이는 한자어·관용 표현·사자성어는 문맥상 유지할 수 있으나, 중국에서만 통용되는 문장과 표현은 남기지 않습니다.
- `demo/` 하위 본문은 수정하지 않습니다. 필요한 경우 기존 규칙에 따라 파일명과 디렉터리명만 다룹니다.
- 번역은 직역하지 않고 문맥과 장르 기능을 보존하는 자연스러운 한국어로 재구성합니다.
- 작업은 작은 배치로 나누고, 각 배치의 검증 후 별도 커밋·푸시합니다.

## 완료된 작업

### 기존 번역 전수 검수 1차

- [x] `ee4c0df full-korean-translation-review` 커밋 및 푸시
- [x] `story-long-analyze`, `story-long-write`, `story-review`, `story-short-write` 문서의 중국어 잔재·번역투·문자 손상 표본 검수
- [x] `story-setup/references/agent-references` 중복 참조본의 용어 동기화

### 중국어 문서 현지화 배치

- [x] `d3183f1 localize-chinese-docs-batch-1` 커밋 및 푸시
- [x] `skills/story-long-write/references/artifact-protocols.md`
- [x] `skills/story-long-write/references/banned-words.md`
- [x] `skills/story-long-write/references/character-basics.md`
- [x] `skills/story-long-write/references/character-relations.md`
- [x] `skills/story-long-write/references/cross-book-recall.md`
- [x] `3e6f8fb localize-chinese-docs-batch-2` 커밋 및 푸시
- [x] `skills/story-long-write/references/emotional-arc-design.md`
- [x] `5b7f673 localize-chinese-docs-batch-3` 커밋 및 푸시
- [x] `skills/story-long-write/references/genre-catalog.md`
- [x] `skills/story-long-write/references/genre-core-mechanics.md`

## 현재 진행 중이던 항목

- [x] `skills/story-long-write/references/genre-readers.md` — Batch 4 완료, 커밋 `59443c5`
  - 문서 설명·표·예시의 중국어를 한국어로 번역하는 작업을 시작했으나 아직 완료하지 않았습니다.
  - 마지막 실행이 완료되지 않았으므로 커밋·푸시하지 않았습니다.

## 다음 문서 번역 배치

- [x] `skills/story-long-write/references/emotional-methods.md` — Batch 5 완료, 커밋 `ae098bb`
- [x] `skills/story-long-write/references/female-audience-writing.md` — Batch 6 완료, 커밋 `6d8d011`
- [x] `skills/story-long-write/references/genre-writing-formulas.md` — Batch 7 완료, 커밋 `c3ebe5b`
- [x] `skills/story-short-write/references/genre-writing-techniques.md` — Batch 8 완료, 커밋 `8b29f4d` (TODO의 장기 경로 오기 정정)
- [x] `skills/story-long-write/references/hooks-paragraph.md`
- [x] `skills/story-long-write/references/hooks-suspense.md`
- [x] `skills/story-long-write/references/outline-methods.md`
- [x] `skills/story-long-write/references/outline-rhythm.md`
- [x] `skills/story-long-write/references/plot-core-methods.md`
- [x] `skills/story-long-write/references/plot-emotion-system.md`
- [x] `skills/story-long-write/references/plot-special-topics.md`
- [x] `skills/story-long-write/references/quality-checklist.md`
- [x] `skills/story-long-write/references/reversal-toolkit.md`
- [x] `skills/story-long-write/references/state-tracking.md`
- [x] `skills/story-long-write/references/style-craft.md`
- [x] `skills/story-long-write/references/style-combat-face.md`
- [x] `skills/story-long-write/references/tracking-transaction.md` — Batch 21
- [x] `skills/story-long-write/references/workflow-daily.md` — Batch 22 완료(검수 후 작업 트리에 적용)
- [x] `skills/story-long-write/references/workflow-revision.md` — Batch 23 완료(검수 후 작업 트리에 적용)
- [x] `skills/story-long-write/references/workflow-setup.md` — Batch 24 완료(수동 번역·검수 후 작업 트리에 적용)

## 기능 연결 문자열 검토 대상

- [ ] 스크래퍼의 중국어 사이트명, URL, 필드명, CSS 선택자, 정규식 대상은 기능 보존을 위해 원문 유지 여부를 확인
- [ ] 코드 주석과 사용자에게 표시되는 오류·상태 메시지는 한국어로 번역
- [ ] 테스트 픽스처는 실행 기능과 직접 연결되는지 확인한 뒤 보존 또는 함께 교체
- [ ] `story-setup/references/templates/`의 셸·JavaScript·규칙 파일은 코드와 설명을 분리해 검토

## 전수 검증

- [ ] 비-demo 문서 본문의 중국어 잔존 재검색
- [ ] 중국에서만 통용되는 문장·인용·설명 제거
- [ ] 한국에서 널리 쓰이는 한자어·관용 표현·사자성어 예외 목록 재검토
- [ ] 실행 기능 연결 문자열이 훼손되지 않았는지 확인
- [ ] `demo/` 본문 변경 여부 확인
- [ ] 경로 참조와 중복 참조본의 용어 일관성 확인
- [ ] `git diff --check` 통과 확인
- [ ] 배치별 5MB 이하 커밋 및 순차 푸시












## 번역·검증 실행 기록 (Batch 28)

- `skills/story-long-scan/scripts/fanqie-rank-scraper.js`의 사용법·수집 전략·상세 파싱·연결 오류·품질 경고·저장 로그 주석을 한국어로 번역했다. URL, `__INITIAL_STATE__`, JSON 필드, 정규식, 채널·장르 ID, CLI 옵션과 출력 파일명 형식은 보존했다.
- `skills/story-short-scan/scripts/cdp-utils.js`의 공통 CDP 유틸리티 주석과 JSDoc을 한국어로 번역했다. `agent-browser`, base64 인자, `evalJSONBase64`, 경로, 옵션, 반환 객체 키는 보존했다.
- `skills/story-short-scan/scripts/dz-browse-scraper.js`의 점중 단편 수집 주석·연결 오류·채널 전환·품질 경고·저장 로그를 한국어로 번역했다. `/book/{id}`, URL, DOM 선택자, 정규식, `bookId`, 채널 ID와 탭 값은 보존했다.
- `skills/story-short-scan/scripts/heiyan-booklist-scraper.js`의 흑암 API 수집 주석·로그·로그인 안내·필드 품질 게이트·채널 필터 메시지를 한국어로 번역했다. API URL, `Admin-Token`, Bearer 인증, JSON 키, `--channel`, `--pages`, `--detail`, 분류 값은 보존했다.
- 네 파일 모두 `node --check`와 `git diff --check`를 통과했다. 중국어 잔존은 실제 출력 파일명·분류 값·사이트명·정규식 대상·플랫폼 원문을 포함한 기능 보호 예외로 분리했다. `demo/`는 수정하지 않았다.
- `TRANSLATION_PROGRESS_REPORT.md`에 Batch 28 결과와 다음 작업 범위를 기록했다. 이번 배치는 아직 커밋·푸시하지 않았다.

## 번역·검증 실행 기록 (Batch 27)

- `CHANGELOG.md` 후반부(v0.7.0 이하)의 설명용 중국어 혼용 표현을 추가 현지화했다. `세纲`, `章首`, `章尾`, `中文化`, `信息差`, `前3章`, `套路` 등 일반 설명 문장은 각각 `세부 개요`, `장 시작`, `장 끝`, `한국어화`, `정보 격차`, `처음 3장`, `클리셰`로 재구성했다. 경로·필드명·상태 토큰·고유명은 보존했다.
- `README_EN.md` 후반부를 대조 검토했다. 남아 있는 중국어는 `demo/` 예시 파일명, 프로젝트 경로, CLI 인자, 플랫폼·작품 고유명, 실제 트리의 파일명과 자연어 트리거 예시로 판정되어 변경하지 않았다. 일반 영어 설명문에 번역 대상인 중국어 문장이 남아 있지 않음을 확인했다.
- 검증 결과: `CHANGELOG.md` 446행·77개 제목·2개 코드 펜스, `README_EN.md` 393행·14개 제목·16개 코드 펜스를 유지했다. `ciweimao-rank-scraper.js`의 `node --check`가 통과했고, `git diff --check`도 통과했다.
- 현재 변경은 `CHANGELOG.md`, `README.md`, `TRANSLATION_TODO.md`, `skills/story-long-scan/scripts/ciweimao-rank-scraper.js`에 한정된다. `demo/`는 수정하지 않았다.

## 번역·검증 실행 기록 (Batch 26)

- `README.md`의 설명 문장에 남은 중국어 표현과 혼용 문장부호를 정리했다. demo 파일명, 플랫폼 고유명, 프로젝트 경로와 명령어는 보호했다.
- `CHANGELOG.md`의 상단 및 v0.7.x 구간에서 확인된 중국어 혼용 설명을 한국어로 보완했다. `세纲`처럼 설명 문장에만 쓰인 용어는 `세부 개요`로 바꾸고, `循环ID`, `单元ID`처럼 기능 필드명은 보존했다. CHANGELOG 전체는 고유명·경로·기능 식별자가 섞여 있으므로 전수 완료로 표시하지 않는다.
- `skills/story-long-scan/scripts/ciweimao-rank-scraper.js`의 주석과 사용자 표시 로그를 한국어로 번역했다. 사이트 헤더, 순위 ID, URL, DOM 선택자, 정규식, JSON 필드, CLI 옵션, 파일명 구성과 반환 구조는 보존했다.
- 검증 결과: `node --check` 통과, 보호 토큰 HEAD/NOW 존재 여부 일치, Markdown의 코드 펜스·제목 구조 유지, `git diff --check` 통과.
- 비-demo Markdown에는 아직 중국어가 남아 있다. README 계열의 중국어 고유명·demo 경로는 보호 예외로 분리해야 하며, CHANGELOG 후반부와 `skills/` 참조 문서는 추가 검토가 필요하다.

## 검증 실행 기록 (Batch 25)

- `skills/story-long-write/references/workflow-daily.md`, `workflow-revision.md`, `workflow-setup.md`의 경로·명령어·URL·인라인 코드·플레이스홀더를 상대 경로 기준으로 대조했다. 실제 누락이 아니라 조건부로 배포되는 `.claude/agents/story-explorer.md`와 `.claude/agents/story-architect.md` 참조만 확인되었으며, 현재 저장소에는 해당 agent 파일이 없어 기능 결함으로 단정하지 않는다.
- 스크래퍼 7개(`skills/story-long-scan/scripts/*scraper.js`, `skills/story-short-scan/scripts/*scraper.js`)와 `skills/story-setup/references/templates/`의 셸·JavaScript·JSON·규칙 파일 28개를 검사했다. 중국어 주석·사이트명·랭킹 라벨·오류 메시지가 실행 문자열과 섞여 있으므로, 기능 토큰을 보호한 채 주석과 사용자 표시 메시지를 번역하는 후속 배치가 필요하다.
- 비-demo Markdown 전수 검색 결과, 아직 중국어가 남은 문서가 다수이며 전수 검증은 미완료다. 특히 `CHANGELOG.md`, `README.md`, `README_EN.md`, `TRANSLATION_PROGRESS_REPORT.md`, `skills/story-long-analyze/`, `skills/story-long-scan/`, `skills/story-long-write/`, `skills/story-setup/`, `skills/story-review/`, `skills/story-short-*`의 다수 참조 문서가 남아 있다. 코드·경로·고유 식별자에 포함된 중국어는 기능 보호 예외로 별도 판정해야 한다.
- 새 스킬 `.claude/skills/chinese-translation-localization/SKILL.md`는 frontmatter, `CAVE-MAN-OUTPUT-ARM` 마커, 500줄 이하 조건, 시작·번역·검증·TODO·커밋 절차를 모두 통과했다(70줄).
- `git diff --check`는 통과했다. 이번 감사에서 문서 본문이나 스크립트는 수정하지 않았으며, 감사용 임시 파일은 제거했다.

## 다음 세션 재개 지점 (Batch 28)

- **현재 완료 커밋:** `b2daf5f` — `tracking-transaction.md` 한국어 현지화 및 TODO 갱신, 원격 `main`에 푸시 완료.
- **현재 브랜치 상태:** `main`은 Batch 28 번역 파일과 TODO·진행 보고서가 작업 트리에 적용된 상태이며, 아직 새 커밋·푸시는 하지 않았다.
- **완료 대상:** `skills/story-long-scan/scripts/fanqie-rank-scraper.js`, `skills/story-short-scan/scripts/cdp-utils.js`, `dz-browse-scraper.js`, `heiyan-booklist-scraper.js`.
- **다음 대상 파일:** `skills/story-setup/references/templates/`의 실행 주석·사용자 표시 메시지, `memory-bank/TRANSLATION_HANDOVER.md`의 설명 문장, 이후 남은 `skills/` 참조 문서.
- **다음 작업 순서:** URL·필드명·선택자·정규식·CLI 옵션·출력 파일명·고유명은 보호하고, story-setup 템플릿과 인수인계 문서의 일반 주석·도움말·설명만 작은 배치로 번역한다. 이후 기능 연결 문자열과 비-demo Markdown의 중국어 잔존을 재검증한다.
- **현재 주의사항:** `workflow-daily.md`, `workflow-revision.md`, `workflow-setup.md`는 한국어 현지화하여 적용했으며 `git diff --check`를 통과했다. 작업 트리에는 기존 변경과 이번 번역 변경이 함께 있을 수 있으므로 일괄 복원·리셋하지 않는다.
- **커밋 규칙:** 사용자가 커밋·푸시를 명시하거나 프로젝트 작업 규칙상 승인된 경우에만 검증된 변경을 5MB 미만 단위로 커밋·푸시한다. `demo/` 디렉터리는 수정하지 않는다.
