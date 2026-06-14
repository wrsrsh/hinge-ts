import assert from "node:assert/strict";
import test from "node:test";
import {
  createHingeRestProxyHandler,
  isAllowedHingeProxyHost
} from "../dist/proxy.js";

test("allows hinge and sendbird hosts by default", () => {
  assert.equal(isAllowedHingeProxyHost("prod-api.hingeaws.net"), true);
  assert.equal(isAllowedHingeProxyHost("api-example.sendbird.com"), true);
  assert.equal(isAllowedHingeProxyHost("example.com"), false);
});

test("forwards rest proxy requests", async () => {
  const handler = createHingeRestProxyHandler({
    fetch: async (url, init) => {
      assert.equal(String(url), "https://prod-api.hingeaws.net/likelimit");
      assert.equal(init.method, "GET");
      assert.equal(init.headers.authorization, "Bearer token");
      return new Response(JSON.stringify({ likes: 8 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const response = await handler(new Request("https://proxy.test/request", {
    method: "POST",
    body: JSON.stringify({
      service: "hinge",
      method: "GET",
      pathOrUrl: "/likelimit",
      url: "https://prod-api.hingeaws.net/likelimit",
      headers: { authorization: "Bearer token" },
      responseType: "json"
    })
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { likes: 8 });
});

test("rejects disallowed upstream hosts", async () => {
  const handler = createHingeRestProxyHandler();
  const response = await handler(new Request("https://proxy.test/request", {
    method: "POST",
    body: JSON.stringify({
      service: "hinge",
      method: "GET",
      pathOrUrl: "/",
      url: "https://example.com/",
      headers: {}
    })
  }));

  assert.equal(response.status, 400);
});

test("encodes byte responses as base64 json", async () => {
  const handler = createHingeRestProxyHandler({
    fetch: async () => new Response(new Uint8Array([104, 105]), { status: 200 })
  });
  const response = await handler(new Request("https://proxy.test/request", {
    method: "POST",
    body: JSON.stringify({
      service: "hinge",
      method: "GET",
      pathOrUrl: "https://prod-api.hingeaws.net/file",
      url: "https://prod-api.hingeaws.net/file",
      headers: {},
      responseType: "bytes"
    })
  }));

  assert.equal(await response.json(), "aGk=");
});

test("adds cors headers", async () => {
  const handler = createHingeRestProxyHandler({
    cors: {
      origin: ["https://app.example"],
      credentials: true
    }
  });

  const response = await handler(new Request("https://proxy.test/request", {
    method: "OPTIONS",
    headers: { origin: "https://app.example" }
  }));

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://app.example");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});
