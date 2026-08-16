#!/usr/bin/env node
/**
 * 起点中文网 랭킹 수집 스크립트
 *
 * browser-cdp skill과 함께 사용합니다. 먼저 Chrome CDP 환경을 시작한 후 본 스크립트를 실행하세요.
 * 수집 전략:
 *   1. 기본적으로 m.qidian.com의 SSR pageContext JSON을 우선 읽습니다(CDP에 의존하지 않으며, PC 사이트 보안 페이지를 우회합니다).
 *   2. 모바일 버전을 사용할 수 없을 때는 Chrome CDP를 사용하여 PC 페이지를 수집합니다.
 * Markdown 형식으로 출력하며 scan-output-format.md 규범을 준수합니다.
 *
 * 사용법:
 *   node qidian-rank-scraper.js --type hotsales               # 베스트셀러 순위표
 *   node qidian-rank-scraper.js --type yuepiao                 # 월간 투표 순위표
 *   node qidian-rank-scraper.js --type signnewbook             # 계약 작가 신작 순위표
 *   node qidian-rank-scraper.js --type pubnewbook              # 공개 저자 신작 랭킹
 *   node qidian-rank-scraper.js --type newauthor               # 신인 저자 신작 랭킹
 *   node qidian-rank-scraper.js --type newsign                 # 신인 계약 신작 랭킹
 *   node qidian-rank-scraper.js --type recom                   # 원창 추천 랭킹
 *   node qidian-rank-scraper.js --type sanjiang                 # 삼강 추천 (/sanjiang/, /rank/ 경로 아님)
 *   node qidian-rank-scraper.js --type all                     # 전체 순위표
 *   node qidian-rank-scraper.js --type hotsales --mode mobile  # 모바일 SSR만 사용
 *   node qidian-rank-scraper.js --type hotsales --mode cdp     # 백업 CDP/PC 페이지만 사용
 *
 * 사전 요구사항:
 *   기본 mobile/auto 모드는 Chrome이 필요하지 않습니다.
 *   CDP 모드에 필요: node {SKILL_DIR}/browser-cdp/scripts/setup-cdp-chrome.js 9222
 */

const fs = require("fs");
const https = require("https");
const path = require("path");
const { ab, sleep, evalJSON, scrollLoad, getArg, localDateStamp, runCli } = require("./cdp-utils");

const PC_BASE_URL = "https://www.qidian.com/rank";
const MOBILE_BASE_URL = "https://m.qidian.com";

/** 캡차 자동 재시도 최대 횟수 */
const MAX_CAPTCHA_RETRIES = 3;
/** 사용자가 수동으로 캡차를 해결하기 위해 기다리는 최대 초 */
const MAX_CAPTCHA_WAIT_SEC = 120;
/** 캡차 해제 여부를 폴링하는 간격(밀리초) */
const CAPTCHA_POLL_INTERVAL = 5000;

const MOBILE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Accept-Encoding": "identity",
};

const RANK_TYPES = [
  { id: "hotsales", label: "베스트셀러 랭킹", mobilePath: "/rank/hotsales/" },
  { id: "yuepiao", label: "월표 순위", mobilePath: "/rank/yuepiao/" },
  {
    id: "signnewbook",
    label: "계약 작가 신작 순위",
    mobilePath: "/rank/sign/",
    mobileLabel: "계약 순위",
  },
  {
    id: "pubnewbook",
    label: "공개 작가 신작 순위",
    mobilePath: "/rank/newbook/",
    mobileLabel: "신작 순위",
  },
  { id: "newauthor", label: "신인 작가 신작 랭킹", mobilePath: "/rank/newauthor/", mobileLabel: "신인 랭킹" },
  {
    id: "newsign",
    label: "신인 계약 신작 랭킹",
    mobilePath: "/rank/sign/",
    mobileLabel: "계약 랭킹",
  },
  { id: "recom", label: "오리지널 추천 랭킹", mobilePath: "/rank/rec/", mobileLabel: "추천 랭킹" },
  { id: "readindex", label: "열독 지수 랭킹", mobilePath: "/rank/readindex/" },
  {
    id: "collect",
    label: "수장 랭킹",
    mobilePath: "/rank/newfans/",
    mobileLabel: "서우 랭킹(모바일 대체)",
  },
  {
    id: "sanjiang",
    label: "3강 추천",
    baseUrl: "https://www.qidian.com/sanjiang/",
    mobilePath: "/sanjiang/",
  },
];

