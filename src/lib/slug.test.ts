import { slugify } from "./slug";

describe("slugify", () => {
  it("normaliza acentos, remove símbolos e limita tamanho", () => {
    const s = slugify("Água turva: Vazamento na Rua São José, nº 123!");
    expect(s).toBe("agua-turva-vazamento-na-rua-sao-jose-n-123");
    expect(s.length).toBeLessThanOrEqual(60);
  });

  it("remove hífens iniciais e finais", () => {
    expect(slugify(" --- teste --- ")).toBe("teste");
  });
});

