"use strict";
var BotjobPage = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // bot/lib/boards/extension-dom.ts
  var extension_dom_exports = {};
  __export(extension_dom_exports, {
    applicationDom: () => applicationDom,
    captureJobDom: () => captureJobDom
  });

  // bot/lib/boards/page-dom.ts
  function captureJobDom({ board, detail }) {
    const dom = {
      visible(element) {
        return !!element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
      },
      text(root, selector) {
        const node = Array.from(root.querySelectorAll(selector)).find(dom.visible);
        return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      }
    };
    const cards = Array.from(document.querySelectorAll(board === "liepin" ? ".job-card-pc-container, .job-card-wrapper" : ".joblist-box__item")).filter(dom.visible);
    const roots = detail ? [document] : cards.filter((card) => !cards.some((other) => other !== card && card.contains(other)));
    const jobs = roots.slice(0, 100).map((root) => {
      const anchor = root.querySelector(board === "liepin" ? 'a[href*="/job/"]' : "a.jobinfo__name");
      const title = dom.text(root, detail ? board === "liepin" ? ".job-title .name, .job-name .name, .job-apply-container .name, h1.name" : ".summary-planes__title, .summary-plane__title" : board === "liepin" ? ".job-title-box [title], .job-title-box .ellipsis-1, .job-name, .ellipsis-1[title]" : ".jobinfo__name");
      const company = dom.text(root, board === "liepin" ? detail ? ".company-info .name, .company-info .company-name, .company-info .company-title" : ".company-name" : detail ? ".company-info__name, .company__title" : ".companyinfo__name");
      const industry = dom.text(root, board === "liepin" ? detail ? ".company-info .company-tags-box" : ".company-tags-box" : detail ? ".company-info__industry" : ".companyinfo__tag");
      const labels = Array.from(root.querySelectorAll(board === "liepin" ? ".labels-tag, .job-properties span:not(.split)" : ".jobinfo__other-info-item, .summary-planes__info li, .summary-plane__info li")).filter(dom.visible).map((node) => node.textContent?.trim() ?? "");
      const timeRoot = detail ? root.querySelector(board === "liepin" ? ".job-apply-container" : ".summary-planes, .summary-plane") : root;
      let updated = timeRoot ? dom.text(timeRoot, ".update-time, .job-update-time, .jobinfo__update-time") : "";
      let published = timeRoot ? dom.text(timeRoot, ".publish-time, .job-publish-time, .jobinfo__publish-time") : "";
      const url = detail ? location.href : anchor?.href ?? "";
      if (board === "zhilian") {
        const state = window.__INITIAL_STATE__;
        const number = url.match(/\/jobdetail\/([^/.]+)\.htm(?:[?#]|$)/)?.[1];
        const position = detail ? state?.jobDetail?.detailedPosition : Array.isArray(state?.positionList) ? state.positionList.find((item) => item?.number === number) : void 0;
        if (number && position?.number === number) {
          if (!updated) updated = [position.positionUpdateTime, position.updateTime].find((value) => typeof value === "string") ?? "";
          if (!published) published = [position.positionPublishTime, position.publishTime].find((value) => typeof value === "string") ?? "";
        }
      }
      const description = detail ? dom.text(root, board === "liepin" ? '[data-selector="job-intro-content"], .job-intro-content' : ".describtion__detail-content, .describtion-card__detail-content") : "";
      const companyDescription = detail ? dom.text(root, ".company-introduction, .company-intro, .company-info__description, .company__description").slice(0, 6e3) : "";
      const companySize = dom.text(root, detail ? ".company-info__size, .company-info .company-size" : ".companyinfo__staff, .company-size");
      const companyLink = root.querySelector(board === "liepin" ? detail ? '.company-info a[href*="/company/"]' : 'a[href*="/company/"]' : detail ? "a.company-info__name, a.company__title" : "a.companyinfo__name");
      return {
        title,
        company,
        industry,
        labels,
        updated,
        published,
        description,
        companyDescription,
        companySize,
        companyUrl: companyLink?.href ?? "",
        url,
        salary: dom.text(root, ".job-salary, .jobinfo__salary, .salary, .summary-planes__salary, .summary-plane__salary"),
        city: dom.text(root, ".job-dq-box, .job-area")
      };
    });
    const empty = Array.from(document.querySelectorAll(".search-empty, .job-list-empty, .no-result, .no-data, .empty-result")).some((node) => dom.visible(node) && /暂无|没有|未找到|无符合/.test(node.textContent ?? ""));
    const restricted = Array.from(document.querySelectorAll('form, [role="dialog"], .login-container, .captcha, .geetest_panel')).some((node) => dom.visible(node) && /扫码登录|验证码|安全验证|人机验证|登录后.*(?:职位|岗位)/.test(node.textContent ?? ""));
    return { jobs, cardCount: roots.length, empty, restricted };
  }

  // bot/lib/boards/extension-dom.ts
  function applicationDom(board, action, expectedFingerprint) {
    const helpers = {
      visible(element) {
        return !!element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
      },
      label(element) {
        return element.textContent?.trim() ?? "";
      }
    };
    const headers = Array.from(document.querySelectorAll(board === "liepin" ? ".job-apply-container" : ".summary-planes, .summary-plane"));
    const header = headers.length === 1 ? headers[0] : void 0;
    const buttons = header ? Array.from(header.querySelectorAll('button, a, [role="button"]')).filter(helpers.visible) : [];
    const done = buttons.filter((node) => /^(投递成功|申请成功|已投递|已申请)\s*[！!。]?$/.test(helpers.label(node)));
    const alerts = Array.from(document.querySelectorAll('[role="alert"], .ant-message-notice-content, .el-message')).filter(helpers.visible).filter((node) => /^(投递成功|申请成功|已投递|已申请)\s*[！!。]?$/.test(helpers.label(node)));
    if (action === "result") return { done: !!(done.length || alerts.length), evidence: helpers.label(done[0] ?? alerts[0] ?? document.createElement("span")) };
    const candidates = buttons.filter((node) => /^(立即申请|申请职位|投递简历|立即投递)$/.test(helpers.label(node)));
    const dialog = Array.from(document.querySelectorAll('[role="dialog"], .ant-modal, .el-dialog')).some(helpers.visible);
    const required = Array.from(document.querySelectorAll("input:required:invalid, textarea:required:invalid, select:required:invalid")).some(helpers.visible);
    const candidate = candidates[0];
    const disabled = candidate?.matches(':disabled, [aria-disabled="true"]');
    const raw = captureJobDom({ board, detail: true });
    const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((node) => node.textContent ?? "");
    const fingerprint = JSON.stringify({ url: location.href, jobs: raw.jobs, ld, labels: candidates.map(helpers.label) });
    let reason = !header ? "\u65E0\u6CD5\u786E\u8BA4\u5C97\u4F4D\u64CD\u4F5C\u533A\u57DF" : dialog ? "\u9875\u9762\u6709\u5F85\u5904\u7406\u5F39\u7A97" : required ? "\u9875\u9762\u6709\u5FC5\u586B\u4FE1\u606F" : alerts.length ? "\u9875\u9762\u5B58\u5728\u672A\u5173\u8054\u7684\u6210\u529F\u63D0\u793A" : candidates.length !== 1 || disabled ? "\u6CA1\u6709\u552F\u4E00\u53EF\u7528\u7684\u7533\u8BF7\u6309\u94AE\uFF0C\u53EF\u80FD\u4EC5\u652F\u6301\u804A\u4E00\u804A" : "";
    if (action === "click") {
      if (fingerprint !== expectedFingerprint) reason = "\u5C97\u4F4D\u9875\u9762\u5728\u786E\u8BA4\u540E\u53D1\u751F\u53D8\u5316";
      if (done.length) reason = "\u9875\u9762\u5DF2\u7ECF\u663E\u793A\u6295\u9012\uFF0C\u4E0D\u91CD\u590D\u70B9\u51FB";
      if (reason || !candidate) return { clicked: false, reason };
      candidate.scrollIntoView({ block: "center" });
      const rect = candidate.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (!top || !(top === candidate || candidate.contains(top))) return { clicked: false, reason: "\u7533\u8BF7\u6309\u94AE\u88AB\u906E\u6321" };
      candidate.click();
      return { clicked: true };
    }
    return { raw, fingerprint, reason, alreadySubmitted: done.length === 1, evidence: done[0] ? helpers.label(done[0]) : void 0 };
  }
  return __toCommonJS(extension_dom_exports);
})();
