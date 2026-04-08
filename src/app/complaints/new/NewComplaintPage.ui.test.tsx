import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewComplaintPage from "./page";

vi.mock("next/navigation", () => {
  return {
    useRouter: () => ({ replace: vi.fn() }),
  };
});

vi.mock("@/components/MapPicker", () => {
  return {
    MapPicker: (props: { onChange?: (p: { lat: number; lng: number }) => void }) => (
      <button type="button" onClick={() => props.onChange?.({ lat: -23.5, lng: -46.6 })}>
        Mapa
      </button>
    ),
  };
});

describe("NewComplaintPage", () => {
  it("mantém o registro em até 3 passos", async () => {
    const user = userEvent.setup();
    render(<NewComplaintPage />);

    expect(screen.getByText("Passo 1 de 3")).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Qual empresa você quer reclamar?"),
      "Empresa X",
    );

    const next1 = screen.getByRole("button", { name: "Avançar" });
    expect(next1).toBeEnabled();
    await user.click(next1);

    expect(screen.getByText("Passo 2 de 3")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Bairro"), "Centro");
    await user.click(next1);

    expect(screen.getByText("Passo 3 de 3")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Descreva o problema"), "Estou sem água há dois dias.");

    expect(screen.getByText(/Empresa: Empresa X/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar Reclamação" })).toBeEnabled();
  });
});

