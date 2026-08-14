# 업그레이드 가이드

## 현재 버전

- `setup_skill_version: 1.2.7`
- `agents_version: 24`

`.story-deployed` 에 누락된 필드가 있거나, `agents_version` 이 누락 / 정수가 아니거나 / `24` 보다 작으면 모두 업데이트 배포 대상으로 간주합니다. 직접 `/story-setup` (Codex 는 `$story-setup`) 을 재실행하세요; 런타임에 단계별로 과거 템플릿을 호환하지 않습니다. 프로젝트의 `agents_version` 이 `24` 보다 크면 로컬 story-setup 이 프로젝트보다 오래된 것입니다: 먼저 oh-story-claudecode 를 업데이트하고, v24 로 다운그레이드해서 덮어쓰면 안됩니다. 역사 버전 변경 사항은 저장소 루트 `CHANGELOG.md` 를 참고하세요.

## 업그레이드 전략

| 전략 | 적용 사례 | 동작 |
|------|----------|------|
| 덮어쓰기 배포 | 신규 프로젝트 | 현재 agents/hooks/rules/reference 번들 기록 |
| 병합 배포 | 기존 프로젝트 | story-setup 관리 파일을 교체하고, 사용자 유지 관리 파일은 병합 |
| 수동 업데이트 | 특정 파일만 업데이트 | 배포 계약에 익숙한 유지보수자에게만 권장 |

항상 story-setup 을 재실행하여 배포기가 owner class 에 따라 파일을 처리하도록 권장합니다.

## 파일 소유권

### story-setup 관리, 교체 가능

이 파일들은 story-setup 이 관리하며, 사용자 정의 내용을 포함하지 않습니다:
- `.claude/hooks/` — 모든 hook 스크립트와 `lib/` 보조 라이브러리
- `.claude/agents/` — 모든 agent 정의
- `.claude/rules/` — 모든 path-scoped 규칙
- `.claude/skills/story-setup/references/agent-references/` — Agent 참고 자료 사본
- `.zcode/skills/{13 known skills}/`、`.zcode/commands/{13 known commands}.md` — oh-story 알려진 이름만 덮어씀
- `.zcode/hooks/story_zcode_hook.js` — ZCode 전용 Hook runner

### 사용자와 story-setup 공동 유지, 관리 블록만 병합

이 파일들은 사용자 정의 내용을 포함할 수 있습니다:
- `CLAUDE.md` — marker/section 별로 병합하며, 사용자 고유 section 은 유지
- `.claude/settings.local.json` — hooks 가 command 별로 중복 제거 후 append, 기타 설정은 유지
- `AGENTS.md` — ZCode/OpenCode/Codex/OpenClaw/generic 을 marker/section 별로 병합
- `.zcode/config.json` — 이벤트, matcher 와 process args 만 중복 제거 병합하여 oh-story Hooks 를 반영, 기타 필드는 유지

### 사용자 상태, 덮어쓰지 않음

- `{책이름}/본문/`、`본문.md`
- `{책이름}/설정/`、`개요/`、`추적/`
- `.active-book`

## v24 현재 계약

- `.claude/rules/story-narrative.md` 에서「AI 어조 금지」레드라인 블록을 삭제했습니다. 이 블록은 `작품분석库/` `대상/벤치마크/` `설정/` 세 가지 path 에서만 로드되고 본문 디렉터리는 전혀 적용되지 않았으며, 다섯 규칙도 narrative-writer 의 7 Gate / 금지 사항과 `check-ai-patterns.js` 의 blocking 규칙에 의해 이미 커버되고 있었습니다.
- `.claude/rules/story-format.md` 의 대화 태그 규칙을「「그가 말했다」「그녀가 말했다」 금지」에서「대화 태그 기계화 피하기」로 개편합니다: 고빈도·정형화된 태그는 동작이나 문맥으로 대체하고, 평범한「말했다」는 저빈도 사용 시 유지할 수 있습니다. 이 파일은 전 저장소에서 유일하게 평범한「말했다」를 위반으로 판정하던 곳으로, `format-and-structure.md` 등 11곳의 기준과 충돌했을 뿐 아니라 마침 `본문/` path 로드되어 본문 작성 시 반드시 적용되었습니다.
- `.claude/agents/narrative-writer.md` 를 약 19% 간소화: 7 Gate / 금지 사항과 중복된 심사 목록(`story-review` spawn 시 완전한 채점 기준을 인라인합니다), 본문 작성 단계의「구체적 글자 수 표현 검증」(심사 측으로 이관), 그리고 줄임표·대시·단락 간 공백·장 메타 정보 정규식의 중복 진술을 삭제했습니다. 작성 규칙 자체가 완화된 것은 아니며, Gate A~G 와 금지 사항 기준은 그대로입니다.
- `.claude/hooks/guard-outline-before-prose.sh` 에 추적 체크포인트 게이트를 보강해, OpenCode / ZCode / Codex 와 동일 순서로 검사합니다: 추적 상태 누락, schema 가 4 가 아님, 연속 상태 카드 개정 번호와 state 불일치, 첫 신규 장 작성 시 이전 장 트랜잭션 미제출 시 모두 본문 작성을 차단합니다. 세纲/개요 게이트는 첫 생성 시에만 판정하지만, 추적 게이트는 첫 생성과 연속 작성 모두 판정합니다. 판정은 `.claude/hooks/story_hook_cli.js` 의 `tracking-checkpoint` 서브커맨드로 공유 코어를 호출해 네 단말이 동일한 구현을 사용합니다; JSON 을 파싱해야 하므로 node 가 없을 때는 이 게이트가 통과됩니다 (개요/세纲 게이트는 여전히 순수 bash 라 어떤 상황에서도 차단할 수 있습니다).
  - **이미 배포된 프로젝트에 미치는 영향**: v0.7.3 부터 마이그레이션해야 했던 구 추적 프로젝트가, 이전까지 Claude Code 에서는 평소처럼 계속 쓸 수 있었지만 이번 버전부터는 차단되기 시작합니다. 안내에 따라 `/story-import` 의「기존 추적 프로젝트 마이그레이션」으로 `추적/` 만 재구성하면 되며, **전체 작품 분석을 다시 돌릴 필요는 없습니다**.

재배포 후 반드시 **새 세션을 열어야** custom agent 가 재등록됩니다.

## v23 현재 계약

