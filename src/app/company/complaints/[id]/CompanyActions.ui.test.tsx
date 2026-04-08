import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompanyActions } from "./CompanyActions";

describe("CompanyActions", () => {
  it("aplica template e preenche a mensagem", async () => {
    const user = userEvent.setup();
    render(<CompanyActions complaintId="cmp_1" />);

    const combo = screen.getByRole("combobox");
    await user.selectOptions(combo, "BILL_REVIEW");

    const applyButton = screen.getByRole("button", { name: "Aplicar" });
    await user.click(applyButton);

    const textarea = screen.getByPlaceholderText(
      "Explique a ação, prazos e próximos passos. Evite dados pessoais.",
    );
    expect((textarea as HTMLTextAreaElement).value).toContain("análise de faturamento");
  });
});
