---
name: output-contract
description: |
  story-short-analyze 출력 계약. Stage → 파일 매핑, _meta.json 스키마,
  하위 소비 규격(story-short-write가 전체 Markdown + 원문 + _meta.json을 읽어 새 단편을 작성)을 정의한다.
sync-policy: |
  이 파일은 story-short-analyze와 story-short-write 사이에서 바이트 단위로 동일해야 한다(byte-equal).
  어느 한 사본을 수정하면 다른 사본도 반드시 동기화하고 bash scripts/check-shared-files.sh로 검증한다.
  이 파일을 IGNORE_NAMES 목록에 넣지 않는다. 반드시 동기화해야 하며 intentional differences에 해당하지 않는다.
---

# 출력 계약: story-short-analyze ↔ story-short-write

`story-short-analyze`가 단편 분석을 마치면 결과물을 `拆文库/{书名}/`에 저장한다. `story-short-write`가 같은 장르의 다음 단편을 쓸 때는 이 디렉터리의 모든 산출물을 **동시에** 읽는다.

---

## 출력 디렉터리와 파일 트리

```
拆文库/{书名}/
├── 原文/                  # 파이프라인 선행 단계의 산출물, 원본 파일 백업
├── 拆文报告.md             # 사람이 읽을 수 있는 종합 보고서(Stage 2~6 종합)
├── 情节节点.md             # Stage 2 플롯 지점 목록
├── 写作手法.md             # Stage 4 집필 기법 분석
└── _meta.json             # 파이프라인 메타데이터 + 구조 카운트(resume + 인수 검증 수치의 근거)
```

**파일명 규약**: `拆文报告.md / 情节节点.md / 写作手法.md`는 `story-short-write`가 하드코딩해 소비하므로 이름을 바꾸지 않는다. 분석 서술은 Markdown으로, 숫자·열거값은 `_meta.json.structure_counts`로 관리한다.

---

## Stage → 文件映射

| Stage | 名称 | 落地文件 | 主要内容 |
|-------|------|----------|---------|
| 2 | 结构+情节节点 | `拆文报告.md`（故事核/结构/梗概段） + `情节节点.md` | 故事核 / 4-6 段结构 / 故事梗概 / 情节节点清单 |
| 3 | 情感线+爆点 | `拆文报告.md`（情感曲线段+爆点段） | 情感曲线 ≥5 节点 / 爆点 6 维度 / 期待感 |
| 4 | 反转+写作手法 | `拆文报告.md`（反转段） + `写作手法.md` | 前置反转检查 / 反转分析（铺垫 ≥2） / 写作手法 ≥5 项 |
| 5 | 人物+开头结尾 | `拆文报告.md`（人物段+首尾段） | 人物分类+功能评估 / 开头分析 / 结尾分析 / 首尾呼应 |
| 6 | 综合评估 | `拆文报告.md`（综合段） + `_meta.json`（写 structure_counts） | 五维评分 / 爆点性 / 话题性 / 共鸣 ≥3 层 / 可复用结构 ≥3 条 / 节奏速报 |

---

## `_meta.json` 스키마

`_meta.json`은 파이프라인 메타데이터와 구조 카운트다. **분석 내용은 넣지 않고**, 인수 검증의 완전성 확인에 필요한 숫자와 열거값만 둔다. 분석 서술은 모두 `拆文报告.md`에 기록한다.

```jsonc
{
  "version": "2.0",
  "word_count": 5234,                   // 源文字数（Phase 1 探针填入）
  "genre_detected": "追妻",             // Phase 1 题材识别；未识别填 "通用"
  "created_at": "{ISO8601 时间戳}",      // 拆文启动时间，写入时填当前 UTC
  "stages_completed": [2, 3, 4, 5],     // 已完成 Stage，按完成顺序 append
  "last_stage_in_progress": null,       // 当前正在执行的 Stage；空闲为 null

  "structure_counts": {                 // Stage 6 完成时一次性写入；structure_counts 数值校验依据
    "beats": 5,                         // 结构段数（结构划分，开端/发展/高潮/结局，Stage 2）
    "hooks": 4,                         // 钩子数（Stage 3）
    "setup_clues": 3,                   // 反转铺垫线索数（Stage 4）
    "character_archetypes": 3,          // 有反差人物数（Stage 5）
    "reusable_structures": 3,           // 可复用手法条数（Stage 6）
    "reversal_type": "视角反转"          // 反转类型枚举（视角/身份/动机/时间线/信息/认知/无反转）；甜宠/喜剧/报应型填「无反转」
  }
}
```

### 기록 순서(crash safety)

1. **Stage N 开始前**：`last_stage_in_progress = N`，写盘。
2. **Stage N 文件写完后**：non-empty + 最小长度合理性检查（如 `拆文报告.md` 新增段 ≥ 200 字）。
3. **通过**：清空 `last_stage_in_progress`，append `N` 到 `stages_completed[]`。
4. **失败**：`stages_completed` 不动，`last_stage_in_progress` 保留为 `N`。
5. **Stage 6 完成时额外动作**：把 `structure_counts` 一次性算出并写入 `_meta.json`，
   然后才进入验收。

### Resume 프로토콜

