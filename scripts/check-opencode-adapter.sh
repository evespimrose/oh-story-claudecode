#!/usr/bin/env bash
# check-opencode-adapter.sh — deterministic checks for the OpenCode adapter surface.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$REPO_ROOT/skills/story-setup/references/opencode"
TMP_DIR="$(mktemp -d)"
SYNC_LOG="$TMP_DIR/sync.log"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_file() { [ -f "$1" ] || fail "required file missing: $1"; }
assert_dir() { [ -d "$1" ] || fail "required directory missing: $1"; }
assert_grep() { grep -Eq "$1" "$2" || fail "$3 ($2)"; }

cd "$REPO_ROOT"

echo "OpenCode adapter check"
echo "======================"
echo "Repo: $REPO_ROOT"

assert_dir "$ROOT"
assert_file "$ROOT/AGENTS.md.tmpl"
assert_file "$ROOT/opencode.json.patch"
assert_file "$ROOT/plugin.ts"
assert_file "$ROOT/story_hook_core.js"
assert_dir "$ROOT/agents"
assert_dir "$ROOT/commands"
assert_file "scripts/sync-opencode.py"

python3 -m json.tool "$ROOT/opencode.json.patch" >/dev/null
python3 - <<'PY'
import json
from pathlib import Path
cfg = json.loads(Path('skills/story-setup/references/opencode/opencode.json.patch').read_text())
assert cfg.get('$schema') == 'https://opencode.ai/config.json', cfg
plugins = cfg.get('plugin')
assert isinstance(plugins, list), plugins
assert './.opencode/plugins/story-hooks.ts' in plugins, plugins
PY

echo "  OK config patch"

# Snapshot the generated surface so --check itself is held to its read-only contract,
# including when a developer already has unrelated worktree changes.
cp -R "$ROOT" "$TMP_DIR/opencode-before"
if ! python3 scripts/sync-opencode.py --check >"$SYNC_LOG" 2>&1; then
  cat "$SYNC_LOG" >&2 || true
  echo "::error::OpenCode templates are out of sync with Claude Code templates." >&2
  echo "::error::Run 'python3 scripts/sync-opencode.py' locally and commit the changes." >&2
  exit 1
fi
diff -qr "$TMP_DIR/opencode-before" "$ROOT" >/dev/null \
  || fail "sync-opencode.py --check modified generated files"

echo "  OK generated OpenCode templates are in sync (--check stayed read-only)"

python3 - "scripts/sync-opencode.py" "$TMP_DIR" <<'PY'
import importlib.util
import sys
from pathlib import Path

