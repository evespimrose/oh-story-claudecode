---
name: story
description: "웹소설 도구 모음 메인 입구. 사용자 요청에 따라 자동으로 해당 skill로 라우팅하며, 로컬 Dashboard를 실행하여 분석 라이브러리, 집필 프로젝트 조회 및 텍스트 편집이 가능합니다. 트리거 방식: /story, $story, /story dashboard, $story dashboard, /웹소설, 「소설을 쓰고 싶어」「작업대 열기」「업데이트 확인」."
metadata: {"openclaw":{"source":"https://github.com/worldwonderer/oh-story-claudecode"}}
---
# story: 웹소설 도구 모음 라우터

당신은 웹소설 도구 모음의 라우팅 입구입니다. 사용자의 요청이 모호할 때 구체적인 skill로 분배합니다.

## 라우팅 테이블

> Codex CLI에서는 `$story-*` 또는 `/skills`로 트리거하는 것을 우선합니다. Claude Code / OpenCode는 `/story-*`를 계속 사용합니다. OpenClaw에서는 `/skill story-*` 또는 자연어로 skill을 지정할 수 있습니다. 아래 표는 slash command로 표시하며, Codex에서는 `/story-long-write`를 `$story-long-write`로 대체할 수 있고, OpenClaw에서는 `/skill story-long-write`로 대체할 수 있습니다.

| 사용자 의도 | 키워드 예시 | 라우팅 대상 |
|---|---|---|
| 장편 집필 | 개서, 개요 작성, 장편, 연재 | `/story-long-write` |
| 단편 집필 | 단편, 옌옌, 만 자 | `/story-short-write` |
| 장편 분석 | 분석, 이 책 분석, 골든 3장 | `/story-long-analyze` |
| 단편 분석 | 단편 분석, 이 이야기 분석 | `/story-short-analyze` |
| 장편 차트 스캔 | 장편 랭킹, 무엇이 인기, 치디엔/판치에/진장 | `/story-long-scan` |
| 주제 선정 | 뭘 써야 터지나, 주제 골라줘, 주제 방향 | `/story-long-scan` |
| 단편 차트 스캔 | 단편 랭킹, 즈후 옌옌 랭킹 | `/story-short-scan` |
| AI 냄새 제거 | AI 냄새 제거, 너무 AI스러움, 디슬롭 | `/story-deslop` |
| 원고 심사 | 심사, 검토, 한번 봐줘, 일관성 검사, 문제 없는지 확인 | `/story-review` |
| 표지 | 표지, 표지 이미지 | `/story-cover` |
| 환경 배포 | 집필 준비, 환경 구축, 초기화 | `/story-setup` |
| 브라우저 제어 | 브라우저, 크롤링, 로그인 상태 | `/browser-cdp` |
| 소설 가져오기 | 가져오기, 역파싱, 소설 가져오기, 내 책 가져오기 | `/story-import` |
| 작업대 | dashboard, 작업대, 분석 라이브러리 보기, 프로젝트 파일 탐색, 프로젝트 패널 열기 | 아래 「Dashboard 작업대」 참조 |
| 버전 확인/업데이트 | 업데이트 확인, 새 버전 있나, 업그레이드, 도구 모음 업데이트 | 아래 「버전 업데이트 확인」 참조 |
| 책 전환/목록 | 책 전환, 책 변경, 내 책 목록, 몇 권 쓰고 있는지, 프로젝트 전환 | 아래 「다중 도서 전환」 참조 |
| 스토리 자료 조회 | 캐릭터 조회, 복선 조회, 진행 조회, 설정 조회, 현재 상태, 어디까지 썼는지 | spawn `story-explorer` agent (구조화 prompt: `프로젝트 디렉토리: {dir}\n조회 유형: {의도에 따라 선택}\n조회 매개변수: {사용자 쿼리}`); agent 사용 불가 시 아래 「조회 대체」 참조 |
| 자료 조사 | 자료 조사, 조사 도와줘, 리서치, 검색해줘 | spawn `story-researcher` agent; agent 사용 불가 시 아래 「조회 대체」 참조 |

### 가져오기 및 이어쓰기 순서

사용자가 "가져오기 후 이어쓰기할 때 setup 먼저인가 import 먼저인가"를 물으면 직접 답합니다: **추천 순서는 `/story-setup` 먼저, 세션 새로 열기/새로고침 후 `/story-import`, 마지막으로 `/story-long-write 일일 연재` 또는 `/story-long-write N장 집필`**. 사용자가 이미 `/story-import`를 직접 트리거한 경우, story-import 자체 환경 감지에 따라 계속 진행합니다: setup이 안 된 경우 먼저 setup으로 갈지 직렬 가져오기를 계속할지 선택하게 합니다.

## Dashboard 작업대

