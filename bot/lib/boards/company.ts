/** Company facts shown next to each job. Only text the site printed; never inferred. */
export type CompanyFacts = { companySize?: string; companyStage?: string; companyIntro?: string };

const SIZE = /(?:少于|小于)?\d+(?:\s*[-~至]\s*\d+)?\s*人(?:以上|以下)?/;
const STAGE = /Pre-[A-D]轮|天使轮|[A-D]\+?轮(?:及以上)?|战略融资|已上市|上市公司|不需要融资|未融资|国企|央企|外商独资|合资|民营|事业单位/;
const INTRO_HEADING = /(?:公司|企业)(?:介绍|简介|信息)|关于我们/;
// Sections that commonly follow the company intro on 智联/猎聘/51job detail pages.
const NEXT_SECTION = /(?:工作地[点址]|公司地址|上班地址|职位描述|岗位职责|工商信息|企业信息|相似职位|推荐职位|热门职位|其他职位|看过该职位|公司相册|公司福利)/;
const MAX_INTRO = 400;

export function companyTags(text: string | undefined): Pick<CompanyFacts, "companySize" | "companyStage"> {
  if (!text) return {};
  return { companySize: text.match(SIZE)?.[0].replace(/\s+/g, ""), companyStage: text.match(STAGE)?.[0] };
}

/** A "A轮 · 1000-9999人 · 消费金融、产业互联网平台" tag line: industry is what is left after size, stage and badges. */
export function companyTagLine(text: string | undefined): Pick<CompanyFacts, "companySize" | "companyStage"> & { companyIndustry?: string } {
  if (!text) return {};
  const parts = text.split(/\s*[·•|｜]\s*/).map(part => part.replace(/已审核|已认证/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const industry = [...new Set(parts.filter(part => !SIZE.test(part) && !new RegExp(`^(?:${STAGE.source})$`).test(part))
    .flatMap(part => part.split("、")))].join("、");
  return { ...companyTags(text), companyIndustry: industry || undefined };
}

export function trimIntro(text: string | undefined): string | undefined {
  const clean = text?.replace(/\s+/g, " ").trim();
  if (!clean || clean.length < 15) return undefined;
  return clean.length > MAX_INTRO ? clean.slice(0, MAX_INTRO).replace(/[，。；、,.;\s]*[^，。；、,.;]*$/, "") + "…" : clean;
}

/** Nav tabs and footer link lists are short labels. A company intro is a punctuated sentence. */
function navFragment(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || /[，。；！？、,.!?]/.test(clean)) return false;
  return clean.split(/\s+/).every(part => part.length <= 12);
}

/** A footer starts its "公司介绍" with a run of short link labels (联系我们 诚聘英才 产品与服务 …). */
function leadingLinks(text: string): boolean {
  const parts = text.trim().split(/\s+/).slice(0, 5);
  return parts.length === 5 && parts.every(part => part.length <= 8 && !/[，。；！？、,.!?]/.test(part));
}

/** Text after a "公司介绍" heading in a page's plain text, up to the next known section. */
export function introAfterHeading(plainText: string): string | undefined {
  for (const heading of plainText.matchAll(new RegExp(INTRO_HEADING, "g"))) {
    const start = (heading.index ?? 0) + heading[0].length;
    const rest = plainText.slice(start, start + 3000).replace(/^[\s:：]+/, "");
    const nextHeading = rest.search(INTRO_HEADING);
    const nextSection = rest.search(NEXT_SECTION);
    const end = nextSection >= 0 ? nextSection : rest.length;
    // A tab named 公司介绍 sits in front of the real heading. The gap is only more tabs.
    const between = nextHeading >= 0 && nextHeading < end ? rest.slice(0, nextHeading) : "";
    if (between && (navFragment(between) || between.replace(/\s+/g, "").length < 40)) continue;
    const chunk = rest.slice(0, end);
    // Under 智联's "公司信息" heading the first line is the "未融资 · 1000-9999人 · 行业" tag line, not an intro.
    const head = chunk.slice(0, 80);
    if (navFragment(chunk) || leadingLinks(chunk) || (/[·•]/.test(head) && SIZE.test(head)) || !/[，。；！？、,.!?]/.test(chunk)) continue;
    const intro = trimIntro(chunk);
    if (intro && intro.length >= 40) return intro;
  }
  return undefined;
}
