import { render, act } from "@testing-library/react";
import { A11yBootstrap } from "./A11yBootstrap";

describe("A11yBootstrap", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-a11y-contrast");
    document.documentElement.removeAttribute("data-a11y-simplicity");
    localStorage.removeItem("saneplus.a11y.contrast");
    localStorage.removeItem("saneplus.a11y.simplicity");
  });

  it("aplica preferências do localStorage no html", () => {
    localStorage.setItem("saneplus.a11y.contrast", "high");
    localStorage.setItem("saneplus.a11y.simplicity", "on");
    render(<A11yBootstrap />);
    expect(document.documentElement.dataset.a11yContrast).toBe("high");
    expect(document.documentElement.dataset.a11ySimplicity).toBe("on");
  });

  it("reage ao evento customizado saneplus:a11y", () => {
    render(<A11yBootstrap />);
    expect(document.documentElement.dataset.a11yContrast).toBeUndefined();

    localStorage.setItem("saneplus.a11y.contrast", "high");
    act(() => {
      window.dispatchEvent(new Event("saneplus:a11y"));
    });
    expect(document.documentElement.dataset.a11yContrast).toBe("high");
  });
});

