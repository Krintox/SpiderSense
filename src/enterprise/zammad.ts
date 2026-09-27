/**
 * Zammad (real help desk, Docker) as the support channel.
 *
 * Trust boundary, enforced by the platform rather than by us:
 *  - The CALLER's messages are created as the customer ("Unverified Caller") through Zammad's X-On-Behalf-Of, so Zammad records
 *    created_by = that customer. The guard reads caller lines only from articles whose created_by_id is the customer's id.
 *  - The AGENT (Aria) has its own agent account and token. If the agent posts an article labelled "Customer", Zammad still
 *    records created_by = Aria, so it can never pass as the caller.
 *  - The guard writes its verdicts as internal notes under its own account, next to the agent's work notes.
 * Real incidents (create_ticket, SOC alerts, analyst approvals) become real Zammad tickets.
 */
import type { Channel, Enterprise } from "./enterprise.js";

type J = Record<string, any>;
export const ZAMMAD_URL = process.env.ZAMMAD_URL ?? "http://localhost:8082";
export const GUEST_EMAIL = "unverified.caller@northwind.example";

export class Zammad {
  constructor(readonly token: string, private base = ZAMMAD_URL) {}
  static basic(user: string, pass: string, base = ZAMMAD_URL) { const z = new Zammad("", base); z.basicAuth = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`; return z; }
  private basicAuth = "";
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<any> {
    const r = await fetch(`${this.base}/api/v1${path}`, {
      method, signal: AbortSignal.timeout(30000), body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "Content-Type": "application/json", Authorization: this.basicAuth || `Token token=${this.token}`, ...headers },
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`zammad ${method} ${path} -> ${r.status} ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
  }
  async alive(): Promise<boolean> { try { return (await fetch(`${this.base}/api/v1/getting_started`, { signal: AbortSignal.timeout(4000) })).status < 500; } catch { return false; } }
}

export interface ZammadCreds { adminToken: string; ariaToken: string; guardToken: string }

export class ZammadChannel implements Channel {
  readonly name = "zammad";
  private tickets = new Map<string, number>(); private guestId = 0;
  private admin: Zammad; private aria: Zammad; private guard: Zammad;
  constructor(c: ZammadCreds) { this.admin = new Zammad(c.adminToken); this.aria = new Zammad(c.ariaToken); this.guard = new Zammad(c.guardToken); }

  private async guest(): Promise<number> {
    if (this.guestId) return this.guestId;
    const u = await this.admin.req("GET", `/users/search?query=${encodeURIComponent(GUEST_EMAIL)}&limit=1`);
    this.guestId = u?.[0]?.id; if (!this.guestId) throw new Error("run `npm run infra:setup` first (guest customer missing)"); return this.guestId;
  }

  async open(sid: string, ent: Enterprise): Promise<void> {
    await this.guest();
    const sc = ent.scenario;
    const t = await this.admin.req("POST", "/tickets", {
      title: `Service desk chat ${sid}`, group: "Users", customer: GUEST_EMAIL, priority_id: 2,
      article: { subject: "Chat opened", body: "Chat session opened by an unverified caller.", type: "note", sender: "Customer", internal: false },
    }, { "X-On-Behalf-Of": GUEST_EMAIL });
    this.tickets.set(sid, t.id);
    await this.admin.req("POST", "/tags/add", { object: "Ticket", o_id: t.id, item: `case-${sc?.kind ?? "call"}` }).catch(() => {});
  }

  async post(sid: string, from: "caller" | "agent" | "guard", text: string, internal = false): Promise<void> {
    const id = this.tickets.get(sid); if (!id) return;
    const body = { ticket_id: id, subject: from, body: text, content_type: "text/plain", type: "note" as const };
    if (from === "caller") await this.admin.req("POST", "/ticket_articles", { ...body, sender: "Customer", internal: false }, { "X-On-Behalf-Of": GUEST_EMAIL });
    else if (from === "agent") await this.aria.req("POST", "/ticket_articles", { ...body, sender: "Agent", internal });
    else await this.guard.req("POST", "/ticket_articles", { ...body, sender: "Agent", internal: true });
  }

