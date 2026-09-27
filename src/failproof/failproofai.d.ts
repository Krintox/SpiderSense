// Ambient type for the `failproofai` module, provided at runtime by the Failproof daemon on the event machine.
// `src/failproof/spidersense-policies.ts` is `// @ts-nocheck` so it never needed this, but the test file that
// imports the module directly (`tests/failproof-adapter.test.ts`) does. In tests, `node_modules/failproofai/`
// is a local shim of the same shape (see that folder) so the import resolves at runtime too.
declare module "failproofai" {
  export interface PolicyResult { decision: "allow" | "instruct" | "deny"; message?: string }
  export interface PolicyContext { session?: { id?: string }; toolName?: string; toolInput?: unknown }
  export interface CustomPolicy { name: string; description?: string; match?: { events?: string[] }; fn: (ctx: PolicyContext) => Promise<PolicyResult> }
  export const customPolicies: { add(policy: CustomPolicy): void; _registered?: CustomPolicy[] };
  export function allow(): PolicyResult;
  export function instruct(message: string): PolicyResult;
  export function deny(message: string): PolicyResult;
}