script_path = Path(sys.argv[1]).resolve()
tmp = Path(sys.argv[2]) / "opencode-transaction"
spec = importlib.util.spec_from_file_location("sync_opencode", script_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

src = tmp / "skills/story-setup/references/templates/agents"
templates = src.parent
dst_root = tmp / "skills/story-setup/references/opencode"
dst = dst_root / "agents"
src.mkdir(parents=True)
dst.mkdir(parents=True)
(templates / "CLAUDE.md.tmpl").write_text("valid instructions\n", encoding="utf-8")
(src / "a.md").write_text(
    "---\nname: a\ndescription: valid first fixture\ntools: [Read]\n---\nbody\n",
    encoding="utf-8",
)
(src / "b.md").write_text("missing frontmatter\n", encoding="utf-8")
(dst / "a.md").write_text("keep old a\n", encoding="utf-8")
(dst / "sentinel.md").write_text("keep sentinel\n", encoding="utf-8")
before = {path.name: path.read_bytes() for path in dst.iterdir()}
module.ROOT = tmp
old_argv = sys.argv
sys.argv = [str(script_path)]
try:
    module.main()
except ValueError:
    pass
else:
    raise SystemExit("sync-opencode must reject malformed agent source")
finally:
    sys.argv = old_argv
after = {path.name: path.read_bytes() for path in dst.iterdir()}
if after != before:
    raise SystemExit("sync-opencode modified destination before validating all sources")
PY

echo "  OK malformed source cannot partially update generated agents"

python3 - "scripts/sync-opencode.py" "$TMP_DIR" <<'PY'
import importlib.util
import sys
from pathlib import Path

script_path = Path(sys.argv[1]).resolve()
tmp = Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("sync_opencode_atomic", script_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def snapshot(root: Path) -> dict[str, tuple[str, bytes]]:
    result = {}
    if not root.exists():
        return result
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        if path.is_symlink():
            result[rel] = ("symlink", str(path.readlink()).encode())
        elif path.is_dir():
            result[rel] = ("dir", b"")
        else:
            result[rel] = ("file", path.read_bytes())
    return result


def write_agent(path: Path, name: str) -> None:
    path.write_text(
        f"---\nname: {name}\ndescription: valid {name} fixture\ntools: [Read]\n---\n{name} body\n",
        encoding="utf-8",
    )


def run_normal(root: Path) -> None:
    old_root, old_argv = module.ROOT, sys.argv
    module.ROOT = root
    sys.argv = [str(script_path)]
    try:
        module.main()
    finally:
        module.ROOT = old_root
        sys.argv = old_argv


# Cross-phase failure: valid agents followed by a missing CLAUDE.md.tmpl must
# leave the entire OpenCode adapter tree byte-for-byte unchanged.
missing_root = tmp / "opencode-missing-agents-template"
missing_src = missing_root / "skills/story-setup/references/templates/agents"
missing_dst = missing_root / "skills/story-setup/references/opencode"
missing_src.mkdir(parents=True)
(missing_dst / "agents").mkdir(parents=True)
write_agent(missing_src / "a.md", "a")
(missing_dst / "agents/a.md").write_text("keep old a\n", encoding="utf-8")
(missing_dst / "plugin.ts").write_text("keep manual plugin\n", encoding="utf-8")
before = snapshot(missing_dst)
try:
    run_normal(missing_root)
except RuntimeError:
    pass
else:
    raise SystemExit("sync-opencode must reject a missing CLAUDE.md.tmpl")
if snapshot(missing_dst) != before:
    raise SystemExit("sync-opencode partially updated agents before CLAUDE.md.tmpl validation")


# Publication failure: b.md is deliberately a directory in the destination.
# The failed second agent output must not expose the earlier a.md update or
# mutate AGENTS.md.tmpl/manual OpenCode assets.
write_root = tmp / "opencode-write-failure"
write_src_root = write_root / "skills/story-setup/references/templates"
write_src = write_src_root / "agents"
write_dst = write_root / "skills/story-setup/references/opencode"
write_src.mkdir(parents=True)
(write_dst / "agents/b.md").mkdir(parents=True)
write_agent(write_src / "a.md", "a")
write_agent(write_src / "b.md", "b")
(write_src_root / "CLAUDE.md.tmpl").write_text("new instructions\n", encoding="utf-8")
(write_dst / "agents/a.md").write_text("keep old a\n", encoding="utf-8")
(write_dst / "AGENTS.md.tmpl").write_text("keep old instructions\n", encoding="utf-8")
(write_dst / "plugin.ts").write_text("keep manual plugin\n", encoding="utf-8")
before = snapshot(write_dst)
try:
    run_normal(write_root)
except (IsADirectoryError, OSError):
    pass
else:
    raise SystemExit("sync-opencode must fail when a generated target is a directory")
if snapshot(write_dst) != before:
    raise SystemExit("sync-opencode exposed a partial adapter update after a write failure")


# Fail the second os.replace after the first agent was committed. The normal
# exception path must restore agents, AGENTS.md.tmpl, and manual assets.
commit_dst = tmp / "opencode-commit-failure"
(commit_dst / "agents").mkdir(parents=True)
(commit_dst / "agents/a.md").write_text("old a\n", encoding="utf-8")
(commit_dst / "agents/b.md").write_text("old b\n", encoding="utf-8")
(commit_dst / "AGENTS.md.tmpl").write_text("old instructions\n", encoding="utf-8")
(commit_dst / "plugin.ts").write_text("manual plugin\n", encoding="utf-8")
before = snapshot(commit_dst)
real_replace = module.os.replace
calls = 0

def fail_second_replace(src, dst):
    global calls
    calls += 1
    if calls == 2:
        raise OSError("injected second-commit failure")
    return real_replace(src, dst)

module.os.replace = fail_second_replace
try:
    module.publish_tree(
        {"a.md": "new a\n", "b.md": "new b\n"},
        "new instructions\n",
        commit_dst,
    )
except OSError:
    pass
else:
    raise SystemExit("sync-opencode did not surface injected commit failure")
finally:
    module.os.replace = real_replace
if snapshot(commit_dst) != before:
    raise SystemExit("sync-opencode failed to roll back an interrupted commit")


# A copied symlink at opencode/agents must never redirect staging writes into an
# external/user directory.
link_root = tmp / "opencode-symlink-parent"
link_src_root = link_root / "skills/story-setup/references/templates"
link_src = link_src_root / "agents"
link_dst = link_root / "skills/story-setup/references/opencode"
external = tmp / "opencode-external"
link_src.mkdir(parents=True)
link_dst.mkdir(parents=True)
external.mkdir()
write_agent(link_src / "a.md", "a")
(link_src_root / "CLAUDE.md.tmpl").write_text("instructions\n", encoding="utf-8")
(external / "a.md").write_text("external sentinel\n", encoding="utf-8")
(link_dst / "agents").symlink_to(external, target_is_directory=True)
before_external = snapshot(external)
try:
    run_normal(link_root)
except ValueError:
    pass
else:
    raise SystemExit("sync-opencode must reject a symlinked agents directory")
if snapshot(external) != before_external:
    raise SystemExit("sync-opencode followed agents symlink and modified external files")
PY

echo "  OK OpenCode generated-file failures roll back without replacing the adapter root"

# A stale generated agent that cannot be removed (immutable flag, lock, read-only
# mount) must not abort the rollback: restorable files return to their prior
# bytes, the un-removable file keeps its content, and manual assets stay put.
python3 - "scripts/sync-opencode.py" "$TMP_DIR" <<'PY'
import importlib.util
import sys
from pathlib import Path

script_path = Path(sys.argv[1]).resolve()
root = Path(sys.argv[2]) / "opencode-immutable-stale"
agents = root / "agents"
agents.mkdir(parents=True)
(agents / "a.md").write_text("old a\n", encoding="utf-8")
(agents / "stale.md").write_text("old stale\n", encoding="utf-8")
(root / "AGENTS.md.tmpl").write_text("old instructions\n", encoding="utf-8")
(root / "plugin.ts").write_text("manual plugin\n", encoding="utf-8")


def snap() -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


before = snap()
spec = importlib.util.spec_from_file_location("sync_opencode_immutable", script_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

real_unlink = Path.unlink
real_copy2 = module.shutil.copy2
# Key the fault on the file's OWN path, not its name: a real immutable file
# still allows being read/copied into the backup dir, so only writes and unlinks
# targeting stale.md itself must fail. Keying on the name would also block the
# backup copy and abort before the rollback path is ever exercised.
victim = (agents / "stale.md").resolve()


def blocked_unlink(self, *args, **kwargs):
    if self.resolve() == victim:
        raise PermissionError("simulated immutable stale file")
    return real_unlink(self, *args, **kwargs)


def blocked_copy2(src, dst, *args, **kwargs):
    if Path(dst).resolve() == victim:
        raise PermissionError("simulated immutable stale file")
    return real_copy2(src, dst, *args, **kwargs)


Path.unlink = blocked_unlink
module.shutil.copy2 = blocked_copy2
try:
    module.publish_tree({"a.md": "new a\n"}, "new instructions\n", root)
except PermissionError:
    pass
else:
    raise SystemExit("sync-opencode did not surface the un-removable stale file")
finally:
    Path.unlink = real_unlink
    module.shutil.copy2 = real_copy2
after = snap()
if after != before:
    raise SystemExit(
        f"sync-opencode rollback left a partial update past an un-removable file: {before} -> {after}"
    )
PY

echo "  OK OpenCode rollback survives an un-removable stale agent file"

python3 - <<'PY'
from pathlib import Path
expected = {
    'chapter-extractor', 'character-designer', 'consistency-checker',
    'narrative-writer', 'story-architect', 'story-explorer', 'story-researcher',
}
read_only = {'chapter-extractor', 'consistency-checker', 'story-explorer'}
base = Path('skills/story-setup/references/opencode/agents')
found = {p.stem for p in base.glob('*.md')}
assert found == expected, found
for p in sorted(base.glob('*.md')):
    text = p.read_text()
    assert text.startswith('---\n'), f'{p}: missing frontmatter'
    try:
        fm = text.split('---', 2)[1]
    except IndexError:
        raise AssertionError(f'{p}: malformed frontmatter')
    assert 'mode: subagent' in fm, f'{p}: missing mode: subagent'
    assert 'description:' in fm, f'{p}: missing description'
    assert 'read: allow' in fm, f'{p}: missing read allow'
    assert 'steps:' in fm, f'{p}: missing steps limit'
    if p.stem in read_only:
        assert 'edit: deny' in fm, f'{p}: read-only agent must deny edit'
    else:
        assert 'edit: allow' in fm, f'{p}: write-capable agent must allow edit'
    assert '.claude/skills/story-setup/references/agent-references/' not in text, f'{p}: leaked Claude reference path'
    assert '.opencode/skills/story-setup/references/agent-references/' not in text, f'{p}: stale hidden OpenCode reference fallback'
    if p.stem in {'character-designer', 'consistency-checker', 'narrative-writer', 'story-architect'}:
        assert '{프로젝트 루트}/skills/story-setup/references/agent-references/' in text, f'{p}: 정규 OpenCode 참조 경로가 누락되었습니다'
PY

echo "  OK agent templates"

# frontmatter 파싱은 반드시 한 줄을 독점하는 `---`에 고정되어야 하며(값 내부의 세 개 하이픈이 permission/steps를 끊어서는 안 됨),
# disallowedTools의 Bash는 실제 스칼라 deny로 확정되어야 합니다. OpenCode에서 bash 권한을 선언하지 않았을 때
# evaluate()가 ask를 반환하므로(deny가 아님), edit: deny 설정만 된 읽기 전용 agent는 여전히 shell 리디렉션을 통해 본문을 작성할 수 있습니다.
# 어떤 "읽기 전용 명령" 예외도 허용하지 않습니다. 업스트림 shell.ts는 command의 **직계 부모 노드**인 redirected_statement만
# 권한 검사에 포함하므로, `( allowlisted-command ) > 본문.md`의 command 직계 부모 노드는 subshell이 되어 리터럴 화이트리스트를 우회할 수 있습니다.
python3 - "scripts/sync-opencode.py" <<'PY'
import importlib.util
import sys
from pathlib import Path

script_path = Path(sys.argv[1]).resolve()
spec = importlib.util.spec_from_file_location("sync_opencode_permissions", script_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

source = (
    "---\nname: a\ndescription: |\n  읽기 전용 agent --- 7 Gate。\n"
    "tools: [Read, Glob, Grep]\ndisallowedTools: [Write, Edit, Bash]\nmaxTurns: 9\n"
    "# 비고 --- 메인 skill과 동일 레벨\n---\nbody\n"
)
fm, body = module.parse_frontmatter(source)
missing = {'name', 'description', 'tools', 'disallowedTools', 'maxTurns'} - set(fm)
assert not missing, f'frontmatter truncated at an inline ---: missing {missing}'
assert body.strip() == 'body', body

# 본문이 권한 부여의 유일한 근거이므로 body는 필수 전달 매개변수입니다. 기본값을 설정하는 것은 "전달 누락 = 몰래 권한 변경"과 같습니다.
try:
    module.convert_claude_to_opencode(fm)
except TypeError:
    pass
else:
    raise AssertionError('convert_claude_to_opencode must require the agent body (no default)')

# 읽기 전용 agent의 본문에서 명령 실행을 요구할 경우, 제너레이터는 몰래 shell 예외를 허용하는 대신 명시적으로 실패해야 합니다.
try:
    module.convert_claude_to_opencode(
        fm, '**프로젝트 루트 디렉터리 확인:** `git rev-parse --show-toplevel` 실행, 실패 시 현재 작업 디렉터리 사용.\n'
    )
except ValueError as error:
    assert 'git rev-parse --show-toplevel' in str(error), error
else:
    raise AssertionError('restricted agent instructions must not require Bash')

# 본문에 해당 명령이 언급되지 않음 → 하나도 허용하지 않음(스칼라 deny는 업스트림 disabled()가 bash 도구 전체를 제거하게 함)
plain = module.convert_claude_to_opencode(fm, '읽기 전용 agent, 본문에 shell 단계 없음\n')
assert plain['permission']['bash'] == 'deny', (
    f'read-only agent whose body never asks for a command must get a plain bash deny: {plain}'
)

# 제너레이터는 반드시 **명시적으로 실패**해야 하며, 실행되지 않거나 보안이 뚫린 agent를 묵묵히 생성해서는 안 됩니다.
# 본문에서 shell 명령을 요구함 → 생성이 중단되어야 하며 해당 명령을 명시해야 함
try:
    module.convert_claude_to_opencode(fm, '**환경 준비:** `npm install` 실행 후 검사 시작.\n')
except ValueError as error:
    assert 'npm install' in str(error), error
else:
    raise AssertionError('generator must fail loudly when the body needs an ungranted command')


def bash_rules_in_file_order(fm_text: str):
    """**파일에 작성된 순서**대로 bash 규칙을 가져옵니다. 순서가 곧 우선순위이므로 dict/set을 사용해서는 안 됩니다.

    동시에 스칼라 표기법 `bash: deny`와도 호환됩니다. 업스트림 fromConfig()가 이를 단일 `*` 규칙으로 확장합니다.
    """
    import re
    rules = []
    in_bash = False
    for line in fm_text.split('\n'):
        scalar = re.match(r'^ {2}bash:\s*(\S+)\s*$', line)
        if scalar:
            rules.append(('*', scalar.group(1)))
            in_bash = False
            continue
        if re.match(r'^ {2}bash:\s*$', line):
            in_bash = True
            continue
        if in_bash:
            matched = re.match(r'^ {4}"(.+)":\s*(\S+)\s*$', line)
            if matched:
                rules.append((matched.group(1), matched.group(2)))
                continue
            if line.strip():
                in_bash = False
    return rules


# format_frontmatter는 키를 정렬해서는 안 됩니다. 정렬하게 되면 제너레이터의 "넓은 deny가 앞, 좁은 allow가 뒤"인
# 순서가 자동으로 삭제됩니다. 역알파벳순 삽입 순서로 이를 테스트합니다.
probe = {
    'permission': {
        'read': 'allow',
        'bash': {'zzz cmd': 'deny', '*': 'deny', 'aaa cmd': 'allow'},
    }
}
probe_rules = bash_rules_in_file_order(module.format_frontmatter(probe))
assert probe_rules == [('zzz cmd', 'deny'), ('*', 'deny'), ('aaa cmd', 'allow')], (
    f'format_frontmatter reordered permission globs (must preserve dict order): {probe_rules}'
)

# 생성기 자체 출력: 읽기 전용 agent는 덮어쓸 수 없는 스칼라 deny여야 합니다.
generated_rules = bash_rules_in_file_order(module.format_frontmatter(plain))
assert generated_rules == [('*', 'deny')], generated_rules
PY

echo "  OK generator makes read-only Bash unavailable and rejects contradictory instructions"

# 생성물의 **판정 매트릭스**(#265 2차 리뷰). 여기서는 업스트림 opencode v1.18.5의 판정을 독립적으로 복제하며,
# sync-opencode.py의 동명 함수를 의도적으로 재사용하지 않았습니다. 재사용할 경우 복제 자체가 잘못되었을 때 테스트도 함께 틀릴 수 있기 때문입니다.
#   util/wildcard.ts     match()
#   permission/index.ts  fromConfig() / evaluate()(findLast) / Permission.ask()
#   tool/shell.ts        source()(리다이렉션 포함 시 전체 redirected_statement를 가져옴) / collect()
python3 - <<'PY'
import re
from pathlib import Path


def wildcard_match(value: str, pattern: str) -> bool:
    value = value.replace('\\', '/')
    pattern = pattern.replace('\\', '/')
    escaped = re.sub(r'[.+^${}()|\[\]\\]', r'\\\g<0>', pattern)
    escaped = escaped.replace('*', '.*').replace('?', '.')
    # 업스트림 원본 주석: pattern이 " *"로 끝날 때 마지막 부분을 선택 사항으로 만들어 "ls *"가 "ls"와도 매칭되도록 합니다.
    # 바로 이 단계 덕분에 접두사 glob이 리다이렉션이 포함된 전체 문장을 처리할 수 있습니다.
    if escaped.endswith(' .*'):
        escaped = escaped[:-3] + '( .*)?'
    return re.match('^' + escaped + '$', value, flags=re.DOTALL) is not None


def evaluate(rules, pattern: str) -> str:
    """findLast: 마지막으로 일치하는 규칙이 적용됩니다. 일치하는 규칙이 하나도 없으면 업스트림은 기본적으로 ask를 수행합니다."""
    action = 'ask'
    for rule_pattern, rule_action in rules:
        if wildcard_match(pattern, rule_pattern):
            action = rule_action
    return action


def resolve(rules, patterns) -> str:
    """Permission.ask(): 어느 한 pattern이라도 deny로 판정되면 전체 shell 호출이 거부됩니다."""
    verdict = 'allow'
    for pattern in patterns:
        action = evaluate(rules, pattern)
        if action == 'deny':
            return 'deny'
        if action != 'allow':
            verdict = 'ask'
    return verdict


def bash_rules_in_file_order(fm_text: str):
    rules = []
    in_bash = False
    for line in fm_text.split('\n'):
        scalar = re.match(r'^ {2}bash:\s*(\S+)\s*$', line)
        if scalar:
            rules.append(('*', scalar.group(1)))
            in_bash = False
            continue
        if re.match(r'^ {2}bash:\s*$', line):
            in_bash = True
            continue
        if in_bash:
            matched = re.match(r'^ {4}"(.+)":\s*(\S+)\s*$', line)
            if matched:
                rules.append((matched.group(1), matched.group(2)))
                continue
            if line.strip():
                in_bash = False
    return rules


NEEDED = 'git rev-parse --show-toplevel'
TARGET = 'book/본문/제001장.md'
# 각 항목 = (표시용 명령, collect()가 생성하는 scan.patterns). 하나의 shell 명령에 여러 개의
# tree-sitter `command` 노드가 포함될 수 있습니다. 리다이렉션이 있는 노드는 전체 redirected_statement의 텍스트를 가져옵니다.
ESCAPES = [
    (f'{NEEDED} > {TARGET}', [f'{NEEDED} > {TARGET}']),
    (f'{NEEDED} >> {TARGET}', [f'{NEEDED} >> {TARGET}']),
    (f'{NEEDED} 2> {TARGET}', [f'{NEEDED} 2> {TARGET}']),
    # 업스트림 source()는 command의 직계 부모 노드만 확인합니다. subshell/compound로 한 겹 감싼 후에는 collect()가
    # 확인하는 pattern은 여전히 순수한 NEEDED이며, 바깥쪽 리다이렉션은 권한 검사 pattern에 포함되지 않습니다.
    (f'( {NEEDED} ) > {TARGET}', [NEEDED]),
    (f'{{ {NEEDED}; }} > {TARGET}', [NEEDED]),
    (f'{NEEDED} | tee {TARGET}', [NEEDED, f'tee {TARGET}']),
    (f'{NEEDED} && cat > {TARGET}', [NEEDED, f'cat > {TARGET}']),
    (f'{NEEDED}; rm -rf /', [NEEDED, 'rm -rf /']),
    ('git rev-parse HEAD', ['git rev-parse HEAD']),
    ('git push', ['git push']),
    ('rm -rf /', ['rm -rf /']),
    ("python3 -c 'print(1)'", ["python3 -c 'print(1)'"]),
    ('echo x > 제1장.md', ['echo x > 제1장.md']),
    ('bash -c "cat /etc/passwd"', ['bash -c "cat /etc/passwd"']),
]

read_only = {'chapter-extractor', 'consistency-checker', 'story-explorer'}
base = Path('skills/story-setup/references/opencode/agents')
for name in sorted(read_only):
    fm_text = (base / f'{name}.md').read_text(encoding='utf-8').split('\n---\n', 1)[0]
    rules = bash_rules_in_file_order(fm_text)
    assert rules, f'{name}: read-only agent must declare a bash restriction'
    assert rules == [('*', 'deny')], (
        f'{name}: read-only Bash must be a scalar deny without exceptions: {rules}'
    )
    assert resolve(rules, [NEEDED]) == 'deny', (
        f'{name}: bare {NEEDED!r} must also be denied'
    )
    # 반대 케이스: 리다이렉션/추가/stderr 리다이렉션/파이프/연결 및 모든 권한 초과 명령은 일괄 deny
    for shown, patterns in ESCAPES:
        got = resolve(rules, patterns)
        assert got == 'deny', (
            f'{name}: `{shown}`이(가) {got!r}(으)로 확인되었습니다. 반드시 deny여야 합니다 — 읽기 전용 agent는'
            f'리다이렉션/파이프/연결을 통해 저자의 본문을 덮어쓸 수 없습니다(파일 내 규칙 순서: {rules})'
        )
PY

echo "  OK read-only agents deny bare commands plus redirection/subshell/pipe/chain escapes"

# 생성은 반드시 멱등성을 유지해야 합니다. 즉, 두 번 실행했을 때 결과물이 일치해야 합니다. 그렇지 않으면 템플릿 수정이 없어도 --check에서 무작위로 out-of-sync가 발생할 수 있습니다.
python3 - "scripts/sync-opencode.py" "$TMP_DIR" <<'PY'
import contextlib
import importlib.util
import io
import shutil
import sys
from pathlib import Path

script_path = Path(sys.argv[1]).resolve()
root = Path(sys.argv[2]) / "opencode-idempotent"
spec = importlib.util.spec_from_file_location("sync_opencode_idempotent", script_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

src = Path("skills/story-setup/references")
dst = root / "skills/story-setup/references"
dst.mkdir(parents=True)
shutil.copytree(src / "templates", dst / "templates")
shutil.copytree(src / "opencode", dst / "opencode")


def snapshot() -> dict[str, bytes]:
    base = dst / "opencode"
    return {
        path.relative_to(base).as_posix(): path.read_bytes()
        for path in sorted(base.rglob("*"))
        if path.is_file()
    }


def run() -> None:
    old_root, old_argv = module.ROOT, sys.argv
    module.ROOT = root
    sys.argv = [str(script_path)]
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            module.main()
    finally:
        module.ROOT, sys.argv = old_root, old_argv


run()
first = snapshot()
run()
second = snapshot()
if first != second:
    drift = sorted(key for key in set(first) | set(second) if first.get(key) != second.get(key))
    raise SystemExit(f"sync-opencode.py is not idempotent; drifting files: {drift}")
PY

echo "  OK generation is idempotent (second run is byte-identical)"

python3 - <<'PY'
from pathlib import Path
skill_names = {p.parent.name for p in Path('skills').glob('*/SKILL.md')}
command_names = {p.stem for p in Path('skills/story-setup/references/opencode/commands').glob('*.md')}
assert skill_names == command_names, f'missing={skill_names-command_names}, extra={command_names-skill_names}'
for p in sorted(Path('skills/story-setup/references/opencode/commands').glob('*.md')):
    text = p.read_text()
    assert text.startswith('---\n'), f'{p}: missing frontmatter'
    fm = text.split('---', 2)[1]
    assert 'description:' in fm, f'{p}: missing description'
    assert f'{p.stem} skill을 사용하세요' in text, f'{p}: command body must route to same skill'
PY

echo "  OK slash command templates"

assert_grep 'experimental\.session\.compacting' "$ROOT/plugin.ts" "OpenCode plugin must inject pre-compact context"
assert_grep 'tool\.execute\.before' "$ROOT/plugin.ts" "OpenCode plugin must guard tool writes"
assert_grep 'proseBlockReason' "$ROOT/plugin.ts" "OpenCode plugin must keep outline-before-prose guard"
assert_grep 'tool\.execute\.after' "$ROOT/plugin.ts" "OpenCode plugin must run the prose backstop after writes"
assert_grep 'proseAfterWrite' "$ROOT/plugin.ts" "OpenCode plugin must surface backstop findings on the write result"
assert_grep 'from "\./lib/story_hook_core\.js"' "$ROOT/plugin.ts" "OpenCode plugin must consume the shared prose-guard core"
# CI has no opencode CLI to actually load the plugin, so this is a structural proxy: the
# deploy manifest must place the core under .opencode/plugins/lib/, never flat in
# .opencode/plugins/ (a flat *.js there is auto-loaded by OpenCode as a broken second plugin).
assert_grep '\.opencode/plugins/lib/story_hook_core\.js' "$REPO_ROOT/skills/story-setup/SKILL.md" "SKILL.md deploy manifest must target .opencode/plugins/lib/story_hook_core.js, not a flat .opencode/plugins/story_hook_core.js"
assert_grep '본문' "$ROOT/plugin.ts" "OpenCode 플러그인은 본문 대상을 검사해야 합니다"
assert_grep '@opencode-ai/plugin' "$ROOT/plugin.ts" "OpenCode plugin must import OpenCode plugin types"
# The shared prose-guard core (light net / outline guard / wordcount·landing·dup-title) deploys
# alongside plugin.ts and is imported by it; it must be byte-identical to the ZCode copy and valid JS.
ZCODE_CORE="$REPO_ROOT/skills/story-setup/references/zcode/hooks/story_hook_core.js"
cmp -s "$ROOT/story_hook_core.js" "$ZCODE_CORE" || fail "story_hook_core.js drifted from the ZCode copy (must be byte-identical)"
node --check "$ROOT/story_hook_core.js" || fail "story_hook_core.js is not valid JavaScript"
assert_grep 'proseNetFindings' "$ROOT/story_hook_core.js" "shared core must carry the light prose net (parity with codex/claude)"
# #242: runtime behavioral test — actually loads the plugin against the deployed core layout and
# exercises the before/after/compacting hooks (stronger than the structural greps above).
node --experimental-strip-types scripts/test-opencode-plugin.mjs
assert_grep 'AGENTS\.md|OpenCode' "$ROOT/AGENTS.md.tmpl" "OpenCode AGENTS template must be present"
assert_grep 'story-long-write|story-short-write|story-review' "$ROOT/AGENTS.md.tmpl" "OpenCode AGENTS template must mention story skill routing"

echo "  OK plugin behavior and instruction anchors"
echo ""
echo "OK: OpenCode adapter checks passed"
