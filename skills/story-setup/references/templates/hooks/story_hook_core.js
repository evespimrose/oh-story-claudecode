"use strict"

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

function existingDir(value) {
  if (typeof value !== "string" || !value.trim()) return null
  try {
    const resolved = fs.realpathSync(path.resolve(value))
    return fs.statSync(resolved).isDirectory() ? resolved : null
  } catch {
    return null
  }
}

function safeRelative(root, target) {
  try {
    const rel = path.relative(path.resolve(root), path.resolve(target))
    return rel && !rel.startsWith("..") ? rel.split(path.sep).join("/") : String(target)
  } catch {
    return String(target)
  }
}

function resolveTarget(root, target, base = root) {
  const normalized = String(target || "").replace(/\\/g, "/")
  return path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(base || root, normalized)
}

function firstLine(file) {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/, 1)[0].trim()
  } catch {
    return ""
  }
}

function findFirst(base, maxDepth, predicate) {
  if (maxDepth < 0) return null
  let entries = []
  try {
    entries = fs.readdirSync(base, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue
    const full = path.join(base, entry.name)
    if (predicate(full, entry)) return full
  }
  if (maxDepth === 0) return null
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue
    const found = findFirst(path.join(base, entry.name), maxDepth - 1, predicate)
    if (found) return found
  }
  return null
}

function discoverActiveBook(root) {
  const declared = firstLine(path.join(root, ".active-book"))
  if (declared) {
    const candidate = resolveTarget(root, declared)
    const rel = path.relative(root, candidate)
    if (!rel.startsWith("..") && existingDir(candidate)) return candidate
  }
  const tracking = findFirst(root, 4, (_full, entry) => entry.isDirectory() && entry.name === "追踪")
  if (tracking) return path.dirname(tracking)
  const body = findFirst(root, 4, (_full, entry) => entry.isDirectory() && entry.name === "正文")
  if (body) return path.dirname(body)
  const bodyFile = findFirst(root, 4, (_full, entry) => entry.isFile() && entry.name === "正文.md")
  return bodyFile ? path.dirname(bodyFile) : null
}

function discoverAllBooks(root) {
  const books = new Map()
  function walk(base, depth) {
    if (depth < 0) return
    let entries = []
    try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue
      const full = path.join(base, entry.name)
      if (entry.isDirectory() && (entry.name === "追踪" || entry.name === "正文")) {
        books.set(path.dirname(full), path.dirname(full))
      } else if (entry.isFile() && entry.name === "正文.md") {
        books.set(path.dirname(full), path.dirname(full))
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue
      walk(path.join(base, entry.name), depth - 1)
    }
  }
  walk(root, 8)
  return [...books.values()]
}

function trackingCheckpointIssue(book, requireState = false, expectedLastCommitted = null) {
  const state = path.join(book, "追踪", "_tracking-state.json")
  if (!fs.existsSync(state)) {
    return requireState
      ? `추적/_tracking-state.json이 없습니다. 기존 본문 프로젝트는 /story-import의 「기존 추적 프로젝트 마이그레이션」으로 추적을 재구성합니다(전체 분석을 다시 실행할 필요 없음). 새 프로젝트는 먼저 tracking_commit.py init으로 초기화합니다.`
      : null
  }
  let document
  try {
    document = JSON.parse(fs.readFileSync(state, "utf8"))
  } catch {
    return `추적/_tracking-state.json을 해석할 수 없습니다. 본문 작성을 중단하고 /story-import을 다시 실행합니다. 상태를 추측하거나 수동으로 보완하지 않습니다.`
  }
  if (!document || typeof document !== "object" || Array.isArray(document) || document.schema_version !== 4) {
    return `추적/_tracking-state.json이 현재 schema_version=4가 아닙니다. 본문 작성을 중단하고 /story-import을 다시 실행합니다. 이전 구조 호환 경로는 유지하지 않습니다.`
  }
  if (!Number.isInteger(document.state_revision)) {
    return `추적/_tracking-state.json에 정수 state_revision이 없습니다. 본문 작성을 중단하고 /story-import을 다시 실행합니다.`
  }
  const context = path.join(book, "追踪", "上下文.md")
  let contextRevision = null
  try {
    const match = fs.readFileSync(context, "utf8").match(/状态修订：(\d+)/)
    if (match) contextRevision = Number(match[1])
  } catch {}
  if (contextRevision !== document.state_revision) {
    const shown = contextRevision === null ? "없음" : contextRevision
    return `추적/上下文.md의 상태 수정 번호 ${shown}이 _tracking-state.json의 ${document.state_revision}과 일치하지 않습니다. 해당 장의 mode=revision 트랜잭션을 다시 제출해 파생 뷰를 재구성합니다(expected_state_revision은 추적/_tracking-state.json의 state_revision 필드를 사용하며 check 실패 시 JSON을 출력하지 않음).`
  }
  if (expectedLastCommitted !== null) {
    if (!Number.isInteger(document.last_committed_chapter)) {
      return `추적/_tracking-state.json에 정수 last_committed_chapter가 없습니다. 본문 작성을 중단하고 /story-import을 다시 실행합니다.`
    }
// 장 번호가 이미 추적 범위 안에 있으면 재작업·개명·원고 백업이며 새 장을 처음 만드는 것이 아닙니다. 파일명은 새롭지만 장은 이미 제출된 상태이므로,
    // 순서 검증은 항상 거짓이 됩니다(workflow-revision의 「원고 백업」 단계가 반드시 해당). 건너뜁니다.
    if (expectedLastCommitted < document.last_committed_chapter) return null
    if (document.last_committed_chapter !== expectedLastCommitted) {
      return `추적은 ${document.last_committed_chapter}장까지 제출되었습니다. ${expectedLastCommitted + 1}장을 처음 만들기 전에 먼저 ${expectedLastCommitted}장 추적 트랜잭션을 제출해야 합니다.`
    }
  }
  return null
}

