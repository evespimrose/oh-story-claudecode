#!/usr/bin/env bash
# Synthetic tests for the ZCode 3.3.4 strict hook contract.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

SOURCE="$REPO_ROOT/skills/story-setup/references/zcode/hooks/story_zcode_hook.js"
SOURCE_CORE="$REPO_ROOT/skills/story-setup/references/zcode/hooks/story_hook_core.js"
ROOT="$TMP_DIR/project"
HOOK="$ROOT/.zcode/hooks/story_zcode_hook.js"
mkdir -p "$ROOT/.zcode/hooks"
cp "$SOURCE" "$HOOK"
cp "$SOURCE_CORE" "$ROOT/.zcode/hooks/story_hook_core.js"

run_hook() {
  local event="$1" payload="$2"
  (cd "$ROOT" && printf '%s' "$payload" | ZCODE_PROJECT_DIR="$ROOT" node "$HOOK" "$event")
}

assert_empty() {
  [ -z "$1" ] || fail "$2 expected empty stdout, got: $1"
}

assert_contract() {
  local output="$1" event="$2" label="$3"
  printf '%s' "$output" | python3 -c '
import json, sys
obj = json.loads(sys.stdin.buffer.read().decode("utf-8"))
assert set(obj) == {"hookSpecificOutput"}, obj
specific = obj["hookSpecificOutput"]
allowed = {"hookEventName", "additionalContext"}
if sys.argv[1] == "PreToolUse":
    allowed |= {"permissionDecision", "permissionDecisionReason", "updatedInput"}
assert set(specific) <= allowed, specific
assert specific["hookEventName"] == sys.argv[1], specific
' "$event" || fail "$label violates strict ZCode output contract: $output"
}

assert_denied() {
  assert_contract "$1" PreToolUse "$2"
  printf '%s' "$1" | python3 -c 'import json,sys; x=json.load(sys.stdin)["hookSpecificOutput"]; assert x["permissionDecision"]=="deny" and x["permissionDecisionReason"]' \
    || fail "$2 did not deny"
}

write_clean_state() {
  mkdir -p "$1/추적"
  printf '{"schema_version":4,"state_revision":0,"last_committed_chapter":%s}\n' "${2:-0}" > "$1/추적/_tracking-state.json"
  printf '%s\n' '> 상태 수정: 0' > "$1/추적/컨텍스트.md"
}

echo "ZCode hook synthetic tests"
echo "=========================="
echo "Fixture: $ROOT"

mkdir -p "$ROOT/book/본문" "$ROOT/book/개요" "$ROOT/book/설정"
out="$(run_hook pre-tool-prose-guard '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"book/본문/제001장_시작.md"}}')"
assert_denied "$out" "long prose without outline"
: > "$ROOT/book/개요/상세_개요_제1장.md"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"book/본문/제001장_시작.md"}}')"
assert_denied "$out" "long prose without tracking metadata"
printf '%s' "$out" | grep -q '_tracking-state.json 누락됨' || fail "missing tracking denial did not explain re-import/init: $out"
write_clean_state "$ROOT/book"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"book/본문/제001장_시작.md"}}')"
assert_empty "$out" "long prose with outline"

# 신작에 아직 개요/추적/설정 스캐폴딩이 없을 때도 반드시 fail closed되어야 함. 상대 경로는 hook cwd 기준으로 해석되며,
# 잘못된 프로젝트 루트 결합을 숨기기 위해 핵심 가드를 fail open으로 약화시켜서는 안 됨.
mkdir -p "$ROOT/bare/본문" "$ROOT/cwd-book/본문" "$ROOT/cwd-book/개요"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"bare/본문/제1장_첫_장.md"}}')"
assert_denied "$out" "bare long project without scaffolding"
relative_payload="$(node -e '
const path = require("path")
process.stdout.write(JSON.stringify({
  cwd: path.resolve(process.argv[1]),
  tool_name: "Write",
  tool_input: { file_path: "본문/제8장_상대.md" },
}))
' "$ROOT/cwd-book")"
out="$(run_hook pre-tool-prose-guard "$relative_payload")"
assert_denied "$out" "relative prose target from hook cwd"
printf '%s' "$out" | grep -q 'cwd-book/개요' || fail "relative target was not resolved from hook cwd: $out"
: > "$ROOT/cwd-book/개요/상세_개요_제8장.md"
out="$(run_hook pre-tool-prose-guard "$relative_payload")"
assert_denied "$out" "relative prose target without tracking metadata"
write_clean_state "$ROOT/cwd-book" 7
out="$(run_hook pre-tool-prose-guard "$relative_payload")"
assert_empty "$out" "relative prose target with cwd-local outline"

