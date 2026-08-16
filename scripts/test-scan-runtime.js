#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const longUtilsPath = path.join(
  repoRoot,
  "skills/story-long-scan/scripts/cdp-utils.js"
);
const shortUtilsPath = path.join(
  repoRoot,
  "skills/story-short-scan/scripts/cdp-utils.js"
);

function makeFakeAgentBrowser(tmpDir) {
  const fakeProgram = `#!/usr/bin/env node
const fs = require("fs");
if (process.env.AGENT_BROWSER_CAPTURE) {
  fs.writeFileSync(process.env.AGENT_BROWSER_CAPTURE, JSON.stringify(process.argv.slice(2)));
}
process.stdout.write(process.env.AGENT_BROWSER_STDOUT || "");
if (process.env.AGENT_BROWSER_STDERR) {
  process.stderr.write(process.env.AGENT_BROWSER_STDERR);
}
if (process.env.AGENT_BROWSER_EXIT) {
  process.exit(Number(process.env.AGENT_BROWSER_EXIT));
}
`;
  if (process.platform === "win32") {
    const program = path.join(tmpDir, "fake-agent-browser.js");
    fs.writeFileSync(program, fakeProgram, "utf8");
    // `npm install -g agent-browser` writes an agent-browser.cmd whose `%*` line
    // forwards to the real target (the native .exe, or here the Node wrapper).
    // cdp-utils reads that shim and execs the target directly, so the argv array
    // is passed verbatim instead of collapsing through cmd.exe `%*` or a
    // PowerShell splat.
    fs.writeFileSync(
      path.join(tmpDir, "agent-browser.cmd"),
      `@echo off\r\n"${process.execPath}" "%~dp0fake-agent-browser.js" %*\r\n`,
      "utf8"
    );
    return path.join(tmpDir, "agent-browser.cmd");
  }

  const bin = path.join(tmpDir, "agent-browser");
  fs.writeFileSync(bin, fakeProgram, "utf8");
  fs.chmodSync(bin, 0o755);
  return bin;
}

function withFakeAgentBrowser(testFn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-scan-runtime-"));
  const oldPath = process.env.PATH;
  const oldCapture = process.env.AGENT_BROWSER_CAPTURE;
  const oldStdout = process.env.AGENT_BROWSER_STDOUT;
  const oldStderr = process.env.AGENT_BROWSER_STDERR;
  const oldExit = process.env.AGENT_BROWSER_EXIT;
  try {
    delete process.env.AGENT_BROWSER_STDERR;
    delete process.env.AGENT_BROWSER_EXIT;
    makeFakeAgentBrowser(tmpDir);
    process.env.PATH = `${tmpDir}${path.delimiter}${oldPath}`;
    testFn(tmpDir);
  } finally {
    process.env.PATH = oldPath;
    if (oldCapture === undefined) delete process.env.AGENT_BROWSER_CAPTURE;
    else process.env.AGENT_BROWSER_CAPTURE = oldCapture;
    if (oldStdout === undefined) delete process.env.AGENT_BROWSER_STDOUT;
    else process.env.AGENT_BROWSER_STDOUT = oldStdout;
    if (oldStderr === undefined) delete process.env.AGENT_BROWSER_STDERR;
    else process.env.AGENT_BROWSER_STDERR = oldStderr;
    if (oldExit === undefined) delete process.env.AGENT_BROWSER_EXIT;
    else process.env.AGENT_BROWSER_EXIT = oldExit;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function loadFresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

// ---------------------------------------------------------------------------
// 수집 스크립트 end-to-end fixture: eval 페이로드에 따라 응답을 분배하는 agent-browser stub,
// sleep/scrollLoad를 제거하는 프리로드를 추가하여 전체 main() 흐름이 밀리초 단위로 완료될 수 있도록 함.
// ---------------------------------------------------------------------------

const SCRIPTED_AGENT_BROWSER = `#!/usr/bin/env node
"use strict";
const argv = process.argv.slice(2);
const evalIdx = argv.indexOf("eval");
const idx = evalIdx >= 0 ? evalIdx : argv.indexOf("open");
function out(value) {
  process.stdout.write(JSON.stringify(JSON.stringify(value)));
  process.exit(0);
}
if (argv[idx] === "open") {
  const url = argv[idx + 1] || "";
  if (process.env.SCAN_FAKE_FAIL_OPEN && url.indexOf(process.env.SCAN_FAKE_FAIL_OPEN) > -1) {
    process.stderr.write("navigate timeout\\n");
    process.exit(3);
  }
  process.exit(0);
}
const js =
  argv[idx + 1] === "-b"
    ? Buffer.from(argv[idx + 2] || "", "base64").toString("utf8")
    : argv[idx + 1] || "";
if (js.indexOf("host:location.host") > -1) {
  out({ host: process.env.SCAN_FAKE_HOST || "www.jjwxc.net", len: 5000 });
}
if (js.indexOf("onebook.php") > -1) {
  // 진강 상세 배치: ab()의 20s 타임아웃/non-JSON 반환을 시뮬레이션
  if (process.env.SCAN_FAKE_FAIL_DETAIL) {
    process.stderr.write("spawnSync agent-browser ETIMEDOUT\\n");
    process.exit(1);
  }
  if (process.env.SCAN_FAKE_PARTIAL_DETAIL) {
    out({
      1: { id: "1", collect: "12345", words: "300000", status: "연재 중" },
      2: { id: "2", err: "detail timeout" },
    });
  }
  out({ 1: { id: "1", collect: "12345", words: "300000", status: "연재 중" } });
}
if (js.indexOf("result={channels:[]}") > -1) {
  const books = [{ title: "갑 서적", author: "작가 갑", novelid: "1" }];
  if (process.env.SCAN_FAKE_TWO_BOOKS) {
    books.push({ title: "을 서적", author: "작가 을", novelid: "2" });
  }
  out({ channels: [{ name: "고대 로맨스", books }] });
}
if (js.indexOf("blocked") > -1) out({ blocked: false, reason: "" });
if (js.indexOf("book-img-text") > -1) {
  out([
    {
      rank: 1,
      title: "기점 갑 서적",
      url: "https://www.qidian.com/book/1/",
      author: "기 작가",
      genre: "판타지",
      status: "연재 중",
      descText: "소개",
      updateText: "",
    },
  ]);
}
out({});
`;

const SLEEP_STUB = `// 사전 로드: 빈 sleep/scrollLoad 제거, 수집 스크립트의 실제 대기가 테스트에서 필요 없음
const utils = require(process.env.SCAN_TEST_UTILS);
utils.sleep = () => {};
if (process.env.SCAN_TEST_STUB_SCROLL) utils.scrollLoad = () => {};
`;

/** tmpDir에 agent-browser 대체물(Windows의 .cmd shim 포함) + sleep 사전 로드 배치 */
function makeScraperHarness(tmpDir) {
  const program = path.join(tmpDir, "fake-agent-browser.js");
  fs.writeFileSync(program, SCRIPTED_AGENT_BROWSER, "utf8");
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(tmpDir, "agent-browser.cmd"),
      `@echo off\r\n"${process.execPath}" "%~dp0fake-agent-browser.js" %*\r\n`,
      "utf8"
    );
  } else {
    const bin = path.join(tmpDir, "agent-browser");
    fs.writeFileSync(bin, SCRIPTED_AGENT_BROWSER, "utf8");
    fs.chmodSync(bin, 0o755);
  }
  const preload = path.join(tmpDir, "stub-sleep.js");
  fs.writeFileSync(preload, SLEEP_STUB, "utf8");
  return preload;
}

