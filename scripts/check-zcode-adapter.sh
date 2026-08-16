#!/usr/bin/env bash
# Deterministic checks for the ZCode plugin and story-setup deployment surface.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_file() { [ -f "$1" ] || fail "required file missing: $1"; }
assert_grep() { grep -Eq "$1" "$2" || fail "$3 ($2)"; }

ROOT="skills/story-setup/references/zcode"
HOOK="$ROOT/hooks/story_zcode_hook.js"
HOOK_CORE="$ROOT/hooks/story_hook_core.js"

echo "ZCode adapter check"
echo "==================="
echo "Repo: $REPO_ROOT"

for file in \
  .zcode-plugin/plugin.json \
  marketplace.json \
  "$ROOT/AGENTS.md.tmpl" \
  "$ROOT/config.json.patch" \
  "$ROOT/hooks/hooks.json" \
  "$HOOK" \
  "$HOOK_CORE"; do
  assert_file "$file"
done

for file in .zcode-plugin/plugin.json marketplace.json "$ROOT/config.json.patch" "$ROOT/hooks/hooks.json"; do
  python3 -m json.tool "$file" >/dev/null
done
node --check "$HOOK"
node --check "$HOOK_CORE"
echo "  OK JSON/JavaScript syntax"

python3 - <<'PY'
import json, re
from pathlib import Path

plugin = json.loads(Path('.zcode-plugin/plugin.json').read_text())
assert re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,127}', plugin['name'])
assert plugin['name'] == 'oh-story'
assert plugin['skills'] == 'skills'
assert plugin['commands'] == 'skills/story-setup/references/zcode/commands'
assert plugin['hooks'] == 'skills/story-setup/references/zcode/hooks/hooks.json'
for key in ('agents', 'channels', 'lspServers', 'outputStyles', 'settings'):
    assert key not in plugin, f'non-runnable ZCode component declared: {key}'

market = json.loads(Path('marketplace.json').read_text())
assert market['name'] == 'oh-story-zcode'
assert market['version'] == 1
assert len(market['plugins']) == 1
entry = market['plugins'][0]
assert entry['name'] == plugin['name'] and entry['source'] == './'
assert entry['version'] == plugin['version']
assert plugin['version'] == Path('skills/story/VERSION').read_text().strip()
PY
echo "  OK native plugin/marketplace manifest"

python3 - <<'PY'
import re
from pathlib import Path

skills = sorted(Path('skills').glob('*/SKILL.md'))
commands = sorted(Path('skills/story-setup/references/zcode/commands').glob('*.md'))
assert len(skills) == 13, f'expected 13 skills, got {len(skills)}'
assert len(commands) == 13, f'expected 13 commands, got {len(commands)}'
expected = {p.parent.name for p in skills}
assert {p.stem for p in commands} == expected

for skill in skills:
    text = skill.read_text(encoding='utf-8')
    front = text.split('---', 2)[1]
    name = re.search(r'^name:\s*["\']?([^"\'\n]+)', front, re.M)
    desc = re.search(r'^description:\s*(.+)$', front, re.M)
    assert name and name.group(1).strip() == skill.parent.name, skill
    assert desc, f'{skill}: missing description'
    value = desc.group(1).strip().strip('"\'')
    assert len(value) <= 1024, f'{skill}: description too long'

allowed = {'description', 'argument-hint', 'allowed-tools', 'model', 'skills', 'disable-noninteractive'}
for command in commands:
    assert re.fullmatch(r'[a-z0-9][a-z0-9_:-]{0,63}', command.stem), command
    text = command.read_text(encoding='utf-8')
    assert text.startswith('---\n'), command
    front, body = text.split('---', 2)[1:]
    keys = {line.split(':', 1)[0] for line in front.splitlines() if ':' in line}
    assert keys <= allowed, f'{command}: unsupported keys {keys - allowed}'
    assert 'description' in keys and 'skills' in keys
    assert '$ARGUMENTS' in body
PY
echo "  OK 13 Skills + 13 Commands (schema and one-to-one names)"

python3 - <<'PY'
import json
from pathlib import Path

supported = {'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop'}
# 이벤트 → 허용된 handler. 집합으로만 handler 이름을 검증("이름이 화이트리스트에 있으면 통과")하는 것은 검증을 통과시키는 것과 같음
# "SessionStart에 post-tool-prose-check 연결"처럼 통째로 복사해서 붙여넣은 후 args[1] 수정을 잊어버리는 오류:
# story_zcode_hook.js는 process.argv[2]만 보고 분기하며 hook_event_name을 비교하지 않음. 런타임 동작은
# 세션 시작 시 컨텍스트가 주입되지 않거나 / 작성 후 검사에서 잘못된 payload를 받아도 아무것도 보고하지 않음. 반드시 이벤트별로 고정해야 함.
EVENT_HANDLERS = {
    'SessionStart': {'session-start'},
    'PreToolUse': {'pre-tool-prose-guard', 'pre-tool-commit-advisory'},
    'PostToolUse': {'post-tool-prose-check'},
}
plugin = json.loads(Path('skills/story-setup/references/zcode/hooks/hooks.json').read_text())['hooks']
config = json.loads(Path('skills/story-setup/references/zcode/config.json.patch').read_text())['hooks']
assert config['enabled'] is True
assert set(plugin) == set(EVENT_HANDLERS)
assert set(config['events']) == set(plugin)
assert set(plugin) <= supported

