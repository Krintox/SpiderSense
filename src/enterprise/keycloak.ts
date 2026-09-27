/**
 * Keycloak (real, Docker) as the identity system of record. Nothing here is mocked: users, credentials, attributes,
 * sessions and the admin-event audit log all live in Keycloak.
 *
 * Mapping of help-desk actions to real Keycloak operations
 *   reset_password  -> PUT  /users/{id}/reset-password   (temporary password, forces change at next sign-in)
 *   reset_mfa       -> DELETE OTP credentials + requiredAction CONFIGURE_TOTP (the real "re-enroll MFA" flow)
 *   enroll_factor   -> attribute `mfa_factors` (Keycloak has no SMS factor, so this one is a stored attribute; stated in the docs)
 *   lock_account    -> PUT  /users/{id} {enabled:false}
 *   revoke_sessions -> POST /users/{id}/logout
 * Account facts the guard needs (privileged, phone history, travel, ...) are stored as user attributes and read back on every decision.
 */
import { buildEmployees } from "./seed.js";
import type { Backend, Enterprise } from "./enterprise.js";
import type { Employee, ToolCall, ToolResult } from "./types.js";

export const KC_URL = process.env.KEYCLOAK_URL ?? "http://localhost:8180";
const PASSWORD = "Northwind-2026!";

