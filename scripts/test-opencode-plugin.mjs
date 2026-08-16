#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(repoRoot, "skills/story-setup/references/opencode");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "story-opencode-plugin-"));
const originalCwd = process.cwd();

// plugin.ts는 "./lib/story_hook_core.js"를 임포트합니다. (ZCode와 공유되는 prose-guard 코어, 배포 위치:
// .opencode/plugins/lib/). 저장소 소스 코드에서 코어는 평면 구조이며, 배포 레이아웃에만 lib/ 하위 디렉터리가 있습니다. tmp에서
// 배포 레이아웃을 복제해야 import가 코어를 해석할 수 있습니다.
const deployDir = path.join(tmp, "plugins");
fs.mkdirSync(path.join(deployDir, "lib"), { recursive: true });
fs.copyFileSync(path.join(srcDir, "plugin.ts"), path.join(deployDir, "plugin.ts"));
fs.copyFileSync(
  path.join(srcDir, "story_hook_core.js"),
  path.join(deployDir, "lib", "story_hook_core.js")
);
const pluginPath = path.join(deployDir, "plugin.ts");

async function expectBlocked(action, label) {
  await assert.rejects(action, /본문 작성이 차단됨/, label);
}

function writeCleanState(book, lastCommitted = 0) {
  fs.mkdirSync(path.join(book, "추적"), { recursive: true });
  fs.writeFileSync(
    path.join(book, "추적", "_tracking-state.json"),
    JSON.stringify({ schema_version: 4, state_revision: 0, last_committed_chapter: lastCommitted }) + "\n",
    "utf8"
  );
  fs.writeFileSync(path.join(book, "추적", "컨텍스트.md"), "> 상태 수정: 0\n", "utf8");
}

