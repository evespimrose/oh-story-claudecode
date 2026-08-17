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
- [ ] `skills/story-long-write/references/workflow-daily.md`
- [ ] `skills/story-long-write/references/workflow-revision.md`
- [ ] `skills/story-long-write/references/workflow-setup.md`

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












## 다음 세션 재개 지점 (Batch 22)

- **현재 완료 커밋:** `b2daf5f` — `tracking-transaction.md` 한국어 현지화 및 TODO 갱신, 원격 `main`에 푸시 완료.
- **현재 브랜치 상태:** `main`은 `origin/main`과 동기화되어 있으며, 인수인계 작성 전 작업 트리는 깨끗했음.
- **다음 대상:** `skills/story-long-write/references/workflow-daily.md`.
- **다음 작업 순서:** 먼저 `git ls-files -- skills/story-long-write/references/workflow-daily.md`로 실제 경로를 확인한다. 원문을 샌드박스로 가져와 기능용 문자열(경로, 명령어, 정규식, JSON 키, URL, 앵커, 셀렉터)을 보호한 상태로 번역한다. 번역 후 기능 문자열 복원 여부, 가시 본문 CJK 잔존, Markdown 줄 구조, `git diff --check`를 검증한다.
- **현재 주의사항:** 이전 세션에서 `workflow-daily.md`의 번역 후보를 만들었으나 품질 검증을 통과하지 못해 원격 저장소에는 적용하지 않았다. 특히 줄 병합, 메타 안내 문구 삽입, 보호 토큰 변형이 발생했으므로 해당 후보를 그대로 사용하지 말고 원문에서 다시 시작한다.
- **커밋 규칙:** 검증을 통과한 변경만 5MB 미만 단위로 커밋하고 즉시 푸시한다. `demo/` 디렉터리는 수정하지 않는다.
