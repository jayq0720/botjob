import type { BoardId } from "./types.js";

/** Shared read-only extractor for Playwright and the user-installed browser extension. */
export function captureJobDom({ board, detail }: { board: BoardId; detail: boolean }) {
    // Object methods survive tsx/esbuild serialization without external __name helpers.
    const dom = {
      visible(element: Element) { return !!element.getClientRects().length && getComputedStyle(element).visibility !== "hidden"; },
      text(root: ParentNode, selector: string) {
        const node = Array.from(root.querySelectorAll(selector)).find(dom.visible);
        return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      },
    };
    const cards = Array.from(document.querySelectorAll(board === "liepin"
      ? ".job-card-pc-container, .job-card-wrapper" : ".joblist-box__item")).filter(dom.visible);
    // A wrapper and its nested card describe one job, not two.
    const roots = detail ? [document] : cards.filter(card => !cards.some(other => other !== card && card.contains(other)));
    const jobs = roots.slice(0, 100).map(root => {
      const anchor = root.querySelector<HTMLAnchorElement>(board === "liepin" ? 'a[href*="/job/"]' : 'a.jobinfo__name');
      const title = dom.text(root, detail
        ? (board === "liepin" ? ".job-title .name, .job-name .name, .job-apply-container .name, h1.name" : ".summary-planes__title, .summary-plane__title")
        : (board === "liepin" ? ".job-title-box [title], .job-title-box .ellipsis-1, .job-name, .ellipsis-1[title]" : ".jobinfo__name"));
      const company = dom.text(root, board === "liepin" ? (detail ? ".company-info .name, .company-info .company-name, .company-info .company-title" : ".company-name") : (detail ? ".company-info__name, .company__title" : ".companyinfo__name"));
      const industry = dom.text(root, board === "liepin" ? (detail ? ".company-info .company-tags-box" : ".company-tags-box") : (detail ? ".company-info__industry" : ".companyinfo__tag"));
      const labels = Array.from(root.querySelectorAll(board === "liepin" ? ".labels-tag, .job-properties span:not(.split)" : ".jobinfo__other-info-item, .summary-planes__info li, .summary-plane__info li"))
        .filter(dom.visible).map(node => node.textContent?.trim() ?? "");
      // Only explicit job-time fields; recruiter activity and arbitrary dates never count.
      const timeRoot = detail ? root.querySelector(board === "liepin" ? ".job-apply-container" : ".summary-planes, .summary-plane") : root;
      let updated = timeRoot ? dom.text(timeRoot, ".update-time, .job-update-time, .jobinfo__update-time") : "";
      let published = timeRoot ? dom.text(timeRoot, ".publish-time, .job-publish-time, .jobinfo__publish-time") : "";
      const url = detail ? location.href : anchor?.href ?? "";
      if (board === "zhilian") {
        // SPA may keep source times only in runtime state, without a serialized script.
        const state = (window as unknown as { __INITIAL_STATE__?: { positionList?: Record<string, unknown>[]; jobDetail?: { detailedPosition?: Record<string, unknown> } } }).__INITIAL_STATE__;
        const number = url.match(/\/jobdetail\/([^/.]+)\.htm(?:[?#]|$)/)?.[1];
        const position = detail ? state?.jobDetail?.detailedPosition : Array.isArray(state?.positionList) ? state.positionList.find(item => item?.number === number) : undefined;
        if (number && position?.number === number) {
          if (!updated) updated = [position.positionUpdateTime, position.updateTime].find(value => typeof value === "string") as string ?? "";
          if (!published) published = [position.positionPublishTime, position.publishTime].find(value => typeof value === "string") as string ?? "";
        }
      }
      const description = detail ? dom.text(root, board === "liepin" ? '[data-selector="job-intro-content"], .job-intro-content' : ".describtion__detail-content, .describtion-card__detail-content") : "";
      const companyDescription = detail ? dom.text(root, ".company-introduction, .company-intro, .company-info__description, .company__description").slice(0, 6000) : "";
      const companySize = dom.text(root, detail ? ".company-info__size, .company-info .company-size" : ".companyinfo__staff, .company-size");
      const companyLink = root.querySelector<HTMLAnchorElement>(board === "liepin"
        ? (detail ? '.company-info a[href*="/company/"]' : 'a[href*="/company/"]')
        : (detail ? 'a.company-info__name, a.company__title' : 'a.companyinfo__name'));
      return { title, company, industry, labels, updated, published, description, companyDescription, companySize, companyUrl: companyLink?.href ?? "",
        url,
        salary: dom.text(root, ".job-salary, .jobinfo__salary, .salary, .summary-planes__salary, .summary-plane__salary"),
        city: dom.text(root, ".job-dq-box, .job-area") };
    });
    const empty = Array.from(document.querySelectorAll('.search-empty, .job-list-empty, .no-result, .no-data, .empty-result'))
      .some(node => dom.visible(node) && /暂无|没有|未找到|无符合/.test(node.textContent ?? ""));
    const restricted = Array.from(document.querySelectorAll('form, [role="dialog"], .login-container, .captcha, .geetest_panel'))
      .some(node => dom.visible(node) && /扫码登录|验证码|安全验证|人机验证|登录后.*(?:职位|岗位)/.test(node.textContent ?? ""));
    return { jobs, cardCount: roots.length, empty, restricted };

}
