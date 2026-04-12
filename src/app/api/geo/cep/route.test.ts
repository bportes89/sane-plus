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
        return new Response(
          JSON.stringify([
            {
              lat: "-23.5",
              lon: "-46.6",
              address: {
                postcode: "01001-000",
                road: "Rua Teste",
                city: "São Paulo",
                state_code: "SP",
              },
            },
          ]),
          {
            status: 200,
          },
        );
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

  it("prioriza resultado compatível com cidade e estado quando o CEP isolado aponta para outra região", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("viacep.com.br")) {
        return new Response(
          JSON.stringify({
            logradouro: "Rua Pascoal da Ribeira",
            bairro: "Jardim Consórcio",
            localidade: "São Paulo",
            uf: "SP",
          }),
          { status: 200 },
        );
      }
      if (url.includes("street=Rua+Pascoal+da+Ribeira")) {
        return new Response(
          JSON.stringify([
            {
              lat: "-23.6764",
              lon: "-46.6418",
              address: {
                postcode: "04437-090",
                road: "Rua Pascoal da Ribeira",
                neighbourhood: "Jardim Consórcio",
                city: "São Paulo",
                state_code: "SP",
              },
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes("postalcode=04437090")) {
        return new Response(
          JSON.stringify([
            {
              lat: "-21.7425",
              lon: "-43.3167",
              address: {
                postcode: "04437-090",
                city: "Juiz de Fora",
                state_code: "MG",
              },
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes("nominatim.openstreetmap.org")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("http://localhost/api/geo/cep?cep=04437-090");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { lat?: number | null; lng?: number | null; city?: string | null; state?: string | null };
    expect(json.city).toBe("São Paulo");
    expect(json.state).toBe("SP");
    expect(json.lat).toBeCloseTo(-23.6764);
    expect(json.lng).toBeCloseTo(-46.6418);
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
