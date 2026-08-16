#!/usr/bin/env node
// setup-cdp-chrome.js
// CDP(Chrome DevTools Protocol) 디버깅 기능이 포함된 Chrome 환경을 준비합니다(플랫폼 간).
// 이 스크립트를 통해 agent-browser는 사용자의 Chrome 로그인 상태를 재사용할 수 있습니다.
//
// 사용법:
//   node setup-cdp-chrome.js [port] [options]
//
// Options:
//   --detect-only            현재 상태만 감지(구조화된 출력), 어떤 수정도 하지 않음
//   --yes                    기존 Chrome 종료 확인, 대화형 프롬프트 건너뛰기
//   --reset                  ~/chrome-debug-profile 비우고 다시 복사
//   --profile <name>         지정한 Chrome profile 사용(기본값: Default)
//   --dry-run                실행할 작업 출력만 하고 실제 실행하지 않음
//
// 설명: CDP 포트가 이미 리슨 중이면 기본적으로 기존 Chrome을 직접 재사용하고 0으로 종료; 하지만 --reset 또는 명시적
//       --profile 전달 시 재사용하지 않음——이 두 파라미터는 debug profile을 재구축하려는 것이며(로그인 상태 만료 시 이 경로 사용),
//       먼저 기존 Chrome을 종료합니다(비 TTY 환경에서는 --yes 필요, 아니면 exit 3 NEEDS_CONSENT).
//       재구축 경로에는 두 가지 엄격한 검증이 존재: 프로세스를 모두 종료한 후 포트가 실제로 응답하지 않아야 함(그렇지 않으면 profile 수정 전에
//       exit 1로 중단, 실행 중인 Chrome의 profile을 절대 삭제하지 않음); 시작 후 반드시 「포트에서 응답하는 것이
//       이번에 시작한 인스턴스임」을 증명해야——ID를 확인할 수 있고 재구축 전과 다르며, spawn한 프로세스가 살아 있고, 포트의 LISTEN
//       Owner must all belong to this process tree, and there must be a owner with this --remote-debugging-port in the tree.
//       If any cannot be verified (including query failures), refuse success to prevent passing other people's sessions to a new browser.
//
// 종료 코드:
//   0  성공 / detect-only 완료
//   1  일반 오류 (환경 누락, 타임아웃 등)
//   2  사용자 거절 (TTY 모드에서 N 답변)
//   3  동의 필요하지만 현재 비 TTY이고 --yes 미전달
//
// detect-only 구조화된 출력 (stdout, 매 행 KEY=value):
//   CDP_STATUS=ready|needs-setup
//   CDP_URL=...                    (ready일 때만)
//   BROWSER=...                    (ready일 때만)
//   CHROME_RUNNING=yes|no
//   CHROME_PID_COUNT=N             (CHROME_RUNNING=yes일 때만)

"use strict";

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const readline = require("readline");

// ---------------------------------------------------------------------------
// 파라미터 파싱
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = { dryRun: false, yes: false, detectOnly: false, reset: false };
  let profile = "Default";
  // --profile을 명시적으로 전달했는지 여부: 기본값 "Default"는 「전달하지 않음」과 「Default를 전달함」을 구분할 수 없으며,
  // 이 두 경우는 "CDP 준비 완료" 분기에서 의미가 다름(재사용 vs 지정 프로필로 재구축)
  let profileExplicit = false;
  let port = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--dry-run": flags.dryRun = true; break;
      case "--yes": case "-y": flags.yes = true; break;
      case "--detect-only": flags.detectOnly = true; break;
      case "--reset": flags.reset = true; break;
      case "--profile":
        profile = argv[++i];
        if (!profile) {
          console.error("❌ --profile은 인수가 필요합니다(예: --profile \"Profile 1\")");
          process.exit(1);
        }
        profileExplicit = true;
        break;
      default:
        if (/^\d+$/.test(a)) {
          port = parseInt(a, 10);
        } else if (a.startsWith("--")) {
          console.error(`⚠️  알 수 없는 인수: ${a}`);
        } else {
          console.error(`⚠️  인수 무시: ${a}`);
        }
    }
  }

  if (port === null) port = 9222;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`❌ 포트가 잘못되었습니다: ${port}. 1-65535 범위의 정수여야 합니다.`);
    process.exit(1);
  }

  return { flags, profile, profileExplicit, port };
}

const ARGS = parseArgs(process.argv.slice(2));
const CDP_PORT = ARGS.port;
const PLATFORM = os.platform();

// ---------------------------------------------------------------------------
// 플랫폼 설정 매핑
// ---------------------------------------------------------------------------

const PLATFORM_CONFIG = {
  darwin: {
    chromePaths: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ],
    profileDir: path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Google",
      "Chrome"
    ),
    findChrome() {
      for (const p of this.chromePaths) if (fs.existsSync(p)) return p;
      return null;
    },
    listChromePids() {
      try {
        const out = execSync("pgrep -x 'Google Chrome'", { encoding: "utf-8" }).trim();
        return out.split("\n").map(Number).filter((n) => n > 0);
      } catch { return []; }
    },
    killChrome() {
      try { execSync("pkill -9 -x 'Google Chrome'", { stdio: "ignore" }); } catch {}
    },
  },
  win32: {
    chromePaths: [
      path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    ],
    profileDir: path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "Google", "Chrome", "User Data"
    ),
    findChrome() {
      for (const p of this.chromePaths) if (p && fs.existsSync(p)) return p;
      return null;
    },
    listChromePids() {
      try {
        const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH /FO CSV', { encoding: "utf-8" }).trim();
        return out.split("\n").map((line) => {
          const m = line.match(/"chrome.exe","(\d+)"/i);
          return m ? parseInt(m[1], 10) : 0;
        }).filter((n) => n > 0);
      } catch { return []; }
    },
    killChrome() {
      try { execSync("taskkill /F /IM chrome.exe", { stdio: "ignore" }); } catch {}
    },
  },
  linux: {
    chromePaths: [
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/opt/google/chrome/google-chrome",
    ],
    profileDir: path.join(os.homedir(), ".config", "google-chrome"),
    findChrome() {
      for (const p of this.chromePaths) if (fs.existsSync(p)) return p;
      return null;
    },
    listChromePids() {
      // 일반적인 Chrome 프로세스 이름 덮어쓰기
      const patterns = ["google-chrome-stable", "google-chrome", "chrome"];
      const pids = new Set();
      for (const pat of patterns) {
        try {
          const out = execSync(`pgrep -x ${pat}`, { encoding: "utf-8" }).trim();
          out.split("\n").map(Number).filter((n) => n > 0).forEach((n) => pids.add(n));
        } catch {}
      }
      return [...pids];
    },
    killChrome() {
      for (const pat of ["google-chrome-stable", "google-chrome", "chrome"]) {
        try { execSync(`pkill -9 -x ${pat}`, { stdio: "ignore" }); } catch {}
      }
    },
  },
};