- `story-import` 는 저자가 이미 쓴 소설을 작성 프로젝트로 재구성만 합니다: `작품분석库/{가져온 책이름}/` 를 본문/설정/개요/추적으로 마이그레이션하며, 더 이상 자동으로 주/부 벤치마크로 등록하지 않고 프로젝트 `대상/벤치마크/` 로 복사하지도 않습니다. 오직 사용자가 명시적으로 선택하고, 출처가 독립된 `작품분석库/{벤치마크 책이름}/` 의 외부 작품일 때만 `대상/벤치마크/{벤치마크 책이름}/` 로 동기화합니다.
- 외부 벤치마크가 없을 때는 벤치마크 모듈, 리듬과 문풀 리콜만 건너뜁니다; 프로젝트 소재 카드는 여전히 이 책의 소재 정보로부터 생성되며, 더 이상 벤치마크 분기에 의해 잘못 영향받지 않습니다. 벤치마크 주요 산출물 누락은 계속 fail-fast 이며, 오직 단일 옵션 모듈 카드 미적중 시에만 국소적으로 건너뜁니다.
- spawn 가능한 모든 Skill 은 `.story-deployed.agents_version` 를 먼저 읽습니다: v23 과 일치하지 않을 때 **평소처럼 spawn** 하되, 보고서에 버전 불일치를 언급하고 `/story-setup` 재실행과 새 세션 열기를 권장할 뿐입니다. 버전 불일치가 병렬성을 차단하지는 않습니다——버전 올리기가 다른 배포물의 변경으로 인한 경우가 많아 agent 템플릿은 전혀 바뀌지 않았을 수 있기 때문입니다. 실제로 solo/direct 로 다운그레이드하는 경우는, agent 파일이 누락되었거나 런타임에 custom agent 를 노출하지 않을 때 뿐입니다.
- 작성과 가져오기는 현재 작품 분석 산출물만 허용합니다: `플롯/감정모듈.md` 와 `플롯/리듬.md` 누락 시 fail-fast 하고, Stage 3+ 재실행 / 재가져오기 수정 조치를 제시합니다.
- 신규·보충·개요 수정 시 생성하는 세纲은 완전한 장 청사진만 받아들입니다: 단계 위치, 구조 공식, 사전 노출 금지, 내용 요약, 플롯 편성, 인물 관계, 플롯 세분화 또는 결말 설정이 부족하면 먼저 보충한 후 작성해야 합니다. 구판 세纲에 이 필드들이 부족해도 일일 연재를 막지 않으며, 구 필드(핵심 사건, 플롯 포인트 시퀀스, 목표 감정, 장首/장尾 훅, 글자 수 목표)로 폴백 처리합니다.
- 세纲 필드는 이번 장「무슨 일이 일어날지」의 내용 규격이지, 본문의 형태를 규정하지 않습니다: 각 필드는 반드시 본문에서 실현되어야 하지만, 본문은 플롯 포인트를 병합·삽입·재배열할 수 있으며, 항목 순서대로 한 항목 한 문단으로 평평하게 쓰지 않아도 됩니다. 세纲의「결말 / 결말 설정」에는 이번 장 마지막이 어떤 동작·장면·대사에 걸치는지 적지, 상태 판결문을 쓰지 마세요.
- 각 agent adapter 는 본 대상의 canonical 참조 경로만 읽습니다: Claude `.claude/skills/`、OpenCode `skills/`、Codex `.codex/skills/`.
- `_progress.md` 복구 시 `schema_version: 2` 와 장 경계표만 받아들이며, 암묵적인 역사 마이그레이션을 더 이상 실행하지 않습니다.
- Codex hooks 업그레이드는 안정적인 관리 ID 로 교체 등록합니다; 먼저 구식 직접 호출 Python 명령과 기존 launcher 명령을 제거한 후 현재 6개 등록을 기록하므로, 이중 실행되지 않습니다.
- 커스텀 훅이 이미 삭제된 `discover_book_dir()` 를 호출한다면 `discover_active_book()` 로 바꿔주세요. 현재 버전에서 이 호환 별칭은 더 이상 유지하지 않습니다.
- `작품분석库/` 의「미완료 작품 분석」알림을 `_progress.md` 의「최종 상태」값으로 필터링합니다: `completed` / `completed_with_errors` 는 집계하지 않으며, 그 외의 값이나 필드 누락·빈 파일·읽기 불가는 일괄 미완료로 보고합니다. 판정 로직은 `lib/common.sh` 의 `discover_incomplete_analyses()` 에 수용되어 있습니다.
- 수동 버전 업데이트 알림은 24시간 단위로 알림 자체를 스로틀링합니다; GitHub 에 닿지 않을 때는 네거티브 캐시를 기록해 같은 창 내에서 재요청하지 않습니다.

## 업그레이드 단계

1. 프로젝트 루트에서 story-setup 을 재실행합니다.
2. `.story-deployed` 에 `agents_version: 24` 와 `setup_skill_version: 1.2.7` 가 기록되었는지 확인합니다.
3. 대상 CLI 의 agents、hooks/rules 와 reference 번들이 모두 설치 검증을 통과했는지 확인합니다.
4. 새 세션을 열어 custom agents 와 hooks 가 현재 파일을 기준으로 재등록되게 합니다.
5. **장편 연재 프로젝트 필수**: 각 책의 `추적/_tracking-state.json` 존재 여부를 확인합니다. 없다면 구 추적 구조이므로, 아래「추적 모델 마이그레이션」에 따라 `추적/` 를 재구성해야 합니다——그렇지 않으면 다음 장을 쓸 때 차단됩니다.
6. 기존 작품분석库나 세纲이 현재 계약을 만족하지 못하면, 먼저 재분해·재가져오기 또는 세纲을 보충한 후 계속 작성합니다.

## 가져온 프로젝트의 자기 벤치마크 정리 (v23)

구판 `story-import` 가 저자 본인의 가져온 책을 잘못하여 `대상/벤치마크/{현재 책이름}/` 로 만들거나, 심지어 이 책 설정을 "주 벤치마크" 로 등록했을 수 있습니다. 업그레이드가 사용자 파일을 자동 삭제하지는 않으므로, 아래 경계에 따라 수동으로 확인해 주세요:

1. `작품분석库/{가져온 책이름}/` 는 유지합니다; 이것은 이 책 가져오기 분석과 재구성 프로젝트의 데이터 소스이며, 오류 디렉터리가 아닙니다.
2. 프로젝트 루트 `설정/` 를 이 책의 공식 설정으로 간주합니다. `대상/벤치마크/{현재 책이름}/` 의 내용이 단지 이 책 `설정/` 또는 `작품분석库/{가져온 책이름}/` 에서 복사된 것임을 확인하고, 수동 보충 내용이 없다면 잘못 생성된 이 디렉터리를 삭제합니다.
3. `설정/소재포지셔닝.md` 에서 현재 책을 주/부 벤치마크로 등록한 필드를 정리합니다; 진짜 외부 벤치마크 등록은 건드리지 않습니다.
4. 어떤 `대상/벤치마크/{외부 책이름}/` 디렉터리명이 외부 작품처럼 보이지만 내용이 실제로 현재 책에서 왔다면, 이 오류 사본을 삭제한 후 진짜 `작품분석库/{벤치마크 책이름}/` 에서 다시 동기화하세요; 이름만 바꿔 수정인 척 하지 마세요.
5. `/story-setup` (Codex 는 `$story-setup`) 을 재실행하고 새 세션을 열어 v23 agent 템플릿을 적용합니다; 그 전까지 spawn 은 평소처럼 작동하며 버전 불일치 알림만 하나 더 뜰 뿐입니다.

