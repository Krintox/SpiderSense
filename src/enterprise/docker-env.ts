import { KeycloakAdmin, KeycloakBackend } from "./keycloak.js";
import { ZammadChannel } from "./zammad.js";
import { loadEnv } from "../util/env.js";

/** Real systems from the Docker stack. One Keycloak realm per parallel worker; one shared Zammad. Throws if not provisioned. */
export async function dockerSystems(workers: number) {
  loadEnv();
  const kc = new KeycloakAdmin();
  if (!(await kc.alive())) throw new Error("Keycloak is not running (docker compose -p keycloak -f infra/keycloak-compose.yml up -d)");
  const e = process.env;
  if (!e.ZAMMAD_ADMIN_TOKEN || !e.ZAMMAD_ARIA_TOKEN || !e.ZAMMAD_GUARD_TOKEN) throw new Error("Zammad is not provisioned: run npm run infra:setup");
  const channel = new ZammadChannel({ adminToken: e.ZAMMAD_ADMIN_TOKEN, ariaToken: e.ZAMMAD_ARIA_TOKEN, guardToken: e.ZAMMAD_GUARD_TOKEN });
  const backends = Array.from({ length: workers }, (_, w) => new KeycloakBackend(kc, `northwind-w${w}`));
  return { kc, channel, backends };
}