// ---------------------------------------------------------------------------
// 유틸리티 함수
// ---------------------------------------------------------------------------

function log(msg) { console.log(msg); }
function warn(msg) { console.warn("⚠️  " + msg); }
function ok(msg) { console.log("✅ " + msg); }
function err(msg) { console.error("❌ " + msg); }

function getConfig() {
  const config = PLATFORM_CONFIG[PLATFORM];
  if (!config) {
    err(`지원하지 않는 플랫폼: ${PLATFORM}. darwin/win32/linux를 지원합니다.`);
    process.exit(1);
  }
  return config;
}

/** ms 밀리초 동안 동기적으로 대기합니다 (setTimeout / 시스템 sleep에 의존하지 않음) */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * HTTP GET으로 CDP 엔드포인트를 확인합니다. 4xx/5xx는 거부하고, 응답 본문을 자동으로 drain합니다.
 * agent:false는 필수입니다——Node 19+ 이상에서 http.globalAgent는 기본적으로 keepAlive가 활성화되어 있어, 조사에 사용된 socket이
 * 연결 풀에 남아 있습니다. 그런데 이 스크립트는 sleepSync로 이벤트 루프를 완전히 차단합니다 (프로세스 종료/시작 대기 중). 이 기간에 서버가 5초 유휴 시간제한으로 연결을
 * 닫으므로, 클라이언트가 FIN을 처리할 시간이 없습니다. 다음 조사에서 이 죽은 socket을 재사용하면 ECONNRESET이 발생하고, 그러면 "포트가 살아 있다"
 * 잘못 판단되어 "응답 없음"으로 오인될 수 있습니다. 이러한 거짓 음성은 아래의 포트 게이트를 직접 우회하므로 매번 새로운 연결을 통해 확인해야 합니다.
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000, agent: false }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
        } else {
          resolve(body);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function probeCDP(port) {
  try {
    const version = await httpGet(`http://127.0.0.1:${port}/json/version`);
    return version;
  } catch {
    return null;
  }
}

/** 원시 TCP 프로브: HTTP 500/malformed JSON도 포트가 점유 중임을 나타내므로 이를 근거로 profile 파괴 작업을 해제할 수 없습니다. */
function probeTcp(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const done = (listening) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

/**
 * /json/version 응답에서 「인스턴스」를 구별할 수 있는 식별자를 추출합니다.
 * Chrome은 매번 시작할 때마다 새로운 browser GUID(webSocketDebuggerUrl의 끝 부분)를 생성하므로 이 용도에 가장 적합합니다.
 * 추출할 수 없으면 null을 반환합니다. 호출자는 반드시 null을 「비교 불가능」으로 처리해야 하며, 절대 「동일」이나 「다름」으로 취급하면 안 됩니다.
 */
function cdpIdentity(version) {
  if (!version) return null;
  try {
    const obj = JSON.parse(version);
    if (obj.webSocketDebuggerUrl) return String(obj.webSocketDebuggerUrl);
  } catch {}
  return null;
}

/**
 * TCP 포트가 정말 더 이상 리스닝하지 않을 때까지 대기; true = 포트가 비어있음, false = 타임아웃 후에도 여전히 누군가 리스닝 중.
 * probeCDP를 사용할 수 없음: HTTP 500/잘못된 응답은 "건강하지 않은 CDP"만 나타낼 뿐 "포트 유휴"를 나타내지 않음.
 */
async function waitForPortFree(port, maxMs = 8000, stepMs = 500, needQuiet = 2) {
  const start = Date.now();
  let quiet = 0;
  for (;;) {
    if (await probeTcp(port)) {
      quiet = 0;
    } else if (++quiet >= needQuiet) {
      return true;
    }
    if (Date.now() - start >= maxMs) return false;
    sleepSync(stepMs);
  }
}

/** 포트를 사용 중인 프로세스를 찾으려고 노력; 진단용으로만 사용 (찾을 수 없으면 null 반환, 판정에 영향 없음) */
function describePortHolder(port) {
  const cmd =
    PLATFORM === "win32"
      ? `netstat -ano -p tcp | findstr LISTENING | findstr :${port}`
      : `lsof -nP -iTCP:${port} -sTCP:LISTEN`;
  try {
    const out = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const line = out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^COMMAND\s/.test(l))[0];
    return line ? line.slice(0, 200) : null;
  } catch {
    return null;
  }
}

/** 읽기 전용 쿼리 명령을 실행하고 stdout을 획득; 명령이 없거나 0이 아닌 종료 또는 타임아웃이 발생하면 모두 null 반환 */
function queryStdout(cmd) {
  try {
    const out = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return typeof out === "string" ? out : String(out);
  } catch {
    return null;
  }
}

/**
 * 지정된 포트를 LISTEN 중인 프로세스의 pid를 나열.
 * CDP 응답을 이미 감지한 후에만 호출합니다——그 순간 포트는 반드시 수신 대기 중이므로, 빈 결과는 도구 누락이나 표시 불가만 가능하며, 모두 null을 반환하여 「판단 불가」를 나타내며, 절대 「미사용」으로 처리해서는 안 됩니다.
* 도구가 없거나 보이지 않으면 null을 반환하여 「판단 불가」를 나타내며, 절대 「사용 중이 아님」으로 간주되어서는 안 됩니다.
 */
function listPortListenerPids(port) {
  const queries =
    PLATFORM === "win32"
      ? [
          {
            kind: "pid",
            cmd: `powershell -NoProfile -NonInteractive -Command "Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
          },
          {
            kind: "pid",
            cmd: `pwsh -NoProfile -NonInteractive -Command "Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
          },
          { kind: "netstat", cmd: "netstat -ano -p tcp" },
        ]
      : [
          { kind: "pid", cmd: `lsof -nP -iTCP:${port} -sTCP:LISTEN -t` },
          // Linux에서 lsof는 보통 사전 설치되지 않으므로, ss / fuser로 폴백합니다
          { kind: "ss", cmd: `ss -H -ltnp "sport = :${port}"` },
          { kind: "pid", cmd: `fuser -n tcp ${port}` },
        ];
  for (const { kind, cmd } of queries) {
    const out = queryStdout(cmd);
    if (out === null) continue;
    const pids = new Set();
    if (kind === "netstat") {
      // 로컬화된 상태 텍스트는 읽지 않습니다. 수신 대기 행의 안정적인 형식은 TCP + 로컬 대상 포트 +
      // foreign port 0 + 마지막 열 Owning PID이며, 확립된 연결은 foreign port가 0이 아닙니다.
      for (const line of out.split("\n")) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 5 || fields[0].toUpperCase() !== "TCP") continue;
        const localPort = Number((fields[1].match(/:(\d+)$/) || [])[1]);
        const foreignPort = Number((fields[2].match(/:(\d+)$/) || [])[1]);
        const pid = Number(fields[fields.length - 1]);
        if (localPort === port && foreignPort === 0 && Number.isInteger(pid) && pid > 0) {
          pids.add(pid);
        }
      }
    } else if (kind === "ss") {
      for (const m of out.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]));
    } else {
      // PowerShell OwningProcess / lsof -t / fuser：숫자만 있는 pid
      for (const tok of out.split(/\s+/)) {
        const n = Number(tok);
        if (Number.isInteger(n) && n > 0) pids.add(n);
      }
    }
    const list = [...pids].filter((n) => n > 0);
    if (list.length > 0) return list;
  }
  return null;
}