// ---------------------------------------------------------------------------
// 페이지 추출
// ---------------------------------------------------------------------------

/**
 * 기점 SSR 랭킹 페이지의 도서 목록을 추출합니다.
 * 起点 페이지 구조: .book-img-text ul > li, 각 li 내:
 *   h2 > a          → 책명+링크
 *   p.author         → 저자 | 장르 · 소장르 | 상태
 *   p.intro          → 개요
 *   p.update > a+span → 최신 업데이트 챕터+날짜
 */
function extractBookList(port) {
  const js =
    "JSON.stringify((()=>{" +
    "var items=[];" +
    "var lis=document.querySelectorAll('.book-img-text ul li');" +
    "if(!lis.length){" +
    // 폴백: H2 링크로 위치 결정
    "  var h2s=document.querySelectorAll('h2 a[href*=\"/book/\"]');" +
    "  h2s.forEach(function(a,idx){" +
    "    var c=a.parentElement;" +
    "    for(var j=0;j<3;j++){if(c.parentElement)c=c.parentElement}" +
    "    var text=c.innerText||'';" +
    "    var href=a.getAttribute('href')||a.href||'';" +
    "    var url=href?(href.indexOf('http')===0?href:'https:'+href):'';" +
    "    items.push({rank:idx+1,title:a.textContent.trim(),url:url,author:'',genre:'',status:'',descText:'',updateText:text.replace(/\\s+/g,' ').trim().substring(0,300)})" +
    "  });" +
    "  return items" +
    "}" +
    "lis.forEach(function(li,idx){" +
    "  var titleEl=li.querySelector('h2 a');" +
    "  if(!titleEl)return;" +
    "  var title=titleEl.textContent.trim();" +
    "  var href=titleEl.getAttribute('href')||titleEl.href||'';" +
    "  var url=href?(href.indexOf('http')===0?href:'https:'+href):'';" +
    // 저자: p.author > a.name
    "  var authorEl=li.querySelector('p.author a.name');" +
    "  var author=authorEl?authorEl.textContent.trim():'';" +
    // 장르: p.author > a (비 .name 비 .go-sub-type)
    "  var genreEls=li.querySelectorAll('p.author a');" +
    "  var genre='';var subGenre='';" +
    "  genreEls.forEach(function(a){" +
    "    if(a.classList.contains('name'))return;" +
    "    if(!genre){genre=a.textContent.trim()}else if(!subGenre){subGenre=a.textContent.trim()}" +
    "  });" +
    // 상태: p.author > span:last-child
    "  var statusEl=li.querySelector('p.author span');" +
    "  var status=statusEl?statusEl.textContent.trim():'';" +
    // 소개: p.intro
    "  var introEl=li.querySelector('p.intro');" +
    "  var descText=introEl?introEl.textContent.trim():'';" +
    // 업데이트: p.update
    "  var updateEl=li.querySelector('p.update');" +
    "  var updateText=updateEl?updateEl.textContent.replace(/\\s+/g,' ').trim():'';" +
    "  if(title){" +
    "    items.push({rank:idx+1,title:title,url:url,author:author,genre:genre+(subGenre?'·'+subGenre:''),status:status,descText:descText,updateText:updateText})" +
    "  }" +
    "});" +
    "return items" +
    "})())";
  return evalJSON(port, js) || [];
}

/** 상세 페이지에서 태그와 소개 추출 */
function extractDetail(port) {
  const js =
    "JSON.stringify((()=>{" +
    "var tags=Array.from(document.querySelectorAll('[class*=\"tag\"] a,[class*=\"label\"] a')).map(function(a){return a.textContent.trim()});" +
    "var intro=document.querySelector('[class*=\"intro\"],[class*=\"summary\"],[class*=\"desc\"]');" +
    "var introText=intro?intro.textContent.trim():'';" +
    "var update=document.querySelector('[class*=\"update\"],[class*=\"latest\"]');" +
    "var updateText=update?update.textContent.trim():'';" +
    "return {tags:tags,intro:introText,update:updateText}" +
    "})())";
  return evalJSON(port, js);
}

/**
 * 현재 페이지가 CAPTCHA/보안 인증으로 차단되었는지 감지합니다.
 * 起点 일반적인 차단 페이지 특징: 페이지에 CAPTCHA 키워드가 나타나거나, 페이지에 랭킹 DOM 요소가 없습니다.
 * @returns {{ blocked: boolean, reason: string } | null} 차단되면 사유 객체를 반환하고, 아니면 null
 */