  /** Caller lines as the PLATFORM attributed them (created_by = the customer), oldest first. The opening system note is skipped. */
  async fetchCallerLines(sid: string): Promise<string[]> {
    const id = this.tickets.get(sid); if (!id) return [];
    const guest = await this.guest();
    const arts: J[] = await this.admin.req("GET", `/ticket_articles/by_ticket/${id}`);
    return arts.filter((a) => a.created_by_id === guest && a.subject === "caller").sort((a, b) => a.id - b.id).map((a) => String(a.body));
  }

  /** A real incident ticket (create_ticket, SOC alert, analyst approval). */
  async incident(kind: "ticket" | "soc" | "approval", title: string, body: string, priority = 2): Promise<number> {
    const t = await this.admin.req("POST", "/tickets", { title: `${kind === "soc" ? "SOC ALERT: " : kind === "approval" ? "ANALYST APPROVAL: " : ""}${title}`.slice(0, 200), group: "Users", customer: GUEST_EMAIL, priority_id: Math.min(3, Math.max(1, priority)), article: { subject: title.slice(0, 80), body: body.slice(0, 4000), type: "note", sender: "Agent", internal: true } });
    await this.admin.req("POST", "/tags/add", { object: "Ticket", o_id: t.id, item: kind }).catch(() => {});
    return t.id;
  }

  async close(sid: string, resolution: string): Promise<void> {
    const id = this.tickets.get(sid); if (!id) return;
    await this.guard.req("POST", "/ticket_articles", { ticket_id: id, subject: "outcome", body: `Call outcome: ${resolution}`, type: "note", sender: "Agent", internal: true, content_type: "text/plain" });
    await this.admin.req("PUT", `/tickets/${id}`, { state: "closed" });
  }
  ticketId(sid: string) { return this.tickets.get(sid); }
}

/** One-time provisioning: agent accounts, tokens, the unverified-caller customer, and one customer record per employee. */
export async function setupZammad(adminUser = "admin@northwind.local", adminPass = "Spider-Sense-2026!"): Promise<ZammadCreds> {
  const basic = Zammad.basic(adminUser, adminPass);
  const mk = async (email: string, first: string, last: string, roles: number[], password: string) => {
    const found = await basic.req("GET", `/users/search?query=${encodeURIComponent(email)}&limit=1`);
    if (found?.[0]) return found[0];
    return basic.req("POST", "/users", { login: email, email, firstname: first, lastname: last, role_ids: roles, password, ...(roles.includes(2) ? { group_ids: { "1": ["full"] } } : {}) });
  };
  await mk("aria@northwind.local", "Aria", "Service Desk Agent (AI)", [2], "Aria-agent-2026!");
  await mk("spidersense@northwind.local", "SpiderSense", "Guard", [2], "Spider-guard-2026!");
  await mk(GUEST_EMAIL, "Unverified", "Caller", [3], "Guest-caller-2026!");
  const tokenFor = async (user: string, pass: string, name: string, perms: string[]) => {
    const z = Zammad.basic(user, pass);
    const list = await z.req("GET", "/user_access_token").catch(() => ({ tokens: [] }));
    for (const t of list?.tokens ?? []) if (t.name === name) await z.req("DELETE", `/user_access_token/${t.id}`).catch(() => {});
    const r = await z.req("POST", "/user_access_token", { name, permission: perms }); return String(r.token);
  };
  return {
    adminToken: await tokenFor(adminUser, adminPass, "spidersense-admin", ["admin", "ticket.agent"]),
    ariaToken: await tokenFor("aria@northwind.local", "Aria-agent-2026!", "aria", ["ticket.agent"]),
    guardToken: await tokenFor("spidersense@northwind.local", "Spider-guard-2026!", "guard", ["ticket.agent"]),
  };
}