: > "$ROOT/book/본문/제009장_이미_존재함.md"
printf '%s\n' '{"schema_version":4,"state_revision":1,"last_committed_chapter":0}' > "$ROOT/book/추적/_tracking-state.json"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"book/본문/제009장_이미_존재함.md"}}')"
assert_denied "$out" "existing prose rewrite with mismatched derived state"
printf '%s' "$out" | grep -q 'mode=revision 트랜잭션 파생 뷰 재구축' || fail "state mismatch denial missed retry action: $out"
write_clean_state "$ROOT/book"

# containment 판정 기준은 Windows 경로 의미 체계에 따라 처리해야 합니다. path.relative는 드라이브를 가로지를 때 절대 경로를 반환하며,
# 디렉터리 이름이 `..`으로 시작하더라도 여전히 프로젝트 내부에 있을 수 있습니다. startsWith("..")만 사용하면 두 경우 모두 잘못 판정하게 됩니다.
node - "$SOURCE" <<'JS' || fail "ZCode cwd containment is not cross-volume safe"
const path = require("path")
const { isPathInside } = require(process.argv[2])
if (isPathInside("C:\\repo", "D:\\elsewhere", path.win32)) {
  throw new Error("different Windows volume must be outside the project")
}
if (!isPathInside("C:\\repo", "C:\\repo\\..draft", path.win32)) {
  throw new Error("an in-project directory named ..draft must remain inside")
}
if (!isPathInside("C:\\repo", "C:\\repo\\sub", path.win32)) {
  throw new Error("ordinary in-project directory must remain inside")
}
JS

out="$(run_hook pre-tool-prose-guard '{"tool_name":"ApplyPatch","tool_input":{"patch":"*** Begin Patch\n*** Add File: book/본문/제002장_새로운_국면.md\n+본문\n*** End Patch"}}')"
assert_denied "$out" "ApplyPatch prose without outline"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Bash","tool_input":{"command":"echo x | tee book/본문/제003장_명령.md"}}')"
assert_denied "$out" "Bash prose write without outline"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Bash","tool_input":{"command":"grep -n book/본문/제003장_명령.md notes.md"}}')"
assert_empty "$out" "Bash mention without write"

mkdir -p "$ROOT/short"
: > "$ROOT/short/설정.md"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"short/본문.md"}}')"
assert_denied "$out" "short prose without outline"
: > "$ROOT/short/소단락_개요.md"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"short/본문.md"}}')"
assert_empty "$out" "short prose with outline"

mkdir -p "$ROOT/impbook/본문" "$ROOT/텍스트_분할_저장소/impbook"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"impbook/본문/제1장_도입.md"}}')"
assert_empty "$out" "story-import long migration"
mkdir -p "$ROOT/impbook/개요" "$ROOT/impbook/추적"
: > "$ROOT/impbook/개요/상세_개요_제2장.md"
printf '%s\n' '{"schema_version":4,"state_revision":1,"last_committed_chapter":1}' > "$ROOT/impbook/추적/_tracking-state.json"
printf '%s\n' '> 상태 수정: 0' > "$ROOT/impbook/추적/컨텍스트.md"
out="$(run_hook pre-tool-prose-guard '{"tool_name":"Write","tool_input":{"file_path":"impbook/본문/제2장_도입_후속.md"}}')"
assert_denied "$out" "imported project must not permanently bypass invalid tracking guard"
echo "  OK outline-before-prose guard"

printf '이것은 본문 안의 TODO이며, 마지막 문장이 잘렸습니다.' > "$ROOT/short/본문.md"
out="$(run_hook post-tool-prose-check '{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"short/본문.md"}}')"
assert_contract "$out" PostToolUse "post-write prose check"
printf '%s' "$out" | grep -q '자리 표시자' || fail "post-write check missed TODO"
printf '%s' "$out" | grep -q '잘림 의심' || fail "post-write check missed truncation"
echo "  OK post-write strict JSON + UTF-8 findings"

