#!/usr/bin/env python3
"""Focused regressions for the structured current-contract validator."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
MODULE_PATH = SCRIPT_DIR / "check-current-skill-contracts.py"
SPEC = importlib.util.spec_from_file_location("current_contract_validator", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
VALIDATOR = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = VALIDATOR
SPEC.loader.exec_module(VALIDATOR)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def finding_codes(findings: list[object]) -> set[str]:
    return {finding.code for finding in findings}


def repository_manifest() -> object:
    manifest, findings = VALIDATOR.load_manifest(SCRIPT_DIR / "current-contract.json")
    require(not findings and manifest is not None, "repository manifest must load")
    return manifest


def manifest_with(**overrides: object) -> object:
    """정상 로드 경로에 따라 구성된 수정된 현재 계약을 생성하여 bump를 연습합니다."""
    raw = json.loads((SCRIPT_DIR / "current-contract.json").read_text(encoding="utf-8"))
    raw.update(overrides)
    with tempfile.TemporaryDirectory() as tmp:
        bumped_path = Path(tmp) / "bumped.json"
        bumped_path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
        manifest, findings = VALIDATOR.load_manifest(bumped_path)
    require(not findings and manifest is not None, "bumped manifest must stay well-formed")
    return manifest


def flagged_paths(manifest: object, code: str) -> set[str]:
    return {
        finding.path.relative_to(REPO_ROOT).as_posix()
        for finding in VALIDATOR.validate_repository(REPO_ROOT, manifest)
        if finding.code == code and finding.path is not None
    }


def test_manifest_contract() -> None:
    manifest_path = SCRIPT_DIR / "current-contract.json"
    manifest, findings = VALIDATOR.load_manifest(manifest_path)
    require(not findings, "repository manifest should validate: {}".format(findings))
    require(manifest is not None, "repository manifest should load")
    require(not VALIDATOR.validate_repository(REPO_ROOT, manifest), "manifest and repository must agree")

    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)

        wrong_type = dict(raw)
        wrong_type["agents_version"] = "18"
        wrong_type_path = tmpdir / "wrong-type.json"
        wrong_type_path.write_text(json.dumps(wrong_type, ensure_ascii=False), encoding="utf-8")
        _, wrong_type_findings = VALIDATOR.load_manifest(wrong_type_path)
        require(
            "manifest-value-type" in finding_codes(wrong_type_findings),
            "string agents_version must be rejected",
        )

        stale = dict(raw)
        stale["topic_decision_phase"] = 4
        stale_path = tmpdir / "stale.json"
        stale_path.write_text(json.dumps(stale, ensure_ascii=False), encoding="utf-8")
        stale_manifest, stale_findings = VALIDATOR.load_manifest(stale_path)
        require(
            not stale_findings and stale_manifest is not None,
            "a well-formed manifest remains the source of truth",
        )
        require(
            "topic-decision-phase" in finding_codes(
                VALIDATOR.validate_repository(REPO_ROOT, stale_manifest)
            ),
            "repository drift from the manifest must be rejected",
        )

        malformed_sections = dict(raw)
        malformed_sections["required_outline_sections"] = [{"rule": "단계 위치"}]
        malformed_path = tmpdir / "malformed-sections.json"
        malformed_path.write_text(json.dumps(malformed_sections, ensure_ascii=False), encoding="utf-8")
        _, malformed_findings = VALIDATOR.load_manifest(malformed_path)
        require(
            "manifest-outline-type" in finding_codes(malformed_findings),
            "incomplete outline-section objects must be rejected",
        )

        duplicate_artifacts = dict(raw)
        duplicate_artifacts["primary_benchmark_artifacts"] = ["플롯/페이싱.md", "플롯/페이싱.md"]
        duplicate_path = tmpdir / "duplicate-artifacts.json"
        duplicate_path.write_text(json.dumps(duplicate_artifacts, ensure_ascii=False), encoding="utf-8")
        _, duplicate_findings = VALIDATOR.load_manifest(duplicate_path)
        require(
            "manifest-artifact-duplicate" in finding_codes(duplicate_findings),
            "duplicate primary artifacts must be rejected",
        )

        renamed_artifacts = dict(raw)
        renamed_artifacts["primary_benchmark_artifacts"] = [
            "플롯/주요 감정.md",
            "플롯/주요 페이싱.md",
        ]
        renamed_path = tmpdir / "renamed-artifacts.json"
        renamed_path.write_text(
            json.dumps(renamed_artifacts, ensure_ascii=False), encoding="utf-8"
        )
        renamed_manifest, renamed_findings = VALIDATOR.load_manifest(renamed_path)
        require(
            not renamed_findings and renamed_manifest is not None,
            "renamed current artifacts must remain manifest-driven",
        )
        renamed_semantic = semantic_findings(
            "- `스토리/메인 페이스.md`가 누락된 경우, `분석 보고서.md`로 폴백합니다.",
            renamed_manifest.primary_benchmark_artifacts,
        )
        require(
            "silent-primary-artifact-fallback" in finding_codes(renamed_semantic),
            "semantic guard must follow renamed manifest artifacts",
        )


def semantic_findings(
    text: str, primary_artifacts: tuple[str, ...] | None = None
) -> list[object]:
    if primary_artifacts is None:
        primary_artifacts = repository_manifest().primary_benchmark_artifacts
    return VALIDATOR.semantic_primary_fallback_findings(
        text,
        Path("fixture.md"),
        primary_artifacts,
    )


def test_bad_fallbacks_fail() -> None:
    bad_cases = {
        "inline report fallback": "- `스토리/감정 모듈.md`가 누락된 경우, `분석 보고서.md`로 폴백합니다.",
        "nested summary substitution": """
