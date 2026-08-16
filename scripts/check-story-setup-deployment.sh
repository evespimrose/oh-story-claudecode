#!/bin/bash
# check-story-setup-deployment.sh — story-setup deployment/runtime regression checks
# Covers hook lib deployment, reference bundle integrity, root-aware hooks,
# short-project non-mutation, commit-hook self-gating, and deployed-behavior anchors.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_DIR="$REPO_ROOT/skills/story-setup"
HOOKS_DIR="$SKILL_DIR/references/templates/hooks"
AGENT_REFS_DIR="$SKILL_DIR/references/agent-references"
SKILL_FILE="$SKILL_DIR/SKILL.md"
SETTINGS_FILE="$SKILL_DIR/references/templates/settings-hooks.json"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file() {
  [ -f "$1" ] || fail "required file missing: $1"
}

assert_grep() {
  local pattern="$1"
  local file="$2"
  local message="$3"
  grep -Eq "$pattern" "$file" || fail "$message ($file)"
}

assert_no_grep() {
  local pattern="$1"
  local file="$2"
  local message="$3"
  if grep -Eq "$pattern" "$file"; then
    fail "$message ($file)"
  fi
}

copy_hooks() {
  local root="$1"
  mkdir -p "$root/.claude"
  cp -R "$HOOKS_DIR" "$root/.claude/hooks"
  chmod +x "$root/.claude/hooks"/*.sh
}

copy_agent_refs() {
  local root="$1"
  mkdir -p "$root/.claude/skills/story-setup/references"
  cp -R "$AGENT_REFS_DIR" "$root/.claude/skills/story-setup/references/agent-references"
}

write_sentinel() {
  local root="$1"
  cat > "$root/.story-deployed" <<'SENTINEL'
deployed_at: 2026-05-24T00:00:00Z
agents_version: 24
setup_skill_version: 1.2.7
target_cli: claude-code
resolver_strategy: project-local-skill-reference
references_dir: .claude/skills/story-setup/references/agent-references
SENTINEL
}

run_from_nested() {
  local root="$1"
  local script="$2"
  local nested="$root/nested/a/b"
  mkdir -p "$nested"
  (cd "$nested" && CLAUDE_PROJECT_DIR="$root" bash "$root/.claude/hooks/$script")
}

run_from_nested_no_project_dir() {
  local root="$1"
  local script="$2"
  local nested="$root/nested/a/b"
  mkdir -p "$nested"
  (cd "$nested" && unset CLAUDE_PROJECT_DIR && bash "$root/.claude/hooks/$script")
}

setup_git_repo() {
  local root="$1"
  git -C "$root" init -q
  git -C "$root" config user.email story-setup@example.invalid
  git -C "$root" config user.name story-setup-test
}

run_commit_hook_command() {
  local root="$1"
  local command_text="$2"
  (cd "$root" && CLAUDE_PROJECT_DIR="$root" STORY_COMMIT_COMMAND="$command_text" bash .claude/hooks/validate-story-commit.sh 2>&1 || true)
}

assert_commit_warns() {
  local root="$1"
  local command_text="$2"
  local label="$3"
  local out
  out="$(run_commit_hook_command "$root" "$command_text")"
  echo "$out" | grep -q 'Story Commit Warnings' || fail "validate-story-commit did not warn for $label: $command_text"
  echo "$out" | grep -q '정문 하드코딩 역할 속성' || fail "validate-story-commit이 $label에 대해 스테이징된 마크다운을 검사하지 않음"
}

echo "Story setup deployment check"
echo "============================"
echo "Repo: $REPO_ROOT"

# TS1 — Hook dependency completeness
assert_file "$HOOKS_DIR/lib/common.sh"
assert_file "$HOOKS_DIR/lib/sentinel.sh"
runtime_artifacts="$(find "$HOOKS_DIR" -maxdepth 4 \( -path '*/.omc*' -o -name '.DS_Store' -o -name '*.tmp' -o -name '*.log' \) -print 2>/dev/null || true)"
[ -z "$runtime_artifacts" ] || fail "hook templates contain runtime artifacts that would be recursively deployed: $runtime_artifacts"
while IFS= read -r src; do
  [ -n "$src" ] || continue
  case "$src" in
    '$(dirname "$0")/'*)
      rel="${src#'$(dirname "$0")/'}"
      assert_file "$HOOKS_DIR/$rel"
      ;;
    "\$(dirname \"\$0\")/"*)
      rel="${src#"\$(dirname \"\$0\")/"}"
      assert_file "$HOOKS_DIR/$rel"
      ;;
  esac
