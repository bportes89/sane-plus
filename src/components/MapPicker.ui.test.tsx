import { render, act, waitFor } from "@testing-library/react";
import { MapPicker } from "./MapPicker";

const clickListeners: Array<(e: { latlng: { lat: number; lng: number } }) => void> = [];

vi.mock("leaflet", () => {
  const api = {
    map: (el: HTMLElement, opts: Record<string, unknown>) => {
      void el;
      void opts;
      return {
        on: (
          _event: string,
          cb: (e: { latlng: { lat: number; lng: number } }) => void,
        ) => {
          clickListeners.push(cb);
        },
        whenReady: (cb: () => void) => cb(),
        invalidateSize: vi.fn(),
        remove: vi.fn(),
      };
    },
    tileLayer: () => {
      const layer = {
        addTo: vi.fn(() => layer),
        on: vi.fn(() => layer),
        removeFrom: vi.fn(() => layer),
      };
      return layer;
    },
    divIcon: vi.fn(() => ({})),
    marker: () => ({ addTo: () => ({ setLatLng: vi.fn() }) }),
  };
  return { ...api, default: api };
});

describe("MapPicker", () => {
  it("dispara onChange ao clicar no mapa (mockado)", async () => {
    const onChange = vi.fn();
    render(<MapPicker onChange={onChange} />);
    await waitFor(() => {
      expect(clickListeners.length).toBeGreaterThan(0);
    });
    await act(async () => {
      clickListeners.forEach((cb) => cb({ latlng: { lat: -23.5, lng: -46.6 } }));
    });
    expect(onChange).toHaveBeenCalledWith({ lat: -23.5, lng: -46.6 });
  });
});
