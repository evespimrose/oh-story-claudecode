#!/usr/bin/env node
/**
 * 판치에 소설 순위 수집 스크립트
 *
 * browser-cdp 스킬과 함께 사용합니다. 먼저 Chrome CDP 환경을 시작한 뒤 이 스크립트를 실행합니다.
 * 수집 방식: 순위 페이지의 __INITIAL_STATE__에서 구조화된 목록을 가져온 뒤, 각 작품의 상세 페이지를 요청해 실제
 * 작품명·작가·소개·장르·태그를 해독합니다(판치에 목록 페이지에는 폰트 기반 크롤링 방지가 있지만, 상세 페이지 HTML에는 평문이 들어 있습니다).
 * 출력 Markdown 형식은 scan-output-format.md 규격에 맞춥니다.
 *
 * 사용법:
 *   node fanqie-rank-scraper.js --channel 1 --type 2              # 남성향 독서 순위
 *   node fanqie-rank-scraper.js --channel 0 --type 1              # 여성향 신작 순위
 *   node fanqie-rank-scraper.js --channel 1 --type 2 --outdir ./  # 출력 디렉터리 지정
 *   node fanqie-rank-scraper.js --channel all                     # 전체 수집
 *   node fanqie-rank-scraper.js --channel 1 --top 15              # 장르별 상위 15개만 수집
 *
 * 사전 조건:
 *   node {SKILL_DIR}/browser-cdp/scripts/setup-cdp-chrome.js 9222
 */

const fs = require("fs");
const path = require("path");
const { ab, sleep, evalJSONBase64, scrollLoad, getArg, localDateStamp, runCli } = require("./cdp-utils");

// 상세 요청의 동시 처리 배치 크기입니다. 판치에 상세 페이지는 동기 XHR로 가져오므로 배치가 너무 크면
// cdp-utils의 ab() 20초 제한에 걸립니다. 시간 초과가 명시적으로 실패 처리되므로, 전체 장르 수집이 중단되지 않도록 나누어 처리합니다.
const DETAIL_CHUNK = 5;

// ---------------------------------------------------------------------------
// 페이지 추출
// ---------------------------------------------------------------------------

/** 연결 상태 및 페이지 준비 여부 자가 점검 */
function probePage(port) {
  return evalJSONBase64(
    port,
    "JSON.stringify({host:location.host,hasState:!!window.__INITIAL_STATE__})"
  );
}

/** 구성: 사이드 메뉴 장르 링크를 추출하는 브라우저 JS */
function buildCategoriesJS(prefix) {
  return `JSON.stringify((function(){
    var prefix=${JSON.stringify(prefix)};
    var out=[];var seen={};
    Array.from(document.querySelectorAll('a')).forEach(function(a){
      var href=a.getAttribute('href')||'';
      if(href.indexOf(prefix)===-1)return;
      var name=(a.innerText||a.textContent||'').trim();
      if(!name)return;
      if(seen[href])return;seen[href]=1;
      out.push({name:name,href:href});
    });
    return out;
  })())`;
}

/** 사이드 메뉴 장르 링크 추출 */
function extractCategories(port, channel, type) {
  const prefix = `/rank/${channel}_${type}_`;
  return evalJSONBase64(port, buildCategoriesJS(prefix)) || [];
}

/**
 * __INITIAL_STATE__에서 현재 장르 페이지의 작품 목록을 추출합니다.
 * 여러 경로를 시도하고 깊이 우선의 대체 검색을 수행한 뒤 필드명을 정규화해, 사이트가 state 구조를 바꾸더라도 전체가 실패하지 않게 합니다.
 */
