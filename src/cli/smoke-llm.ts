import { chat, chatJson, ROLES, type RoleName } from "../llm/client.js";

process.env.LLM_CACHE = "off";
for (const role of Object.keys(ROLES) as RoleName[]) {
  const t0 = Date.now();
  try {
    const { value, meta } = await chatJson<{ ok: boolean; n: number }>(
      [{ role: "system", content: "Reply with ONLY a JSON object." }, { role: "user", content: 'Return {"ok": true, "n": 7}.' }],
      { role, temperature: 0 });
    console.log(`${role.padEnd(10)} ok=${value.ok} n=${value.n}  via ${meta.provider}/${meta.model}  ${Date.now() - t0}ms`);
  } catch (e: any) { console.log(`${role.padEnd(10)} FAILED: ${e.message}`); }
}
void chat;