사용자가 `/story dashboard` (Codex에서는 `$story dashboard`)를 실행하거나, "작업대 열기 / 프로젝트
파일 보기"라고 명확히 말하면, 본 skill에 포함된 로컬 Dashboard를 직접 실행하며, 다른 skill로 전달하지 않습니다:

1. **현재 작업 디렉토리**를 기본 워크스페이스로 사용합니다. 사용자가 명시적으로 디렉토리를 지정하면 해당 디렉토리를 사용합니다. 디렉토리는 반드시 존재해야 합니다.
2. 현재 로드된 `story` skill 디렉토리에서 `scripts/dashboard-server.mjs`를 찾습니다. 저장소 경로, 전역 skill 경로 또는 사용자 홈 디렉토리를 하드코딩하지 마세요.
3. `node` 사용 가능 여부를 확인한 후, 장기 실행 프로세스로 실행합니다:

   ```bash
   node "<story-skill-dir>/scripts/dashboard-server.mjs" --root "<workspace>" --open
   ```

4. 출력에 "로컬 주소"가 나타날 때까지 기다린 뒤, 전체 URL을 사용자에게 반환합니다. 도구가 백그라운드 프로세스/PTY를 지원하면 서비스를 계속 실행합니다. 브라우저를 자동으로 열지 못하는 것은 실패가 아니며, 클릭 가능한 URL을 반환합니다.
5. Dashboard는 기본적으로 `127.0.0.1`만 리슨합니다. `--allow-network`를 자발적으로 추가하지 마세요. 워크스페이스를 LAN이나 공용 네트워크에 노출하지 마세요.

작업대는 표준 `분석라이브러리/{책이름}/` 경로를 인식하며, 기존 `분석라이브러리-{책이름}/`과도 호환됩니다. 집필 프로젝트 인식은 다음을 동시에 지원합니다:

- 장편 디렉토리 구조: 디렉토리 내에 `본문/`, `개요/`, `설정/` 또는 `추적/` 중 하나의 일반 하위 디렉토리가 있는 경우.
- 단편 단일 파일 구조: 디렉토리 내에 일반 파일 `본문.md`가 있고, `소절개요.md` 또는 `설정.md`가 함께 있는 경우.

심볼릭 링크는 프로젝트 표시로 사용하지 않으며, `본문.md`만 있는 일반 자료 디렉토리는 오인하지 않습니다. 브라우저에서
`.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.toml` 파일을 편집할 수 있으며, 저장 또는 삭제 확인 전에 수정 시간을 통해
외부 업데이트의 오동작을 방지합니다.

서비스를 중지할 때는 해당 Node 장기 실행 프로세스를 종료하면 됩니다. 사용자가 사용법만 물으면 대신 실행하지 마세요.
`/story dashboard` / `$story dashboard` 두 가지 플랫폼 대응 입구를 안내해 주세요.

## 라우팅 흐름

1. 사용자 요청을 분석하여 의도 키워드를 추출합니다
2. 위 표에서 매칭하여 해당 skill을 찾습니다
3. 명확히 매칭되면 해당 skill을 직접 호출합니다 (Claude/OpenCode에서는 `Skill("skill-name")` 또는 slash command 사용; Codex에서는 `$skill-name` / `/skills` 사용; OpenClaw에서는 `/skill skill-name` 또는 자연어 지정)
4. 매칭할 수 없으면 사용자에게 무엇을 하고 싶은지 물어봅니다 (위 표에서 선택)
5. 사용자가 "소설을 쓰고 싶어"라고 하지만 장편/단편을 지정하지 않으면, 분량 유형을 물어본 후 라우팅합니다

## 조회 대체

> Spawn 버전 알림 (spawn 차단 없음): 먼저 프로젝트 루트 `.story-deployed`의 `agents_version`을 읽습니다. 본 버전 `agents_version: 24`와 불일치할 때 (표시 누락, 필드 누락/비정수, 24보다 작거나 큰 경우) **파일 존재 여부 확인 후 정상적으로 spawn**하면서 `Notice: agents bundle 버전 불일치 (프로젝트 {N}, 본 버전 24)`를 보고하고 `/story-setup` 재실행 후 새 세션 열기를 안내합니다. 24보다 큰 경우 oh-story-claudecode를 먼저 업데이트하라고 추가 안내하며, 로컬 구버전 setup으로 다운그레이드 덮어쓰기를 하지 않습니다. agent 파일이 없거나 런타임에서 custom agent를 노출하지 않을 때만 solo/direct로 대체하며, `Fallback: ... -> solo`를 보고합니다.

「스토리 자료 조회」「자료 조사」는 agent로 가기 전에 경량 가용성 검사를 합니다 (라우터는 이 한 단계만 담당하며, 전체 배포 전략을 책임지지 않습니다): 현재 하위 에이전트 컨텍스트에 있지 않고, Agent/Task 도구가 사용 가능하며, `.claude/agents/{story-explorer|story-researcher}.md`, `.opencode/agents/{story-explorer|story-researcher}.md` 또는 `.codex/agents/{story-explorer|story-researcher}.toml`이 존재하면 → spawn 시도 가능. 하나라도 충족되지 않거나, Codex 런타임이 `unknown agent_type` / custom-agent registry를 노출하지 않으면 대체 처리하며, 하드 실패하지 않습니다:

- `story-explorer` 사용 불가 → 메인 스레드에서 Read/Grep으로 프로젝트 파일을 직접 검색 (캐릭터 상태/복선/진행/설정)하고, 응답 전에 `Fallback: agent unavailable -> direct lookup`을 표시합니다. 프로젝트가 아직 배포되지 않은 경우 먼저 `/story-setup` (Codex에서는 `$story-setup`)을 안내합니다.
- `story-researcher` 사용 불가 → 메인 스레드에서 기존 검색/응답 기능으로 처리하거나, `/browser-cdp`를 사용하여 수집하라고 안내하며, 마찬가지로 `Fallback: agent unavailable -> direct lookup`을 표시합니다.

## 프로젝트 상태 감지

라우팅 전에 현재 프로젝트 상태를 확인합니다:

- **프로젝트 디렉토리 없음** (`추적/` 또는 `설정/`을 포함하는 책 이름 디렉토리가 없음):
  - 사용자가 집필하려는 경우, 다음 단계는 먼저 `/story-setup`으로 환경을 초기화하는 것입니다 (Codex에서는 `$story-setup`)
  - 사용자가 차트 스캔/분석을 하려는 경우, 직접 라우팅합니다
- **프로젝트가 있는 경우**: `.story-deployed` 표시를 확인하고, 미배포 시 먼저 `/story-setup`을 실행합니다 (Codex에서는 `$story-setup`)

## 다중 도서 전환

사용자가 집필 중인 책을 전환하거나 조회하려 할 때 (하나의 프로젝트에 여러 권이 동시에 있을 수 있음):

1. 프로젝트 루트에서 모든 도서 디렉토리를 찾습니다: `추적/` 또는 `설정/` 하위 디렉토리를 포함하는 디렉토리 (`장편/`, `단편/` 하위 디렉토리 포함).
2. 책 이름을 나열하고, 현재 `.active-book`이 가리키는 책을 표시합니다.
3. 사용자가 선택하면, 선택한 책의 상대 경로를 프로젝트 루트 `.active-book`에 씁니다 (기존 내용 덮어쓰기).
4. 한 권만 발견되면 바로 활성 도서로 확인하며, 질문하지 않습니다.

## 버전 업데이트 확인

사용자가 "새 버전 있나" "업데이트 확인" "업그레이드"를 물으면 실행합니다. **알림만 하며, 업데이트 여부는 사용자가 결정합니다. 자동 설치하지 않습니다.**

1. **현재 버전**: 본 skill 동일 디렉토리의 `VERSION` 파일을 읽습니다. 없으면 알 수 없음으로 간주합니다.
2. **최신 버전**: `gh release view --json tagName,name,url -R worldwonderer/oh-story-claudecode`로 `tagName`을 우선 가져옵니다. gh가 없으면 `curl -fsS --max-time 5 https://api.github.com/repos/worldwonderer/oh-story-claudecode/releases/latest`로 `.tag_name`을 가져옵니다 (jq 또는 grep). 가져올 수 없으면 → "잠시 최신 버전을 가져올 수 없습니다. [Releases](https://github.com/worldwonderer/oh-story-claudecode/releases)에서 직접 확인하세요"라고 안내하며, 오류를 표시하지 않습니다.
3. **비교**: `v` 접두사를 제거하고 시맨틱 버전으로 비교합니다 (major.minor.patch). `gh release`는 기본적으로 최신 안정 버전을 가져오며, pre-release는 포함하지 않습니다.
4. **안내**:
   - 최신인 경우 → 「이미 최신 버전 vX.Y.Z입니다」.
   - 새 버전이 있는 경우 → 현재 vA → 최신 vB + [Releases](https://github.com/worldwonderer/oh-story-claudecode/releases)/[CHANGELOG](https://github.com/worldwonderer/oh-story-claudecode/blob/main/CHANGELOG.md) (릴리스 노트를 가져올 수 있으면 주요 사항 첨부)를 나열한 뒤, AskUserQuestion으로 「지금 업데이트하시겠습니까?」를 묻습니다:
     - 업데이트 선택 → `npx skills add worldwonderer/oh-story-claudecode -y -g` 실행 (`-g`는 전역, 제거하면 현재 디렉토리만 업데이트); 완료 후 안내: 이미 배포된 프로젝트에서는 프로젝트 루트에서 `/story-setup` (Codex에서는 `$story-setup`)을 다시 실행하여 hooks/agents/references를 동기화하고, **새 세션을 열어** agents를 다시 등록하세요.
     - 나중에 선택 → 변경 없이, 언제든 다시 올 수 있다고 안내합니다.
