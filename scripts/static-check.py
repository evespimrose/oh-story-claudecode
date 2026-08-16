#!/usr/bin/env python3
"""Structured, dependency-free validation for repository skill Markdown."""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote


ATX_HEADING_RE = re.compile(r"^[ ]{0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+[ \t]*)?$")
OPEN_FENCE_RE = re.compile(r"^[ ]{0,3}(`{3,}|~{3,})(.*)$")
LINK_RE = re.compile(r"!?\[[^\]\n]*\]\(([^)\n]+)\)")
INLINE_CODE_RE = re.compile(r"(?<!`)`([^`\n]+)`(?!`)")
# 오직 "강조 기호가 하나의 skill 내 경로를 완전히 감싸는" 형태만 복원합니다. 시작/종료 marker는 반드시 같은 너비여야 하고,
# 양쪽에 ASCII 경로 문자가 붙을 수 없습니다. 그래야 CJK 연속 텍스트의 references/*.md와 references/*.json
# 이 두 개의 glob 별표를 강조 기호 한 쌍으로 잘못 조합하지 않습니다.
EMPHASIS_PATH_RE = re.compile(
    r"(?<![A-Za-z0-9_./-])(?P<marker>\*{1,2})"
    r"(?P<path>(?:[a-z0-9_-]+/)?(?:references|scripts|assets)/[^\s*]+)"
    r"(?P=marker)(?![A-Za-z0-9_./-])"
)
SKILL_PATH_PREFIX = r"(?:[a-z0-9_-]+/)?(?:references|scripts|assets)/"
# 중문 설명에서는 여러 경로를 `references/*.md와assets/*.json`처럼 씁니다. 반복 부분은 "연결 단어 +
# 다음 경로 접두사" 앞에서 멈춰야 하며, 그렇지 않으면 첫 번째 match가 전체 문자열을 가져가고, normalize_path_token이 첫 번째
# `*` 는 references/ 로 잘려서, 뒤의 누락된 경로는 독립적인 검증에 참여하지 않습니다.
SKILL_PATH_RE = re.compile(
    r"(?<![A-Za-z0-9_-])(?P<path>"
    + SKILL_PATH_PREFIX
    + r"(?:(?!(?:with|and|or|、)"
    + SKILL_PATH_PREFIX
    + r")[^\s`\"')\]><「（，。；：、])+)"
)
ASCII_MD_RE = re.compile(r"^[a-z0-9_-]+\.md$")
INLINE_MD_PATH_RE = re.compile(
    r"(?P<path>(?:[A-Za-z0-9._-]+/)*[a-z0-9_-]+\.md)(?=$|[^A-Za-z0-9_.-])"
)
AGENT_REF_RES = (
    re.compile(r"subagent_type\s*:\s*\"([a-z][a-z0-9_-]*)\""),
    re.compile(r"subagent_type\s*=\s*\"([a-z][a-z0-9_-]*)\""),
    # 괄호 형태는 전각/반각 괄호와 콜론을 동시에 허용합니다 (본문 주석에서는 보통 「（subagent_type: x）」 형태로 작성됨).
    # 인용부호는 선택사항입니다. 괄호 닫음 앵커포인트를 유지합니다: 호환성 설명에서 `subagent_type` 항목이 많이 나타나므로,
    # 괄호/인용부호가 없는 맨 형태는 이러한 비인용 문맥을 agent 참조로 잘못 포착합니다.
    re.compile(r"[（(]subagent_type\s*[:：]\s*\"?([a-z][a-z0-9_-]*)\"?\s*[)）]"),
)
# 「SKILL.md + 섹션 이름 참조」는 링크 검증이 불가능한 텍스트 추측입니다: SKILL.md의 제목이 변경된 후 참조는 자동으로 실패합니다.
# 구분자 양쪽에 \s* 통일 적용——중문 본문의 「SKILL.md의 단계2 프로세스를 자세히 보기」는 공백이 없으며, 이것이 바로 가장 일반적인 작성 방식입니다.
# `\s+`만 인식하면 이러한 작성 방식이 본 규칙을 완전히 우회하게 됩니다.
# 섹션명 첫 문자에서 괄호/인용부호/파이프/해시 제외: `SKILL.md「출력 디렉터리 구조」 참조`、`SKILL.md（…） 참조`、
# 테이블의 `SKILL.md）|` 참조는 제목이나 문장 끝을 원래대로 인용한 것이므로 본 규칙에서 정리할 모호한 추측에 해당하지 않습니다.
UNLINKED_SECTION_RE = re.compile(
    r"(?:见|참조|참조|상세 참조)\s*SKILL\.md\s*"
    r"[^\s，。；;、（）()「」『』【】《》〈〉\[\]{}<>#|\"'""'']"
    r"[^，。；;\n]*"
)
EXTERNAL_SCHEMES = ("http://", "https://", "ftp://", "mailto:", "data:", "tel:")
DEPLOYED_RUNTIME_PREFIXES = (".claude/", ".codex/", ".opencode/")
# browser-cdp is the repository's explicit infrastructure skill.  Business
# skills may reference its launcher; every other cross-skill file path remains
# forbidden so domain workflows stay self-contained.
FOUNDATION_SKILL_REFERENCES = frozenset({"browser-cdp"})
# 변경 로그는 정의에 따라 과거 상태를 기록합니다. 인라인 경로는 당시의 참조입니다(삭제됨/이동됨/다른 skill의 구 파일 포함).
# 현재 런타임 의존성이 아니므로 skill 간 검증이나 데드 링크 검증을 수행하지 않습니다(check-current-skill-contracts.py의 스킵 규칙과 동일).
CHANGELOG_DOCS = frozenset({"UPGRADING.md", "CHANGELOG.md"})
EXTERNAL_URL_RE = re.compile(
    r"(?i)\b(?:https?|ftp)://[^\s<>\"'`]+"
)
# 중괄호 열거형(쉼표 포함)은 "개별 명시"이며, 구체적 경로로 전개할 수 있습니다. `{제재}` 같은 단일 자리 표시자는 열거형이 아닙니다.
BRACE_LIST_RE = re.compile(r"\{([^{}/]*,[^{}/]*)\}")
# skill 간 검사는 모든 텍스트 자산을 다룹니다. 템플릿(*.md.tmpl / *.json.patch)과 프론트엔드 자산은 story-setup으로 작가 프로젝트에 배포되므로
# 검사 누락은 배포 단계에서 "skill 자체 포함"이라는 레드라인을 무효화하는 것과 같습니다.
SKILL_TEXT_SUFFIXES = {
    ".cmd",
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".mjs",
    ".patch",
    ".py",
    ".sh",
    ".tmpl",
    ".toml",
    ".ts",
    ".yaml",
    ".yml",
}


