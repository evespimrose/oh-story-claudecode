#!/usr/bin/env node
/**
 * 흑암 단편 서고 목록 수집 스크립트
 *
 * ⚠️ 사전 조건(필수):
 *   1. Chrome CDP 환경 시작
 *   2. Chrome에서 수동 로그인 https://manage.zhangwenpindu.cn
 *      로그인하면 Admin-Token 쿠키가 생성되며, 스크립트는 이 쿠키로 백엔드 API를 호출합니다.
 *      미로그인 상태에서는 「Admin-Token을 찾지 못함」 오류가 발생합니다.
 *
 * 수집 방식: Cookie에서 Bearer token을 추출해 ms.zhangwenpindu.cn 백엔드 API를 호출합니다.
 * 구조화된 JSON 데이터(작품명·작가·글자 수·분류·태그 등)를 가져옵니다.
 *
 * 사용법:
 *   node heiyan-booklist-scraper.js --pages 5              # 앞 5페이지 수집(페이지당 20개)
 *   node heiyan-booklist-scraper.js --pages 3 --channel male   # 남성향만
 *   node heiyan-booklist-scraper.js --pages 2 --detail         # 작품별 상세 정보 포함(태그 등)
 */

const fs = require("fs");
const path = require("path");
const { ab, sleep, evalJSON, safeStr, getArg, localDateStamp, runCli } = require("./cdp-utils");

const BOOKLIST_URL = "https://manage.zhangwenpindu.cn/books/booklist";
const API_BASE = "https://ms.zhangwenpindu.cn";
const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// API 호출
// ---------------------------------------------------------------------------

/** 연결 상태 자가 점검: CDP 미연결과 연결되었지만 미로그인인 상태를 구분합니다. */
function probePage(port) {
  return evalJSON(port, "JSON.stringify({host:location.host})");
}

/** Cookie에서 Admin-Token 추출 */
function getToken(port) {
  const js =
    "JSON.stringify((()=>{" +
    "var m=document.cookie.match(/Admin-Token=([^;]+)/);" +
    "return m?m[1]:''" +
    "})())";
  return evalJSON(port, js) || "";
}

/** 백엔드 API를 호출해 작품 목록을 가져옵니다. */
function fetchBookList(port, token, pageNum) {
  const t = safeStr(token);
  const js =
    "fetch(" + safeStr(API_BASE + "/manage/book/list") + "," +
    "{method:'POST'," +
    "headers:{" +
    "'Content-Type':'application/x-www-form-urlencoded'," +
    "'Authorization':'Bearer '+" + t +
    "}," +
    "body:new URLSearchParams({pageNum:" + safeStr(pageNum) + ",pageSize:" + safeStr(PAGE_SIZE) + ",language:'zh_TW'})" +
    "}).then(function(r){return r.json()})";
  return evalJSON(port, js);
}

/** 백엔드 API를 호출해 작품 상세 정보(태그 등)를 가져옵니다. */
function fetchBookDetail(port, token, bookId) {
  const t = safeStr(token);
  const js =
    "fetch(" + safeStr(API_BASE + "/manage/book/" + encodeURIComponent(bookId)) + "," +
    "{headers:{'Authorization':'Bearer '+" + t + "}}" +
    ").then(function(r){return r.json()})";
  return evalJSON(port, js);
}

// ---------------------------------------------------------------------------
// 주요 흐름
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const PORT = parseInt(getArg(args, "--port") || "9222", 10);
const OUTDIR = getArg(args, "--outdir") || ".";
const PAGES = parseInt(getArg(args, "--pages") || "5", 10);
const CHANNEL = getArg(args, "--channel") || "all";
const DETAIL = args.includes("--detail");

/**
 * 글자 수 형식화: 천 단위 구분을 직접 처리하며 toLocaleString()은 사용하지 않습니다.
 * 후자는 호스트 ICU locale에 따라 구분자를 선택하므로 de_*에서는 「123.456자」로 표시되어 123자로 오해할 수 있고,
 * fr_*에서는 U+202F를, en-IN에서는 「1,23,456」을 사용해 같은 보고서의 숫자가 기기마다 달라집니다.
 * words를 문자열로 반환하는 호환 API도 처리합니다.
 */