function isCaptchaPage(port) {
  const js =
    "JSON.stringify((()=>{" +
    "var bodyText=document.body?(document.body.innerText||'').substring(0,3000):'';" +
    "var lower=bodyText.toLowerCase();" +
    "var keywords=['검증','captcha','verify','보안검증','슬라이더','드래그','검증을 완료하세요'," +
    "'혼원','사람과 기계 검증','비정상 요청','접근 검증','작업 빈번함','요청이 너무 많음','waf','잠시 후 다시 시도하세요'];" +
    "for(var i=0;i<keywords.length;i++){" +
    "  if(lower.indexOf(keywords[i])>-1){" +
    "    return {blocked:true,reason:keywords[i]};" +
    "  }" +
    "}" +
    "var hasContent=document.querySelector('.book-img-text ul li,.rank-body,.rank-list,.book-img-text');" +
    "if(!hasContent){" +
    "  return {blocked:true,reason:'페이지에 순위 목록 내용이 없음(차단되었을 수 있음)'};" +
    "}" +
    "return {blocked:false,reason:''};" +
    "})())";
  const result = evalJSON(port, js);
  return result && result.blocked === true ? result : null;
}

/**
 * URL을 열고 페이지 로드를 기다리며, 자동으로 인증 차단을 처리합니다.
 * 재시도 전략:
 *   1. 정상적으로 페이지 로드
 *   2. 검증 코드 감지 → 증분 지연 후 새로고침 재시도（최대 MAX_CAPTCHA_RETRIES 회）
 *   3. 계속 차단됨 → Chrome CDP 창에서 수동으로 검증 완료하도록 사용자에게 안내, 해제될 때까지 또는 타임아웃까지 폴링 대기
 *
 * @returns {boolean} true=페이지 준비됨, false=검증 코드를 통과할 수 없음
 */
function openWithCaptchaHandling(port, url) {
  for (let attempt = 1; attempt <= MAX_CAPTCHA_RETRIES; attempt++) {
    ab(port, "open", url);
    // 첫 번째 3초, 이후 매번 2초씩 추가 대기
    sleep(3000 + (attempt - 1) * 2000);

    const captcha = isCaptchaPage(port);
    if (!captcha) {
      return true;
    }
    console.log(`  ⚠ 보안 차단 감지됨 (${captcha.reason}), 재시도 ${attempt}/${MAX_CAPTCHA_RETRIES}회...`);
    // 대기 시간을 증가시킨 후 다시 시도
    sleep(attempt * 5000);
  }

  // 자동 재시도 전부 실패 → 사용자의 수동 처리 대기
  console.log(`  ⚠ 자동 재시도로 검증을 통과하지 못했습니다. Chrome CDP 창에서 수동으로 검증을 완료하세요`);
  console.log(`  ⏳ 수동 검증 대기 중(최대 ${MAX_CAPTCHA_WAIT_SEC}초)...`);

  const startTime = Date.now();
  while (Date.now() - startTime < MAX_CAPTCHA_WAIT_SEC * 1000) {
    sleep(CAPTCHA_POLL_INTERVAL);
    // 페이지를 새로고침하여 captcha가 해제되었는지 확인
    ab(port, "open", url);
    sleep(3000);
    const captcha = isCaptchaPage(port);
    if (!captcha) {
      console.log(`  ✓ captcha가 해제되었습니다. 계속 수집합니다`);
      return true;
    }
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(`  대기 중... (${elapsed}s)\r`);
  }
  console.log(`  ✗ 대기 시간 초과, captcha가 여전히 해제되지 않았습니다`);
  return false;
}

// ---------------------------------------------------------------------------
// 모바일 SSR 추출 (기본 경로)
// ---------------------------------------------------------------------------

function mobileUrl(pathname) {
  if (!pathname) return "";
  return pathname.startsWith("http") ? pathname : `${MOBILE_BASE_URL}${pathname}`;
}

function fetchText(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: MOBILE_HEADERS, timeout: 15000 }, (res) => {
      if (
        redirects > 0 &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        fetchText(nextUrl, redirects - 1).then(resolve, reject);
        return;
      }

      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(body);
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    req.on("error", reject);
  });
}