function continuityFindings(root) {
  const messages = []
  for (const book of discoverAllBooks(root)) {
    const bodyDir = path.join(book, "正文")
    let chapters = []
    try {
      chapters = fs.readdirSync(bodyDir)
        .filter((file) => /^第.*章.*\.md$/.test(file))
        .map((file) => path.join(bodyDir, file))
    } catch {}

    const context = path.join(book, "追踪", "上下文.md")
    const checkpointIssue = trackingCheckpointIssue(book, chapters.length > 0)
    if (checkpointIssue) {
      messages.push(`[continuity] ${safeRelative(root, book)}：${checkpointIssue}。`)
    }
    if (chapters.length && fs.existsSync(context)) {
      try {
        const newest = Math.max(...chapters.map((file) => fs.statSync(file).mtimeMs))
        const contextTime = fs.statSync(context).mtimeMs
        if (newest > contextTime + 1000) {
          const latest = chapters.reduce((left, right) => fs.statSync(left).mtimeMs > fs.statSync(right).mtimeMs ? left : right)
          messages.push(`[continuity] ${safeRelative(root, book)}：본문은 「${path.basename(latest)}」까지 갱신되었지만 이어쓰기 상태 카드가 더 오래되었습니다. 해당 장의 tracking_commit.py 트랜잭션을 제출하고 check를 통과한 뒤 이어 씁니다. 上下文.md/伏笔.md를 각각 수동으로 수정하지 않습니다.`)
        }
      } catch {}
    }

    // 이어쓰기 상태 카드 예산: 上下文.md는 트랜잭션 도구가 전체를 재구성하며 하드 상한은 12288바이트입니다.
    if (fs.existsSync(context)) {
      try {
        const contextSize = fs.statSync(context).size
        if (contextSize > 12288) {
          messages.push(`[continuity] ${safeRelative(root, book)}：추적/上下文.md가 ${contextSize}바이트로 이어쓰기 상태 카드 예산 12288바이트를 초과했습니다. mode=revision 트랜잭션을 제출해 tracking_commit.py가 전체를 재구성하도록 하며, 수동 수정이나 추가 작성을 하지 않습니다.`)
        }
      } catch {}
    }

    const titles = new Map()
    for (const chapter of chapters) {
      const match = path.basename(chapter, ".md").match(/^第0*\d+章[_\- 　]+(.+)$/)
      if (!match) continue
      const title = match[1].trim()
      if (title) titles.set(title, [...(titles.get(title) || []), path.basename(chapter)])
    }
    for (const [title, files] of titles.entries()) {
      if (files.length > 1) {
        messages.push(`[continuity] ${safeRelative(root, book)}：${files.length}개 장의 제목이 중복됩니다「${title}」(${files.join("、").slice(0, 60)}). 이름을 바꾸는 것이 좋습니다.`)
      }
    }
  }
  return messages
}

function extractProseTargets(command) {
  const targets = []
  // 目标 token 三形态（引号段优先）：双引号段 / 单引号段 / 裸词。此前只有一个把引号排除在字符类外
  // 的裸词式，带空格的引号目标（> "my book/正文/第1章.md"）整条命令抽不到目标就静默放行。
  // 裸词类只排 ASCII 空白（空格/Tab/CR/LF，shell 真正的分词符）：\s 在 js 与 python 都含 U+3000，
  // 而全角空格不分词，用 \s 会把「第003章　开局.md」截成「第003章」而漏拦（本项目章名分隔符
  // [_\- 　] 自带全角空格）。反斜杠转义空格（my\ book）仍不认——resolveTarget 把 \ 归一成路径
  // 分隔符（Windows 路径），在此解转义会反过来毁掉 book\正文\第1章.md。
  const bare = `[^ \\t\\r\\n"'<>|;&()]`
  const token = `"([^"]*正文[^"]*)"|'([^']*正文[^']*)'|["']?(${bare}*正文${bare}*)["']?`
  for (const source of [`>>?\\s*(?:${token})`, `(?:^|[\\s;&|(){}<>])(?:tee(?:\\s+-a)?|touch)\\s+(?:${token})`]) {
    const regex = new RegExp(source, "gm")
    let match
    while ((match = regex.exec(command)) !== null) {
      const target = match[1] || match[2] || match[3]
      if (target) targets.push(target)
    }
  }
  for (const raw of shellSegments(command)) {
    const segment = beforeShellRedirection(raw)
    // 引号感知分词（同 shellWords）：/\s+/ 会把 cp draft.md "my book/正文/第1章.md" 的目标切碎，
    // 末位取到 book/正文/第1章.md —— 判到另一本书上（那本有细纲就直接放行）。
    const words = shellWords(segment)
    if (words.length >= 2 && (words[0] === "cp" || words[0] === "mv")) {
      const positional = words.slice(1).filter((word) => !word.startsWith("-"))
      const destination = positional[positional.length - 1]
      if (destination && destination.includes("正文")) targets.push(destination)
    }
  }
  return targets
}

// apply_patch 目标抽取。只认 Add/Update 会漏掉 `*** Move to:`——它是 Update File 段的子指令
// （apply_patch 的改名/搬家形态），落盘路径是**目的地**，源路径搬完就不存在了。此前
// `*** Update File: draft.md` + `*** Move to: 书/正文/第9章.md` 只抽到 draft.md：细纲门放行
// （draft.md 不是正文），写后兜底网也扫的是已经不存在的源 —— 一份没细纲的草稿能直接搬进 正文/。
// 故 Move 用目的地**顶替**同段的源目标（不是追加：源已不在，拿它去查会误伤/空扫）。
// Delete File 一律不入表（两端一致）：删除不是写入，proseBlockReason 对已存在的正文本就放行、
// 删完文件也不在了没东西可扫，认它只会给「删稿」误报；但 Delete 段也能带 Move to（搬走后删源），
// 那条 Move 的目的地照样要进表，故 Delete 只清掉待顶替的源槽位。
function extractPatchTargets(patchText) {
  const targets = []
  let sourceIndex = -1
  for (const line of String(patchText).split(/\r?\n/)) {
    // apply_patch grammar 的控制行必须从第 0 列开始；diff 上下文行固定以空格开头。
    // 先 trim 会把正文里的 ` *** Move to: notes.md` 伪装成搬家指令，顶掉真实扫描目标。
    const file = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/)
    if (file) {
      if (file[1] === "Delete") {
        sourceIndex = -1
        continue
      }
      targets.push(file[2].trim())
      sourceIndex = targets.length - 1
      continue
    }
    const move = line.match(/^\*\*\* Move to: (.+)$/)
    if (move) {
      const destination = move[1].trim()
      if (!destination) continue
      if (sourceIndex >= 0) targets[sourceIndex] = destination
      else targets.push(destination)
      sourceIndex = -1
    }
  }
  return targets
}