- `last_stage_in_progress` 非空 → 该 Stage 上次中断，**从头**重跑（不复用半成品）。
- `last_stage_in_progress` 为空 → 从 `max(stages_completed) + 1` 开始。
- `stages_completed` 含 6 → 已完成，询问用户覆盖/取消。

**Stage 6 = 内容写完 AND 验收通过**。验收未过前 `last_stage_in_progress` 保持 `6`、`stages_completed` 不含 `6`；resume 时正文/structure_counts 已在盘上，只重跑验收检查，不重写 Stage 6 正文。

---

## 인수 검증 연결 지점

Stage 6 内容写完后、`stages_completed[6]` append 前，跑三道检查：

### Step 1：拆文报告 AI 腔自检

扫描 `拆文报告.md` 全文 against 拆文流程本地加载的禁用词表与报告 AI 腔规则。
这是拆文报告质量门；成稿去 AI 规则由写作流程在自己的 Skill 内维护，不跨 Skill 读取参考文件，也不要把两套规则混用。
命中 → 不写 `stages_completed[6]`，列出位置请用户修订**拆文报告本身**的 AI 腔
（源文里有 AI 腔不算——这里扫的是分析师写的报告）。

### Step 2：`_meta.json.structure_counts` 数值校验

| 字段 | 最低值 | 不达标 |
|------|--------|--------|
| `structure_counts.beats` | ≥ 4（结构段：开端/发展/高潮/结局）| 阻断 |
| `structure_counts.hooks` | ≥ 3 | 阻断 |
| `structure_counts.setup_clues` | ≥ 3（reversal_type=无反转时跳过本行）| 阻断 |
| `structure_counts.character_archetypes` | ≥ 2 | 阻断 |
| `structure_counts.reusable_structures` | ≥ 3 | 阻断 |
| `structure_counts.reversal_type` | 在枚举内（含「无反转」）| 阻断 |
| `genre_detected` | 非空 | 阻断 |

> 情节节点数（15-60 个，按字数分档）走 `情节节点.md` 自己的密度校验（见 material-decomposition.md），不在本表。`beats` 是结构段数，不是情节节点数。

### Step 3：`story-short-analyze` BLOCK 项扫描

扫拆文流程本地加载的输出模板，确认所有 `[BLOCK]` 标注项对应的产出段均在 `拆文报告.md` 出现。
任一缺失 → 阻断。`[WARN]` 项 → 写入拆文报告末尾「待补」清单，不阻断。

### Step 4：通过

清空 `_meta.json.last_stage_in_progress`，append `6` 到 `stages_completed[]`，提示
用户「拆解完成，可调用 `/story-short-write` 写下一篇」。

---

## 하위 소비 규격(story-short-write 사용법)

> `story-short-write` 当前硬编码读 `拆文报告.md / 情节节点.md / 写作手法.md` 三个 markdown。
> `_meta.json` 是可选增强：read 容忍，不存在不阻塞写作。

| 文件 | 角色 | 怎么读 |
|------|------|--------|
| `_meta.json`（可选）| 数字门面 + 题材识别 | 看 `genre_detected` 决定哪个题材标尺，读 `structure_counts` 确认拆文完整性，读 `structure_counts.reversal_type` 选反转骨架 |
| `拆文报告.md` | 分析叙事主体 | 读「故事核」「结构」「情感曲线」「爆点」「反转分析」「人物」「五维评分」「共鸣分析」「可复用结构」「同类型写作动作」段，是 writer 的主输入 |
| `情节节点.md` | 节奏锚点 | 看每个节点的字数位置 + 功能 + 触发事件，给新故事排节奏 |
| `写作手法.md` | 手法库 | POV / 对话 / 时间 / 信息控制 等具体手法 + 原文示例，新篇里复用 |
| `原文/` | 语感源 | 抄对话调子、节奏、画面感、打脸张力。**不抄具体情节**，抄写法。 |

### 집필 흐름 권장안

1. 看 `_meta.json.genre_detected` 和 `structure_counts.reversal_type` 选骨架。
2. 读 `拆文报告.md` 的「核心手法」「共鸣分析」「可复用结构」段，决定要保留 / 调整哪些。
3. 读 `情节节点.md` 把节奏锚点抄到新故事的字数位置上。
4. 写场景时翻 `写作手法.md` + `原文/`，参考具体写法。
5. 写完后（可选）在新文档 frontmatter 写 `derived_from: 拆文库/{书名}/` 追溯。

### 유지관리자 로컬 스모크 테스트

```bash
ls 拆文库/{书名}/   # 应有：原文/ 拆文报告.md 情节节点.md 写作手法.md _meta.json
/story-short-write 拆文库/{书名}/
# 通过：输出 8000+ 字同题材新短篇，prose 有源文对话节奏和画面感
# 失败：写得像填空 / 或 short-write 找不到三个 markdown
```

---

## 버전 규약

- `_meta.json.version` 与本文件 `sync-policy` 联动。
- breaking change（字段重命名 / 类型变更 / 必填变更）必须 bump major version 并同步两侧
  副本，CI 通过 `scripts/check-shared-files.sh` 拦截单边修改。
- additive change（新增可选字段）可 bump minor；producer、consumer 与两侧副本必须在同一变更中升级到当前 schema。
