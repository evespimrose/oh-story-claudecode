#!/usr/bin/env python
"""Sync Claude Code agent templates to OpenCode format.

Scans templates/agents/*.md, converts frontmatter to opencode format,
and writes to opencode/agents/. Also syncs CLAUDE.md.tmpl -> AGENTS.md.tmpl.
"""

import argparse
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# agent 본문에서 shell 단계를 표현하는 방식: 「실행 / 실행 / 실행 `<명령어>`」. '실행'만 확인하면 누락될 수 있음—
# #283 읽기 전용 agent에 작성된 권한 초과 명령어는 바로 「실행 `tracking_commit.py check`」를 사용했으며, 두 계층의 가드 모두 막지 못했습니다.
# 읽기 전용 agent에 이런 명령어가 나타나면 생성이 즉시 실패합니다. OpenCode shell.ts는 command의 직계 부모 노드만 확인하며,
# 심지어 '전체 명령어 리터럴' 화이트리스트도 `( command ) > 본문.md`와 같은 subshell 외부 리다이렉션에 의해 우회됩니다.
BODY_COMMAND_RE = re.compile(r"(?:실행|작동|구동) `([^`]+)`")
# 다른 대상에게 실행을 위임하는 것은 본 agent의 shell 단계로 간주하지 않습니다(「상위 프로세스에서 X를 다시 실행하도록 안내」, 「호출자가 메인 세션에서 X를 실행하도록 안내」).
# 동일한 줄에 위임 주체가 나타나는 경우에만 제외하여, '직접 실행'을 위임 문구로 속여서 통과하는 것을 방지합니다.
BODY_DELEGATION_RE = re.compile(r"(호출자|상위 프로세스|메인 세션|사용자|.{0,6}의 프롬프트)")


