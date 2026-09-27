/**
 * One observability bus that every part of the system publishes to, so a UI (or a log file) can watch a call
 * happen in real time without any component needing to know who is listening.
 *
 * Why this exists: before this, the only way to see what Jev was asked and what it answered was to read a
 * console log after the fact. The dashboard needs it live, in order, attributed to a session.
 *
 * Nothing here may ever throw into a caller: a listener that blows up must not take down a support call.
 */
import { EventEmitter } from "node:events";

/** Every kind of thing worth watching. `t` is the wall-clock time the event happened. */
export type ObsEvent =
  | { kind: "agent.step"; sid: string; t: number; step: number; note: string }
  | { kind: "agent.model"; sid: string; t: number; provider: string; model: string; latencyMs: number; cached: boolean; reply: string }
  | { kind: "fn.call"; sid: string; t: number; module: string; fn: string; args?: unknown }
  | { kind: "fn.return"; sid: string; t: number; module: string; fn: string; ms: number; result?: unknown }
  | { kind: "jev.request"; sid: string; t: number; model: string; state: unknown; questions: unknown }
  | { kind: "jev.response"; sid: string; t: number; model: string; source: string; cached: boolean; latencyMs: number; costUsd: number; answers: unknown }
  | { kind: "failproof.request"; sid: string; t: number; api: string; url: string; eventCount: number; events: unknown[] }
  | { kind: "failproof.response"; sid: string; t: number; api: string; status: number; body: unknown }
  | { kind: "failproof.skipped"; sid: string; t: number; reason: string }
  | { kind: "guard.evaluate"; sid: string; t: number; tool: string; args: unknown }
  | { kind: "guard.features"; sid: string; t: number; features: Record<string, unknown> }
  | { kind: "guard.verdict"; sid: string; t: number; verdict: string; ruleId: string; enforced: boolean; message: string; latencyMs: number }
  | { kind: "tool.call"; sid: string; t: number; tool: string; args: unknown }
  | { kind: "tool.result"; sid: string; t: number; tool: string; ok: boolean; blocked: boolean; data?: unknown; error?: string }
  | { kind: "caller.says"; sid: string; t: number; text: string }
  | { kind: "agent.says"; sid: string; t: number; text: string }
  | { kind: "note"; sid: string; t: number; text: string };

/** `Omit` over a union collapses to the keys the members share, which would lose every event-specific field.
 *  This distributes the Omit across each member of the union instead. */
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
/** What a publisher passes in: any event, minus the two fields the bus fills in itself. */
export type ObsEventInput = DistributiveOmit<ObsEvent, "sid" | "t"> & { sid?: string; t?: number };

class ObsBus extends EventEmitter {
  /** The session id the current work belongs to. Set by whoever starts a call; read by deep components
   *  (the Jev client, the Failproof tracer) that have no other way to know which call they are part of. */
  private current = "-";
  setSession(sid: string) { this.current = sid; }
  sessionId() { return this.current; }

  /** Publish. `sid` defaults to the current session. Never throws. */
  emitEvent(e: ObsEventInput) {
    try {
      const full = { ...e, sid: e.sid ?? this.current, t: e.t ?? Date.now() } as ObsEvent;
      this.emit("obs", full);
    } catch { /* observability must never break a real call */ }
  }

  /** Listen to everything. Returns an unsubscribe function. */
  subscribe(fn: (e: ObsEvent) => void): () => void {
    const h = (e: ObsEvent) => { try { fn(e); } catch { /* a bad listener must not break the bus */ } };
    this.on("obs", h);
    return () => { this.off("obs", h); };
  }

  /** Time a function and publish call/return around it. Used to make internal control flow visible. */
  async timed<T>(module: string, fn: string, args: unknown, body: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    this.emitEvent({ kind: "fn.call", module, fn, args });
    const out = await body();
    this.emitEvent({ kind: "fn.return", module, fn, ms: Date.now() - t0 });
    return out;
  }
}

export const bus = new ObsBus();
// A bus with many concurrent listeners (browser tabs) must not warn about leaks.
bus.setMaxListeners(200);
