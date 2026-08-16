#!/usr/bin/env bash
# test-codex-hooks.sh — synthetic Codex hook contract tests.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

HOOKS_SRC="$REPO_ROOT/skills/story-setup/references/codex/hooks"
HOOK_SRC="$HOOKS_SRC/story_codex_hook.py"
ROOT="$TMP_DIR/story-project"
HOOK="$ROOT/.codex/hooks/story_codex_hook.py"
mkdir -p "$ROOT/.codex/hooks"
cp "$HOOK_SRC" "$HOOK"
cp "$HOOKS_SRC/run-story-hook.sh" "$HOOKS_SRC/run-story-hook.cmd" "$ROOT/.codex/hooks/"
chmod +x "$HOOK"

git -C "$ROOT" init -q
git -C "$ROOT" config user.email codex-hook@example.invalid
git -C "$ROOT" config user.name codex-hook-test

run_hook() {
  local event="$1" payload="$2"
  (cd "$ROOT" && printf '%s' "$payload" | CODEX_PROJECT_DIR="$ROOT" python3 "$HOOK" "$event")
}

# Read the hook's stdout as UTF-8 bytes (not locale-decoded text): the hook emits
# UTF-8 Chinese deny reasons, and Windows Python defaults stdin to the ANSI code page,
# which would raise UnicodeDecodeError here even when the hook output is correct.
assert_json() {
  python3 -c 'import json,sys; json.loads(sys.stdin.buffer.read().decode("utf-8"))' >/dev/null
}

assert_denied() {
  local out="$1" label="$2"
  printf '%s' "$out" | assert_json || fail "$label did not emit valid JSON: $out"
  printf '%s' "$out" | python3 -c 'import json,sys; o=json.loads(sys.stdin.buffer.read().decode("utf-8")); h=o.get("hookSpecificOutput",{}); assert h.get("hookEventName")=="PreToolUse" and h.get("permissionDecision")=="deny" and h.get("permissionDecisionReason")' || fail "$label was not denied: $out"
}

assert_additional_context() {
  local out="$1" label="$2"
  printf '%s' "$out" | assert_json || fail "$label did not emit valid JSON: $out"
  printf '%s' "$out" | python3 -c 'import json,sys; o=json.loads(sys.stdin.buffer.read().decode("utf-8")); h=o.get("hookSpecificOutput",{}); assert h.get("additionalContext")' || fail "$label missing additionalContext: $out"
}

assert_empty() {
  local out="$1" label="$2"
  [ -z "$out" ] || fail "$label expected empty allow output, got: $out"
}

write_clean_state() {
  mkdir -p "$1/추적"
  printf '{"schema_version":4,"state_revision":0,"last_committed_chapter":%s}\n' "${2:-0}" > "$1/추적/_tracking-state.json"
  printf '%s\n' '> 상태 수정: 0' > "$1/추적/컨텍스트.md"
}

echo "Codex hook synthetic tests"
echo "=========================="
echo "Fixture: $ROOT"

mkdir -p "$ROOT/book/본문" "$ROOT/book/개요" "$ROOT/book/설정"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Bash","tool_input":{"command":"cat > book/본문/제001장_시작.md <<EOF\n본문\nEOF"}}')"
assert_denied "$out" "long prose without outline"
: > "$ROOT/book/개요/상세_개요_제1장.md"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Bash","tool_input":{"command":"cat > book/본문/제001장_시작.md <<EOF\n본문\nEOF"}}')"
assert_denied "$out" "long prose without tracking metadata"
printf '%s' "$out" | grep -q '_tracking-state.json 누락됨' || fail "missing tracking denial did not explain re-import/init: $out"
write_clean_state "$ROOT/book"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Bash","tool_input":{"command":"cat > book/본문/제001장_시작.md <<EOF\n본문\nEOF"}}')"
assert_empty "$out" "long prose with outline"

