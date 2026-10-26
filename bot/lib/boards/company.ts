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

/** Text after a "公司介绍" heading in a page's plain text, up to the next known section. */
export function introAfterHeading(plainText: string): string | undefined {
  // Navigation tabs reuse the heading words, so take the first occurrence followed by real prose.
  for (const heading of plainText.matchAll(new RegExp(INTRO_HEADING, "g"))) {
    const start = heading.index + heading[0].length;
    const rest = plainText.slice(start, start + 3000).replace(/^[\s:：]+/, "");
    const end = rest.search(NEXT_SECTION);
    const intro = trimIntro(end >= 0 ? rest.slice(0, end) : rest);
    if (intro && intro.length >= 40) return intro;
  }
  return undefined;
}