function proseBlockReason(root, absolute) {
  const base = path.basename(absolute)
  const parent = path.basename(path.dirname(absolute))
  if (base === "正文.md") {
    if (fs.existsSync(absolute)) return null
    const book = path.dirname(absolute)
    if (fs.existsSync(path.join(root, "拆文库", path.basename(book)))) return null
    if (!fs.existsSync(path.join(book, "设定.md"))) return null
    if (!fs.existsSync(path.join(book, "小节大纲.md"))) {
      return `⛔ 본문 작성 차단: ${safeRelative(root, absolute)}에 같은 디렉터리의 小节大纲.md가 없습니다. 먼저 story-short-write에 따라 「小节大纲.md」를 완성한 뒤 본문을 작성합니다.`
    }
    return null
  }
  if (parent !== "正文" || !/^第.*章.*\.md$/.test(base)) return null
  const match = base.match(/^第0*(\d+)章/)
  if (!match) return null
  const chapter = match[1]
  const book = path.dirname(path.dirname(absolute))
  const state = path.join(book, "追踪", "_tracking-state.json")
  // 这是守卫的 canonical case：agent 可能在任何脚手架存在前就首建 {书}/正文/第N章.md。
  // 是否“像一本书”不能作为放行条件；相对路径误判应在宿主 adapter 按 cwd 正确解析，而不是
  // 让核心守卫 fail open。
  // story-import 在复制既有正文、尚未执行 tracking init 的窗口可以写；一旦 state 存在，
  // 即进入当前追踪协议，不再因为保留了 拆文库/ 分析资产而永久绕过守卫。
  if (fs.existsSync(path.join(root, "拆文库", path.basename(book))) && !fs.existsSync(state)) return null
  const exists = fs.existsSync(absolute)
  const outlineDir = path.join(book, "大纲")
  let found = false
  if (!exists) {
    try {
      found = fs.readdirSync(outlineDir).some((file) => {
        const candidate = file.match(/^细纲_第0*(\d+)章.*\.md$/)
        return candidate && candidate[1] === chapter
      })
    } catch {}
    if (!found) {
      return `⛔ 본문 작성 차단: ${chapter}장에 세부 개요가 없습니다(${safeRelative(root, outlineDir)}/细纲_第${chapter}章.md). 먼저 story-long-write 단일 장 절차에 따라 세부 개요를 만든 뒤 본문을 작성합니다.`
    }
  }
  const checkpointIssue = trackingCheckpointIssue(book, true, exists ? null : Number(chapter) - 1)
  if (checkpointIssue) {
    return `⛔ 본문 작성 차단: ${safeRelative(root, book)}의 ${checkpointIssue}.`
  }
  if (exists) return null
// 미정리 잔액 게이트(상태 없음): N장을 처음 작성하기 전에 이전 장에 정리되지 않은 유해 문장 패턴이 있고 「去味:跳过」면제가 없으면 먼저 정리합니다.
  // 판정은 이전 장 파일 자체에서 즉시 계산하며 어떤 상태 파일에도 기록하지 않습니다. 이전 장을 찾지 못하거나 읽기에 실패하면 항상 허용합니다(차단 누락을 감수하더라도 오차 차단은 피함).
  // js↔py 문구는 check-hook-regex-sync.sh가 동기화를 고정하고, 판정은 test-prose-net-parity.sh Part E가 parity를 고정합니다.
  const prevNum = Number(chapter) - 1
  if (prevNum >= 1) {
    let prevFile = null
    try {
      // readdir 顺序在 ext4/overlayfs 上是哈希序：不排序就可能挑中同章号的原稿备份
      // （workflow-revision 的「备份原稿」产物），拿早已被改写掉的旧文本报欠账。
      // 显式排除 _原稿_ 备份并排序，保证四端与各文件系统上取到同一个「上一章」。
      const candidates = fs.readdirSync(path.dirname(absolute))
        .filter((file) => {
          const pm = file.match(/^第0*(\d+)章.*\.md$/)
          return pm && Number(pm[1]) === prevNum && !file.includes("_原稿_")
        })
        .sort()
      if (candidates.length) prevFile = path.join(path.dirname(absolute), candidates[0])
    } catch {}
    if (prevFile) {
      let prevText = null
      try { prevText = fs.readFileSync(prevFile, "utf8") } catch {}
      if (prevText !== null && !/去味(：|:)跳过/.test(prevText.split(/\r?\n/).slice(0, 6).join("\n"))) {
        const hits = toxicPhraseFindings(prevText).filter((line) => line.startsWith("第"))
        if (hits.length) {
          const shown = hits.slice(0, 6)
          const more = hits.length - shown.length
          let reason = `⛔ 본문 작성 차단: 이전 장(${path.basename(prevFile)})에 정리되지 않은 유해 문장 패턴이 ${hits.length}곳 남아 있습니다. 먼저 모두 정리한 뒤 ${chapter}장을 작성합니다. 사용자가 명시적으로 면제하려면 이전 장 제목 행 아래에 <!-- 去味:跳过 -->를 추가하고 다시 시도합니다.\n${shown.join("\n")}`
          if (more > 0) reason += `\n(그 밖에 ${more}곳이 더 있습니다. 전체 검사: node <skill>/scripts/check-ai-patterns.js --check 이전 장 파일)`
          return reason
        }
      }
    }
  }
  return null
}