type J = Record<string, any>;
export class KeycloakAdmin {
  private tok = ""; private exp = 0;
  constructor(private base = KC_URL, private user = "admin", private pass = "admin") {}
  async token(): Promise<string> {
    if (Date.now() < this.exp - 5000) return this.tok;
    const r = await fetch(`${this.base}/realms/master/protocol/openid-connect/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: "admin-cli", grant_type: "password", username: this.user, password: this.pass }) });
    if (!r.ok) throw new Error(`keycloak token ${r.status}`);
    const d = (await r.json()) as J; this.tok = d.access_token; this.exp = Date.now() + d.expires_in * 1000; return this.tok;
  }
  async req(method: string, path: string, body?: unknown, raw = false): Promise<any> {
    const r = await fetch(`${this.base}/admin${path}`, { method, headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (raw) return r;
    if (!r.ok && r.status !== 404) throw new Error(`keycloak ${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
    if (r.status === 404) return null;
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }
  async alive(): Promise<boolean> { try { return (await fetch(`${this.base}/realms/master`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } }
}

const attrs = (e: Employee): Record<string, string[]> => ({
  title: [e.title], department: [e.dept], manager: [e.manager ?? ""], privileged: [String(e.privileged)], account_type: [e.account_type], hr_status: [e.status],
  hr_emp_no: [e.emp_no], hr_dob: [e.dob], phone_of_record: [e.phone_of_record], phone_changed_days_ago: [String(e.phone_changed_days_ago)],
  devices: [JSON.stringify(e.devices.map((d) => [d.id, d.label, d.enrolled_days_ago]))], mfa_factors: [JSON.stringify(e.factors.map((f) => [f.type, f.value, f.enrolled_days_ago]))],
  last_login: [JSON.stringify([e.last_login.city, e.last_login.days_ago, e.last_login.device_id])], travel: [e.travel ? JSON.stringify([e.travel.city, e.travel.from_days, e.travel.to_days]) : ""],
  breach_exposed: [JSON.stringify(e.breach_exposed)],
});

export async function ensureRealm(kc: KeycloakAdmin, realm: string, employees: Employee[] = buildEmployees(42)) {
  const existing = await kc.req("GET", `/realms/${realm}`);
  if (!existing) {
    await kc.req("POST", "/realms", { realm, enabled: true, displayName: "Northwind Systems", eventsEnabled: true, adminEventsEnabled: true, adminEventsDetailsEnabled: true, eventsExpiration: 86400 });
    // Keycloak 24+ rejects unmanaged attributes unless the user profile allows them
    const prof = await kc.req("GET", `/realms/${realm}/users/profile`);
    await kc.req("PUT", `/realms/${realm}/users/profile`, { ...prof, unmanagedAttributePolicy: "ENABLED" });
  }
  const have = new Set<string>(((await kc.req("GET", `/realms/${realm}/users?max=200&briefRepresentation=true`)) ?? []).map((u: J) => u.username));
  let created = 0;
  for (const e of employees) {
    if (have.has(e.username)) continue;
    const creds: J[] = [{ type: "password", value: PASSWORD, temporary: false }];
    const r = await kc.req("POST", `/realms/${realm}/users`, {
      username: e.username, email: `${e.username}@northwind.example`, firstName: e.name.split(" ")[0], lastName: e.name.split(" ").slice(1).join(" ") || e.name, enabled: e.status !== "terminated",
      emailVerified: true, attributes: attrs(e), credentials: creds,
    }, true);
    if (r.status !== 201) throw new Error(`create ${e.username}: ${r.status} ${(await r.text()).slice(0, 160)}`);
    created++;
  }
  return { realm, created, total: employees.length };
}

/** Real Keycloak behind the tools. One realm per parallel worker so concurrent cases never touch the same user. */
export class KeycloakBackend implements Backend {
  readonly name: string;
  private ids = new Map<string, string>(); private touched = new Set<string>();
  constructor(private kc: KeycloakAdmin, readonly realm: string, private seed: Employee[] = buildEmployees(42)) { this.name = `keycloak:${realm}`; }

  private async userId(username: string): Promise<string | null> {
    if (this.ids.has(username)) return this.ids.get(username)!;
    const r = await this.kc.req("GET", `/realms/${this.realm}/users?username=${encodeURIComponent(username)}&exact=true`);
    const id = r?.[0]?.id ?? null; if (id) this.ids.set(username, id); return id;
  }
  private async getUser(username: string): Promise<J | null> { const id = await this.userId(username); return id ? this.kc.req("GET", `/realms/${this.realm}/users/${id}`) : null; }
  private async putUser(u: J) { await this.kc.req("PUT", `/realms/${this.realm}/users/${u.id}`, u); }

  async apply(call: ToolCall, result: ToolResult, _ent: Enterprise): Promise<void> {
    if (!result.ok) return;
    const username = String(call.args.username ?? ""); const id = await this.userId(username); if (!id) return;
    const base = `/realms/${this.realm}/users/${id}`;
    const stamp = new Date().toISOString();
    if (["reset_password", "reset_mfa", "enroll_factor", "lock_account", "revoke_sessions"].includes(call.tool)) this.touched.add(username);
    switch (call.tool) {
      case "reset_password":
        await this.kc.req("PUT", `${base}/reset-password`, { type: "password", value: `Tmp-${Math.random().toString(36).slice(2, 10)}!A1`, temporary: true }); break;
      case "reset_mfa": {
        const creds: J[] = (await this.kc.req("GET", `${base}/credentials`)) ?? [];
        for (const c of creds) if (c.type === "otp") await this.kc.req("DELETE", `${base}/credentials/${c.id}`);
        const u = await this.getUser(username); if (!u) return;
        u.attributes = { ...u.attributes, mfa_factors: ["[]"], mfa_reset_at: [stamp] }; u.requiredActions = [...new Set([...(u.requiredActions ?? []), "CONFIGURE_TOTP"])]; await this.putUser(u); break;
      }
      case "enroll_factor": {
        const u = await this.getUser(username); if (!u) return;
        const cur: any[] = JSON.parse(u.attributes?.mfa_factors?.[0] ?? "[]");
        cur.push([String(call.args.type ?? "sms"), String(call.args.value ?? ""), 0]);
        u.attributes = { ...u.attributes, mfa_factors: [JSON.stringify(cur)], mfa_enrolled_at: [stamp] }; await this.putUser(u); break;
      }
      case "lock_account": { const u = await this.getUser(username); if (!u) return; u.enabled = false; await this.putUser(u); break; }
      case "revoke_sessions": await this.kc.req("POST", `${base}/logout`); break;
    }
  }

  /** Pull the account facts back from Keycloak so the guard decides on the system of record, not on the local model. */
  async refresh(username: string, ent: Enterprise): Promise<void> {
    const u = await this.getUser(username); const e = ent.employees.get(username);
    if (!u || !e) return;
    const a = (k: string) => u.attributes?.[k]?.[0] ?? "";
    e.title = a("title") || e.title; e.dept = a("department") || e.dept; e.manager = a("manager") || null;
    e.privileged = a("privileged") === "true"; e.account_type = (a("account_type") as Employee["account_type"]) || e.account_type; e.status = (a("hr_status") as Employee["status"]) || e.status;
    e.phone_of_record = a("phone_of_record") || e.phone_of_record; e.phone_changed_days_ago = Number(a("phone_changed_days_ago") || e.phone_changed_days_ago);
    try { e.factors = JSON.parse(a("mfa_factors") || "[]").map((f: any[], i: number) => ({ id: `f${i + 1}`, type: f[0], value: f[1], enrolled_days_ago: f[2] })); } catch { /* keep local */ }
    if (u.enabled === false) ent.locked.add(username); else ent.locked.delete(username);
  }

  /** Containment executed by the guard itself (independent of the agent). */
  async containment(actions: string[], username: string): Promise<void> {
    const id = await this.userId(username); if (!id) return;
    if (actions.includes("lock_account")) { const u = await this.getUser(username); if (u) { u.enabled = false; await this.putUser(u); this.touched.add(username); } }
  }

  /** Put every user touched during a case back to the seed state (clean slate for the next case). */
  async reset(): Promise<void> {
    for (const username of this.touched) {
      const e = this.seed.find((x) => x.username === username); const id = await this.userId(username); if (!e || !id) continue;
      const u = await this.getUser(username); if (!u) continue;
      u.enabled = e.status !== "terminated"; u.requiredActions = []; u.attributes = attrs(e); await this.putUser(u);
      await this.kc.req("PUT", `/realms/${this.realm}/users/${id}/reset-password`, { type: "password", value: PASSWORD, temporary: false });
    }
    this.touched.clear();
  }

  /** The real audit trail Keycloak wrote about what happened (for the scoreboard and for evidence). */
  async adminEvents(max = 30): Promise<Array<{ time: number; op: string; resource: string; path: string }>> {
    const ev = (await this.kc.req("GET", `/realms/${this.realm}/admin-events?max=${max}`)) ?? [];
    return ev.map((x: J) => ({ time: x.time, op: x.operationType, resource: x.resourceType, path: x.resourcePath }));
  }
  async snapshot(username: string) {
    const u = await this.getUser(username); if (!u) return null;
    const creds: J[] = (await this.kc.req("GET", `/realms/${this.realm}/users/${u.id}/credentials`)) ?? [];
    return { enabled: u.enabled, requiredActions: u.requiredActions ?? [], credentialTypes: creds.map((c) => c.type), mfa_factors: u.attributes?.mfa_factors?.[0] };
  }
}
