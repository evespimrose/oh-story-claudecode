#!/usr/bin/env python3
"""Lexical guards for the single-authority tracking workflow contracts."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def require_all(text: str, needles: tuple[str, ...], label: str) -> None:
    missing = [needle for needle in needles if needle not in text]
    require(not missing, f"{label} missing contract text: {missing}")


def test_transaction_is_the_only_tracking_writer() -> None:
    for path in (
        "skills/story-long-write/SKILL.md",
        "skills/story-long-write/references/workflow-daily.md",
        "skills/story-long-write/references/workflow-revision.md",
        "skills/story-import/SKILL.md",
        "skills/story-review/SKILL.md",
    ):
        require("tracking_commit.py" in read(path), f"{path} must route writes through tracking_commit.py")

    protocol = read("skills/story-long-write/references/tracking-transaction.md")
    require_all(
        protocol,
        (
            "하나의 구조화된 권위 상태 + 여러 개의 결정론적 파생 뷰",
            "분리하지 않음",
            "_tracking-state.json",
            "유일한 커밋 지점",
            "**동일한** `commit`을 직접 다시 실행",
            "expected_state_revision",
            "전체 연속성 기록",
            "동시성 락이 아님",
        ),
        "tracking protocol",
    )


def test_authority_model_matches_the_implementation() -> None:
    protocol = read("skills/story-long-write/references/tracking-transaction.md")
    require_all(
        protocol,
        (
            "가져오기 마감 장",
            "imported_through_chapter",
            "장 기록",
            "덮어쓰기 기록",
            "유일한 권위",
            "개별적인 무손실 재구축을 보장하지 않음",
            "도구가 더 이상 Markdown을 역방향으로 파싱하지 않음",
        ),
        "tracking authority model",
    )
    require("기준선_제N장까지.md" not in protocol, "tracking protocol still creates a redundant baseline file")
    for path in (
        "skills/story-long-write/references/state-tracking.md",
        "skills/story-import/references/state-tracking.md",
        "skills/story-long-write/references/workflow-daily.md",
    ):
        require("core: true" not in read(path), f"{path} still instructs callers to use the removed core field")


def test_failed_commit_retries_the_same_external_transaction() -> None:
    protocol = read("skills/story-long-write/references/tracking-transaction.md")
    require_all(
        protocol,
        (
            "트랜잭션 JSON은 성공 전까지 반드시 유지되어야 함",
            "환경 수정 후 **동일한** `commit`을 직접 다시 실행",
            "`dirty/pending/repair` 상태 머신을 유지하지 않음",
        ),
        "retry contract",
    )


def test_state_card_and_compact_delta_limits_are_explicit() -> None:
    protocol = read("skills/story-long-write/references/tracking-transaction.md")
    require_all(
        protocol,
        (
            "목표 ≤1536 바이트, 하드 제한 3072 바이트",
            "목표 ≤4096 바이트, 초과 시 경고, 하드 제한 8192 바이트",
            "네 개의 리스트 항목 수 제한 없음",
            "≤12288 바이트",
            "## 현재 위치",
            "## 장기 제약",
            "## 핵심 캐릭터 상태",
            "## 활성 복선",
            "## 최근 3장 요약",
            "## 다음 장 예고",
            "## 개연성 리스크",
        ),
        "bounded tracking protocol",
    )


def test_import_records_a_cutoff_without_fabricated_old_deltas() -> None:
    text = read("skills/story-import/SKILL.md")
    require_all(
        text,
        (
            "imported_through_chapter=N",
            "1..N장에 대해 장별로 위조해서는 안 됨",
            "_tracking-state.json",
            "캐릭터 상태/{캐릭터명}.md",
            "타임라인/독자 인지 내용.md",
            "tracking_commit.py init",
        ),
        "story-import tracking",
    )
    # 마이그레이션은 기술할 수 있으나, '기존 구조 아카이브 후 현재 프로토콜에 따라 재구축'만 가능하며 기존 추적 파일을 파싱/변환한다고 주장해서는 안 됩니다.
    require("_기존_추적_아카이브" in text, "story-import migration must archive the old tracking structure")
    require(
        "기존 파싱" not in text and "호환 계층" not in text,
        "story-import must not claim to parse or convert old tracking structures",
    )


def test_reader_timeline_is_kept_separate_from_author_truth() -> None:
    explorer = read("skills/story-setup/references/templates/agents/story-explorer.md")
    require_all(
        explorer,
        (
            "미지정 시 기본값 `reader`",
            "독자 인지 내용.md",
            "작가 설정 진실.md",
            "reader` 결과에 `objective_fact` 중 아직 공개되지 않은 내용이 섞여서는 안 됨",
        ),
        "story-explorer timeline",
    )
    checker = read("skills/story-setup/references/templates/agents/consistency-checker.md")
    require_all(
        checker,
        (
            "`작가 설정 진실.md`를 사용하여 객관적 시계열 확인",
            "`독자 인지 내용.md`를 사용하여 본문 내용이 미리 유출되었는지 확인",
            "tracking_commit.py check",
        ),
        "consistency timeline",
    )


def test_review_mutations_are_transactional_and_scoped() -> None:
    text = read("skills/story-review/SKILL.md")
    require_all(
        text,
        (
            "full / lean 모드에서는 해당 도구를 통해서만 `추적/` 수정을 허용함"
            "solo 모드는 보고만 수행하며, 어떠한 파일도 작성하지 않음",
            "mode=revision",
            "동일 ID로 현재 상태를 `upsert`함",
            "장별 기록이 규격에 맞고 제한을 초과하지 않음",
            "tracking_commit.py check",
        ),
        "story-review tracking maintenance",
    )


def test_retired_tracking_architecture_is_absent() -> None:
    paths = (
        "README.md",
        "README_EN.md",
        "skills/story-long-write/SKILL.md",
        "skills/story-long-write/references/artifact-protocols.md",
        "skills/story-long-write/references/workflow-daily.md",
        "skills/story-long-write/references/workflow-revision.md",
        "skills/story-import/SKILL.md",
        "skills/story-import/references/structure-mapping-long.md",
        "skills/story-review/SKILL.md",
        "skills/story-setup/references/templates/CLAUDE.md.tmpl",
        "skills/story-setup/references/templates/agents/story-explorer.md",
        "skills/story-setup/references/templates/rules/story-consistency.md",
    )
    retired = (
        "추적/단계_요약.md",
        "추적/캐릭터_상태.md",
        "추적/타임라인.md",
        "추적/요약/",
        "## 장별 업데이트 기록",
        "## 누적 대기 항목",
        "## 히스토리 인덱스",
        "최상위 블록이 정확히 다음 11개임",
        "마이그레이션 아카이브",
        "_tracking-meta.json",
        "이벤트_라이브러리.json",
    )
    for path in paths:
        text = read(path)
        found = [term for term in retired if term in text]
        require(not found, f"{path} still contains retired tracking architecture: {found}")

    require(
        not (ROOT / "skills/story-setup/references/templates/컨텍스트.md.tmpl").exists(),
        "manual context template must be deleted; the transaction tool renders the hot cache",
    )


def test_no_tracking_fallback_or_context_style_fingerprint_remains() -> None:
    long_write = read("skills/story-long-write/SKILL.md")
    for forbidden in (
        "캐릭터 상태 파일 누락** → 캐릭터 설정 파일 및 이전 내용에서 현재 상태 추론",
        "복선/타임라인 파일 누락** → 검사하지 않음",
    ):
        require(forbidden not in long_write, f"story-long-write still has tracking fallback: {forbidden}")
    require_all(
        long_write,
        (
            "현재 시맨틱 체크포인트가 손상된 것으로 간주",
            "본문은 존재하나 `_tracking-state.json`이 누락된 경우 `/story-import` 재실행",
        ),
        "fail-closed tracking reads",
    )
    writer = read("skills/story-setup/references/templates/agents/narrative-writer.md")
    require("`컨텍스트.md` 문체 지문" not in writer, "narrative-writer still reads a removed context style fingerprint")
    require("추적/컨텍스트.md` 「문체 지문」" not in writer, "narrative-writer still treats context as style storage")
    require("이어쓰기 상태 카드에 스타일을 저장하지 않음" in writer, "narrative-writer must keep style out of tracking context")


def test_hooks_fail_closed_on_invalid_tracking_checkpoints() -> None:
    js = read("skills/story-setup/references/templates/hooks/story_hook_core.js")
    py = read("skills/story-setup/references/codex/hooks/story_codex_hook.py")
    for label, text in (("JS hook", js), ("Codex hook", py)):
        require_all(
            text,
            (
                "_tracking-state.json 누락",
                "schema_version=4",
                "state_revision",
                "mode=revision 트랜잭션 파생 뷰 재구축",
                "/story-import 재실행",
                "last_committed_chapter",
                "먼저 커밋해야 함",
            ),
            label,
        )


def test_daily_quality_repairs_close_tracking_before_batch_finish() -> None:
    text = read("skills/story-long-write/references/workflow-daily.md")
    revision = text.index("이번 단계의 수정이 이후의 사실 관계에 영향을 줄 경우")
    step_four = text.index("## Step 4: 작업 마무리")
    require(revision < step_four, "quality repair revision invariant must appear before Step 4")
    require_all(text[revision:step_four], ("mode=revision", "`check` 통과", "단순 문구 수정은 중복 제출하지 않음"), "daily quality repair closure")


def test_tracking_examples_use_the_demo_novel() -> None:
    paths = (
        "skills/story-long-write/references/tracking-transaction.md",
        "skills/story-import/SKILL.md",
        "skills/story-import/references/character-state-reverse.md",
        "skills/story-review/SKILL.md",
        "skills/story-setup/references/templates/rules/story-consistency.md",
    )
    for path in paths:
        text = read(path)
        require("장천" in text, f"{path} must use the repository demo in examples")
        found = [term for term in ("임주", "종탑", "조사관") if term in text]
        require(not found, f"{path} still contains placeholder examples: {found}")


def test_context_retirement_must_be_declared_not_silent() -> None:
    protocol = read("skills/story-long-write/references/tracking-transaction.md")
    require_all(
        protocol,
        (
            "delta.retired_context_items",
            "delta.retired_characters",
            "## 이번 장 퇴역 등록",
            "누락된 내용이 삭제로 간주되지 않음",
        ),
        "explicit context retirement",
    )
    daily = read("skills/story-long-write/references/workflow-daily.md")
    require_all(
        daily,
        ("delta.retired_context_items", "delta.retired_characters", "장마다 전체 제출"),
        "daily workflow retirement rules",
    )


def test_init_archives_a_pre_protocol_tracking_directory() -> None:
    protocol = read("skills/story-long-write/references/tracking-transaction.md")
    require_all(
        protocol,
        ("추적/_구추적아카이브/", "검증 실패한 `init`은 파일을 이동하지 않음", "파싱에서 제외"),
        "init archive contract",
    )
    require(
        "추적/_구추적아카이브/" in read("skills/story-long-write/references/workflow-daily.md"),
        "workflow-daily must state where a pre-protocol tracking directory goes",
    )
    tool = read("skills/story-long-write/scripts/tracking_commit.py")
    require(
        'RETIRED_ARCHIVE_DIR = "_구추적아카이브"' in tool,
        "tracking_commit.py must define the archive directory used by the documented contract",
    )


def main() -> None:
    tests = [
        value
        for name, value in sorted(globals().items())
        if name.startswith("test_") and callable(value)
    ]
    for test in tests:
        test()
    print(f"Tracking workflow contract tests passed ({len(tests)} tests).")


if __name__ == "__main__":
    main()
