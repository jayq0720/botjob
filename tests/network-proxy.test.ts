import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as http from "node:http";
import { promisify } from "node:util";
import { test } from "node:test";
import { networkErrorMessage } from "../bot/lib/network.js";

const exec = promisify(execFile);
const supportsRuntimeProxy = "setGlobalProxyFromEnv" in http;

test("fetch uses the configured proxy instead of resolving an external hostname", {
  skip: !supportsRuntimeProxy && "runtime proxy API requires Node 24.14+",
}, async () => {
  const proxy = http.createServer((_req, res) => res.end("proxy reached"));
  let tunnelTarget = "";
  proxy.on("connect", (request, socket) => {
    tunnelTarget = request.url ?? "";
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", () => socket.end("HTTP/1.1 200 OK\r\nContent-Length: 13\r\nConnection: close\r\n\r\nproxy reached"));
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address() as { port: number };
  const proxyUrl = `http://127.0.0.1:${address.port}`;
  try {
    const script = `
      import {configureEnvironmentProxy} from ${JSON.stringify(new URL("../bot/lib/network.ts", import.meta.url).href)};
      configureEnvironmentProxy();
      configureEnvironmentProxy();
      const response = await fetch('http://jobs.botjob-test.invalid/list', {signal:AbortSignal.timeout(5000)});
      console.log(await response.text());
    `;
    const { stdout } = await exec(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: { ...process.env, HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl,
        http_proxy: proxyUrl, https_proxy: proxyUrl, NO_PROXY: "", no_proxy: "", NODE_USE_ENV_PROXY: "" },
      timeout: 10000,
    });
    assert.equal(stdout.trim(), "proxy reached");
    assert.equal(tunnelTarget, "jobs.botjob-test.invalid:80");
  } finally {
    proxy.closeAllConnections();
    await new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
  }
});

test("network failures explain DNS, timeouts and trust without leaking proxy secrets", () => {
  const cause = Object.assign(new Error("https://user:PRIVATE-PASSWORD@proxy.example"), { code: "EAI_AGAIN" });
  const dns = networkErrorMessage(new TypeError("fetch failed", { cause }));
  assert.match(dns, /域名解析失败.*EAI_AGAIN/);
  assert.doesNotMatch(dns, /PRIVATE-PASSWORD|proxy\.example/);
  const tls = networkErrorMessage(new TypeError("fetch failed", { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } }));
  assert.match(tls, /NODE_EXTRA_CA_CERTS/);
  assert.match(networkErrorMessage(new DOMException("timeout", "TimeoutError")), /超时/);
});