try {
  execFileSync("git", ["init", "-q", tmp]);
  process.chdir(tmp);
  const imported = await import(`${pathToFileURL(pluginPath).href}?test=${Date.now()}`);
  const hooks = await imported.default({});
  assert.equal(typeof hooks["tool.execute.before"], "function");
  assert.equal(typeof hooks["tool.execute.after"], "function");
  assert.equal(typeof hooks["experimental.session.compacting"], "function");

  fs.mkdirSync("book/본문", { recursive: true });
  fs.mkdirSync("book/개요", { recursive: true });
  fs.mkdirSync("book/추적", { recursive: true });
  fs.writeFileSync("book/추적/컨텍스트.md", "# 컨텍스트\n현재 위치\n", "utf8");
  fs.writeFileSync(".active-book", "book\n", "utf8");

  await expectBlocked(
    () =>
      hooks["tool.execute.before"](
        { tool: "write" },
        { args: { filePath: "book/본문/제001장_시작.md" } }
      ),
    "new long prose without an outline"
  );

  fs.writeFileSync("book/개요/상세_개요_제1장.md", "# 상세 개요\n", "utf8");
  await assert.rejects(
    () =>
      hooks["tool.execute.before"](
        { tool: "write" },
        { args: { filePath: "book/본문/제001장_시작.md" } }
      ),
    /_tracking-state\.json 누락/,
    "long prose with outline but no tracking checkpoint must fail closed"
  );
  writeCleanState("book");
  await hooks["tool.execute.before"](
    { tool: "write" },
    { args: { filePath: "book/본문/제001장_시작.md" } }
  );

  fs.mkdirSync("bare/본문", { recursive: true });
  await expectBlocked(
    () =>
      hooks["tool.execute.before"](
        { tool: "write" },
        { args: { filePath: "bare/본문/제1장_첫_장.md" } }
      ),
    "bare long project without scaffolding must fail closed"
  );

  fs.mkdirSync("cwd-book/본문", { recursive: true });
  fs.mkdirSync("cwd-book/개요", { recursive: true });
  await assert.rejects(
    () =>
      hooks["tool.execute.before"](
        { tool: "bash" },
        {
          args: {
            command: "cat draft.md > 본문/제8장_상대.md",
            workdir: path.join(tmp, "cwd-book"),
          },
        }
      ),
    /cwd-book\/개요/,
    "relative Bash target must resolve from the tool workdir"
  );
  fs.writeFileSync("cwd-book/개요/상세_개요_제8장.md", "# 상세 개요\n", "utf8");
  writeCleanState("cwd-book", 7);
  await hooks["tool.execute.before"](
    { tool: "bash" },
    {
      args: {
        command: "cat draft.md > 본문/제8장_상대.md",
        workdir: path.join(tmp, "cwd-book"),
      },
    }
  );

  fs.writeFileSync("book/본문/제002장_이어쓰기.md", "기존 본문 있음.\n", "utf8");
  await hooks["tool.execute.before"](
    { tool: "edit" },
    { args: { filePath: "book/본문/제002장_이어쓰기.md" } }
  );
  fs.writeFileSync(
    "book/추적/_tracking-state.json",
    JSON.stringify({ schema_version: 4, state_revision: 1, last_committed_chapter: 0 }) + "\n",
    "utf8"
  );
  await assert.rejects(
    () =>
      hooks["tool.execute.before"](
        { tool: "edit" },
        { args: { filePath: "book/본문/제002장_이어쓰기.md" } }
      ),
    /mode=revision 트랜잭션 재구축 파생 뷰/,
    "existing prose revision must be blocked while derived state is inconsistent"
  );
  writeCleanState("book", 3);

  await expectBlocked(
    () =>
      hooks["tool.execute.before"](
        { tool: "bash" },
        { args: { command: "cat draft.md > book/본문/제003장_우회.md" } }
      ),
    "bash redirect must not bypass the outline guard"
  );
  await hooks["tool.execute.before"](
    { tool: "bash" },
    { args: { command: "grep 'book/본문/제003장_우회.md' notes.md" } }
  );

  // apply_patch 는 OpenCode 의 edit 계열 도구이며, gpt-5 계열 모델은 이것만 노출하고 write/edit 는 숨깁니다:
  // 가드와 파일 저장 폴백 모두 이를 인식해야 하며, 그렇지 않으면 해당 모델들은 전체 과정에서 개요 가드와 본문 폴백이 작동하지 않게 됩니다.
  const addPatch = (target) =>
    `*** Begin Patch\n*** Add File: ${target}\n+본문 첫 번째 문장.\n*** End Patch\n`;
  await expectBlocked(
    () =>
      hooks["tool.execute.before"](
        { tool: "apply_patch" },
        { args: { patchText: addPatch("book/본문/제004장_패치.md") } }
      ),
    "apply_patch must not bypass the outline guard"
  );
  fs.writeFileSync("book/개요/상세_개요_제4장.md", "# 상세 개요\n", "utf8");
  await hooks["tool.execute.before"](
    { tool: "apply_patch" },
    { args: { patchText: addPatch("book/본문/제004장_패치.md") } }
  );

  // *** Move to: 는 apply_patch 의 이동/이름 변경 형태(Update/Delete File 섹션의 하위 명령)이며, 파일 저장 경로는
  // 목적지입니다. Add/Update File 만 인식할 경우 「Update draft.md + Move to book/본문/제N장.md」는
  // draft.md 만 추출하게 됩니다: 상세 개요 가드를 통째로 건너뛰고, 작성 후 폴백 검사 시 이미 존재하지 않는 소스를 스캔하게 되어, 상세 개요가 없는 초안을 그대로 새 장으로 옮기는 꼴이 됩니다.
  const movePatch = (source, destination, verb = "Update") =>
    `*** Begin Patch\n*** ${verb} File: ${source}\n*** Move to: ${destination}\n+본문 첫 번째 문장.\n*** End Patch\n`;
  fs.writeFileSync("draft.md", "초안 한 문장.\n", "utf8");
  await expectBlocked(
    () =>
      hooks["tool.execute.before"](
        { tool: "apply_patch" },
        { args: { patchText: movePatch("draft.md", "book/본문/제009장_이사.md") } }
      ),
    "apply_patch *** Move to: must not bypass the outline guard"
  );
  // 판정 기준은 소스인 draft.md가 아니라 목적지 장(제9장)에 적용되어야 함(소스는 본문이 아니므로 애초에 판정 대상이 아님)
  await assert.rejects(
    () =>
      hooks["tool.execute.before"](
        { tool: "apply_patch" },
        { args: { patchText: movePatch("draft.md", "book/본문/제009장_이사.md") } }
      ),
    /제9장 세부 개요 누락/,
    "Move의 차단 판정 기준은 반드시 목적지 장 번호에 적용되어야 함"
  );
  // Delete File + Move to(이동 후 소스 삭제)도 이사임: 목적지 역시 목록에 포함되어야 함
  await expectBlocked(
    () =>
      hooks["tool.execute.before"](
        { tool: "apply_patch" },
        { args: { patchText: movePatch("draft.md", "book/본문/제010장_이사.md", "Delete") } }
      ),
    "*** Delete File: + *** Move to: must gate the destination too"
  );
  // 세부 개요를 보충하면 통과: 세부 개요 보충 시 통과 가능한 제어이며, 모든 Move를 일괄 차단하는 것이 아님
  fs.writeFileSync("book/개요/세부_개요_제9장.md", "# 세부 개요\n", "utf8");
  writeCleanState("book", 8);
  await hooks["tool.execute.before"](
    { tool: "apply_patch" },
    { args: { patchText: movePatch("draft.md", "book/본문/제009장_이사.md") } }
  );
  // 역방향: 본문을 본문/ 밖으로 이동(목적지가 본문이 아님)하는 것은 차단되지 않아야 함 - 소스가 더 이상 쓰기 대상으로 간주되지 않음
  await hooks["tool.execute.before"](
    { tool: "apply_patch" },
    { args: { patchText: movePatch("book/본문/제002장_이어쓰기.md", "draft_out.md") } }
  );
  // 단순 Delete는 목록에 포함되지 않음(공유 코어에 명시된 정책): 존재하지 않고 세부 개요도 없는 장 번호를 삭제하는 것이 본문 쓰기로 오보되지 않아야 함
  await hooks["tool.execute.before"](
    { tool: "apply_patch" },
    {
      args: {
        patchText: "*** Begin Patch\n*** Delete File: book/본문/제011장_원고삭제.md\n*** End Patch\n",
      },
    }
  );

  fs.mkdirSync("short", { recursive: true });
  fs.writeFileSync("short/설정.md", "# 설정\n", "utf8");
  await expectBlocked(
    () =>
      hooks["tool.execute.before"](
        { tool: "write" },
        { args: { filePath: "short/본문.md" } }
      ),
    "new short prose without section outline"
  );
  fs.writeFileSync("short/소단원_개요.md", "# 소단원 개요\n", "utf8");
  await hooks["tool.execute.before"](
    { tool: "write" },
    { args: { filePath: "short/본문.md" } }
  );

  fs.writeFileSync(
    "book/본문/제001장_시작.md",
    `${"가로등이 하나둘 켜졌다.".repeat(30)}\nTODO 여기에 내용 추가 필요`,
    "utf8"
  );
  const afterOutput = { output: "write complete" };
  await hooks["tool.execute.after"](
    { tool: "write", args: { filePath: "book/본문/제001장_시작.md" } },
    afterOutput
  );
  assert.match(afterOutput.output, /본문 폴백 검사/);
  assert.match(afterOutput.output, /자리 표시자/);

  const nonProseOutput = { output: "unchanged" };
  fs.writeFileSync("notes.md", "TODO\n", "utf8");
  await hooks["tool.execute.after"](
    { tool: "write", args: { filePath: "notes.md" } },
    nonProseOutput
  );
  assert.equal(nonProseOutput.output, "unchanged");

  fs.writeFileSync(
    "book/본문/제004장_패치.md",
    `${"가로등이 하나둘 켜졌다.".repeat(30)}\nTODO 여기에 내용 추가 필요`,
    "utf8"
  );
  const patchAfterOutput = { output: "patch applied" };
  await hooks["tool.execute.after"](
    { tool: "apply_patch", args: { patchText: addPatch("book/본문/제004장_패치.md") } },
    patchAfterOutput
  );
  assert.match(patchAfterOutput.output, /본문 폴백 검사/);
  assert.match(patchAfterOutput.output, /자리 표시자/);

  const nonProsePatchOutput = { output: "unchanged" };
  await hooks["tool.execute.after"](
    { tool: "apply_patch", args: { patchText: addPatch("notes.md") } },
    nonProsePatchOutput
  );
  assert.equal(nonProsePatchOutput.output, "unchanged");

  // 이동 방식 패치의 작성 후 폴백: 스캔 대상은 **목적지** 챕터입니다. Add/Update File 시에만 draft.md를 추출하며,
  // 전체 과정을 건너뜁니다. 본문/으로 이동한 챕터에 TODO가 있어도 응답하지 않습니다.
  fs.writeFileSync(
    "book/본문/제009장_이동.md",
    `${"가로등이 하나둘 켜졌다.".repeat(30)}\nTODO 여기에 내용 추가 필요`,
    "utf8"
  );
  const moveAfterOutput = { output: "patch applied" };
  await hooks["tool.execute.after"](
    {
      tool: "apply_patch",
      args: { patchText: movePatch("draft.md", "book/본문/제009장_이동.md") },
    },
    moveAfterOutput
  );
  assert.match(moveAfterOutput.output, /본문 폴백 검사(book\/본문\/제009장_이동\.md)/);
  assert.match(moveAfterOutput.output, /자리 표시자/);

  // 반대 방향: 본문/에서 나가는 패치는 소스를 스캔해서는 안 됩니다(소스가 이미 존재하지 않으며, 목적지가 본문이 아님). 결과를 그대로 반환합니다.
  const moveOutAfterOutput = { output: "unchanged" };
  await hooks["tool.execute.after"](
    {
      tool: "apply_patch",
      args: { patchText: movePatch("book/본문/제009장_이동.md", "draft_out.md") },
    },
    moveOutAfterOutput
  );
  assert.equal(moveOutAfterOutput.output, "unchanged");

  // 비쓰기 계열 도구는 반드시 dispatch 전에 반환되어야 하며, read/grep/... 등을 위해 git rev-parse를 포크하지 않습니다.
  // (플러그인이 OpenCode 서비스 프로세스에 상주하므로, 이 동기식 execSync는 이벤트 루프를 차단합니다).
  // 장부 기록 전용 git shim으로 PATH를 대체합니다. 읽기 도구 실행 후에는 장부가 비어 있어야 하며, 쓰기 도구 실행 후에는 기록이 있어야 합니다—
  // 후자는 이 어설션이 항상 참(tautology)이 되는 것을 방지합니다.
  if (process.platform !== "win32") {
    const shimDir = path.join(tmp, "bin");
    const gitLog = path.join(tmp, "git-calls.log");
    fs.mkdirSync(shimDir, { recursive: true });
    fs.writeFileSync(
      path.join(shimDir, "git"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(gitLog)}\nprintf '%s\\n' ${JSON.stringify(tmp)}\n`,
      { mode: 0o755 }
    );
    const realPath = process.env.PATH;
    process.env.PATH = shimDir;
    try {
      for (const tool of ["read", "grep", "glob", "list", "todowrite", "webfetch"]) {
        await hooks["tool.execute.before"]({ tool, args: {} }, { args: {} });
      }
      assert.equal(
        fs.existsSync(gitLog),
        false,
        "non-write tools must not fork git rev-parse"
      );
      await hooks["tool.execute.before"](
        { tool: "write" },
        { args: { filePath: "book/본문/제002장_이어쓰기.md" } }
      );
      assert.match(
        fs.readFileSync(gitLog, "utf8"),
        /rev-parse/,
        "git shim must actually intercept projectRoot()"
      );
    } finally {
      process.env.PATH = realPath;
    }
  }

  const compact = { context: [] };
  await hooks["experimental.session.compacting"]({}, compact);
  assert(compact.context.some((entry) => entry.includes("Writing context: book/추적/컨텍스트.md")));

  console.log("OK: OpenCode plugin guards outlines and reports after-write findings behaviorally");
} finally {
  process.chdir(originalCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
}