// 문장 끝 구두점 집합은 심층 검사 oracle check-degeneration.js의 findTruncation과 맞춥니다([。！？!?…”"』」）)】]）。
// 】는 장 끝 시스템 알림 템플릿의 종결 기호이며(agent-references/hooks-chapter.md 장 끝 실전 템플릿 1·4), ASCII "는
// normalize-punctuation.js --quote-mode ascii의 합법적인 닫는 따옴표입니다. 둘 다 「잘린 것으로 의심」하면 안 됩니다.
const TERMINAL = new Set(Array.from("。！？…”』」）)!?.~—】\""))
const QUOTE_OPENERS = new Set(["「", "“", "‘", "『", '"'])
const SOFT_PATTERNS = [
// 모델명 접미사(AI 언어 모델/AI 도우미/인공지능 언어 모델/AI 모델/대형 AI 모델)는 선택적으로 소비할 수 있어야 합니다. 그렇지 않으면 전방 탐색이
  // 「AI」 바로 뒤에서 「언」/「도」/「모」를 보게 되어 가장 전형적인 퇴화 도입 유형 전체를 놓칩니다.
  [/作为(一个)?(AI|人工智能|大?语言模型|智能助手|聊天助手)(?:语言模型|大?模型|助手|机器人)?(?=，|,|。|、|；|;|：|:|！|!|？|\?|\s|）|\)|」|』|"|】|我|无法|不能|没法|$)/, "AI 자기 지시"],
  [/^(Sure|Certainly|Here'?s|As an AI|I (?:cannot|can't|am unable|apologize))/, "영어 AI 말투"],
  [/我(无法|不能)(继续(写|创作|生成|下去|输出)?|生成(内容|文本|正文)?|创作|续写|写作|完成(这个|本)?(章|篇|创作|请求)?)/, "생성 거부 문구"],
]
const HARD_PATTERNS = [
  [/[（(](此处|以下|这里|下文|后续)?[^）)]{0,10}(省略|略去|略过)[^）)]{0,10}[）)]/, "자리표시자(괄호 생략)"],
  [/(TODO|占位符|placeholder|待补充|此处待填|此处待补)/, "자리표시자"],
  [/(细纲|情节点|卷纲|功能标签|目标情绪|字数目标|章首钩子|章尾钩子|任务描述)/, "공정 용어 노출"],
  [/�/, "깨진 문자(대체 문자)"],
]

function skippableLine(line) {
  return !line || line.startsWith("#") || line === "---" || /^[-—=*·•\s]+$/.test(line)
}

// ── 유해 문장 패턴(결정론적 AI 문장 지문, 본문 작성 후 검사 경로) ─────────────────────────────
// check-ai-patterns.js의 같은 이름 규칙과 동일한 사양: 결정론적이고 오탐이 적은 문장 패턴만 수집합니다. 밀도형·
// advisory 검사는 check-ai-patterns.js의 심층 검사에 맡기며, 본문을 쓸 때마다 실행되는 이 게이트에는 넣지 않습니다. 모든 정규식은
// 선형으로 검사하고 수량자를 제한해 역추적 폭주를 방지합니다. 대사·댓글·시스템 알림은 대상이 아닙니다. 줄마다 쌍을 이룬 따옴표 구간을 같은 길이의
// 물음표 자리표시자로 바꿉니다(자리표시자가 각 규칙의 문자 클래스를 자연스럽게 끊어 따옴표를 가로질러 오탐을 만들지 않음. 왜
// maskQuotedSpans가 마침표가 아니라 물음표를 사용하는지는 해당 함수를 참조). 치환 후에도 따옴표가 남는 줄(여러 줄 대화·닫히지 않은 따옴표)은
// 줄 전체를 건너뜁니다. js↔py 동형 구현(codex story_codex_hook.py)은 scripts/check-hook-regex-sync.sh(규격 문자열 단위 고정)와
// scripts/test-prose-net-parity.sh(fixture 단위 diff)가 parity를 고정하며, 문구는 이 핵심 구현을 기준으로 합니다.
const TOXIC_QUOTE_SPANS = [/「[^」]*」/g, /『[^』]*』/g, /【[^】]*】/g, /“[^”]*”/g, /‘[^’]*’/g, /"[^"]*"/g, /'[^']*'/g]
const TOXIC_QUOTE_CHARS = new Set(Array.from("「」『』【】“”‘’\"'"))
// 절 시작 경계(이전 문자가 여기에 속해야 「A이고 B가 아니다」의 절 시작 「是」로 인정)이며, 확인문 오른쪽 경계로도 사용합니다.
const TOXIC_CLAUSE_BOUNDARY = new Set(Array.from("，,。.！!？?；;：:、…—~ \t　"))
// 의문 어미(是吗/是吧/是嘛)와 확인문(是的/是啊/是呀/是呢+경계)의 「是」는 대조문 계사 동사가 아닙니다.
// 제외 로직은 check-ai-patterns.js의 TAG_PARTICLES / AFFIRMATION_TAG_PARTICLES에서 이식했습니다.
const TOXIC_TAG_PARTICLES = new Set(["吗", "吧", "嘛"])
const TOXIC_AFFIRM_PARTICLES = new Set(["的", "啊", "呀", "呢"])
const TOXIC_TRAILER_WINDOW = 600
const TOXIC_SENTENCE_PATTERNS = [
  [/声音(?:并)?不[大高响亮][^。！？!?\n]{0,16}[却但偏]/g, "voice-contrast", "「X가 아니지만 Y다」식 대조 말투를 삭제하고 구체적인 효과나 동작을 직접 씁니다."],
  [/(?:没有[^。！？!?\n，,]{1,12}[，,]){2}/g, "negation-parade", "「…없고, …없다」식 나열은 하나만 남기거나 전부 삭제하고, 현재 드러난 세부를 긍정문으로 다시 씁니다."],
  [/是[^。！？!?\n，,]{1,12}[，,]\s*(?:而)?不是[^。！？!?\n]{1,20}/g, "reverse-not-is", "부정으로 뜸 들이는 표현을 삭제하고 긍정 항목을 직접 쓰거나 동작 세부로 바꿉니다."],
  [/不是[^。！？!?\n]{1,16}[，,]\s*(?:而)?是/g, "not-is-comparison", "부정으로 뜸 들이는 표현을 삭제하고 긍정 항목을 직접 쓰거나 동작 세부로 바꿉니다."],
]
// 「正式拉开序幕/帷幕」是场内事件的报幕式陈述，不是叙述者预告，lookbehind 排除（同 check-ai-patterns.js）。
const TOXIC_TRAILER_PATTERN = /没人知道|谁也不知道|谁也没想到|殊不知|(?:这)?才刚刚开(?:始|头)|正(?:朝着|向着)[^。！？!?\n]{0,24}(?:压|涌|袭|逼)(?:了?过去|了?过来|来)|(?<!正式)拉开(?:序幕|帷幕)|即将(?:开始|来临|降临)/
// 장 끝 상태 요약체: trailer-ending과 같은 문서 끝 창을 사용하며 과거를 확정하는 표현이지 미래를 예고하는 표현이 아닙니다(check-ai-patterns.js와 동일).
// 모두 banned-words에서 이름으로 차단한 형태입니다. 「(이|그) 순간…마침내 깨달았다」는 제외합니다. 실제 서술에서는 정상적인 인지
// 박자이며, 단편 1인칭의 판단 문장으로서 매력으로 작동할 수 있습니다. 각 분기는 문장 끝의 단정 위치에 놓아 조건절·보어·성어·타동 용법·부정 인지를 삼키지 않게 합니다.
const TOXIC_TRAILER_SUMMARY_PATTERN = /这一(?:夜|天|刻|战|年|局|役)[，,]?[^。！？!?，,\n]{0,6}(?<!命中)(?<!是)注定[^。！？!?\n]{0,8}[。！]|就这样[，,][^。！？!?，,\n]{0,8}(?:一切|全部)[^。！？!?，,\n]{0,4}(?:结束了|落幕|收场)[。！]|这一切[，,]?[^。！？!?，,\n]{0,6}(?:都)?(?:说明|意味着|结束了)(?!的)(?:(?!什么)[^。！？!?\n]){0,6}[。！]|(?:新的篇章|新的旅程|崭新的篇章|新的人生)[^。！？!?\n]{0,6}(?:开始|拉开|展开)|命运[^。！？!?\n]{0,6}齿轮/
// 「A이고 B가 아니다」의 반문 어미(…，不是吗/么/吧)는 대조문으로 보지 않습니다. 일치 구간의 마지막 「不是」 뒤 첫 글자로 판단합니다.
const TOXIC_REVERSE_TAIL = /.*[，,]\s*(?:而)?不是([^。！？!?\n]*)$/