## 추적 모델 마이그레이션 (v0.7.2 및 이전 장편 프로젝트 필독)

장편 추적을「모델이 자유롭게 여러 Markdown 을 작성」방식에서 **`추적/_tracking-state.json` 이라는 단일 구조화 권위 + `scripts/tracking_commit.py` 를 통한 트랜잭션 기록** 방식으로 개편했습니다. 모든 Markdown(연속 상태 카드, 장별 기록, 캐릭터 스냅샷, 복선표, 타임라인 이중 뷰)은 도구가 통째로 생성하는 파생 뷰가 되었으며, 더 이상 수기로 작성하지 않습니다.

### 판단과 결과

| 상황 | 증상 |
|------|------|
| `추적/_tracking-state.json` 이 존재하고 `check` 를 통과 | 정상, 처리 불필요 |
| `_tracking-state.json` 은 없지만 본문은 이미 존재 | 일일 연재 중지; OpenCode / ZCode / Codex 에서 본문을 쓸 때 hook 에 의해 직접 차단 |
| 파일은 존재하나 파생 뷰가 수기로 수정됨 | `check` 에서 `derived view differs from _tracking-state.json` 이라고 보고 |

마이그레이션에 **전체 작품 분석을 다시 돌릴 필요는 없습니다**: 본문, `설정/`, `개요/`, `작품분석库/` 는 모두 영향을 받지 않으며 오직 `추적/` 만 재구성합니다. `/story-import` 의「기존 추적 프로젝트 마이그레이션」을 실행해——마지막으로 완성된 장 번호 N 을 세고, 기존 추적 파일과 최근 몇 장 본문으로 현재 상태를 역추적한 다음 `last_chapter=N` 의 초기화 트랜잭션을 만들어 `tracking_commit.py init` 을 한 번 돌리십시오. 기존 추적 구조는 원본 그대로 `추적/_구추적아카이브/` 로 통째로 이전되며, 삭제하지도 않고 해석에 참여시키지도 않습니다.

### 폐기된 구조

`_tracking-meta.json`、`타임라인/이벤트저장소.json` 및 그 이전 추적 파일들은 더 이상 해석하지 않으며, `commit` 과 `check` 가 만나면 바로 거절합니다.

### 일상 작성 시 두 가지 강제 규약

1. 모든 추적 기록은 반드시 `tracking_commit.py` 를 거칩니다.
2. 파생 뷰가 수정된 경우, 해당 장의 `mode=revision` 트랜잭션으로 통째로 재구성하며 수기로 직접 고치지 않습니다.

## 버전 변경

### v24 (현재)