/** 전체 시스템 pid -> ppid 테이블; 찾을 수 없으면 null 반환（판단할 수 없음, 「부모 프로세스 없음」이 아님） */
function listProcessParents() {
  const cmds =
    PLATFORM === "win32"
      ? [
          // wmic는 최신 Windows에서 제거됨, PowerShell CIM으로 대체（5.1 / 7 모두 시도）
          "wmic process get ProcessId,ParentProcessId /format:csv",
          'powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation"',
          'pwsh -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation"',
        ]
      : ["ps -A -o pid=,ppid="]; // macOS(BSD)와 Linux(procps) 모두 지원
  for (const cmd of cmds) {
    const out = queryStdout(cmd);
    if (out === null) continue;
    const map = new Map();
    if (PLATFORM === "win32") {
      // 두 출처의 열 순서가 다름（wmic는 알파벳순, PowerShell은 Select 순서），테이블 헤더로 위치 파악
      const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const head = lines.findIndex(
        (l) => /processid/i.test(l) && /parentprocessid/i.test(l)
      );
      if (head < 0) continue;
      const cols = lines[head]
        .split(",")
        .map((c) => c.replace(/"/g, "").trim().toLowerCase());
      const pidCol = cols.indexOf("processid");
      const ppidCol = cols.indexOf("parentprocessid");
      if (pidCol < 0 || ppidCol < 0) continue;
      for (const line of lines.slice(head + 1)) {
        const cells = line.split(",").map((c) => c.replace(/"/g, "").trim());
        const pid = Number(cells[pidCol]);
        const ppid = Number(cells[ppidCol]);
        if (pid > 0 && Number.isInteger(ppid)) map.set(pid, ppid);
      }
    } else {
      for (const line of out.split("\n")) {
        const m = line.trim().match(/^(\d+)\s+(\d+)$/);
        if (m) map.set(Number(m[1]), Number(m[2]));
      }
    }
    if (map.size > 0) return map;
  }
  return null;
}

/** 특정 pid의 전체 명령줄을 가져옴; 가져올 수 없으면 null 반환 */
function processCommandLine(pid) {
  const cmds =
    PLATFORM === "win32"
      ? [
          `wmic process where "ProcessId=${pid}" get CommandLine /value`,
          `powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
          `pwsh -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
        ]
      : [`ps -ww -o command= -p ${pid}`]; // -ww: 터미널 너비로 자르지 않음, Chrome 명령줄이 매우 김
  for (const cmd of cmds) {
    const out = queryStdout(cmd);
    if (out === null) continue;
    const text =
      PLATFORM === "win32" ? out.replace(/^\s*CommandLine=/im, "") : out;
    const trimmed = text.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** pid가 rootPid의 프로세스 트리에 있는지 확인（rootPid 자신 포함）; ppid를 따라 위로 이동 */
function isInProcessTree(pid, rootPid, parents) {
  let cur = pid;
  for (let hops = 0; hops < 64; hops++) {
    if (cur === rootPid) return true;
    if (!Number.isInteger(cur) || cur <= 1) return false;
    const next = parents.get(cur);
    if (next === undefined || next === cur) return false;
    cur = next;
  }
  return false;
}

function commandLineHasArgument(commandLine, argument) {
  const escaped = argument.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\s"'])${escaped}(?=$|[\\s"'])`).test(commandLine);
}

/**
 * 포트상의 응답 엔드포인트가 이번 spawn으로 생성된 프로세스에 정말 속하는지 증명. 두 가지 조건이 모두 성립해야 함:
 *   ① 포트의 모든 LISTEN 소유자가 rootPid 프로세스 트리 내에 있음—Chrome은 별도의 browser 프로세스를 시작하므로,
 *      macOS에서 시작된 바이너리는 re-exec될 수 있으므로 직계 pid가 아닌 전체 프로세스 트리를 비교합니다. 반대로
 *      자식 프로세스가 수신 대기 fd를 상속받으므로 lsof에 나타나기 때문에 "하나라도 있으면"이 아닌 "모두 트리에 있어야" 합니다.
 *   ② 트리에 이번 시작의 --remote-debugging-port=<port>를 가진 소유자가 정확히 하나 있습니다. 이는 응답하는 것이
 *      우리가 구성한 인스턴스이며, 트리의 다른 프로세스가 우연히 이 포트를 차지한 것이 아님을 증명합니다.
 * 어느 단계에서든 확인할 수 없으면 unverifiable을 반환합니다: 확인할 수 없음을 증명함으로 처리하기보다는 명시적으로 실패하는 것이 낫습니다.
 */
function verifyPortOwnedByLaunch(port, rootPid) {
  const fail = (code, lines) => ({ ok: false, code, lines: [`${code}: ${lines[0]}`, ...lines.slice(1)] });
  const unverifiable = (why) =>
    fail("CDP_OWNER_UNVERIFIABLE", [
      `포트 ${port}의 LISTEN 소유자 확인 불가(${why})`,
      "성공으로 보고 거절: 이 엔드포인트가 현재 시작에 속한다는 것을 증명할 수 없으면 이후 수집에 전달할 수 없습니다.",
      PLATFORM === "win32"
        ? "이 머신에서는 netstat와 wmic 또는 PowerShell이 필요하여 프로세스 소유자를 확인할 수 있습니다."
        : "이 머신에서는 lsof(또는 ss / fuser)와 ps가 필요하여 프로세스 소유자를 확인할 수 있습니다.",
      `해결 방법: 위의 도구를 설치한 후 다시 실행하거나 포트 ${port}에서 실행 중인 것이 방금 시작한 Chrome인지 수동으로 확인하세요.`,
    ]);

  if (!rootPid) return unverifiable("spawn에서 pid를 얻지 못함");
  const listeners = listPortListenerPids(port);
  if (!listeners) return unverifiable("해당 포트를 수신 중인 프로세스를 찾을 수 없음");

  // 소유자가 spawn으로 생성된 pid일 때는 프로세스 테이블을 읽을 필요가 없음 — 가장 일반적인 형태 (Chrome의 browser
  // 프로세스가 우리가 시작한 것)이므로 wmic/ps 이외의 어떤 것도 필요 없음
  let outside = listeners.filter((pid) => pid !== rootPid);
  if (outside.length > 0) {
    const parents = listProcessParents();
    if (!parents) return unverifiable("프로세스 테이블(pid/ppid)을 읽을 수 없음");
    outside = outside.filter((pid) => !isInProcessTree(pid, rootPid, parents));
  }
  if (outside.length > 0) {
    const holder = describePortHolder(port);
    return fail("CDP_PORT_NOT_OURS", [
      `포트 ${port}의 LISTEN 소유자(pid ${outside.join(", ")})가 이번 시작의 프로세스 트리(루트 pid ${rootPid})에 없습니다.`,
      "성공으로 거짓 보고 거부: 포트가 다른 프로세스에 의해 점유되어 있으며, 계속 사용하면 수집할 때마다 다른 세션이 읽힙니다.",
      ...(holder ? [`점유자: ${holder}`] : []),
      `처리 방법: 포트 ${port}를 점유한 프로세스를 종료한 후 다시 실행하거나 다른 포트를 사용하세요.`,
    ]);
  }

  const marker = `--remote-debugging-port=${port}`;
  let sawCommandLine = false;
  for (const pid of listeners) {
    const cmdline = processCommandLine(pid);
    if (cmdline === null) continue;
    sawCommandLine = true;
    if (commandLineHasArgument(cmdline, marker)) return { ok: true, pids: listeners, pid };
  }
  if (!sawCommandLine) return unverifiable("소유자의 명령줄을 읽을 수 없습니다");
  return fail("CDP_OWNER_NOT_LAUNCHED_INSTANCE", [
    `포트 ${port}의 LISTEN 점유자(pid ${listeners.join(", ")})가 이번 시작의 프로세스 트리에 있지만, ${marker}를 가진 것이 없습니다.`,
    "성공으로 보고하지 않음: 응답한 것이 이번 시작한 Chrome이 아니라 같은 트리의 다른 프로세스가 이 포트를 점유하고 있습니다.",
    `해결 방법: ${port}가 다른 프로세스에 의해 점유되지 않았는지 확인하거나 다른 포트로 다시 실행하세요.`,
  ]);
}

/** spawn으로 시작된 Chrome이 여전히 실행 중인지 확인(exitCode/signalCode 우선, 폴백으로 kill(pid,0) 사용) */
function isChildAlive(child) {
  if (!child || !child.pid) return false;
  if (child.exitCode !== null || child.signalCode !== null) return false;
  try {
    process.kill(child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 이번 spawn으로 시작된 프로세스 트리만 정리하며, 전역 killChrome을 호출하여 사용자의 다른 창을 함께 종료하지 않습니다. */
function terminateLaunchTree(rootPid) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return;
  if (PLATFORM === "win32") {
    try {
      execSync(`taskkill /F /T /PID ${rootPid}`, { stdio: "ignore" });
    } catch {}
    return;
  }

  const parents = listProcessParents();
  const tree = [];
  if (parents) {
    for (const pid of parents.keys()) {
      if (pid !== process.pid && isInProcessTree(pid, rootPid, parents)) tree.push(pid);
    }
  }
  if (!tree.includes(rootPid)) tree.push(rootPid);

  // 하위 프로세스를 먼저 중지한 후 launcher를 마지막에 중지하여, 부모 프로세스 종료 후 detached listener가 재할당되어 소유권을 잃지 않도록 합니다.
  const depth = (pid) => {
    let current = pid;
    for (let hops = 0; hops < 64; hops++) {
      if (current === rootPid) return hops;
      const next = parents?.get(current);
      if (!next || next === current) return -1;
      current = next;
    }
    return -1;
  };
  tree.sort((left, right) => depth(right) - depth(left));
  for (const pid of tree) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  sleepSync(200);
  for (const pid of tree) {
    if (!isPidAlive(pid)) continue;
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
}

/** 파일을 복사합니다(ENOENT는 무시하고, 다른 오류는 사용자가 확인할 수 있도록 한 번 경고합니다) */
function copyFileSafe(src, dest) {
  try {
    fs.copyFileSync(src, dest);
    return true;
  } catch (e) {
    if (e.code !== "ENOENT") {
      warn(`복사 실패: ${src} -> ${dest} (${e.code || e.message})`);
    }
    return false;
  }
}

/** 디렉터리를 재귀적으로 복사합니다 */
function copyDirRecursive(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true });
}

/** 디렉터리를 재귀적으로 삭제합니다 */
function rmDirSafe(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * 로그인 상태 관련 파일을 새로고침합니다(debugProfile에 이미 존재하는 "증분" 경로에서 사용).
 * Chrome에 현재 존재할 수 있는 Default/Cookies와 Default/Network/Cookies를 동시에 시도합니다.
 * -journal / -wal / -shm 부가 파일 및 Google 계정 로그인 데이터를 포함합니다.
 */
function refreshAuthFiles(srcDefault, destDefault) {
  const targets = [
    "Cookies", "Cookies-journal",
    "Login Data", "Login Data-journal",
    "Login Data For Account", "Login Data For Account-journal",
    "Web Data", "Web Data-journal",
    path.join("Network", "Cookies"),
    path.join("Network", "Cookies-journal"),
  ];
  let copied = 0;
  for (const rel of targets) {
    const src = path.join(srcDefault, rel);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(destDefault, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (copyFileSafe(src, dest)) copied++;
  }
  return copied;
}

/** Chrome singleton 잠금을 정리하여 이전 충돌 후 다음 시작 실패를 방지합니다 */
function clearSingletonLocks(profileDir) {
  const names = ["SingletonLock", "SingletonCookie", "SingletonSocket"];
  for (const n of names) {
    try { fs.unlinkSync(path.join(profileDir, n)); } catch {}
  }
}

/** Chrome PID 목록이 비워질 때까지 대기합니다 */
function waitForChromeExit(config, maxMs = 8000, stepMs = 500) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (config.listChromePids().length === 0) return true;
    sleepSync(stepMs);
  }
  return false;
}

/** TTY 대화형 질문 */
function promptYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test((answer || "").trim()));
    });
  });
}

// ---------------------------------------------------------------------------
// detect-only 모드
// ---------------------------------------------------------------------------

async function runDetectOnly(config) {
  const version = await probeCDP(CDP_PORT);
  if (version) {
    log("CDP_STATUS=ready");
    log(`CDP_URL=http://127.0.0.1:${CDP_PORT}/json/version`);
    // JSON에서 브라우저 버전 추출 시도 (용오류 처리)
    try {
      const obj = JSON.parse(version);
      if (obj.Browser) log(`BROWSER=${obj.Browser}`);
    } catch {}
    process.exit(0);
  }
  log("CDP_STATUS=needs-setup");
  const pids = config.listChromePids();
  if (pids.length > 0) {
    log("CHROME_RUNNING=yes");
    log(`CHROME_PID_COUNT=${pids.length}`);
  } else {
    log("CHROME_RUNNING=no");
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 동의 프로세스: true 반환하면 계속, false는 사용자 거부
// ---------------------------------------------------------------------------

async function ensureConsentToKill(pids) {
  if (pids.length === 0) return true;
  if (ARGS.flags.yes) return true;

  // 비 TTY: 거부 시 자동 종료, 호출자(Claude / 상위 스크립트)에게 명확한 신호 전달
  if (!process.stdin.isTTY) {
    err(`NEEDS_CONSENT: ${pids.length} running Chrome process(es) will be killed.`);
    err(`Pass --yes to confirm (after asking the user), or stop Chrome manually first.`);
    process.exit(3);
  }

  // TTY: 대화형 프롬프트
  warn(`${pids.length}개의 실행 중인 Chrome 프로세스가 감지되었습니다.`);
  warn("계속하면 이들이 종료되며, 일반 Chrome에서 저장하지 않은 작업이 손실될 수 있습니다.");
  return promptYesNo("계속하시겠습니까? [y/N] ");
}

// ---------------------------------------------------------------------------
// 메인 프로세스
// ---------------------------------------------------------------------------

async function main() {
  const config = getConfig();
  const debugProfile = path.join(os.homedir(), "chrome-debug-profile");

  // 1) Chrome 실행 파일 경로 감지 (detect-only도 profileDir 필요)
  const chromePath = config.findChrome();

  // detect-only: 어떤 상태도 수정하지 않음
  if (ARGS.flags.detectOnly) {
    if (!chromePath) {
      log("CDP_STATUS=needs-setup");
      log("CHROME_INSTALLED=no");
      process.exit(0);
    }
    return runDetectOnly(config);
  }

  log("=== CDP Chrome 환경 준비 ===");
  log(`플랫폼: ${PLATFORM} | CDP 포트: ${CDP_PORT} | profile: ${ARGS.profile}`);

  if (!chromePath) {
    err("Google Chrome을 찾을 수 없습니다. 설치되어 있는지 확인하세요.");
    err(`검색 경로: ${JSON.stringify(config.chromePaths, null, 2)}`);
    process.exit(1);
  }
  log(`Chrome 경로: ${chromePath}`);

  // 2) dry-run: 모든 부작용(기존 CDP 재사용 포함)보다 먼저 계획을 출력하여 사용자가 실제 실행 시 단계를 볼 수 있게 함
  const defaultProfile = path.join(config.profileDir, ARGS.profile);
  const hasProfile = fs.existsSync(defaultProfile);

  if (ARGS.flags.dryRun) {
    const cdpAlive = !!(await probeCDP(CDP_PORT));
    const tcpOccupied = await probeTcp(CDP_PORT);
    // --reset / 명시적 --profile은 재사용을 건너뜀(아래 3단계 참조), dry-run은 실제 상황을 보여줘야 함
    const willReuse = cdpAlive && !ARGS.flags.reset && !ARGS.profileExplicit;
    const cdpNote = !tcpOccupied
      ? "수신 대기 중 아님"
      : !cdpAlive
        ? "TCP 리스닝 중이지만 정상 CDP 아님(실제 실행 시 profile 전환 전에 하드 실패함)"
      : willReuse
        ? "준비됨(실제 실행 시 직접 재사용함)"
        : "준비됨(하지만 --reset/--profile이 전달됨, 실제 실행 시 재구성되어 재사용하지 않음)";
    log(`Chrome profile: ${defaultProfile} (${hasProfile ? "존재" : "없음"})`);
    log(`CDP 포트 ${CDP_PORT}: ${cdpNote}`);
    const runningPids = config.listChromePids();
    log(`${runningPids.length}개의 Chrome 프로세스 감지됨`);
    log("\n--- dry-run 모드: 작업만 출력하고 실행하지 않음 ---");
    if (willReuse) {
      log("0. CDP 준비 완료, 실제 실행 시 기존 프로세스를 그대로 재사용하고 종료 코드 0 반환 (아래 단계는 참고용)");
    } else if (cdpAlive) {
      log("0. CDP 준비 완료이지만 --reset/--profile 옵션 전달됨: 실제 실행 시 재사용하지 않고 다음 단계에 따라 재구성");
    }
    // 단계 번호는 실제 실행 순서에 따라 동적으로 번호 매김: 먼저 프로세스 종료, 포트 확인, 그 다음 profile 디렉터리 처리
    let stepNo = 0;
    const step = (msg) => log(`${++stepNo}. ${msg}`);
    if (runningPids.length > 0) {
      step(`${ARGS.flags.yes ? "（이미 동의함）" : "동의 후 "}${runningPids.length}개의 Chrome 프로세스 종료`);
    } else {
      step("실행 중인 Chrome 프로세스 없음, 종료할 필요 없음");
    }
    step(`TCP로 포트 ${CDP_PORT} 해제 확인（모든 리스닝이 남아 있으면 중단: 프로필 삭제 안 함, 시작 안 함）`);
    if (ARGS.flags.reset) step(`${debugProfile} 삭제`);
    if (hasProfile) {
      step(`프로필 복사: ${defaultProfile} -> ${debugProfile}/Default`);
    } else {
      step("⚠️ 사용자 프로필이 없어 빈 프로필로 시작합니다");
    }
    step("SingletonLock / SingletonCookie / SingletonSocket 정리");
    step("Chrome 시작 (--remote-allow-origins=*, --no-first-run 등 포함)");
    step(
      `http://127.0.0.1:${CDP_PORT}/json/version 으로 이번 시작의 인스턴스 검증` +
        "(신원이 확인되고 변경됨 + 프로세스 살아있음 + 포트의 LISTEN 소유자가 이 프로세스 트리 내에 있음)"
    );
    ok("dry-run 완료되었습니다.");
    process.exit(0);
  }

  // 3) CDP가 준비되어 있으면 → 재사용하고 바로 종료합니다.
  //    하지만 --reset / 명시적 --profile의 의미는 "debug profile 재구성"입니다: 로그인 상태가 만료되었을 때 문서에서는
  //    사용자가 --reset을 실행하도록 안내하고, 그 시점에 CDP는 정확히 활성 상태입니다(만료는 이 세션에서 발견됨).
  //    만약 그대로 재사용하면 이 두 매개변수는 조용히 무시되고, exit 0으로 "성공"이라고 보고합니다. 따라서 이 두 경우는 재사용하지 않고 계속 진행하여 재구성합니다.
  const existing = await probeCDP(CDP_PORT);
  const portWasListening = await probeTcp(CDP_PORT);
  if (existing) {
    if (!ARGS.flags.reset && !ARGS.profileExplicit) {
      ok("CDP가 준비되었습니다. 기존 Chrome을 재사용합니다.");
      log(existing.split("\n").slice(0, 5).join("\n"));
      process.exit(0);
    }
    const requested = ARGS.flags.reset ? "--reset" : `--profile ${ARGS.profile}`;
    warn(`CDP 포트 ${CDP_PORT}이(가) 이미 수신 중이지만 ${requested}을(를) 전달했습니다. 재사용하지 않고 기존 Chrome을 종료한 후 debug profile을 다시 구축합니다.`);
  }
  // 재구축 전 인스턴스의 식별 정보: 10단계에서 「새로 시작한 인스턴스가 응답했다」는 것을 증명하기 위해 필요하며, 단순히 「누군가 응답했다」가 아닙니다.
  const staleIdentity = cdpIdentity(existing);

  if (!hasProfile) {
    err(`Chrome profile을 찾을 수 없습니다: ${defaultProfile}`);
    err("Google Chrome이 설치되어 있고 최소한 한 번은 사용했는지 확인하거나, --profile <name>으로 다른 profile을 지정하세요.");
    process.exit(1);
  }

  // 4) 동의 절차: Chrome 프로세스를 종료해야 할 경우 먼저 동의를 구합니다
  const runningPids = config.listChromePids();
  const consented = await ensureConsentToKill(runningPids);
  if (!consented) {
    err("사용자가 거부했으므로 중단되었습니다.");
    process.exit(2);
  }

  // 5) 기존 Chrome 프로세스 종료, 종료 대기
  if (runningPids.length > 0) {
    log(`${runningPids.length}개의 Chrome 프로세스를 중지 중입니다...`);
    config.killChrome();
    if (!waitForChromeExit(config, 6000)) {
      warn("첫 번째 kill 후에도 Chrome 프로세스가 남아 있으므로 다시 시도합니다...");
      config.killChrome();
      waitForChromeExit(config, 4000);
    }
    const remain = config.listChromePids();
    if (remain.length > 0) {
      err(`여전히 ${remain.length}개의 Chrome 프로세스가 종료되지 않았습니다. 중단했습니다.`);
      err("debug profile을 삭제하지 않았고, 수정하지 않았으며, 새 Chrome을 시작하지 않았습니다. — 상태는 원래대로 유지됩니다.");
      process.exit(1);
    } else {
      ok("Chrome이 종료되었습니다.");
    }
  }

  // 5.5) 하드 게이트: 포트가 정말 비워져야만 profile 디렉터리를 건드리고 새 인스턴스를 시작할 수 있습니다.
  //      순서는 의도적입니다. — 게이트는 profile 삭제 전에 있습니다. 기존 인스턴스가 살아있는 채로 진행하면 최악의 결과에 부딪힙니다:
  //      먼저 실행 중인 Chrome의 프로필을 삭제하면 (그 자체로 파괴적), 새 프로세스는 포트가 점유되어 시작할 수 없고,
  //      10단계의 probeCDP가 정확히 이전 엔드포인트로부터 응답을 받으면, exit 0이 「재구성 성공」을 보고합니다——호출자는 새 브라우저를 받았다고 생각하지만
  //      이후 매번 수집할 때 읽는 것은 모두 이전 세션/다른 사람의 세션입니다. 여기서는 반드시 강제로 실패해야 합니다.
  //      /json/version이 정상인지 여부와 관계없이 실행합니다: HTTP 500도 포트를 점유하고 있을 수 있습니다.
  // 프로세스를 종료한 후에만 유예 기간을 줄 가치가 있습니다; 식별된 Chrome이 없을 때, 점유자는 자동으로 종료되지 않으므로 빠르게 확인한 후 실패합니다.
  const graceMs = runningPids.length > 0 ? 8000 : 1000;
  if (!(await waitForPortFree(CDP_PORT, graceMs))) {
    const remain = config.listChromePids();
    err(
      existing
        ? `CDP 포트 ${CDP_PORT}의 기존 인스턴스가 여전히 응답하고 있어 중단했습니다.`
        : `CDP 포트 ${CDP_PORT}이(가) 여전히 사용 중이며 해제되지 않아 중단했습니다.`
    );
    if (remain.length > 0) {
      err(`원인: ${remain.length}개의 Chrome 프로세스가 종료되지 않았습니다(kill 실패, 권한 부족이거나 프로세스가 응답 없을 수 있음).`);
    } else if (runningPids.length === 0) {
      err("원인: 포트가 식별할 수 없는 프로세스에 의해 점유 중입니다. Chrome 프로세스를 찾지 못해 종료할 수 없습니다.");
    } else {
      err("원인: Chrome 프로세스는 종료되었지만 다른 프로세스가 여전히 이 포트를 점유하고 있습니다.");
    }
    const holder = describePortHolder(CDP_PORT);
    if (holder) err(`점유자: ${holder}`);
    err("debug profile이 삭제되지 않았고, 변경되지 않았으며, 새 Chrome도 시작되지 않았습니다——상태가 그대로 유지됩니다.");
    err(`해결 방법: ${CDP_PORT}를 점유하는 프로세스를 수동으로 종료한 후 다시 실행하거나, 다른 포트를 사용하세요(node setup-cdp-chrome.js <다른 포트> ...)。`);
    process.exit(1);
  }
  if (portWasListening) {
    ok(`CDP 포트 ${CDP_PORT}가 해제되었습니다.`);
  }

  // 6) --reset: debug profile 초기화
  if (ARGS.flags.reset) {
    log(`debug profile을 삭제 중입니다: ${debugProfile}`);
    rmDirSafe(debugProfile);
  }

  // 7) profile 복사 / 새로고침 (이 시점에 Chrome이 종료되어 SQLite가 일관성 있음)
  const debugDefault = path.join(debugProfile, "Default");
  if (!fs.existsSync(debugDefault)) {
    log("Chrome profile을 debug 디렉터리로 복사 중...");
    fs.mkdirSync(debugProfile, { recursive: true });
    try { fs.chmodSync(debugProfile, 0o700); } catch {}
    copyDirRecursive(defaultProfile, debugDefault);
    ok(`Profile이 다음 위치로 복사되었습니다: ${debugProfile}`);
  } else {
    log("debug profile이 이미 존재하여 로그인 상태 관련 파일을 새로고침 중...");
    try { fs.chmodSync(debugProfile, 0o700); } catch {}
    const n = refreshAuthFiles(defaultProfile, debugDefault);
    ok(`${n}개의 로그인 상태 파일을 새로고침했습니다`);
  }

  // 8) singleton 잠금 정리
  clearSingletonLocks(debugProfile);

  // 9) CDP 모드로 Chrome 시작
  log(`CDP 모드로 Chrome을 시작 중입니다(포트 ${CDP_PORT})...`);
  const chromeArgs = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${debugProfile}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=ChromeWhatsNewUI",
  ];
  const child = spawn(chromePath, chromeArgs, { detached: true, stdio: "ignore" });
  const childPid = child.pid;
  let spawnError = null;
  child.on("error", (e) => { spawnError = e; });
  child.unref();

  /** 시작 후 검증 실패: 자신이 방금 시작한 프로세스만 정리합니다(포트의 그것은 우리 것이 아니므로, 다른 사람의 Chrome을 연루시켜 종료하면 안 됨) */
  function abortAfterLaunch(reasons) {
    for (const line of reasons) err(line);
    err("시작된 Chrome 프로세스를 정리 중입니다...");
    terminateLaunchTree(childPid);
    process.exit(1);
  }

  // 10) 시작을 기다리고 검증합니다. 응답이 있다고 해서 성공이 아닙니다. 종료되지 않은 이전 인스턴스이거나 다른 프로세스가 포트를 차지하고 있을 수 있습니다.
  //     네 가지 조건을 모두 만족해야 합니다:
  //     ① 새 엔드포인트의 browser GUID를 얻을 수 있습니다(못 얻으면 = 비교할 수 없으므로 약정상 같거나 다르다고 판단할 수 없음);
  //     ② 이 GUID가 재구성 전과 다릅니다(5.5단계를 함께 확인하면 이미 이전 엔드포인트가 소멸했음이 확인됨);
  //     ③ 방금 spawn한 프로세스가 살아있음 (프로세스가 죽었다면, 포트에 응답하는 것은 확실히 이번 시작 인스턴스가 아님);
  //     ④ 포트의 LISTEN 점유자가 실제로 spawn된 프로세스 트리에 있으며, 이번
  //        --remote-debugging-port를 가지고 있음. 처음 세 조건은 간접 증거임 — 「이전 엔드포인트가 사라짐 + 신원이 바뀜 +
  //        launcher가 살아있음」이라고 해서 「포트가 그것 것」이라는 결론이 나오지 않으며, 오직 ④번 조건만이 포트와 프로세스를 실제로 연결함.
  log("Chrome 시작 대기 중...");
  let identityMisses = 0;
  for (let i = 1; i <= 15; i++) {
    sleepSync(2000);
    if (spawnError) {
      abortAfterLaunch([`Chrome 시작 실패: ${spawnError.message}`]);
    }
    const version = await probeCDP(CDP_PORT);
    if (version) {
      const identity = cdpIdentity(version);
      if (identity === null) {
        // 엔드포인트가 방금 시작되었을 때 이론상 먼저 HTTP 응답할 수 있으므로 두 번의 유예 기회를 줍니다. 그 이후에도 가져올 수 없으면 하드 실패 처리합니다.
        if (++identityMisses < 3) {
          log(`   포트는 응답하지만 인스턴스 ID를 가져올 수 없으므로 재시도 ${identityMisses}/3...`);
          continue;
        }
        abortAfterLaunch([
          `CDP_IDENTITY_UNVERIFIABLE: 포트 ${CDP_PORT}는 HTTP 응답하지만 /json/version에서 인스턴스 ID(webSocketDebuggerUrl)를 가져올 수 없습니다.`,
          "성공으로 보고하지 않음: 신원을 확인할 수 없으면 새로 시작된 인스턴스임을 증명할 수 없습니다. 계약상 동일하지도 다르지도 않은 것으로만 간주되므로 입증되지 않은 것으로만 처리할 수 있습니다.",
          `처리 방법: ${CDP_PORT}에서 실행 중인 것이 Chrome의 CDP 엔드포인트(다른 HTTP 서비스 아님)인지 확인하거나 다른 포트로 다시 실행하세요.`,
        ]);
      }
      if (staleIdentity && identity === staleIdentity) {
        abortAfterLaunch([
          `포트 ${CDP_PORT}에서 응답한 것이 재구성 전의 인스턴스(${identity})이며, 새로 시작한 Chrome이 아닙니다.`,
          "성공으로 보고하지 않음: 이 이후로 사용할 때 수집되는 모든 읽기는 이전 세션이 됩니다.",
        ]);
      }
      if (!isChildAlive(child)) {
        const holder = describePortHolder(CDP_PORT);
        abortAfterLaunch([
          `포트 ${CDP_PORT}에 CDP 응답이 있지만 방금 시작한 Chrome(pid ${childPid})이 이미 종료되었습니다.`,
          "성공으로 보고하지 않음: 이 엔드포인트는 이번 시작의 인스턴스에 속하지 않습니다.",
          ...(holder ? [`점유자: ${holder}`] : []),
          `처리 방법: ${CDP_PORT}가 다른 프로세스에 의해 점유되지 않았는지 확인하거나, 다른 포트로 다시 실행하세요.`,
        ]);
      }
      const owner = verifyPortOwnedByLaunch(CDP_PORT, childPid);
      if (!owner.ok) abortAfterLaunch(owner.lines);
      ok(`Chrome이 CDP 모드로 성공적으로 시작되었습니다(포트 ${CDP_PORT})`);
      log(version.split("\n").slice(0, 5).join("\n"));
      process.exit(0);
    }
    log(`   시도 ${i}/15...`);
  }

  // 11) 실패 정리: 방금 시작한 고아 Chrome 프로세스 종료
 err("30초 내에 Chrome CDP 환경을 시작하지 못했습니다.");
 err("방금 시작한 Chrome 프로세스를 정리 중입니다...");
  terminateLaunchTree(childPid);
 err("가능한 원인:");
 err("  - Chrome이 --remote-debugging-port를 지원하지 않음");
 err(`  - 포트 ${CDP_PORT}가 다른 프로세스에 의해 사용 중입니다`);
  err("  - debug profile 디렉터리가 손상되었습니다(--reset을 시도해보세요)");
  process.exit(1);
}

main().catch((e) => {
  err(`시작 실패: ${e.message}`);
  process.exit(1);
});
