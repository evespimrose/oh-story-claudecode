# 중한 번역 작업 인수인계

> **작성 목적:** 다음 세션이 현재 번역 작업의 실제 적용 상태, 미완료 범위, 안전 제약과 재개 절차를 정확히 파악하도록 작성한 최신 인계 기록이다. 번역 재개 전 반드시 프로젝트 루트의 [`TRANSLATION_TODO.md`](../TRANSLATION_TODO.md)와 [`TRANSLATION_PROGRESS_REPORT.md`](../TRANSLATION_PROGRESS_REPORT.md)를 함께 읽는다. 두 문서의 지시가 충돌하면 사용자의 확인을 우선 요청한다.

## 1. 현재 기준점

현재 기준 브랜치는 `main`이며, 이번 변경을 커밋하기 전에는 로컬 작업 트리에 Batch 29~33 변경이 있다. 커밋·푸시가 끝나면 `HEAD`와 `origin/main`의 실제 해시를 다시 기록한다.

| 항목 | 현재 값 |
|---|---|
| 최신 기준 커밋 | 커밋·푸시 후 실제 `HEAD`로 갱신 |
| 직전 기준 커밋 | `e3af35a` (`localize chapter extractor template (batch 29)`) |
| 원격 상태 | Batch 29~33 커밋·푸시 대기 |
| 작업 트리 | Batch 29~33 및 진행 문서 변경 있음 |
| 마지막 확인일 | 2026-08-22 |

기준 커밋 `e3af35a`에는 Batch 29의 `chapter-extractor.md` 전체 현지화가 포함되어 있다. 이후 작업 트리에서 Batch 30~33의 `story-explorer.md`, `story_hook_core.js`, `consistency-checker.md`, `story-researcher.md`, `guard-outline-before-prose.sh`, `story-outline.md`와 진행 문서를 갱신했다. Batch 28 스크립트 현지화는 `8662413`, Batch 28 인수인계 갱신은 `9441e03`에 포함되어 있다.

## 2. 반드시 지켜야 할 작업 원칙

> 실행 기능에 직접 연결된 문자열은 보존하고, 그 밖의 문서 본문·주석·예시·인용·설명과 사용자 표시 메시지는 자연스러운 한국어로 현지화한다.

다음 항목은 임의로 번역하지 않는다.

| 보호 대상 | 예시 |
|---|---|
| 외부 사이트 연결 정보 | URL, 도메인, API 경로, 사이트 식별자 |
| 실행·파싱 토큰 | JSON/YAML 키, CSS·DOM 선택자, 정규식, `__INITIAL_STATE__`, `Admin-Token` |
| CLI·파일 연결 정보 | 명령어, 옵션, 플레이스홀더, 경로, 출력 파일명 형식 |
| 데이터·테스트 계약 | 직렬화 필드명, 테스트 픽스처, 순위·채널·분류 ID |
| 저장소 제약 | `demo/` 본문, 사용자가 수정 중인 파일, 중복 참조본의 구조 |

`demo/` 하위 파일은 본문을 수정하지 않는다. 사용자가 명시적으로 제약을 변경하지 않는 한 파일명·디렉터리명 현지화만 `TRANSLATION_TODO.md`의 매핑 표에 따라 검토한다. 기존 작업을 보존하기 위해 일괄 복원, 강제 체크아웃, 리셋을 실행하지 않는다.

## 3. Batch 33까지 완료된 범위

### 3.1 문서·워크플로 현지화

기존 배치에서 장편·단편·리뷰·설정 참고자료와 다음 워크플로 문서를 한국어로 현지화했다.

- `skills/story-long-write/references/tracking-transaction.md`
- `skills/story-long-write/references/workflow-daily.md`
- `skills/story-long-write/references/workflow-revision.md`
- `skills/story-long-write/references/workflow-setup.md`
- `skills/story-setup/references/templates/agents/chapter-extractor.md` 전체
- `skills/story-setup/references/templates/agents/story-explorer.md`
- `skills/story-setup/references/templates/agents/consistency-checker.md`
- `skills/story-setup/references/templates/agents/story-researcher.md`
- `skills/story-setup/references/templates/hooks/guard-outline-before-prose.sh`
- `skills/story-setup/references/templates/rules/story-outline.md`
- `CHANGELOG.md`의 주요 구간 및 후반부
- `README.md`의 설명 문장
- `README_EN.md` 후반부 대조 검토