mkdir -p "$ROOT/bare/본문" "$ROOT/cwd-book/본문" "$ROOT/cwd-book/개요"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"bare/본문/제1장_첫_장.md"}}')"
assert_denied "$out" "bare long project without scaffolding"
relative_payload="$(python3 - "$ROOT/cwd-book" <<'PY'
import json, sys
from pathlib import Path
payload = {"cwd": str(Path(sys.argv[1]).resolve()), "tool_name": "Write", "tool_input": {"file_path": "본문/제8장_상대.md"}}
sys.stdout.buffer.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
PY
)"
out="$(run_hook pre-tool-prose-guard "$relative_payload")"
assert_denied "$out" "relative prose target from hook cwd"
printf '%s' "$out" | grep -q 'cwd-book/개요' || fail "relative target was not resolved from hook cwd: $out"
: > "$ROOT/cwd-book/개요/상세_개요_제8장.md"
out="$(run_hook pre-tool-prose-guard "$relative_payload")"
assert_denied "$out" "relative prose target without tracking metadata"
write_clean_state "$ROOT/cwd-book" 7
out="$(run_hook pre-tool-prose-guard "$relative_payload")"
assert_empty "$out" "relative prose target with cwd-local outline"

out="$(run_hook pre-tool-prose-guard '{"tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Add File: book/본문/제002장_새로운_국면.md\n+본문\n*** End Patch\n"}}')"
assert_denied "$out" "apply_patch long prose without outline"
: > "$ROOT/book/본문/제009장_이미_존재함.md"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"book/본문/제009장_이미_존재함.md","content":"원고 수정"}}')"
assert_empty "$out" "existing prose rewrite"
printf '%s\n' '{"schema_version":4,"state_revision":1,"last_committed_chapter":0}' > "$ROOT/book/추적/_tracking-state.json"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"book/본문/제009장_이미_존재함.md","content":"원고 수정"}}')"
assert_denied "$out" "existing prose rewrite with mismatched derived state"
printf '%s' "$out" | grep -q 'mode=revision 트랜잭션 재구축 파생 뷰' || fail "state mismatch denial missed retry action: $out"
write_clean_state "$ROOT/book"

mkdir -p "$ROOT/short"
: > "$ROOT/short/설정.md"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"short/본문.md","content":"본문"}}')"
assert_denied "$out" "short prose without outline"
: > "$ROOT/short/소절_개요.md"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"short/본문.md","content":"본문"}}')"
assert_empty "$out" "short prose with outline"

mkdir -p "$ROOT/impbook/본문" "$ROOT/분해저장소/impbook"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"impbook/본문/제1장_도입.md","content":"본문"}}')"
assert_empty "$out" "story-import long migration"
mkdir -p "$ROOT/impbook/개요" "$ROOT/impbook/추적"
: > "$ROOT/impbook/개요/상세_개요_제2장.md"
printf '%s\n' '{"schema_version":4,"state_revision":1,"last_committed_chapter":1}' > "$ROOT/impbook/추적/_tracking-state.json"
printf '%s\n' '> 상태 수정: 0' > "$ROOT/impbook/추적/컨텍스트.md"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"impbook/본문/제2장_도입_후속.md","content":"본문"}}')"
assert_denied "$out" "imported project must not permanently bypass invalid tracking guard"

echo "  OK outline-before-prose guard"

# A Bash command that only MENTIONS a prose path (grep / echo arg / doc) must not be treated
# as a write target; only real write ops (redirection / tee / touch / cp|mv dest) count.
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Bash","tool_input":{"command":"grep -n book/본문/제7장.md notes.md"}}')"
assert_empty "$out" "command merely mentioning prose path is not denied"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Bash","tool_input":{"command":"echo book/본문/제7장.md >> changelog.md"}}')"
assert_empty "$out" "prose path as echo arg before non-prose redirect is not denied"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Bash","tool_input":{"command":"echo x | tee book/본문/제7장_x.md"}}')"
assert_denied "$out" "tee write to prose without outline is still denied"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Bash","tool_input":{"command":"touch book/본문/제7장_x.md"}}')"
assert_denied "$out" "touch write to prose without outline is denied"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Bash","tool_input":{"command":"cp draft.md book/본문/제7장_x.md"}}')"
assert_denied "$out" "cp write to prose without outline is denied"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Bash","tool_input":{"command":"cp draft.md book/본문/제7장_x.md 2>/dev/null"}}')"
assert_denied "$out" "cp write with trailing redirect is denied (dest still parsed)"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Bash","tool_input":{"command":"cp book/본문/제1장.md backup.md"}}')"
assert_empty "$out" "cp FROM a prose file (source, not dest) is not denied"

