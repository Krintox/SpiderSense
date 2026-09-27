import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Enterprise } from "../src/enterprise/enterprise.js";
import { createFacade } from "../src/enterprise/http-facade.js";

test("Okta-shaped and ServiceNow-shaped endpoints mutate the same enterprise as the tools", async () => {
  const ent = new Enterprise(42);
  const srv = createFacade(ent).listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const h = { Authorization: "SSWS mock-ssws-token", "Content-Type": "application/json", "X-Session-Id": "f1" };
  try {
    assert.equal((await fetch(`${base}/api/v1/users/cfo.rao`, { headers: { Authorization: "SSWS wrong" } })).status, 401);
    const user: any = await (await fetch(`${base}/api/v1/users/cfo.rao@northwind.example`, { headers: h })).json();
    assert.equal(user.profile.title, "Chief Financial Officer");
    assert.match(user.profile.mobilePhone, /•/);
    const before: any[] = await (await fetch(`${base}/api/v1/users/cfo.rao/factors`, { headers: h })).json();
    assert.ok(before.some((f) => f.factorType === "webauthn"));
    assert.equal((await fetch(`${base}/api/v1/users/cfo.rao/lifecycle/reset_factors`, { method: "POST", headers: h })).status, 200);
    assert.equal(ent.employees.get("cfo.rao")!.factors.length, 0);
    const enr = await fetch(`${base}/api/v1/users/cfo.rao/factors`, { method: "POST", headers: h, body: JSON.stringify({ factorType: "sms", provider: "OKTA", profile: { phoneNumber: "+91 90000 11111" } }) });
    assert.equal(enr.status, 201);
    const inc: any = await (await fetch(`${base}/api/now/table/incident`, { method: "POST", headers: h, body: JSON.stringify({ short_description: "test", caller_id: "cfo.rao", priority: "1" }) })).json();
    assert.match(inc.result.number, /^INC\d{7}$/);
    assert.equal(ent.audit.filter((a) => a.tool === "reset_mfa" || a.tool === "enroll_factor").length, 2);
  } finally { srv.close(); }
});