1. `스토리/페이스.md`를 확인합니다.
2. 주요 생성물이 누락된 경우:
   - `챕터/*_요약.md`로 대체합니다.
""",
        "structured gap story fallback": "- `rhythm_missing: true`일 때 `story_line.md`로 변경하여 리듬을 보충합니다.",
    }
    for label, text in bad_cases.items():
        findings = semantic_findings(text)
        require(
            "silent-primary-artifact-fallback" in finding_codes(findings),
            "{} should fail".format(label),
        )


def test_fail_fast_prose_passes() -> None:
    good_cases = {
        "explicit불가": "- `plot/emotion_module.md`가 누락되었을 때 반드시 중지합니다. `text_analysis_report.md`, 챕터 요약 또는 스토리라인으로 대체할 수 없습니다.",
        "explicit금지 fallback": "- `rhythm_missing: true`일 때 `missing_primary_contract`를 반환하며, `story_line.md`로의 폴백을 금지합니다.",
        "normal complete branch": "- 두 주산출물이 모두 존재할 때 `text_analysis_report.md`를 읽고, 사용자가 읽을 수 있는 개요로만 사용합니다.",
        "deep-dive fallback is not primary fallback": (
            "- 먼저 `plot/emotion_module.md`와 `plot/rhythm.md`를 읽습니다. 모듈 또는 리듬 파일이 누락되었을 때 복구를 중지합니다."
            "`챕터/*_요약.md`와 일치한 후, 같은 챕터의 심화 분해가 없으면 황금 3장 심화 분해로 폴백합니다."
        ),
    }
    for label, text in good_cases.items():
        findings = semantic_findings(text)
        require(not findings, "{} should pass, got {}".format(label, findings))


def test_sibling_bullets_do_not_lend_the_missing_condition() -> None:
    """인접한 항목은 각각 독립적인 계약입니다: fail-fast 형제 항목은 '주산출물 누락'을 올바른 읽기 항목에 넘겨줄 수 없습니다."""
    fail_fast = "- `스토리/페이싱.md` → 누락 시 가져오기 중지, `분석 보고서.md`, 챕터 요약 또는 스토리라인으로 대체 불가"
    good_neighbours = {
        "benign read after a fail-fast sibling": "- 두 주산출물이 모두 존재할 때 `분석 보고서.md`를 읽음, 사람이 읽을 수 있는 개요용으로만 사용",
        "human-readable overview bullet": "- 스토리라인(사람이 읽을 수 있는 개요) → `스토리/스토리라인.md`에서 읽음; 누락 시 공백 유지",
        "prose block after a fail-fast bullet": "**무손실 검사**（하나라도 실패하면 `_장절 요약 합계.md` 삭제, 파일별 스캔 롤백）：",
    }
    for label, good in good_neighbours.items():
        findings = semantic_findings(fail_fast + "\n" + good + "\n")
        require(not findings, "{} should pass, got {}".format(label, findings))

    nested = (
        "주요 산출물 누락 시：\n"
        "- 먼저 추적에 기록\n"
        "- 다시 블록 상태 확인\n"
        "- `분할 문서 보고서.md` 읽기 롤백하여 대응 뷰 구성\n"
    )
    require(
        "silent-primary-artifact-fallback" in finding_codes(semantic_findings(nested)),
        "상위 항목에서 제시한 누락된 조건은 여전히 하위 항목의 다운그레이드를 차단해야 함",
    )
    deep = "- 주 산물이 누락되었을 때:\n  - 임포트 분기:\n    - `스토리라인.md`을 대신 사용합니다.\n"
    require(
        "silent-primary-artifact-fallback" in finding_codes(semantic_findings(deep)),
        "한 단계 떨어진 상위 조건도 하위 항목의 다운그레이드를 차단해야 함",
    )
    wrapped = "- `플롯/페이싱.md`이 누락되면,\n  대신 `챕터/*_요약.md`을 읽어 페이싱을 보충합니다.\n"
    require(
        "silent-primary-artifact-fallback" in finding_codes(semantic_findings(wrapped)),
        "동일 항목의 연속행은 여전히 조건과 함께 하나의 사항으로 분류됨",
    )
    table_rows = (
        "| 조건 | 동작 |\n"
        "|---|---|\n"
        "| `스토리/페이스.md` 누락 | Stage 6 중지 및 `missing_primary_contract` 보고 |\n"
        "| `Chapters/Chapter1-3_DeepAnalysis.md` 누락 | 대사 잠재 의미 섹션을 분석 보고서로 대체 |\n"
    )
    require(
        not semantic_findings(table_rows),
        "표의 인접 행은 독립적인 기록이며, 심층 분석 대체는 주요 산출물 품질 저하가 아님: {}".format(
            semantic_findings(table_rows)
        ),
    )
    bad_row = (
        "| 조건 | 동작 |\n"
        "|---|---|\n"
        "| `스토리/페이스.md` 누락 | `분해 보고서.md`에서 페이스 읽기로 대체 |\n"
    )
    require(
        "silent-primary-artifact-fallback" in finding_codes(semantic_findings(bad_row)),
        "동일한 표 행의 주산물 다운그레이드는 차단해야 함",
    )


def test_undecodable_markdown_is_a_named_failure() -> None:
    """UTF-8이 아닌 텍스트는 모든 콘텐츠 규칙을 조용히 통과시키므로 오류 이름을 지정해야 함; 바이너리 자산은 계속 건너뜀."""
    rule = next(
        r for r in VALIDATOR.LEGACY_RULES if r.code == "dotted-demo-workflow-label"
    )
    dotted = "# 프로세스 설명\n\n이전 번호: Step 1.2: 이전 번호 레이블\n"
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        demo = root / "demo"
        demo.mkdir()
        target = demo / "프로세스 설명.md"
        target.write_text(dotted, encoding="utf-8")
        require(
            VALIDATOR.check_absent_rule(root, rule),
            "UTF-8 이전의 구식 인코딩 태그는 콘텐츠 규칙에 의해 차단되어야 함",
        )
        target.write_bytes(dotted.encode("gb18030"))
        require(
            not VALIDATOR.check_absent_rule(root, rule),
            "콘텐츠 규칙은 GBK 파일을 읽을 수 없으며, 이것이 전용 스캔이 필요한 이유임",
        )
        require(
            "unreadable-source-file"
            in finding_codes(VALIDATOR.undecodable_source_findings([demo])),
            "UTF-8이 아닌 계약 텍스트는 명명 실패여야 하며, 무시하고 넘어갈 수 없음",
        )
        target.write_text(dotted, encoding="utf-16")
        require(
            "unreadable-source-file"
            in finding_codes(VALIDATOR.undecodable_source_findings([demo])),
            "UTF-16 Markdown에 NUL이 포함되어 있지만 여전히 계약 텍스트이며, 바이너리 자산으로 위장하여 넘어갈 수 없음",
        )
        target.write_text(dotted, encoding="utf-8")
        (demo / "cover.png").write_bytes(b"\x89PNG\r\n\x1a\n\xff\xfe")
        # 확장자 없음 / 화이트리스트에 없는 확장자의 바이너리(.DS_Store 같은 것)는 NUL 바이트로 식별되며, 오탐지되면 안 됨
        (demo / ".DS_Store").write_bytes(b"\x00\x00\x00\x01Bud1\xff\xfe")
        require(
            not VALIDATOR.undecodable_source_findings([demo]),
            "바이너리 자산은 계약 텍스트가 아니므로 조용히 유지되어야 함: {}".format(
                VALIDATOR.undecodable_source_findings([demo])
            ),
        )


def test_progress_schema_pins_are_repo_wide() -> None:
    """progress_schema_version을 bump할 때, 각 literal 앵커 포인트를 명시해야 하며, pipeline-ops.md만 지목해서는 안 됨."""
    current = repository_manifest().progress_schema_version
    stale = flagged_paths(
        manifest_with(progress_schema_version=current + 1), "progress-schema-version"
    )
    for relative in (
        "skills/story-long-analyze/references/pipeline-ops.md",
        "skills/story-long-analyze/SKILL.md",
        "skills/story-import/SKILL.md",
        "skills/story-setup/UPGRADING.md",
        "demo/TextLibrary/Coiling_Dragon/_progress.md",
    ):
        require(
            relative in stale,
            "{} 의 schema_version 앵커 포인트는 manifest를 따라야 하는데, 실제로는 {}를 포착함".format(
                relative, sorted(stale)
            ),
        )
    require(
        "CHANGELOG.md" not in stale,
        "CHANGELOG의 히스토리 레코드는 현재 값으로 제한되지 않음",
    )


def test_stale_scan_phase_reference_accepts_backticks() -> None:
    """house style `story-long-scan` Phase N과 naked token 작성법 모두 stale 참조 스캔에서 감지되어야 함."""
    current = repository_manifest().topic_decision_phase
    stale = flagged_paths(
        manifest_with(topic_decision_phase=current + 1),
        "stale-topic-decision-phase-reference",
    )
    # 장편 「먼저 주제 선택 결정」은 Phase 1과 함께 workflow-setup.md(#269)로 이전되었으며, 스캔 대상은 콘텐츠를 따릅니다.
    for relative in (
        "skills/story-long-write/references/workflow-setup.md",
        "skills/story-long-analyze/SKILL.md",
    ):
        require(
            relative in stale,
            "{} 의 주제 선택 결정 단계 참조가 반드시 감지되어야 하며, 실제 일치: {}".format(relative, sorted(stale)),
        )


def test_structured_sentinel_contract() -> None:
    manifest = repository_manifest()
    scattered = """
