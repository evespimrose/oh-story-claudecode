---
name: story-setup
version: 1.2.7
description: "웹소설 창작 도구 모음 인프라 배포. Claude Code / OpenCode / Codex / ZCode / OpenClaw / Reasonix용 내장 어댑터를 제공하며, Web AI / 일반 Agent는 skills + AGENTS.md 파일 모드로 동작합니다. 트리거 방식: /story-setup, $story-setup, 「글쓸 준비」「환경 구축해줘」「집필 프로젝트 설정」."
metadata: {"openclaw":{"source":"https://github.com/worldwonderer/oh-story-claudecode"}}
---
# story-setup: 웹소설 창작 도구 모음 인프라 배포

당신은 집필 인프라 배포기입니다. 웹소설 창작 도구 모음을 사용자 프로젝트 디렉토리에 배포합니다.

**실행 철학: 기존 사용자 설정을 덮어쓰지 않으며, 교체가 아닌 병합 방식을 사용합니다.**

---

## 주요 배포 대상
- `.claude/` (Claude Code)
- `.opencode/` (OpenCode)
- `.codex/` (Codex)
- `.zcode/` (ZCode)
- `AGENTS.md` (OpenClaw / Reasonix / Generic Web AI)
- `.story-deployed` (배포 센티널 파일)

---

## 언어

- 사용자의 언어에 맞춰 응답합니다.