- `.story-deployed` 의 `agents_version` 을 `24` 로 업그레이드 (`setup_skill_version` 은 그대로 `1.2.7`).
- **본문 작성 전 추적 검사를 Claude Code 에도 복원 (#305)**: 추적 게이트 bash 가드를 공유 코어와 연결해 네 단말 판정 일치.
- **평범한「그가 말했다」대화 태그 규칙 완화 (#312)**: 기존 절대 금지에서「기계화 피하기」로 개편, 11 곳의 다른 기준과 충돌 해소.
- **본문 경로에 적용되지 않던「AI 어조 금지」레드라인 블록 제거 (#312)**.
- **去AI味 기준표가 전보체를 유도하지 않도록 수정 (#312)**: 문단 밀도 규칙과 문장 내 리듬 행을 코퍼스 기준으로 재작성.
- **장편 작성 SKILL.md 로딩량 3분의 1 감소 (#269)**: 책 시작 3단계를 `references/workflow-setup.md` 로 옮겨 699 행 → 455 행.
- **narrative-writer 템플릿 약 20% 간소화 (#312)**: 중복 심사 목록·글자 수 검증·정규화 당부 삭제, 작성 기준은 그대로.
- **bash 가드까지 네 단말 크로스 플랫폼 일치성 단언에 포함 (#305)**: 이전 Codex Python/JS 코어만 잠갔던 것을 bash 측까지 확장.
- 이미 배포된 프로젝트는 `/story-setup` 재실행 + **새 세션 열기** 필수; 기존 추적 장편은 Claude Code 에서 이제 차단되므로 `추적/` 마이그레이션 필요.

### v23 (현재 배포 계약)

- `.story-deployed` 의 `agents_version` 을 `23` 로 업그레이드 (`setup_skill_version` 은 그대로 `1.2.7`).
- **가져온 책과 벤치마크 책을 분리 (#294)**: `story-import` 가 자기 책을 자동으로 주/부 벤치마크에 넣거나 `대상/벤치마크/` 로 복제하지 않음; 외부 벤치마크는 반드시 독립된 `작품분석库/` 출처여야 함.
- **역사 오류 자기 벤치마크 재유입 방지 (#294)**: 장단편 작성·책 간 검색·`story-explorer` 에서 현재 작품·출처가 현재 본문인 분석 디렉터리·오류 생성된 자기 벤치마크를 제외.
- **agent 버전 불일치는 spawn 차단하지 않고 알림만 (F-011, #294)**: 버전 불일치 = solo/direct 강제 다운그레이드 규칙 폐지; 실제 agent 파일 누락이나 runtime custom agent 미지원 시에만 다운그레이드.
- 이미 배포된 프로젝트는「가져온 프로젝트 자기 벤치마크 정리」섹션에 따라 구 디렉터리 확인 후 `/story-setup` 재실행 + **새 세션 열기**.

### v22

- `.story-deployed` 의 `agents_version` 을 `22` 로 업그레이드 (`setup_skill_version` 은 그대로 `1.2.7`).
- **장편 추적 단일 권위 트랜잭션 모델로 개편 (파괴적 변경, #269)**: `추적/_tracking-state.json` 이 유일 구조화 권위. 모든 추적 쓰기는 `scripts/tracking_commit.py` 거침. 연속 상태 카드 7 열 고정·상한 12288 바이트. 전 책 역사는 `추적/逐章记录/제NNN장.md` 로 이전. 복선·타임라인·캐릭터 상태는 파생 뷰로 격하. 구 추적 구조·`_tracking-meta.json`·`시간선/이벤트저장소.json` 은 함께 폐기하며 호환 계층 없음. **v0.7.2 및 이전 장편 프로젝트는「추적 모델 마이그레이션」에 따라 `추적/` 를 재구성해야만 계속 쓸 수 있음**; 본문과 다른 디렉터리는 영향 없음.
- **세 단말 본문 작성 가드에 추적 체크포인트 강제 차단 추가 (#269)**: state 누락·schema 4 아님·연속 상태 카드 개정과 state 불일치·첫 신규 장 작성 시 이전 장 트랜잭션 미제출 → 모두 본문 작성 차단.
- **story-explorer 와 consistency-checker 는 읽기 전용 agent 유지**: Bash 금지. 추적 상태는 호출측 메인 세션에서 `tracking_commit.py check` 를 돌린 후 prompt 와 함께 전달.
- **장 요약을 서술화로 개편 (#276)**: 요약 필드에서「…때문에 …하므로」연결 요구를 폐지. 사건 발생 순서로 무슨 일·왜·결과를 서술. 플롯 방향 바꾸는 동작/결과·비정상 정보·후속 복선·식별 가능 디테일 우선. 같은 접속사 반복 금지·공허 평가 주관 해석 금지 유지. 요약은 여전히 `**요약**：` 행 첫 단독 행 형태 유지 (Stage 2 마무리 무손실 연결 검증 의존).
- **원문 인용 엄선 (#275)**: 플롯 포인트 증거는 P 행 백묘(누가 무엇을·결과·원문 발단·복선 단서 전체 기입)로 전환. P 행에 독립 백묘 필드 신규 추가. 원문 인용은 핵심 전환·핵심 대사·작성 샘플만 장당 최대 8 개·400 자 이내 슬라이스로 남김; 과도하게 길거나 분산 시 `원문 위치：{5-15 자 원문 조각}` 으로 대체. 품질 검사 5 조·JSON schema `summary`/`plot_points` 동기화. 자가 검사 항목 수 표기를「10 개」에서 실제 12 개로 정정.
- **병렬·직렬 두 경로 통일 (#276)**: `story-long-analyze/references/output-templates.md` 에 백묘 철칙·기조 주제 태그 모호성 해소·원문 인용 엄선·Stage 2 출력 자가 검사를 보충해 직렬 경로(ZCode/OpenClaw/Reasonix/generic 등)에서도 `chapter-extractor.md` 를 읽지 않아도 동일 기준 적용.
- **P 행 제목과 백묘 분담 재설계 (#275)**: 굵은 슬롯을 `{사건 요약}` → `{제목}` (15 자 이내 짧은 태그) 으로 교체. 백묘 한 문장이 사실을 담당. 품질 검사 2 조·JSON schema `plot_points.title` 동기화.
- **기계적 강제 검사 1 조 신규 추가 (#275)**: Stage 2 디스크 기록 후 각 P 행마다 백묘 필드 존재 여부를 `grep -cE` 로 검증. 백묘 누락 = 품질 실패: 병렬 경로 sonnet 업그레이드 재시도, 직렬 경로 메인 스레드에서 실패 항목 기준 1 회 재작성.
- **세션 시작 요약 행 수 10 → 18 행 확장**: 새 템플릿 `## 현재 위치` 전 블록(8 필드) 커버.
- **세션 시작 상태 요약 크기 12288 바이트 초과 경보**: `추적/컨텍스트.md` 초과 시 현재 크기와 `추적/장별기록/` 로 옮긴 후 전체 재작성하는 조치 방법 알림. 네 단말(Claude Code/ZCode/OpenCode 공유 JS 코어·Codex Python) 동기화.
- 이미 배포된 프로젝트는 `/story-setup` 재실행 + **새 세션 열기** 필수.

### v21

- `.story-deployed` 의 `agents_version` 을 `21` 로 업그레이드 (`setup_skill_version` 그대로 `1.2.7`).
- **장미 요약마무리체를 작성 전 게이트에 추가 (#255)**: 독 문장 미결산 게이트에 `trailer-summary` 규칙 신규. 기존 `trailer-ending` 과 함께 문말 600 자 윈도우 공유. 「이 밤은 분명… / 이 모든 게 끝났다 / 새 삶이 이제 막 시작됐다 / 운명의 톱니바퀴 / 이렇게, 모든 게 끝났다」 류——세纲「결말 설정·수렴 상태」를 그대로 요약문으로 쓴 결말——에 적중 시 다음 장 작성 전 강제 0 클리어 (`<!-- 去味:건너뜀 -->` 로 면제 가능). 네 단말(Claude/OpenCode/ZCode 공유 JS + Codex Python) 동기화. `check-ai-patterns.js` 4 사본 동일 규칙.
- **「(이/그) 순간… 마침내 깨달았다」와 인지 문장은 여전히 허용**: 단편 1 인칭 심사 금구는 오히려 판매점이므로(`short-craft.md`「심사 금구 / 심장 마디 여운」), 이 부류는 advisory 의 `abstract-summary-tic` 밀도 관리로만 커버.
- **캘리브레이션**: 문말 600 자 윈도우, 적중마다 인간 재검토 기준으로——치마오 장 중간 20000 장 적중 0.005%, 헤이옌 전체 3999 편 적중 0.550%(모두 위 금지 형태). 동일 배치 기존 `trailer-ending` 적중률은 각각 1.345% / 6.602%.
- **세纲 템플릿「결말」질문 형태 개편 (#255)**: story-architect 세纲 템플릿·story-long-write/story-import 세纲 필드·`rules/story-outline.md` 필수 항목 설명——일괄「마지막에 누구의 어떤 동작·장면·대사에 걸치는지」로 개편. 실제 인간 코퍼스 측정 기준: 장편 장미 대화 마무리 약 29%·동작/장면 약 26%·의문/줄임표 정지 약 6%, 명시 상태 요약은 약 1% 에 불과·장미 마지막 단락 글자 수 중간값 23 자——진짜 장은 대개 구체적 동작에 멈춤.
- **세션 시작 두 군데 알림 수정 (#173)**: ① 작품분석库/ 미완료 작품 분석 알림: `_progress.md`「최종 상태」값으로 필터링, `completed` / `completed_with_errors` 는 집계 제외. 판정 로직은 `lib/common.sh` `analysis_incomplete()` / `discover_incomplete_analyses()` 에 수용, `session-start.sh` 와 `detect-story-gaps.sh` 공유. 콜론 뒤 상태 자체만 인정, 괄호 주석 기입은 미완료로 처리——적게 보고하는 것보다 많게 보고하는 쪽. ② 수동 버전 업데이트 알림 24 h 알림 자체 스로틀링: 이전 구현은 네트워크 요청만 스로틀링해 같은 버전이라도 세션마다 매번 알림 + curl 실패 시 매번 5 초 허공 대기. 이제 실패 시에도 타임스탬프 네거티브 캐시 기록.
- 이미 배포된 프로젝트는 `/story-setup` 재실행 + **새 세션 열기** 필수 (그렇지 않으면 구 세션은 v20 배포 사용 + agent 템플릿 변경은 세션 시작에만 등록).

### v20

- `.story-deployed` 의 `agents_version` 을 `20` 로 업그레이드 (`setup_skill_version` 그대로 `1.2.7`).
- **narrative-writer Gate D 문장 길이 기준 개편**:「리듬 파쇄」→「리듬 조정」. 비대한 수식·누적 비유·정보 과잉 장문만 분절하고, 개편 후 서술문은 쉼표 장문을 주로 사용——`agent-references/anti-ai-writing.md` 규칙 3「문장 길이 기준」: 쉼표 사이 8-12 자·전체 문장 20-30 자·5 자 이하 조각 연속 금지.「모바일 독서 밀도」는 단락을 나누는 것이지 문장 내부를 자르는 게 아님을 명시.
- **anti-ai-writing.md 규칙 3 재작성**:「문장 길이 기준 (짧은 문장은 도구이지 기본값 아님)」+ 실제 베스트셀러 코퍼스 캘리브레이션 주석 (장편 내레이션 쉼표 사이 평균 8.8-9.6 자·전체 문장 평균 22-24 자·쉼표 장문 비율 74-80%). 본 파일 문장 길이는 규칙 3 에 따름을 명시.
- **banned-words.md 4 단어 강등**: 슬슬/살짝/살며시/담담히 를 1 급 → 2 급 밀도 제어 (천자 당 합계 ≤ 3).
- **유도 조항 일괄 제거 동기화**: quality-checklist / writing-craft / format-and-structure / genre-writing-formulas 에서「길면 자르기」「전량 감정 외현」류 유도 문안 제거.
- **narrative-writer 외현 처방 상한 설정**:「심리 외현 / Gate C 심리 묘사 외현 / 감정어 기본 외현」을 절대주의 → 한 번에 적절히 처리·비철칙·필요한 내심 직접 기입·소매 훔치기/바지 움켜쥐기 류 기능 없는 작은 동작 쌓지 말 것 으로 개편.
- **emotional-arc-design 문장 길이 규칙 개편**:「짧은 문장 = 결단력 열혈」→「문장 길이는 감정과 리듬 따라감」.
- **writing-craft 시작 이벤트 밀도 예시 교체**: 고밀도 예시를 전보체 짧은 문장 → 쉼표 흐름 장문 으로 교체, 밀도 = 한 단락 안 몇 가지 일이 있느냐지 문장마다 끊는 게 아님 을 명시.
- 이미 배포된 프로젝트는 `/story-setup` 재실행 + **새 세션 열기** 필수.

### v19

- `.story-deployed` 의 `agents_version` 을 `19` 로 업그레이드 (`setup_skill_version` 그대로 `1.2.7`).
- **개념「플롯 유닛」통일**: 플롯 바 / 루프 카드 / 정식 플롯 루프 / 플롯 단편 → 모두 **플롯 유닛** (권纲 안에서는 **플롯 유닛 카드**). 필드 순환ID/순환비트/순환감정엔진/순환약속 → **유닛ID/유닛비트/유닛감정엔진/유닛약속**.「순환」은 리듬 의미(쾌감 루프·소중대 루프 등)에만 남김. 기존 권纲 구 용어는 필드 구조로 폴백 읽기, 개요 보충/수정 시 신 용어로 업그레이드.
- **작품 분석 플롯 유닛 ↔ 권纲/세纲 연계**: 권纲 플롯 유닛 카드에 생략 가능「벤치마크 플롯 참조」필드 신규.「벤치마크 리듬 이행」은 플롯 유닛을 구간 단위로(유형/클리셰 태그로 동류 묶음). 세纲 분할 경계「한 묶음 = 한 플롯 유닛」개편. 플롯 묶음 리콜 1 회 → 결론 플롯 유닛 카드 고정. story-long-write 장면표에「개요 보충/확장」진입점과 권纲 잠금 정의 신규. 작품 분석 측 `플롯/README.md` 에「플롯 유닛 목록」인덱스 신규 (기존 책은「플롯 유닛 목록 보충」으로 기계적 보충 가능). 구판 권纲/세纲/작품분석库 필드 누락은 일절 차단 없이 구 프로세스 폴백.
- **권纲 규칙 ↔ 신 추진 모델 동기화**: `story-outline.md` 권纲 필수 항목을「권 계약 / 종국 비축 / 플롯 유닛 카드 schema」로 교체.「매 N장 마다 큰 쾌감 포인트」고정 주기 폐기. 세纲 부족항 처리 구판 허용 복원 (신규/보충/수정 시에만 현재 청사진 완비 요구).
- **story-architect 템플릿 정렬**: 세纲 최소 구조에 유닛ID/위치·주인공 목표/핵심 선택 보충.「대가 실현/수익 실현」→「행동 비용(없을 수 있음)/수익 귀속」이름 변경. Phase 2 spawn 에도 계약 요약 동봉 필수 (세纲 계층 필드 1 개 신규).
- **심사 라인 ↔ 신 추진 모델 정렬**: `agent-references/quality-checklist.md` 에 7 가지 상태 분류·서스펜스/쾌감 포인트 간격 장 위치별 면제 동기화.「독자 계약과 종국 비축 양방향 심사」절 신규 추가.
- **hooks 견고성**: session-start 배포 자가 검사에 `story_hook_cli.js` / `story_hook_core.js` 포함. node 누락 시 1 회성 [WARN] 으로 본문 폴백 망/commit 알림/연속성 검사 중지 통지 (개요 차단은 순수 bash 폴백 존속). staged 커밋 스캔 4 구현(JS 코어 / Codex Python / Claude bash / OpenCode pre-commit) 의미론과 문안 통일, parity 테스트 Part E 신규 (staged warnings 와 개요 차단의 py↔js 글자 단위 락).
- **去AI味 게이트 기계화 (무상태)**: 작성 후 본문 망에 확정성 독 문장 검출 신규 (「아니라 B다」전체 패밀리 / 성선 반전 / 부정 열거 / 예고 결말). 본문 디스크 기록 즉시 자동 스캔 + 적중 푸시백. 다음 장 작성 전「독 문장 미결산 게이트」신규——이전 장 미처리 blocking 적중 + `<!-- 去味:건너뜀 -->` 면제 표시 없을 때 차단 (판정은 파일 자체에서 실시간 계산, 상태 파일 불필요; node 누락/파싱 실패 시 일괄 통과). 면제 표시 콜론 전각 반각 모두 인정 + 작성 후 망 해당 장 독 문장 푸시백 건너뜀 (나머지 망은 평소대로). `check-ai-patterns.js` 에 voice-contrast / negation-parade / reverse-not-is / trailer-ending (blocking, 실제 인간 코퍼스 0 오보 캘리브레이션) 과 quote-emphasis-tic (advisory) 동기화 신규. SKILL 측 최악 독 문장 빠른 참고를 작성 단계에 인라인 +「작성 후 동일 라운드 0 클리어」요구 신규. OpenClaw/generic 무훅 플랫폼은 AGENTS 템플릿 자체 잠금 조항으로 폴백.
- 이미 배포된 프로젝트는 `/story-setup` 재실행 + **새 세션 열기** 필수.

### v18

- `.story-deployed` 의 `agents_version` 을 `18` 로 업그레이드 (`setup_skill_version` 그대로 `1.2.7`).
- **Skill 계약 검진 (#242)**: `check-current-skill-contracts.py` 신규 추가. 버전 앵커·주요 산출물 경로·세纲 필수 입력·「조용한 다운그레이드」금지를 CI 계약으로 고정. `agents_version` 이 런타임 만료 판정 유일 권위.
- **벤치마크 주요 산출물 누락 fail-fast 전환**: `플롯/감정모듈.md` / `플롯/리듬.md` 누락 → 일괄 중단 + `missing_primary_contract` 설정 + `/story-long-analyze` Stage 3+ 또는 `/story-import` 재실행 안내. 더 이상 `작품분석리포트.md` / 장 요약 / 스토리라인으로 조용히 폴백 안함.
- **구판 개요 허용 유지**: 구판 권纲 권 계약/플롯 유닛 카드 부족·구판 세纲 장 청사진 필드 부족 → 여전히 일일 연재 차단 안함. 이번 라운드 메모리 추론 + 미지 항목 `[보충 예정]` 기입. 명확히 개요 보충/수정 시에만 역기록. 신규/보충/수정 시 현재 장 청사진 완비 필수.
- session-start / story-outline 규칙 + agent 템플릿 동시 갱신.
- 이미 배포된 프로젝트는 `/story-setup` 재실행 + **새 세션 열기** 필수.

### setup 1.2.7 (ZCode, agents v17)

- `target_cli=zcode` 신규: `.zcode/skills/`·`.zcode/commands/`·`.zcode/hooks/story_zcode_hook.js` 배포 + `.zcode/config.json` 과 루트 `AGENTS.md` 안전 병합.
- ZCode 3.3.4 는 프로젝트/plugin custom agents 를 실행하지 않음 → `.zcode/agents/` / `.zcode/rules/` 생성 안함, 전문 역할은 안정적으로 solo/direct 다운그레이드.
- ZCode Hook 은 PATH 의 `node` 의존. 지원 이벤트 SessionStart / PreToolUse / PostToolUse 만 사용 (PreCompact / SessionEnd 등가 기능 없음).
- 기존 ZCode 프로젝트는 업그레이드 후 `$story-setup` 재실행 + ZCode 새 세션 열기 필수.
- Claude/OpenCode/Codex agents bundle 은 v17 그대로 → 본 항목 단독으로 `agents_version` 올릴 필요 없음.

### v17

- `setup_skill_version` `1.2.6` · `.story-deployed` `agents_version` `17` 업그레이드.
- **소재 본문 프롬프트카드 검색 (#226)**: narrative-writer 3 단말 템플릿에「소재 본문 프롬프트카드」연동. 먼저 인덱스 읽은 후 `genre-prose-cards/{소재}.md` 오직 단일 카드만 읽기. 카드는 내부 소재 풍미 보정 목적만. anti-leak 강제 제약 → 카드명/소재 태그/신뢰도/컴플라이언스 자가 평가 일체 본문 기록 불가 보장. 문풀 핑거프린트와 Gate G 해석조 제거 규칙을 소재별 세분화.
- **개요 경계 + 장별 작성 공식 (#225/#226)**: narrative-writer 템플릿은 세纲 계획 내 플롯 포인트만 확장 작성. 부족 시 `outline_underfilled` 미달 보고서 → 메인 세션 개요 보충. chapter-extractor 템플릿에 `chapter_formula` 장별 작성 공식 산출물 신규 (감정 흐름/리듬 배분/구조 공식/장미 훅).
- **범용 Web AI 배포 (#216)**: story-setup 에 `target_cli=generic` 파일 모드 신규. `skills/` 복제 + 범용 `AGENTS.md` 만 배포 (플랫폼 네이티브 hooks/custom agents 기능 선언 안함). story-long-write 에 범용 환경 solo/direct 폴백 보강.
- 이미 배포된 프로젝트는 `/story-setup` 재실행 + **새 세션 열기** 필수.

### v16

- `setup_skill_version` `1.2.5` · `.story-deployed` `agents_version` `16` 업그레이드.
- **단편 작성 참고 스택 정리 (#206)**: story-short-write 가 장편 범용 참고 상속 안함. 대신 `short-format.md`·`short-craft.md`·`short-deslop.md` + `genre-styles/` 소재 패키지가 단편 형식·감정 직달·리듬 밀도·去AI味 규칙 담당.
- **narrative-writer 단편 예외 동기화 (#206)**: 3 단말 agent 템플릿「단편 소재 패키지 예외」동시 반영. 단편에서 감정 직달 필요 시「감정어 + 체감/동작 결합」허용·공허한 AI 감정 요약만 제거·더 이상 단편 쾌감 작성법을 잘못하여 순수 동작 외현으로만 고치지 않음.
- 이미 배포된 프로젝트는 `/story-setup` 재실행 + **새 세션 열기** 필수.

### v15

- `setup_skill_version` `1.2.4` · `.story-deployed` `agents_version` `15` 업그레이드.
- **본문 폴백 + 배치 간 연속성 확정성 네트워크 (#195)**: deployed hook `check-prose-after-write.sh` 신규 (PostToolUse Write/Edit 디스크 기록 후 강제 신호 폴백——잘림·거절 어조/AI 자기 지칭·엔지니어링 단어 누출·행 반복·글자 수 미달 검사). session-start 배포 자가 검사 hook 보충 + `detect-story-gaps.sh` ↔ Codex `story_codex_hook.py` 배치 간 연속성 폴백 동기화.
- **모델 퇴화 / 짧은 마침표 과잉 검사 작성 체인 연동 (#193/#192)**: `check-degeneration.js` (반복/잘림/엔지니어링 단어 누출) + 업그레이드 `check-ai-patterns.js` (짧은 마침표/장문단/대시 기능별 개편) 를 작성 skill 과 함께 배포. 본문 마무리 재스캔, 각 finding 마다 `severity: blocking|advisory` 부착.
- **Codex / OpenClaw 호환 (#186/#189)**: `$story-setup` 가 `.codex/agents/*.toml` + `.codex/hooks.json` 배포. OpenClaw skills-only 호환 보충. Codex `.agents/skills` 심볼릭 링크 가드.
- 이미 배포된 프로젝트는 `/story-setup` 재실행 + **새 세션 열기** 필수.

### v14

- `setup_skill_version` `1.2.3` · `.story-deployed` `agents_version` `14` 업그레이드.
- **AI 문장 강제 임계 (issue #166)**: narrative-writer·작성 skill·review/deslop 전체에「먼저 부정 후 긍정」반전 문장 강제 금지. 문풀 리콜·벤치마크 모방·Gate B 소프트 규칙으로도 이 금지 무시 불가.
- **로컬 본문 검사**: story-deslop·story-long-write·story-short-write·story-review 모두 로컬 `check-ai-patterns.js` 동반. 파일 모드는 사전/납품 전 본문에 `node scripts/check-ai-patterns.js --check --fail-on=blocking <본문 파일...>` 실행. blocking 적중 → 본문 재작성 + 0 될 때까지 재스캔. advisory 는 읽기 느낌 리스크만 통보·컨텍스트 따라 처리. 기능적 작성은 유지 또는 `[재검토 필요]` 표기.
- **narrative-writer 납품 경계**: agent 자체에 Bash/Node 도구 없을 경우 규칙에 따라 자가 검사 완료했다고만 보고 가능하며, 스크립트를 실행했다고 주장 금지. 메인 세션/호출측에 실행 능력이 있을 경우 실제 디스크 기록 파일에 대해 반드시 재스캔 해야함.
- **글자 수 통계 수정 (issue #170)**: Gate E 에「구체적 글자 수 표현 검증」추가. 본문에 스크립트 검증 거치지 않은「이 다섯 글자」식 글자 수 단언 금지·비숫자 표현으로 교체.
- **대화 기계화/논문조/장소 불문 개선 (issue #171)**: 참고 표에 `dialogue-mastery` 연동·심사 목록에 대화 품질 항목별 추가·「작성 후 대화 자가 검사」마무리 단계 신규. 작성 전 의도 확인에「대화 성선 기준선」(고압 beat → 코믹 성선 양보·정보형 조연은 과학 잡담 입 금지·상대 감정 문장별 응답) 추가·consistency-checker/character-designer 심사측 동시 반영.
- **연속 작성 문풀 표류 장별 자가 검사 (issue #168)**:「작성 후 문풀 자가 검사」신규. 목표 문장 길이 프로필은 메인 세션 `style_profile`·`설정/문풍.md`·벤치마크 `문풍.md` 에서 가져옴. 현재 연속 상태 카드는 문풀 필드 저장 안함.
- **신규 명사/설정 첫 등장 독자 앵커 (issue #175)**: Gate G 자가 검사 후「해석조 삭제 ≠ 독자를 이해 못하게 만듦」역방향 보완. 신규 명사 첫 등장은 동작/대화 반 구절/장면 결과로 한 번에 현재 역할 드러냄.
- **수동 버전 업데이트 검사 (issue #173)**: `session-start.sh` 에 수동 업데이트 알림 신규 (24 h 최대 1 회·curl 5 s 타임아웃·전 과정 사일런트 폴백·`STORY_NO_UPDATE_CHECK=1` 끄기 가능·뒤쳐질 때만 알림).
- 이미 배포된 프로젝트는 `/story-setup` 재실행 + **새 세션 열기** 필수.

### v13

- `setup_skill_version` `1.2.2` · `.story-deployed` `agents_version` `13` 업그레이드.
- **세纲 → 장 청사진 업그레이드 (issues #162)**: 장편 `개요/세纲_제XXX장.md` 신규/보충 시 구 필드(핵심 사건·목표 감정·장首/장尾 훅·쾌감 포인트·글자 수 목표) 유지 + 내용 요약(발단/전개/전환/클라이맥스/결말)·플롯 편성(주선/보조선/사건선/감정선/논리선)·인물 관계와 등장 순서·플롯 세분화·결말 설정과 훅 을 신규 추가. 구판 세纲은 여전히 연속 작성 가능·필드 부족 시 차단 안함·미지 항목은 `[보충 예정]` 기입.
- **어조 문장 부호 계보 (issue #161)**: writer references·narrative-writer·review/deslop 전체에「문장 부호는 어조/인물 성선 따라간다」규칙 추가. 전체 마침표화 방지 + 무작위 물음표/느낌표 나열 금지. 망설임/미완/가로막기/늘여짐 → 동작 정지·짧은 문장·줄 바꿈 처리. 본문 산출물에 `……`·`——` 사용 안함. 즈후 옌옌 `「」` 인용 스타일은 계속 유효.
- story-architect 가 신판 장 청사진 산출 · consistency-checker 가 세纲 논리선/인물 관계 변화/등장 순서/대가 수익 실현 소비 · narrative-writer 가 어조 문장 부호 계보에 따라 본문 부호 리듬 실행.
- 이미 배포된 프로젝트는 `/story-setup` 재실행 + **새 세션 열기** 필수.

### v12

- `setup_skill_version` `1.2.1` · `.story-deployed` `agents_version` `12` 업그레이드.
- **작품 분석 → 작성 모듈 체인 구축 (issue #149)**: `story-long-analyze` Stage 2 요약에「핵심 정보와 확장 작성 기법」표 신규 추가. Stage 3 권위 산출물로 `플롯/리듬.md` (핵심 정보 추진/감정 촉발 포인트/폭발 리듬) + `플롯/감정모듈.md` (독자 요구·감정 엔진/재현 가능 모듈) 생성. `story-import` 가 `대상/벤치마크/{책이름}/플롯/` 로 동기화. `story-long-write` 일일 연재에서 권위 우선순위에 따라 읽고 재현.
- **agent 템플릿 개편**: chapter-extractor 에「핵심 정보와 확장 작성 기법」추출 추가. story-explorer `benchmark_style_load` 반환 필드에 `selected_emotion_module`·`rhythm_reference` 등 추가. **이미 배포된 프로젝트는 `/story-setup` 재실행해야 신 agent 동작을 얻음**——그렇지 않아도 기능 유실은 없고 단지 agent 단축 경로만 잃음 (메인 세션 수동 로드 폴백).
- **consistency-checker 확장**: 순수 grep-first 문자 모순 →「grep-first + 추론형 일치성 심사」. 규칙 경계 패러독스·설정 계층 충돌·장 간 인과 체인·규칙 남용 가능성·대가 일치성 보충 검사.
- **자연 분절 + 주어 리듬**: `format-and-structure.md`·`writing-craft.md` 에서 60/45 글자 수 강제 분절 규칙 폐지 → 극적 단위/샷/한 가지 일 마침에 따라 문단 끊기. 완전 추론 체인·분위기 진술·감정 변화는 다소 긴 단락 유지 가능.
- **주어 과밀 수정**: narrative-writer 템플릿·story-review 검사 항목에「단 첫 주어 설정·단 중 대명사/생략·핵심 전환 시 재명시」리듬 규칙 신규 추가. 전 장 이름 횟수로 일률적 재단 안함.
- 이미 배포된 프로젝트는 `/story-setup` 재실행 + **새 세션 열기** 필수.

### v11

- `setup_skill_version` `1.2.0` · `.story-deployed` `agents_version` `11` 업그레이드.
- **본문 작성 전 절차 가드 hook 신규 추가**: `guard-outline-before-prose.sh` (PreToolUse Write/Edit/MultiEdit). 장편 `본문/제N장_*.md` 첫 생성 시 `개요/세纲_제N장.md` 누락·단편 `본문.md` 첫 생성 시 `소절개요.md` 누락 → 바로 차단 (exit 2). 강제로 먼저 개요 세운 후 본문 작성. 본문 이미 존재 (연속/去AI味/교정) 또는 비본문 파일 → 일괄 통과.
- **배포 후 반드시 새 세션 열기**: custom agents 는 세션 시작 시에만 `subagent_type` 으로 등록. `/story-setup` 배포 완료 시 일회성 마커 `.claude/.agents-pending-restart` 남김 → `session-start.sh` 다음 세션에서 agents 등록 확인하고 마커 삭제. **배포 현재 세션 내 spawn agent 는 여전히 solo 로 다운그레이드되므로 반드시 Claude Code 새 세션을 열어야 함**.
- **작성 규칙「장단 교차 + 조밀 분배」보충**: `format-and-structure.md` 단락 리듬에 고정 글자 수 상한 일괄 적용 폐지 → 극적 단위·감정 beat·조밀 분배에 따라 자연스럽게 문단 끊기. `writing-craft.md` 에「조밀 분배 (상세·생략 불균형)」신규. `anti-ai-writing.md` 장단 문장 교차를 실행 가능한 자연 리듬 목표로 개편. narrative-writer 템플릿에 Gate D 장단 변화와「문장 다양성」심사 보충. story-review 단락 gate 는 구 글자 수 상한 → 장단/조밀 변화 체크로 개편. (대응: 생성 콘텐츠 문학적 과잉·단조 문장·평탄 리듬 피드백).
- 이미 배포된 프로젝트는 `/story-setup` 재실행 + **새 세션 열기** 필수.

### v10

이미 배포된 프로젝트는 `/story-setup` 재실행하여 작성 Agent 를 갱신하세요. 주요 영향: 일일 연속 작성이 더 안정적으로 벤치마크 문풀을 계승.

### v9

- `setup_skill_version` `1.1.0` · `.story-deployed` `agents_version` `9` 업그레이드.
- **배포 계약 기계적 검사 목록 보충**: hooks·rules·agents·Agent References·settings hooks·`CLAUDE.md` 병합·`.story-deployed` 필드 → 모두 `source`·`target`·`owner`·`merge mode`·`validation` 명확히 명시 필수.
- **Hook 배포 방식 개편**:「단지 `.sh` 파일 복제」→ `references/templates/hooks/` 전체 디렉터리 트리 재귀 복제. `lib/common.sh` 누락 방지. `lib/sentinel.sh` 신규 추가로 `.story-deployed` 필드 일괄 읽기.
- **Hook runtime root-aware**: `CLAUDE_PROJECT_DIR` 우선 → 그 다음 git root → 마지막 cwd. `discover_active_book` 와 `discover_all_books` 분리 → 단일 책 세션 논리와 전 프로젝트 검사의 상호 오염 방지.
- `detect-story-gaps.sh` bash 3.2 호환 배열·중복 제거 논리 사용 + 공통 라이브러리에서 모든 책 목록 가져옴.
- `session-end.sh` 기본적으로 `session-log.txt` 기록 안함. 명시 `STORY_SESSION_LOG=1` 일 때도 존재하는 장편 `추적/` 에만 기록 (단편 위해 `추적/` 생성 안함).
- `validate-story-commit.sh` 스크립트 내 자가 검사 보충: `CLAUDE_TOOL_INPUT.command` / `STORY_COMMIT_COMMAND` 파싱 후 실제 `git commit` 에만 적용 → `echo git commit docs` 같은 비커맨드가 잘못 트리거되는 것 방지.
- **Agent Reference 번들 보충 + 정규화**:
  - `genre-readers.md` : `story-long-write/references/genre-readers.md` → story-setup 정식 사본.
  - `genre-writing-formulas.md` : `story-long-write/references/genre-writing-formulas.md` → story-setup 정식 사본.
  - `emotional-methods.md` : `story-long-write/references/emotional-methods.md` → story-setup 정식 사본.
  - `style-combat-face.md` : `story-long-write/references/style-combat-face.md` → story-setup 정식 사본.
  - `output-templates.md` : 복제 안함 (chapter-extractor 에 이미 출력 형식 내장. 이전의 단순 참조는「본 파일 출력 형식 준수」로 개편).
- `story-format.md` 에서「장 간 `---` 구분」구 규칙 삭제 → 대신 본문 조각에 수평 구분선 사용 금지 (narrative-writer 와 일치).

### v8

- **story-review / 배포 후 reviewer Agent 참고 파일 경로 오류 수정**: 프로젝트 루트에서 읽을 때 단순 파일명만 찾아 skill references 를 못 찾던 문제 해결.
- Agent 템플릿에 참고 파일 경로 규칙 신규 추가: 우선 `.claude/skills/` 또는 `skills/` 에서 `story-setup/references/agent-references/*.md` 정식 경로를 조합·해석 → 현재 작업 디렉터리 의존 피하기 + skill 간 references 교차 참조 안함.
- 이미 배포된 프로젝트는 `/story-setup` 재실행 필수 (`.claude/agents/` 덮어쓰고 신규 참고 경로 규칙 획득).

### v7

- **장편 `/story-long-write 일일 연재` 대량 연속 작성 continuation 규칙 수정**: 같은 배치 내「계속/연속/일일 연재」는 daily workflow 유지 → 바로 본문 연속 작성으로 점프 안함.
- **`detect-story-gaps.sh` 복선 헤더·정상 개방 복선 (`未埋`/`已埋`) 오탐 수정**: SessionStart 는 `已过期` 또는 이상 상태만 알림.
- 이미 배포된 프로젝트는 `/story-setup` 재실행 필수 (`.claude/hooks/`·`.claude/agents/`·`.claude/rules/` 덮어쓰고 신규 hook 동작 획득).

### v6

- narrative-writer 서브에이전트 ↔ 메인 세션 간 단편 본문 형식 통일: `본문.md` 고정 기록·소절 마커 통일·단락 간 빈 줄 없음·대화 반각 큰따옴표.
- 단편 작성 시 narrative-writer 가 장편 `추적/컨텍스트.md` 를 생성하지 않도록 수정.

### v5

- narrative-writer 장면 작성법 개편:「삼차원 녹여넣기」적용 + 화면 단위 분절로 단락 밀도 제어.
- 글자 수 통계 방식 개선: Python 문자 통계 우선, `wc -m` 은 macOS/Linux 대안으로만 → Windows + DeepSeek/Claude Code 호환성 향상.
- 이미 배포된 프로젝트는 `/story-setup` 재실행 후 신판 agent 정의 획득.

### v4

chapter-extractor 장 추출 Agent 신규 추가. 총 7 개 Agent (story-architect, character-designer, narrative-writer, consistency-checker, story-researcher, story-explorer, chapter-extractor).

### v3

story-explorer 읽기 전용 조회 Agent 신규 추가 (캐릭터/복선/설정/진행 조회·일일 연재 컨텍스트 빠른 로딩). 총 6 개 Agent. story-long-write·story-review·story 라우팅에서 통합 호출.

### v2

4 개 창작형 Agent + 1 개 연구형 Agent (story-architect, character-designer, narrative-writer, consistency-checker, story-researcher). Agent 가 skill references 작성 이론을 인용. Hook 스크립트 최적화 (context 출력 감소). 4 가지 path-scoped 규칙.