agents_version: {agents_version}
setup_skill_version: {setup_skill_version}
설명 텍스트에서 target_cli, resolver_strategy 및 references_dir도 언급되었습니다.
""".format(
        agents_version=manifest.agents_version,
        setup_skill_version=manifest.setup_skill_version,
    )
    require(
        VALIDATOR.extract_sentinel_fields(scattered) is None,
        "scattered sentinel tokens must not satisfy the deployment block",
    )
    require(
        "setup-sentinel-block"
        in finding_codes(
            VALIDATOR.sentinel_contract_findings(
                scattered, manifest, Path("fixture.md")
            )
        ),
        "missing structured sentinel block must fail",
    )

    structured = """
### Step 8: 배포 마크 생성

- 다음 필드를 작성합니다:

```yaml
deployed_at: 2026-07-14T00:00:00Z
agents_version: {agents_version}
setup_skill_version: {setup_skill_version}
target_cli: codex
resolver_strategy: project-first
references_dir: .codex/skills/story-setup/references
```
""".format(
        agents_version=manifest.agents_version,
        setup_skill_version=manifest.setup_skill_version,
    )
    require(
        not VALIDATOR.sentinel_contract_findings(
            structured, manifest, Path("fixture.md")
        ),
        "well-formed structured sentinel must pass",
    )

    incomplete = structured.replace("target_cli: codex\n", "")
    require(
        "setup-sentinel-fields"
        in finding_codes(
            VALIDATOR.sentinel_contract_findings(
                incomplete, manifest, Path("fixture.md")
            )
        ),
        "missing generated sentinel fields must fail",
    )


def test_structured_outline_contract() -> None:
    manifest = repository_manifest()
    rule_names = [rule for rule, _ in manifest.required_outline_sections]
    demo_names = [demo for _, demo in manifest.required_outline_sections]

    scattered_rule = "2. **상세 항목 필수**\n\n" + "、".join(rule_names)
    require(
        "outline-rule-section"
        in finding_codes(
            VALIDATOR.outline_rule_contract_findings(
                scattered_rule, manifest, Path("rule.md")
            )
        ),
        "outline names scattered in prose must not satisfy structured rules",
    )
    structured_rule = (
        "2. **상세 항목 필수**\n"
        + "\n".join("- {}：필수".format(name) for name in rule_names)
        + "\n3. **다음 규칙**\n"
    )
    require(
        not VALIDATOR.outline_rule_contract_findings(
            structured_rule, manifest, Path("rule.md")
        ),
        "structured outline rule fields must pass",
    )

    scattered_demo = "본 장에 포함되어야 할 항목:" + "、".join(demo_names)
    declared = VALIDATOR.extract_demo_outline_fields(scattered_demo)
    require(
        not set(demo_names).issubset(declared),
        "demo names scattered in prose must not count as declared sections",
    )
    structured_demo = "\n".join("## {}".format(name) for name in demo_names)
    require(
        set(demo_names).issubset(
            VALIDATOR.extract_demo_outline_fields(structured_demo)
        ),
        "structured demo headings must be recognized",
    )


def test_upgrading_version_contract() -> None:
    manifest = repository_manifest()
    structured = """
