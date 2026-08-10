---
name: browser-cdp
description: "Use this skill when you need to control a Chrome browser via CDP (Chrome DevTools Protocol) to reuse existing login sessions. Covers: launching Chrome in debug mode, opening URLs, waiting for page load, evaluating JavaScript, taking snapshots, and extracting auth tokens. Trigger phrases: browser automation, CDP, agent-browser, 브라우저 제어, 브라우저 조작, Chrome CDP, 로그인 세션 재사용, extract token from browser."
metadata: {"openclaw":{"requires":{"bins":["agent-browser"]},"source":"https://github.com/worldwonderer/oh-story-claudecode"}}
---
# Browser CDP 조작 도구

CDP 프로토콜을 통해 Chrome을 제어하고, 기존 로그인 세션을 재사용하여 브라우저 자동화 작업을 수행합니다.

## 사전 조건

- macOS / Linux / Windows (실험적), Google Chrome 설치 필요
- Node.js 20+
- `agent-browser` 설치 필요: `npm install -g agent-browser`

> ⚠️ **최초 실행 시 사용자의 일반 Chrome이 종료됩니다.** 실행 전에 반드시 사용자 동의를 구해야 합니다 (아래 "실행 흐름" 참조). 그렇지 않으면 저장되지 않은 탭/초안이 손실될 수 있습니다.

---

## 실행 흐름 (skill-mode 필수 단계)

**1단계: 현재 상태 탐지 (부작용 없음)**

```bash
node {SKILL_DIR}/scripts/setup-cdp-chrome.js 9222 --detect-only
```

출력 형식:

```
CDP_STATUS=ready                        # 준비 완료, 바로 재사용 가능
CDP_URL=http://127.0.0.1:9222/json/version
BROWSER=Chrome/148.0.7778.168
```

또는:

```
CDP_STATUS=needs-setup
CHROME_RUNNING=yes                      # 사용자가 Chrome을 실행 중, 실행 시 종료됨
CHROME_PID_COUNT=3
```

**2단계: 탐지 결과에 따른 분기**

- `CDP_STATUS=ready` → `agent-browser --cdp 9222 ...`을 직접 사용하며, **setup을 실행하지 않습니다**.
- `CDP_STATUS=needs-setup`이고 `CHROME_RUNNING=no` → 안전 실행:
  ```bash
  node {SKILL_DIR}/scripts/setup-cdp-chrome.js 9222 --yes
  ```
- `CDP_STATUS=needs-setup`이고 `CHROME_RUNNING=yes` → **먼저 AskUserQuestion 도구로 사용자에게 확인합니다**: N개의 Chrome 프로세스가 종료되며 저장되지 않은 작업이 손실될 수 있음을 알립니다. 사용자가 동의하면 `--yes`를 붙여 실행하고, 거부하면 이번 자동화를 포기합니다.

**`--yes`를 바로 사용하면 안 되는 이유:** 스크립트는 비-TTY (즉 skill 모드 / Bash 도구) 환경에서 Chrome이 실행 중인데 `--yes`가 없으면, 종료 코드 3과 함께 `NEEDS_CONSENT: ...`를 보고하며 중단합니다. 프로세스를 **조용히 종료하지 않습니다**. 이것은 의도적인 안전장치이지만, skill 흐름에서는 코드 3을 보고 무조건 `--yes`를 전달하는 대신 먼저 사용자에게 물어야 합니다.

---

## 실행 스크립트 옵션

| 옵션 | 설명 |
|------|------|
| `--detect-only` | 탐지만 하고 상태를 변경하지 않음 (skill 용) |
| `--yes` | 동의를 받았으므로 대화형 프롬프트를 건너뜀 |
| `--reset` | 실행 전 `~/chrome-debug-profile` 초기화 (로그인 만료 시 사용) |
| `--profile <name>` | Default가 아닌 Chrome profile 사용 (예: `"Profile 1"`) |
| `--dry-run` | 실행할 단계를 출력만 하고 실행하지 않음 |

종료 코드: `0` 성공 / `1` 일반 오류 / `2` 사용자 거부 (TTY) / `3` 동의 필요하나 `--yes` 없음.

---

## 자주 사용하는 작업

### 페이지 열기 및 로딩 대기

```bash
agent-browser --cdp 9222 open "<URL>"
agent-browser --cdp 9222 wait 3000
```

### 페이지 텍스트 추출

```bash
agent-browser --cdp 9222 eval 'document.body.innerText.substring(0, 8000)'
```

### Auth Token 추출

```bash
agent-browser --cdp 9222 eval 'localStorage.getItem("token") || document.cookie'
```

### 복잡한 JS (인용부호 / `$` / 백틱 포함)

shell 이스케이프가 실수하기 쉬우므로, 다음 두 가지 방식 중 하나를 사용하세요:

```bash
# 1) base64 래핑
agent-browser --cdp 9222 eval -b "$(echo -n "document.querySelectorAll('a').length" | base64)"

# 2) heredoc + --stdin
cat <<'EOF' | agent-browser --cdp 9222 eval --stdin
const links = document.querySelectorAll('a');
links.length;
EOF
```