`README_EN.md`에 남은 중국어는 demo 파일명, 프로젝트 경로, CLI 인자, 플랫폼·작품 고유명, 트리 파일명과 자연어 트리거 예시로 판정해 기능·식별자 보호 차원에서 유지했다.

### 3.2 스크립트 현지화

Batch 26~33에서 다음 스크립트의 일반 주석, JSDoc, 사용자 표시 로그와 오류 메시지를 한국어로 현지화했다.

| 파일 | 기능 보호 항목 |
|---|---|
| `skills/story-long-scan/scripts/ciweimao-rank-scraper.js` | 사이트 헤더, 순위 ID, URL, DOM 선택자, 정규식, JSON 필드, CLI 옵션, 파일명 구성, 반환 구조 |
| `skills/story-long-scan/scripts/fanqie-rank-scraper.js` | URL, `__INITIAL_STATE__`, JSON 필드, 정규식, 채널·장르 ID, CLI 옵션, 출력 파일명 형식 |
| `skills/story-short-scan/scripts/cdp-utils.js` | `agent-browser`, base64 인자, `evalJSONBase64`, 경로, 옵션, 반환 객체 키 |
| `skills/story-short-scan/scripts/dz-browse-scraper.js` | `/book/{id}`, URL, DOM 선택자, 정규식, `bookId`, 채널 ID·탭 값 |
| `skills/story-short-scan/scripts/heiyan-booklist-scraper.js` | API URL, `Admin-Token`, Bearer 인증, JSON 키, `--channel`, `--pages`, `--detail`, 분류 값 |

### 3.3 재사용 스킬

`.claude/skills/chinese-translation-localization/SKILL.md`를 생성했다. 이 스킬은 기능 문자열 보호, 문서 구조 보존, 자동 번역 실패 시 수동 구간 번역, CJK 잔존 검수, TODO·진행 보고서 갱신, 소규모 커밋·푸시 절차를 규정한다. frontmatter, `CAVE-MAN-OUTPUT-ARM` 마커, 500줄 이하 조건과 기본 검증 항목을 확인했다.

## 4. 검증 상태와 진행률 해석

Batch 28의 네 JavaScript 파일과 Batch 31의 `story_hook_core.js`는 `node --check`를 통과했다. Batch 33의 `guard-outline-before-prose.sh`는 Windows Git Bash `bash -n`을 통과했고, `story-outline.md`의 제목 18개·코드 펜스 4개와 기능 필드를 확인했다. 전체 변경은 `git diff --check`를 통과했다. `demo/` 본문은 Batch 33에서도 수정하지 않았다.

현재 저장소에는 비-demo 텍스트 파일 292개가 추적되어 있으며, 이 중 212개에서 중국어 문자가 검출되는 보수적 후보 집계가 있다. 그러나 이 212개에는 URL, 사이트명, API 필드명, 선택자, 정규식 대상, 출력 파일명, 플랫폼 원문과 같은 보호 문자열이 포함되므로 실제 번역 미완료율과 동일하지 않다. 진행률을 단일 수치로 보고할 때는 파일 단위 보수 지표와 문맥 판정 결과를 구분한다.

전체 현지화는 아직 완료되지 않았다. `skills/`의 중국어 잔존을 일반 설명과 기능 보호 예외로 나누어 전수 검수해야 하며, 파일명·디렉터리명 현지화와 경로 참조 갱신도 별도 작업으로 남아 있다.

## 5. 다음 세션 우선 작업

`TRANSLATION_TODO.md`의 미완료 항목을 최종 기준으로 삼아 다음 순서로 진행한다.

### 5.1 첫 배치: story-setup 템플릿

`chapter-extractor.md`, `story-explorer.md`, `story_hook_core.js`, `consistency-checker.md`, `story-researcher.md`, `guard-outline-before-prose.sh`, `story-outline.md`의 Batch 29~33 현지화를 완료했다. 다음에는 `story-researcher.md`와 연관 rules/hooks의 기능 연결 문자열을 전수 대조한 뒤 `skills/story-review/` 및 `skills/story-short-*`의 남은 참조 문서를 1~3개 단위로 진행한다. 셸·JavaScript·규칙 파일의 실행 구조를 먼저 읽고, 명령어·경로·정규식·키·플레이스홀더를 보호한 뒤 일반 설명만 번역한다.

