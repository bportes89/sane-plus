import { render, screen } from "@testing-library/react";
import { Logo } from "./Logo";

describe("Logo", () => {
  it("renderiza texto SANE+", () => {
    render(<Logo />);
    expect(screen.getByText("SANE")).toBeInTheDocument();
    expect(screen.getByText("+")).toBeInTheDocument();
  });

  it("renderiza como link quando href é fornecido", () => {
    render(<Logo href="/home" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/");
  });
});
