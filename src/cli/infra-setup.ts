/** One-time provisioning of the Docker systems. npm run infra:setup [-- --workers 3]
 *  Keycloak: realm per worker with 40 seeded users. Zammad: agent accounts, tokens, guest customer. Saves tokens to .env. */
import { KeycloakAdmin, ensureRealm } from "../enterprise/keycloak.js";
import { Zammad, setupZammad } from "../enterprise/zammad.js";
import { loadEnv } from "../util/env.js";
import { set_env } from "../util/set-env.js";

loadEnv();
const workers = Number(process.argv.includes("--workers") ? process.argv[process.argv.indexOf("--workers") + 1] : 3);
const kc = new KeycloakAdmin();
if (!(await kc.alive())) { console.error("Keycloak is not reachable at http://localhost:8180. Run: docker compose -p keycloak -f infra/keycloak-compose.yml up -d"); process.exit(1); }
for (let w = 0; w < workers; w++) { const t0 = Date.now(); const r = await ensureRealm(kc, `northwind-w${w}`); console.log(`keycloak realm ${r.realm}: created ${r.created}/${r.total} users (${Date.now() - t0} ms)`); }
set_env("KEYCLOAK_URL", "http://localhost:8180");

if (!(await new Zammad("").alive())) { console.error("Zammad is not reachable at http://localhost:8082"); process.exit(1); }
const c = await setupZammad();
set_env("ZAMMAD_URL", "http://localhost:8082"); set_env("ZAMMAD_ADMIN_TOKEN", c.adminToken); set_env("ZAMMAD_ARIA_TOKEN", c.ariaToken); set_env("ZAMMAD_GUARD_TOKEN", c.guardToken);
console.log("zammad: agent accounts + tokens created, saved to .env (values not printed)");