### 5.2 둘째 배치: 인수인계·진행 문서

`memory-bank/TRANSLATION_HANDOVER.md`는 이번 갱신으로 최신화했다. 다음에는 `TRANSLATION_PROGRESS_REPORT.md`와 `TRANSLATION_TODO.md`의 중국어 잔존을 일반 설명·보호 식별자·인용 예시로 분류해 필요 범위만 정리한다.

### 5.3 셋째 배치 이후: 남은 skills 참조 문서

`skills/` 전체를 한꺼번에 번역하지 않고 1~3개 문서 단위로 처리한다. 각 배치마다 원문 의미·문체·용어를 직접 검수하고, 중복 참조본이 있으면 동일한 용어와 구조를 유지한다.

### 5.4 파일명·경로 현지화

파일명·디렉터리명 변경은 `TRANSLATION_TODO.md`의 매핑 표를 최종 근거로 삼아 `git mv`로 처리한다. 변경 직후 루트 전체에서 이전 중국어 경로 참조를 검색하고, `genre-prose-cards`의 동일 복사본 폴더가 동기화되는지 확인한다. `demo/`는 본문이 아니라 이름만 다룬다.

## 6. 배치별 검증 게이트

각 배치에는 다음 검증을 모두 적용한다.

1. 시작 전에 `git status --porcelain`, `git diff --stat`, `git ls-files`로 현재 상태와 실제 경로를 기록한다.
2. 기존 사용자 변경 파일은 명시적 동의 없이 수정하지 않는다.
3. 번역 후 Markdown 제목·표·코드 펜스·링크 구조와 보호 토큰의 원문 일치 여부를 대조한다.
4. JavaScript·셸 파일은 문법 검사와 관련 테스트를 실행한다.
5. 일반 본문·주석·로그에 남은 중국어와 기능 보호 문자열을 별도로 분류한다.
6. `git diff --check`를 실행하고 `demo/` 본문 변경 여부를 확인한다.
7. 사용자가 커밋을 요청한 경우에만 검증된 변경을 5MB 미만 단위로 커밋하고 원격에 푸시한다.
8. 완료 후 `TRANSLATION_TODO.md`, `TRANSLATION_PROGRESS_REPORT.md`, 본 인계 문서를 최신 커밋과 다음 재개 지점에 맞게 갱신한다.

## 7. 다음 재개 지점

**재개 기준:** 이번 Batch 29~33 변경을 커밋·푸시한 최신 `HEAD`(커밋 후 실제 해시로 갱신).

**첫 작업:** `skills/story-setup/references/templates/agents/story-researcher.md`와 관련 rules/hooks에서 URL·필드명·선택자·정규식·CLI 명령·JSON 키·상태 토큰을 전수 대조한다. 이후 `skills/story-review/` 및 `skills/story-short-*`의 남은 참조 문서를 1~3개 파일 단위로 현지화한다.

**작업 후 기록:** 처리한 파일, 보호한 기능 토큰, 남은 중국어의 판정, 문법·구조 검증 결과를 `TRANSLATION_TODO.md`, `TRANSLATION_PROGRESS_REPORT.md`, 본 문서에 기록한다. 사용자가 커밋·푸시를 명시한 경우에만 검증된 변경을 작은 배치로 원격에 반영한다.

## 8. 참고 파일

| 파일 | 역할 |
|---|---|
| `TRANSLATION_TODO.md` | 번역·파일명 변경·전수 검증의 최우선 작업 목록 |
| `TRANSLATION_PROGRESS_REPORT.md` | 배치별 진행 상황과 검증 기록 |
| `memory-bank/TRANSLATION_HANDOVER.md` | 최신 인수인계와 다음 재개 지점 |
| `.claude/skills/chinese-translation-localization/SKILL.md` | 재사용 가능한 중한 번역 현지화 절차 |
| `chinese_files_list.txt` | 과거 중국어 파일 식별 결과. 현재 상태와 다를 수 있으므로 재생성 필요 |

과거 Batch 22 시점의 커밋·작업 트리 수치와 오래된 자동 번역 실패 기록은 참고용으로 더 이상 현재 기준으로 사용하지 않는다. 다음 세션은 반드시 최신 Git 상태와 두 진행 문서를 재확인한 뒤 작업을 시작한다.
