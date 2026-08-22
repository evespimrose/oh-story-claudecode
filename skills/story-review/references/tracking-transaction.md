# 추적 상태 프로토콜

`追踪/`는 “하나의 구조화된 권위 상태 + 여러 결정적 파생 뷰”를 사용합니다. 모델은 별도 `Write/Edit/echo >>`로 여러 추적 파일을 제출하지 않고, 하나의 의미론적 JSON만 제출합니다.

## 권위 층과 파생 층

| 계층 | 파일 | 의미 |
|---|---|---|
| 유일 권위 | `_tracking-state.json` | schema, 최종 제출 장, 가져오기 마감 장, 상태 수정 번호, 문맥 구조, 모든 현재 역할/복선/타임라인 상태 |
| 장별 기록 | `逐章记录/第NNN章.md` | 해당 장이 이후 연속성에 쓸 수 있는 응축된 변경사항; 목표 ≤1536 바이트, 하드 상한 3072 바이트; 가져오기 범위 내 수정은 덮어쓰기 기록으로 작성 |
| 파생 뷰 | `上下文.md`、`角色状态/{角色名}.md`、`伏笔.md`、`时间线/作者真相.md`、`时间线/读者已知.md` | 전부 `_tracking-state.json`에서 생성; 수동 수정 금지, 프로그램 입력으로 사용하지 않음 |

Markdown은 저자와 Agent가 읽기 위한 용도일 뿐이며, 도구는 Markdown을 역으로 파싱하지 않습니다. `check`는 `_tracking-state.json`에서 직접 재렌더링하여 파일별 비교를 수행합니다. 향후 “몇 장에서 공개될지”라는 계획은 권두/세부 개요에 쓰고, 시간선(타임라인)에 사실로 적지 마십시오.
장별 기록은 사람 읽기를 돕는 응축된 변경 기록일 뿐, 개별적으로 전체 현재 상태를 무손실 재구성한다고 약속하지 않습니다; 전체 현재 의미는 `_tracking-state.json`이 기준입니다.

## 실행 도구

먼저 실행 환경에서 Python 3 인터프리터를 탐지합니다(순서대로 `python3`, `python`, `py -3`를 시도). 그다음 현재 skill 루트에서 다음을 실행합니다:

```text
{PYTHON} {当前 skill 根}/scripts/tracking_commit.py init   --project {书项目根} --input {初始化事务.json}
{PYTHON} {当前 skill 根}/scripts/tracking_commit.py commit --project {书项目根} --input {逐章事务.json}
{PYTHON} {当前 skill 根}/scripts/tracking_commit.py check  --project {书项目根}
```

- `init`:`_tracking-state.json`이 없을 때만 실행하며, 이미 초기화된 프로젝트를 절대 덮어쓰지 않습니다.
- `commit`:유일 권위 상태를 읽어 메모리에서 병합, 참조 검사, 모든 뷰 렌더링 및 용량 검사를 수행합니다; 그 다음 장별 기록과 파생 뷰를 쓰고, 마지막으로 원자적 교체로 `_tracking-state.json`을 갱신하여 유일한 제출 지점으로 삼습니다.
- `check`:state schema, 장별 기록의 연속성/규칙 이름/용량, 고정 7개 섹션, 역할 스냅샷 하드 상한, 파생 파일 집합, 그리고 모든 파생 뷰가 state와 바이트 단위로 일치하는지 엄격히 검증합니다.

동일한 책에서는 워크플로우를 직렬로만 제출할 수 있으며, 여러 Agent나 터미널의 동시 쓰기를 지원하지 않습니다. `expected_state_revision`은 오래된 상태를 기반으로 한 순차적 stale transaction을 거부하기 위한 것이며, 동시 잠금(concurrency lock)이 아닙니다.

트랜잭션 JSON은 성공하기 전까지 보존되어야 합니다. 파일 쓰기가 실패하면 `_tracking-state.json`은 진전되지 않습니다; 환경을 수정한 뒤 동일한 `commit` 파일을 그대로 다시 실행하십시오. append 재실행은 내용이 완전히 동일한 기존 장별 기록만 허용하며, `dirty/pending/repair` 상태 머신을 유지하지 않습니다.