// 자리표시자에는 「。」가 아니라 「？」를 사용합니다. 각 규칙의 [^。！？!?…] 부정 문자 클래스를 끊으면서도(각 규칙의 부정 클래스에서는 ？와 마침표가
// 동등), 어떤 규칙의 허용 위치에도 놓이지 않아야 합니다. 마침표를 쓰면 trailer-summary의 문장 끝 [。！]이 종결 기호로 오인되어
// 「이 전투는 「혈도」의 시작으로 정해졌다…」처럼 따옴표 안에 코드명·별칭을 넣은 서술 행을 오탐하고, 보고된 『이 전투는 정해졌다.』를
// 원문에서 grep할 수도 없습니다. 자리표시자 길이는 유지하므로 trailer 창의 절단 위치도 변하지 않습니다.
function maskQuotedSpans(line) {
  let out = line
  for (const spans of TOXIC_QUOTE_SPANS) out = out.replace(spans, (m) => "？".repeat(m.length))
  return out
}

// 「是不是」 의문이나 뒤집힌 「是」 뒤의 의문 어미·확인문은 「A가 아니라 (오히려) B다」 대조문으로 보지 않습니다.
function toxicNotIsExcluded(line, matched, start) {
  if (start > 0 && line[start - 1] === "是") return true
  const end = start + matched.length
  const c1 = line[end] || ""
  const c2 = line[end + 1] || ""
  if (TOXIC_TAG_PARTICLES.has(c1)) return true
  if (TOXIC_AFFIRM_PARTICLES.has(c1) && (c2 === "" || TOXIC_CLAUSE_BOUNDARY.has(c2))) return true
  return false
}

// 절 시작의 「A이고 B가 아니다」만 인정합니다. 문장 중간의 「하지만/역시/단지/그는…이다」의 「是」는 모두 제외합니다(either-or
// 「아니다/바로 ~이다/역시 ~이다」와 모든 「X是」 접속·부사 합성어도 절 시작 판정에서 제외). 「是的，不是…」
// 확인문 시작, 「是不是…」 의문문 시작, 「…，不是吗/么/吧」 반문 어미도 제외합니다(check-ai-patterns.js와 동일).
function toxicReverseNotIsExcluded(line, matched, start) {
  const prev = start > 0 ? line[start - 1] : ""
  if (prev !== "" && !TOXIC_CLAUSE_BOUNDARY.has(prev)) return true
  if (line.slice(start + 1, start + 3) === "不是") return true
  const c1 = line[start + 1] || ""
  const c2 = line[start + 2] || ""
  if ((TOXIC_TAG_PARTICLES.has(c1) || TOXIC_AFFIRM_PARTICLES.has(c1)) && (c2 === "" || TOXIC_CLAUSE_BOUNDARY.has(c2))) return true
  const tail = matched.match(TOXIC_REVERSE_TAIL)
  const t1 = tail && tail[1] ? tail[1][0] : ""
  if (t1 === "吗" || t1 === "么" || t1 === "吧") return true
  return false
}

