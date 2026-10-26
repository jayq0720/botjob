import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";
import { createExtensionBridge } from "../bot/lib/boards/extension-bridge.js";

test("loopback bridge requires pairing, rejects web origins, expires commands and never replays results", async () => {
  const token = "a".repeat(64);
  const bridge = await createExtensionBridge(token, 0);
  const headers = { Authorization: `Bearer ${token}` };
  try {
    assert.equal((await fetch(bridge.address + '/poll')).status, 401);
    assert.equal((await fetch(bridge.address + '/poll', { headers: { ...headers, Origin: 'https://www.liepin.com' } })).status, 403);
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(bridge.address + '/poll', { headers: { ...headers, Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(badHost, 403);
    assert.equal(bridge.connected(), false);
    const result = bridge.command<{ opened: boolean }>({ type: 'open', board: 'liepin', url: 'https://www.liepin.com/' });
    const command = await (await fetch(bridge.address + '/poll', { headers })).json() as { id: string; type: string };
    assert.equal(command.type, 'open'); assert.equal(bridge.connected(), true);
    const body = JSON.stringify({ id: command.id, value: { opened: true } });
    assert.equal((await fetch(bridge.address + '/result', { method: 'POST', headers, body })).status, 200);
    assert.deepEqual(await result, { opened: true });
    assert.equal((await fetch(bridge.address + '/result', { method: 'POST', headers, body })).status, 409);
    await assert.rejects(bridge.command({ type: 'read', board: 'liepin', url: 'https://www.liepin.com/' }, 30), /未及时响应/);
  } finally { await bridge.close(); }
});
