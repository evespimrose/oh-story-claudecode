#!/usr/bin/env node
/**
 * 刺猬猫 독서 순위 수집 스크립트
 *
 * `browser-cdp` skill과 함께 사용한다. 먼저 Chrome CDP 환경을 시작한 뒤 이 스크립트를 실행한다.
 * 수집 방식: 刺猬猫의 `rank-index` 페이지는 한 페이지에 모든 순위를 표시하므로, 텍스트를 파싱해 구조화된 데이터를 추출한다.
 * 출력 Markdown 형식은 `scan-output-format.md` 규격에 맞춘다.
 *
 * 사용법:
 *   node ciweimao-rank-scraper.js --type click       # 클릭 순위
 *   node ciweimao-rank-scraper.js --type monthly      # 월간 투표 순위
 *   node ciweimao-rank-scraper.js --type all           # 전체 순위
 *
 * 사전 조건:
 *   node {SKILL_DIR}/browser-cdp/scripts/setup-cdp-chrome.js 9222
 */

const fs = require("fs");
const path = require("path");
const { ab, sleep, evalJSONBase64, scrollLoad, getArg, localDateStamp, runCli } = require("./cdp-utils");

const RANK_URL = "https://www.ciweimao.com/rank-index";

/** 연결 상태 및 페이지 준비 여부 자체 점검 */
function probePage(port) {
  return evalJSONBase64(
    port,
    "JSON.stringify({host:location.host,len:(document.body&&document.body.innerText||'').length})"
  );
}

const RANK_TYPES = [
  { id: "click", label: "点击榜", header: "点击榜" },
  { id: "favor", label: "收藏榜", header: "收藏榜" },
  { id: "recommend", label: "推荐榜", header: "推荐榜" },
  { id: "subscribe", label: "订阅榜", header: "订阅榜" },
  { id: "monthly", label: "月票榜", header: "月票榜" },
  { id: "tsukkomi", label: "吐槽榜", header: "吐槽榜" },
  { id: "newbook", label: "新书榜", header: "新书榜" },
  { id: "blade", label: "刀片榜", header: "刀片榜" },
  { id: "update", label: "更新榜", header: "更新榜" },
];

// ---------------------------------------------------------------------------
// 页面提取
// ---------------------------------------------------------------------------

/**
 * `rank-index` 단일 페이지에서 모든 순위를 파싱한다.
 * 페이지 구조: 각 순위에는 제목 행(예: "点击榜") 뒤에 NO.1 특수 항목과 #2-10 일반 항목이 이어진다.
 * NO.1 형식: 제목 / 작가 / 지표 값(세 줄)
 * #2-10 형식: N[장르]도서명 / 지표 값(두 줄)
 */
function extractAllRanks(port) {
  const js =
    "JSON.stringify((()=>{" +
    "var text=document.body.innerText||'';" +
    "var lines=text.split(/\\n/).map(function(l){return l.trim()}).filter(Boolean);" +
    "var headers=['点击榜','收藏榜','推荐榜','订阅榜','月票榜','吐槽榜','新书榜','刀片榜','更新榜'];" +
    "var sections=[];var curName='';var curEntries=[];" +
    "for(var i=0;i<lines.length;i++){" +
    "  var line=lines[i];" +
    // 새 섹션 감지
    "  var headerIdx=headers.indexOf(line);" +
    "  if(headerIdx>=0){" +
    "    if(curName&&curEntries.length)sections.push({name:curName,entries:curEntries});" +
    "    curName=headers[headerIdx];curEntries=[];continue" +
    "  }" +
    "  if(!curName)continue;" +
    // 기간 탭과 UI 문구 건너뛰기
    "  if(/^(周榜|月榜|总榜)$/.test(line))continue;" +
    // NO.1 항목
    "  if(line==='NO.1'&&i+3<lines.length){" +
    "    var t=lines[i+1]||'';var a=lines[i+2]||'';var v=lines[i+3]||'';" +
    "    if(headers.indexOf(v)>=0)continue;" +
    "    curEntries.push({rank:1,title:t,author:a,genre:'',metric:v});" +
    "    i+=2;continue" +
    "  }" +
    // #2-10 항목: N[장르]도서명
    "  var rm=line.match(/^(\\d{1,2})\\[(.+?)\\](.+)$/);" +
    "  if(rm){" +
    "    var nextVal=i+1<lines.length?lines[i+1]:'';" +
    "    var metric='';" +
    "    if(/^[\\d.]+(万)?$/.test(nextVal)){metric=nextVal;i++}" +
    "    curEntries.push({rank:parseInt(rm[1]),title:rm[3],author:'',genre:rm[2],metric:metric});" +
    "    continue" +
    "  }" +
    "}" +
    "if(curName&&curEntries.length)sections.push({name:curName,entries:curEntries});" +
    "return sections" +
    "})())";
  return evalJSONBase64(port, js) || [];
}

/**
 * DOM에서 도서 링크를 가져온다. 각 도서에는 표지 이미지 anchor(textContent가 비어 있음)와 도서명 anchor가 함께 있는 경우가 많다.
 * `bookId`별로 묶은 뒤 비어 있지 않은 텍스트 중 가장 긴 값을 도서명으로 사용해, 빈 표지 anchor가 도서명을 덮어쓰면서 링크 보정이 전부 실패하는 일을 막는다.
 */