// 각 줄에서는 일치한 첫 번째 문장 패턴만 보고합니다(한 곳을 고친 뒤 다음 곳을 재검사하는 원칙).
function matchToxicSentence(line) {
  for (const [regex, label, fix] of TOXIC_SENTENCE_PATTERNS) {
    regex.lastIndex = 0
    let match
    while ((match = regex.exec(line)) !== null) {
      if (label === "not-is-comparison" && toxicNotIsExcluded(line, match[0], match.index)) continue
      if (label === "reverse-not-is" && toxicReverseNotIsExcluded(line, match[0], match.index)) continue
      return [label, fix, match[0]]
    }
  }
  return null
}

function toxicPhraseFindings(text) {
  const findings = []
  const content = []
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim()
    if (skippableLine(line)) return
    const masked = maskQuotedSpans(line)
    for (const ch of masked) {
      if (TOXIC_QUOTE_CHARS.has(ch)) return
    }
    content.push([index + 1, masked])
  })
  for (const [lineNo, masked] of content) {
    const hit = matchToxicSentence(masked)
    if (hit) findings.push(`${lineNo}행 유해 문장 패턴[${hit[0]}]: 『${hit[2].slice(0, 20)}』 — ${hit[1]}`)
  }
  // trailer-ending은 문서 끝 600자 창만 검사합니다(따옴표를 자리표시자로 바꾼 뒤 줄 단위로 누적하며 경계 줄은 전체를 포함).
  let acc = 0
  let cut = content.length
  while (cut > 0 && acc < TOXIC_TRAILER_WINDOW) {
    cut -= 1
    acc += Array.from(content[cut][1]).length
  }
  for (let i = cut; i < content.length; i++) {
    const [lineNo, masked] = content[i]
    const match = masked.match(TOXIC_TRAILER_PATTERN)
    if (match) findings.push(`${lineNo}행 유해 문장 패턴[trailer-ending]: 『${match[0].slice(0, 20)}』 — 장 끝 예고체를 삭제하고 현재 진행 중인 동작이나 장면으로 마무리합니다.`)
    const summary = masked.match(TOXIC_TRAILER_SUMMARY_PATTERN)
    if (summary) findings.push(`${lineNo}행 유해 문장 패턴[trailer-summary]: 『${summary[0].slice(0, 20)}』 — 장 끝 상태 요약문을 삭제합니다. 마무리 상태는 세부 개요의 계획 표현이므로 본문에서는 구체적인 동작·장면·대사로 내려 씁니다.`)
  }
  if (findings.length) findings.push("유해 문장 패턴은 결정론적 AI 지문입니다. 이 장에서 모두 제거한 뒤 계속합니다. 전체 검사: node <skill>/scripts/check-ai-patterns.js --check <본문 파일>")
  return findings
}

function proseNetFindings(text) {
  const findings = []
  const content = []
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim()
    if (skippableLine(line)) return
    const lineNo = index + 1
    content.push([lineNo, line])
    let hit = false
    if (!QUOTE_OPENERS.has(line[0])) {
      for (const [regex, label] of SOFT_PATTERNS) {
        const match = line.match(regex)
        if (match) {
          findings.push(`${lineNo}행 메타데이터 노출(${label}): 「${match[0].slice(0, 20)}」`)
          hit = true
          break
        }
      }
    }
    if (hit) return
    for (const [regex, label] of HARD_PATTERNS) {
      const match = line.match(regex)
      if (match) {
        findings.push(`${lineNo}행 ${label}: 「${match[0].slice(0, 20)}」`)
        break
      }
    }
  })
  for (let i = 1; i < content.length; i++) {
    const previous = content[i - 1][1]
    const [lineNo, current] = content[i]
    if (previous === current && current.length >= 8) findings.push(`${lineNo}행 인접 반복: 이전 행과 완전히 동일한 행 「${current.slice(0, 20)}」`)
  }
  if (content.length) {
    const [lineNo, last] = content[content.length - 1]
    if (!TERMINAL.has(Array.from(last).pop())) findings.push(`${lineNo}행 잘림 의심: 끝부분 「…${last.slice(-12)}」가 구두점으로 마무리되지 않음`)
  }
// 「去味:跳过」면제는 미정리 잔액 게이트와 같은 기준(파일 첫 6행)을 사용합니다. 표기가 있으면 유해 문장 패턴의 재검사를 건너뛰고,
  // 나머지 검사(메타데이터/자리표시자/반복/잘림)는 그대로 실행합니다. 그렇지 않으면 차단 안내에 따라 표기를 추가한 해당 Edit가
  // 이미 면제된 유해 문장 패턴을 다시 하드 신호로 처리하게 됩니다.
  if (!/去味(：|:)跳过/.test(text.split(/\r?\n/).slice(0, 6).join("\n"))) {
    findings.push(...toxicPhraseFindings(text))
  }
  return findings
}

function isProsePath(absolute) {
  const base = path.basename(absolute)
  const parent = path.basename(path.dirname(absolute))
  if (base === "正文.md") return fs.existsSync(path.join(path.dirname(absolute), "设定.md"))
  if (parent !== "正文" || !/^第.*章.*\.md$/.test(base)) return false
  const book = path.dirname(path.dirname(absolute))
  // 大纲/追踪/设定 must be directories; 设定.md a file — matches the bash oracle
  // check-prose-after-write.sh (`[ -d 大纲 ] || … || [ -f 设定.md ]`).
  return ["大纲", "追踪", "设定"].some((name) => existingDir(path.join(book, name))) || fs.existsSync(path.join(book, "设定.md"))
}

