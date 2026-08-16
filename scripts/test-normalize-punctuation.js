#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const normalizer = path.join(
  repoRoot,
  "skills/story-deslop/scripts/normalize-punctuation.js"
);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "normalize-punctuation-"));

function run(args) {
  return spawnSync(process.execPath, [normalizer, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

try {
  const prose = path.join(tmpDir, "prose.md");
  const original = [
    "---",
    "title: fixture",
    "---",
    "# 제목",
    "그는 말했습니다... 정답은 바로 이겁니다—정말로요.", 
    "10--20",
    "---",
    "```text",
    "펜스 내의 …… 및 ---는 반드시 유지되어야 합니다",
    "```",
    "「따옴표… 스타일 유지」",
    "",
  ].join("\r\n");
  fs.writeFileSync(prose, original, "utf8");

  const check = run(["--check", prose]);
  assert.strictEqual(check.status, 1, check.stderr);
  assert.match(check.stdout, /ellipsis/);
  assert.match(check.stdout, /em-dash/);
  assert.match(check.stdout, /double-hyphen/);
  assert.match(check.stdout, /markdown-divider/);
  assert.strictEqual(fs.readFileSync(prose, "utf8"), original, "--check must not write");

  const write = run([prose]);
  assert.strictEqual(write.status, 0, write.stderr);
  const normalized = fs.readFileSync(prose, "utf8");
  assert(normalized.includes("title: fixture\r\n---"), "frontmatter must remain intact");
  assert(normalized.includes("코드 펜스 내… 및 ---는 반드시 유지되어야 함"), "fenced text must remain intact");
  assert(normalized.includes("10에서 20"), "숫자 범위에는 '에서'를 사용해야 합니다");
  assert(normalized.includes("「따옴표, 스타일 유지」"), "기본 모드는 따옴표 스타일을 유지해야 합니다");
  assert(!normalized.split("\r\n").includes("---", 3), "body divider must be removed");
  assert(normalized.includes("\r\n"), "CRLF input must keep CRLF output");
  const normalizedProse = normalized
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(/```[\s\S]*?```/g, "");
  assert(!/(?:……|——|--)/m.test(normalizedProse));

  const second = run([prose]);
  assert.strictEqual(second.status, 0, second.stderr);
  assert.match(second.stdout, /Changed files: 0/);
  assert.strictEqual(fs.readFileSync(prose, "utf8"), normalized, "normalization must be idempotent");

  // 혼합된 줄 바꿈: 고립된 단일 CRLF 한 곳 때문에 전체 줄 바꿈이 CRLF로 바뀌어서는 안 됨. 문장 부호 문제가 없다면 단 한 바이트도 수정해서는 안 됨,
  // 그렇지 않으면 --check는 문제가 없다고 보고하지만, 쓰기 모드에서는 전체 diff가 발생하는 등 두 모드가 일치하지 않게 됩니다.
  const mixedEol = path.join(tmpDir, "mixed-eol.md");
  const mixedOriginal = "그는 제자리에 서 있었다.\r\n바람이 몹시 불었다.\n비가 그쳤다.\n";
  fs.writeFileSync(mixedEol, mixedOriginal, "utf8");
  const mixedCheck = run(["--check", mixedEol]);
  assert.strictEqual(mixedCheck.status, 0, mixedCheck.stdout + mixedCheck.stderr);
  const mixedWrite = run([mixedEol]);
  assert.strictEqual(mixedWrite.status, 0, mixedWrite.stderr);
  assert.match(mixedWrite.stdout, /Changed files: 0/);
  assert.strictEqual(
    fs.readFileSync(mixedEol, "utf8"),
    mixedOriginal,
    "mixed line endings must survive a clean pass byte-for-byte"
  );

  // 혼합 줄바꿈 + 실제 문장 부호 문제: 문장 부호만 수정하고, 각 줄의 끝은 그대로 유지합니다.
  const mixedDirty = path.join(tmpDir, "mixed-eol-dirty.md");
  fs.writeFileSync(mixedDirty, "그는 말했다... 정말로.\r\n바람이 거세다—비가 그쳤다.\n", "utf8");
  assert.strictEqual(run([mixedDirty]).status, 0);
  assert.strictEqual(
    fs.readFileSync(mixedDirty, "utf8"),
    "그가 말했습니다, 정말이에요.\r\n바람이 거세고, 비가 그쳤습니다.\n",
    "per-line endings must be preserved while punctuation is normalized"
  );

  // HTML 주석 내의 `--`는 문장 부호가 아닙니다. `<!-- 정리:건너뛰기 -->` 예외 마커는 본문에 그대로 유지되어야 하며,
  // `<! 정리:건너뛰기 , >`로 변경되면 더 이상 주석이 아니게 되어, 노출 텍스트로 원고에 유출됩니다.
  const marker = path.join(tmpDir, "marker.md");
  const markerOriginal = [
    "# 제12장 비 오는 밤",
    "<!-- 냄새 제거: 건너뛰기 -->",
    "그는 주먹을 불끈 쥐고 천천히 일어섰다.",
    "<!--",
    "여러 줄 주석 내의 ---와 ……도 그대로 유지",
    "-->",
    "본문... 계속.<!-- 인라인 주석 -->",
    "",
  ].join("\n");
  fs.writeFileSync(marker, markerOriginal, "utf8");
  const markerCheck = run(["--check", marker]);
  assert.strictEqual(markerCheck.status, 1, markerCheck.stderr);
  assert.doesNotMatch(markerCheck.stdout, /double-hyphen/, "HTML 주석은 double-hyphen 오류를 보고해서는 안 됩니다");
  assert.doesNotMatch(markerCheck.stdout, /markdown-divider/, "주석 내부의 ---는 본문 구분선이 아닙니다");
  assert.strictEqual(run([marker]).status, 0);
  const markerNormalized = fs.readFileSync(marker, "utf8");
  assert(markerNormalized.includes("<!-- 정리:건너뛰기 -->"), "정규화 제외 마커는 그대로 유지되어야 합니다");
  assert(markerNormalized.includes("여러 줄 주석 안의 ---와 ...도 그대로"), "여러 줄 주석의 내용은 그대로 유지되어야 합니다");
  assert(markerNormalized.includes("<!-- 인라인 메모 -->"), "인라인 주석은 그대로 유지되어야 합니다");
  assert(markerNormalized.includes("본문, 계속."), "주석 밖의 본문은 여전히 정규화되어야 합니다");

  // 닫히지 않은 주석이 "여기부터 EOF까지 모두 유효하게 제외"되는 것은 아닙니다. 반드시 명시적으로 오류를 보고해야 하며, 이후 본문은 여전히 검사/정규화 대상에 포함됩니다.
  // 그렇지 않으면 잘못 작성된 `<!--` 하나로 인해 전체 문서의 `……` / `---`가 --check 시 자동으로 exit 0이 될 수 있습니다.
  const unclosedComment = path.join(tmpDir, "unclosed-comment.md");
  fs.writeFileSync(
    unclosedComment,
    "# 제13장\n<!-- 임시 메모\n본문…… 계속。\n---\n",
    "utf8"
  );
  const unclosedCheck = run(["--check", unclosedComment]);
  assert.strictEqual(unclosedCheck.status, 1, unclosedCheck.stdout + unclosedCheck.stderr);
  assert.match(unclosedCheck.stdout, /html-comment-unclosed/);
  assert.match(unclosedCheck.stdout, /ellipsis|markdown-divider/);
  assert.strictEqual(run([unclosedComment]).status, 0);
  const unclosedNormalized = fs.readFileSync(unclosedComment, "utf8");
  assert(unclosedNormalized.includes("<!-- 임시 메모"), "닫히지 않은 주석의 시작 태그가 손상되어서는 안 됩니다");
  assert(unclosedNormalized.includes("본문, 계속."), "닫히지 않은 주석 이후의 본문은 여전히 정규화되어야 합니다");
  assert(!unclosedNormalized.includes("\n---\n"), "닫히지 않은 주석 이후의 본문 구분선은 여전히 제거되어야 합니다");

  // 불필요한 문장 부호를 삭제하면 양쪽의 반각 마침표/하이픈이 붙어 새로운 `...`/`--`가 생길 수 있습니다. 한 번에 완전히 정리해야 합니다.
  // 그렇지 않으면 삭제했어야 할 ASCII 말줄임표가 원고에 남게 되고, 나중에 같은 단계를 다시 실행할 때 이미 확정된 본문이 수정될 수 있습니다.
  const merge = path.join(tmpDir, "merge.md");
  fs.writeFileSync(merge, "그.……..말했다\n-…...……-2.（！）\n", "utf8");
  assert.strictEqual(run([merge]).status, 0);
  assert.strictEqual(fs.readFileSync(merge, "utf8"), "그, 말했다\n2.（！）\n");
  const mergeRecheck = run(["--check", merge]);
  assert.strictEqual(mergeRecheck.status, 0, "1차 정규화 후 --check 결과가 반드시 0이어야 합니다: " + mergeRecheck.stdout);
  assert.match(run([merge]).stdout, /Changed files: 0/);

  const fences = path.join(tmpDir, "fences.md");
  const fencedOriginal = [
    "~~~markdown",
    "tilde 펜스 내부의 ……는 반드시 유지되어야 합니다",
    "```",
    "서로 다른 마커는 닫을 수 없음——여전히 유지되어야 함",
    "~~",
    "더 짧은 물결표는 닫을 수 없음--여전히 유지되어야 함",
    "~~~",
    "물결표 펜스 밖…… 반드시 정규화해야 함",
    "````markdown",
    "```javascript",
    "백틱 4개 펜스 안…… 반드시 유지해야 함",
    "```",
    "더 짧은 백틱으로는 닫을 수 없음—여전히 유지해야 함",
    "````",
    "백틱 펜스 밖…… 반드시 정규화해야 함",
    "",
  ].join("\n");
  fs.writeFileSync(fences, fencedOriginal, "utf8");

  const fencedWrite = run([fences]);
  assert.strictEqual(fencedWrite.status, 0, fencedWrite.stderr);
  const fencedNormalized = fs.readFileSync(fences, "utf8");
  assert(fencedNormalized.includes("tilde 펜스 안…… 반드시 유지해야 함"));
  assert(fencedNormalized.includes("서로 다른 마커로는 닫을 수 없음—여전히 유지해야 함"));
  assert(fencedNormalized.includes("더 짧은 물결표로는 닫을 수 없음--여전히 유지해야 함"));
  assert(fencedNormalized.includes("백틱 4개 펜스 안…… 반드시 유지해야 함"));
  assert(fencedNormalized.includes("더 짧은 백틱으로는 닫을 수 없음—여전히 유지해야 함"));
  assert(fencedNormalized.includes("물결표 펜스 밖, 반드시 정규화해야 함"));
  assert(fencedNormalized.includes("백틱 펜스 밖, 반드시 정규화해야 함"));

  const ascii = path.join(tmpDir, "ascii.md");
  fs.writeFileSync(ascii, "「갑」과 “을”\n", "utf8");
  assert.strictEqual(run(["--quote-mode=ascii", ascii]).status, 0);
  assert.strictEqual(fs.readFileSync(ascii, "utf8"), '"갑"과 "을"\n');

  const yan = path.join(tmpDir, "yan.md");
  fs.writeFileSync(yan, '"갑"과 “을”\n', "utf8");
  assert.strictEqual(run(["--quote-mode", "yan", yan]).status, 0);
  assert.strictEqual(fs.readFileSync(yan, "utf8"), "「갑」과 「을」\n");

  const missing = run([path.join(tmpDir, "missing.md")]);
  assert.strictEqual(missing.status, 2);
  assert.match(missing.stderr, /unable to read/);

  console.log("OK: punctuation normalizer check/write, robust fences, CRLF, quote modes, and errors");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
