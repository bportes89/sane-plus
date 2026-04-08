import { hashPassword, verifyPassword, hasRole } from "./auth";
import { UserRole } from "@/generated/prisma/client";

describe("auth helpers", () => {
  it("hashPassword + verifyPassword validam credenciais", async () => {
    const hash = await hashPassword("Senha#123");
    expect(hash).not.toBe("Senha#123");
    expect(await verifyPassword("Senha#123", hash)).toBe(true);
    expect(await verifyPassword("errada", hash)).toBe(false);
  });

  it("hasRole valida permissões", () => {
    expect(hasRole(UserRole.CITIZEN, [UserRole.CITIZEN])).toBe(true);
    expect(hasRole(UserRole.CITIZEN, [UserRole.COMPANY])).toBe(false);
  });
});
