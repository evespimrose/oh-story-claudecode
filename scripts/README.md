# scripts/ —— 저장소 개발 스크립트 인덱스

이들은 본 저장소(skill 패키지 본체) 개발용 **가드 / 테스트 / 코드 생성** 스크립트이며, **skill 런타임 스크립트가 아닙니다**(런타임 스크립트는 각 skill 자체의 `scripts/` 하위에 있습니다. 예: `story-deslop/scripts/check-ai-patterns.js`, Skill 간 바이트 동기화).

- 대부분 CI가 자동 실행합니다(`.github/workflows/cross-platform.yml`). 제출 전 로컬에서 전체 명령을 한 번에 실행하는 방법은 [CONTRIBUTING.md](../CONTRIBUTING.md)「CI 검사」 참고.
- **어느 스크립트의 이름/경로 변경** 시, `.github/workflows/*.yml`、`CONTRIBUTING.md`、본 파일, 그리고 이를 호출하는 형제 스크립트들을 동시에 수정해야 합니다(아래 「실행 시점」의 호출 관계 참고).

## 정적 가드（check-*）

| 스크립트 | 검사 내용 | 실행 시점 |
|---|---|---|
| `static-check.sh` + `static-check.py` | frontmatter 구조화 검증, Markdown 경로/앵커, Agent 참조, references 도달 가능성; 기본 컴포넌트 `browser-cdp` 외 Skill 간 파일 참조 금지 | CI |
| `skill-numbering.py check` | 워크플로우 Step/Phase/Stage 번호 전략, 참조 바인딩, SKILL.md 순수 번호/하위 단계 소수 가드 | CI；워크플로우 구조 변경 후 |
| `check-current-skill-contracts.sh` + `.py` + `current-contract.json` | 구조화 manifest로부터 현재 버전、Phase、schema、주요 산출물과 세부 개요 계약 검증; legacy/path 가드를 보존하고 주요 산출물 누락 후의 암묵적 대체를 차단 | CI |
| `check-shared-files.sh` | `sync-shared-assets.py check`를 호출하여 runtime 사본을 검증한 뒤, 58조 공유 reference 바이트 일치를 검증 | CI |
| `check-story-setup-deployment.sh` | story-setup 배포/런타임 회귀(느림, >2min) | CI |
| `check-hook-regex-sync.sh` | `detect-story-gaps.sh` 복선 상태 검출 동작 | CI |
| `check-hook-locale-safety.sh` | 배포 hook의 Windows 중문 GBK 지역에서의 바이트 안전성 | CI |
| `check-python-invocation.sh` | 기술 문서에서 순수 호출 `python3` 금지(반드시 python3→python→py 탐지 필요) | CI |
| `check-claude-adapter.sh` | Claude marketplace와 13개 skill의 일일 매핑; 선택 사항 실제 CLI strict validate | CI（정적）；`CLAUDE_REAL_CHECK=1`（실제 CLI） |
| `check-opencode-adapter.sh` | OpenCode 어댑터 층 동기화 + commands/agents/config 구조 + plugin 동작 회귀 | CI + sync CI（sync-opencode.py 호출） |
| `check-openclaw-skills.sh` | OpenClaw AgentSkills/frontmatter 호환성 | CI |
| `check-codex-adapter.sh` | Codex 어댑터 층: repo skills symlink, agent TOML, hooks와 플랫폼 간 launcher | CI（generate-codex-agents.py 호출하여 생성 확정성 검증） |
| `check-zcode-adapter.sh` | ZCode plugin/marketplace、Skills/Commands/Hooks와 배포 앵커 | CI |
| `check-reasonix-adapter.sh` | Reasonix plugin manifest（schema、13 Skills、버전과 skills/story/VERSION 동기화） | CI |

## 테스트 회귀（test-*）