def flatten(events):
    # 반드시 이벤트명을 함께 가져와야 함: event key를 누락하면 handler를 해당 서비스 이벤트에 다시 바인딩할 수 없음.
    return [(event, hook) for event, groups in events.items() for group in groups for hook in group['hooks']]

plugin_hooks = flatten(plugin)
workspace_hooks = flatten(config['events'])
assert len(plugin_hooks) == len(workspace_hooks) == 4
expected_routes = {(event, handler) for event, handlers in EVENT_HANDLERS.items() for handler in handlers}
# 두 등록 정보는 각각 독립적으로 대조됨: hooks.json만 수정하고 config.json.patch를 수정하지 않거나(또는 그 반대) 발생하는 드리프트(drift)도 똑같이 실패(Red) 처리해야 함.
# 두 파일은 수동으로 별도 관리되며, check-shared-files.sh는 의도적으로 hooks.json을 바이트 단위 패리티(parity) 체크에서 제외함.
for source, pairs in (('hooks.json', plugin_hooks), ('config.json.patch', workspace_hooks)):
    for event, hook in pairs:
        assert set(hook) <= {'type', 'command', 'args', 'timeoutMs'}
        assert hook['type'] == 'process' and hook['command'] == 'node'
        assert hook['args'][1] in EVENT_HANDLERS[event], (
            f'{source}: {event}가 잘못된 handler로 라우팅됨', hook['args'][1], sorted(EVENT_HANDLERS[event]))
    routes = {(event, hook['args'][1]) for event, hook in pairs}
    assert routes == expected_routes, (
        f'{source}: event→handler 등록 드리프트', sorted(expected_routes - routes), sorted(routes - expected_routes))
post_groups = plugin['PostToolUse']
assert len(post_groups) == 1 and post_groups[0]['matcher'] == 'Bash|Write|Edit|ApplyPatch'
# 라우팅 테스트("runner 직접 호출로 matcher 우회"로 인한 가짜 통과 방지): pre-tool-prose-guard의 matcher는 plugin
# 및 workspace config 양쪽에서 일치해야 하며, test-zcode-hooks가 제공하는 모든 도구를 라우팅할 수 있어야 함 — 다음 포함:
# ApplyPatch(본문을 작성하는 apply-patch 대상은 runner 직접 호출로 차단되는 것이 아니라, 실제로 matcher에 의해 handler로 전달되어야 함).
import re
def prose_guard_matcher(events):
    for group in events['PreToolUse']:
        if any(h['args'][1] == 'pre-tool-prose-guard' for h in group['hooks']):
            return group['matcher']
    return None
mc = prose_guard_matcher(config['events'])
mp = prose_guard_matcher(plugin)
assert mc is not None and mc == mp, ('pre-tool-prose-guard matcher drift between config and plugin', mc, mp)
for tool in ('Bash', 'Write', 'Edit', 'ApplyPatch'):
    assert re.search(mc, tool), ('pre-tool-prose-guard matcher does not route tool', tool, mc)
for _event, hook in plugin_hooks:
    assert hook['args'][0].startswith('${ZCODE_PLUGIN_ROOT}/')
for _event, hook in workspace_hooks:
    assert hook['args'][0] == '${ZCODE_PROJECT_DIR}/.zcode/hooks/story_zcode_hook.js'
PY
echo "  OK supported events + strict process-hook shape"

if grep -RqsE 'PreCompact|PostCompact|SessionEnd|SubagentStop|Notification' "$ROOT/hooks" "$ROOT/config.json.patch"; then
  fail "ZCode adapter contains unsupported hook events"
fi
[ ! -e "$ROOT/agents" ] || fail "ZCode 3.3.4 must not ship project agents"
[ ! -e "$ROOT/rules" ] || fail "ZCode has no .zcode/rules discovery surface"

assert_grep '\$story-long-write|\$story-setup' "$ROOT/AGENTS.md.tmpl" 'ZCode AGENTS template must document $skill invocation'
assert_grep 'project custom agents unavailable.*solo|프로젝트.*custom agents를 실행하지 않음' "$ROOT/AGENTS.md.tmpl" "ZCode AGENTS template must document solo fallback"
assert_grep 'target_cli = zcode|target_cli.*zcode' skills/story-setup/SKILL.md "story-setup must document zcode target_cli"
assert_grep 'references/zcode/config\.json\.patch' skills/story-setup/SKILL.md "story-setup manifest missing ZCode config patch"
# 조합 설치 검증 프록시(CI에는 ZCode 런타임 없음): 플러그인 manifest와 workspace config가 동일한 hooks 세트를 등록함.
# 배포 알고리즘은 두 항목의 상호 배타성을 기록해야 하며(플러그인 설치 시 config hooks 병합 건너뜀), 그렇지 않으면 PreToolUse/PostToolUse가 중복 실행됨.
assert_grep 'hooks 상호 배타적' skills/story-setup/SKILL.md "story-setup must document the plugin/workspace hooks mutex (skip config hooks merge when plugin installed, avoid double-firing)"
assert_grep '\.zcode/skills/story-setup/references/agent-references' skills/story-setup/SKILL.md "story-setup missing ZCode reference path"

for skill in story-long-write story-short-write story-long-analyze story-import story-deslop story-review; do
  assert_grep 'ZCode 3\.3\.4|\.zcode/' "skills/$skill/SKILL.md" "$skill must document ZCode fallback"
done

echo "  OK deployment instructions + explicit capability boundaries"
echo ""
echo "OK: ZCode adapter checks passed"