검증 실패와 쓰기 실패 처리 방식은 다릅니다: 검증 실패(필드 불법, 퇴역된 구조, 용량 초과)는 트랜잭션 자체를 수정해 재실행해야 하며, 같은 입력으로 재실행해도 결과는 변하지 않습니다. 파생 뷰를 수동으로 수정하거나 외부에서 변경되어 `check`가 `derived view differs from _tracking-state.json`를 보고할 경우, 해당 장의 `mode=revision` 트랜잭션을 다시 제출하여 도구가 전체를 재구축하게 해야 합니다. 이때 `expected_state_revision`은 `追踪/_tracking-state.json`의 `state_revision` 필드를 사용합니다——`check` 실패는 stderr에 ERROR만 기록하고 JSON을 출력하지 않습니다; 파생 파일을 건드리지도 않고 `_tracking-state.json`을 삭제해 처음부터 다시 시작하지도 마십시오. 사람이 손으로 만든 장별 기록은 동일 장의 `append`가 영구히 `chapter delta N already exists with different content` 에러를 내게 합니다——그 수동 파일을 삭제한 뒤 원 트랜잭션을 재실행하면 됩니다.

이 도구는 구식 `_tracking-meta.json`、`时间线/事件库.json` 또는 더 이전의 추적 구조를 파싱하지 않으며, 의미적 호환 레이어를 제공하지 않습니다. `init`가 이런 구식 파일을 만나면, 먼저 원형 그대로 `追踪/_旧追踪存档/`로 전체 이동시킨 다음 현재 프로토콜을 같은 위치에 생성합니다: 구식 내용은 저자가 참조하도록 보관되며, 파싱에 참여하지 않습니다. 검증 실패한 `init`는 어떤 파일도 이동시키지 않습니다. `commit`과 `check`는 이미 프로토콜이 구축된 프로젝트에서만 작동하며 구식 구조는 즉시 거부합니다.

## 초기화 트랜잭션

새 책은 0장부터 초기화합니다. `story-import`로 기존 소설을 가져올 때는 마지막 완성 장을 `last_chapter=N`에 씁니다; 1..N장은 가짜 일일 기록을 만들지 않으며, 통상 이어 쓰기는 N+1장부터 시작합니다.

```json
{
  "schema_version": 1,
  "book_title": "계정을 맡기면, 네 고연출 하이라이트가 전역을 뒤흔든다",
  "last_chapter": 0,
  "context": {
    "position": {
      "volume": "1권·군 선전 정비",
      "volume_start_chapter": 1,
      "story_time": "장천로켓군 문공단에 보고하기 전",
      "scene": "로켓군 문공단"
    },
    "long_term_constraints": ["군 선전 쾌감 포인트는 작품 효과와 주변 반응의 연쇄로 실현해야 하며, 시스템 알림에만 의존해서는 안 된다"],
    "active_character_names": [],
    "continuity_risks": [],
    "recent_chapters": [],
    "next_chapter_commitments": ["장천이 보고하고 5일 100만 팔로워 초보 과제를 받는다"]
  },
  "character_snapshots": {},
  "foreshadow": [],
  "timeline_events": []
}
```

가져오기 초기화 시 현재의 핵심 캐릭터 스냅샷, 현재 묻힌복선, 타임라인 이벤트 및 고정 7개 칸 상태 입력을 직접 전달합니다. 연대/권 단위 회고는 필요에 따라 본문을 조회해 처리하며, 장별 강제 일관 추적 산물로 포함하지 않습니다.

## 장별 트랜잭션