/** 수집 스크립트의 CLI 메인 플로우를 실행하여 { status, stdout, stderr, files }를 반환 */
function runScraper(scraperPath, args, env) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-scan-e2e-"));
  try {
    const preload = makeScraperHarness(tmpDir);
    const outdir = path.join(tmpDir, "out");
    const result = spawnSync(
      process.execPath,
      ["--require", preload, scraperPath, ...args, "--outdir", outdir],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 60000,
        env: {
          ...process.env,
          PATH: `${tmpDir}${path.delimiter}${process.env.PATH}`,
          SCAN_TEST_UTILS: path.join(path.dirname(scraperPath), "cdp-utils.js"),
          ...env,
        },
      }
    );
    const files = fs.existsSync(outdir) ? fs.readdirSync(outdir).sort() : [];
    const contents = files.map((name) =>
      fs.readFileSync(path.join(outdir, name), "utf8")
    );
    return { ...result, files, contents };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function testCdpUtils(modulePath) {
  withFakeAgentBrowser((tmpDir) => {
    const capture = path.join(tmpDir, "argv.json");
    const injected = path.join(tmpDir, "must-not-exist");
    process.env.AGENT_BROWSER_CAPTURE = capture;
    process.env.AGENT_BROWSER_STDOUT = "ok\n";

    const utils = loadFresh(modulePath);
    assert.strictEqual(typeof utils.evalJSONBase64, "function");

    // argv 규약: ① 보안 주입 방지——매개변수는 절대 shell 평가에 들어가지 않음; ② 실제 매개변수에 나타나는 특수문자를 그대로 전달
    // ——공백, & | ^ ; $()、중문, 그리고 URL의 & 와 =. 큰따옴표나 백슬래시는 규약에 포함되지 않음: 따옴표가 있는
    // eval 페이로드는 모두 base64로 전송 (evalJSONBase64 / evalJSON), 명령줄 매개변수는 base64 문자열,
    // URL 및 이와 같은 따옴표 없는 토큰만 해당, Windows의 .cmd/PowerShell은 큰따옴표를 그대로 전달할 수 없음.
    const shellLikeArg = `$(touch ${injected})`;
    const urlLikeArg = "https://x.example/rank?a=1&b=2&c=d#top";
    const unicodeSpecialArg = `중문 매개변수 / 공 백 & | ^ ! $() ; [] {} = '`;
    assert.strictEqual(
      utils.ab(
        9222,
        "eval",
        shellLikeArg,
        urlLikeArg,
        "space arg",
        unicodeSpecialArg
      ),
      "ok"
    );
    assert.strictEqual(fs.existsSync(injected), false, "ab() must not invoke a shell");
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(capture, "utf8")), [
      "--cdp",
      "9222",
      "eval",
      shellLikeArg,
      urlLikeArg,
      "space arg",
      unicodeSpecialArg,
    ]);

    process.env.AGENT_BROWSER_STDOUT = JSON.stringify(
      JSON.stringify({ ok: true, nested: "중문" })
    );
    assert.deepStrictEqual(utils.evalJSON(9222, "({ok:true})"), {
      ok: true,
      nested: "중문",
    });

    process.env.AGENT_BROWSER_CAPTURE = capture;
    assert.deepStrictEqual(utils.evalJSONBase64(9222, "window.__x = '$()'"), {
      ok: true,
      nested: "중문",
    });
    const base64Args = JSON.parse(fs.readFileSync(capture, "utf8"));
    assert.deepStrictEqual(base64Args.slice(0, 4), ["--cdp", "9222", "eval", "-b"]);
    assert.strictEqual(
      Buffer.from(base64Args[4], "base64").toString("utf8"),
      "window.__x = '$()'"
    );

    assert.strictEqual(utils.getArg(["--type=hot", "--top", "15"], "--type"), "hot");
    assert.strictEqual(utils.getArg(["--type=hot", "--top", "15"], "--top"), "15");
    assert.strictEqual(utils.getArg(["--top"], "--top"), null);

    process.env.AGENT_BROWSER_STDOUT = "";
    process.env.AGENT_BROWSER_STDERR = "CDP connection refused\n";
    process.env.AGENT_BROWSER_EXIT = "7";
    assert.throws(
      () => utils.ab(9222, "open", "https://example.com"),
      /agent-browser failed.*CDP connection refused/
    );

    delete process.env.AGENT_BROWSER_EXIT;
    delete process.env.AGENT_BROWSER_STDERR;
    process.env.AGENT_BROWSER_STDOUT = "not-json";
    assert.throws(
      () => utils.evalJSON(9222, "JSON.stringify({ok:true})"),
      /invalid JSON/
    );
  });
}

function testWindowsInvocationBuilder(modulePath) {
  const utils = loadFresh(modulePath);
  assert.strictEqual(typeof utils.buildAgentBrowserInvocation, "function");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-scan-win-"));
  const oldPath = process.env.PATH;
  try {
    // npm's Windows shim: the `%*` line points to the real target (here the
    // native binary). buildAgentBrowserInvocation must resolve the shim to that
    // target and hand every argument to it as a distinct array element — never a
    // shell, never a space-joined string.
    fs.writeFileSync(
      path.join(tmpDir, "agent-browser.cmd"),
      `@ECHO off\r\n"%~dp0node_modules\\agent-browser\\bin\\agent-browser-win32-x64.exe" %*\r\n`,
      "utf8"
    );
    process.env.PATH = `${tmpDir}${path.delimiter}${oldPath}`;
    const shellLikeArg = '& calc.exe | echo "unsafe"';
    const unicodeSpecialArg = `중문 매개변수 / 공 백 & | ^ ! $() ; [] {} = ' " \\`;
    const invocation = utils.buildAgentBrowserInvocation(
      9222,
      ["eval", shellLikeArg, "space arg", unicodeSpecialArg],
      "win32"
    );
    // Resolves to the native binary (Node refuses the .cmd; PowerShell collapses
    // the array) with every argument a distinct element — nothing shell-evaluated
    // or space-joined.
    assert.match(invocation.file, /agent-browser-win32-x64\.exe$/);
    assert.deepStrictEqual(invocation.args, [
      "--cdp",
      "9222",
      "eval",
      shellLikeArg,
      "space arg",
      unicodeSpecialArg,
    ]);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function listScraperPaths() {
  return [
    ...fs
      .readdirSync(path.join(repoRoot, "skills/story-long-scan/scripts"))
      .filter((name) => name.endsWith("-scraper.js"))
      .map((name) => path.join(repoRoot, "skills/story-long-scan/scripts", name)),
    ...fs
      .readdirSync(path.join(repoRoot, "skills/story-short-scan/scripts"))
      .filter((name) => name.endsWith("-scraper.js"))
      .map((name) => path.join(repoRoot, "skills/story-short-scan/scripts", name)),
  ].sort();
}

function testScraperImports() {
  const scraperPaths = listScraperPaths();

  assert(scraperPaths.length >= 7, "expected all rank scraper modules");
  for (const scraperPath of scraperPaths) {
    const probe = spawnSync(
      process.execPath,
      [
        "-e",
        "const m=require(process.argv[1]); process.stdout.write(JSON.stringify(Object.keys(m).sort()));",
        scraperPath,
      ],
      { cwd: repoRoot, encoding: "utf8", timeout: 2000 }
    );
    assert.strictEqual(
      probe.error && probe.error.code,
      undefined,
      `${path.basename(scraperPath)} import timed out or failed to start`
    );
    assert.strictEqual(
      probe.status,
      0,
      `${path.basename(scraperPath)} import failed: ${probe.stderr || probe.stdout}`
    );
    assert.strictEqual(
      probe.stderr,
      "",
      `${path.basename(scraperPath)} emitted stderr while imported`
    );
    const exported = JSON.parse(probe.stdout || "[]");
    assert(
      exported.length > 0,
      `${path.basename(scraperPath)} must export testable helpers`
    );
  }
}

function testCliResultGate(modulePath) {
  const probe = (body) =>
    spawnSync(
      process.execPath,
      ["-e", `const {runCli}=require(process.argv[1]);${body}`, modulePath],
      { cwd: repoRoot, encoding: "utf8", timeout: 2000 }
    );

  const success = probe("runCli(() => 2, 'probe');");
  assert.strictEqual(success.status, 0, success.stderr);

  const partial = probe(
    "runCli(() => ({planned: 3, written: 2, failed: 1, partialReasons: ['one rank failed']}), 'probe');"
  );
  assert.strictEqual(partial.status, 2, "partial-output CLI runs need a distinct status");
  assert.match(partial.stderr, /probe partial: wrote 2\/3; failed 1; one rank failed/);

  const empty = probe("runCli(() => 0, 'probe');");
  assert.strictEqual(empty.status, 1, "zero-output CLI runs must fail");
  assert.match(empty.stderr, /probe failed: no output was written/);

  const rejected = probe("runCli(async () => { throw new Error('boom'); }, 'probe');");
  assert.strictEqual(rejected.status, 1, "rejected CLI runs must fail");
  assert.match(rejected.stderr, /probe failed: boom/);
}

// 출력 파일명의 날짜 스탬프는 반드시 로컬 달력 날짜여야 합니다. UTC(toISOString)를 사용하면, UTC+8 작성자가 로컬 00:00-08:00 사이에 수집할 때 전날 파일명으로 돌아갑니다——파일명은 유일한 중복 제거 키이며, 전날 저녁 보고서가 조용히 덮어씌워집니다.
// new Date(y,m,d,...) 는 로컬 시간으로 구성되므로, 이 두 단언문은 호스트 시간대와 관계없습니다.
function testLocalDateStamp(modulePath) {
  const utils = loadFresh(modulePath);
  assert.strictEqual(typeof utils.localDateStamp, "function");

  // 회귀 지점 본체: 베이징 시간 2026-07-27 07:30의 그 순간, UTC 날짜는 여전히 07-26입니다.
  assert.strictEqual(utils.localDateStamp(new Date(2026, 6, 27, 0, 30)), "20260727");
  assert.strictEqual(utils.localDateStamp(new Date(2026, 0, 1, 23, 59)), "20260101");
  assert.match(utils.localDateStamp(), /^\d{8}$/);

  // 런타임이 정말로 TZ=Asia/Shanghai를 인정할 때만 일일 경계 동작을 단언합니다(Windows에서 TZ는 무시될 수 있습니다).
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      "const {localDateStamp}=require(process.argv[1]);" +
        'const d=new Date("2026-07-26T23:30:00Z");' +
        "process.stdout.write(JSON.stringify({local:localDateStamp(d)," +
        'utc:d.toISOString().slice(0,10).replace(/-/g,""),offset:d.getTimezoneOffset()}));',
      modulePath,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, TZ: "Asia/Shanghai" },
    }
  );
  assert.strictEqual(probe.status, 0, probe.stderr);
  const seen = JSON.parse(probe.stdout);

  if (seen.offset === -480) {
    assert.strictEqual(seen.utc, "20260726", "UTC 날짜가 실제로 전날에 해당합니다");
    assert.strictEqual(seen.local, "20260727", "파일명 날짜는 로컬 캘린더 날짜와 일치해야 합니다");
  }
}