done < <(grep -RhoE '^source[[:space:]]+"[^"]+"' "$HOOKS_DIR"/*.sh | sed -E 's/^source[[:space:]]+"//;s/"$//' | sort -u)
# node 공유 코어 + CLI 브릿지: 정문 네트워크/글자 수/경로 추출/git commit 감지/연속성의 단일 구현, bash hook에 의해
# `node "$(dirname "$0")/story_hook_cli.js"`로 호출됨. 개요 차단 판정과 스테이징된 마크다운 경고는 코어화되지 않음,
# 여전히 각 엔드포인트에서 독립적으로 구현됨 (Claude 순수 bash; codex↔core는 test-prose-net-parity.sh Part E에서 parity 잠금).
# 이 두 조건은 source 의존성이 아니므로 위의 grep으로 잡을 수 없음, 명시적으로 존재 + 구문 유효성을 단언하고 그렇지 않으면 hook이 자동으로 기능 저하
# (node가 없을 때 hook 자체가 exit 0으로 처리되고, session-start.sh 세션 시작점에서 한 번 알림이 표시되므로, 여기서는 개발 머신에 node가 있다고 가정하여 검증합니다).
assert_file "$HOOKS_DIR/story_hook_core.js"
assert_file "$HOOKS_DIR/story_hook_cli.js"
if command -v node >/dev/null 2>&1; then
  node --check "$HOOKS_DIR/story_hook_core.js" || fail "story_hook_core.js node syntax invalid"
  node --check "$HOOKS_DIR/story_hook_cli.js" || fail "story_hook_cli.js node syntax invalid"
fi
assert_grep '재귀 복사 전체 디렉토리 트리|recursive' "$SKILL_FILE" "SKILL.md must require recursive hook deployment"
assert_grep 'lib/common\.sh' "$SKILL_FILE" "SKILL.md must mention hooks/lib/common.sh"
assert_grep 'lib/sentinel\.sh' "$SKILL_FILE" "SKILL.md must mention hooks/lib/sentinel.sh"
echo "  OK TS1 hook dependency completeness"

# TS1b — SessionStart 배포 자체 검사 목록은 모든 hook 스크립트를 포함해야 합니다(새로운 hook 미등록 방지, #195 review).
# *.js도 함께 열거: story_hook_cli.js/story_hook_core.js는 핵심 공유 라이브러리이며, 삭제될 때 본문 폴백/commit 감지/
# 연속성 검사는 모두 자동으로 무시되도록 축소되므로, 마찬가지로 자체 검사 목록에 등록해야 합니다.
selfcheck_line="$(grep -E 'for hook in .*; do' "$HOOKS_DIR/session-start.sh" | head -1)"
[ -n "$selfcheck_line" ] || fail "session-start.sh에 hook 자체 검사 for 루프가 없습니다"
# 목록의 마지막 hook 뒤에는 공백이 아닌 `;`이 바로 따라옵니다(grep 명중 줄은 패턴에 따라 반드시 `; do`로 끝남).
# 원본 줄을 직접 *" $base "* 형태로 사용하면 「마지막에 있는, 실제로는 등록된」 hook을 누락된 것으로 잘못 보고할 수 있습니다. 먼저 세미콜론을
# 공백으로 바꾸고 양쪽에 공백을 붙여서, 첫 번째/마지막 항목도 같은 case로 처리되도록 하되, 목록이 특정 순서를 유지하도록 요구하지 않도록 합니다.
selfcheck_tokens=" ${selfcheck_line//;/ } "
while IFS= read -r hookfile; do
  base="$(basename "$hookfile")"
  case "$selfcheck_tokens" in
    *" $base "*) : ;;
    # ${base}는 반드시 중괄호를 붙여야 합니다: macOS bash 3.2는 UTF-8 로케일에서 전각 「(」의 첫 번째 바이트를 변수명에 포함시킵니다.
    # set -u는 base?: unbound variable을 발생시키므로, 실제로 누락되었을 때 어떤 hook이 누락되었는지 알 수 없습니다.
    *) fail "session-start.sh 배포 자가진단 체크리스트에 hook이 누락됨: ${base}（새로운 hook을 추가할 때는 이 체크리스트에도 함께 추가해야 합니다）" ;;
  esac
done < <(find "$HOOKS_DIR" -maxdepth 1 \( -name '*.sh' -o -name '*.js' \) -type f)
echo "  OK TS1b session-start self-check lists all hook scripts and node cores"

# TS2 — Deployment checklist/manifest parseability
for header in 'Source path' 'Target path' 'Owner class' 'Merge mode' 'Validation check'; do
  assert_grep "$header" "$SKILL_FILE" "deployment manifest missing column: $header"
done
for group in 'templates/hooks/' 'templates/rules' 'templates/agents' 'agent-references' 'settings-hooks\.json' 'CLAUDE\.md' '\.story-deployed'; do
  assert_grep "$group" "$SKILL_FILE" "deployment manifest missing asset group: $group"
done
assert_file "$SKILL_DIR/references/openclaw/AGENTS.md.tmpl"
assert_file "$SKILL_DIR/references/generic/AGENTS.md.tmpl"
assert_file "$SKILL_DIR/references/reasonix/AGENTS.md.tmpl"
assert_file "$SKILL_DIR/references/zcode/AGENTS.md.tmpl"
assert_file "$SKILL_DIR/references/zcode/config.json.patch"
assert_file "$SKILL_DIR/references/zcode/hooks/hooks.json"
assert_file "$SKILL_DIR/references/zcode/hooks/story_zcode_hook.js"
assert_file "$SKILL_DIR/references/zcode/hooks/story_hook_core.js"
# OpenCode shares the same prose-guard core (byte-identity guarded by check-opencode-adapter.sh);
# it deploys alongside plugin.ts as .opencode/plugins/lib/story_hook_core.js (lib/ subdir so it
# escapes OpenCode's single-level .opencode/plugins/*.js plugin auto-discovery).
assert_file "$SKILL_DIR/references/opencode/story_hook_core.js"
assert_grep 'opencode/story_hook_core\.js' "$SKILL_FILE" "deployment manifest missing OpenCode shared prose-guard core"
assert_grep 'references/openclaw/AGENTS\.md\.tmpl' "$SKILL_FILE" "deployment manifest missing OpenClaw AGENTS template"
assert_grep 'OpenClaw skills-only|target_cli 포함 openclaw' "$SKILL_FILE" "story-setup must document OpenClaw skills-only deployment"
assert_grep 'references/generic/AGENTS\.md\.tmpl' "$SKILL_FILE" "deployment manifest missing generic AGENTS template"
assert_grep 'target_cli 포함 generic|범용 Web AI / 기타 Agent' "$SKILL_FILE" "story-setup must document generic Web AI deployment"
assert_grep 'references/reasonix/AGENTS\.md\.tmpl' "$SKILL_FILE" "deployment manifest missing Reasonix AGENTS template"
assert_grep 'Reasonix skills-only|target_cli 포함 reasonix' "$SKILL_FILE" "story-setup must document Reasonix skills-only deployment"
assert_grep 'references/zcode/AGENTS\.md\.tmpl' "$SKILL_FILE" "deployment manifest missing ZCode AGENTS template"
assert_grep 'target_cli 포함 zcode|target_cli = zcode' "$SKILL_FILE" "story-setup must document ZCode deployment"
assert_grep '\.zcode/config\.json' "$SKILL_FILE" "story-setup must document ZCode config merge"
assert_grep '배포 안 함.*\.zcode/agents|생성 안 함.*\.zcode/agents' "$SKILL_FILE" "story-setup must document ZCode agent boundary"
assert_grep 'references_dir' "$SKILL_FILE" "sentinel references_dir must be documented"
assert_grep 'resolver_strategy' "$SKILL_FILE" "sentinel resolver_strategy must be documented"
assert_grep 'target_cli' "$SKILL_FILE" "sentinel target_cli must be documented"

# 재배포 시 sentinel의 target_cli가 권위 있음: 이를 인정하지 않으면 매번 다시 묻게 되며, skills-only 3단에서는 아예 감지할 수 없음.
assert_grep '배포된 프로젝트는 sentinel의 값을 기준으로 함' "$SKILL_FILE" "story-setup must reuse the deployed target_cli on redeploy"
# metadata.openclaw는 13개 skill 모두에 있으므로, 이를 기준으로 판정하면 reasonix / generic 프로젝트를 OpenClaw로 오인하게 됨.
assert_no_grep '중의 `metadata\.openclaw`' "$SKILL_FILE" "story-setup must not detect OpenClaw from the skills bundle it deploys itself"
assert_grep '작동하지 않는 OpenClaw 신호' "$SKILL_FILE" "story-setup must explain why metadata.openclaw is not a detection signal"
# skills-only 세 종류는 각각 AGENTS.md의 제목 행으로만 구분되며, SKILL.md에서 참조하는 마크는 반드시 템플릿에 실제로 존재해야 함.
assert_grep '네트워크 소설 작성 도구 모음(Reasonix)' "$SKILL_FILE" "story-setup must detect a deployed Reasonix project from AGENTS.md"
assert_grep '네트워크 소설 작성 도구 모음(범용 Agent / Web AI)' "$SKILL_FILE" "story-setup must detect a deployed generic project from AGENTS.md"
assert_grep '네트워크 글쓰기 도구 모음(Reasonix)' "$SKILL_DIR/references/reasonix/AGENTS.md.tmpl" "Reasonix AGENTS template must carry the marker story-setup detects"
assert_grep '네트워크 글쓰기 도구 모음(범용 Agent / Web AI)' "$SKILL_DIR/references/generic/AGENTS.md.tmpl" "generic AGENTS template must carry the marker story-setup detects"
assert_grep '네트워크 글쓰기 도구 모음(OpenClaw)' "$SKILL_DIR/references/openclaw/AGENTS.md.tmpl" "OpenClaw AGENTS template must carry the marker story-setup detects"
echo "  OK TS2 deployment manifest"

# TS3 — Agent reference bundle integrity
refs_tmp="$TMP_DIR/deployed-reference-bundle"
copy_agent_refs "$refs_tmp"
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  assert_file "$AGENT_REFS_DIR/$ref"
  assert_file "$refs_tmp/.claude/skills/story-setup/references/agent-references/$ref"
done < <(grep -RhoE 'story-setup/references/agent-references/[A-Za-z0-9_-]+\.md' \
  "$SKILL_DIR/references/templates/agents" "$AGENT_REFS_DIR" "$SKILL_DIR/references/templates/rules" 2>/dev/null \
  | sed 's|.*/||' | sort -u)
echo "  OK TS3 agent reference integrity"

# TS4 — Hook root resolution from nested cwd
root="$TMP_DIR/root-aware"
mkdir -p "$root/book/추적" "$root/book/본문" "$root/book/설정" "$root/book/개요" "$root/분할문서/sample"
setup_git_repo "$root"
copy_hooks "$root"
copy_agent_refs "$root"
write_sentinel "$root"
printf 'book\n' > "$root/.active-book"
cat > "$root/book/추적/컨텍스트.md" <<'CTX'
# 작성 진행 상황
## 현재 위치
- 장: 제1장
CTX
touch "$root/분해문고/sample/_progress.md"
# 부정 fixture: 완료된 책은 '미완료'로 다시 보고되어서는 안 됨 (raw _progress.md는 영구적으로 오보할 것).
mkdir -p "$root/분해문고/done"
printf '# 깊이 있는 분해 진행 상황: done\n\n- 최종 상태: completed\n- schema_version: 2\n' > "$root/분해문고/done/_progress.md"

out_start="$(run_from_nested "$root" session-start.sh || true)"
echo "$out_start" | grep -q '현재 위치' || fail "session-start did not resolve active book from project root"
echo "$out_start" | grep -q '미완성 분해 문서' || fail "session-start did not resolve 분해문고 from project root"
echo "$out_start" | grep -q '1개의 미완성 분해 문서 있음' || fail "session-start counted completed 분해문 as unfinished"
if echo "$out_start" | grep -q '참고자료 패키지 누락'; then
  fail "session-start reported missing reference bundle after deployed refs were copied"
fi

out_pre="$(run_from_nested "$root" pre-compact.sh || true)"
echo "$out_pre" | grep -q 'Writing context: book/추적/컨텍스트.md' || fail "pre-compact did not resolve context from project root"

out_post="$(run_from_nested "$root" post-compact.sh || true)"
echo "$out_post" | grep -q 'Read book/추적/컨텍스트.md' || fail "post-compact did not resolve context from project root"

out_gaps="$(run_from_nested "$root" detect-story-gaps.sh || true)"
if [ -n "$out_gaps" ] && echo "$out_gaps" | grep -q "$root/nested"; then
  fail "detect-story-gaps leaked nested cwd paths"
fi
# session-start와 동일한 기준: 미완료 항목은 보고, 완료 항목은 보고하지 않음 (양쪽 각각 문단분해라이브러리/ 읽기, 각자 고정 필요).
echo "$out_gaps" | grep -q '문단분해 미완료: 문단분해라이브러리/sample/_progress.md' || fail "detect-story-gaps missed unfinished 문단분해"
if echo "$out_gaps" | grep -q '문단분해라이브러리/done/_progress.md'; then
  fail "detect-story-gaps counted completed 문단분해 as unfinished"
fi

fallback_root="$TMP_DIR/git-fallback"
mkdir -p "$fallback_root/book/추적" "$fallback_root/book/정문" "$fallback_root/book/대강"
setup_git_repo "$fallback_root"
copy_hooks "$fallback_root"
copy_agent_refs "$fallback_root"
write_sentinel "$fallback_root"
printf 'book\n' > "$fallback_root/.active-book"
printf '# 작성 진도\n' > "$fallback_root/book/추적/상하문.md"
out_fallback="$(run_from_nested_no_project_dir "$fallback_root" pre-compact.sh || true)"
echo "$out_fallback" | grep -q 'Writing context: book/추적/상하문.md' || fail "pre-compact did not resolve context via git root fallback without CLAUDE_PROJECT_DIR"

echo "  OK TS4 hook root resolution"

# TS5 — Sentinel / broken deployment diagnostics
broken_root="$TMP_DIR/broken-libs"
mkdir -p "$broken_root"
setup_git_repo "$broken_root"
copy_hooks "$broken_root"
write_sentinel "$broken_root"
rm -f "$broken_root/.claude/hooks/lib/sentinel.sh"
broken_out="$(run_from_nested "$broken_root" session-start.sh 2>&1 || true)"
echo "$broken_out" | grep -q 'hook 함수 라이브러리 누락' || fail "session-start did not explain missing hook libraries before sourcing"

bad_sentinel_root="$TMP_DIR/bad-sentinel"
mkdir -p "$bad_sentinel_root"
setup_git_repo "$bad_sentinel_root"
copy_hooks "$bad_sentinel_root"
cat > "$bad_sentinel_root/.story-deployed" <<'SENTINEL'
deployed_at: 2026-05-24T00:00:00Z
agents_version: 24
setup_skill_version: 1.2.7
resolver_strategy: project-local-skill-reference
references_dir: .claude/skills/story-setup/references/agent-references
SENTINEL
bad_sentinel_out="$(run_from_nested "$bad_sentinel_root" session-start.sh 2>&1 || true)"
echo "$bad_sentinel_out" | grep -q '누락된 target_cli' || fail "session-start did not warn for missing sentinel target_cli"
echo "$bad_sentinel_out" | grep -q '참조 자료 번들 누락 또는 비어 있음' || fail "session-start did not warn for missing deployed reference bundle"

stale_previous_root="$TMP_DIR/stale-previous"
mkdir -p "$stale_previous_root/.claude/skills/story-setup/references/agent-references"
setup_git_repo "$stale_previous_root"
copy_hooks "$stale_previous_root"
cat > "$stale_previous_root/.story-deployed" <<'SENTINEL'
deployed_at: 2026-05-24T00:00:00Z
agents_version: 23
setup_skill_version: 1.2.7
target_cli: claude-code
resolver_strategy: project-local-skill-reference
references_dir: .claude/skills/story-setup/references/agent-references
SENTINEL
stale_previous_out="$(run_from_nested "$stale_previous_root" session-start.sh 2>&1 || true)"
echo "$stale_previous_out" | grep -q 'v24 미만' || fail "session-start did not warn for agents_version 23 stale v24 deployment"

newer_project_root="$TMP_DIR/newer-project"
mkdir -p "$newer_project_root/.claude/skills/story-setup/references/agent-references"
setup_git_repo "$newer_project_root"
copy_hooks "$newer_project_root"
cat > "$newer_project_root/.story-deployed" <<'SENTINEL'
deployed_at: 2026-05-24T00:00:00Z
agents_version: 25
setup_skill_version: 1.3.0
target_cli: claude-code
resolver_strategy: project-local-skill-reference
references_dir: .claude/skills/story-setup/references/agent-references
SENTINEL
newer_project_out="$(run_from_nested "$newer_project_root" session-start.sh 2>&1 || true)"
echo "$newer_project_out" | grep -q '현재 hook 지원 v24보다 높음' || fail "session-start did not reject agents_version 25 downgrade"
echo "$newer_project_out" | grep -q '다운그레이드하지 마세요' || fail "session-start did not explain future-version safety"

mixed_version_root="$TMP_DIR/mixed-version"
mkdir -p "$mixed_version_root/.claude/skills/story-setup/references/agent-references"
setup_git_repo "$mixed_version_root"
copy_hooks "$mixed_version_root"
touch "$mixed_version_root/.claude/skills/story-setup/references/agent-references/dummy.md"
cat > "$mixed_version_root/.story-deployed" <<'SENTINEL'
deployed_at: 2026-05-24T00:00:00Z
agents_version: 24
setup_skill_version: 1.2.6
target_cli: claude-code
resolver_strategy: project-local-skill-reference
references_dir: .claude/skills/story-setup/references/agent-references
SENTINEL
mixed_version_out="$(run_from_nested "$mixed_version_root" session-start.sh 2>&1 || true)"
# agents_version은 유일한 런타임 만료 권위입니다; setup_skill_version이 뒤처져도 재배포를 트리거하지 않습니다(의도된 설계)
if echo "$mixed_version_out" | grep -q 'v24보다 낮음'; then
  fail "session-start incorrectly nagged 'v24보다 낮음' for current agents_version=24 just because setup_skill_version lags"
fi
if echo "$mixed_version_out" | grep -q '이 hook보다 높음'; then
  fail "session-start incorrectly nagged '상위 버전 필요' hook for current agents_version=24 just because setup_skill_version lags"
fi

# 다중 끝점 배포의 references_dir은 쉼표로 구분된 여러 경로입니다. 전체 문자열을 하나의 경로로 조회하면 세션을 시작할 때마다 누락된 것으로 잘못 보고되며,
# 반대로 실제로 누락된 경로를 놓치게 됩니다——양쪽 방향 모두 확인해야 합니다.
multi_end_root="$TMP_DIR/multi-end-refs"
mkdir -p "$multi_end_root/.claude/skills/story-setup/references/agent-references"
mkdir -p "$multi_end_root/.codex/skills/story-setup/references/agent-references"
setup_git_repo "$multi_end_root"
copy_hooks "$multi_end_root"
touch "$multi_end_root/.claude/skills/story-setup/references/agent-references/dummy.md"
touch "$multi_end_root/.codex/skills/story-setup/references/agent-references/dummy.md"
cat > "$multi_end_root/.story-deployed" <<'SENTINEL'
deployed_at: 2026-05-24T00:00:00Z
agents_version: 24
setup_skill_version: 1.2.7
target_cli: claude-code,codex
resolver_strategy: project-local-skill-reference
references_dir: .claude/skills/story-setup/references/agent-references,.codex/skills/story-setup/references/agent-references
SENTINEL
multi_end_out="$(run_from_nested "$multi_end_root" session-start.sh 2>&1 || true)"
if echo "$multi_end_out" | grep -q '참고 자료 패키지가 누락되었거나 비어 있음'; then
  fail "session-start falsely reported missing references for a complete multi-end deployment"
fi

rm -rf "$multi_end_root/.codex"
multi_end_partial_out="$(run_from_nested "$multi_end_root" session-start.sh 2>&1 || true)"
echo "$multi_end_partial_out" | grep -q '참고 자료 패키지가 누락되었거나 비어 있음' \
  || fail "session-start did not warn when one end of a multi-end references_dir is missing"
echo "$multi_end_partial_out" | grep -q '\.codex/skills/story-setup/references/agent-references' \
  || fail "session-start did not name the missing end in a multi-end references_dir"
if echo "$multi_end_partial_out" | grep -q '\.claude/skills/story-setup/references/agent-references,'; then
  fail "session-start reported the whole comma-joined references_dir instead of only the missing end"
fi

echo "  OK TS5 sentinel diagnostics"

# TS6 — Short project non-mutation
short_root="$TMP_DIR/short-project"
mkdir -p "$short_root/story"
setup_git_repo "$short_root"
copy_hooks "$short_root"
write_sentinel "$short_root"
printf 'story\n' > "$short_root/.active-book"
cat > "$short_root/story/본문.md" <<'TXT'
본문
TXT
run_from_nested "$short_root" session-end.sh >"$TMP_DIR/story-session-end.out" 2>&1 || true
[ ! -d "$short_root/story/추적" ] || fail "session-end created 추적/ for short project without opt-in"
(cd "$short_root/nested/a/b" && CLAUDE_PROJECT_DIR="$short_root" STORY_SESSION_LOG=1 bash "$short_root/.claude/hooks/session-end.sh") >"$TMP_DIR/story-session-end-opt.out" 2>&1 || true
[ ! -d "$short_root/story/추적" ] || fail "session-end created 추적/ for short project even with STORY_SESSION_LOG=1"
echo "  OK TS6 short project non-mutation"

# TS7 — Commit hook self-gating
commit_root="$TMP_DIR/commit-hook"
mkdir -p "$commit_root/book/본문" "$commit_root/book/설정" "$commit_root/short"
setup_git_repo "$commit_root"
copy_hooks "$commit_root"
cat > "$commit_root/book/본문/제1장.md" <<'TXT'
나이: 18
TXT
cat > "$commit_root/short/본문.md" <<'TXT'
키: 180
TXT
cat > "$commit_root/book/설정/캐릭터.md" <<'TXT'
역할 설정
TXT
git -C "$commit_root" add "book/정문/제1장.md" "short/정문.md" "book/설정/역할.md"
for cmd in \
  'git commit -m test' \
  'git -c user.name=x commit -m test' \
  "git -C $commit_root commit -m test" \
  'command git commit -m test' \
  'env X=1 git commit -m test' \
  'git add .; git commit -m test' \
  $'git add .\ngit commit -m test' \
  '(git commit -m test)' \
  'if true; then git commit -m test; fi' \
  'noglob git commit -m test'; do
  assert_commit_warns "$commit_root" "$cmd" "$cmd"
done
for cmd in 'echo git commit docs' 'grep "git commit" file'; do
  non_commit_out="$(run_commit_hook_command "$commit_root" "$cmd")"
  [ -z "$non_commit_out" ] || fail "validate-story-commit warned for non-commit command '$cmd': $non_commit_out"
done
stdin_out="$(cd "$commit_root" && unset STORY_COMMIT_COMMAND CLAUDE_TOOL_INPUT && printf '%s' '{"tool_name":"Bash","tool_input":{"command":"git commit -m test"}}' | CLAUDE_PROJECT_DIR="$commit_root" bash .claude/hooks/validate-story-commit.sh 2>&1 || true)"
echo "$stdin_out" | grep -q 'Story Commit Warnings' || fail "validate-story-commit did not read stdin hook payload"
echo "$stdin_out" | grep -q 'short/정문.md' || fail "validate-story-commit did not inspect short-story 정문.md"
echo "$stdin_out" | grep -q 'book/설정/역할.md' || fail "validate-story-commit did not inspect staged setting markdown"

mono_root="$TMP_DIR/mono-root"
project_root="$mono_root/story-project"
mkdir -p "$project_root/book/정문"
setup_git_repo "$mono_root"
copy_hooks "$project_root"
cat > "$project_root/book/정문/제1장.md" <<'TXT'
신장:181
TXT
git -C "$mono_root" add "story-project/book/정문/제1장.md"
mono_out="$(cd "$project_root" && CLAUDE_PROJECT_DIR="$project_root" STORY_COMMIT_COMMAND='git commit -m test' bash .claude/hooks/validate-story-commit.sh 2>&1 || true)"
echo "$mono_out" | grep -q '정문하드코딩역할속성' || fail "validate-story-commit missed staged files when CLAUDE_PROJECT_DIR differs from git root"
echo "  OK TS7 commit hook self-gating"

# TS8 — detect-story-gaps multi-book traversal
multi_root="$TMP_DIR/multi-book"
mkdir -p "$multi_root/long/추적" "$multi_root/long/정문" "$multi_root/short"
setup_git_repo "$multi_root"
copy_hooks "$multi_root"
printf 'long\n' > "$multi_root/.active-book"
printf '장편 본문\n' > "$multi_root/long/본문/제1장.md"
printf '단편 본문\n' > "$multi_root/short/본문.md"
multi_out="$(run_from_nested "$multi_root" detect-story-gaps.sh || true)"
echo "$multi_out" | grep -q '^검사: long$' || fail "detect-story-gaps did not inspect long project when .active-book is set"
echo "$multi_out" | grep -q '^검사: short$' || fail "detect-story-gaps did not inspect short project alongside long project"
long_count="$(printf '%s\n' "$multi_out" | grep -c '^검사: long$' || true)"
[ "$long_count" -eq 1 ] || fail "detect-story-gaps reported long project $long_count times; expected exactly once"
echo "  OK TS8 multi-book gap detection"

# TS9 — Settings JSON remains valid
python3 -m json.tool "$SETTINGS_FILE" >/dev/null
echo "  OK TS9 settings JSON"

# TS10 — Version threshold + deployed-behavior anchors
# 「실행하면 깨지는」 것만 고정: agents_version 임계값은 파일 간에 정렬되어야 하고, 사용자에게 배포되는
# agent 템플릿은 핵심 동작 규칙을 유지해야 합니다. 이전에는 「UPGRADING.md/README에 특정 문구를 반드시 작성」
# 같은 문서 완전성 검증이 섞여 있었습니다. 한 단어만 바꿔도 실패하고, 측정 대상이 동작이 아닌 표현이었으므로, check-story-long-write-contract.sh와
# 함께 삭제했습니다. UPGRADING 보완 여부는 릴리스 체크리스트와 담당자가 관리하며, CI로 표현을 고정하지 않습니다.
assert_grep 'AGENTS_VERSION.*-lt 24|AGENTS_VERSION" -lt 24' "$HOOKS_DIR/session-start.sh" "session-start must warn for agents_version 23 under v24 deployment"
assert_grep 'AGENTS_VERSION.*-gt 24|AGENTS_VERSION" -gt 24' "$HOOKS_DIR/session-start.sh" "session-start must reject agents_version 25 downgrade"
assert_grep 'agents_version.*24보다 작음|버전 < 24' "$SKILL_DIR/SKILL.md" "story-setup redeploy branch must treat agents_version 23 as stale"
assert_grep 'agents_version.*24보다 큼 `24`' "$SKILL_DIR/SKILL.md" "story-setup must stop before downgrading a newer deployment"
assert_grep 'Notice: agents bundle 버전 불일치' "$REPO_ROOT/skills/story-review/SKILL.md" "story-review must surface an agents_version mismatch"
assert_grep '24보다 클 때 추가 알림: 먼저 oh-story-claudecode 업데이트' "$REPO_ROOT/skills/story-review/SKILL.md" "story-review must tell newer deployments to update the package first"
assert_grep '^version:[[:space:]]*1\.2\.7$' "$SKILL_FILE" "story-setup frontmatter must match the deployed setup version"

# Phase 1 자가진단의 디렉토리 목록은 하드코딩되어 있으며, 실제 references/ 하위 디렉토리 집합과 일치해야 합니다.
# 하나를 빠뜨리면 → 불완전한 패키지를 감지하지 못하고, 목록에 삭제된 디렉토리가 있으면 → 정상적인 패키지가 손상된 것으로 판단되어 fail-closed로 모든 배포가 중단됩니다.
selfcheck_line="$(grep -n '먼저 자가검사 참조 디렉토리' "$SKILL_FILE" | head -1 | cut -d: -f1)"
[ -n "$selfcheck_line" ] || fail "story-setup Phase 1 reference self-check paragraph not found"
selfcheck_text="$(sed -n "${selfcheck_line}p" "$SKILL_FILE")"
for ref_dir in "$SKILL_DIR"/references/*/; do
  ref_name="$(basename "$ref_dir")"
  case "$selfcheck_text" in
    *"\`$ref_name\`"*) ;;
    *) fail "story-setup Phase 1 self-check list is missing reference dir: $ref_name" ;;
  esac
done
ref_dir_count="$(find "$SKILL_DIR/references" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')"
[ "$ref_dir_count" -eq 8 ] || fail "story-setup references/ now has $ref_dir_count subdirs (expected 8); update the Phase 1 self-check list and this assertion"
assert_grep '스토리/감정모듈\.md.*missing_primary_contract|missing_primary_contract.*스토리/감정모듈\.md' "$SKILL_DIR/references/templates/agents/story-explorer.md" "story-explorer must require the current emotion-module artifact"
assert_grep '스토리/리듬\.md.*missing_primary_contract|missing_primary_contract.*스토리/리듬\.md' "$SKILL_DIR/references/templates/agents/story-explorer.md" "story-explorer must require the current rhythm artifact"
assert_no_grep 'legacy_deconstruction|contract_version.*legacy|pre-v12' "$SKILL_DIR/references/templates/agents/story-explorer.md" "story-explorer must not keep legacy benchmark branches"
assert_grep 'missing_primary_contract: true|missing_primary_contract": true' "$SKILL_DIR/references/templates/agents/story-explorer.md" "story-explorer must emit missing_primary_contract for broken canonical artifacts"
assert_grep 'repair_action.*Stage 3|Stage 3.*repair_action|재실행 /story-long-analyze Stage 3' "$SKILL_DIR/references/templates/agents/story-explorer.md" "story-explorer must provide a repair action instead of silent fallback"
assert_grep 'missing_primary_contract' "$REPO_ROOT/skills/story-long-write/SKILL.md" "story-long-write must not silently fallback for missing primary artifacts"
assert_grep '내용 개괄(5단계식)|플롯 배치(다중선)|인물관계 및 등장순서|엔딩 설정 및 훅' "$SKILL_DIR/references/templates/agents/story-architect.md" "story-architect must output v13 chapter blueprint fields"
assert_grep '논리선|인물관계 변화|행동 비용(생략 가능)/수익 귀속|엔딩 설정' "$SKILL_DIR/references/templates/agents/consistency-checker.md" "consistency-checker must consume current outline blueprint fields"
assert_grep '톤 구두점 계층' "$SKILL_DIR/references/templates/agents/narrative-writer.md" "narrative-writer must enforce v13 tone punctuation"
assert_grep '사용 금지.*……|사용하지 말 것.*……|보존 금지.*……|남김 금지.*……' "$SKILL_DIR/references/templates/agents/narrative-writer.md" "narrative-writer must reject ellipsis pause punctuation"
assert_grep '사용 금지.*——|사용하지 말 것.*——|보존 금지.*——|남김 금지.*——' "$SKILL_DIR/references/templates/agents/narrative-writer.md" "narrative-writer must reject dialogue dash exception"
assert_grep '어조 표점 계열' "$AGENT_REFS_DIR/format-and-structure.md" "agent references must include v13 tone punctuation format rules"
assert_grep '사용하지 않음.*……|사용 금지.*……|유지하지 않음.*……|남기지 않음.*……' "$AGENT_REFS_DIR/format-and-structure.md" "agent references must forbid ellipsis pause punctuation"
assert_grep '사용하지 않음.*——|사용 금지.*——|유지하지 않음.*——|남기지 않음.*——|본문과 대사 모두 금지.*——' "$AGENT_REFS_DIR/format-and-structure.md" "agent references must forbid dialogue dash exception"
assert_grep '높은 신뢰도 부정 서두 후 긍정 반전 금지|높은 신뢰도 부정 반전 문형 금지' "$SKILL_DIR/references/templates/agents/narrative-writer.md" "narrative-writer must hard-ban high-confidence not-then-is flips"
assert_grep '단락 간.*A가 아님 / B도 아님 / 오직 C일 뿐.*(의미 재검토만 수행|advisory)' "$SKILL_DIR/references/templates/agents/narrative-writer.md" "narrative-writer must treat cross-paragraph negation as advisory"
assert_grep '설정 해제, 의혹 제거 또는 감정 진행 시 유지 가능|설정 해제, 의혹 제거, 감정 진행 등의 기능 시 유지 가능' "$SKILL_DIR/references/templates/agents/narrative-writer.md" "narrative-writer must preserve functional cross-paragraph negation"
assert_grep 'X에 대해 X하지 않는, 어떻게 X하는' "$SKILL_DIR/references/templates/agents/narrative-writer.md" "narrative-writer must review formulaic dialogue too"
assert_grep 'check-ai-patterns\.js --check' "$SKILL_DIR/references/templates/agents/narrative-writer.md" "narrative-writer must require detector rescan handoff"
assert_grep '직접 호출.*자동으로 본문 작성에 진입하면 안 됨|자동으로 본문 작성에 진입하면 안 됨.*직접 호출' "$REPO_ROOT/skills/story-long-write/SKILL.md" "story-long-write bare invocation must not auto-write prose"
assert_grep '기존 프로젝트를 일일 3화 기본값으로 설정하면 안 됨|일일 3화 기본값' "$REPO_ROOT/skills/story-long-write/SKILL.md" "story-long-write must not default existing projects to daily 3 chapters on bare invocation"
assert_grep '기본적으로 상세 개요 전달에서 정지|기본적으로 정지.*Phase 1→3' "$REPO_ROOT/skills/story-long-write/SKILL.md" "story-long-write opening flow must stop after outline by default"
assert_grep '현재 회차 K(최대 3장)을 거친 후 반드시 Step 3/4 마무리로 진입하고 중지|최대 3장.*마무리로 중지' "$REPO_ROOT/skills/story-long-write/references/workflow-daily.md" "daily workflow must stop after bounded batch"
assert_grep '세부 대강|outline_underfilled|임의로 스토리를 창작하지 말 것' "$SKILL_DIR/references/templates/agents/narrative-writer.md" "narrative-writer must enforce outline boundary and report outline_underfilled"
assert_grep 'outline_underfilled' "$SKILL_DIR/references/opencode/agents/narrative-writer.md" "opencode narrative-writer must inherit outline_underfilled boundary"
assert_grep 'outline_underfilled' "$SKILL_DIR/references/codex/agents/narrative-writer.toml" "codex narrative-writer must inherit outline_underfilled boundary"
assert_grep '후속 작성 진입 순서 가져오기|권장 순서.*story-setup' "$REPO_ROOT/skills/story-import/SKILL.md" "story-import must answer setup-vs-import order before asking for source"
echo "  OK TS10 version + behavior anchors"

# TS11 — Outline-before-prose write guard (BLOCKING PreToolUse hook)
guard_root="$TMP_DIR/outline-guard"
mkdir -p "$guard_root/book/본문" "$guard_root/book/대강" "$guard_root/book/설정" \
         "$guard_root/short" "$guard_root/docs" \
         "$guard_root/impbook/본문" "$guard_root/텍스트분해라이브러리/impbook" \
         "$guard_root/impshort" "$guard_root/분해문서함/impshort"
setup_git_repo "$guard_root"
copy_hooks "$guard_root"
assert_file "$guard_root/.claude/hooks/guard-outline-before-prose.sh"

run_guard() {
  # $1 = file_path ; prints the hook exit code (0 allow, 2 block)
  local fp="$1" ec=0
  printf '{"tool_name":"Write","tool_input":{"file_path":"%s","content":"x"}}' "$fp" \
    | CLAUDE_PROJECT_DIR="$guard_root" bash "$guard_root/.claude/hooks/guard-outline-before-prose.sh" >/dev/null 2>&1 || ec=$?
  printf '%s' "$ec"
}

# 장편 승인 흐름: 상세 개요 없으면 차단 / 있으면 허용 / 장 번호 0 채우기 허용
[ "$(run_guard 'book/정문/제1장_시작.md')" = "2" ] || fail "guard did not BLOCK long prose when 상세개요 missing"
: > "$guard_root/book/개요/상세개요_제1장.md"
# 상세개요가 모두 준비되면 추적 체크포인트도 통과해야 함 (이슈 #305부터 Claude 측도 같은 검사 있음, 다른 세 엔드포인트와 순서 동일).
# 본 섹션에서 테스트하는 것은 세부 게이트와 경로 분류이며, 추적 게이트가 아니므로 먼저 유효한 state를 배치하여 추적 차원을 고정합니다.
# last_committed는 본 섹션의 모든 테스트 케이스 장 번호보다 큰 값을 사용합니다. 장 번호가 이미 추적 범위 내에 있으면 순서 검증을 건너뜁니다.
# 따라서 1/7/123/124 장은 모두 세부 게이트로만 판정됩니다. 순서 검증 자체는 test-prose-net-parity.sh Part F
# 의 시나리오 매트릭스로 커버되며, 여기서는 반복하지 않습니다.
mkdir -p "$guard_root/book/추적"
printf '{"schema_version":4,"state_revision":0,"last_committed_chapter":200}\n' > "$guard_root/book/tracking/_tracking-state.json"
printf '> 상태 수정본: 0.\n' > "$guard_root/book/tracking/context.md"
[ "$(run_guard 'book/body/chapter1_beginning.md')" = "0" ] || fail "guard wrongly blocked long prose when outline present"
# tracking gate 자체: state 이동 시 차단(Claude 측에서 이전에 자동으로 허용, 추적 없는 본문 작성)
mv "$guard_root/book/tracking/_tracking-state.json" "$guard_root/book/tracking/_state.bak"
[ "$(run_guard 'book/본문/제1장_시작.md')" = "2" ] || fail "추적 상태가 없을 때 guard가 긴 산문을 차단하지 않음"
mv "$guard_root/book/추적/_state.bak" "$guard_root/book/추적/_tracking-state.json"
[ "$(run_guard 'book/본문/제001장_시작.md')" = "0" ] || fail "guard가 장 번호 영점 패딩을 허용하지 않음 (제001장 vs 세목_제1장)"
: > "$guard_root/book/개요/소절개요_제7장_격변.md"
[ "$(run_guard 'book/정문/제7장_x.md')" = "0" ] || fail "guard가 제목 접미사가 있는 소절개요를 허용하지 않음 (소절개요_제7장_격변.md)"
# 단편 인증 흐름: 설정.md 신호 있음 + 소절 개요 부재 -> 차단; 소절 개요 추가 -> 통과
: > "$guard_root/short/설정.md"
[ "$(run_guard 'short/정문.md')" = "2" ] || fail "guard did not BLOCK short prose when 소절개요.md missing"
: > "$guard_root/short/소절개요.md"
[ "$(run_guard 'short/정문.md')" = "0" ] || fail "guard wrongly blocked short prose when 소절개요.md present"
# 작품이 아닌 파일 / 단편 프로젝트 신호 없음 -> 통과 (잘못 차단하기보다 빠뜨리는 것이 낫다)
[ "$(run_guard 'book/설정/캐릭터.md')" = "0" ] || fail "guard wrongly blocked a non-prose file"
[ "$(run_guard 'docs/본문.md')" = "0" ] || fail "guard wrongly blocked a non-story 본문.md (no 설정.md signal)"
# 이미 존재하는 본문 -> 통과 (계속 집필/수정/AI 스타일 제거)
: > "$guard_root/book/본문/9장_x.md"
[ "$(run_guard 'book/정문/제9장_x.md')" = "0" ] || fail "guard wrongly blocked rewrite of an existing prose file"
# story-import 마이그레이션 흐름: 분산문고/{서명}/ 소스 존재 -> 정문이 개요/소절개요 마이그레이션보다 먼저, 허용
[ "$(run_guard 'impbook/정문/제1장_x.md')" = "0" ] || fail "guard wrongly blocked story-import LONG prose migration (분산문고 source present)"
: > "$guard_root/impshort/설정.md"
[ "$(run_guard 'impshort/정문.md')" = "0" ] || fail "guard wrongly blocked story-import SHORT prose migration (분산문고 source present)"
echo "  OK TS11 outline-before-prose guard"

# TS11b — 가드가 node 없이 실행될 때 순수 bash 추출로 폴백해야 하며, 여전히 exit 2를 반환해야 함(fail-open 불가).
# 공식 권장사항은 이제 네이티브 바이너리로 Claude Code를 설치(Node 미포함)하며, npm 설치 방식만 node를 포함함. 기존 구현은 node만 감지했고,
# 감지하지 못하면 통과시켜 "컨텍스트 누락으로 본문 작성 실패"를 조용히 통과시킴(#243 회귀). 항상 0이 아닌 값을 반환하는 가짜 node 시뮬레이터로
# "node 사용 불가" 상태를 시뮬레이션하며, 나머지 도구(sed/grep/bash)는 PATH에 남음. 시뮬레이터가 실제 node를 차단하지 못하면(일부 Windows 호스트)
# 건너뜀. 환경으로 인한 거짓 실패를 방지하기 위함.
nonode_shim="$TMP_DIR/nonode-shim"
mkdir -p "$nonode_shim"
printf '#!/bin/sh\nexit 1\n' > "$nonode_shim/node"
chmod +x "$nonode_shim/node"
run_guard_nonode() {
  local fp="$1" ec=0
  printf '{"tool_name":"Write","tool_input":{"file_path":"%s","content":"x"}}' "$fp" \
    | CLAUDE_PROJECT_DIR="$guard_root" PATH="$nonode_shim:$PATH" \
      bash "$guard_root/.claude/hooks/guard-outline-before-prose.sh" >/dev/null 2>&1 || ec=$?
  printf '%s' "$ec"
}
if ! PATH="$nonode_shim:$PATH" node -e "" >/dev/null 2>&1; then
  # 세부 개요 누락 -> 여전히 차단해야 함(bash 최종 폴백 처리로 대상 경로 해석 후 정상적으로 exit 2)
  [ "$(run_guard_nonode 'book/정문/제123장_무개요.md')" = "2" ] \
    || fail "guard fail-OPEN without node (regression #243): 세부 개요 누락 시 정문 작성 반드시 차단(bash 최종 폴백)"
  : > "$guard_root/book/개요/세부개요_제123장.md"
  # 세부 개요 있음 -> 허용(bash 최종 폴백이 오판하지 않음)
  [ "$(run_guard_nonode 'book/정문/제123장_무강.md')" = "0" ] \
    || fail "guard(no-node) wrongly blocked long prose when 세강 present (bash 후폐)"
  # 비정문 목표 -> 통과
  [ "$(run_guard_nonode 'book/설정/역할.md')" = "0" ] \
    || fail "guard(no-node) wrongly blocked a non-prose file (bash 후폐)"
  echo "  OK TS11b outline guard fail-closed without node"
else
  echo "  SKIP TS11b (가짜 node 쉐이드가 실제 node를 제대로 가리지 못함, no-node 회귀 테스트 건너뜀)"
fi

# TS11c — node가 존재하지만 추출 실패 (구 node가 node: 접두사 미인식 / 배포 핵심 손상으로 탐지 통과 후 스크립트 실행 시 오류 발생)시,
# 가드 차단이 순수 bash로 폴백되어야 하며, exit 2를 반환해야 함. 기존 구현은 if/else 사용: node 탐지 성공 후 node 분기만 실행되고, 추출 실패 시 통과 허용됨.
# 이는 #243 리뷰에서 발견한 두 번째 fail-open 케이스. 쉐이드는 「node -e ''는 0 반환, 실제 스크립트는 0이 아닌 값 반환」으로 손상된 node 시뮬레이션;
# 해석된 node가 쉐이드임을 확인할 때만 실행 (그렇지 않으면 실제 node가 잘못된 이유로 단언을 통과시킴).
brokennode_shim="$TMP_DIR/brokennode-shim"
mkdir -p "$brokennode_shim"
printf '#!/bin/sh\n[ "$1" = "-e" ] && exit 0\nexit 1\n' > "$brokennode_shim/node"
chmod +x "$brokennode_shim/node"
run_guard_brokennode() {
  local fp="$1" ec=0
  printf '{"tool_name":"Write","tool_input":{"file_path":"%s","content":"x"}}' "$fp" \
    | CLAUDE_PROJECT_DIR="$guard_root" PATH="$brokennode_shim:$PATH" \
      bash "$guard_root/.claude/hooks/guard-outline-before-prose.sh" >/dev/null 2>&1 || ec=$?
  printf '%s' "$ec"
}
resolved_node="$(PATH="$brokennode_shim:$PATH" bash -c 'command -v node' 2>/dev/null || true)"
if [ "$resolved_node" = "$brokennode_shim/node" ]; then
  # node 감지는 통과했지만 CLI 추출에서 오류 발생 -> 세부 개요가 없어도 여전히 차단해야 함(bash 폴백으로 대상 경로 파싱)
  [ "$(run_guard_brokennode 'book/정문/제124장_손상된node.md')" = "2" ] \
    || fail "guard fail-OPEN with broken node (regression #243): node가 있지만 추출 실패 시 bash로 여전히 차단되어야 함"
  : > "$guard_root/book/대강/세부개요_제124장.md"
  # 세부 개요가 있음 -> 통과(bash 폴백이 오탐을 하지 않음)
  [ "$(run_guard_brokennode 'book/정문/124장_손상된노드.md')" = "0" ] \
    || fail "guard(broken-node) wrongly blocked long prose when 세부강요 present (bash 폴백)"
  echo "  OK TS11c outline guard fail-closed when node present-but-broken"
else
  echo "  SKIP TS11c (fake node shim failed to mask real node, skipping broken-node regression)"
fi

# TS12 — Agents-pending-restart one-shot confirmation
restart_root="$TMP_DIR/restart-flag"
mkdir -p "$restart_root/.claude"
setup_git_repo "$restart_root"
copy_hooks "$restart_root"
copy_agent_refs "$restart_root"
write_sentinel "$restart_root"
touch "$restart_root/.claude/.agents-pending-restart"
restart_out="$(run_from_nested "$restart_root" session-start.sh || true)"
echo "$restart_out" | grep -q '현재 등록 가능함' || fail "session-start did not confirm agents registered after restart flag"
[ ! -f "$restart_root/.claude/.agents-pending-restart" ] || fail "session-start did not clear the one-shot .agents-pending-restart flag"
echo "  OK TS12 restart-flag confirmation"

echo ""
echo "OK: story-setup deployment checks passed"
