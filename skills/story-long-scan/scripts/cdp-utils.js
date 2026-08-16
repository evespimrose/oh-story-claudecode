/**
 * CDP 유틸리티 함수 — 각 플랫폼 수집 스크립트의 공통 의존성
 *
 * 사용 방식:
 *   const { ab, sleep, evalJSON, evalJSONBase64, scrollLoad, getArg, safeStr, localDateStamp } = require("./cdp-utils");
 *
 * 사전 요구 사항:
 *   node {SKILL_DIR}/browser-cdp/scripts/setup-cdp-chrome.js 9222
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * On Windows `agent-browser` is an npm shim (agent-browser.cmd/.ps1) that
 * forwards to the real target — the native agent-browser-win32-*.exe or a
 * bundled Node CLI. Node refuses to execFile the `.cmd` without a shell
 * (CVE-2024-27980), and routing the argv array through a shell mangles it: the
 * `.cmd`'s `%*` is re-tokenized by cmd.exe (splitting on spaces, breaking on
 * & | ^), and calling the shim by bare name from powershell.exe collapses the
 * whole array into a single space-joined argument. The exact locus differs by
 * runtime, so instead of hardening any one shell path we bypass shells entirely:
 * read the `.cmd` shim, recover the real program plus its fixed leading args,
 * and execFile that target directly with the argv array — verbatim, no shell.
 */
function resolveWindowsAgentBrowser(argv) {
  const dirs = String(process.env.PATH || "").split(path.delimiter);
  let cmdPath = null;
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, "agent-browser.cmd");
    if (fs.existsSync(candidate)) {
      cmdPath = candidate;
      break;
    }
  }
  if (!cmdPath) return { file: "agent-browser", args: argv };
  const dir = path.dirname(cmdPath);
  const forwardLine =
    fs
      .readFileSync(cmdPath, "utf8")
      .split(/\r?\n/)
      .find((line) => line.includes("%*")) || "";
  const tokens = [...forwardLine.matchAll(/"([^"]*)"/g)]
    .map((m) => m[1])
    .map((t) =>
      t
        .replace(/%~dp0/gi, () => dir + path.sep)
        .replace(/%dp0%/gi, () => dir + path.sep)
    );
  const jsIndex = tokens.findIndex((t) => /\.[cm]?js$/i.test(t));
  if (jsIndex >= 0) {
    return { file: process.execPath, args: [...tokens.slice(jsIndex), ...argv] };
  }
  if (tokens.length > 0) {
    return { file: tokens[0], args: [...tokens.slice(1), ...argv] };
  }
  return { file: "agent-browser", args: argv };
}

/**
 * Build a shell-free invocation. POSIX runs the native `agent-browser` binary
 * directly; Windows resolves the npm `.cmd` shim to that native target so the
 * argument array is passed verbatim, never routed through cmd.exe/PowerShell.
 */
function buildAgentBrowserInvocation(port, args, platform = process.platform) {
  const argv = ["--cdp", String(port), ...args.map(String)];
  if (platform !== "win32") {
    return { file: "agent-browser", args: argv };
  }
  return resolveWindowsAgentBrowser(argv);
}

// ---------------------------------------------------------------------------
// agent-browser 유틸리티 함수
// ---------------------------------------------------------------------------

/**
 * agent-browser CLI 호출
 * @param {number} port - CDP 포트
 * @param  {...string} args - agent-browser 매개변수
 * @returns {string} 표준 출력(trim 후)
 */
function ab(port, ...args) {
  const invocation = buildAgentBrowserInvocation(port, args);
  try {
    return execFileSync(
      invocation.file,
      invocation.args,
      {
        encoding: "utf-8",
        timeout: 20000,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }
    ).trim();
  } catch (error) {
    const stderr = error && error.stderr ? String(error.stderr).trim() : "";
    const stdout = error && error.stdout ? String(error.stdout).trim() : "";
    const detail = stderr || stdout || (error && error.message) || "unknown error";
    throw new Error(`agent-browser failed: ${detail}`, { cause: error });
  }
}

/** ms 밀리초 동안 대기(크로스 플랫폼, 시스템 sleep 명령어 비의존) */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parseJSONResult(raw) {
  if (!raw || raw === "ERR") {
    throw new Error("agent-browser returned no JSON result");
  }
  try {
    let parsed = JSON.parse(raw);
    if (typeof parsed === "string") {
      try { parsed = JSON.parse(parsed); } catch {}
    }
    return parsed;
  } catch (error) {
    throw new Error(`agent-browser returned invalid JSON: ${String(raw).slice(0, 160)}`, {
      cause: error,
    });
  }
}