function extractMobilePageContext(html) {
  const m = html.match(
    /<script[^>]+id=["']vite-plugin-ssr_pageContext["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    console.log(`  ⚠ 모바일 pageContext JSON 파싱 실패: ${e.message}`);
    return null;
  }
}

function normalizeMobileBook(record, idx) {
  const title = record.bName || record.bookName || "";
  const bid = record.bid || record.bookId || "";
  const genre = [record.cat, record.subCat].filter(Boolean).join("·");
  const stats = [];
  if (record.cnt) stats.push(record.cnt);
  if (record.rankCnt) stats.push(`순위표 값 ${record.rankCnt}`);

  return {
    rank: record.rankNum || idx + 1,
    title,
    url: bid ? `${MOBILE_BASE_URL}/book/${bid}/` : "",
    author: record.bAuth || record.author || "",
    genre,
    status: stats.join(" · "),
    descText: record.desc || "",
    updateText: "",
  };
}

function renderMarkdown(rt, books, url, sourceMode, extraLines = []) {
  const now = new Date().toISOString();
  const lines = [
    `# 기점 · ${rt.label}`,
    "",
    `- 출처: ${url}`,
    `- 수집 방식: ${sourceMode}`,
    `- 스크래핑 시간: ${now}`,
    `- 항목 수: ${books.length}`,
    ...extraLines,
    "",
    "---",
    "",
  ];

  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    lines.push(`## #${b.rank || i + 1} ${b.title}`);
    const meta = [b.author, b.genre, b.status].filter(Boolean).join(" · ");
    if (meta) lines.push(`*${meta}*`);
    if (b.updateText) lines.push(`**최신 업데이트:** ${b.updateText}`);
    if (b.tags?.length) lines.push(`**태그:** ${b.tags.join("、")}`);
    if (b.url) lines.push(`[작품 페이지](${b.url})`);
    if (b.descText) {
      lines.push("");
      lines.push("**소개**");
      lines.push("");
      lines.push(b.descText);
    }
    lines.push("", "---", "");
  }

  return lines.join("\n");
}

async function scrapeRankMobile(rankTypeId) {
  const rt = RANK_TYPES.find((r) => r.id === rankTypeId);
  if (!rt) {
    console.log(`  ⚠ 알 수 없는 랭킹 타입: ${rankTypeId}`);
    return null;
  }
  if (!rt.mobilePath) {
    console.log(`  ⚠ 랭킹 ${rankTypeId}에 모바일 SSR 경로가 없습니다`);
    return null;
  }

  const url = mobileUrl(rt.mobilePath);
  console.log(`\n→ 치디안${rt.label}(모바일 SSR) 수집 중...`);
  console.log(`  URL: ${url}`);

  const html = await fetchText(url);
  const pageContext = extractMobilePageContext(html);
  const pageData = pageContext?.pageContext?.pageProps?.pageData;
  const records = pageData?.records || [];
  const books = records.map(normalizeMobileBook).filter((b) => b.title);

  if (!books.length) {
    console.log("  ⚠ 모바일 SSR에서 도서를 추출하지 못했습니다");
    return null;
  }

  console.log(`  ✓ ${books.length}권 추출됨`);

  const extraLines = [];
  if (rt.mobileLabel && rt.mobileLabel !== rt.label) {
    extraLines.push(`- 모바일 실제 순위표: ${rt.mobileLabel}`);
  }
  if (FETCH_DETAIL) {
    extraLines.push("- 설명: 모바일 SSR에는 이미 소개가 포함되어 있으며, --detail은 mobile/auto 모드에서 추가로 상세 페이지를 열지 않습니다.");
  }

  return renderMarkdown(rt, books, url, "mobile-ssr", extraLines);
}

// ---------------------------------------------------------------------------
// 메인 프로세스
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const PORT = parseInt(getArg(args, "--port") || "9222", 10);
const OUTDIR = getArg(args, "--outdir") || ".";
const RANKTYPE = getArg(args, "--type") || "hotsales";
const SCRAPE_MODE = getArg(args, "--mode") || "auto"; // auto | mobile | cdp
const FETCH_DETAIL = (getArg(args, "--detail") || "no") === "yes";