// 정적 가드: 모든 수집 스크립트는 더 이상 UTC 날짜로 파일명을 만들 수 없습니다
function testScraperFilenameDatesAreLocal() {
  for (const scraperPath of listScraperPaths()) {
    const src = fs.readFileSync(scraperPath, "utf8");
    const name = path.basename(scraperPath);
    assert(
      !/toISOString\(\)\s*\.slice\(0,\s*10\)/.test(src),
      `${name}: 파일명 날짜는 UTC(toISOString().slice(0,10))를 사용할 수 없으며, localDateStamp()를 사용해야 합니다`
    );
    assert(
      src.includes("localDateStamp()"),
      `${name}: 출력 파일명은 반드시 localDateStamp()로 로컬 캘린더 날짜를 가져와야 합니다`
    );
  }
}

// Jinjing: 상세정보 배치 순간 실패 시 상세정보만 버려야 하고, 이미 파싱된 리스트는 버리면 안 되며, 뒤의 랭킹도 잘라내면 안 됨
function testJjwxcDetailFailureIsolation() {
  const scraper = path.join(
    repoRoot,
    "skills/story-long-scan/scripts/jjwxc-rank-scraper.js"
  );
  const run = runScraper(scraper, ["--type", "all"], {
    SCAN_FAKE_FAIL_DETAIL: "1",
  });
  assert.strictEqual(
    run.status,
    2,
    `상세정보 실패 시 리스트는 유지되어야 하지만 partial로 표시됨: ${run.stderr || run.stdout}`
  );
  assert.strictEqual(
    run.files.length,
    6,
    `--type all의 6개 랭킹이 모두 저장되어야 하는데, 실제 ${run.files.length}: ${run.files.join(", ")}`
  );
  assert.match(run.stderr, /상세정보 배치 1（1개）획득 실패, 스킵/);
  assert.match(run.stderr, /Jinjing 수집 partial:/);
  for (const content of run.contents) {
    assert.match(content, /데이터 품질：\[상세 분석 예외\/로그인 상태 누락\]/);
    assert.match(content, /### #1 갑서/, "이미 파싱된 목록 데이터는 유지되어야 함");
  }

  // 대조: 상세 정보가 정상일 때 품질 게이트 오탐 없음
  const healthy = runScraper(scraper, ["--type", "12"], {});
  assert.strictEqual(healthy.status, 0, healthy.stderr);
  assert.strictEqual(healthy.files.length, 1);
  assert.match(healthy.contents[0], /데이터 품질：\[OK\]/);
  assert.match(healthy.contents[0], /즐겨찾기 1\.2만/);

  const partial = runScraper(scraper, ["--type", "12"], {
    SCAN_FAKE_TWO_BOOKS: "1",
    SCAN_FAKE_PARTIAL_DETAIL: "1",
  });
  assert.strictEqual(partial.status, 2, partial.stderr);
  assert.match(partial.stderr, /진강 수집 partial:/);
  assert.match(partial.contents[0], /상세정보수집：1 \/ 2/);
  assert.match(partial.contents[0], /데이터 품질：\[부분 상세정보 누락\]/);
}

// 시작점：한 개의 랭킹 목록이 열리지 않으면 이것만 건너뛰고, 나머지 9개는 계속 수집 (--type all이 더이상 한 번의 타임아웃으로 중단되지 않음)
function testQidianRankIsolation() {
  const scraper = path.join(
    repoRoot,
    "skills/story-long-scan/scripts/qidian-rank-scraper.js"
  );
  const run = runScraper(scraper, ["--type", "all", "--mode", "cdp"], {
    SCAN_FAKE_FAIL_OPEN: "hotsales",
    SCAN_FAKE_HOST: "www.qidian.com",
    SCAN_TEST_STUB_SCROLL: "1",
  });
  assert.strictEqual(
    run.status,
    2,
    `단일 랭킹 목록 실패 시 나머지 산출물은 보존하되 partial 표시: ${run.stderr || run.stdout}`
  );
  assert.match(run.stderr, /\[qidian\] 베스트셀러 목록 수집 실패, 건너뜀/);
  assert.match(run.stderr, /시작점수집 partial: wrote 9\/10; failed 1/);
  assert.strictEqual(
    run.files.length,
    9,
    `실패한 베스트셀러 목록을 제외한 9개 목록은 모두 저장되어야 하는데, 실제로 ${run.files.length}개: ${run.files.join(", ")}`
  );
  assert(
    !run.files.some((name) => name.startsWith("시작점베스트셀러_")),
    "열 수 없는 목록은 빈 파일을 생성하지 않아야 합니다"
  );

  // 매개변수 오류는 여전히 빠르게 실패해야 하며, per-leaderboard 격리에 의해 무시될 수 없습니다
  const badMode = runScraper(scraper, ["--type", "all", "--mode", "bogus"], {});
  assert.strictEqual(badMode.status, 1, "알 수 없는 --mode는 반드시 실패해야 합니다");
  assert.match(badMode.stderr, /알 수 없는 --mode: bogus/);
  assert.strictEqual(badMode.files.length, 0);
}

// heiyan: 필드 변동은 반드시 디스크 쓰기 전에 차단되어야 하며, 문자 수 형식은 호스트 locale을 따르지 않아야 합니다
function testHeiyanFieldDriftAndWordFormat() {
  const heiyan = loadFresh(
    path.join(repoRoot, "skills/story-short-scan/scripts/heiyan-booklist-scraper.js")
  );
  assert.strictEqual(typeof heiyan.fmtWords, "function");
  assert.strictEqual(heiyan.fmtWords(123456), "123,456자");
  assert.strictEqual(heiyan.fmtWords("123456"), "123,456자");
  assert.strictEqual(heiyan.fmtWords(0), "");
  assert.strictEqual(heiyan.fmtWords(undefined), "");
  assert.strictEqual(typeof heiyan.outputFilename, "function");
  const date = "20260806";
  const channelFiles = ["male", "female", "all"].map((channel) =>
    heiyan.outputFilename(channel, date)
  );
  assert.strictEqual(
    new Set(channelFiles).size,
    channelFiles.length,
    `흑암 산출물 이름은 반드시 채널을 포함해야 하며, 같은 날에 서로 덮어쓸 수 없습니다: ${channelFiles.join(", ")}`
  );
  assert.deepStrictEqual(channelFiles, [
    `흑암서고목록_male_${date}.md`,
    `흑암서고목록_female_${date}.md`,
    `흑암서고목록_all_${date}.md`,
  ]);
  assert.throws(() => heiyan.outputFilename("../../escape", date), /알 수 없는 --channel/);

  // toLocaleString()은 de_* 아래에서 123.456으로 표시됨(123자처럼 읽힘), fmtWords는 반드시 영향을 받지 않아야 함
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      "const {fmtWords}=require(process.argv[1]);process.stdout.write(fmtWords(123456));",
      path.join(repoRoot, "skills/story-short-scan/scripts/heiyan-booklist-scraper.js"),
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, LC_ALL: "de_DE.UTF-8", LANG: "de_DE.UTF-8" },
    }
  );
  assert.strictEqual(probe.status, 0, probe.stderr);
  assert.strictEqual(probe.stdout, "123,456자", "글자 수 형식이 호스트 locale과 달라지면 안 됨");

  // 필드 누락이 "undefined/undefined"로 연결되어 보고서에 쓰여지면 안 됨
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-scan-heiyan-"));
  try {
    const filepath = path.join(tmpDir, "out.md");
    const books = [
      { name: "갑의 책", userName: "작가 갑", classifyStr: "남성향", typeDesc: "도시", words: 123456 },
      { name: "을서", userName: "저자을", classifyStr: "여성향", typeDesc: null, words: 50000 },
    ];
    const origLog = console.log;
    console.log = () => {};
    try {
      heiyan.buildAndSave(books, 2, books, filepath);
    } finally {
      console.log = origLog;
    }
    const written = fs.readFileSync(filepath, "utf8");
    assert(!written.includes("undefined"), `보고서에 undefined가 나타날 수 없음:\n${written}`);
    assert(!written.includes("/null"), `보고서에 null이 나타날 수 없음:\n${written}`);
    assert(written.includes("*저자갑 · 남성향/도시 · 123,456자 · 비공개*"), written);
    assert(written.includes("*저자을 · 여성향 · 50,000자 · 비공개*"), written);

    const malePath = path.join(tmpDir, heiyan.outputFilename("male", date));
    const femalePath = path.join(tmpDir, heiyan.outputFilename("female", date));
    console.log = () => {};
    try {
      heiyan.buildAndSave(books, 2, [books[0]], malePath);
      heiyan.buildAndSave(books, 2, [books[1]], femalePath);
    } finally {
      console.log = origLog;
    }
    assert(fs.existsSync(malePath), "남성향 리포트가 여성향 수집으로 덮어써지면 안 됩니다");
    assert(fs.existsSync(femalePath), "여성향 리포트는 반드시 독립적으로 저장되어야 합니다");
    assert(fs.readFileSync(malePath, "utf8").includes("갑서"));
    assert(fs.readFileSync(femalePath, "utf8").includes("을서"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// setup-cdp-chrome.js의 --reset 게이트 픽스처입니다.
// 전 과정에서 127.0.0.1의 임시 포트만 사용하며, 외부 요청을 보내지 않고 실제 Chrome에 접근하지 않습니다:
//   fake-cdp.js          /json/version CDP 엔드포인트만 응답하는 가짜 CDP, identity는 --id로 결정됨
//   fake-chrome-*.js     가짜 Chrome: 즉시 종료하거나 새로운 identity의 엔드포인트를 시작하고 상주
//   cdp-preload.js       스크립트가 시스템에 의존하는 세 곳을 변경합니다 - Chrome 실행 경로 탐지,
//                        spawn의 대상, 그리고 pgrep/pkill(tasklist/taskkill)의 의미
// 프로세스 생존 여부는 모두 파일 마크를 통해 확인하며, 실제 신호를 사용하지 않습니다. Windows에서도 동일하게 적용됩니다.
// ---------------------------------------------------------------------------

const FAKE_CDP = `"use strict";
const fs = require("fs");
const http = require("http");
function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i > -1 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  for (const a of process.argv) if (a.startsWith(name + "=")) return a.slice(name.length + 1);
  return def;
}
const id = arg("--id", "fake-cdp");
const portfile = arg("--portfile", null);
const stopfile = arg("--stopfile", null);
const status = Number(arg("--status", 200));
// --no-identity: /json/version에 응답하지만 webSocketDebuggerUrl을 제공하지 않아 「신원 정보를 얻을 수 없음」을 모의합니다.
const noIdentity = process.argv.indexOf("--no-identity") > -1;
let port = Number(arg("--port", arg("--remote-debugging-port", 0)));
if (!Number.isInteger(port) || port < 0) port = 0;
const server = http.createServer((req, res) => {
  if (req.url !== "/json/version") { res.writeHead(404); res.end("nope"); return; }
  res.writeHead(status, { "Content-Type": "application/json" });
  const payload = { Browser: id, "Protocol-Version": "1.3" };
  if (!noIdentity) {
    payload.webSocketDebuggerUrl =
      "ws://127.0.0.1:" + server.address().port + "/devtools/browser/" + id;
  }
  res.end(JSON.stringify(payload));
});
server.listen(port, "127.0.0.1", () => {
  if (portfile) fs.writeFileSync(portfile, String(server.address().port), "utf8");
});
// 중지도 파일 마크를 사용합니다: 크로스 플랫폼이며 실제 신호에 의존하지 않습니다.
if (stopfile) setInterval(() => { if (fs.existsSync(stopfile)) process.exit(0); }, 50);
`;

const FAKE_CHROME_DIES = `process.exit(0);\n`;

const FAKE_CHROME_FRESH = `"use strict";
const path = require("path");
let port = 0;
for (const a of process.argv) {
  const m = a.match(/^--remote-debugging-port=(\\d+)$/);
  if (m) port = Number(m[1]);
}
// 자신의 stopfile을 사용합니다(H_STOPFILE은 pkill 시점에 이미 작성되었으며, 새 엔드포인트가 시작되면 종료됩니다).
process.argv = [process.argv[0], "fake-cdp", "--port", String(port),
  "--id", "fresh-launched-cdp", "--stopfile", process.env.H_STOPFILE_NEW];
require(path.join(__dirname, "fake-cdp.js"));
`;

// 가짜 Chrome: 엔드포인트를 분리된 손자 프로세스에 전달하고 즉시 종료됩니다. spawn으로 생성된 pid가 죽어도,
// 하지만 포트에 새로운 "신원"을 가진 엔드포인트가 응답 중——identity 확인으로는 막을 수 없고, pid 생존 확인으로만 막을 수 있다.
const FAKE_CHROME_ORPHAN = `"use strict";
const path = require("path");
const { spawn } = require("child_process");
let port = 0;
for (const a of process.argv) {
  const m = a.match(/^--remote-debugging-port=(\\d+)$/);
  if (m) port = Number(m[1]);
}
const child = spawn(
  process.execPath,
  [path.join(__dirname, "fake-cdp.js"), "--port", String(port),
   "--remote-debugging-port=" + String(port) + "0", "--id", "foreign-orphan-cdp",
   "--stopfile", process.env.H_STOPFILE_NEW],
  { detached: true, stdio: "ignore" }
);
child.unref();
setTimeout(() => process.exit(0), 300);
`;

// 위와 동일하지만 launcher는 상주——이것이 재검토에서 제시한 최소 변형이다. 따라서 "기존 엔드포인트 사라짐 + 신원 변경 +
// spawn된 프로세스가 살아있음" 세 가지 간접 증거가 모두 성립하는데, 포트는 실제로 다른 프로세스가 점유하고 있다.
// 이 세 가지 조건만으로는 "포트가 그것의 것"이라는 결론을 낼 수 없고, 포트와 프로세스를 실제로 바인딩한 확인만이 이를 막을 수 있다.
const FAKE_CHROME_FOREIGN_ALIVE = `"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
let port = 0;
for (const a of process.argv) {
  const m = a.match(/^--remote-debugging-port=(\\d+)$/);
  if (m) port = Number(m[1]);
}
const child = spawn(
  process.execPath,
  [path.join(__dirname, "fake-cdp.js"), "--port", String(port), "--id", "foreign-orphan-cdp",
   "--stopfile", process.env.H_STOPFILE_NEW],
  { detached: true, stdio: "ignore" }
);
child.unref();
// 변형점: launcher는 종료하지 않고, 테스트 마무리 시 stopfile을 작성할 때만 종료한다.
setInterval(() => { if (fs.existsSync(process.env.H_STOPFILE_NEW)) process.exit(0); }, 50);
`;

// 포트가 「이번 spawn의 프로세스 트리에 없는」 프로세스에 의해 점유되어 있으며, launcher는 여전히 실행 중이다.
// 2단계 spawn: 중간 계층은 즉시 종료되고, 엔드포인트 프로세스는 init에 의해 채택되어 이번 시작의 프로세스 트리에서 분리된다.
// 의도적으로 이번 시작과 정확히 동일한 --remote-debugging-port=<port>를 가져오며, 유일한 차이점은
// 「우리가 시작하지 않은 것」——이 테스트는 바로 pid 소유권 자체를 테스트하는 것이다.
const FAKE_CHROME_OUTSIDE_TREE = `"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
let port = 0;
for (const a of process.argv) {
  const m = a.match(/^--remote-debugging-port=(\\d+)$/);
  if (m) port = Number(m[1]);
}
const relay = spawn(
  process.execPath,
  ["-e",
   "const {spawn}=require('child_process');" +
   "const c=spawn(process.argv[1],process.argv.slice(2),{detached:true,stdio:'ignore'});" +
   "c.unref();process.exit(0);",
   process.execPath,
   path.join(__dirname, "fake-cdp.js"), "--remote-debugging-port=" + port,
   "--id", "outside-tree-cdp", "--stopfile", process.env.H_STOPFILE_NEW],
  { detached: true, stdio: "ignore" }
);
relay.unref();
setInterval(() => { if (fs.existsSync(process.env.H_STOPFILE_NEW)) process.exit(0); }, 50);
`;

// 실제 Chrome의 일반적인 형태: launcher 자신은 수신하지 않고, 포트는 이것이 시작한 browser 프로세스에 의해 점유된다.
// (macOS에서 시작한 바이너리는 re-exec될 수도 있음). 이 자식 프로세스는 이번 시작의
// --remote-debugging-port를 상속받았고, 또한 spawn된 프로세스 트리 내에 있음 — 소유권 검증은 이러한 형태를 인정해야 하고,
// 그렇지 않으면 실제 시작이 잘못 종료될 수 있음. 이것은 소유권 검증의 거짓 음성 방어입니다.
const FAKE_CHROME_CHILD_BROWSER = `"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
let port = 0;
for (const a of process.argv) {
  const m = a.match(/^--remote-debugging-port=(\\d+)$/);
  if (m) port = Number(m[1]);
}
spawn(
  process.execPath,
  [path.join(__dirname, "fake-cdp.js"), "--remote-debugging-port=" + port,
   "--id", "child-browser-cdp", "--stopfile", process.env.H_STOPFILE_NEW],
  { stdio: "ignore" }
);
setInterval(() => { if (fs.existsSync(process.env.H_STOPFILE_NEW)) process.exit(0); }, 50);
`;

// 포트는 launcher 본 프로세스가 직접 바인딩함 (소유권은 실제로 성립), 하지만 /json/version에는
// webSocketDebuggerUrl이 없음 — cdpIdentity()가 null을 반환함. 자신의 계약에 따르면, null은 "비교 불가능"하다고만 해석할 수 있음.
const FAKE_CHROME_NO_IDENTITY = `"use strict";
const path = require("path");
let port = 0;
for (const a of process.argv) {
  const m = a.match(/^--remote-debugging-port=(\\d+)$/);
  if (m) port = Number(m[1]);
}
process.argv = [process.argv[0], "fake-cdp", "--port", String(port), "--id", "no-identity-cdp",
  "--no-identity", "--stopfile", process.env.H_STOPFILE_NEW];
require(path.join(__dirname, "fake-cdp.js"));
`;

const CDP_PRELOAD = `"use strict";
const fs = require("fs");
const cp = require("child_process");
// Chrome 실행 파일의 후보 경로는 플랫폼별로 하드코딩되어 있으므로, 여기서는 「Chrome 실행 파일처럼 보이는」것으로 인식합니다.
// 테스트에서 플랫폼 테이블을 다시 작성할 필요가 없습니다.
const CHROME_RE = /(?:Google Chrome|google-chrome(?:-stable)?|chrome\\.exe)$/;
const realExistsSync = fs.existsSync;
fs.existsSync = function (p) {
  if (typeof p === "string" && CHROME_RE.test(p)) return true;
  return realExistsSync.call(fs, p);
};
const realSpawn = cp.spawn;
cp.spawn = function (file, args, opts) {
  if (typeof file === "string" && CHROME_RE.test(file)) {
    return realSpawn.call(cp, process.execPath, [process.env.H_FAKE_CHROME, ...(args || [])], opts);
  }
  return realSpawn.call(cp, file, args, opts);
};
const realExecSync = cp.execSync;
cp.execSync = function (cmd, opts) {
  if (/^(pgrep|tasklist)/.test(cmd)) {
    if (process.env.H_PIDS === "old" && !realExistsSync.call(fs, process.env.H_KILLED_MARK)) {
      return process.platform === "win32" ? '"chrome.exe","424242"' : "424242\\n";
    }
    const e = new Error("no process found"); // pgrep이 프로세스를 찾지 못할 때의 실제 동작: 0이 아닌 종료 코드
    e.status = 1;
    throw e;
  }
  if (/^pkill/.test(cmd) || /^taskkill\\s+\\/F\\s+\\/IM\\s+chrome\\.exe/i.test(cmd)) {
    fs.writeFileSync(process.env.H_KILLED_MARK, "killed", "utf8");
    // kill이 작동하는 시나리오에서만 실제로 이전 엔드포인트를 중지합니다. noop 시나리오는 「kill이 작동하지 않음」을 시뮬레이션합니다.
    if (process.env.H_KILL === "real") fs.writeFileSync(process.env.H_STOPFILE, "stop", "utf8");
    return "";
  }
  return realExecSync.call(cp, cmd, opts);
};
`;

/**
 * setup-cdp-chrome.js를 한 번 실행합니다. scenario는 pgrep/pkill의 의미와 가짜 Chrome 동작을 결정합니다.
 * { status, stdout, stderr, sentinelSurvived, debugProfileSurvived }를 반환합니다.
 */
function runSetupCdp(scenario) {
  const setup = path.join(
    repoRoot,
    "skills/browser-cdp/scripts/setup-cdp-chrome.js"
  );
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-cdp-reset-"));
  let oldCdp = null;
  let port = null;
  try {
    for (const [name, body] of [
      ["fake-cdp.js", FAKE_CDP],
      ["fake-chrome-dies.js", FAKE_CHROME_DIES],
      ["fake-chrome-fresh.js", FAKE_CHROME_FRESH],
      ["fake-chrome-orphan.js", FAKE_CHROME_ORPHAN],
      ["fake-chrome-foreign-alive.js", FAKE_CHROME_FOREIGN_ALIVE],
      ["fake-chrome-outside-tree.js", FAKE_CHROME_OUTSIDE_TREE],
      ["fake-chrome-child-browser.js", FAKE_CHROME_CHILD_BROWSER],
      ["fake-chrome-no-identity.js", FAKE_CHROME_NO_IDENTITY],
      ["cdp-preload.js", CDP_PRELOAD],
    ]) {
      fs.writeFileSync(path.join(tmpDir, name), body, "utf8");
    }

    // 가짜 HOME: 원본 profile + 기존의 debug profile(안의 sentinel 파일은 종료 시 삭제되지 않았음을 증명)
    const home = path.join(tmpDir, "home");
    const srcDefault = path.join(
      home,
      process.platform === "darwin"
        ? "Library/Application Support/Google/Chrome/Default"
        : process.platform === "win32"
          ? "AppData/Local/Google/Chrome/User Data/Default"
          : ".config/google-chrome/Default"
    );
    fs.mkdirSync(srcDefault, { recursive: true });
    fs.writeFileSync(path.join(srcDefault, "Cookies"), "src-cookies", "utf8");
    const debugProfile = path.join(home, "chrome-debug-profile");
    fs.mkdirSync(path.join(debugProfile, "Default"), { recursive: true });
    const sentinel = path.join(debugProfile, "SENTINEL");
    fs.writeFileSync(sentinel, "must-survive-an-abort", "utf8");

    const plan = {
      staleHolder: { args: ["--reset", "--yes"], pids: "empty", kill: "noop", chrome: "fake-chrome-dies.js" },
      unhealthyHolder: { args: ["--reset", "--yes"], pids: "empty", kill: "noop", chrome: "fake-chrome-dies.js", oldStatus: 500 },
      genuineReset: { args: ["--reset", "--yes"], pids: "old", kill: "real", chrome: "fake-chrome-fresh.js" },
      plainReuse: { args: [], pids: "empty", kill: "noop", chrome: "fake-chrome-dies.js" },
      orphanEndpoint: { args: ["--reset", "--yes"], pids: "old", kill: "real", chrome: "fake-chrome-orphan.js" },
      foreignHeldPort: { args: ["--reset", "--yes"], pids: "old", kill: "real", chrome: "fake-chrome-foreign-alive.js" },
      outsideTreeHolder: { args: ["--reset", "--yes"], pids: "old", kill: "real", chrome: "fake-chrome-outside-tree.js" },
      childHoldsPort: { args: ["--reset", "--yes"], pids: "old", kill: "real", chrome: "fake-chrome-child-browser.js" },
      nullIdentity: { args: ["--reset", "--yes"], pids: "old", kill: "real", chrome: "fake-chrome-no-identity.js" },
    }[scenario];
    assert(plan, `harness: 알 수 없는 시나리오 ${scenario}`);

    // 오래된 CDP를 시작하고, 포트를 직접 선택한 후 보고하도록 함——테스트 간 고정 포트 충돌 없음
    const portfile = path.join(tmpDir, "port");
    const stopfile = path.join(tmpDir, "stop");
    oldCdp = spawn(
      process.execPath,
      [
        path.join(tmpDir, "fake-cdp.js"),
        "--port", "0",
        "--id", "stale-existing-cdp",
        "--portfile", portfile,
        "--stopfile", stopfile,
        "--status", String(plan.oldStatus || 200),
      ],
      { stdio: "ignore" }
    );
    for (let i = 0; i < 200 && port === null; i++) {
      sleepSyncMs(50);
      if (fs.existsSync(portfile)) port = fs.readFileSync(portfile, "utf8").trim();
    }
    assert(port, "harness: 가짜 오래된 CDP가 시작되지 않음");

    const result = spawnSync(
      process.execPath,
      ["--require", path.join(tmpDir, "cdp-preload.js"), setup, port, ...plan.args],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 120000,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          LOCALAPPDATA: path.join(home, "AppData", "Local"),
          H_FAKE_CHROME: path.join(tmpDir, plan.chrome),
          H_PIDS: plan.pids,
          H_KILL: plan.kill,
          H_KILLED_MARK: path.join(tmpDir, "killed"),
          H_STOPFILE: stopfile,
          H_STOPFILE_NEW: path.join(tmpDir, "stop-new"),
        },
      }
    );
    return {
      ...result,
      port,
      sentinelSurvived: fs.existsSync(sentinel),
      debugProfileSurvived: fs.existsSync(debugProfile),
      listenerAliveBeforeCleanup: canConnectTcp(port),
    };
  } finally {
    // 기존 엔드포인트와 가짜 Chrome이 남긴 상주 엔드포인트를 정리합니다: 먼저 stopfile로 자동 종료하게 한 후(크로스 플랫폼 호환), lsof/netstat로 남은 것을 정리하고, 마지막에 디렉터리를 삭제합니다.
    // 재시도 로직: lsof/netstat 결과가 비어있을 때까지 반복합니다.
    for (const f of ["stop", "stop-new"]) {
      try { fs.writeFileSync(path.join(tmpDir, f), "stop", "utf8"); } catch {}
    }
    if (oldCdp && oldCdp.pid) { try { process.kill(oldCdp.pid); } catch {} }
    sleepSyncMs(300);
    if (port) killPortListener(port);
    sleepSyncMs(200);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function sleepSyncMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** TCP 포트를 동기식으로 탐지합니다. harness finally 정리 전에 테스트 중인 스크립트가 시작 트리를 정리했는지 확인하기 위해 사용됩니다. */
function canConnectTcp(port) {
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      "const net=require('net');const s=net.createConnection({host:'127.0.0.1',port:Number(process.argv[1])});" +
        "s.setTimeout(500);s.once('connect',()=>{s.destroy();process.exit(0)});" +
        "s.once('error',()=>process.exit(1));s.once('timeout',()=>{s.destroy();process.exit(1)});",
      String(port),
    ],
    { stdio: "ignore", timeout: 2000 }
  );
  return probe.status === 0;
}

/** 테스트 중 포트를 여전히 점유하고 있는 가짜 엔드포인트를 정리합니다(최선을 다하되, 실패해도 assertion에 영향을 주지 않습니다). */
function killPortListener(port) {
  try {
    const out =
      process.platform === "win32"
        ? spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" }).stdout || ""
        : spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout || "";
    const pids = new Set();
    if (process.platform === "win32") {
      for (const line of out.split("\n")) {
        const m = line.match(new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`));
        if (m) pids.add(Number(m[1]));
      }
    } else {
      for (const line of out.split("\n")) {
        const n = Number(line.trim());
        if (n > 0) pids.add(n);
      }
    }
    for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
  } catch {}
}

// 회귀 지점: --reset이 닫을 수 없는 기존 CDP와 만났을 때, 절대 "재구성 성공"을 보고하면 안 됩니다.
// 이전 동작은 최악의 결과였습니다 - debug profile을 삭제하고 시작하지만, probeCDP가 구형 엔드포인트에서 응답을 받아
// exit 0으로 성공 처리되고, 호출자는 새 브라우저를 받았다고 생각한 후, 이후 매번 수집된 데이터는 구형 세션을 읽습니다.
function testCdpResetRefusesStaleEndpoint() {
  const run = runSetupCdp("staleHolder");

  assert.strictEqual(
    run.status,
    1,
    `종료할 수 없는 구형 CDP는 --reset이 0이 아닌 종료 코드를 반환해야 하는데, 실제 ${run.status}:\n${run.stdout}\n${run.stderr}`
  );
  assert.match(run.stderr, /여전히 응답 중이며, 중단됨/);
  // 포트가 인식할 수 없는 프로세스에서 점유됨: 명확히 지정해야 하며, 자동으로 재사용할 수 없음
  assert.match(run.stderr, /포트가 인식할 수 없는 프로세스에 의해 점유됨/);

  // 게이트는 profile 수집 전에 작동합니다 — 실행 중인 Chrome의 profile을 삭제하는 것 자체가 파괴적입니다
  assert(
    run.sentinelSurvived,
    "중단 시 debug profile을 삭제하면 안 됩니다(감시 파일이 여전히 있어야 합니다)"
  );
  assert(run.debugProfileSurvived, "중단 시 debug profile 디렉터리가 반드시 유지되어야 합니다");
  assert(
    !/debug profile을 삭제 중입니다/.test(run.stdout),
    `중단 경로에서 profile을 삭제하면 안 됨:\n${run.stdout}`
  );
  assert(
    !/CDP 모드로 Chrome을 시작 중/.test(run.stdout),
    `포트가 비어있지 않으면 Chrome을 시작하면 안 됨:\n${run.stdout}`
  );
  assert(
    !/CDP 모드로 성공적으로 시작함/.test(run.stdout),
    `절대 성공이라고 보고하면 안 됨:\n${run.stdout}`
  );
  // 기존 엔드포인트의 응답도 '새 인스턴스'로 출력되어서는 안 됨
  assert(
    !run.stdout.includes("stale-existing-cdp"),
    `기존 인스턴스의 /json/version을 결과 출력으로 취급해서는 안 됨:\n${run.stdout}`
  );
}

// 회귀 테스트: /json/version이 500을 반환할 때 probeCDP는 null이지만, TCP 포트는 여전히 기존 서비스가 점유하고 있음.
// '정상 CDP가 아님'은 절대 '포트 유휴'와 같지 않음; profile을 손상시키기 전에 반드시 원본 TCP 프로브로 포트 해제 확인 필수.
function testCdpResetRefusesUnhealthyTcpHolder() {
  const run = runSetupCdp("unhealthyHolder");
  assert.strictEqual(
    run.status,
    1,
    `기존 포트가 여전히 수신 중이지만 /json/version=500일 때는 반드시 0이 아닌 종료 코드:\n${run.stdout}\n${run.stderr}`
  );
  assert(run.sentinelSurvived, "불건강한 리스너가 여전히 포트를 점유 중일 때는 debug profile을 삭제할 수 없습니다");
  assert(run.debugProfileSurvived, "불건강한 리스너가 여전히 포트를 점유 중일 때 debug profile은 반드시 보존되어야 합니다");
  assert(!/debug profile을 삭제 중입니다/.test(run.stdout), run.stdout);
  assert(!/CDP 모드로 Chrome을 시작 중입니다/.test(run.stdout), run.stdout);
  assert.match(run.stderr, /포트.*여전히 점유 중|포트.*미해제/);
}

// 역방향: 포트가 실제로 비워지고, 새 인스턴스가 실제로 시작됨(포트는 spawn된 프로세스에 바인딩되고,
// 명령줄에 이번 --remote-debugging-port가 포함됨), --reset은 여전히 성공함—게이트는 기능을 비활성화하지 않음.
// 이 조건은 동시에 소유권 검증의 거짓 양성 방지 장치임: lsof/ps로 조회된 소유자는 반드시 이번 시작과 일치해야 함.
function testCdpResetSucceedsWhenPortActuallyFrees() {
  const run = runSetupCdp("genuineReset");
  assert.strictEqual(
    run.status,
    0,
    `이전 엔드포인트가 실제로 사라지고 + 새 엔드포인트가 시작됨, --reset은 반드시 성공해야 함:\n${run.stdout}\n${run.stderr}`
  );
  assert(
    !/CDP_OWNER_|CDP_PORT_NOT_OURS|CDP_IDENTITY_UNVERIFIABLE/.test(run.stderr),
    `실제 시작이 소유권/신원 검증으로 인해 종료되면 안 됨:\n${run.stderr}`
  );
  assert.match(run.stdout, /해제됨/);
  assert.match(run.stdout, /debug profile 삭제 중/);
  assert.match(run.stdout, /CDP 모드로 성공적으로 시작됨/);
  // 보고된 것은 반드시 새 인스턴스의 ID여야 하며, 재구성 전의 ID가 아니어야 함
  assert(run.stdout.includes("fresh-launched-cdp"), run.stdout);
  assert(!run.stdout.includes("stale-existing-cdp"), run.stdout);
}

// --reset/--profile 없이 재사용하는 빠른 경로는 반드시 그대로여야 함: 기존 CDP를 직접 재사용하고 즉시 0으로 종료
function testCdpPlainReuseUnchanged() {
  const run = runSetupCdp("plainReuse");
  assert.strictEqual(run.status, 0, `재사용 경로는 반드시 성공해야 합니다:\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /CDP 준비 완료, 기존 Chrome을 재사용합니다./);
  assert(run.stdout.includes("stale-existing-cdp"), run.stdout);
  // 재사용은 재사용: 프로세스를 종료하면 안 되고, profile을 건드리면 안 되고, 시작하면 안 됨
  assert(run.sentinelSurvived, "재사용 경로에서 debug profile을 건드리면 안 됩니다");
  assert(!/정지 중/.test(run.stdout), run.stdout);
  assert(!/debug profile 삭제 중/.test(run.stdout), run.stdout);
  assert(!/CDP 모드로 Chrome 시작 중/.test(run.stdout), run.stdout);
  // 빠른 재사용 경로에서는 「이번 시작의 인스턴스」가 없으므로 소유권/신원 확인이 여기서 실행되면 안 됨
  assert(
    !/CDP_OWNER_|CDP_PORT_NOT_OURS|CDP_IDENTITY_UNVERIFIABLE/.test(run.stderr),
    `빠른 재사용 경로는 시작 후 소유권/신원 확인을 실행하면 안 됩니다:\n${run.stderr}`
  );
}

// 포트가 비워졌지만 방금 생성된 Chrome이 종료되고 포트가 다른 프로세스에 의해 인수되었을 때: identity가 변경되어도 성공으로 간주하지 않음
function testCdpRejectsEndpointNotFromThisLaunch() {
  const run = runSetupCdp("orphanEndpoint");
  assert.strictEqual(
    run.status,
    1,
    `응답한 엔드포인트가 이번 시작에 속하지 않으므로 0이 아닌 값으로 종료되어야 합니다:\n${run.stdout}\n${run.stderr}`
  );
  assert.match(run.stderr, /방금 시작된 Chrome\(pid \d+\)이 이미 종료됨/);
  assert.match(run.stderr, /이 엔드포인트는 이번 시작의 인스턴스에 속하지 않음/);
  assert(
    !/CDP 모드로 성공적으로 시작됨/.test(run.stdout),
    `다른 엔드포인트를 시작 성공으로 보고할 수 없습니다:\n${run.stdout}`
  );
  assert(
    !run.stdout.includes("foreign-orphan-cdp"),
    `외부 엔드포인트의 /json/version을 결과 출력으로 해서는 안 됩니다:\n${run.stdout}`
  );
}

// 회귀 지점: launcher가 살아 있지만 포트는 detach된 다른 프로세스가 점유하고 있습니다.
// 「이전 엔드포인트가 사라짐 + 신원이 변함 + spawn된 프로세스가 여전히 실행 중」 이 세 가지 간접 증거가 모두 성립해도 「포트가 이것의 것」이라고 추론할 수 없습니다.
// 포트를 이번 시작의 인스턴스와 실제로 바인딩해야 합니다: LISTEN 소유자는 이 프로세스 트리 내에 있어야 하고, 트리에는 실제로 이번의 --remote-debugging-port를 가진 소유자가 있어야 합니다.
// 그렇지 않으면 다른 사람의 로그인 상태를 얻게 됩니다.
function testCdpRejectsForeignHolderWhileLauncherAlive() {
  const run = runSetupCdp("foreignHeldPort");

  assert.strictEqual(
    run.status,
    1,
    `포트가 다른 프로세스에 점유되어 있으면(launcher가 살아 있어도) 0이 아닌 값으로 종료해야 합니다. 실제 ${run.status}:\n${run.stdout}\n${run.stderr}`
  );
  // 소유 프로세스를 찾으면 NOT_LAUNCHED_INSTANCE로 명시합니다. 찾을 수 없으면(현재 시스템에 lsof/ps 같은 도구가 없는 경우)
  // UNVERIFIABLE로 강제 실패 처리합니다. 둘 다 「증명할 수 없으면 진행하지 않음」 원칙이며, exit 0만은 허용되지 않습니다.
  assert.match(
    run.stderr,
    /CDP_OWNER_NOT_LAUNCHED_INSTANCE|CDP_OWNER_UNVERIFIABLE/,
    `이 엔드포인트를 인정하지 않는 이유를 명확히 표시해야 합니다:\n${run.stderr}`
  );
  // 이번에는 launcher가 살아 있습니다. 「프로세스가 이미 종료됨」이라는 이전 분기로 운을 시도하면 안 됩니다.
  assert(
    !/이미 종료됨/.test(run.stderr),
    `launcher가 살아있을 때 「프로세스 종료됨」 분기에 도달하면 안 됨:\n${run.stderr}`
  );
  assert(
    !/CDP 모드로 성공적으로 시작됨/.test(run.stdout),
    `다른 프로세스가 점유 중인 포트를 시작 성공으로 보고하면 안 됨:\n${run.stdout}`
  );
  assert(
    !run.stdout.includes("foreign-orphan-cdp"),
    `외부 엔드포인트의 /json/version을 결과 출력으로 간주하면 안 됨:\n${run.stdout}`
  );
  assert(
    !run.listenerAliveBeforeCleanup,
    "시작 후 소유권 검증 실패 시 이번 시작의 전체 프로세스 트리를 반드시 정리해야 하며, launcher만 죽이고 detached listener를 남겨두면 안 됨"
  );
}

// 회귀 테스트: 포트가 이번 spawn 프로세스 트리에 없는 프로세스에 의해 점유되어 있음 (launcher는 여전히 살아있음),
// 그리고 그 프로세스가 이번과 정확히 동일한 --remote-debugging-port를 가지고 있음—유일한 차이는 「우리가 시작하지 않은 것」.
// 이 테스트는 정확히 pid 소유권 자체를 검증함.
function testCdpRejectsPortHeldOutsideSpawnedTree() {
  const run = runSetupCdp("outsideTreeHolder");

  assert.strictEqual(
    run.status,
    1,
    `포트 점유자가 이번 시작의 프로세스 트리에 없으면 반드시 0 이외의 상태로 종료되어야 함, 실제 ${run.status}:\n${run.stdout}\n${run.stderr}`
  );
  assert.match(
    run.stderr,
    /CDP_PORT_NOT_OURS|CDP_OWNER_UNVERIFIABLE/,
    `왜 이 엔드포인트를 인식하지 않는지 명확히 설명해야 합니다:\n${run.stderr}`
  );
  assert(
    !/성공적으로 CDP 모드로 시작됨/.test(run.stdout),
    `트리 외부 프로세스가 보유한 포트를 시작 성공으로 보고하면 안 됩니다:\n${run.stdout}`
  );
  assert(
    !run.stdout.includes("outside-tree-cdp"),
    `트리 외부 엔드포인트의 /json/version을 결과 출력으로 처리하면 안 됩니다:\n${run.stdout}`
  );
}

// 반대 케이스: 실제 Chrome은 보통 launcher 자체가 수신 대기하지 않으며, 대신 launcher가 시작한 browser 프로세스가 포트를 보유합니다
// (macOS에서도 재실행될 수 있음). 프로세스 트리의 더 깊은 층에 있는 소유자도 성공으로 간주되어야 함 -- 소유권 검증은 다른 프로세스를 차단하기 위한 것이지,
// 실제 시작을 차단하기 위한 것이 아님.
function testCdpAcceptsPortHeldByLaunchedChildProcess() {
  const run = runSetupCdp("childHoldsPort");

  assert.strictEqual(
    run.status,
    0,
    `포트가 이번 시작으로 인해 생성된 자식 프로세스에서 보유되고 있으므로 성공으로 간주되어야 함:\n${run.stdout}\n${run.stderr}`
  );
  assert.match(run.stdout, /CDP 모드로 성공적으로 시작됨/);
  assert(run.stdout.includes("child-browser-cdp"), run.stdout);
  assert(
    !/CDP_OWNER_|CDP_PORT_NOT_OURS|CDP_IDENTITY_UNVERIFIABLE/.test(run.stderr),
    `프로세스 트리의 더 깊은 층에 있는 소유자가 실수로 종료되어서는 안 됨:\n${run.stderr}`
  );
}

// 회귀 지점: /json/version 응답에서 인스턴스 ID를 가져올 수 없을 때 cdpIdentity()가 null을 반환합니다.
// 이것의 계약에서 null은 「비교 불가」로만 정의되어 있습니다 — 같음도 다름도 아닙니다. 이를 통과시키는 것은
// 「증명할 수 없음」을 「증명됨」으로 취급하는 것과 같으므로 반드시 강제 실패해야 하며, 포트 소유 조건이 실제로 성립하더라도 그렇습니다.
function testCdpRejectsUnverifiableIdentity() {
  const run = runSetupCdp("nullIdentity");

  assert.strictEqual(
    run.status,
    1,
    `인스턴스 ID를 가져올 수 없으므로 0이 아닌 상태로 종료되어야 하며, 실제 상태 ${run.status}:\n${run.stdout}\n${run.stderr}`
  );
  assert.match(run.stderr, /CDP_IDENTITY_UNVERIFIABLE/);
  assert.match(run.stderr, /인스턴스 ID를 가져올 수 없음/);
  assert(
    !/성공적으로 CDP 모드로 시작됨/.test(run.stdout),
    `ID가 없으면 성공으로 보고할 수 없습니다:\n${run.stdout}`
  );
  assert(
    !run.stdout.includes("no-identity-cdp"),
    `ID가 없는 엔드포인트를 결과로 출력해서는 안 됩니다:\n${run.stdout}`
  );
}

// 정적 가드: CDP의 http.get은 반드시 명시적으로 agent:false를 지정해야 합니다.
// Node 19+ 의 globalAgent는 기본적으로 keepAlive가 활성화되고, 이 스크립트는 sleepSync로 이벤트 루프를 블로킹하므로,
// 이 기간 서버는 5초의 유휴 시간 후 풀의 연결을 종료합니다. 이 죽은 socket을 재사용하면 ECONNRESET이 발생하고,
// 그 결과 「포트가 활성 상태」가 「응답 없음」으로 잘못 판단되며——이러한 거짓 음성은 포트 게이트웨이를 직접 통과합니다.
function testCdpProbeUsesFreshSocket() {
  const src = fs.readFileSync(
    path.join(repoRoot, "skills/browser-cdp/scripts/setup-cdp-chrome.js"),
    "utf8"
  );
  const call = src.match(/http\.get\([^)]*\)/);
  assert(call, "http.get 호출을 찾을 수 없습니다");
  assert(
    /agent:\s*false/.test(call[0]),
    `CDP 탐사의 http.get은 반드시 agent:false를 포함해야 합니다(매번 새로운 연결), 실제: ${call[0]}`
  );
}

function testCdpWindowsListenerParsingIsLocaleIndependent() {
  const src = fs.readFileSync(
    path.join(repoRoot, "skills/browser-cdp/scripts/setup-cdp-chrome.js"),
    "utf8"
  );
  const block = src.match(
    /function listPortListenerPids\(port\) \{[\s\S]*?\r?\n\}\r?\n\r?\n\/\*\* 전체 기계/
  );
  assert(block, "listPortListenerPids를 찾을 수 없습니다");
  assert(
    /Get-NetTCPConnection/.test(block[0]),
    "Windows 리스너 쿼리는 Get-NetTCPConnection의 구조화된 OwningProcess를 우선적으로 사용해야 합니다"
  );
  assert(
    !/LISTENING\\\\s/.test(block[0]),
    "netstat fallback은 영문 상태 문자 LISTENING에 의존해서는 안 됩니다(로컬라이제이션된 Windows는 다른 문자를 사용합니다)"
  );
}

testCdpUtils(longUtilsPath);
testCdpUtils(shortUtilsPath);
testWindowsInvocationBuilder(longUtilsPath);
testLocalDateStamp(longUtilsPath);
testLocalDateStamp(shortUtilsPath);
testScraperFilenameDatesAreLocal();
testScraperImports();
testCliResultGate(longUtilsPath);
testJjwxcDetailFailureIsolation();
testQidianRankIsolation();
testHeiyanFieldDriftAndWordFormat();
testCdpProbeUsesFreshSocket();
testCdpWindowsListenerParsingIsLocaleIndependent();
testCdpPlainReuseUnchanged();
testCdpResetRefusesStaleEndpoint();
testCdpResetRefusesUnhealthyTcpHolder();
testCdpRejectsEndpointNotFromThisLaunch();
testCdpRejectsForeignHolderWhileLauncherAlive();
testCdpRejectsPortHeldOutsideSpawnedTree();
testCdpRejectsUnverifiableIdentity();
testCdpAcceptsPortHeldByLaunchedChildProcess();
testCdpResetSucceedsWhenPortActuallyFrees();
console.log("OK: scan runtime uses shell-safe CDP calls and side-effect-free scraper modules");