### 페이지 상호작용 (snapshot으로 요소 참조 가져오기)

```bash
agent-browser --cdp 9222 snapshot -i        # 대화형 요소만
agent-browser --cdp 9222 click "<CSS or @e1>"
agent-browser --cdp 9222 type "<sel>" "<text>"
```

---

## 중지 / 정리

- debug Chrome 창을 닫으면 됩니다. 창이 응답하지 않으면, 먼저 `--user-data-dir`로 debug 인스턴스의 PID를 확인한 후 해당 인스턴스만 종료하세요:
  - macOS / Linux: `pgrep -af chrome-debug-profile`
  - Windows: `wmic process where "name='chrome.exe'" get ProcessId,CommandLine | findstr chrome-debug-profile`
  PID 확인 후 `kill -9 {PID}` / `taskkill /F /PID {PID}`. 소속을 확인할 수 없으면 중지하세요. **수동 정리 시 Chrome 실행 파일 이름으로 프로세스를 일괄 종료하면 안 됩니다** — 사용자의 일상 Chrome까지 함께 종료됩니다.
  예외: `setup-cdp-chrome.js --reset` 내부에서는 실행 파일 이름 기반 정리를 수행하지만, 이는 본 skill에 포함된, `--yes` 명시적 동의가 필요한 실행 흐름에 해당합니다. 수동 문제 해결 시 이 방식을 복사하지 마세요.
- 로그인 세션 만료: `node {SKILL_DIR}/scripts/setup-cdp-chrome.js 9222 --reset --yes` (`--yes` 역시 사용자에게 먼저 확인이 필요합니다).

---

## OpenCode 환경 주의사항

opencode에는 백그라운드 명령어 실행 도구가 없으므로, 오래 걸리는 CDP 작업 (페이지 로딩 대기, 대량 데이터 크롤링 등)이 전체 세션을 차단하여 CLI가 응답하지 않을 수 있습니다.

### 타임아웃 래핑

Windows에서 CDP 명령에 PowerShell Job 래핑 타임아웃을 사용합니다:

```powershell
$job = Start-Job { agent-browser --cdp 9222 eval "window.location.replace('https://www.qidian.com/rank/')" }
Wait-Job $job -Timeout 30 | Out-Null
if ($job.State -eq 'Running') { Stop-Job $job; Write-Output "⏱ CDP 작업 타임아웃 (30초), 재시도하거나 수동으로 중단하세요" }
else { Receive-Job $job }
Remove-Job $job -Force
```

macOS / Linux에서 `timeout` 명령을 사용합니다:

```bash
timeout 30 agent-browser --cdp 9222 eval "window.location.replace('https://www.qidian.com/rank/')" || echo "⏱ CDP 작업 타임아웃 (30초), 재시도하거나 수동으로 중단하세요"
```

### 알려진 제한 사항

타임아웃 래핑을 추가하더라도 다음 시나리오에서 문제가 발생할 수 있습니다:

| 시나리오 | 위험 | 완화 방법 |
|------|------|------|
| 페이지 로딩 타임아웃 | eval 명령이 영원히 반환되지 않고 대기 | 30초 타임아웃 설정, 타임아웃 후 재시도 |
| 대량 데이터 크롤링 | 여러 페이지 넘길 때 대기 시간 누적 | 페이지별 독립 타임아웃, 실패 시 중단점부터 재개 |
| Chrome 프로세스 좀비 | CDP 연결 끊겼으나 프로세스 미종료 | debug profile 대응 PID 확인 후 해당 debug 인스턴스만 종료 후 재연결; 일반 Chrome 연루 금지 |
| 네트워크 불안정 | 요청이 타임아웃 없이 중단 | 타임아웃 후 자동 1회 재시도 |

지속적으로 멈추는 작업이 발생하면, opencode에서 `ESC`를 눌러 수동으로 중단하세요.

---

## 자주 묻는 질문

| 문제 | 해결 방법 |
|------|----------|
| `NEEDS_CONSENT` + 종료 코드 3 | AskUserQuestion으로 사용자에게 Chrome 종료 허용 여부를 확인하고, 동의 후 `--yes`를 붙여 재실행 |
| CDP 포트 미수신 | `--detect-only`로 재확인; 포트 점유 시 포트 변경 |
| 페이지가 로그인 페이지로 리다이렉트 | `snapshot -i`로 로그인 버튼을 찾아 조작 |
| `eval` 반환값 `null` | localStorage 키 이름 확인; 인용부호가 포함된 JS는 `eval -b` 또는 `--stdin` 사용 |
| 로그인 세션 만료 | `setup-cdp-chrome.js 9222 --reset --yes`로 다시 복사 |
| 여러 Chrome profile 존재 | `--profile "Profile 1"`로 지정 |
| Chrome이 시작되지 않음 (30초 타임아웃) | `--reset` 시도; 포트 충돌 확인; `~/chrome-debug-profile/` 손상 여부 확인 |