```json
{
  "schema_version": 1,
  "mode": "append",
  "chapter": 10,
  "chapter_title": "전문 팀이 찍어도 그가 찍은 것보다 못하다고?",
  "expected_state_revision": 9,
  "delta": {
    "result": "전문 팀이 재촬영한 고화질판이 고위진 시사회에서 영혼이 빠졌다는 평가를 받아, 장요조가 장천의 스마트폰 원본을 계속 쓰기로 결정했다.",
    "character_changes": [
      {"name": "장천", "change": "작품의 가치가 군 내부 고위층에게 인정되어, 히트 신인에서 대체 불가한 군 선전 창작자로 올라섰다"}
    ],
    "foreshadow_changes": [
      {
        "action": "upsert",
        "id": "F027",
        "summary": "전문 팀은 여전히 장천 원본의 영혼을 재현하지 못해, 그의 창작 능력이 복제 불가함을 계속 입증한다",
        "planted_chapter": 10,
        "planned_resolution_chapter": null,
        "status": "매설됨",
        "importance": "중간"
      }
    ],
    "timeline_events": [
      {
        "action": "upsert",
        "id": "E010",
        "story_time": "실탄 훈련 이틀 뒤",
        "objective_fact": "문공단 고위층이 전문 재촬영판을 거부하고 장천이 스마트폰으로 찍은 원본 영상을 계속 쓰기로 결정했다",
        "reader_knowledge": "독자는 주박삼이 전문판에 영혼이 빠졌다고 지적하고 장요조가 현장에서 원본을 다시 쓰기로 결정하는 장면을 보았다",
        "reveal_status": "공개됨",
        "reveal_chapter": 10,
        "characters": ["장천", "주박삼", "장요조"]
      }
    ],
    "constraints": ["이후에도 작품이 실제로 낸 효과와 주변 반응으로 장천의 활약을 키워야 하며, 시스템 보상 수치만 써서는 안 된다"],
    "next_chapter_commitments": ["5일 100만 팔로워 과제를 정산하고 참전용사 주제의 새 과제를 이어받는다"]
  },
  "context": {
    "position": {
      "volume": "1권·군 선전 정비",
      "volume_start_chapter": 1,
      "story_time": "실탄 훈련 이틀 뒤",
      "scene": "로켓군 문공단 고위진 시사회"
    },
    "long_term_constraints": ["군 선전 쾌감 포인트는 작품 효과와 주변 반응의 연쇄로 실현해야 하며, 시스템 알림에만 의존해서는 안 된다"],
    "active_character_names": ["장천"],
    "continuity_risks": ["종가가는 장천이 절반만 맞혔다고 말했으며, 공개되지 않은 육성 계획을 독자가 아는 사실로 취급해서는 안 된다"]
  },
  "character_snapshots": {
    "장천": {
      "identity": "로켓군 문공단 선전병; 군 선전 히트 창작자",
      "location": "로켓군 문공단 고위진 시사회",
      "goal": "5일 100만 팔로워 과제를 완료하고, 실제로 통하는 군 선전 콘텐츠를 계속 만든다",
      "state": "전문 팀의 반대 검증으로 원본의 가치가 확인되어 군 내부의 인정이 계속 높아진다",
      "abilities_resources": ["전생의 MCN 히트 운영 경험", "《중국 군혼》 반주", "대가급 연출 능력"],
      "relationships": ["종가가 군보 자료를 계속 제공한다", "주박삼과 장요조가 그의 창작 능력을 이미 분명히 인정했다"],
      "knowledge": ["《군보》인터뷰 원고는 이미 심사를 통과했다", "원본 영상은 계속 정식 군 선전 콘텐츠로 사용된다"],
      "open_threads": ["5일 100만 팔로워과제는 아직 정산되지 않았다", "종가가이른바 절반만 맞혔다는 말은 아직 설명되지 않았다"]
    }
  }
}
```

제약 사항:

- 트랜잭션을 구성하기 전에 `check`를 실행해 현재 `state_revision`을 그대로 `expected_state_revision`에 써 넣으십시오; 상태가 이미 변경되었다면 state를 다시 읽어 트랜잭션을 재구성해야 합니다.
- `context`에서 허용되는 필드는 서브커맨드에 따라 다릅니다: `init`는 `position`, `long_term_constraints`, `active_character_names`, `continuity_risks`, `recent_chapters`, `next_chapter_commitments` 여섯 항목을 받고; `commit`은 앞의 네 항목만 받습니다. `recent_chapters`와 `next_chapter_commitments`는 commit 시 도구가 현재 뷰와 본장 `delta`에서 파생하므로 수동 입력하면 어떤 쓰기 작업 전에 거부됩니다(`context contains unsupported fields: ...`, exit 2). init 예시를 그대로 따라 commit 트랜잭션을 작성하는 것이 가장 자주 실수하는 부분입니다.
- `character_snapshots`에 등장한 캐릭터는 핵심 재사용 캐릭터로 간주되며, 반드시 `character_changes`에도 동시에 등장해야 합니다; 이미 스냅샷이 있는 핵심 캐릭터가 다시 변할 경우 새로운 스냅샷을 제출해야 합니다.
- 역할 스냅샷의 네 개 리스트는 항목 수에 제한을 두지 않지만, 개별 항목 길이 및 최종 파일 총 바이트는 제한됩니다: 목표 ≤4096 바이트(초과 시 경고), 하드 상한 8192 바이트(초과하면 어떤 쓰기 전에도 거부).
- 스냅샷이 없는 역할 변경은 임시 캐릭터로 취급되어 상태 파일을 생성하지 않습니다; `context.active_character_names`는 최대 6인까지 허용되며 반드시 현재 스냅샷이 존재해야 합니다.
- `context.long_term_constraints`와 `context.continuity_risks`는 제출 전체의 현재 값입니다. 이전 버전에 있었으나 이번 제출에서 빠진 항목은 항목별로 `delta.retired_context_items`에 모두 기입해야 하며, 그렇지 않으면 도구가 어떤 쓰기 전에도 거부합니다——누락은 삭제로 간주되지 않습니다. 실제로 퇴역된 항목은 도구가 본장 장별 기록의 `## 本章退役登记`에 기록하며, 이후 조회가 가능합니다.
- 더 이상 재사용하지 않을 핵심 캐릭터는 `delta.retired_characters`에 적어야 합니다: 도구는 해당 캐릭터의 현재 스냅샷과 `角色状态/{角色名}.md`를 삭제하고 장별 기록에 보관합니다. 같은 트랜잭션에서 퇴역 처리와 스냅샷 제출을 동시에 할 수 없고, `context.active_character_names`에 남아 있는 캐릭터를 퇴역시킬 수도 없습니다. 캐릭터의 전사/퇴장은 해당 장의 `character_changes`에 변화로 기록하면 되고, 장별 퇴역 캐릭터는 즉시 삭제될 스냅샷을 별도로 제출할 필요가 없습니다; 장별 기록은 여전히 핵심 캐릭터로 표기됩니다. 퇴역은 단지 더 이상 열띤 문맥에 들어오지 않음을 의미하며, 본문과 장별 기록에는 영향이 없습니다.
- 두 종류의 퇴역은 모두 `mode=append`로만 제출할 수 있습니다. 퇴역은 “지금부터 현재 상태에서 빠짐”을 의미하며, 수정 모드로 제출되는 장의 장별 기록은 그 장이 수정된 역사적 기록으로 남아 퇴역이 발생한 장을 잘못 보고할 수 있습니다; `mode=revision`은 현재의 모든 문맥 항목을 그대로 재제출해야 하므로 퇴역은 다음 append에 넣으십시오.
- `伏笔.md`는 이미 묻힌(매설) 현재 상태만을 표시합니다. 향후 계획은 여전히 개요에 남겨두십시오.
- `timeline_events.action`은 `upsert/delete`가 될 수 있습니다. `未揭示` 상태의 `reveal_chapter`는 반드시 `null`이어야 하며; 일부/전부 공개된 이벤트는 이미 발생한 실제 장만 적을 수 있습니다.
- `mode=revision`일 때, 장별 기록은 수정 후에도 해당 장이 여전히 유효한 완전한 연속성 기록으로 다시 계산되어야 합니다; 현재 역할, 복선, 타임라인, 문맥은 최신 작성 장까지 영향을 받은 대상의 현재 값으로 제출됩니다.
- 가져오기(import)로 마감 장 범위 내의 본문을 수정할 때는 해당 장의 장별 기록이 새로 추가되거나 덮어써집니다; `imported_through_chapter`는 변하지 않습니다.

## 연속 집필 상태 카드 고정 형식

`上下文.md` ≤12288 바이트로, state에서 전체 생성되며 다음 7개 최상위 블록만 포함합니다:

1. `## 当前位置`
2. `## 长期约束`
3. `## 核心角色状态`
4. `## 活跃伏笔`
5. `## 近三章速记`
6. `## 下一章承诺`
7. `## 连贯性风险`

여기서 활성 역할은 최대 6인, 활성복선는 결정적 선택으로 최대 8개, 최근 장은 3장만 보존합니다. 이 항목들은 다음 장의 핫 컨텍스트 용량이며, 전체 역할 상태의 용량 제한을 의미하지 않습니다.