/** Company facts shown next to each job. Only text the site printed; never inferred. */
export type CompanyFacts = { companySize?: string; companyStage?: string; companyIntro?: string };

const SIZE = /(?:少于|小于)?\d+(?:\s*[-~至]\s*\d+)?\s*人(?:以上|以下)?/;
const STAGE = /Pre-[A-D]轮|天使轮|[A-D]\+?轮(?:及以上)?|战略融资|已上市|上市公司|不需要融资|未融资|国企|央企|外商独资|合资|民营|事业单位/;
const INTRO_HEADING = /(?:公司|企业)(?:介绍|简介)|关于我们/;
// Sections that commonly follow the company intro on 智联/猎聘/51job detail pages.
const NEXT_SECTION = /(?:工作地[点址]|公司地址|上班地址|职位描述|岗位职责|工商信息|企业信息|相似职位|推荐职位|热门职位|其他职位|看过该职位|公司相册|公司福利)/;
const MAX_INTRO = 400;

export function companyTags(text: string | undefined): Pick<CompanyFacts, "companySize" | "companyStage"> {
  if (!text) return {};
  return { companySize: text.match(SIZE)?.[0].replace(/\s+/g, ""), companyStage: text.match(STAGE)?.[0] };
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
    if (navFragment(chunk) || !/[，。；！？、,.!?]/.test(chunk)) continue;
    const intro = trimIntro(chunk);
    if (intro && intro.length >= 40) return intro;
  }
  return undefined;
}
