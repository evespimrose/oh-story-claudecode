#!/usr/bin/env python3
"""Behavioral regression tests for the single-authority tracking state tool."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "skills/story-long-write/scripts/tracking_commit.py"


def position(*, volume: str = "제1권·군 선전 정돈", start: int = 1) -> dict[str, object]:
    return {
        "volume": volume,
        "volume_start_chapter": start,
        "story_time": "실탄 훈련 2일 후",
        "scene": "로켓군 문공단 고위층 영상 감상회",
    }


def initial_document(*, last_chapter: int = 0) -> dict[str, object]:
    return {
        "schema_version": 1,
        "book_title": "당신에게 계정을 관리하라고 했는데, 고연 믹스컷이 전 네트워크를 폭발시키다",
        "last_chapter": last_chapter,
        "context": {
            "position": position(),
            "long_term_constraints": ["군부의 장천 양성 후속 계획은 아직 독자에게 공개되지 않았다."],
            "active_character_names": [],
            "continuity_risks": [],
            "recent_chapters": [
                {"chapter": chapter, "summary": f"제{chapter}장 군 홍보 계정 영향력 지속 확대."}
                for chapter in range(max(1, last_chapter - 2), last_chapter + 1)
            ],
            "next_chapter_commitments": ["5일 백만 팔로워 작업 추진."] if last_chapter else [],
        },
        "character_snapshots": {},
        "foreshadow": [],
        "timeline_events": [],
    }


def snapshot(*, state: str = "군 내부 승인 지속 상향", items: int = 1, repeat: int = 1) -> dict[str, object]:
    phrases = {
        "abilities_resources": "베테랑 인터뷰 승인 및 군 홍보 제작 리소스 계속 사용 필요",
        "relationships": "종가가 및 문공단과의 협력 관계가 다음 단계 의사결정에 영향",
        "knowledge": "군 홍보 프로세스 및 작품 배포 결과가 이미 확인됨",
        "open_threads": "아직 회수되지 않은 인력 양성 계획과 작품 계획을 계속 추진해야 함",
    }
    return {
        "identity": "로켓군 문공단 홍보병",
        "location": "로켓군 문공단 고위층 시사회",
        "goal": "5일 백만 팔로워 작업 완료",
        "state": state,
        **{
            field: [f"제{index + 1}항: {phrase * repeat}" for index in range(items)]
            for field, phrase in phrases.items()
        },
    }


def transaction(
    chapter: int,
    *,
    mode: str = "append",
    character: bool = False,
    foreshadow: bool = False,
    timeline: bool = False,
    next_commitment: str = "백만 팬 작업을 정산하고 베테랑 주제를 인수한다.",
) -> dict[str, object]:
    character_changes = [{"name": "강진", "change": "작품 가치가 군 내 고위층에서 확인됨"}] if character else []
    foreshadow_changes = (
        [
            {
                "action": "upsert",
                "id": "F027",
                "summary": "전문 팀도 강진의 원래 버전의 영혼을 담아내지 못했다.",
                "planted_chapter": chapter,
                "planned_resolution_chapter": chapter + 8,
                "status": "매장됨",
                "importance": "높음",
            }
        ]
        if foreshadow
        else []
    )
    timeline_events = (
        [
            {
                "action": "upsert",
                "id": "E010",
                "story_time": "실탄 훈련 이틀 후",
                "objective_fact": "군부는 장천에 대해 아직 공개되지 않은 후속 계획을 가지고 있다.",
                "reader_knowledge": "독자는 전문 재촬영판이 거절되었다는 것만 알고 있으며, 후속 양성 계획은 모르고 있다.",
                "reveal_status": "미공개",
                "reveal_chapter": None,
                "characters": ["강진", "종가가"],
            }
        ]
        if timeline
        else []
    )
    return {
        "schema_version": 1,
        "mode": mode,
        "chapter": chapter,
        "chapter_title": f"군사선전 대히트·{chapter}",
        "delta": {
            "result": f"강진이 제{chapter}장에서 계속 군사선전 작품의 영향력을 확대했다.",
            "character_changes": character_changes,
            "foreshadow_changes": foreshadow_changes,
            "timeline_events": timeline_events,
            "constraints": [],
            "next_chapter_commitments": [next_commitment],
        },
        "context": {
            "position": position(),
            "long_term_constraints": ["군 측이 강진을 양성하기 위한 후속 계획은 아직 독자들에게 공개되지 않았다."],
            "active_character_names": ["강진"] if character else [],
            "continuity_risks": [],
        },
        "character_snapshots": {"강진": snapshot()} if character else {},
    }


def load_tool_module():
    spec = importlib.util.spec_from_file_location("tracking_commit_under_test", TOOL)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TrackingCommitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.project = Path(self.temporary.name) / "계정 관리를 해주세요, 높은 연소 혼합 편집으로 전체 네트워크 폭발"
        self.project.mkdir()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_tool(
        self,
        command: str,
        document: dict[str, object] | None = None,
        *,
        expect: int = 0,
    ) -> subprocess.CompletedProcess[str]:
        args = [sys.executable, str(TOOL), command, "--project", str(self.project)]
        if document is not None:
            document = json.loads(json.dumps(document, ensure_ascii=False))
            if command == "commit" and "expected_state_revision" not in document:
                document["expected_state_revision"] = self.read_state()["state_revision"]
            input_path = Path(self.temporary.name) / f"{command}-{os.urandom(4).hex()}.json"
            input_path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
            args.extend(["--input", str(input_path)])
        # 도구는 UTF-8로 직접 바이트를 기록하고, text=True는 기본적으로 locale로 디코드하며, Windows의 cp1252는
        # 중국어 프롬프트를 읽을 때 UnicodeDecodeError를 발생시키므로 반드시 명시적으로 UTF-8을 지정해야 합니다.
        completed = subprocess.run(
            args, text=True, capture_output=True, check=False, encoding="utf-8"
        )
        self.assertEqual(
            completed.returncode,
            expect,
            msg=f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}",
        )
        return completed

    def init(self, *, last_chapter: int = 0) -> None:
        self.run_tool("init", initial_document(last_chapter=last_chapter))

    def read_state(self) -> dict[str, object]:
        return json.loads((self.project / "추적/_tracking-state.json").read_text(encoding="utf-8"))

    def test_init_creates_one_structured_authority_and_only_derived_views(self) -> None:
        self.init()
        tracking = self.project / "추적"
        state = self.read_state()

        self.assertEqual(state["schema_version"], 4)
        self.assertEqual(state["state_revision"], 0)
        self.assertEqual(state["characters"], {})
        self.assertEqual(state["foreshadow"], {})
        self.assertEqual(state["timeline"], {})
        self.assertFalse((tracking / "_tracking-meta.json").exists())
        self.assertFalse((tracking / "타임라인/이벤트_라이브러리.json").exists())
        self.assertIn("상태 수정: 0", (tracking / "컨텍스트.md").read_text(encoding="utf-8"))
        self.run_tool("check")

    def test_commit_updates_state_and_all_demo_derived_views(self) -> None:
        self.init()
        self.run_tool("commit", transaction(1, character=True, foreshadow=True, timeline=True))
        tracking = self.project / "추적"
        state = self.read_state()

        self.assertEqual(state["last_committed_chapter"], 1)
        self.assertEqual(state["state_revision"], 1)
        self.assertIn("강진", state["characters"])
        self.assertIn("F027", state["foreshadow"])
        self.assertIn("E010", state["timeline"])
        self.assertIn("상태 수정: 1", (tracking / "컨텍스트.md").read_text(encoding="utf-8"))
        self.assertIn("F027｜전문 팀도 여전히 장진의 원본 영혼을 재현할 수 없음", (tracking / "컨텍스트.md").read_text(encoding="utf-8"))
        self.assertIn("군방이 장진을 키운 후속 계획이 아직 공개되지 않음", (tracking / "시간선/작가 진실.md").read_text(encoding="utf-8"))
        self.assertNotIn("군방이 장진을 키운 후속 계획이 아직 공개되지 않음", (tracking / "시간선/독자 알려진 것.md").read_text(encoding="utf-8"))
        self.assertTrue((tracking / "장별 기록/제001장.md").exists())
        self.run_tool("check")

    def test_character_snapshot_lists_are_not_limited_to_eight_items(self) -> None:
        self.init()
        document = transaction(1, character=True)
        document["character_snapshots"]["강진"] = snapshot(items=12)

        completed = self.run_tool("commit", document)

        self.assertNotIn("at most 8 items", completed.stderr)
        self.assertEqual(len(self.read_state()["characters"]["강진"]["relationships"]), 12)
        self.run_tool("check")

    def test_snapshot_target_warns_and_hard_cap_rejects_before_any_write(self) -> None:
        self.init()
        warning = transaction(1, character=True)
        warning["character_snapshots"]["강진"] = snapshot(items=12, repeat=2)
        completed = self.run_tool("commit", warning)
        self.assertIn("WARNING: character snapshot 강진", completed.stderr)
        self.assertEqual(self.read_state()["state_revision"], 1)

        rejected = transaction(2, character=True)
        rejected["character_snapshots"]["강진"] = snapshot(items=24, repeat=4)
        before = json.loads(json.dumps(self.read_state(), ensure_ascii=False))
        completed = self.run_tool("commit", rejected, expect=2)
        self.assertIn("hard cap of 8192 bytes", completed.stderr)
        self.assertEqual(self.read_state(), before)
        self.assertFalse((self.project / "추적/장별기록/제002장.md").exists())

    def test_missing_active_snapshot_is_rejected_before_any_write(self) -> None:
        self.init()
        document = transaction(1)
        document["context"]["active_character_names"] = ["존재하지 않는 핵심 역할"]
        before = self.read_state()

        result = self.run_tool("commit", document, expect=2)

        self.assertIn("has no current snapshot", result.stderr)
        self.assertEqual(self.read_state(), before)
        self.assertFalse((self.project / "추적/장별기록/제001장.md").exists())

    def test_partial_view_write_keeps_old_authority_and_same_transaction_can_retry(self) -> None:
        self.init()
        module = load_tool_module()
        document = transaction(1, character=True, foreshadow=True, timeline=True)
        document["expected_state_revision"] = 0
        original = module.atomic_write_text

        def fail_on_foreshadow(path: Path, payload: str) -> None:
            if path.name == "복선.md":
                raise OSError("injected derived-view failure")
            original(path, payload)

        module.atomic_write_text = fail_on_foreshadow
        with self.assertRaises(OSError):
            module.apply_transaction(self.project, document)

        self.assertEqual(self.read_state()["state_revision"], 0)
        self.assertIn("상태 수정: 1", (self.project / "추적/상하문.md").read_text(encoding="utf-8"))
        self.run_tool("check", expect=2)

        module.atomic_write_text = original
        module.apply_transaction(self.project, document)
        self.assertEqual(self.read_state()["state_revision"], 1)
        self.run_tool("check")

    def test_stale_revision_cannot_overwrite_newer_state(self) -> None:
        self.init()
        self.run_tool("commit", transaction(1, foreshadow=True, timeline=True))
        stale = transaction(1, mode="revision", foreshadow=True, timeline=True)
        stale["expected_state_revision"] = 1
        self.run_tool("commit", transaction(2))

        result = self.run_tool("commit", stale, expect=2)

        self.assertIn("tracking state changed", result.stderr)
        self.assertEqual(self.read_state()["last_committed_chapter"], 2)
        self.assertEqual(self.read_state()["state_revision"], 2)

    def test_old_revision_preserves_current_next_chapter_commitment(self) -> None:
        self.init()
        self.run_tool("commit", transaction(1, next_commitment="전문가 팀을 투입하여 재촬영합니다."))
        self.run_tool("commit", transaction(2, next_commitment="경영진의 검토 의견을 기다립니다."))
        self.run_tool("commit", transaction(3, next_commitment="5일 백만 팬 작업을 정산합니다."))
        self.run_tool("commit", transaction(1, mode="revision", next_commitment="당시 장 섹션의 이전 약속을 수정합니다."))

        context = (self.project / "추적/상황.md").read_text(encoding="utf-8")
        self.assertIn("정산 5일 백만 팬 작업", context)
        self.assertNotIn("수정 장 당시의 구 약속", context)

    def test_old_revision_applies_current_rows_without_moving_update_chapter_back(self) -> None:
        self.init()
        self.run_tool("commit", transaction(1, foreshadow=True, timeline=True))
        chapter_two = transaction(2, foreshadow=True, timeline=True)
        chapter_two["delta"]["foreshadow_changes"][0].update(
            planted_chapter=1,
            planned_resolution_chapter=2,
            status="회수됨",
            summary="전문가 버전에 부족한 영혼 판단이 이미 고위층에서 결정되어 실행됨.",
        )
        chapter_two["delta"]["timeline_events"][0]["reader_knowledge"] = "독자가 이미 장야오주 강진 원판 채택을 봤음."
        self.run_tool("commit", chapter_two)

        revision = transaction(1, mode="revision", foreshadow=True, timeline=True)
        revision["delta"]["foreshadow_changes"][0].update(
            planted_chapter=1,
            planned_resolution_chapter=2,
            status="회수됨",
            summary="프로 버전의 핵심 판단이 경영진의 결정으로 반영되었습니다.",
        )
        revision["delta"]["timeline_events"][0]["reader_knowledge"] = "독자가 이미 장야오주의 장첸 원본 채택을 확인했습니다."
        self.run_tool("commit", revision)

        state = self.read_state()
        self.assertEqual(state["foreshadow"]["F027"]["updated_chapter"], 2)
        self.assertEqual(state["timeline"]["E010"]["updated_chapter"], 2)
        self.run_tool("check")

    def test_imported_cutoff_requires_only_new_daily_records(self) -> None:
        self.init(last_chapter=27)
        self.run_tool("commit", transaction(28, character=True))
        tracking = self.project / "추적"

        self.assertFalse((tracking / "장별_기록/제027장.md").exists())
        self.assertTrue((tracking / "장별기록/제028장.md").exists())
        self.assertEqual(self.read_state()["imported_through_chapter"], 27)
        self.run_tool("check")

    def test_imported_chapter_revision_creates_an_overlay_record(self) -> None:
        self.init(last_chapter=20)
        self.run_tool("commit", transaction(10, mode="revision"))
        self.assertTrue((self.project / "추적/장별기록/제010장.md").exists())
        self.assertEqual(self.read_state()["imported_through_chapter"], 20)
        self.run_tool("check")

    def test_check_compares_derived_views_to_state_without_parsing_markdown(self) -> None:
        self.init()
        self.run_tool("commit", transaction(1, character=True, foreshadow=True, timeline=True))
        tracking = self.project / "추적"

        path = tracking / "캐릭터상태/강진.md"
        path.write_text("# 임의로 수정한 형식\n", encoding="utf-8")
        result = self.run_tool("check", expect=2)
        self.assertIn("derived view differs from _tracking-state.json", result.stderr)

        self.run_tool("commit", transaction(2))
        self.run_tool("check")

    def test_check_rejects_orphan_character_file(self) -> None:
        self.init()
        orphan = self.project / "추적/역할상태/CONFLICT.md"
        orphan.write_text("# orphan\n", encoding="utf-8")
        result = self.run_tool("check", expect=2)
        self.assertIn("character snapshot files differ", result.stderr)

    def test_unknown_fields_are_rejected(self) -> None:
        invalid_init = initial_document()
        invalid_init["baseline"] = {}
        self.run_tool("init", invalid_init, expect=2)

        self.init()
        state = self.read_state()
        state["status"] = "clean"
        (self.project / "추적/_tracking-state.json").write_text(
            json.dumps(state, ensure_ascii=False), encoding="utf-8"
        )
        result = self.run_tool("check", expect=2)
        self.assertIn("unsupported fields", result.stderr)

    def test_init_archives_a_pre_transaction_tracking_directory(self) -> None:
        tracking = self.project / "추적"
        tracking.mkdir()
        (tracking / "역할상태.md").write_text("# 이전 역할상태\n", encoding="utf-8")
        (tracking / "타임라인.md").write_text("# 이전 타임라인\n", encoding="utf-8")
        (tracking / "_tracking-meta.json").write_text("{}\n", encoding="utf-8")

        result = self.run_tool("init", initial_document())
        self.assertIn("_이전추적아카이브", result.stderr)
        archive = tracking / "_이전추적아카이브"
        self.assertEqual((archive / "캐릭터상태.md").read_text(encoding="utf-8"), "# 이전캐릭터상태\n")
        self.assertEqual((archive / "타임라인.md").read_text(encoding="utf-8"), "# 이전타임라인\n")
        self.assertFalse((tracking / "캐릭터상태.md").exists())
        self.assertTrue((tracking / "역할상태").is_dir())
        self.run_tool("check")

    def test_failed_init_leaves_the_old_tracking_directory_untouched(self) -> None:
        tracking = self.project / "추적"
        tracking.mkdir()
        (tracking / "역할상태.md").write_text("# 이전역할상태\n", encoding="utf-8")
        invalid = initial_document()
        invalid["baseline"] = {}

        self.run_tool("init", invalid, expect=2)
        self.assertTrue((tracking / "역할상태.md").exists())
        self.assertFalse((tracking / "_이전추적보관").exists())

    def test_commit_and_check_still_refuse_a_retired_layout(self) -> None:
        self.init()
        (self.project / "추적/타임라인.md").write_text("# 이전 타임라인\n", encoding="utf-8")
        result = self.run_tool("check", expect=2)
        self.assertIn("retired tracking files", result.stderr)
        result = self.run_tool("commit", transaction(1), expect=2)
        self.assertIn("retired tracking files", result.stderr)

    def test_dropping_a_context_item_without_declaring_it_is_rejected(self) -> None:
        self.init()
        silent = transaction(1)
        silent["context"]["long_term_constraints"] = []
        result = self.run_tool("commit", silent, expect=2)
        self.assertIn("retired_context_items", result.stderr)
        self.assertEqual(self.read_state()["state_revision"], 0)
        self.assertFalse((self.project / "추적/장별기록/제001장.md").exists())

    def test_declared_context_retirement_is_recorded_in_the_chapter_delta(self) -> None:
        self.init()
        declared = transaction(1)
        constraint = "군부의 장진 양성 후속 계획은 아직 독자에게 공개되지 않았습니다."
        declared["context"]["long_term_constraints"] = []
        declared["delta"]["retired_context_items"] = [constraint]
        self.run_tool("commit", declared)

        self.assertEqual(self.read_state()["context"]["long_term_constraints"], [])
        delta_text = (self.project / "추적/장별기록/제001장.md").read_text(encoding="utf-8")
        self.assertIn("## 본장 퇴역 등록", delta_text)
        self.assertIn(constraint, delta_text)
        self.run_tool("check")

    def test_retiring_a_core_character_removes_its_derived_view(self) -> None:
        self.init()
        self.run_tool("commit", transaction(1, character=True))
        self.assertTrue((self.project / "추적/캐릭터상태/강진.md").exists())

        retire = transaction(2)
        retire["delta"]["retired_characters"] = ["강진"]
        self.run_tool("commit", retire)

        self.assertNotIn("장진", self.read_state()["characters"])
        self.assertFalse((self.project / "추적/캐릭터상태/장진.md").exists())
        self.assertIn("캐릭터상태：장진", (self.project / "추적/장별기록/제002장.md").read_text(encoding="utf-8"))
        self.run_tool("check")

    def test_an_interrupted_archive_can_be_resumed(self) -> None:
        tracking = self.project / "추적"
        (tracking / "_이전추적아카이브").mkdir(parents=True)
        (tracking / "역할상태.md").write_text("# 미이전\n", encoding="utf-8")
        (tracking / "_이전추적아카이브/타임라인.md").write_text("# 이전완료\n", encoding="utf-8")

        self.run_tool("init", initial_document())
        archive = tracking / "_이전추적아카이브"
        self.assertEqual((archive / "역할_상태.md").read_text(encoding="utf-8"), "# 미이전\n")
        self.assertEqual((archive / "타임라인.md").read_text(encoding="utf-8"), "# 이전_완료\n")
        self.run_tool("check")

    def test_archive_never_clobbers_an_already_archived_file(self) -> None:
        tracking = self.project / "추적"
        (tracking / "_이전_추적_아카이브").mkdir(parents=True)
        (tracking / "역할_상태.md").write_text("현역\n", encoding="utf-8")
        (tracking / "_이전추적보관/캐릭터상태.md").write_text("아카이브\n", encoding="utf-8")

        result = self.run_tool("init", initial_document(), expect=2)
        self.assertIn("already exists", result.stderr)
        self.assertEqual((tracking / "캐릭터상태.md").read_text(encoding="utf-8"), "현역\n")
        self.assertEqual((tracking / "_이전_추적_아카이브/캐릭터_상태.md").read_text(encoding="utf-8"), "아카이브\n")

    def test_a_character_can_die_and_retire_in_one_transaction(self) -> None:
        self.init()
        self.run_tool("commit", transaction(1, character=True))
        farewell = transaction(2)
        farewell["delta"]["character_changes"] = [{"name": "강천", "change": "최종 전투에서 전사하여 완전히 퇴장"}]
        farewell["delta"]["retired_characters"] = ["강천"]
        self.run_tool("commit", farewell)

        record = (self.project / "추적/장별기록/제002장.md").read_text(encoding="utf-8")
        self.assertIn("강진｜핵심｜최종 전투에서 전사, 완전히 퇴장", record)
        self.assertIn("캐릭터 상태：강진", record)
        self.assertNotIn("강진", self.read_state()["characters"])
        self.run_tool("check")

    def test_retirement_is_rejected_in_a_revision(self) -> None:
        self.init(last_chapter=20)
        retire = transaction(10, mode="revision")
        retire["delta"]["retired_characters"] = ["강진"]
        result = self.run_tool("commit", retire, expect=2)
        self.assertIn("append transaction", result.stderr)

        drop = transaction(10, mode="revision")
        drop["context"]["long_term_constraints"] = []
        drop["delta"]["retired_context_items"] = ["군부가 장정을 양성한 후속 계획은 아직 독자에게 공개되지 않았다."]
        result = self.run_tool("commit", drop, expect=2)
        self.assertIn("append transaction", result.stderr)
        self.assertEqual(self.read_state()["state_revision"], 0)

    def test_retiring_a_still_active_character_is_rejected(self) -> None:
        self.init()
        self.run_tool("commit", transaction(1, character=True))
        conflict = transaction(2, character=True)
        conflict["delta"]["retired_characters"] = ["장정"]
        result = self.run_tool("commit", conflict, expect=2)
        self.assertIn("장정", result.stderr)
        self.assertEqual(self.read_state()["state_revision"], 1)

    def test_windows_reserved_character_name_is_rejected(self) -> None:
        self.init()
        invalid = transaction(1, character=True)
        invalid["delta"]["character_changes"][0]["name"] = "CON"
        invalid["character_snapshots"] = {"CON": invalid["character_snapshots"]["장정"]}
        self.run_tool("commit", invalid, expect=2)
        self.assertEqual(self.read_state()["state_revision"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