function fmtWords(words) {
  const n =
    typeof words === "number"
      ? Math.trunc(words)
      : parseInt(String(words == null ? "" : words).replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "字";
}

function outputFilename(channel, date) {
  if (!["all", "male", "female"].includes(channel)) {
    throw new Error(`알 수 없는 --channel: ${channel}(male/female/all 지원)`);
  }
  return `黑岩书库列表_${channel}_${date}.md`;
}

function buildAndSave(allBooks, total, filtered, filepath) {
  const now = new Date().toISOString();
  const maleBooks = filtered.filter((b) => b.classifyStr === "男频");
  const femaleBooks = filtered.filter((b) => b.classifyStr === "女频");
  const otherBooks = filtered.filter(
    (b) => b.classifyStr !== "男频" && b.classifyStr !== "女频"
  );

  const groups = [
    { label: "男频", books: maleBooks },
    { label: "女频", books: femaleBooks },
  ];
  if (otherBooks.length) {
    groups.push({ label: "其他", books: otherBooks });
  }

  const lines = [
    `# 黑岩 · 书库列表`,
    "",
    `- 来源：${BOOKLIST_URL}`,
    `- 抓取时间：${now}`,
    `- 总条目：${total}`,
    `- 已采集：${filtered.length} 条（${PAGES} 页）`,
    DETAIL ? "- 含详情（标签、简介）" : "- 列表模式（加 --detail 获取标签和简介）",
    "",
    "---",
    "",
  ];

  for (const g of groups) {
    if (!g.books.length) continue;
    lines.push(`## ${g.label}短篇 — ${g.books.length} 本`, "");

    for (let i = 0; i < g.books.length; i++) {
      try {
        const b = g.books[i];
        lines.push(`### #${i + 1} ${b.name}`);
        const meta = [
          b.userName,
          // 배열에 나누어 담은 뒤 합칩니다. classifyStr + "/" + typeDesc를 미리 이어 붙이면 누락 필드가
          // 「undefined/undefined」 같은 참 문자열이 되어 filter(Boolean)으로 걸러지지 않고 보고서에 그대로 기록됩니다.
          [b.classifyStr, b.typeDesc].filter(Boolean).join("/"),
          fmtWords(b.words),
          b.price ? b.price + "钻" : "",
          b.open ? "公开" : "未公开",
        ].filter(Boolean).join(" · ");
        if (meta) lines.push(`*${meta}*`);

        if (b.createTime) lines.push(`**创建：** ${b.createTime}`);
        if (b.updateTime) lines.push(`**更新：** ${b.updateTime}`);

        if (b.tags && b.tags.length) {
          lines.push(`**标签：** ${b.tags.join("、")}`);
        }

        if (b.description) {
          lines.push("");
          lines.push(`> ${b.description.substring(0, 200)}${b.description.length > 200 ? "..." : ""}`);
        }

        lines.push("");
      } catch (bookErr) {
        console.error(`[heiyan] ${g.label} ${i + 1}번째 항목 처리 오류: ${bookErr.message}`);
        lines.push("");
      }
    }

    lines.push("---", "");
  }

  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(filepath, lines.join("\n"), "utf-8");
  console.log(`  ✓ 저장 완료: ${filepath}`);
}

function main() {
  console.log("\n→ 흑암 서고 목록 수집 중(API 모드)...");
  console.log(`  수집 계획: ${PAGES}페이지(페이지당 ${PAGE_SIZE}개)`);

  const date = localDateStamp();
  const filename = outputFilename(CHANNEL, date);
  const filepath = path.join(OUTDIR, filename);

  // 먼저 관리 콘솔로 이동해 token을 가져옵니다.
  let token;
  try {
    ab(PORT, "open", BOOKLIST_URL);
    sleep(3000);

    // 연결 상태 자가 점검: "CDP가 시작되지 않음"과 "미로그인"을 구분해 사용자가 불필요하게 로그인하도록 유도하지 않습니다.
    const probe = probePage(PORT);
    if (!probe) {
      console.error(
        `  ✗ CDP가 응답하지 않습니다. browser-cdp로 Chrome을 시작했는지(포트 ${PORT}), agent-browser를 사용할 수 있는지 확인하세요.`
      );
      return 0;
    }

    token = getToken(PORT);
  } catch (err) {
    console.error(`[heiyan] 페이지 로드 또는 token 추출 오류: ${err.message}`);
    return 0;
  }

  if (!token) {
    console.log("  ✗ Admin-Token을 찾지 못했습니다(CDP는 연결되었지만 현재 로그인하지 않음).");
    console.log("  → 먼저 Chrome에서 https://manage.zhangwenpindu.cn을 열고 로그인하세요.");
    console.log("  → 로그인한 뒤 이 스크립트를 다시 실행하세요.");
    return 0;
  }
  console.log("  ✓ 인증 token을 가져왔습니다.");

  // 페이지 단위 수집
  const allBooks = [];
  let total = 0;

  for (let p = 1; p <= PAGES; p++) {
    try {
      sleep(800);
      const resp = fetchBookList(PORT, token, p);

      // 실패 원인을 구분합니다: API 무응답(시간 초과/CDP) / 401 권한 없음
      if (!resp) {
        console.error(`  ✗ ${p}페이지 API가 응답하지 않아 중단합니다(요청 시간 초과 또는 CDP 중단).`);
        break;
      }
      if (resp.code === 401) {
        console.log(`  ⚠ ${p}페이지 인증에 실패했습니다(401). 다시 로그인한 뒤 재시도하세요.`);
        break;
      }

      const rows = resp?.data?.rows;
      if (!rows || !rows.length) {
        // 데이터가 없을 때만 code로 "서버 오류"와 "정상적인 데이터 종료"를 구분해,
        // 비정상적인 성공 code를 포함한 유효한 응답을 오류로 잘못 판단하지 않습니다( rows가 있으면 항상 통과).
        if (resp.code != null && resp.code !== 0 && resp.code !== 200) {
          console.error(`  ✗ ${p}페이지 API가 오류를 반환했습니다(code=${resp.code}) ${resp.msg || ""}. 중단합니다.`);
        } else {
          console.log(`  ${p}페이지에 데이터가 없어 중단합니다.`);
        }
        break;
      }

      if (p === 1) {
        total = parseInt(resp.data.total) || 0;
        console.log(`  전체 항목: ${total}`);
      }

      allBooks.push(...rows);
      console.log(`  ${p}페이지: ${rows.length}개(누적 ${allBooks.length}개)`);
    } catch (pageErr) {
      console.error(`[heiyan] ${p}페이지 수집 오류, 건너뜁니다: ${pageErr.message}`);
      if (allBooks.length > 0) {
        console.log(`  ${allBooks.length}개를 수집했으며 기존 데이터를 계속 처리합니다.`);
      }
      break;
    }
  }

  if (!allBooks.length) {
    console.error("[heiyan] 수집 실패: 작품 목록을 가져오지 못했습니다. 로그인 만료나 API 변경이 원인일 수 있으므로 다시 로그인한 뒤 재시도하세요.");
    return 0;
  }

  // 품질 게이트: 핵심 필드 적중률을 확인합니다. API가 필드명을 바꾸면 전체가 undefined가 되므로 조용히 파일에 쓰지 않고 차단해야 합니다.
  // classifyStr도 확인해야 합니다. 이 값이 남성향·여성향 그룹과 --channel 필터를 결정하므로 필드가 바뀌면 모든 작품이
  // 「기타」로 들어가고 --channel male의 결과가 0개가 되어 「수집 완료: 0개」라는 가짜 성공 보고서가 작성됩니다.
  const CORE_FIELDS = [
    { key: "name", label: "书名" },
    { key: "classifyStr", label: "频道(classifyStr)" },
  ];
  for (const f of CORE_FIELDS) {
    const hit = allBooks.filter((b) => b && b[f.key]).length;
    if (hit / allBooks.length < 0.5) {
      console.error(
        `[heiyan] 수집 실패: ${allBooks.length}개 중 ${hit}개에만 ${f.label}이 있습니다. API 필드가 바뀐 것으로 보여 파일 저장을 포기합니다.`
      );
      return 0;
    }
  }

  // 채널 필터
  let filtered = allBooks;
  if (CHANNEL === "male" || CHANNEL === "female") {
    const want = CHANNEL === "male" ? "男频" : "女频";
    filtered = allBooks.filter((b) => b.classifyStr === want);
    if (!filtered.length) {
      // 0개로 필터링된 것은 성공으로 볼 수 없습니다. 실제 classifyStr 분포를 출력해 「API 필드가 바뀐 경우」와
      // 「이 채널에 실제로 작품이 없는 경우」를 구분하며, 원인을 알 수 없는 빈 보고서를 작성하지 않습니다.
      const seen = {};
      for (const b of allBooks) {
        const k = b && b.classifyStr ? b.classifyStr : "(空)";
        seen[k] = (seen[k] || 0) + 1;
      }
      const dist = Object.keys(seen).map((k) => `${k}×${seen[k]}`).join("、");
      console.error(
        `[heiyan] 수집 실패: --channel ${CHANNEL} 필터 결과가 0개입니다(${allBooks.length}개의 classifyStr 값: ${dist}). 파일 저장을 포기합니다.`
      );
      console.error(`  → 정말 ${want} 작품이 없다면 --channel을 제거하고 다시 실행해 전체 목록을 가져오세요.`);
      return 0;
    }
  }

  // 선택 사항: 작품별 상세 정보(태그 등)를 가져옵니다.
  if (DETAIL && filtered.length) {
    console.log(`  ${filtered.length}개 작품의 상세 정보를 가져오는 중...`);
    for (let i = 0; i < filtered.length; i++) {
      try {
        sleep(500);
        const detail = fetchBookDetail(PORT, token, filtered[i].id);
        if (detail?.data) {
          filtered[i].tags = detail.data.tags || [];
          filtered[i].description = detail.data.description || "";
          filtered[i].chapterCount = detail.data.chapterCount || 0;
        }
        if ((i + 1) % 10 === 0) {
          console.log(`    ${i + 1}/${filtered.length} 가져옴`);
        }
      } catch (detailErr) {
        console.error(`[heiyan] ${i + 1}번째 작품의 상세 정보 가져오기 오류, 건너뜁니다: ${detailErr.message}`);
      }
    }
    console.log("  ✓ 상세 정보 가져오기 완료");
  }

  buildAndSave(allBooks, total, filtered, filepath);
  return 1;
}

if (require.main === module) {
  runCli(main, "흑암 수집");
}

module.exports = {
  probePage,
  getToken,
  fetchBookList,
  fetchBookDetail,
  fmtWords,
  outputFilename,
  buildAndSave,
};
