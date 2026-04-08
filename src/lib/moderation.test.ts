import { autoModerate, autoModerateSupportMessage } from "./moderation";

describe("autoModerate", () => {
  it("oculta PII e mantém allow quando só há PII", () => {
    const r = autoModerate("Meu CPF é 123.456.789-10 e meu e-mail é a@b.com.");
    expect(r.severity).toBe("allow");
    expect(r.adjusted).toBe(true);
    expect(r.flags.pii).toBe(true);
    expect(r.output).not.toContain("123.456.789-10");
    expect(r.output).not.toContain("a@b.com");
    expect(r.output).toContain("[dado ocultado]");
  });

  it("bloqueia acusações criminais", () => {
    const r = autoModerate("Vocês são ladrões e fizeram fraude.");
    expect(r.severity).toBe("block");
    expect(r.flags.crimeAccusation).toBe(true);
  });

  it("marca como review temas sensíveis operacionais", () => {
    const r = autoModerate("A água está com contaminação e minha criança foi ao hospital.");
    expect(r.severity).toBe("review");
    expect(r.flags.manualReview).toBe(true);
  });

  it("bloqueia padrões típicos de XSS", () => {
    const r = autoModerate('<script>alert("x")</script>');
    expect(r.severity).toBe("block");
    expect(r.flags.xss).toBe(true);
  });

  it("edita ofensas e mantém allow", () => {
    const r = autoModerate("Atendimento merda. Isso é um absurdo.");
    expect(r.severity).toBe("allow");
    expect(r.adjusted).toBe(true);
    expect(r.flags.profanity).toBe(true);
    expect(r.output).toContain("[ofensa editada]");
  });

  it("oculta nomes de funcionários", () => {
    const r = autoModerate("O atendente João Silva foi grosseiro.");
    expect(r.adjusted).toBe(true);
    expect(r.flags.employeeName).toBe(true);
    expect(r.output).not.toContain("João");
    expect(r.output).toContain("[nome ocultado]");
  });

  it("bloqueia conteúdo de ódio/sexual", () => {
    const r = autoModerate("Isso é racista.");
    expect(r.severity).toBe("block");
    expect(r.flags.hatefulOrSexual).toBe(true);
  });

  it("bloqueia dados sensíveis", () => {
    const r = autoModerate("Tenho hiv e preciso de ajuda.");
    expect(r.severity).toBe("block");
    expect(r.flags.sensitiveData).toBe(true);
  });
});

describe("autoModerateSupportMessage", () => {
  it("oculta PII e edita ofensas", () => {
    const r = autoModerateSupportMessage("Meu telefone é 1199999-0000, atendimento merda.");
    expect(r.adjusted).toBe(true);
    expect(r.flags.pii).toBe(true);
    expect(r.flags.profanity).toBe(true);
    expect(r.output).toContain("[dado ocultado]");
    expect(r.output).toContain("[ofensa editada]");
  });

  it("marca xss no suporte", () => {
    const r = autoModerateSupportMessage('<img src=x onerror=alert(1)>');
    expect(r.flags.xss).toBe(true);
  });
});