## 현재 버전

- `setup_skill_version: {setup_skill_version}`
- `agents_version: {agents_version}`

## 다음 섹션
""".format(
        setup_skill_version=manifest.setup_skill_version,
        agents_version=manifest.agents_version,
    )
    require(
        not VALIDATOR.upgrading_version_findings(
            structured, manifest, Path("UPGRADING.md")
        ),
        "structured current-version bullets must pass",
    )
    scattered = (
        "설명 setup_skill_version: {}，agents_version: {}，하지만 현재 버전 필드가 없습니다.".format(
            manifest.setup_skill_version, manifest.agents_version
        )
    )
    require(
        "upgrading-current-version"
        in finding_codes(
            VALIDATOR.upgrading_version_findings(
                scattered, manifest, Path("UPGRADING.md")
            )
        ),
        "version strings scattered in prose must not satisfy current-version bullets",
    )


def test_deeply_nested_fallback_keeps_all_governing_ancestors() -> None:
    text = (
        "- `Plot/Pacing.md` 파일이 없을 때:\n"
        "  - 가져오기 단계:\n"
        "    - 여섯 번째 단계:\n"
        "      - 참조 뷰:\n"
        "        - `AnalysisReport.md` 파일을 다시 읽어 속도를 구성합니다.\n"
    )
    found = VALIDATOR.semantic_primary_fallback_findings(
        text,
        Path("deeply-nested.md"),
        ("스토리/페이싱.md",),
    )
    require(
        "silent-primary-artifact-fallback" in finding_codes(found),
        "깊은 계층 목록의 주요 산출물 누락 조건은 폴백 작업까지 전달되어야 하며, 3단계 이후에 손실될 수 없습니다",
    )


def test_old_artifact_prose_silent_only() -> None:
    """keep C: 명시적 마크가 있는 레거시 형식 개요는 통과 허용, 마크가 없는 자동 다운그레이드는 여전히 차단됩니다(drop A/B는 영향을 받지 않음)."""
    rule = next(r for r in VALIDATOR.LEGACY_RULES if r.code == "old-artifact-prose")
    require(rule.exempt_when is not None, "old-artifact-prose must narrow to silent-only")
    flagged = [
        "레거시 세부 개요에 이 필드가 없어도 읽기는 차단되지 않으며, 미지의 항목은 `[추가 예정]`으로 작성합니다.",
        "레거시 세부 개요는 핵심 이벤트, 플롯 포인트 시퀀스, 목표 감정을 폴백 읽기합니다.",
        "구버전 롤 개요에 롤 계약/스토리 유닛 카드가 없어서 일일 업데이트를 차단하지 않음; 이번 라운드 기록은 `추적/컨텍스트.md`에 저장됨.",
        "구버전 상세 개요는 핵심 이벤트, 목표 감정, 챕터 시작/종료 훅, 단어 수 목표만 검증함.",
    ]
    silent = [
        "구버전 상세 개요를 직접 권위 있는 버전으로 읽음, 경고 없음.",
        "초기 분할 문서 라이브러리 형식을 그대로 사용함.",
        "구 구조와 호환, 조용히 계속 작성함.",
    ]
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        skills = root / "skills" / "story-long-write"
        skills.mkdir(parents=True)
        (skills / "keep-c.md").write_text("\n".join(flagged) + "\n", encoding="utf-8")
        require(
            not VALIDATOR.check_absent_rule(root, rule),
            "flagged old-outline tolerance (keep C) must pass, got {}".format(
                VALIDATOR.check_absent_rule(root, rule)
            ),
        )
        (skills / "keep-c.md").write_text("\n".join(silent) + "\n", encoding="utf-8")
        found = VALIDATOR.check_absent_rule(root, rule)
        require(
            len(found) == len(silent),
            "each silent old-format downgrade must fire, got {}".format(found),
        )


def test_story_import_keeps_self_out_of_benchmarks() -> None:
    cases = {
        "story-import-self-main-benchmark": "주요 참고서: {书名}\n현재 서적을 가져올 때 자신을 최소한 `주`로 등록하세요.\n",
        "story-import-self-benchmark-copy": (
            "`拆文库/{书名}/` 디렉토리를 `{项目}/对标/{书名}/`에 복사하세요.\n"
            "단편을 `{标题}/对标/{书名}/`에 복사하세요.\n"
        ),
        "story-import-self-benchmark-summary": "## 참고 요약: {原书名}\n",
        "story-import-self-benchmark-fields": (
            "`拆文报告.md`의 스토리 핵심/소재/참고 필드를 본 서적 설정에 매핑하세요.\n"
        ),
        "story-import-import-title-benchmark-target": (
            "Copy `拆文库/{导入书名}/` entirely to the project `对标/`.\n" → "프로젝트 `对标/`에 `拆文库/{导入书名}/`을(를) 전체 복사하세요.\n"
        ),
    }
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        target = root / "skills" / "story-import" / "fixture.md"
        target.parent.mkdir(parents=True)
        for code, content in cases.items():
            target.write_text(content, encoding="utf-8")
            rule = next(r for r in VALIDATOR.LEGACY_RULES if r.code == code)
            found = VALIDATOR.check_absent_rule(root, rule)
            require(found, "{} must reject imported-work benchmark leakage".format(code))

        guard_rule = next(
            r
            for r in VALIDATOR.LEGACY_RULES
            if r.code == "story-import-import-title-benchmark-target"
        )
        target.write_text(
            "Do not copy `拆文库/{导入书名}/` entirely into `对标/`.\n", → "`拆文库/{导入书名}/`을(를) `对标/`에 전체 복사하지 마세요.\n",
            encoding="utf-8",
        )
        require(
            not VALIDATOR.check_absent_rule(root, guard_rule),
            "explicit self-benchmark prohibition must remain documentable",
        )


def test_spawn_preflight_uses_agents_version_not_file_existence() -> None:
    manifest = repository_manifest()
    stale = manifest.agents_version - 1
    existence_only = """
