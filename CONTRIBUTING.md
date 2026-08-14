# 기여 가이드

웹소설 작성 skill 패키지에 관심을 가져주셔서 감사합니다. 기여를 환영합니다.

## 저장소 구조

```
skills/
├── story/                   # 툴박스 라우팅
├── story-setup/             # 환경 배포
├── story-import/            # 역방향 가져오기
├── story-long-write/        # 장편 작성
├── story-long-analyze/      # 장편 작품 분석
├── story-long-scan/         # 장편 순위 스캔
├── story-short-write/       # 단편 작성
├── story-short-analyze/     # 단편 작품 분석
├── story-short-scan/        # 단편 순위 스캔
├── story-deslop/            # AI 냄새 제거
├── story-review/            # 다각도 심사
├── story-cover/             # 표지 생성
└── browser-cdp/             # 브라우저 조작
scripts/                       # 개발 가드 / 테스트 / 코드 생성（전체 인덱스는 scripts/README.md 참고）
```

각 skill은 `SKILL.md`(진입점)와 `references/` 디렉터리(지식 베이스)로 구성됩니다.

## Skill 형식

`SKILL.md` 시작부에 반드시 frontmatter가 있어야 합니다:

```yaml
---
name: skill-name
description: "한 줄 설명. 트리거 방식：/skill-name、트리거1、트리거2"
metadata: {"openclaw":{"source":"https://github.com/worldwonderer/oh-story-claudecode"}}
---
```

OpenClaw 호환을 위해 frontmatter는 반드시 한 줄 키-값을 유지해야 합니다: `description`은 `|`/`>` 블록을 사용하지 않으며, `metadata`는 반드시 한 줄 JSON 객체여야 합니다. 더 긴 트리거 설명은 본문에 기재하세요.

`references/` 내 파일은 skill이 필요에 따라 로드하며, 전부 컨텍스트에 넣지 않습니다.

## 기여 방법

### 기존 skill 개선

1. 저장소 Fork
2. `main`에서 브랜치 생성: `git checkout -b feat/your-feature main`
3. 해당 `SKILL.md` 또는 `references/` 파일 수정
4. PR 제출, 무엇을 왜 고쳤는지 설명

### 새 skill 추가

1. `skills/` 하위에 디렉터리를 생성하고 `SKILL.md`와 `references/`를 포함
2. 저장소 루트에서 `npx skills validate` 실행 시 오류가 없는지 확인
3. PR 제출

## CI 검사

PR은 자동으로 `.github/workflows/cross-platform.yml`을 실행합니다. static-check job은 다음 검사를 실행합니다(전부 강제):

- `scripts/static-check.sh` — frontmatter 구조화 파싱, 정확한 Markdown 경로/앵커, Agent 참조와 references 도달 가능성; 기본 컴포넌트 `browser-cdp` 외에는 Skill 간 파일 참조 금지
- `python3 scripts/skill-numbering.py check` — 워크플로우 번호 연속성, 참조 바인딩 가능성 및 소수 레이블 가드
- `scripts/check-current-skill-contracts.sh` — `scripts/current-contract.json`에 따라 현재 버전 / Phase / schema / 주요 산출물 / 세부 개요 계약을 검증하고, 기존 경로와 암묵적 호환 분기를 차단
- `python3 scripts/test-current-skill-contracts.py` — current-contract manifest와 주요 산출물 fail-fast 의미 회귀
- `scripts/check-hook-regex-sync.sh` — hook 복선 상태 검출 동작
- `scripts/check-shared-files.sh` — 공유 runtime 자산 목록 + Skill 간 reference 사본 일관성
- `scripts/check-story-setup-deployment.sh` — story-setup 배포 무결성
- `scripts/check-claude-adapter.sh` — Claude marketplace와 skill 매핑 검사
- `scripts/check-opencode-adapter.sh` — OpenCode adapter 동기화, commands/agents/config 구조와 plugin 실제 동작 검사
- `scripts/check-openclaw-skills.sh` — OpenClaw 한 줄 frontmatter, `metadata.openclaw`와 선택 사항 실제 CLI 발견 검사
- `scripts/check-codex-adapter.sh` — Codex repo skills symlink, custom-agent TOML, hook 생성 확정성과 launcher 계약
- `scripts/test-codex-hooks.sh` — Codex hooks 합성 이벤트 테스트
- `scripts/check-zcode-adapter.sh` — ZCode plugin/marketplace, 13 Skills/Commands, 지원 Hook 이벤트와 배포 앵커 검사
- `scripts/test-zcode-hooks.sh` — ZCode 엄격 JSON Hook 계약, 본문 가드, 연속성과 플랫폼 간 Node runner 테스트
- 수집 스크립트 `node --check` 문법 검증