| 스크립트 | 측정 내용 | 실행 시점 |
|---|---|---|
| `test-ai-patterns.sh` | 확정성 AI 문장 검출기 `check-ai-patterns.js` 회귀 | CI |
| `test-degeneration.sh` | 모델 열화 검출기 `check-degeneration.js` 회귀 | CI |
| `test-prose-net-parity.sh` | 본문 폴백「경량 확정성 네트워크」Claude/OpenCode/Codex/ZCode parity | CI（check-hook-regex-sync 호출） |
| `test-prose-backstop-hook.sh` | `check-prose-after-write.sh` 회귀 | CI |
| `test-story-continuity.sh` | `detect-story-gaps.sh` 배치 간 연속성 폴백 회귀 | CI |
| `test-tracking-workflow-contracts.py` | 파일 우선 추적 계약: 유일 트랜잭션 쓰기 진입점、이어쓰기 상태 카드(고정 7칼럼)、가져오기 베이스라인、작가/독자 타임라인 격리、구조 초기화 | CI |
| `test-tracking-commit.py` | 단일 권위 추적 행동: state 최종 제출、실패 시 동일 트랜잭션 재실행、파생 일관성、개정 의미、가져오기 마지막 장 | CI |
| `test-codex-hooks.sh` | Codex hook 합성 stdin/stdout 계약 | CI |
| `test-static-check.py` | 진짜 frontmatter block、정확한 경로/앵커、Skill 간 참조、fence、죽은 reference、Agent와 장절 링크 fixture | CI |
| `test-current-skill-contracts.py` | current-contract manifest 타입/고정값과 주요 산출물 fail-fast 의미 fixture | CI |
| `test-shared-assets.py` | 공유 자산 manifest의 drift、sync、경로 월경、basename 단일 owner와 미등록 중복 검출 | CI |
| `test-normalize-punctuation.js` | 문장 부호 정규화의 읽기 전용 검사、frontmatter/fence、CRLF、인용부호 모드와 멱등성 | CI |
| `test-scan-runtime.js` | CDP argv 경계/오류/JSON 계약과 7개 scraper 부작용 없는 import | CI |
| `test-opencode-plugin.mjs` | OpenCode TypeScript 플러그인 직접 실행, 개요 가드、Bash 우회、쓰기 후 검사와 compact 복원 검증 | `check-opencode-adapter.sh`에 의해 호출됨 |
| `test-codex-cli-e2e.sh` | HOME 격리 후 실제 Codex CLI로 repo 13개 skill의 발견 결과 검사 | CLI compatibility CI；`codex` 설치 필요 |
| `test-zcode-hooks.sh` | ZCode 엄격 JSON Hook、본문 가드와 연속성 회귀 | CI |
| `test-charcount-portable.sh` | 플랫폼 간 문자 통계 명령의 세 플랫폼 + Windows에서의 정확성 | CI（check-python-invocation 호출） |
| `test-hook-encoding-portable.sh` | 배포 hook의 Windows 중문 시스템에서의 인코딩 견고성 | CI |
| `test-opencode-cli-e2e.sh` | 실제 OpenCode CLI 로딩 smoke（repo skills 발견 / 13 commands / 7 agents / plugin） | CLI compatibility CI；`opencode` 설치 필요 |
| `test-skill-numbering.sh` | Step 재배열 연쇄 안전、앵커 fail-closed、코드 블록 참조、제로 쓰기/제출 롤백 검증、dry-run/write/멱등성 | Linux / Windows Git Bash / macOS CI |

## 코드 생성 / 동기화

| 스크립트 | 수행 내용 | 실행 시점 |
|---|---|---|
| `sync-opencode.py` | Claude agent 템플릿 + `CLAUDE.md.tmpl`로부터 `opencode/agents/`와 `AGENTS.md.tmpl` 생성; `--check`는 읽기 전용 동기화 검증 | agent 템플릿 변경 후 수동 실행; sync CI + check-opencode-adapter에 의해 호출 |
| `generate-codex-agents.py` | Claude agent 템플릿으로부터 Codex `.toml` agents 생성 | agent 템플릿 변경 후 수동 실행; check-codex-adapter에 의해 생성 확정성 검증 시 호출 |
| `generate-codex-hooks.py` | 6개 event 목록으로부터 `hooks.json` 생성, POSIX/Windows 공유 launcher가 인터프리터 탐지 담당 | Codex hook 등록 변경 시; check-codex-adapter에 의해 생성 확정성 검증 시 호출 |
| `shared-assets.json` + `sync-shared-assets.py` | skill과 함께 독립 배포되어야 하는 중복 runtime 스크립트에 대해 유일 원본과 타겟을 지정 | 공유 runtime 변경 시 `sync` 실행; CI는 `check` 실행 |