Detected `.claude/agents/chapter-extractor.md` exists, so it can spawn.
.story-deployed:
  agents_version: {stale}
""".format(stale=stale)
    found = VALIDATOR.spawn_preflight_findings(
        existence_only, manifest, Path("story-import-fixture.md")
    )
    require(
        "spawn-agents-version-preflight" in finding_codes(found),
        "a stale agent file must not satisfy the spawn preflight",
    )

    current = manifest.agents_version
    current_contract = """
Read `agents_version: {current}` from `.story-deployed`; when inconsistent, check file existence as usual and spawn,
Report `Notice: agents bundle version mismatch (project {{N}}, current {current})` and suggest re-running `/story-setup`.
{current}보다 클 때 oh-story-claudecode 먼저 업데이트하라는 추가 안내를 표시합니다.
agent 파일이 누락되었거나 런타임에서 custom agent를 노출하지 않을 때만 solo/direct로 폴백하며, `Fallback: ... -> solo`를 보고합니다.
""".format(current=current)
    require(
        not VALIDATOR.spawn_preflight_findings(
            current_contract, manifest, Path("current-fixture.md")
        ),
        "the current shared spawn preflight must pass",
    )

    bumped = manifest_with(agents_version=current + 1)
    stale_paths = flagged_paths(bumped, "spawn-agents-version-preflight")
    require(
        stale_paths == set(VALIDATOR.SPAWN_CAPABLE_SKILLS),
        "an agents_version bump must flag every spawn-capable Skill, got {}".format(
            sorted(stale_paths)
        ),
    )


def test_reviewed_benchmark_wording_stays_removed() -> None:
    cases = {
        "benchmark-primary-nonblocking-wording": "누락 시 원래 플로우대로 진행하며 차단하지 않습니다.\n",
        "no-benchmark-skips-genre-card": "대조 기준이 없을 때 「대조 모듈/리듬/주제 카드/문체 재호출」을 건너뜁니다.\n",
        "style-profile-all-inputs-required": "선행 의존성: 보고서, 요약, 원문이 모두 필요합니다.\n",
        "context-missing-skips-all": "컨텍스트 읽기(필요시 로드, 누락되면 건너뜀).\n",
    }
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for code, content in cases.items():
            rule = next(r for r in VALIDATOR.LEGACY_RULES if r.code == code)
            relative = Path(rule.relative_roots[0])
            target = root / relative
            if target.suffix:
                target.parent.mkdir(parents=True, exist_ok=True)
            else:
                target.mkdir(parents=True, exist_ok=True)
                target = target / "fixture.md"
            target.write_text(content, encoding="utf-8")
            require(
                VALIDATOR.check_absent_rule(root, rule),
                "{} must reject the reviewed stale wording".format(code),
            )


def test_p1_deletion_guards() -> None:
    rules = {rule.code: rule for rule in VALIDATOR.LEGACY_RULES}
    cases = {
        "static-long-word-floor": (
            "skills/story-long-write/SKILL.md",
            "**기본 최소 글자 수: 3000자/장.**\n",
            "장편은 상세 개요 글자 수 목표로 검수; 실제 글자 수가 목표의 90% 미만일 때 차단.\n",
        ),
        "broad-chrome-cleanup-doc": (
            "skills/browser-cdp/SKILL.md",
            "멈출 때 `pkill -9 -x 'Google Chrome'` 실행.\n",
            "멈출 때 debug profile에 속하는 것으로 확인된 Chrome 창을 닫기; 일반 Chrome은 종료하지 마세요.\n",
        ),
    }
    for code, (relative_path, bad, good) in cases.items():
        rule = rules[code]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(bad, encoding="utf-8")
            require(
                finding_codes(VALIDATOR.check_absent_rule(root, rule)) == {code},
                "{} must reject its retired authority/bypass".format(code),
            )
            path.write_text(good, encoding="utf-8")
            require(
                not VALIDATOR.check_absent_rule(root, rule),
                "{} must accept the canonical contract".format(code),
            )


def test_analyze_portability_guards() -> None:
    """Stage 6의 샘플 경로와 Stage 0의 디렉터리 블록 제외는 모두 문서에 유지되어야 합니다.

    둘 다 실제 실행 시에만 노출됩니다: /tmp 절대 경로는 Windows 네이티브 python까지 탐색하면 오류가 발생하고,
    디렉터리 블록은 원문 자체에 디렉터리가 있으면 추가로 한 번 더 분할됩니다. 가드는 이들의 유일한 회귀 지점입니다.
    """

    rule = next(
        r for r in VALIDATOR.LEGACY_RULES if r.code == "analyze-posix-tmp-sample-path"
    )
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        path = root / "skills/story-long-analyze/references/style-profile-generator.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("3개 세그먼트를 연결하여 `/tmp/style-sample.txt`에 작성합니다.\n", encoding="utf-8")
        require(
            finding_codes(VALIDATOR.check_absent_rule(root, rule))
            == {"analyze-posix-tmp-sample-path"},
            "the POSIX /tmp sample path must be rejected",
        )
        path.write_text(
            "3개 세그먼트를 연결하여 `dissembled-library/{book-name}/_style-sample.txt`에 작성합니다.\n", encoding="utf-8"
        )
        require(
            not VALIDATOR.check_absent_rule(root, rule),
            "a project-relative sample path must be accepted",
        )

    stage0_cases = (
        (r"먼저 목차 블록 제거", "stage0-toc-block-removal"),
        (r"표 생성 전 장 번호 연속성 검증", "stage0-chapter-table-validation"),
    )
    with tempfile.TemporaryDirectory() as tmp:
        fixture = Path(tmp) / "SKILL.md"
        fixture.write_text("- grep으로 모든 장 줄 번호 추출\n", encoding="utf-8")
        for pattern, code in stage0_cases:
            require(
                finding_codes(VALIDATOR.require_pattern(fixture, pattern, code, code))
                == {code},
                "{} must fire when Stage 0 drops the rule".format(code),
            )
        fixture.write_text(
            "- **먼저 목차 블록 제거**: 줄 간격으로 시작 부분의 목차 일치 항목 삭제\n"
            "- 표 생성 전 장 번호 연속성, 중복 없음, 건너뜀 없음 검증\n",
            encoding="utf-8",
        )
        for pattern, code in stage0_cases:
            require(
                not VALIDATOR.require_pattern(fixture, pattern, code, code),
                "{} must accept the documented Stage 0 contract".format(code),
            )


def test_rubric_parity_guard() -> None:
    """두 개의 범용 rubric은 동일한 차원을 가져야 하며, 양쪽 모두에서 읽을 수 없을 때는 통과로 간주할 수 없습니다."""

    rubric = (
        "## 핵심 차원\n\n"
        "| 차원 | PASS | WARN | FAIL |\n"
        "|---|---|---|---|\n"
        "| 핵심 장점 | a | b | c |\n"
        "| 구두점 리듬 | a | b | c |\n"
        "\n## 발행 권장 기준\n\n"
        "| 종합 상황 | Verdict |\n"
        "|---|---|\n"
        "| S1/S2 없음 | PASS |\n"
    )
    embedded = "일반 네트워크 문학 콘텐츠 rubric：\n- 핵심 판매 포인트：x\n- 구두점 리듬：y\n\nAI 느낌 fallback：\n"

    def build(root: Path, rubric_body: str, skill_body: str) -> None:
        r = root / "skills/story-review/references/quality-rubric.md"
        s = root / "skills/story-review/SKILL.md"
        r.parent.mkdir(parents=True, exist_ok=True)
        r.write_text(rubric_body, encoding="utf-8")
        s.write_text(skill_body, encoding="utf-8")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        build(root, rubric, embedded)
        require(
            not VALIDATOR.rubric_parity_findings(root),
            "matching rubric dimensions must pass",
        )
        # 발행 기준표는 차원표가 아니므로 계산에 포함될 수 없습니다
        table, _ = VALIDATOR.rubric_dimension_names(root)
        require(
            table == ["核心卖点", "标点节奏"], → table == ["핵심 판매 포인트", "구두점 리듬"],
            "only the 核心维度 table counts, got {}".format(table), → "핵심 차원 테이블만 계산되며, {}를 받았습니다".format(table),
        )

        build(root, rubric.replace("| 标点节奏 |", "| 标点节奏X |", 1), embedded) → build(root, rubric.replace("| 구두점 리듬 |", "| 구두점 리듬X |", 1), embedded)
        require(
            finding_codes(VALIDATOR.rubric_parity_findings(root)) == {"rubric-dimension-drift"},
            "a dimension present only in the embedded fallback must fail",
        )

        build(root, rubric, embedded.replace("- 구두점 리듬: y\n", "", 1))
        require(
            finding_codes(VALIDATOR.rubric_parity_findings(root)) == {"rubric-dimension-drift"},
            "a dimension present only in the file must fail",
        )

        # 전체 삭제할 때 양쪽이 모두 빈 리스트——공집합 동일, 명시적으로 읽기 실패로 처리해야 하며 무시하고 통과하면 안 됨
build(root, rubric, "더 이상 내장 rubric이 없습니다\n")
        require(
            finding_codes(VALIDATOR.rubric_parity_findings(root)) == {"rubric-parity-unreadable"},
            "a missing embedded rubric must not pass vacuously",
        )


def main() -> int:
    test_manifest_contract()
    test_bad_fallbacks_fail()
    test_fail_fast_prose_passes()
    test_sibling_bullets_do_not_lend_the_missing_condition()
    test_undecodable_markdown_is_a_named_failure()
    test_progress_schema_pins_are_repo_wide()
    test_deeply_nested_fallback_keeps_all_governing_ancestors()
    test_stale_scan_phase_reference_accepts_backticks()
    test_old_artifact_prose_silent_only()
    test_story_import_keeps_self_out_of_benchmarks()
    test_spawn_preflight_uses_agents_version_not_file_existence()
    test_reviewed_benchmark_wording_stays_removed()
    test_p1_deletion_guards()
    test_analyze_portability_guards()
    test_rubric_parity_guard()
    test_structured_sentinel_contract()
    test_structured_outline_contract()
    test_upgrading_version_contract()
    print("OK: current-contract manifest, structure, and fallback regressions passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
