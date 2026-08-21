# 중국어→한국어 현지화 진행상황 보고서

## 기준 시점

본 보고서는 `2026-08-21` 현재 `main` 브랜치의 실제 저장소 상태를 기준으로 갱신했다. 마지막 원격 커밋은 `9441e03`이며, Batch 29의 첫 템플릿 번역 변경이 작업 트리에 적용되어 있다.

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

## Batch 29: story-setup 템플릿 첫 배치 진행 중

`skills/story-setup/references/templates/agents/chapter-extractor.md` 전체를 첫 대상으로 선정해 frontmatter 설명, 역할 정의, 분석 범위, 입력 형식, 객관적 사실 묘사, 서사 프레임 금지, 시간 순서, 정보 충실도, JSON 출력 설명, 사건 지점 밀도·유형·인용 규칙, 역할 추출 규칙, 별칭 처리, 품질 검사, 도메인 경계와 후반 Markdown 출력 템플릿을 한국어로 현지화했다.

기능 계약인 frontmatter 키, `tools`·`disallowedTools`, 모델·턴 설정, JSON 키와 출력 구조, `OUTPUT_MODE: json`, `major|supporting|minor`, `基调：`, `主题标签` 및 사건 유형·주제·기조의 원문 열거값은 보존했다. 템플릿 파일의 설명 문장은 한국어화했지만 파서와 호출부가 의존할 수 있는 고정 표식은 유지했다. 이번 변경은 다음 검증 후 커밋·푸시한다.

## 완료된 커밋

| 커밋 | 내용 | 상태 |
|---|---|---|
| `ee4c0df` | 기존 한국어 번역 전수 검수 1차. 장편·단편·리뷰·설정 참조본의 문체, 용어, 중국어 잔재 수정 | 원격 반영 완료 |
| `d3183f1` | 중국어 문서 현지화 1차: `artifact-protocols`, `banned-words`, `character-basics`, `character-relations`, `cross-book-recall` | 원격 반영 완료 |
| `3e6f8fb` | 중국어 문서 현지화 2차: `emotional-arc-design` | 원격 반영 완료 |
| `5b7f673` | 중국어 문서 현지화 3차: `genre-catalog`, `genre-core-mechanics` | 원격 반영 완료 |

위 네 커밋은 모두 `origin/main`에 순차적으로 푸시했다. 각 커밋은 작은 배치로 생성했으며, 현재 미커밋 변경은 없다.

## 이번 단계에서 현지화한 주요 내용

`story-long-write` 참고자료에 남아 있던 중국어 설명, 템플릿 항목, 감정선·장르·캐릭터 설계 표, 작품 분석과 비교 자료에 관한 설명을 한국어로 옮겼다. 특히 중국어식 지시문과 설명문을 한국어의 동사 중심 문장으로 재구성했으며, 「追妻火葬场」처럼 직역하면 어색한 장르명은 한국 독자가 이해할 수 있는 표현으로 풀어 썼다.

기존 전수 검수 커밋에서는 `进行`, `关于`, `对于`가 포함된 번역 잔재와 중국어 문장 예시를 우선 교정했다. 동일 내용의 `story-setup` 중복 참조본에도 같은 표현을 적용해 용어 불일치를 줄였다.

## 미완료 및 다음 대상

`skills/` 전체에서 중국어 문자가 남아 있는 후보는 100개 이상으로 확인됐다. 다만 이 후보에는 문서 본문뿐 아니라 실행 코드의 외부 사이트 필드명·선택자·URL, 테스트 문자열, 스크래퍼 식별자가 함께 포함되어 있다. 다음 작업에서는 후보 파일을 작은 배치로 직접 읽어 기능 연결 문자열과 문서 언어를 분리한다.

현재 문서·스크립트 번역은 배치 단위로 진행 중이며, Batch 28의 네 스크립트 변경까지 원격에 반영됐다. Batch 29에서는 `chapter-extractor.md` 전체 번역을 완료했다. 다음 우선순위는 `skills/story-setup/references/templates/`의 실행 주석·사용자 표시 메시지, `TRANSLATION_PROGRESS_REPORT.md`와 `memory-bank/TRANSLATION_HANDOVER.md`의 설명 문장, 그리고 남은 `skills/` 참조 문서다. 각 파일에서 URL·필드명·선택자·정규식·CLI 옵션·출력 파일명·고유명은 기능 보호 예외로 분리한다.

## 검증 상태

Batch 28 기준으로 네 스크립트의 `node --check`와 `git diff --check`는 통과했다. Batch 29의 `chapter-extractor.md`는 Markdown 제목·표·코드 펜스, frontmatter 핵심 키, JSON 출력 키와 고정 열거값을 검증했으며 `git diff --check`를 통과했다. 현재 작업 트리는 Batch 29 변경으로 clean하지 않다. `demo/` 본문은 이번 단계에서 변경하지 않았다. 중국어 잔존 전수 검색은 기능 문자열과 일반 설명을 분리해야 하므로 파일 단위의 소규모 검색과 직접 검수를 병행한다.

## 주의사항

이 보고서의 “완료”는 해당 배치의 문서 현지화가 원격에 반영됐다는 뜻이며, `skills/` 전체의 중국어가 모두 제거됐다는 뜻은 아니다. 중국어 한자어·사자성어가 한국어에서도 널리 쓰이는 경우는 문맥상 남길 수 있지만, 중국에서만 통용되는 표현이나 문장·인용·설명은 계속 한국어로 바꾼다.