function wordcountFinding(absolute, text) {
  if (path.basename(path.dirname(absolute)) !== "正文") return null
  const match = path.basename(absolute).match(/^第0*(\d+)章/)
  if (!match) return null
  const chapter = match[1]
  const outlineDir = path.join(path.dirname(path.dirname(absolute)), "大纲")
  let target = null
  try {
    for (const file of fs.readdirSync(outlineDir)) {
      const fileMatch = file.match(/^细纲_第0*(\d+)章.*\.md$/)
      if (!fileMatch || fileMatch[1] !== chapter) continue
      const content = fs.readFileSync(path.join(outlineDir, file), "utf8")
      const targetMatch = content.match(/字数目标[^0-9]{0,6}(\d{3,6})/)
      if (targetMatch) target = Number(targetMatch[1])
      break
    }
  } catch {}
  if (!target) return null
  const actual = Array.from(text).length
  return actual < target * 0.9
    ? `글자 수: ${chapter}장 실제 ${actual}자 < 목표 ${target}자의 90%(${Math.floor(target * 0.9)}자). 세부 개요의 글자 수 예산과 대조해 부족한 밀도를 찾고, 조금씩 땜질하지 말고 한 번에 할당량까지 다시 씁니다.`
    : null
}

function duplicateTitleFindings(absolute) {
  const bodyDir = path.dirname(absolute)
  if (path.basename(bodyDir) !== "正文") return []
  const titles = new Map()
  try {
    for (const file of fs.readdirSync(bodyDir)) {
      const match = file.replace(/\.md$/, "").match(/^第0*\d+章[_\- 　]+(.+)$/)
      if (!match) continue
      const title = match[1].trim()
      if (title) titles.set(title, [...(titles.get(title) || []), file])
    }
  } catch {}
  const findings = []
  for (const [title, files] of titles.entries()) {
    if (files.length > 1) findings.push(`${files.length}개 장의 제목이 중복됩니다「${title}」(${files.join("、").slice(0, 60)}). 이름을 바꾸는 것이 좋습니다.`)
  }
  return findings
}

function proseAfterWrite(root, absolute) {
  if (!fs.existsSync(absolute) || !isProsePath(absolute)) return ""
  const findings = []
  try {
    const bytes = fs.statSync(absolute).size
    if (bytes < 200) findings.push(`【디스크 기록】본문이 ${bytes}바이트에 불과해 미완성 또는 기록 실패로 보입니다(quota/시간 초과로 중단되었을 수 있음). 확인 후 보완해 작성합니다.`)
    const text = fs.readFileSync(absolute, "utf8")
    findings.push(...proseNetFindings(text))
    const wordcount = wordcountFinding(absolute, text)
    if (wordcount) findings.push(wordcount)
  } catch {
    return ""
  }
  findings.push(...duplicateTitleFindings(absolute))
  if (!findings.length) return ""
  return `=== 본문 보완 검사(${safeRelative(root, absolute)}) ===\n경량 결정론적 게이트가 자동으로 재검사했습니다(모델과 무관하며 메인 세션의 마무리 검사 누락을 방지). 유형별로 처리한 뒤 깨끗해질 때까지 재검사합니다.\n${findings.join("\n")}`
}

// 선형 수제 토큰화이며 모호한 교대 정규식을 사용하지 않습니다. 기존 /"(?:\\.|[^"])*"|'[^']*'|[^\s]+/에서는 \\.와 [^"]가 모두 백슬래시를 소비할 수 있습니다.
// 호출자가 먼저 [;&|\n]으로 구간을 나누면 인용부 안의 구분자가 분리되어 닫히지 않은 "가 남습니다. 이때 백슬래시마다
// 검색 공간이 두 배가 됩니다. `git commit -m "fix: 이스케이프 적용 \\n \\r … | see README"` 같은 130자 명령은 실제로
// CPU 27초를 소모해 호스트 hook의 timeoutMs(zcode 15000ms)를 넘어 종료되었습니다. 문자를 하나씩 스캔해 인용부 안의 문자를 그대로 취하고(쌍을 이루면
// 인용부호를 제거하며 닫히지 않으면 구간 끝까지 취함), ASCII 공백(공백/Tab/CR/LF)으로 토큰화합니다. U+3000은 shell 구분자가 아니므로
// 자르지 않습니다. 백슬래시 이스케이프도 해석하지 않습니다. resolveTarget가 백슬래시를 경로 구분자(Windows 경로)로 처리하기 때문입니다.
function shellWords(segment) {
  const words = []
  let current = ""
  let started = false
  let quote = ""
  for (const ch of String(segment)) {
    if (quote) {
      if (ch === quote) quote = ""
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
      continue
    }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      if (started) words.push(current)
      current = ""
      started = false
      continue
    }
    started = true
    current += ch
  }
  if (started) words.push(current)
  return words
}

function shellSegments(command) {
  const segments = []
  let current = ""
  let quote = ""
  for (const ch of String(command)) {
    if (quote) {
      current += ch
      if (ch === quote) quote = ""
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === ";" || ch === "&" || ch === "|" || ch === "\n") {
      if (current) segments.push(current)
      current = ""
      continue
    }
    current += ch
  }
  if (current) segments.push(current)
  return segments
}

function beforeShellRedirection(segment) {
  let current = ""
  let quote = ""
  for (const ch of String(segment)) {
    if (quote) {
      current += ch
      if (ch === quote) quote = ""
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === "<" || ch === ">") {
      return current.replace(/\d+$/, "")
    }
    current += ch
  }
  return current
}

function isGitCommitCommand(command) {
  const valueOptions = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env"])
// 서브셸·중괄호 그룹을 공백으로 평탄화해 `(git commit)` / `{ git commit; }`에서도 git 동사를 드러냅니다. 구분자로 나눈 뒤 앞의 shell 래퍼와
  // 제어어(then/do/else/elif)를 건너뛰므로 if/for/while 안의 commit도 감지합니다. Claude bash oracle
  // validate-story-commit.sh 및 codex is_git_commit_command와 동일한 방식입니다.
  for (const rawSegment of String(command).replace(/\r/g, "").replace(/[(){}]/g, " ").split(/[;&|\n]+/)) {
    const words = shellWords(rawSegment)
    let i = 0
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || ["command", "noglob", "then", "do", "else", "elif"].includes(words[i]))) i++
    if (words[i] === "env") {
      i++
      while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || ["-i", "--ignore-environment"].includes(words[i]))) i++
    }
    if (words[i] !== "git") continue
    i++
    while (i < words.length) {
      const token = words[i]
      if (token === "commit") return true
      if (valueOptions.has(token)) { i += 2; continue }
      if ([...valueOptions].some((option) => option.startsWith("--") && token.startsWith(`${option}=`))) { i++; continue }
      if (token.startsWith("-")) { i++; continue }
      break
    }
  }
  return false
}

