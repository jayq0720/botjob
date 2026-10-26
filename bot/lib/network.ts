import * as http from "node:http";

let configured = false;

/** Node's fetch does not use HTTP(S)_PROXY by default. Never copy proxy credentials to disk. */
export function configureEnvironmentProxy(): void {
  if (configured || process.env.NODE_USE_ENV_PROXY === "0") return;
  const hasProxy = ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"]
    .some((name) => Boolean(process.env[name]));
  if (!hasProxy) return;

  // Available in Node 24.14+. Keep direct connections working on the older BDK runtime.
  const configure = (http as typeof http & {
    setGlobalProxyFromEnv?: () => () => void;
  }).setGlobalProxyFromEnv;
  if (configure) {
    configure();
    configured = true;
    return;
  }
  // Older releases with built-in proxy support can enable it at process startup.
  const [major, minor] = process.versions.node.split(".").map(Number);
  const hasStartupProxy = major > 24 || (major === 24 && minor >= 5) || (major === 22 && minor >= 21);
  const startupProxyEnabled = process.env.NODE_USE_ENV_PROXY === "1" ||
    process.execArgv.includes("--use-env-proxy") ||
    /(?:^|\s)--use-env-proxy(?:\s|$)/.test(process.env.NODE_OPTIONS ?? "");
  if (hasStartupProxy && startupProxyEnabled) {
    configured = true;
    return;
  }
  throw new Error("检测到 HTTP(S)_PROXY，但当前 Node 未启用代理支持。请使用 Node 24.14+，或在支持的版本启动时设置 NODE_USE_ENV_PROXY=1。");
}

/** Explain common transport failures without exposing proxy URLs, headers or credentials. */
export function networkErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "网络请求失败。";
  const cause = error.cause as { code?: unknown } | undefined;
  const code = typeof cause?.code === "string" ? cause.code : undefined;
  if (code === "EAI_AGAIN" || code === "ENOTFOUND") {
    return `域名解析失败（${code}）。请检查网络连接；使用代理时，MCP 客户端必须向服务进程传入 HTTP_PROXY/HTTPS_PROXY 和 NO_PROXY。`;
  }
  if (code === "ECONNREFUSED") return "连接被拒绝（ECONNREFUSED），请检查代理地址及服务是否可达。";
  if (error.name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") {
    return "请求超时，请检查网络或代理后重试。";
  }
  if (["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"].includes(code ?? "")) {
    return "TLS 证书验证失败。若使用企业代理，请通过 NODE_EXTRA_CA_CERTS 配置可信 CA；不要关闭证书验证。";
  }
  return error.message;
}