위는 대표적인 열거이며 **강제 목록은 `.github/workflows/cross-platform.yml` 기준**입니다. 각 스크립트의 용도와 트리거 시기는 [scripts/README.md](scripts/README.md) 참고. 별도로 `.github/workflows/cli-compat.yml`은 관련 PR, 매주 정기 및 수동 트리거 시 공식 현재 버전을 설치하고 Claude Code、Codex、OpenCode、OpenClaw의 권한 검증 없이 smoke를 실제로 실행합니다.

별도로 windows / macos job은 cdp-utils 로딩과 setup 스크립트 dry-run을 검증합니다.

제출 전 Linux CI의 강제 목록을 로컬에서 한 번 실행하는 것을 권장합니다:

```bash
bash scripts/static-check.sh
python3 scripts/test-static-check.py
python3 scripts/skill-numbering.py check
bash scripts/test-skill-numbering.sh
bash scripts/check-current-skill-contracts.sh
python3 scripts/test-current-skill-contracts.py
bash scripts/check-hook-regex-sync.sh
bash scripts/check-shared-files.sh
python3 scripts/test-shared-assets.py
node scripts/test-normalize-punctuation.js
node scripts/test-scan-runtime.js
bash scripts/test-ai-patterns.sh
bash scripts/test-degeneration.sh
bash scripts/test-prose-backstop-hook.sh
bash scripts/test-prose-net-parity.sh
bash scripts/test-story-continuity.sh
bash scripts/check-story-setup-deployment.sh
bash scripts/check-claude-adapter.sh
bash scripts/check-codex-adapter.sh
bash scripts/check-opencode-adapter.sh
bash scripts/check-openclaw-skills.sh
bash scripts/test-codex-hooks.sh
bash scripts/check-python-invocation.sh
bash scripts/check-hook-locale-safety.sh
bash scripts/test-hook-encoding-portable.sh
bash scripts/test-charcount-portable.sh
bash scripts/test-charcount-portable.sh --stub

# 선택 사항 실제 CLI smoke（각각 해당 CLI 설치 필요）
CLAUDE_REAL_CHECK=1 bash scripts/check-claude-adapter.sh
bash scripts/test-codex-cli-e2e.sh
bash scripts/test-opencode-cli-e2e.sh
OPENCLAW_REAL_CHECK=1 bash scripts/check-openclaw-skills.sh
```

## 워크플로우 번호 규범

새로 추가하거나 프로세스 단계를 조정할 때, 명시적 제목은 `Step 1`、`Step 2` 같은 연속 정수를 사용하세요; 단계를 삽입하기 위해 `Step 1.5` / `Phase 2.1` / `Stage 0.5`를 만들지 마세요. 또한 `SKILL.md`에서 `### 2.1` 또는 `- 2.1`로 명확한 워크플로우 제목을 대체하지 마세요. `references/` 매뉴얼 자체의 `3.1` 장/리스트 번호는 이 규칙의 영향을 받지 않습니다.

번호를 수정하기 전 미리 보고, 다시 쓰고 재검토하세요:

```bash
python3 scripts/skill-numbering.py audit
python3 scripts/skill-numbering.py fix --dry-run
python3 scripts/skill-numbering.py fix --write
python3 scripts/skill-numbering.py check
```

자동 수정은 명시적 Step 제목과 모호하지 않게 바인딩 가능한 참조만 재배열합니다. 바인딩할 수 없는 fractional Step 참조 또는 일대다 매핑은 전체 쓰기가 디스크에 저장되기 전 실패합니다; Phase、순수 번호 제목과 bullet 하위 단계는 의미에 따라 수동으로 명명해야 합니다. 전체 알고리즘과 국소 경로 용법은 [scripts/README.md](scripts/README.md#워크플로우-번호-유지) 참고.

agent/skill/plugin/hook 프로토콜과 관련된 어설션은 반드시 해당 프로젝트 공식 문서를 대조한 후 실제 CLI 출력으로 재검증하세요; 다른 agent의 유사 필드로부터 추론하지 마세요.

## 공유 파일 규범

일부 파일은 Skill 간 공유됩니다(예: banned-words.md、anti-ai-writing.md). 수정 시 반드시 모든 사본을 동기화하세요.

- runtime 스크립트의 유일 원본/대상 정의는 `scripts/shared-assets.json`에 있습니다; 먼저 `source`를 고친 후 `python3 scripts/sync-shared-assets.py sync`를 실행하세요.
- 동명 runtime 스크립트는 하나의 canonical group에만 속할 수 있으며, 각 target은 반드시 source basename을 유지해야 합니다; 이름 변경 target으로 단일 owner를 우회하는 것을 금지합니다.
- reference 문서는 여전히 `check-shared-files.sh`가 내용 그룹별로 검증합니다.
- 제출 전 통합하여 `bash scripts/check-shared-files.sh`를 실행하세요; manifest에 등록되지 않은 중복명 runtime 스크립트는 직접 실패합니다.

### 지식 베이스 기여

가장 가치 있는 기여 유형:

- **실전 데이터**: 각 플랫폼 최신 랭킹 분석, 소재 트렌드 변화
- **신규 소재 프레임워크**: 새로운 소재 작성 공식, 구조 템플릿
- **AI 냄새 제거 규칙**: 새로운 AI 흔적 패턴, 개작 예시
- **플랫폼 규칙 업데이트**: 투고 요구사항, 추천 메커니즘 변화

## 품질 요구사항

- **조작성**: 내용은 반드시 AI agent가 직접 실행할 수 있어야 하며, 튜토리얼을 작성하지 마세요
- **간결**: 표와 템플릿을 사용하며, 장황한 서술을 하지 마세요
- **중복 없음**: 다른 skill의 `references/` 사이에 파일을 공유할 수 있지만(경로 참조), 동일 skill 내에서는 중복해서는 안 됩니다
- **한국어**: 모든 내용은 한국어로 작성하세요

## 제출 프로세스

```
fork → branch → commit → PR → review → merge
```

- 하나의 PR은 하나의 수정에 집중
- commit message는 한국어, 형식: `유형: 간결한 설명`
- 유형: `feat`(추가) / `fix`(수정) / `docs`(문서) / `refactor`(리팩토링)

## OpenCode 템플릿 동기화

본 프로젝트는 동시에 Claude Code、OpenCode、Codex、ZCode、OpenClaw 및 Reasonix(Phase 1)를 지원합니다. OpenCode의 agent 템플릿과 프로젝트 명령 템플릿은 `scripts/sync-opencode.py`가 Claude Code 템플릿으로부터 자동 생성합니다.

### 동기화가 필요한 경우

다음 파일을 수정한 후에는 동기화 스크립트를 실행해야 합니다:

- `skills/story-setup/references/templates/agents/*.md`(agent 정의)
- `skills/story-setup/references/templates/CLAUDE.md.tmpl`(프로젝트 명령 템플릿)

### 동기화 절차

```bash
python3 scripts/sync-opencode.py
python3 scripts/sync-opencode.py --check  # 선택 사항: 검증만 하고 파일을 변경하지 않음
bash scripts/check-opencode-adapter.sh
bash scripts/test-opencode-cli-e2e.sh  # 선택 사항: 로컬에 opencode 설치 필요
```

스크립트는 다음을 수행합니다:
1. `templates/agents/` 하위의 Claude Code agent를 opencode 형식으로 변환하여 `opencode/agents/`에 쓰기
2. `CLAUDE.md.tmpl`을 `opencode/AGENTS.md.tmpl`로 복사하고 `.claude/` 경로 참조를 치환
3. 동기화 결과 요약 출력
4. 선택 사항 실제 CLI smoke는 임시 프로젝트에서 13개 slash commands, 7개 agents와 `story-hooks.ts` 플러그인이 OpenCode에 의해 파싱 로딩되는 것을 검증

### CI 탐지

PR에서 Claude Code 템플릿 파일을 수정한 경우, CI는 자동으로 opencode 템플릿이 동기화되었는지 검출하고, 추가로 `opencode.json.patch`、13개 command、7개 agent의 구조 및 `plugin.ts`의 실제 가드/마무리 동작을 검사합니다. CI에서 오류가 나면 로컬에서 동기화 스크립트와 `bash scripts/check-opencode-adapter.sh`를 실행한 후 결과를 제출하세요.

### 수동 유지보수 부분

다음 파일은 자동 생성할 수 없으므로 수동으로 유지보수해야 합니다:

- `skills/story-setup/references/opencode/plugin.ts` — hooks 로직
- `skills/story-setup/references/opencode/commands/` — slash commands
- `skills/story-setup/references/opencode/opencode.json.patch` — 설정 조각

### sync-opencode.py 알려진 한계

동기화 스크립트 실행 후 다음 수동 검사가 필요합니다:

- **경로 해석 섹션**: `fix_path_rules_section()`에 의해 자동 처리되므로 수동 수정 불필요
- **agent 수량**: `opencode/agents/` 하위에 항상 7개 파일인지 확인

### OpenCode 주요 호환성 이슈

**Glob가 숨김 디렉터리를 검색하지 않음**: opencode의 Glob 도구는 `.opencode/` 디렉터리를 검색하지 않으며, 이로 인해 다음 설계 결정이 내려졌습니다:

- **agent-references**를 `skills/story-setup/references/agent-references/`(숨김 아님)에 배포, `.opencode/skills/`가 아님
- **agent 파일** 이중 배포: `.opencode/agents/`(opencode 시스템 사용) + `agents/`(Glob 가시 사본)
- **subagent 검출**: 모든 spawn agent skill(story-review、story-long-write、story-deslop、story-import、story-long-analyze、story-short-write)은 `.claude/agents/` → `.opencode/agents/` → `.codex/agents/` 순서로 검사해야 함; ZCode 3.3.4와 OpenClaw Phase 1은 프로젝트 agents를 배포하지 않으므로 solo/direct fallback으로 진행

**플러그인 출력이 보이지 않음**: opencode 플러그인의 `output.extra.system`은 제거됨(실제 API에 이 필드는 존재하지 않음). 시스템 프롬프트 주입은 대신 `experimental.session.compacting`의 `output.context`로 작성 컨텍스트를 전달합니다.

**session-start 시스템 프롬프트 주입 미지원**: OpenCode 공개 Plugin API에는 `chat.message` 또는 등가 hook이 없으므로, 배포 상태 검출과 작성 진도를 세션 시작 시 모델 컨텍스트에 주입할 수 없습니다. 사용자는 수동으로 `/story-setup`을 실행하여 상태를 확인할 수 있습니다.

**기타 hook 차이**: `detect-gaps`(갭 검출) 플러그인은 이식되지 않았으며, 세션 시작 시 프롬프트를 주입하지 않음(compact 요약과 본문 작성 전의 개요 가드만 보존); `session-end` opencode는 등가 이벤트가 없어 현재 지원하지 않음; `validate-commit`은 대신 git 순정 `pre-commit` hook을 사용(모든 CLI에 적용).

### OpenCode 사용 시 주의사항

- **최초 배포 후 opencode 재시작 필요**: story-setup이 배포한 `.opencode/commands/` 하위의 slash command는 opencode 재시작 후에야 적용됩니다. opencode 종료 후 `opencode -c`를 실행하여 재진입하면 됩니다.
- **최초 배포는 자연어 트리거 사용**: 새 프로젝트에는 slash command가 없으므로, 자연어로 story-setup을 트리거해야 합니다(예: 「story-setup skill을 사용하여 웹소설 작성 환경을 배포해줘」).
- **opencode 설정은 핫 로딩되지 않음**: `opencode.json`、agent 파일 또는 플러그인 수정 후 모두 opencode를 재시작해야 합니다.
- **browser-cdp 장시간 소요 작업이 걸릴 수 있음**: opencode에는 백그라운드 태스크 메커니즘이 없으므로, 장시간 소요되는 브라우저 조작은 사용자가 `ESC`로 중단해야 합니다(SKILL.md에 이미 타임아웃 래핑 가이드가 내장됨).

## OpenClaw 어댑터 유지보수

OpenClaw는 현재 **Phase 1 skills-only** 어댑터를 채택합니다:

- canonical source는 여전히 저장소 루트 `skills/`; OpenClaw를 위해 두 번째 skill을 유지보수하지 마세요.
- 모든 `SKILL.md` frontmatter는 반드시 OpenClaw/AgentSkills 제약을 준수해야 합니다: 한 줄 `name`、한 줄 `description`、한 줄 JSON `metadata`，그리고 `metadata.openclaw`가 존재해야 합니다.
- `metadata.openclaw.requires.bins/env/config/anyBins`는 OpenClaw load-time gating에 사용; 예를 들어 `story-cover`는 `GPT_IMAGE_API_KEY`로 가시성을 제어합니다.
- `story-setup target_cli=openclaw`는 프로젝트 `skills/`와 `references/openclaw/AGENTS.md.tmpl`만 배포하며, OpenClaw agents/hooks/plugin은 배포하지 않습니다.
- OpenClaw는 session 시작 시 eligible skills를 snapshot; 변경 후에는 새 session이 필요하거나 skills watcher가 refresh되기를 기다려야 합니다.

### OpenClaw 검사 절차

```bash
bash scripts/check-openclaw-skills.sh
OPENCLAW_REAL_CHECK=1 bash scripts/check-openclaw-skills.sh  # 로컬에 openclaw 설치 시 선택 사항
```

`OPENCLAW_REAL_CHECK=1`은 임시 profile + 임시 workspace로 격리 agent를 생성하여, OpenClaw CLI가 workspace `skills/`에서 13개 story skill을 발견할 수 있는지 확인합니다; 스크립트 종료 후 임시 profile을 정리합니다.

### OpenClaw 알려진 경계

- **agents 보류**: OpenClaw의 agent/session 모델은 Claude/Codex 프로젝트 내 agent 파일과 다르므로, OpenClaw Gateway agents를 현재 생성하지 않습니다. agent 협업과 관련된 skill은 반드시 solo/direct로 다운그레이드해야 합니다.
- **hooks 보류**: 본문 작성 전 개요 가드、commit 알림、session-start/compact 주입은 OpenClaw hook/plugin으로 마이그레이션되지 않음; OpenClaw 하에서는 skill 프로세스 제약으로만 작용합니다.
- **package 보류**: OpenClaw는 workspace/personal/managed skill roots를 식별할 수 있음; 현 단계에서는 OpenClaw 순정 plugin package를 발행하지 않습니다.

## ZCode 어댑터 유지보수

ZCode는 「순정 plugin + `story-setup` workspace 배포」 이중 진입을 채택합니다:

- `.zcode-plugin/plugin.json`과 루트 `marketplace.json`은 동일한 그룹인 13 Skills、13 Commands와 ZCode Hooks를 노출; 버전은 반드시 `skills/story/VERSION`과 동기화해야 합니다.
- `skills/story-setup/references/zcode/`는 workspace 배포 템플릿으로, `AGENTS.md.tmpl`、Commands、`config.json.patch`와 제3자 의존성 없는 Node Hook runner를 포함합니다.
- ZCode 3.3.4는 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PostToolUseFailure`、`Stop`만 지원합니다. Claude의 `PreCompact`、`PostCompact`、`SessionEnd`、`SubagentStop` 또는 `Notification`을 복사하지 마세요.
- Hook stdout가 비어 있으면 통과; 비어 있지 않은 한 반드시 엄격한 JSON schema를 만족해야 합니다. 진단은 stderr에만 쓰고, 예외는 fail-open; 우선 `process` + `node`를 사용하며, shell/Python launcher의 플랫폼 간 분기를 도입하지 마세요.
- 3.3.4는 프로젝트 레벨 또는 plugin custom agents를 실행하지 않으며, `.zcode/rules`도 발견하지 못합니다. `.zcode/agents/` / `.zcode/rules/`를 생성하거나 기본적으로 사용자 home에 쓰지 마세요; 전문 Agent와 관련된 Skill은 반드시 명확하게 solo/direct fallback을 보고해야 합니다.

### ZCode 검사 절차

```bash
bash scripts/check-zcode-adapter.sh
bash scripts/test-zcode-hooks.sh
bash scripts/test-prose-net-parity.sh
```

본문 경량 확정성 네트워크를 업데이트할 때는 반드시 Claude、OpenCode、Codex、ZCode 네 단말을 동기화하고, parity 테스트를 통과시켜야 합니다.

## Reasonix 어댑터 유지보수

Reasonix(DeepSeek-Reasonix CLI)는 현재 skills + 순정 plugin manifest + skills-only의 프로젝트 레벨 `story-setup` 배포를 지원합니다; hooks와 custom agents는 후속 단계로 남겨둠(전문 Agent와 관련된 Skill은 solo/direct fallback으로 진행):

- 루트 `reasonix-plugin.json`은 plugin manifest; `version`은 반드시 `skills/story/VERSION`과 동기화해야 합니다(`check-reasonix-adapter.sh` 가드).
- Reasonix 순정으로 프로젝트 skill root를 스캔(`.agents/skills` 등, `skills/`를 가리키는 symlink로 Codex와 공유)하여 13개 skill을 발견합니다.
- `story-setup`의 `target_cli=reasonix`는 skills-only 배포로 진행: 13개 skill을 프로젝트 `skills/`에 복사, `references/reasonix/AGENTS.md.tmpl`을 쓰며, hooks/agents는 배포하지 않습니다(OpenClaw / generic과 동일 구조, `check-story-setup-deployment.sh`가 가드). Reasonix 배포 경로나 템플릿을 변경할 때는 해당 가드를 동기화하세요.
- 실제 CLI 검증 `reasonix doctor capabilities`는 CI 내에 포함되지 않으며, 배포 전 수동으로 실행할 수 있습니다.

### Reasonix 검사 절차

```bash
bash scripts/check-reasonix-adapter.sh
```

## Codex 어댑터 유지보수

본 프로젝트는 동시에 Codex CLI(repo skills 발견 + `$story-setup` 프로젝트 배포)를 지원합니다:

- repo-local skills: `.agents/skills`는 `skills/`를 가리키는 상대 symlink(`../skills`, agentskills.io 표준 경로)로, Codex가 이를 스캔하여 skill을 발견합니다. 두 번째 복사본을 만들지 마세요. 반드시 유효한 상대 symlink여야 합니다(`check-codex-adapter.sh`가 target=`../skills`인지 가드; 무효/절대 경로는 발견이 무효화됨, openai/codex#11314 참고); Windows는 git `core.symlinks=true`가 필요합니다. OpenClaw 순정으로 workspace `skills/`를 스캔하므로 이에 의존하지 않습니다.
- project deployment hooks: `skills/story-setup/references/codex/hooks/hooks.json`은 `$story-setup`을 향해 작성 프로젝트에 배포됩니다. POSIX `command`와 Windows `commandWindows`는 모두 현재 디렉터리에서 위로 `.codex/hooks/run-story-hook.*`를 찾으며, Git 저장소에 의존하지 않습니다; 발견 후 공유 launcher가 통합하여 이벤트 화이트리스트、인터프리터 탐지、`CODEX_PROJECT_DIR` 주입과 Python hook 스케줄링을 완료합니다.
- Windows hooks: Codex는 Windows에서 `%COMSPEC% /C`(cmd.exe)로 `commandWindows`를 기동합니다. 현재 등록 명령은 PowerShell로 단계별 상향 위치 탐색을 수행한 후 `run-story-hook.cmd`를 호출합니다; 따라서 중첩 작업 디렉터리와 POSIX 동작이 일치하며, 프로젝트 루트 디렉터리만 지원하는 것이 아닙니다. 이벤트 목록이나 launcher를 변경한 후 반드시 재생성기와 어댑터 검사를 재실행해야 하며, 6개 등록 항목에 탐지 로직을 수동 복사하는 것을 금지합니다.
- custom agents: `skills/story-setup/references/codex/agents/*.toml`은 `scripts/generate-codex-agents.py`가 `references/templates/agents/*.md`로부터 생성합니다. Claude agent 템플릿을 수정한 후 반드시 재생성하여 제출해야 합니다.

### Codex 동기화 절차

```bash
python3 scripts/generate-codex-agents.py
python3 scripts/generate-codex-hooks.py
bash scripts/check-codex-adapter.sh
bash scripts/test-codex-hooks.sh
```

### Codex 주요 호환성 이슈

- **hooks 신뢰 임계값**: Codex 프로젝트 `.codex/` 설정 레이어는 trust되어야 하며, 비 managed command hooks는 사용자가 `/hooks`에서 review/trust한 후에야 실행됩니다.
- **hook JSON 계약**: `PreToolUse`、`PreCompact`、`PostCompact`의 일반 stdout는 무시됨; JSON을 출력해야 하며, 예: `hookSpecificOutput.permissionDecision = "deny"` 또는 `hookSpecificOutput.additionalContext`.
- **PreToolUse가 완전히 차단하지 않음**: Codex 공식 설명에 따르면 현재 shell/edit 차단은 완전한 안전 경계가 아닙니다; story hooks는 작성 프로세스 guardrail로만 작용하며, 버전 관리와 인간 심사를 대체할 수 없습니다.
- **agent 파일 형식**: Codex custom agents는 `.codex/agents/{name}.toml`로, `name`、`description`、`developer_instructions`가 필수입니다; 읽기 전용 agent는 `sandbox_mode = "read-only"`를 사용합니다.
- **custom-agent 런타임 등록**: `$story-setup`이 `.codex/agents/*.toml`을 쓴 후, 프로젝트 `.codex/` 설정 레이어를 trust하고 새 Codex 세션을 열어야 합니다. 현재 Codex 런타임이 여전히 `unknown agent_type`을 반환하는 경우(로컬 `codex exec 0.141.0` 임시 프로젝트 smoke 테스트에서 재현 가능), skill은 반드시 solo/direct로 다운그레이드하고 fallback을 보고해야 합니다; 자동화된 강력한 임계값은 TOML schema와 파일 배포 검사입니다.