// 设定/ 바로 아래에 있는 프로젝트 수준 설정 파일: artifact-protocols.md가 규정한 关系.md(본문은 「# 인물 관계도」),
// 题材定位.md, 文风.md, 题材正文提示卡.md 등은 원래 이름·성명 필드가 없습니다.
const SETTING_NON_CHARACTER_FILES = new Set(["关系.md", "题材定位.md", "题材正文提示卡.md", "文风.md", "世界规则.md", "世界观.md", "金手指.md", "背景设定.md"])

// 인물 카드만 검사합니다. 设定/ 전체를 일괄 검사하면 설정을 건드리는 모든 제출마다 가짜 경고가 쏟아져
// 같은 화면에 있는 「본문에 하드코딩된 인물 속성」의 실제 경고가 묻힙니다. 판정 기준은 validate-story-commit.sh / opencode
// pre-commit.sh의 case 분기와 일치합니다(bash↔js↔py 네 구현이 같은 기준을 사용하므로 한쪽만 일괄 검사로 되돌리지 않음):
// ① 设定/角色|人物 하위 디렉터리의 파일 → 인물 카드;
// ② 그 밖의 设定/<하위 디렉터리>/ → 디렉터리 전체를 건너뜀(세계관/세력/보고서/원리/인물 관계 등);
// ③ 设定/ 바로 아래의 평면 파일 → 알려진 프로젝트 수준 설정 파일을 제외하면 모두 인물 카드로 처리(주인공.md/조연.md/악역.md 등 사용자 정의 이름).
// bash 的 `*` 跨 `/` 匹配，`设定/角色/*|*/设定/角色/*` 等价于「路径里存在某个 设定 目录段满足该
// 分支」，所以两趟扫描（先全路径找分支①，再全路径找分支②）而不是只看第一个 设定 段就定分支——
// 后者在 设定/其他/设定/角色/x.md 这类嵌套路径上会与 bash 判定分叉。
function isCharacterSheetPath(relative) {
  const segments = relative.split("/")
  const last = segments.length - 1
  // 분기 ①: 어떤 设定 구간 바로 뒤에 角色/人物가 있고 그 아래에 파일 구간이 더 있음
  for (let i = 0; i + 1 < last; i++) {
    if (segments[i] === "设定" && (segments[i + 1] === "角色" || segments[i + 1] === "人物")) return true
  }
  // 분기 ②: 어떤 设定 구간 뒤에 2개 이상의 구간이 있어 인물이 아닌 하위 디렉터리에 속함
  for (let i = 0; i + 1 < last; i++) {
    if (segments[i] === "设定") return false
  }
  // 분기 ③: 设定 바로 아래의 평면 파일(분기 ②에서 더 깊은 경로를 제외했으므로 设定 구간은 끝에서 두 번째일 수밖에 없음)
  return last >= 1 && segments[last - 1] === "设定" && !SETTING_NON_CHARACTER_FILES.has(segments[last])
}

function stagedMarkdownWarnings(root) {
  let output
  try {
    output = spawnSync("git", ["-C", root, "-c", "core.quotepath=false", "diff", "--cached", "--relative", "--name-only", "--diff-filter=ACM", "-z", "--", "."], {
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"],
    })
    if (output.status !== 0 || !output.stdout) return ""
  } catch {
    return ""
  }
  const warnings = []
  for (const relative of output.stdout.toString("utf8").split("\0").filter(Boolean)) {
    if (!relative.endsWith(".md")) continue
    const full = path.join(root, relative)
    let text = ""
    try { text = fs.readFileSync(full, "utf8") } catch { continue }
    if (relative === "正文.md" || relative.includes("/正文.md") || relative.startsWith("正文/") || relative.includes("/正文/")) {
      const hits = []
      text.split(/\r?\n/).forEach((line, index) => {
        if (/(身高|体重|年龄)[\s　]*(：|:)[\s　]*[0-9]+/.test(line)) hits.push(`${index + 1}:${line}`)
      })
      if (hits.length) warnings.push(`⚠ ${relative}: 본문에 인물 속성이 하드코딩되어 있습니다. 설정 파일을 참조해야 합니다.\n${hits.join("\n")}`)
    }
    if (isCharacterSheetPath(relative) && !/^[\s　]*(名字|姓名|名称|name)[\s　]*(：|:)/im.test(text)) {
      warnings.push(`⚠ ${relative}: 설정 파일에 필수 name/이름 필드가 없습니다.`)
    }
  }
  return warnings.length ? `=== Story Commit Warnings(참고용 경고) ===\n${warnings.join("\n")}\n=== End Warnings ===` : ""
}

module.exports = {
  existingDir,
  safeRelative,
  resolveTarget,
  firstLine,
  findFirst,
  discoverActiveBook,
  discoverAllBooks,
  trackingCheckpointIssue,
  continuityFindings,
  extractProseTargets,
  extractPatchTargets,
  proseBlockReason,
  isProsePath,
  wordcountFinding,
  duplicateTitleFindings,
  proseAfterWrite,
  shellWords,
  isGitCommitCommand,
  stagedMarkdownWarnings,
  TERMINAL,
  QUOTE_OPENERS,
  SOFT_PATTERNS,
  HARD_PATTERNS,
  skippableLine,
  proseNetFindings,
  maskQuotedSpans,
  toxicPhraseFindings,
}