function scrapeRankCDP(port, rankTypeId) {
  const rt = RANK_TYPES.find((r) => r.id === rankTypeId);
  if (!rt) {
    console.log(`  ⚠ 알 수 없는 순위표 유형: ${rankTypeId}`);
    return null;
  }

  const url = rt.baseUrl || `${PC_BASE_URL}/${rankTypeId}/`;
  console.log(`\n→ 시작점${rt.label} 수집 중(CDP/PC)...`);
  console.log(`  URL: ${url}`);

  const pageReady = openWithCaptchaHandling(port, url);
  if (!pageReady) {
    console.log("  ✗ 시작점 수집 실패: 페이지가 CAPTCHA 차단을 통과하지 못함");
    return null;
  }

  scrollLoad(port, 3);
  sleep(1000);

  const books = extractBookList(port);
  if (!books.length) {
    console.log("  ⚠ 도서를 추출하지 못함");
    return null;
  }
  console.log(`  ✓ ${books.length}권 추출 완료`);

  // 선택사항: 각 항목의 상세 페이지에서 추가 데이터 가져오기
  if (FETCH_DETAIL) {
    console.log("  상세 페이지 보충 데이터를 가져오는 중...");
    for (let i = 0; i < Math.min(books.length, 20); i++) {
      const b = books[i];
      if (!b.url) continue;
      ab(port, "open", b.url);
      sleep(1500);
      const detail = extractDetail(port);
      if (detail) {
        if (detail.tags?.length) b.tags = detail.tags;
        if (detail.intro) b.descText = detail.intro;
        if (detail.update) b.updateText = detail.update;
      }
      console.log(`    [${i + 1}/${books.length}] ${b.title}`);
    }
    // 랭킹 페이지로 반환
    ab(port, "open", url);
    sleep(2000);
  }

  return renderMarkdown(rt, books, url, "cdp-pc");
}

async function scrapeRank(rankTypeId) {
  if (!["auto", "mobile", "cdp"].includes(SCRAPE_MODE)) {
    throw new Error(`알 수 없는 --mode: ${SCRAPE_MODE}(선택 가능: auto/mobile/cdp)`);
  }

  if (SCRAPE_MODE !== "cdp") {
    try {
      const content = await scrapeRankMobile(rankTypeId);
      if (content || SCRAPE_MODE === "mobile") return content;
    } catch (e) {
      console.log(`  ⚠ 모바일 SSR 수집 실패: ${e.message}`);
      if (SCRAPE_MODE === "mobile") return null;
    }
  }

  if (SCRAPE_MODE !== "mobile") {
    console.log("  → CDP/PC 페이지 수집으로 폴백");
    return scrapeRankCDP(PORT, rankTypeId);
  }

  return null;
}

async function main() {
  // 매개변수 오류는 설정 문제이므로 단일 순위표의 일시적 실패보다 먼저 처리됨: per-순위표 격리를 통한 빠른 실패
  if (!["auto", "mobile", "cdp"].includes(SCRAPE_MODE)) {
    throw new Error(`알 수 없는 --mode: ${SCRAPE_MODE}（선택 가능: auto/mobile/cdp）`);
  }

  const rankTypes = RANKTYPE === "all" ? RANK_TYPES.map((r) => r.id) : [RANKTYPE];
  let written = 0;
  let failed = 0;
  const partialReasons = [];

  for (const rt of rankTypes) {
    // per-순위표 격리: 모바일 SSR 실패 후 CDP 폴백은 직접 던짐 (ab()은 오류를 무시하지 않음)
    // 단일 순위표의 일시적 실패가 --type all 이후의 순위표를 중단해서는 안 됨 (토마토 노벨/시큐어캣과 일관성 유지)
    try {
      const content = await scrapeRank(rt);
      if (!content) {
        failed++;
        const rtInfo = RANK_TYPES.find((r) => r.id === rt);
        partialReasons.push(`${rtInfo ? rtInfo.label : rt}: no usable data`);
        continue;
      }

      const rtInfo = RANK_TYPES.find((r) => r.id === rt);
      const date = localDateStamp();
      const filename = `Qidian${rtInfo.label}_${date}.md`;
      fs.mkdirSync(OUTDIR, { recursive: true });
      const filepath = path.join(OUTDIR, filename);
      fs.writeFileSync(filepath, content, "utf-8");
      written++;
      console.log(`  ✓ 저장됨: ${filepath}`);
    } catch (rankErr) {
      failed++;
      const rtInfo = RANK_TYPES.find((r) => r.id === rt);
      const message = rankErr && rankErr.message ? rankErr.message : String(rankErr);
      partialReasons.push(`${rtInfo ? rtInfo.label : rt}: ${message}`);
      console.error(
        `[qidian] ${rtInfo ? rtInfo.label : rt} 수집 실패, 건너뜀: ${message}`
      );
    }
  }
  return {
    planned: rankTypes.length,
    written,
    failed,
    partial: failed > 0,
    partialReasons,
  };
}

if (require.main === module) {
  runCli(main, "치디안 수집");
}

module.exports = {
  extractBookList,
  mobileUrl,
  extractMobilePageContext,
  normalizeMobileBook,
  renderMarkdown,
};