echo "  OK prose command-scan precision"

cat > "$ROOT/book/본문/제1장.md" <<'TXT'
나이: 18
TXT
cat > "$ROOT/short/본문.md" <<'TXT'
신장: 180
TXT
git -C "$ROOT" add book/본문/제1장.md short/본문.md
out="$(run_hook pre-tool-commit-advisory '{"tool_name":"Bash","tool_input":{"command":"git commit -m test"}}')"
assert_additional_context "$out" "commit advisory"
echo "$out" | grep -q '본문 하드코딩 캐릭터 속성' || fail "commit advisory did not inspect staged markdown"
echo "$out" | grep -q 'short/본문.md' || fail "commit advisory missed short prose"
out="$(run_hook pre-tool-commit-advisory '{"tool_name":"Bash","tool_input":{"command":"echo git commit docs"}}')"
assert_empty "$out" "non-commit bash command"

echo "  OK commit advisory"

mkdir -p "$ROOT/book/추적"
cat > "$ROOT/.story-deployed" <<'TXT'
deployed_at: 2026-06-25T00:00:00Z
agents_version: 19
setup_skill_version: 1.2.7
target_cli: codex
resolver_strategy: project-local-skill-reference
references_dir: .codex/skills/story-setup/references/agent-references
TXT
printf 'book\n' > "$ROOT/.active-book"
printf '%s\n' '> 상태 수정: 0' > "$ROOT/book/추적/컨텍스트.md"
out="$(run_hook session-start '{"hook_event_name":"SessionStart"}')"
assert_additional_context "$out" "session-start context"
echo "$out" | grep -q 'Active book' || fail "session-start did not mention active book"
printf '%s\n' '{"schema_version":4,"state_revision":1,"last_committed_chapter":0}' > "$ROOT/book/추적/_tracking-state.json"
out="$(run_hook session-start '{"hook_event_name":"SessionStart"}')"
assert_additional_context "$out" "session-start tracking mismatch warning"
echo "$out" | grep -q '상태 수정' || fail "session-start missed tracking revision mismatch: $out"
write_clean_state "$ROOT/book"
out="$(run_hook pre-compact '{"hook_event_name":"PreCompact"}')"
printf '%s' "$out" | assert_json || fail "pre-compact invalid JSON: $out"
echo "$out" | grep -q 'Story Compact Summary' || fail "pre-compact missing summary"
out="$(run_hook post-compact '{"hook_event_name":"PostCompact"}')"
printf '%s' "$out" | assert_json || fail "post-compact invalid JSON: $out"
out="$(run_hook stop '{"hook_event_name":"Stop"}')"
printf '%s' "$out" | assert_json || fail "stop invalid JSON: $out"

echo "  OK session/compact/stop JSON"

# ── Stop content sweep: Codex PostToolUse 없음, 턴 종료 시 git 변경 본문에 대한 재검사 하드 신호(경량망) ──
# 잘림이 포함된 새 챕터 작성, git 변경 사항(untracked)으로 유지 → stop은 반드시 이름을 명시하고 잘림을 보고해야 함; 변경되지 않은 파일은 재검사하지 않음.
PAD6='강진은 주먹을 꽉 쥐고 천천히 문으로 걸어가며 한 걸음 한 걸음을 계산했다.'  # bash 반복 채우기, Windows python 텍스트 stdout의 cp1252 크래시 방지
printf '# 제6장\n\n%s\n그는 달려가 주먹으로 ' "$PAD6$PAD6$PAD6$PAD6$PAD6$PAD6" > "$ROOT/book/본문/제006장_잘림.md"
out="$(run_hook stop '{"hook_event_name":"Stop"}')"
printf '%s' "$out" | assert_json || fail "stop content-sweep invalid JSON: $out"
echo "$out" | grep -q '잘림' || fail "stop did not flag truncated git-changed prose: $out"
echo "$out" | grep -q '제006장_잘림.md' || fail "stop did not name the changed prose file: $out"
# 이미 커밋된(git 변경 사항 없음) 챕터는 재검사되지 않아야 함——이번 턴의 변경 집합만 포함.
git -C "$ROOT" add -A && git -C "$ROOT" commit -qm wip >/dev/null 2>&1
out="$(run_hook stop '{"hook_event_name":"Stop"}')"
printf '%s' "$out" | python3 -c 'import json,sys; o=json.loads(sys.stdin.buffer.read().decode("utf-8")); assert "잘림" not in o.get("systemMessage","")' || fail "stop re-flagged already-committed prose: $out"
echo "  OK stop content sweep (git-changed only)"