function buildBookListJS() {
  return `JSON.stringify((function(){
    var s=window.__INITIAL_STATE__||{};
    var cands=[
      s.rank&&s.rank.book_list, s.rank&&s.rank.bookList, s.rank&&s.rank.rankList,
      s.rankData&&s.rankData.book_list, s.page&&s.page.book_list
    ];
    var list=null;
    for(var i=0;i<cands.length;i++){ if(Array.isArray(cands[i])&&cands[i].length){list=cands[i];break;} }
    if(!list){
      var found=null;
      (function walk(o,d){
        if(found||!o||d>6)return;
        if(Array.isArray(o)){
          if(o.length&&o[0]&&typeof o[0]==='object'&&(o[0].bookId||o[0].book_id)){found=o;return;}
          for(var j=0;j<o.length&&!found;j++)walk(o[j],d+1);return;
        }
        if(typeof o==='object'){ for(var k in o){ if(found)break; try{walk(o[k],d+1)}catch(e){} } }
      })(s,0);
      list=found||[];
    }
    return list.map(function(b){return {
      bookId:String(b.bookId||b.book_id||''),
      read_count:b.read_count||b.readCount||b.read||'',
      wordNumber:b.wordNumber||b.word_number||b.wordCount||'',
      creationStatus:(b.creationStatus!=null?b.creationStatus:(b.creation_status!=null?b.creation_status:b.status)),
      lastChapterTitle:b.lastChapterTitle||b.last_chapter_title||b.lastChapter||'',
      category:b.category||b.categoryName||b.category_name||''
    };}).filter(function(b){return b.bookId;});
  })())`;
}

function extractBookList(port) {
  const list = evalJSONBase64(port, buildBookListJS());
  return Array.isArray(list) ? list : [];
}

/**
 * 상세 정보 일괄 해독: 작품별로 /page/{id}에 동기 XHR을 요청하고 여러 전략으로 평문 필드를 파싱합니다.
 * 판치에 목록 페이지의 작품명·작가는 폰트 기반 크롤링 방지 대상이지만, 상세 페이지 HTML에 포함된 JSON과 <title>에는 평문이 있습니다.
 * 필드명은 실제 SSR(__INITIAL_STATE__)을 기준으로 합니다. bookName/author/abstract는 평문이고,
 * 장르는 categoryV2(이스케이프된 JSON 배열의 첫 번째 Name)에 있으며, 판치에 SSR에는 숫자 평점이 없습니다.
 * { id: {title, author, desc, category, tags} } 형식으로 반환합니다.
 */
function buildDetailJS(ids) {
  return `JSON.stringify((function(){
    var ids=${JSON.stringify(ids)};
    var map={};
    function pick(h,res){for(var i=0;i<res.length;i++){var m=h.match(res[i]);if(m&&m[1])return m[1].trim();}return '';}
    for(var k=0;k<ids.length;k++){
      var id=ids[k];
      try{
        var x=new XMLHttpRequest();
        x.open('GET','/page/'+id,false);
        x.send();
        var h=x.responseText||'';
        var title=pick(h,[
          /"bookName"\\s*:\\s*"([^"]+)"/,
          /<title>([^<]*?)(?:完整版|最新章节|在线阅读|_番茄小说|-番茄小说|_番茄|-番茄)/,
          /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/,
          /<title>([^<|_]{1,40})/
        ]);
        var author=pick(h,[
          /"author"\\s*:\\s*"([^"]+)"/,
          /"authorName"\\s*:\\s*"([^"]+)"/,
          /<meta[^>]+property="og:novel:author"[^>]+content="([^"]+)"/
        ]);
        // abstract(실제 소개)을 우선합니다. meta description은 플랫폼 템플릿("番茄小说提供...")이고,
        // data-rh 속성을 포함하는 경우가 많으므로 속성 순서를 넓게 허용해 대체 파싱합니다.
        var abs=pick(h,[/"abstract"\\s*:\\s*"([^"]{6,}?)"/]);
        var desc=abs||pick(h,[
          /<meta[^>]+name="description"[^>]+content="([^"]+)"/,
          /<meta[^>]+property="og:description"[^>]+content="([^"]+)"/
        ]);
        // 장르: category는 빈 문자열인 경우가 많고, 실제 장르는 categoryV2(이스케이프된 JSON)의 첫 번째 Name에 있습니다.
        var category=pick(h,[
          /"categoryV2":"\\[\\{[\\s\\S]*?\\\\"Name\\\\":\\\\"([^"\\\\]+)/,
          /"category"\\s*:\\s*"([^"]{1,20})"/,
          /<meta[^>]+property="og:novel:category"[^>]+content="([^"]+)"/
        ]);
        // 태그: 판치에 소개 앞부분에는 장르 세분화를 나타내는 【tag+tag+...】 형식이 자주 붙습니다.
        var tags='';
        var bm=(abs||desc||'').match(/[【\\[]([^】\\]]{2,40})[】\\]]/);
        if(bm){tags=bm[1].split(/[+、,\\/\\s]+/).filter(Boolean).slice(0,6).join('、');}
        map[id]={title:title,author:author,desc:desc,category:category,tags:tags};
      }catch(e){
        map[id]={title:'',author:'',desc:'',category:'',tags:'',err:String(e&&e.message||e)};
      }
    }
    return map;
  })())`;
}

