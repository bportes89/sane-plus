import { categories } from "./categories";

describe("categories", () => {
  it("possui categorias com subcategorias", () => {
    expect(categories["Água"].length).toBeGreaterThan(0);
    expect(categories["Esgoto"].length).toBeGreaterThan(0);
    expect(categories["Infraestrutura"].length).toBeGreaterThan(0);
    expect(categories["Financeiro"].length).toBeGreaterThan(0);
    expect(categories["Atendimento"].length).toBeGreaterThan(0);
  });
});