# ── SessionStart continuity: 추적 staleness(챕터를 썼지만 컨텍스트.md가 따라오지 못함) + 챕터 제목 중복 제거 ──
mkdir -p "$ROOT/contbook/본문" "$ROOT/contbook/추적"
write_clean_state "$ROOT/contbook"
printf '이전 컨텍스트\n' > "$ROOT/contbook/추적/컨텍스트.md"
sleep 1
printf '# 제1장 결전\n본문.\n' > "$ROOT/contbook/본문/제001장_결전.md"
printf '# 제2장 결전\n본문.\n' > "$ROOT/contbook/본문/제002장_결전.md"
out="$(run_hook session-start '{"hook_event_name":"SessionStart"}')"
assert_additional_context "$out" "session-start continuity"
echo "$out" | grep -q '이어쓰기 상태 카드가 더 오래됨' || fail "session-start missed staleness 추적: $out"
echo "$out" | grep -q '제목 중복' || fail "session-start missed dup-title: $out"
echo "  OK session-start continuity (staleness 추적 + 제목 중복)"

nested="$ROOT/nested/a/b"
mkdir -p "$nested"
out="$(cd "$TMP_DIR" && printf '{"cwd":"%s","tool_name":"Write","tool_input":{"file_path":"book/본문/제003장_중첩.md","content":"본문"}}' "$nested" | python3 "$HOOK" pre-tool-prose-guard)"
assert_denied "$out" "cwd-based root resolution"

echo "  OK cwd-based root resolution"

# __file__ self-location (the Windows-critical resolver) on ALL platforms: with a bogus
# CODEX_PROJECT_DIR (env skipped) and an unrelated cwd, the hook must resolve root from its own
# .codex/hooks/ 위치. 판별: 상세 개요가 실제 루트에 존재하므로, 잘못된 루트 → 거부;
# only __file__-derived root → allow. (The valid-env tests above let env win and never hit this.)
: > "$ROOT/book/개요/상세_개요_제8장.md"
write_clean_state "$ROOT/book" 7
out="$(cd "$TMP_DIR" && CODEX_PROJECT_DIR="$TMP_DIR/does-not-exist" python3 "$HOOK" pre-tool-prose-guard <<'JSON'
{"tool_name":"Write","tool_input":{"file_path":"book/본문/제8장_x.md","content":"x"}}
JSON
)"
assert_empty "$out" "__file__ self-location resolves root when env is bogus and cwd unrelated"
rm -f "$ROOT/book/개요/상세_개요_제8장.md"

echo "  OK __file__ self-location (all platforms)"

NON_GIT="$TMP_DIR/non-git-story-project"
NON_GIT_HOOK="$NON_GIT/.codex/hooks/story_codex_hook.py"
mkdir -p "$NON_GIT/.codex/hooks" "$NON_GIT/book/본문" "$NON_GIT/book/개요" "$NON_GIT/nested/a/b"
cp "$HOOK_SRC" "$NON_GIT_HOOK"
cp "$HOOKS_SRC/run-story-hook.sh" "$HOOKS_SRC/run-story-hook.cmd" "$NON_GIT/.codex/hooks/"
cp "$REPO_ROOT/skills/story-setup/references/codex/hooks/hooks.json" "$NON_GIT/.codex/hooks.json"
launcher_cmd="$(
  NON_GIT="$NON_GIT" python3 - <<'PY'