/**
 * 브라우저 내에서 JS를 실행하고 JSON 반환값을 파싱합니다.
 * 무조건 base64(-b)를 사용합니다: 본문 추출에 사용되는 JS는 따옴표, 백슬래시 등을 포함하는데, 명령줄 인수로 사용할 때 Windows에서
 * 정확히 전달할 수 없습니다(.cmd의 %*와 PowerShell 모두 이차 파싱을 수행합니다). base64를 사용하면 인수가 [A-Za-z0-9+/=]만 포함하므로,
 * 각 수집 스크립트에서 이미 사용 중인 evalJSONBase64와 같은 보안 채널을 사용합니다.
 */
function evalJSON(port, js) {
  return evalJSONBase64(port, js);
}

/**
 * agent-browser의 base64 매개변수를 통해 복잡한 JS를 실행하여 명령줄 이스케이프 및 인수 경계 문제를 피합니다.
 */
function evalJSONBase64(port, js) {
  const encoded = Buffer.from(String(js), "utf8").toString("base64");
  return parseJSONResult(ab(port, "eval", "-b", encoded));
}

/**
 * 값을 브라우저 eval 문자열에 안전하게 삽입합니다.
 * JSON.stringify를 사용하여 값이 특수 문자(따옴표, 백슬래시 등)로 인해 eval 문자열이 손상되지 않도록 합니다.
 * @param {*} val - 삽입할 값
 * @returns {string} JSON 문자열 표현(따옴표 포함)
 */
function safeStr(val) {
  return JSON.stringify(String(val));
}

/**
 * 페이지를 스크롤하여 더 많은 콘텐츠 로드
 * @param {number} port - CDP 포트
 * @param {number} times - 스크롤 횟수
 * @param {number} [interval=1000] - 각 스크롤 간격(ms)
 */
function scrollLoad(port, times, interval = 1000) {
  for (let i = 0; i < times; i++) {
    ab(port, "eval", "window.scrollBy(0, window.innerHeight)");
    sleep(interval);
  }
}

/** --xxx 매개변수 파싱 */
function getArg(args, name) {
  const i = args.indexOf(name);
  if (i >= 0) return i + 1 < args.length ? args[i + 1] : null;
  const prefix = `${name}=`;
  const inline = args.find((arg) => String(arg).startsWith(prefix));
  return inline === undefined ? null : String(inline).slice(prefix.length);
}

/**
 * 출력 파일명에 사용할 날짜 타임스탬프(YYYYMMDD)는 **로컬 달력 날짜**로 통일합니다.
 * new Date().toISOString().slice(0,10)을 사용할 수 없습니다: UTC 날짜이므로 UTC+8보다 8시간 뒤입니다.
 * 파일명은 각 수집 스크립트의 유일한 중복 제거 키입니다(하나의 랭킹은 하루에 한 개). 베이징 시간 00:00-08:00 사이의 수집
 * 은 「어제」의 파일명을 반환하며, 전날 밤에 수집한 같은 이름의 보고서를 조용히 덮어쓰고, 이 데이터는 전날로 표시됩니다.
 * @param {Date} [date] - 기본값은 현재 시간
 * @returns {string} YYYYMMDD
 */
function localDateStamp(date) {
  const d = date instanceof Date ? date : new Date();
  const y = String(d.getFullYear()).padStart(4, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Run a scraper entrypoint and turn empty/partial output into machine-readable
 * CLI status. Legacy entrypoints may return an integer; multi-target scrapers
 * return {planned,written,failed,partial,partialReasons}.
 */
function runCli(main, label) {
  Promise.resolve()
    .then(main)
    .then((result) => {
      const outcome = Number.isInteger(result)
        ? { planned: result, written: result, failed: 0, partial: false, partialReasons: [] }
        : result;
      if (!outcome || !Number.isInteger(outcome.written) || outcome.written < 1) {
        throw new Error("no output was written");
      }
      const failed = Number.isInteger(outcome.failed) ? outcome.failed : 0;
      const planned = Number.isInteger(outcome.planned)
        ? outcome.planned
        : outcome.written + failed;
      const reasons = Array.isArray(outcome.partialReasons)
        ? outcome.partialReasons.filter(Boolean).map(String)
        : [];
      if (outcome.partial || failed > 0) {
        const details = [`wrote ${outcome.written}/${planned}`];
        if (failed > 0) details.push(`failed ${failed}`);
        details.push(...reasons);
        console.error(`${label} partial: ${details.join("; ")}`);
        process.exitCode = 2;
      }
    })
    .catch((error) => {
      const message = error && error.message ? error.message : String(error);
      console.error(`${label} failed: ${message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  ab,
  sleep,
  evalJSON,
  evalJSONBase64,
  buildAgentBrowserInvocation,
  safeStr,
  scrollLoad,
  getArg,
  localDateStamp,
  runCli,
};