def body_bash_commands(body: str) -> list[str]:
    """agent 본문에서 명시적으로 실행을 요구한 명령어를 추출합니다(출현 순서대로 중복 제거).

    의도적으로 'agent 이름 하드코딩 집합'을 사용하지 않습니다. 이는 이전 감사에서 generate-codex-agents.py 내에 지적된
    안티 패턴입니다. 명단과 본문이 서로 일치하지 않게 되어, 명령어를 새로 추가한 agent는 권한을 얻지 못하고, 명령어를 삭제한 agent는 불필요하게 권한을 유지하게 됩니다.
    여기서는 본문을 유일한 진실의 원천(Source of Truth)으로 삼으며, 읽기 전용 agent에서 명령어가 추출되면 변환 단계에서 중단됩니다.
    """
    commands: list[str] = []
    for line in body.splitlines():
        if BODY_DELEGATION_RE.search(line):
            continue
        for match in BODY_COMMAND_RE.finditer(line):
            command = match.group(1).strip()
            if command and command not in commands:
                commands.append(command)
    return commands


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Extract YAML-like frontmatter and body from markdown content."""
    # 종료 구분자는 반드시 한 줄을 독점하는 `---`여야 하며("\n---\n"에 앵커링), content.split("---", 2)를 사용할 수 없습니다.
    # 후자는 frontmatter 값 내의 세 개의 하이픈(설명 내의 `---`, 주석 내의 `---`)을 종료 표시로 오인하여,
    # 나머지 키들을 permission/steps와 함께 본문으로 잘라내 버리고, 아무런 경고 없이 exit 0으로 종료됩니다.
    # 동일한 소스 생성기인 generate-codex-agents.py의 파싱 로직과 일관성을 유지합니다.
    if not content.startswith("---\n"):
        return {}, content
    end = content.find("\n---\n", len("---"))
    if end < 0:
        return {}, content
    fm_text = content[len("---") : end].strip()
    body = content[end + len("\n---") :]
    fm = {}
    lines = fm_text.split("\n")
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()

        if not stripped or stripped.startswith("#"):
            i += 1
            continue

        if ":" in stripped:
            key, _, val = stripped.partition(":")
            key = key.strip()
            val = val.strip()

            if val == "|":
                continuation = []
                i += 1
                while i < len(lines):
                    cont_line = lines[i]
                    if cont_line.startswith((" ", "\t")) and cont_line.strip():
                        continuation.append(cont_line.strip())
                        i += 1
                    elif not cont_line.strip():
                        continuation.append("")
                        i += 1
                    else:
                        break
                fm[key] = "\n".join(continuation).strip()
                continue
            else:
                fm[key] = val

        i += 1

    return fm, body


def convert_claude_to_opencode(fm: dict, body: str) -> dict:
    """Convert Claude Code agent frontmatter to OpenCode format.

    `body`는 필수 항목입니다. bash 화이트리스트는 '본문에서 실제로 해당 명령어의 실행을 요구하는지'에 따라 agent별로 권한을 부여하므로,
    본문 전달이 누락되면 권한이 임의로 축소되거나 확장될 수 있으므로, 여기서는 호출자가 반드시 본문을 전달하도록 강제합니다.
    """
    result = {}
    name = fm.get("name", "")

    if "description" in fm:
        result["description"] = fm["description"]

    result["mode"] = "subagent"

    tools = _parse_list(fm.get("tools", ""))
    disallowed = _parse_list(fm.get("disallowedTools", ""))

    perm = {}
    if any(t in tools for t in ("Read", "Glob", "Grep")):
        perm["read"] = "allow"
    has_write = any(t in tools for t in ("Write", "Edit"))
    has_edit_disallowed = any(t in disallowed for t in ("Write", "Edit"))

    # deny priority: disallowedTools overrides Write/Edit in tools
    # story-researcher is a known exception — opencode's edit permission controls
    # both Write and Edit, cannot distinguish. story-researcher needs to create
    # new files (research output), so set edit: allow
    if name == "story-researcher":
        perm["edit"] = "allow"
    elif has_edit_disallowed:
        perm["edit"] = "deny"
    elif has_write:
        perm["edit"] = "allow"

    # bash 역시 "disallowedTools 우선" 원칙을 따릅니다. OpenCode에서 bash 권한이 선언되지 않은 경우 기본값은 ask이며, 읽기 전용 agent는
    # 반드시 스칼라 deny로 작성하여 상위 disabled()에서 bash 도구를 직접 제거하도록 해야 합니다. '읽기 전용 명령어' 화이트리스트를 추가하지 마세요.
    # shell.ts는 command의 직계 부모 노드만 권한을 확인하므로, `( allowlisted-command ) > 본문.md`와 같이 작성하면 외부 리디렉션이
    # subshell 외부에 숨겨져 리터럴 화이트리스트로도 파일 시스템 경계를 보호할 수 없습니다.
    mentioned_bash = body_bash_commands(body)
    restricted_bash = "Bash" in disallowed
    if restricted_bash:
        if mentioned_bash:
            raise ValueError(
                f"{name or '<unnamed>'}: 읽기 전용 agent는 Bash가 금지되지만, 본문에서 실행을 요청함: "
                + ", ".join(f"`{command}`" for command in mentioned_bash)
                + "; 호스트가 이미 제공한 워크스페이스와 Read/Glob/Grep을 사용하도록 본문을 수정하세요. shell 예외를 허용해서는 안 됩니다."
            )
        perm["bash"] = "deny"
    elif "Bash" in tools:
        perm["bash"] = "allow"
    if perm:
        result["permission"] = perm

    if "maxTurns" in fm:
        try:
            result["steps"] = int(fm["maxTurns"])
        except ValueError:
            pass

    return result


def _parse_list(val: str) -> list[str]:
    """Parse a YAML-like list like '[Read, Glob, Grep]'."""
    match = re.search(r"\[(.*)\]", val)
    if not match:
        return []
    items = match.group(1).split(",")
    return [item.strip().strip("'").strip('"') for item in items if item.strip()]


def format_frontmatter(fm: dict) -> str:
    """Format frontmatter dict to YAML-like string."""
    lines = ["---"]
    for key, value in fm.items():
        if key == "permission" and isinstance(value, dict):
            lines.append("permission:")
            for pk, pv in value.items():
                if isinstance(pv, dict):
                    # 명령 glob 형식(예: bash): glob 키에는 반드시 따옴표를 붙여야 합니다. YAML에서 단독 `*`는 별칭(alias) 표시입니다.
                    # 여기의 키를 정렬하는 것은 엄격히 금지됩니다. OpenCode는 findLast로 파싱하므로 나중에 작성된 규칙이 먼저 작성된 규칙을 덮어씁니다.
                    # 키 순서가 곧 우선순위입니다. 반드시 dict의 삽입 순서대로 출력해야 합니다.
                    lines.append(f"  {pk}:")
                    for glob, action in pv.items():
                        lines.append(f'    "{glob}": {action}')
                else:
                    lines.append(f"  {pk}: {pv}")
        elif key == "description" and "\n" in value:
            lines.append("description: |")
            for desc_line in value.split("\n"):
                lines.append(f"  {desc_line}")
        else:
            lines.append(f"{key}: {value}")
    lines.append("---")
    return "\n".join(lines) + "\n"


def replace_claude_paths(body: str) -> str:
    """Replace .claude/ path references with .opencode/ equivalents.

    경로 규칙 섹션은 fix_path_rules_section()에서 멱등성 있게 처리되므로 수동으로 수정할 필요가 없습니다.
    """
    replacements = [
        (".claude/skills/", ".opencode/skills/"),
        (".claude/agents/", ".opencode/agents/"),
        (".claude/hooks/", ".opencode/hooks/"),
        ("~/.claude/", "~/.config/opencode/"),
        ("$HOME/.claude/", "$HOME/.config/opencode/"),
        ("CLAUDE.md", "AGENTS.md"),
    ]
    for old, new in replacements:
        if old in body:
            body = body.replace(old, new)
    return body


def fix_path_rules_section(body: str) -> str:
    """Replace the reference file path rules section with correct opencode paths.

    "참고 파일 경로 규칙" 섹션을 감지하고 이를 다음으로 교체합니다.
    canonical path that story-setup deploys for OpenCode.
    This is idempotent — running multiple times produces the same output.
    """
    # Some agents do not read reference files and intentionally have no such
    # section. Only warn when the section marker exists but its shape drifted.
    if "참고 파일 경로 규칙" not in body:
        return body

    pattern = r"(## 참고 파일 경로 규칙\s*\*\*프로젝트 루트 디렉터리 확정:\*\*.*?\s*)참고 파일 읽기 시.*?(?=\s*읽기 전용 금지|\r?\n## )"

    replacement = (
        r"\1"
        r"참고 파일을 읽을 때 현재 OpenCode에 배포된 canonical 경로를 직접 Read하며, Glob/Grep으로 먼저 검색하는 것을 금지합니다:\n"
        r"1. `{프로젝트 루트}/skills/story-setup/references/agent-references/{파일명}`\n"
        r"\n"
        r"파일이 존재하지 않으면 누락된 사실을 반환하고, 부모 프로세스에서 `/story-setup`을 다시 실행하도록 안내합니다. 다른 CLI 디렉터리를 탐색하지 마세요."
    )

    new_body, count = re.subn(pattern, replacement, body, flags=re.DOTALL)
    if count == 0:
        print(
            "  [WARN] fix_path_rules_section: 경로 규칙 섹션이 감지되지 않았습니다. 원본 템플릿 형식이 변경되었을 수 있습니다.",
            file=sys.stderr,
        )
    return new_body


def file_status(dst: Path, output: str) -> tuple[str, bool]:
    """Compare one generated file without mutating the destination."""
    if not os.path.lexists(dst):
        return "missing", True
    if dst.is_symlink() or not dst.is_file():
        return "stale", True
    old_content = dst.read_text(encoding="utf-8")
    if old_content == output:
        return "unchanged", False
    return "stale", True


def render_agents() -> dict[str, str]:
    """Validate and render every OpenCode agent before any destination write."""
    src_dir = ROOT / "skills/story-setup/references/templates/agents"
    sources = sorted(src_dir.glob("*.md"))
    if not sources:
        raise RuntimeError(f"no agent markdown files found in {src_dir}")
    rendered: dict[str, str] = {}
    for md_file in sources:
        content = md_file.read_text(encoding="utf-8")
        fm, body = parse_frontmatter(content)
        name = str(fm.get("name", "")).strip()
        description = str(fm.get("description", "")).strip()
        if not name:
            raise ValueError(f"{md_file}: missing agent name")
        if name != md_file.stem:
            raise ValueError(
                f"{md_file}: agent name {name!r} must match filename {md_file.stem!r}"
            )
        if not description:
            raise ValueError(f"{md_file}: missing agent description")
        # **원본 템플릿 본문**(.claude→.opencode 경로 교체가 수행되지 않음)을 사용하여 bash 화이트리스트를 도출합니다:
        # 권한 부여 기준은 생성된 결과물의 문구가 아니라 원본 정의에 해당 명령어가 작성되었는지 여부입니다.
        new_fm = convert_claude_to_opencode(fm, body)
        new_body = replace_claude_paths(body)
        new_body = fix_path_rules_section(new_body)  # 경로 규칙 섹션의 잘못된 교체를 덮어씀
        output = format_frontmatter(new_fm) + new_body
        output = output.rstrip("\n") + "\n"  # 줄 끝을 단일 줄바꿈으로 정규화하여 EOF 빈 줄 방지
        if md_file.name in rendered:
            raise ValueError(f"duplicate generated agent filename: {md_file.name}")
        rendered[md_file.name] = output
    return rendered


def agent_statuses(
    rendered: dict[str, str], dst_dir: Path, check: bool
) -> tuple[list[str], bool]:
    """Return deterministic status lines for the generated agent surface."""
    results: list[str] = []
    changed = False
    for filename, output in rendered.items():
        dst_file = dst_dir / filename
        raw_status, file_changed = file_status(dst_file, output)
        if check:
            status = raw_status
        else:
            status = (
                "created"
                if raw_status == "missing"
                else "updated"
                if raw_status == "stale"
                else raw_status
            )
        changed = changed or file_changed
        results.append(f"  [{status}] {dst_file.name}")

    for stale in sorted(dst_dir.glob("*.md")):
        if stale.name in rendered:
            continue
        changed = True
        results.append(f"  [{'extra' if check else 'deleted'}] {stale.name}")

    return results, changed


def render_agents_md() -> str:
    """Validate and render CLAUDE.md.tmpl for OpenCode."""
    src = ROOT / "skills/story-setup/references/templates/CLAUDE.md.tmpl"
    if not src.is_file():
        raise RuntimeError(f"source template not found: {src}")

    content = src.read_text(encoding="utf-8")
    new_content = replace_claude_paths(content)
    return new_content.rstrip("\n") + "\n"  # 행 끝을 단일 줄바꿈으로 표준화하여 EOF 공백 라인 방지


def publish_tree(rendered: dict[str, str], agents_md: str, dst_root: Path) -> None:
    """Publish generated OpenCode files with rollback, preserving manual assets."""
    if dst_root.is_symlink():
        raise ValueError(f"destination directory must not be a symlink: {dst_root}")
    if dst_root.exists() and not dst_root.is_dir():
        raise ValueError(f"destination is not a directory: {dst_root}")
    existing_agents = dst_root / "agents"
    if existing_agents.is_symlink():
        raise ValueError(
            f"generated agents directory must not be a symlink: {existing_agents}"
        )
    if existing_agents.exists() and not existing_agents.is_dir():
        raise ValueError(
            f"generated agents path is not a directory: {existing_agents}"
        )

    dst_root.mkdir(parents=True, exist_ok=True)
    existing_agents.mkdir(parents=True, exist_ok=True)
    staging = Path(
        tempfile.mkdtemp(prefix=f".{dst_root.name}.staging-", dir=dst_root.parent)
    )
    backup = Path(
        tempfile.mkdtemp(prefix=f".{dst_root.name}.backup-", dir=dst_root.parent)
    )
    try:
        agents_dir = staging / "agents"
        backup_agents = backup / "agents"
        agents_dir.mkdir()
        backup_agents.mkdir()
        for filename, output in rendered.items():
            (agents_dir / filename).write_text(output, encoding="utf-8", newline="\n")

        staged_agents_md = staging / "AGENTS.md.tmpl"
        staged_agents_md.write_text(agents_md, encoding="utf-8", newline="\n")

        existing_md = sorted(existing_agents.glob("*.md"))
        for path in existing_md:
            if path.is_dir() and not path.is_symlink():
                raise IsADirectoryError(f"generated target is a directory: {path}")
            if path.is_symlink():
                (backup_agents / path.name).symlink_to(os.readlink(path))
            else:
                shutil.copy2(path, backup_agents / path.name)

        target_agents_md = dst_root / "AGENTS.md.tmpl"
        had_agents_md = os.path.lexists(target_agents_md)
        if target_agents_md.is_dir() and not target_agents_md.is_symlink():
            raise IsADirectoryError(
                f"generated target is a directory: {target_agents_md}"
            )
        if had_agents_md:
            if target_agents_md.is_symlink():
                (backup / "AGENTS.md.tmpl").symlink_to(
                    os.readlink(target_agents_md)
                )
            else:
                shutil.copy2(target_agents_md, backup / "AGENTS.md.tmpl")

        try:
            for filename in rendered:
                os.replace(agents_dir / filename, existing_agents / filename)
            os.replace(staged_agents_md, target_agents_md)
            for stale in existing_md:
                if stale.name not in rendered:
                    stale.unlink()
        except BaseException:
            # Best-effort rollback: a single un-removable file must not abort the
            # restore and strand a partial commit. Backed-up files are overwritten
            # in place; only outputs absent before the commit are removed.
            restore_names = {path.name for path in backup_agents.iterdir()}
            for current in list(existing_agents.glob("*.md")):
                if current.is_dir() and not current.is_symlink():
                    continue
                if current.name in restore_names:
                    continue
                try:
                    current.unlink()
                except OSError:
                    pass
            for original in backup_agents.iterdir():
                target = existing_agents / original.name
                try:
                    if original.is_symlink():
                        if target.is_symlink() or target.exists():
                            target.unlink()
                        target.symlink_to(os.readlink(original))
                    else:
                        # target is provably a regular file (a commit only
                        # os.replace's regular staged outputs), so copy2 safely
                        # overwrites it in place.
                        shutil.copy2(original, target)
                except OSError:
                    pass
            original_agents_md = backup / "AGENTS.md.tmpl"
            try:
                if had_agents_md:
                    if original_agents_md.is_symlink():
                        if target_agents_md.is_symlink() or target_agents_md.exists():
                            target_agents_md.unlink()
                        target_agents_md.symlink_to(os.readlink(original_agents_md))
                    else:
                        shutil.copy2(original_agents_md, target_agents_md)
                elif os.path.lexists(target_agents_md) and (
                    not target_agents_md.is_dir() or target_agents_md.is_symlink()
                ):
                    target_agents_md.unlink()
            except OSError:
                pass
            raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)
        shutil.rmtree(backup, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify generated files without modifying the working tree",
    )
    args = parser.parse_args()

    # The agents and top-level instructions form one generated adapter. Render
    # and validate both phases before inspecting or publishing either one.
    rendered = render_agents()
    agents_md = render_agents_md()
    dst_root = ROOT / "skills/story-setup/references/opencode"
    agent_results, agents_changed = agent_statuses(
        rendered, dst_root / "agents", args.check
    )
    raw_md_status, agents_md_changed = file_status(
        dst_root / "AGENTS.md.tmpl", agents_md
    )
    if args.check:
        md_status = raw_md_status
    else:
        md_status = (
            "created"
            if raw_md_status == "missing"
            else "updated"
            if raw_md_status == "stale"
            else raw_md_status
        )

    print("=== opencode sync script ===\n")
    print("1. Syncing agents...")
    for r in agent_results:
        print(r)

    print("\n2. Syncing AGENTS.md.tmpl...")
    print(f"  [{md_status}] AGENTS.md.tmpl")

    if args.check:
        if agents_changed or agents_md_changed:
            print(
                "\nERROR: generated OpenCode templates are out of sync.",
                file=sys.stderr,
            )
            return 1
        print("\nOK: generated OpenCode templates are in sync.")
        return 0

    publish_tree(rendered, agents_md, dst_root)

    print("\n3. Manual maintenance required:")
    print("  - skills/story-setup/references/opencode/plugin.ts (hooks logic)")
    print("  - skills/story-setup/references/opencode/commands/ (slash commands)")
    print(
        "  - skills/story-setup/references/opencode/opencode.json.patch (config fragment)"
    )
    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
