import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";
import { GET } from "./route";

describe("GET /api/geo/cep", () => {
  beforeEach(() => {
    rateLimitTesting.reset();
    vi.restoreAllMocks();
  });

  it("retorna endereço e coordenadas quando encontra CEP", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("viacep.com.br")) {
        return new Response(
          JSON.stringify({
            logradouro: "Rua Teste",
            bairro: "Centro",
            localidade: "São Paulo",
            uf: "SP",
          }),
          { status: 200 },
        );
      }
      if (url.includes("nominatim.openstreetmap.org")) {
        return new Response(JSON.stringify([{ lat: "-23.5", lon: "-46.6" }]), {
          status: 200,
        });
      }
      return new Response("{}", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("http://localhost/api/geo/cep?cep=01001-000");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      cep?: string;
      street?: string | null;
      neighborhood?: string | null;
      city?: string | null;
      state?: string | null;
      lat?: number | null;
      lng?: number | null;
    };
    expect(json.cep).toBe("01001000");
    expect(json.street).toBe("Rua Teste");
    expect(json.neighborhood).toBe("Centro");
    expect(json.city).toBe("São Paulo");
    expect(json.state).toBe("SP");
    expect(json.lat).toBeCloseTo(-23.5);
    expect(json.lng).toBeCloseTo(-46.6);
  });

  it("valida CEP inválido", async () => {
    const req = new Request("http://localhost/api/geo/cep?cep=123");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando ViaCEP não encontra", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("viacep.com.br")) {
        return new Response(JSON.stringify({ erro: true }), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("http://localhost/api/geo/cep?cep=01001000");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(404);
  });
});

