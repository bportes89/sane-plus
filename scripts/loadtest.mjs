import autocannon from "autocannon";

const baseUrl = process.env.TARGET_URL ?? "http://localhost:3000";
const targetPath = process.env.TARGET_PATH ?? null;

function parseCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const first = setCookieHeader.split(",")[0] ?? setCookieHeader;
  const cookie = first.split(";")[0]?.trim() ?? null;
  return cookie || null;
}

async function createSessionCookie() {
  const email = `citizen_${Date.now()}_${Math.random().toString(16).slice(2)}@test.local`;
  const password = process.env.TEST_PASSWORD ?? "Pass123!";

  const res = await fetch(new URL("/api/auth/register", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ name: "Load Tester", email, password }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Falha ao registrar para obter sessão: ${res.status} ${body}`);
  }

  const setCookie = res.headers.get("set-cookie");
  const cookie = parseCookie(setCookie);
  if (!cookie) throw new Error("Resposta do register não retornou Set-Cookie");
  return cookie;
}

const connections = Number(process.env.CONNECTIONS ?? 50);
const duration = Number(process.env.DURATION ?? 30);
const pipelining = Number(process.env.PIPELINING ?? 1);
const enableWrites = String(process.env.ENABLE_WRITES ?? "") === "1";

const result = await (async () => {
  if (targetPath) {
    return autocannon({
      url: new URL(targetPath, baseUrl).toString(),
      connections,
      duration,
      pipelining,
    });
  }

  const cookie = await createSessionCookie();
  const acceptHeaders = { accept: "application/json" };
  const authHeaders = { ...acceptHeaders, cookie };

  const requests = [
    {
      method: "GET",
      path: "/api/complaints/map?limit=200&bucket=open",
      headers: acceptHeaders,
    },
    { method: "GET", path: "/api/companies", headers: acceptHeaders },
    { method: "GET", path: "/api/auth/me", headers: authHeaders },
    { method: "GET", path: "/api/complaints", headers: authHeaders },
  ];

  if (enableWrites) {
    requests.push({
      method: "POST",
      path: "/api/complaints",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "Companhia Teste",
        category: "Água",
        issue: "Falta de água",
        description: "Teste de carga (autocannon).",
        visibility: "PUBLIC",
      }),
    });
  }

  return autocannon({
    url: baseUrl,
    connections,
    duration,
    pipelining,
    requests,
  });
})();

process.stdout.write(autocannon.printResult(result));