function extractBookUrls(port) {
  const js = `JSON.stringify((function(){
    function clean(t){return t.replace(/^[0-9]+\\[[^\\]]*\\]/,'').replace(/\\s+[0-9.]+(?:万|亿)?$/,'').trim();}
    var byId={};var order=[];
    Array.from(document.querySelectorAll('a[href*="/book/"]')).forEach(function(a){
      var h=a.getAttribute('href')||a.href||'';
      var m=h.match(/\\/book\\/([0-9]+)/);
      if(!m)return; var id=m[1];
      var t=clean((a.innerText||a.textContent||'').replace(/\\s+/g,' ').trim());
      if(!byId[id]){byId[id]='';order.push(id);}
      if(t&&t.length>byId[id].length)byId[id]=t;
    });
    return order.map(function(id){return {bookId:id,title:byId[id],url:'https://www.ciweimao.com/book/'+id};});
  })())`;
  return evalJSONBase64(port, js) || [];
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const PORT = parseInt(getArg(args, "--port") || "9222", 10);
const OUTDIR = getArg(args, "--outdir") || ".";
const RANKTYPE = getArg(args, "--type") || "all";

function main() {
  console.log("\n→ 刺猬猫 순위 수집 중...");
  console.log(`  URL: ${RANK_URL}`);

  let sections, urls;
  try {
    ab(PORT, "open", RANK_URL);
    sleep(4000);

    // 연결 상태 자체 점검: CDP가 시작되지 않았거나 리디렉션된 경우 "구조가 변경됨"으로 오판하지 않고 조치 가능한 오류를 표시한다.
    const probe = probePage(PORT);
    if (!probe) {
      console.error(
        `  ✗ CDP가 응답하지 않습니다. browser-cdp로 Chrome(포트 ${PORT})을 시작했고 agent-browser를 사용할 수 있는지 확인하세요.`
      );
      return 0;
    }
    if (probe.host && probe.host.indexOf("ciweimao") === -1) {
      console.error(`  ✗ 현재 페이지가 刺猬猫이 아닙니다(host=${probe.host}). 리디렉션으로 판단해 건너뜁니다.`);
      return 0;
    }

    scrollLoad(PORT, 3);
    sleep(1000);

    sections = extractAllRanks(PORT);
    if (!sections.length) {
      // 지연 로딩이 실행되지 않았을 수 있으므로 한 번 더 스크롤해 재시도한다.
      scrollLoad(PORT, 2);
      sleep(1000);
      sections = extractAllRanks(PORT);
    }
    if (!sections.length) {
      console.error("[ciweimao] 수집 실패: 순위를 파싱하지 못했습니다(페이지 구조가 바뀌었거나 아직 로드되지 않았을 수 있습니다). 순위 페이지를 직접 열어 확인하세요.");
      return 0;
    }

    urls = extractBookUrls(PORT);
  } catch (err) {
    console.error(`[ciweimao] 수집 실패(페이지 로드 또는 추출 단계): ${err.message}`);
    return 0;
  }

  console.log(`  ✓ 提取 ${sections.length} 个榜单，${urls.length} 个书籍链接`);

  // 필요한 순위 유형만 선택
  const targetTypes =
    RANKTYPE === "all"
      ? RANK_TYPES
      : RANK_TYPES.filter((r) => r.id === RANKTYPE);

  let written = 0;
  for (const rt of targetTypes) {
    try {
      const section = sections.find((s) => s.name === rt.header);
      if (!section || !section.entries.length) {
        console.log(`  ⚠ ${rt.label} 데이터가 없어 건너뜁니다`);
        continue;
      }

      const now = new Date().toISOString();
      const norm = (s) => (s || "").replace(/\s+/g, "");
      const linked = section.entries.filter((e) =>
        urls.some((u) => norm(u.title) === norm(e.title))
      ).length;
      const lines = [
        `# 刺猬猫 · ${rt.label}`,
        "",
        `- 来源：${RANK_URL}`,
        `- 抓取时间：${now}`,
        `- 条目数：${section.entries.length}`,
        `- 作品页链接：${linked} / ${section.entries.length}`,
        "",
        "---",
        "",
      ];

      for (const entry of section.entries) {
        try {
          lines.push(`### #${entry.rank} ${entry.title}`);
          const meta = [
            entry.author,
            entry.genre,
            entry.metric || "",
          ].filter(Boolean).join(" · ");
          if (meta) lines.push(`*${meta}*`);

          // 정규화한 제목으로 도서 링크를 매칭한다.
          const matched = urls.find((u) => norm(u.title) === norm(entry.title));
          if (matched) {
            lines.push(`[작품 페이지](${matched.url})`);
          }

          lines.push("", "---", "");
        } catch (entryErr) {
          console.error(`[ciweimao] ${rt.label} 항목 처리 오류(#${entry.rank} ${entry.title}): ${entryErr.message}`);
          lines.push("", "---", "");
        }
      }

      const date = localDateStamp();
      const filename = `刺猬猫${rt.label}_${date}.md`;
      fs.mkdirSync(OUTDIR, { recursive: true });
      const filepath = path.join(OUTDIR, filename);
      fs.writeFileSync(filepath, lines.join("\n"), "utf-8");
      written++;
      console.log(`  ✓ ${rt.label}: ${section.entries.length}개 → ${filepath}`);
    } catch (rankErr) {
      console.error(`[ciweimao] ${rt.label} 처리 오류. 건너뜁니다: ${rankErr.message}`);
    }
  }
  return written;
}

if (require.main === module) {
  runCli(main, "刺猬猫 순위 수집");
}

module.exports = { extractAllRanks, extractBookUrls };