@dataclass(frozen=True)
class SourceRef:
    line: int
    raw: str
    kind: str


@dataclass(frozen=True)
class Issue:
    severity: str
    code: str
    path: Path
    line: int
    message: str


@dataclass
class Document:
    path: Path
    anchors: set[str] = field(default_factory=set)
    refs: list[SourceRef] = field(default_factory=list)
    agent_refs: list[tuple[int, str]] = field(default_factory=list)
    unlinked_sections: list[tuple[int, str]] = field(default_factory=list)


def display(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


def inside_root(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return True


def skill_owner(path: Path, root: Path) -> str | None:
    try:
        relative = path.resolve().relative_to((root / "skills").resolve())
    except ValueError:
        return None
    return relative.parts[0] if relative.parts else None


def markdown_slug(title: str) -> str:
    """Return the GitHub-style subset used by this repository's headings."""

    result: list[str] = []
    for char in title.strip().lower():
        category = unicodedata.category(char)
        if char.isspace():
            result.append("-")
        elif char in "-_" or category[0] in {"L", "M", "N"}:
            result.append(char)
    return "".join(result)


def strip_link_title(target: str) -> str:
    target = target.strip()
    if target.startswith("<") and ">" in target:
        return target[1 : target.index(">")]
    match = re.match(r"^(.*?)(?:\s+[\"'].*[\"'])?$", target)
    return (match.group(1) if match else target).strip()


def is_external_ref(raw: str) -> bool:
    return raw.strip().lower().startswith(EXTERNAL_SCHEMES)


def strip_inline_markup(line: str) -> str:
    line = LINK_RE.sub("", line)
    return INLINE_CODE_RE.sub("", line)


def path_alternatives(raw: str) -> list[str]:
    """점명 열거 `{a,b,c}`를 개별 경로로 전개합니다.

    `{story_codex_hook.py,run-story-hook.sh,run-story-hook.cmd}`는 저자가 하나하나 점명한 파일이며,
    세 개의 참조를 각각 작성하는 것과 동등합니다. 전개 후 각각이 존재성 및 도달성 검증에 참여합니다. `{주제}`과 같은 단일 자리표시자는
    열거가 아니며(어떤 파일도 점명하지 않음), normalize_path_token에 와일드카드 처리로 그대로 전달됩니다.
    """

    match = BRACE_LIST_RE.search(raw)
    if not match:
        return [raw]
    head, tail = raw[: match.start()], raw[match.end() :]
    parts = [part.strip() for part in match.group(1).split(",")]
    return [f"{head}{part}{tail}" for part in parts if part]


def normalize_path_token(raw: str) -> tuple[str, bool]:
    token = raw.rstrip(".,;:!?，。；：！？|）】」』")
    dynamic = any(char in token for char in "*?{[")
    if dynamic:
        cut = min((token.find(char) for char in "*?{[" if char in token), default=len(token))
        token = token[:cut]
        if token and not token.endswith("/"):
            token = token.rsplit("/", 1)[0] + "/"
    return token, dynamic


def parse_document(path: Path) -> Document:
    text = path.read_text(encoding="utf-8")
    document = Document(path=path)
    fence_char: str | None = None
    fence_size = 0
    slug_counts: dict[str, int] = {}

    for line_number, line in enumerate(text.splitlines(), start=1):
        if fence_char is not None:
            closing_fence = re.fullmatch(
                r"[ ]{0,3}"
                + re.escape(fence_char)
                + r"{"
                + str(fence_size)
                + r",}[ \t]*",
                line,
            )
            if closing_fence:
                fence_char = None
                fence_size = 0
            continue

        opening_fence = OPEN_FENCE_RE.match(line)
        if opening_fence:
            marker, info = opening_fence.groups()
            if marker[0] == "`" and "`" in info:
                opening_fence = None
            else:
                fence_char = marker[0]
                fence_size = len(marker)
                continue

        for pattern in AGENT_REF_RES:
            document.agent_refs.extend(
                (line_number, match.group(1)) for match in pattern.finditer(line)
            )

        heading = ATX_HEADING_RE.match(line)
        if heading:
            base = markdown_slug(heading.group(1))
            suffix = slug_counts.get(base, 0)
            slug_counts[base] = suffix + 1
            document.anchors.add(base if suffix == 0 else f"{base}-{suffix}")

        for match in LINK_RE.finditer(line):
            document.refs.append(
                SourceRef(line=line_number, raw=strip_link_title(match.group(1)), kind="link")
            )

        # 외부 URL로 명명된 원격 리소스이며, 저장소 내 skill 경로가 아닙니다 (cross_skill_path_issues와 동일한 규칙):
        # 두 스캔 채널 모두 먼저 제거해야 합니다. 그렇지 않으면 URL 끝 부분 (.../references/x.md)이 로컬 경로로 오인되어 거짓 양성이 발생합니다.
        # 본문의 굵게/기울임 래퍼도 복원해야 합니다: `**references/x.md**`의 `*`이 문자 클래스에 의해 token으로 포함되어
        # 와일드카드로 오인되어 상위 디렉토리로 잘려서 존재 여부 검증을 건너뜁니다. 인라인 코드 내에서는 강조 복원을 하지 않습니다 —
        # 백틱 안의 `*`은 리터럴 와일드카드입니다.
        prose_without_code = EMPHASIS_PATH_RE.sub(
            r"\g<path>", EXTERNAL_URL_RE.sub("", LINK_RE.sub("", INLINE_CODE_RE.sub("", line)))
        )
        for match in SKILL_PATH_RE.finditer(prose_without_code):
            document.refs.extend(
                SourceRef(line=line_number, raw=alternative, kind="skill-path")
                for alternative in path_alternatives(match.group("path"))
            )

        for match in INLINE_CODE_RE.finditer(line):
            code = EXTERNAL_URL_RE.sub("", match.group(1)).strip()
            for path_match in SKILL_PATH_RE.finditer(code):
                document.refs.extend(
                    SourceRef(line=line_number, raw=alternative, kind="skill-path")
                    for alternative in path_alternatives(path_match.group("path"))
                )
            for path_match in INLINE_MD_PATH_RE.finditer(code):
                raw = path_match.group("path")
                base = Path(raw).name
                if ASCII_MD_RE.fullmatch(base) and not base.startswith("_"):
                    document.refs.append(SourceRef(line=line_number, raw=raw, kind="inline-md"))

        prose = strip_inline_markup(line)
        document.unlinked_sections.extend(
            (line_number, match.group(0).strip())
            for match in UNLINKED_SECTION_RE.finditer(prose)
        )

    return document


def parse_frontmatter(path: Path) -> tuple[dict[str, str], int | None]:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, None
    closing = next((index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---"), None)
    if closing is None:
        return {}, None
    values: dict[str, str] = {}
    for line in lines[1:closing]:
        match = re.match(r"^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$", line)
        if match:
            values[match.group(1)] = match.group(2).strip("\"'")
    return values, closing + 1


def resolve_ref(
    ref: SourceRef,
    document: Document,
    skill_dir: Path,
    root: Path,
    documents: dict[Path, Document],
) -> tuple[Path | None, str, bool, bool]:
    """(목표, 앵커, 로컬 참조 여부, 와일드카드 참조 여부)를 반환합니다."""

    raw = ref.raw.strip()
    if not raw or is_external_ref(raw):
        return None, "", False, False

    path_part, separator, fragment = raw.partition("#")
    fragment = unquote(fragment).lower() if separator else ""
    dynamic = False
    candidates: list[Path]
    if ref.kind == "skill-path":
        path_part, dynamic = normalize_path_token(path_part)
        decoded = unquote(path_part)
        candidates = [skill_dir / decoded, root / decoded, root / "skills" / decoded]
    elif not path_part:
        candidates = [document.path]
    else:
        path_part, dynamic = normalize_path_token(path_part)
        decoded = unquote(path_part)
        if ref.kind == "link" and decoded.startswith("/"):
            candidates = [root / decoded.lstrip("/")]
        elif ref.kind == "link":
            # Markdown link destinations are resolved exactly relative to the
            # containing document.  Broader fallbacks would hide broken links
            # when a same-named file happens to exist elsewhere in the skill.
            candidates = [document.path.parent / decoded]
        elif ref.kind == "inline-md" and "/" not in decoded:
            candidates = [
                document.path.parent / decoded,
                skill_dir / decoded,
                skill_dir / "references" / decoded,
                skill_dir / "references/agent-references" / decoded,
                root / decoded,
                root / "skills" / decoded,
            ]
        else:
            candidates = [
                document.path.parent / decoded,
                skill_dir / decoded,
                root / decoded,
                root / "skills" / decoded,
            ]

    unique_candidates = list(dict.fromkeys(candidate.resolve() for candidate in candidates))
    local_candidates = [candidate for candidate in unique_candidates if inside_root(candidate, root)]
    selectable = local_candidates or unique_candidates
    target = next((candidate for candidate in selectable if candidate.exists()), selectable[0])

    if target.suffix.lower() == ".md" and target.is_file() and target not in documents:
        documents[target] = parse_document(target)
    return target, fragment, True, dynamic


def is_deployed_runtime_ref(
    ref: SourceRef,
    document: Document,
    skill_dir: Path,
    agent_names: set[str],
) -> bool:
    normalized = ref.raw.strip().replace("\\", "/")
    if normalized.startswith(DEPLOYED_RUNTIME_PREFIXES):
        return True
    if ref.kind == "inline-md" and "/" not in normalized and Path(normalized).stem in agent_names:
        return True
    try:
        relative = document.path.resolve().relative_to(skill_dir.resolve()).as_posix()
    except ValueError:
        return False
    return (
        normalized.startswith("scripts/")
        and ("/agents/" in f"/{relative}" or relative.startswith("references/templates/agents/"))
    )


def cross_skill_path_issues(skill_dir: Path, root: Path) -> list[Issue]:
    """Reject explicit file paths into another repository skill.

    This repository keeps each runtime skill self-contained.  Scan every text
    asset, not only Markdown links, so comments, generated agent TOML, and
    executable help text cannot quietly reintroduce a cross-skill dependency.
    """

    skills_dir = root / "skills"
    skill_names = sorted(
        (
            path.name
            for path in skills_dir.iterdir()
            if path.is_dir() and (path / "SKILL.md").is_file()
        ),
        key=len,
        reverse=True,
    )
    if len(skill_names) < 2:
        return []
    pattern = re.compile(
        r"(?<![A-Za-z0-9_-])(?P<skill>"
        + "|".join(re.escape(name) for name in skill_names)
        + r")[\\/]+(?P<asset>SKILL\.md|(?:references|scripts|assets)(?:[\\/]+|\b))"
    )
    issues: list[Issue] = []
    for path in sorted(skill_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in SKILL_TEXT_SUFFIXES:
            continue
        if path.name in CHANGELOG_DOCS:
            continue
        text = path.read_text(encoding="utf-8")
        for line_number, line in enumerate(text.splitlines(), start=1):
            # URL paths name remote resources, not repository skill imports.
            # Preserve local POSIX, Windows, and mixed-separator tokens.
            local_text = EXTERNAL_URL_RE.sub("", line)
            for match in pattern.finditer(local_text):
                target_skill = match.group("skill")
                if (
                    target_skill == skill_dir.name
                    or target_skill in FOUNDATION_SKILL_REFERENCES
                ):
                    continue
                issues.append(
                    Issue(
                        "error",
                        "cross-skill-reference",
                        path,
                        line_number,
                        (
                            f"path enters skill {target_skill!r}; runtime skills must "
                            "carry their own files instead of reading another skill"
                        ),
                    )
                )
    return issues


def validate_skill(
    skill_dir: Path,
    root: Path,
    agent_names: set[str],
) -> list[Issue]:
    skill_file = skill_dir / "SKILL.md"
    issues: list[Issue] = []
    frontmatter, closing_line = parse_frontmatter(skill_file)
    if closing_line is None:
        issues.append(Issue("error", "frontmatter-block", skill_file, 1, "missing closed frontmatter block"))
    if not frontmatter.get("name"):
        issues.append(Issue("error", "frontmatter-name", skill_file, 1, "frontmatter requires a non-empty name"))
    elif frontmatter["name"] != skill_dir.name:
        issues.append(
            Issue(
                "error",
                "frontmatter-name",
                skill_file,
                2,
                f"frontmatter name must equal directory name {skill_dir.name!r}",
            )
        )
    if not frontmatter.get("description"):
        issues.append(
            Issue("error", "frontmatter-description", skill_file, 1, "frontmatter requires a non-empty description")
        )

    issues.extend(cross_skill_path_issues(skill_dir, root))

    markdown_paths = sorted(path for path in skill_dir.rglob("*.md") if path.is_file())
    documents = {path.resolve(): parse_document(path) for path in markdown_paths}
    resolved_by_document: dict[Path, set[Path]] = {path.resolve(): set() for path in markdown_paths}

    for document in list(documents.values()):
        # 변경로그의 히스토리 인라인 경로는 데드 링크/크로스 skill 검사를 수행하지 않습니다(다른 파일의 링크 대상으로는 여전히 사용 가능).
        if document.path.name in CHANGELOG_DOCS:
            continue
        seen_refs: set[tuple[int, str, str]] = set()
        for ref in document.refs:
            key = (ref.line, ref.raw, ref.kind)
            if key in seen_refs:
                continue
            seen_refs.add(key)
            if is_deployed_runtime_ref(ref, document, skill_dir, agent_names):
                continue
            target, fragment, local, dynamic = resolve_ref(
                ref, document, skill_dir, root, documents
            )
            if not local or target is None:
                continue
            if not inside_root(target, root):
                issues.append(
                    Issue(
                        "error",
                        "local-path-outside-root",
                        document.path,
                        ref.line,
                        f"local reference {ref.raw!r} escapes repository root",
                    )
                )
                continue
            target_owner = skill_owner(target, root)
            if (
                target_owner is not None
                and target_owner != skill_dir.name
                and target_owner not in FOUNDATION_SKILL_REFERENCES
            ):
                issues.append(
                    Issue(
                        "error",
                        "cross-skill-reference",
                        document.path,
                        ref.line,
                        (
                            f"{ref.raw!r} resolves into skill {target_owner!r}; "
                            "copy the required contract into this skill or use a runtime artifact"
                        ),
                    )
                )
                continue
            if not target.exists():
                issues.append(
                    Issue(
                        "error",
                        "broken-link-path" if ref.kind == "link" else "broken-inline-path",
                        document.path,
                        ref.line,
                        f"{ref.raw!r} resolves to missing {display(target, root)}",
                    )
                )
                continue
            # 와일드카드 참조는 범위만 선언합니다(`references/*`는 "본 skill의 참고 디렉토리"를 의미하며), 특정 파일을 지정하지 않습니다.
            # 파싱된 디렉토리를 도달 가능한 시작점으로 처리하면 전체 서브트리가 "참조됨"으로 표시되고,
            # 해당 skill에 대해 dead-reference 검사가 영구적으로 비활성화됩니다. 파일 이름 지정은 이미 path_alternatives에서 전개되었습니다.
            if not (dynamic and target.is_dir()):
                resolved_by_document.setdefault(document.path.resolve(), set()).add(target)
            if fragment:
                target_document = documents.get(target)
                if target_document is None or fragment not in target_document.anchors:
                    issues.append(
                        Issue(
                            "error",
                            "broken-link-anchor",
                            document.path,
                            ref.line,
                            f"anchor #{fragment} does not exist in {display(target, root)}",
                        )
                    )

        for line, agent_name in sorted(set(document.agent_refs)):
            if agent_name not in agent_names:
                issues.append(
                    Issue(
                        "error",
                        "unknown-agent",
                        document.path,
                        line,
                        f"unknown subagent_type {agent_name!r}",
                    )
                )

        if document.path != skill_file:
            for line, phrase in document.unlinked_sections:
                issues.append(
                    Issue(
                        "error",
                        "unlinked-skill-section",
                        document.path,
                        line,
                        f"replace textual section guess {phrase!r} with a Markdown link to ../SKILL.md#anchor",
                    )
                )

    references_dir = skill_dir / "references"
    if references_dir.is_dir():
        reached: set[Path] = set()
        queue: list[Path] = []

        def is_reference_content(candidate: Path) -> bool:
# .gitkeep은 플레이스홀더이고 __pycache__는 .gitignore의 빌드 산물이므로 둘 다 참고 내용이 아닙니다.
            return candidate.name != ".gitkeep" and "__pycache__" not in candidate.parts

        def add_target(target: Path) -> None:
            try:
                target.relative_to(references_dir.resolve())
            except ValueError:
                return
            candidates = [target] if target.is_file() else sorted(path for path in target.rglob("*") if path.is_file())
            for candidate in candidates:
                resolved = candidate.resolve()
                if not is_reference_content(candidate) or resolved in reached:
                    continue
                reached.add(resolved)
                if candidate.suffix.lower() == ".md":
                    queue.append(resolved)

        for target in resolved_by_document.get(skill_file.resolve(), set()):
            add_target(target)
        while queue:
            source = queue.pop()
            for target in resolved_by_document.get(source, set()):
                add_target(target)

        for candidate in sorted(path for path in references_dir.rglob("*") if path.is_file()):
            if not is_reference_content(candidate) or candidate.resolve() in reached:
                continue
            issues.append(
                Issue(
                    "warning",
                    "dead-reference",
                    candidate,
                    1,
                    "reference file is not reachable from SKILL.md through explicit paths or links",
                )
            )

    return sorted(
        issues,
        key=lambda issue: (display(issue.path, root), issue.line, issue.severity, issue.code),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    return parser


def main() -> int:
    args = build_parser().parse_args()
    root = args.root.resolve()
    skills_dir = root / "skills"
    if not skills_dir.is_dir():
        print(f"ERROR: skills/ not found at {skills_dir}", file=sys.stderr)
        return 2

    agent_dir = skills_dir / "story-setup/references/templates/agents"
    agent_names = {path.stem for path in agent_dir.glob("*.md")} if agent_dir.is_dir() else set()
    skill_dirs = sorted(path for path in skills_dir.iterdir() if (path / "SKILL.md").is_file())
    if not skill_dirs:
        print("ERROR: no skill entrypoints found", file=sys.stderr)
        return 2

    print("Skill Static Check")
    print("==================")
    print(f"Repo: {root}")

    passed = 0
    failed = 0
    warned = 0
    for skill_dir in skill_dirs:
        print(f"\n--- {skill_dir.name} ---")
        try:
            issues = validate_skill(skill_dir, root, agent_names)
        except (OSError, UnicodeError) as exc:
            issues = [Issue("error", "read-error", skill_dir / "SKILL.md", 1, str(exc))]
        errors = [issue for issue in issues if issue.severity == "error"]
        warnings = [issue for issue in issues if issue.severity == "warning"]
        if not issues:
            print("  [PASS] structured frontmatter, links, anchors, agents, and references")
        for issue in issues:
            label = "FAIL" if issue.severity == "error" else "WARN"
            print(
                f"  [{label}] [{issue.code}] {display(issue.path, root)}:{issue.line}: {issue.message}"
            )
        if errors:
            failed += 1
            print(f"  Result: FAIL ({len(errors)} errors, {len(warnings)} warnings)")
        else:
            passed += 1
            if warnings:
                warned += 1
                print(f"  Result: PASS ({len(warnings)} warnings)")
            else:
                print("  Result: PASS")

    print("\n==================")
    print(f"Total: {len(skill_dirs)} | Pass: {passed} | Fail: {failed} | Warn: {warned}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