printf '명령으로 작성된 본문 TODO.' > "$ROOT/short/본문.md"
out="$(run_hook post-tool-prose-check '{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"cat input.txt > short/본문.md"}}')"
assert_contract "$out" PostToolUse "post-bash prose check"
printf '%s' "$out" | grep -q '자리 표시자' || fail "post-Bash check missed prose target"
echo "  OK Bash write post-check"

cat > "$ROOT/.story-deployed" <<'EOF'
agents_version: 19
setup_skill_version: 1.2.7
target_cli: zcode
resolver_strategy: project-local-skill-reference
references_dir: .zcode/skills/story-setup/references/agent-references
EOF
printf 'book\n' > "$ROOT/.active-book"
mkdir -p "$ROOT/book/추적"
printf '# 컨텍스트\n' > "$ROOT/book/추적/컨텍스트.md"
out="$(run_hook session-start '{"hook_event_name":"SessionStart","source":"compact"}')"
assert_contract "$out" SessionStart "session start"
printf '%s' "$out" | grep -q '현재 도서 목록' || fail "session start missed active book"
printf '%s\n' '{"schema_version":4,"state_revision":1,"last_committed_chapter":0}' > "$ROOT/book/추적/_tracking-state.json"
out="$(run_hook session-start '{"hook_event_name":"SessionStart","source":"resume"}')"
assert_contract "$out" SessionStart "session tracking mismatch warning"
printf '%s' "$out" | grep -q '상태 수정' || fail "session start missed tracking revision mismatch"
write_clean_state "$ROOT/book"
echo "  OK session-start context"

printf '# 이전 컨텍스트\n' > "$ROOT/book/추적/컨텍스트.md"
sleep 2
printf '# 제1장\n본문.\n' > "$ROOT/book/본문/제001장_제목중복.md"
printf '# 제2장\n본문.\n' > "$ROOT/book/본문/제002장_제목중복.md"
out="$(run_hook session-start '{"hook_event_name":"SessionStart","source":"resume"}')"
assert_contract "$out" SessionStart "session continuity"
printf '%s' "$out" | grep -q '이어 쓰기 상태 카드가 더 이전임' || fail "session start missed stale tracking context"
printf '%s' "$out" | grep -q '제목 중복' || fail "session start missed duplicate chapter title"
echo "  OK session-start continuity guard"

git -C "$ROOT" init -q
git -C "$ROOT" config user.email zcode-hook@example.invalid
git -C "$ROOT" config user.name zcode-hook-test
printf '나이: 18\n' > "$ROOT/book/본문/제010장_속성.md"
git -C "$ROOT" add "$ROOT/book/본문/제010장_속성.md"
out="$(run_hook pre-tool-commit-advisory '{"tool_name":"Bash","tool_input":{"command":"git -C . commit -m test"}}')"
assert_contract "$out" PreToolUse "commit advisory"
printf '%s' "$out" | grep -q '하드코딩된 캐릭터 속성' || fail "commit advisory missed staged prose"
out="$(run_hook pre-tool-commit-advisory '{"tool_name":"Bash","tool_input":{"command":"echo git commit docs"}}')"
assert_empty "$out" "non-commit command"
echo "  OK commit advisory"

out="$(printf 'not-json' | ZCODE_PROJECT_DIR="$ROOT" node "$HOOK" pre-tool-prose-guard)"
assert_empty "$out" "malformed input fail-open"

: > "$ROOT/book/개요/상세개요_제8장.md"
write_clean_state "$ROOT/book" 7
out="$(cd "$TMP_DIR" && printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"book/본문/제8장_자기위치설정.md"}}' | env -u ZCODE_PROJECT_DIR -u CLAUDE_PROJECT_DIR node "$HOOK" pre-tool-prose-guard)"
assert_empty "$out" "deployed __dirname self-location"
echo "  OK malformed input + workspace self-location"

echo ""
echo "OK: ZCode hook synthetic tests passed"
