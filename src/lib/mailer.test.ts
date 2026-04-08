import { sendEmailUsingProvider } from "./mailer";

describe("mailer", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("usa fallback simulado quando não há API key", async () => {
    delete process.env.RESEND_API_KEY;
    const res = await sendEmailUsingProvider({ to: "x@y.com", subject: "Teste", text: "Oi" });
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("simulated");
  });
});

