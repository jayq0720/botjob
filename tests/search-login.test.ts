import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserContext } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createBotjobServer } from "../mcp/server.js";
import { createBrowserAccess } from "../bot/lib/boards/browser.js";

test("browser reads reuse the opened profile and missing/closed sessions ask for login", async () => {
  let launches = 0;
  let onClose = () => {};
  let url = "";
  let reads = 0;
  const fakePage = () => ({
    goto: async (target: string) => { url = target; return { status: () => 200 }; },
    bringToFront: async () => {}, waitForLoadState: async () => {},
    url: () => url, content: async () => { reads++; return "authenticated job page"; }, close: async () => {},
  });
  const access = createBrowserAccess(async () => {
    launches++;
    return { pages: () => [fakePage()], newPage: async () => fakePage(), on: (_: string, fn: () => void) => { onClose = fn; }, close: async () => onClose() } as unknown as BrowserContext;
  }, async () => ({ jobs: [], diagnostics: { mode: "browser", state: "timeout", pageKind: "detail", elapsedMs: 0, cardCount: 0, parsedCount: 0 } }));
  const read = access.reader("liepin");
  const target = "https://www.liepin.com/job/123.shtml";
  const absent = await read(target);
  assert.equal("status" in absent && absent.status, 401);
  assert.equal(launches, 0);
  await assert.rejects(access.open("liepin", "https://example.org/"));
  await access.open("liepin");
  const result = await read(target);
  assert.equal("body" in result && result.body, "authenticated job page");
  assert.equal(reads, 1);
  await access.open("liepin");
  assert.equal(launches, 1);
  await access.close();
  const closed = await read(target);
  assert.equal("status" in closed && closed.status, 401);
});

for (const answer of ["accept", "decline", "unsupported"] as const) {
  test(`MCP login prompt ${answer} only resumes after explicit completion`, async () => {
    let prompts = 0;
    let opened = false;
    const server = createBotjobServer({ openLogin: async (board, url) => {
      opened = true;
      return { ok: true, board, status: "awaiting_login", url: url ?? "https://www.liepin.com/", message: "请在网站登录自己的账号，完成后继续" };
    } });
    const client = new Client({ name: "login-test", version: "1" }, { capabilities: answer === "unsupported" ? {} : { elicitation: { form: {} } } });
    if (answer !== "unsupported") client.setRequestHandler(ElicitRequestSchema, async request => {
      assert.equal(opened, true);
      assert.match(request.params.message, /登录自己的账号/);
      prompts++;
      return { action: answer, content: { loggedIn: answer === "accept" } };
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({ name: "open_job_login", arguments: { board: "liepin" } });
      const data = result.structuredContent as { status: string };
      assert.equal(data.status, answer === "accept" ? "ready_to_retry" : "awaiting_login");
      assert.equal(prompts, answer === "unsupported" ? 0 : 1);
    } finally { await client.close(); await server.close(); }
  });
}

test('MCP browser pairing does not ask the user to confirm website login prematurely', async()=>{
 let prompts=0;
 const server=createBotjobServer({openLogin:async(board,url)=>({ok:true,board,status:'awaiting_browser_connection',url:url??'https://www.liepin.com/',extensionDirectory:'/local/botjob/extension',message:'请先连接扩展'})});
 const client=new Client({name:'pairing-test',version:'1'},{capabilities:{elicitation:{form:{}}}});
 client.setRequestHandler(ElicitRequestSchema,async()=>{prompts++;return{action:'decline'};});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 try{
  const response=await client.callTool({name:'open_job_login',arguments:{board:'liepin'}});
  assert.equal((response.structuredContent as any).status,'awaiting_browser_connection');
  assert.equal(prompts,0);
 }finally{await client.close();await server.close();}
});