import json, os
from pathlib import Path
hooks = json.loads((Path(os.environ["NON_GIT"]) / ".codex/hooks.json").read_text(encoding="utf-8"))
print(hooks["hooks"]["PreToolUse"][0]["hooks"][0]["command"])
PY
)"
out="$(
  cd "$NON_GIT/nested/a/b"
  printf '{"tool_name":"Write","tool_input":{"file_path":"book/본문/제004장_비Git.md","content":"본문"}}' | eval "$launcher_cmd"
)"
assert_denied "$out" "non-git deployment launcher root search"

echo "  OK non-git deployment launcher root search"

# Root propagation: non-git project, outline PRESENT at the true root, triggered from a nested
# cwd → must ALLOW. The launcher resolves the root in shell; it must reach the Python hook
# (via CODEX_PROJECT_DIR and/or the hook self-locating from __file__) instead of Python falling
# back to the nested cwd and wrongly denying. This case also exercises Windows (Git Bash MSYS
# path passed to native Python), which is exactly where naive env/cwd propagation breaks.
: > "$NON_GIT/book/개요/상세_개요_제4장.md"
write_clean_state "$NON_GIT/book" 3
out="$(cd "$NON_GIT/nested/a/b"; unset CODEX_PROJECT_DIR CLAUDE_PROJECT_DIR; printf '{"tool_name":"Write","tool_input":{"file_path":"book/본문/제004장_비Git.md","content":"본문"}}' | eval "$launcher_cmd")"
assert_empty "$out" "non-git nested cwd + outline present allows (root reaches Python hook)"
rm -f "$NON_GIT/book/개요/상세_개요_제4장.md"

echo "  OK non-git nested root propagation"

case "$(uname -s 2>/dev/null || true)" in
  MINGW*|MSYS*|CYGWIN*)
    NON_GIT="$NON_GIT" python3 - <<'PY'
import json
import os
import subprocess
from pathlib import Path

root = Path(os.environ["NON_GIT"])
hooks = json.loads((root / ".codex/hooks.json").read_text(encoding="utf-8"))["hooks"]
command = hooks["PreToolUse"][0]["hooks"][0]["commandWindows"]
# bytes 리터럴은 반드시 ASCII여야 합니다 (b'중국어'는 SyntaxError 발생). 문자열을 생성한 후 UTF-8로 인코딩하세요.
payload = '{"tool_name":"Write","tool_input":{"file_path":"book/본문/제004장_비Git.md","content":"본문"}}'.encode("utf-8")
completed = subprocess.run(
    command,
    cwd=root / "nested/a/b",
    input=payload,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    shell=True,
    timeout=20,
)
assert completed.returncode == 0, completed.stderr.decode("utf-8", "replace")
output = completed.stdout.decode("utf-8")
data = json.loads(output)
specific = data.get("hookSpecificOutput", {})
assert specific.get("permissionDecision") == "deny", output
PY
    echo "  OK commandWindows nested root + interpreter launcher"
    ;;
esac

# Missing deployment: a cwd whose ancestors have no .codex/hooks/story_codex_hook.py → the
# launcher must no-op (exit 0) silently, NOT run "//.codex/hooks/story_codex_hook.py" (which
# happens if it treats "/" as the project root after an exhausted upward search).
NO_DEPLOY="$TMP_DIR/no-deploy/x/y"
mkdir -p "$NO_DEPLOY"
out="$(cd "$NO_DEPLOY"; unset CODEX_PROJECT_DIR CLAUDE_PROJECT_DIR; printf '{"tool_name":"Write","tool_input":{"file_path":"book/본문/제1장.md","content":"본문"}}' | eval "$launcher_cmd" 2>&1)"
assert_empty "$out" "missing deployment launcher no-ops silently"
case "$out" in *//.codex*) fail "launcher executed //.codex/... on missing deployment: $out";; esac

echo "  OK missing-deployment launcher no-op"
echo ""
echo "OK: Codex hook synthetic tests passed"