function fetchDetailsChunk(port, ids) {
  return evalJSONBase64(port, buildDetailJS(ids)) || {};
}

/** 단일 eval 시간 초과를 피하도록 나누어 해독하고 병합된 map을 반환합니다. */
function fetchDetails(port, bookIds) {
  const map = {};
  for (let i = 0; i < bookIds.length; i += DETAIL_CHUNK) {
    const chunk = bookIds.slice(i, i + DETAIL_CHUNK);
    const part = fetchDetailsChunk(port, chunk);
    Object.assign(map, part);
    sleep(300);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 형식화
// ---------------------------------------------------------------------------

function fmtReads(count) {
  if (!count || count === "0") return "未知";
  const n = parseInt(count, 10);
  if (isNaN(n)) return "未知";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}

function fmtWords(count) {
  if (!count) return "未知";
  const n = parseInt(count, 10);
  if (isNaN(n)) return "未知";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}

function fmtStatus(s) {
  const v = String(s);
  if (v === "1") return "连载中";
  if (v === "0" || v === "2") return "已完结";
  return s ? String(s) : "未知";
}

/** 소개 정리: 플랫폼 템플릿 문구 제거 → 공백 축약 → 문장 끝 기준 100자 자르기 */
function cleanDesc(raw) {
  if (!raw) return "";
  let d = String(raw)
    // 소개는 JSON 문자열 원문에서 가져오므로, 먼저 일반적인 이스케이프(\n, \uXXXX, \" 등)를 복원합니다.
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[nrt]/g, " ")
    .replace(/\\"/g, '"')
    .replace(/番茄小说[^。！？]*?(?:免费阅读|完整版|在线阅读)[^。！？]*[。！？]/g, "")
    .replace(/番茄小说[^。！？]*?(?:免费阅读|完整版|在线阅读)[^。！？]*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (d.length <= 100) return d;
  const cut = d.slice(0, 100);
  const m = cut.match(/^[\s\S]*[。！？]/);
  return (m ? m[0] : cut) + "...";
}

// ---------------------------------------------------------------------------
// 주요 흐름
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const PORT = parseInt(getArg(args, "--port") || "9222", 10);
const OUTDIR = getArg(args, "--outdir") || ".";
const CHANNEL = getArg(args, "--channel") || "1";
const TYPE = getArg(args, "--type") || "2";
const TOP = parseInt(getArg(args, "--top") || "20", 10);

function channelLabel(ch) {
  return ch === "1" ? "男频" : "女频";
}

function typeLabel(t) {
  return t === "2" ? "阅读榜" : "新书榜";
}

function scrapeChannel(ch, type) {
  const chLabel = channelLabel(ch);
  const tyLabel = typeLabel(type);
  console.log(`\n→ ${chLabel}${tyLabel} 수집 중...`);

  // 알려진 장르 ID를 진입점으로 사용해 메뉴에 현재 채널·유형의 장르만 표시되도록 합니다.
  const initCatId = ch === "1" ? "1141" : "1139"; // 남성향: 서양 판타지 / 여성향: 고풍 세정
  const initUrl = `https://fanqienovel.com/rank/${ch}_${type}_${initCatId}`;
  ab(PORT, "open", initUrl);
  sleep(3000);

  // 연결 상태 자가 점검: "bookId만 조용히 출력되는 현상"을 조치 가능한 오류로 바꿉니다.
  const probe = probePage(PORT);
  if (!probe) {
    console.error(
      `  ✗ CDP가 응답하지 않습니다. browser-cdp로 Chrome을 시작했는지(포트 ${PORT}), agent-browser를 사용할 수 있는지 확인하세요.`
    );
    return null;
  }
  if (probe.host && probe.host.indexOf("fanqie") === -1) {
    console.error(
      `  ✗ 현재 페이지는 판치에가 아닙니다(host=${probe.host}). 로그인·인증 페이지로 리디렉션되었을 수 있어 건너뜁니다.`
    );
    return null;
  }
  if (!probe.hasState) {
    console.error(`  ⚠ 페이지에 __INITIAL_STATE__가 연결되지 않았습니다. 대체 검색을 시도하지만 결과가 불완전할 수 있습니다.`);
  }

  let categories = extractCategories(PORT, ch, type);
  if (!categories.length) {
    // 메뉴가 지연 로드되었을 수 있으므로 스크롤 후 한 번 더 시도합니다.
    scrollLoad(PORT, 2);
    sleep(1000);
    categories = extractCategories(PORT, ch, type);
  }
  if (!categories.length) {
    // 여전히 실패하면 현재 진입 페이지만 수집하도록 낮춰, 빈 실행 대신 최소한의 데이터를 출력합니다.
    console.log(`  ⚠ 장르 메뉴를 추출하지 못해 단일 장르 수집(진입 페이지)으로 전환합니다.`);
    categories = [{ name: "全部（入口页）", href: `/rank/${ch}_${type}_${initCatId}` }];
  } else {
    console.log(`  장르 ${categories.length}개를 찾았습니다.`);
  }

  const now = new Date().toISOString();
  const lines = [
    `# 番茄 · ${chLabel}${tyLabel} · 全 ${categories.length} 题材`,
    "",
    `- 频道参数：channel=${ch}，type=${type}`,
    `- 抓取时间：${now}`,
    `- 每题材上限 ≈ ${TOP}`,
    "",
    "---",
    "",
  ];

  let totalBooks = 0;
  let resolvedTitles = 0;
  const bodyLines = [];

  for (let ci = 0; ci < categories.length; ci++) {
    const cat = categories[ci];
    console.log(`  [${ci + 1}/${categories.length}] ${cat.name}`);

    try {
      ab(PORT, "open", `https://fanqienovel.com${cat.href}`);
      sleep(2500);
      scrollLoad(PORT, 2);

      let books = extractBookList(PORT);
      if (!Array.isArray(books) || !books.length) {
        bodyLines.push(`## ${cat.name} — 0 本`, "", "---", "");
        continue;
      }
      if (books.length > TOP) books = books.slice(0, TOP);

      // 실제 작품명·작가·소개·장르·평점·태그를 나누어 해독합니다.
      const bookIds = books.map((b) => String(b.bookId));
      const details = fetchDetails(PORT, bookIds);

      bodyLines.push(`## ${cat.name} — ${books.length} 本`, "");

      for (let i = 0; i < books.length; i++) {
        const b = books[i];
        const info = details[String(b.bookId)] || {};
        totalBooks++;
        const resolved = !!info.title;
        if (resolved) resolvedTitles++;

        const title = info.title || "（标题待解析）";
        const author = info.author || "未知";
        const category = info.category || b.category || "";
        const catSeg = category ? ` · ${category}` : "";

        bodyLines.push(`### #${i + 1} ${title}`);
        bodyLines.push(
          `*${author}${catSeg} · ${fmtStatus(b.creationStatus)} · ${fmtReads(b.read_count)} 在读 · ${fmtWords(b.wordNumber)}字*`
        );
        if (info.tags) bodyLines.push(`**标签：** ${info.tags}`);
        bodyLines.push(`**最新更新：** ${b.lastChapterTitle || "未知"}`);
        bodyLines.push(`**bookId：** ${b.bookId}`);
        bodyLines.push(`[作品页](https://fanqienovel.com/page/${b.bookId})`);
        const desc = cleanDesc(info.desc);
        if (desc) {
          bodyLines.push("");
          bodyLines.push("**简介**");
          bodyLines.push("");
          bodyLines.push(desc);
        }
        bodyLines.push("");
      }

      bodyLines.push("---", "");
    } catch (catErr) {
      console.error(
        `  [fanqie] 장르 ${cat.name} 처리 중 오류가 발생해 건너뜁니다: ${catErr && catErr.message ? catErr.message : catErr}`
      );
      bodyLines.push(`## ${cat.name} — 采集失败`, "", "---", "");
    }
  }

  // 품질 상태: 제목 파싱 비율은 판치에 수집의 성패를 판단하는 핵심 신호입니다.
  const ratio = totalBooks ? resolvedTitles / totalBooks : 0;
  const quality = totalBooks === 0
    ? "[无数据]"
    : ratio < 0.5
      ? "[标题解析异常]"
      : "[OK]";
  lines.splice(5, 0,
    `- 标题解析：成功 ${resolvedTitles} / 共 ${totalBooks}`,
    `- 数据质量：${quality}`
  );

  if (totalBooks > 0 && resolvedTitles === 0) {
    console.error(
      `  ✗ ${chLabel}${tyLabel}: ${totalBooks}권 모두 제목 파싱에 실패했습니다. 상세 페이지 구조 변경이나 로그인·인증 차단일 가능성이 높습니다.` +
      `Chrome에서 다음 주소 중 하나를 직접 열어 페이지가 정상인지 확인하세요: https://fanqienovel.com/page/{bookId}`
    );
  } else if (ratio < 0.5) {
    console.error(
      `  ⚠ ${chLabel}${tyLabel}: 제목 파싱률이 낮습니다(${resolvedTitles}/${totalBooks}). 결과에 품질 표시를 추가했습니다.`
    );
  }

  return lines.concat(bodyLines).join("\n");
}

function main() {
  const channels = CHANNEL === "all" ? ["1", "0"] : [CHANNEL];
  const types = TYPE === "all" ? ["2", "1"] : [TYPE];
  let written = 0;

  for (const ch of channels) {
    for (const ty of types) {
      try {
        const content = scrapeChannel(ch, ty);
        if (!content) continue;

        const date = localDateStamp();
        const filename = `番茄${channelLabel(ch)}${typeLabel(ty)}_全题材_${date}.md`;
        fs.mkdirSync(OUTDIR, { recursive: true });
        const filepath = path.join(OUTDIR, filename);
        fs.writeFileSync(filepath, content, "utf-8");
        written++;
        console.log(`  ✓ 저장 완료: ${filepath}`);
      } catch (chErr) {
        console.error(
          `[fanqie] ${channelLabel(ch)}${typeLabel(ty)} 수집에 실패해 건너뜁니다: ${chErr && chErr.message ? chErr.message : chErr}`
        );
      }
    }
  }
  return written;
}

if (require.main === module) {
  runCli(main, "番茄采集");
}

// 파싱 로직을 sandbox에서 검증할 수 있도록 순수 함수와 JS 빌더를 내보냅니다.
module.exports = {
  buildCategoriesJS,
  buildBookListJS,
  buildDetailJS,
  fmtReads,
  fmtWords,
  fmtStatus,
  cleanDesc,
};