> `skills/story-setup/references/templates/agents/*.md` 또는 `CLAUDE.md.tmpl`을 변경했다면, 반드시 위 두 개 생성 스크립트를 재실행하고 결과를 제출해야 합니다. 그렇지 않으면 어댑터 층 CI가 빨간색으로 표시됩니다. 자세한 내용은 [CONTRIBUTING.md](../CONTRIBUTING.md)「OpenCode 템플릿 동기화」「Codex 어댑터 유지보수」 참고.

## 워크플로우 번호 유지

`skill-numbering.py`는 기본적으로 canonical `skills/**/*.md`를 스캔하며, 반복 삽입으로 인해 워크플로우 번호가 `Step 1.3`、`Phase 2.5` 같은 소수 레이블로 누적되는 것을 막는 데 사용됩니다.

```bash
python3 scripts/skill-numbering.py audit          # 읽기 전용 점검; 문제 발견해도 exit 0
python3 scripts/skill-numbering.py check          # CI 가드; 문제 발견 시 exit 비0
python3 scripts/skill-numbering.py fix --dry-run  # 먼저 완전한 diff 확인, 디스크에 쓰지 않음
python3 scripts/skill-numbering.py fix --write    # 검증 통과 후 일회성으로 디스크에 씀
bash scripts/test-skill-numbering.sh              # 격리 fixture 회귀
```

유지 전략:

- 오직 `### Step N` 형태의 **명시적 Step 제목**만 자동 재배열됩니다; 그룹 키는 「파일 + 제목 레벨 + 가장 가까운 부모 제목」이며, 각 그룹은 1부터 연속 번호가 매겨집니다.
- 제목과 유일하게 바인딩 가능한 `Step N` 참조는 구 텍스트에 기반하여 동시에 번호가 변경되며, fenced code block 내의 명령/예시 참조를 포함하여 `1.5 → 2` 이후 다시 `2 → 3`으로 이차 연쇄되는 것을 방지합니다.
- fractional Step 참조가 본 파일 제목을 찾지 못하거나, 하나의 구 레이블이 여러 개의 새 레이블로 매핑될 가능성이 있는 경우, `fix`는 어떤 쓰기 전에도 실패합니다. 다중 파일 쓰기는 전체 검증/임시 저장 후 롤백을 수행하며, 부분 결과를 받지 않습니다.
- 제목 번호 변경은 GitHub Markdown anchor를 변경합니다; 저장소 내에 구 anchor를 가리키는 동일 파일 또는 파일 간 링크가 존재하는 한, `fix`는 쓰기 전 fail-closed되며 각 fragment를 보고하여 링크를 먼저 명시적 업데이트한 후 재시도할 것을 요구합니다. 국소 경로 모드도 마찬가지로 저장소 내 인바운드 링크를 스캔합니다.
- `Step N.M` / `Phase N.M` / `Stage N.M`、직접 `skills/*/SKILL.md` 내의 순수 소수 제목과 bullet 소수 하위 단계는 `check`가 오류로 보고하지만, 추측식 자동 수정은 하지 않습니다.
- `references/` 매뉴얼 자체의 `3.1` 장/리스트 번호는 워크플로우 레이블에 속하지 않으므로, 검사도 하지 않고 수정도 하지 않습니다. 파이프라인 ID에 중간 단계를 삽입해야 하는 경우, 의미적 이름이나 `Stage 2A`를 사용하며 소수를 사용하지 않습니다.
- 명령 끝에 파일이나 디렉터리를 전달하여 국소 감사를 할 수 있습니다. 예: `... audit skills/story-cover/SKILL.md`；합치기 전에는 여전히 기본 전체 `check`를 실행해야 합니다.
