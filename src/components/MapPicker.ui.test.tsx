import { render, act, waitFor } from "@testing-library/react";
import { MapPicker } from "./MapPicker";

const clickListeners: Array<(e: { latlng: { lat: number; lng: number } }) => void> = [];
const markerAddTo = vi.fn();
const markerSetLatLng = vi.fn();
const mapSetView = vi.fn();

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
        setView: mapSetView,
        getZoom: vi.fn(() => 12),
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
    marker: () => ({
      addTo: markerAddTo.mockImplementation(() => ({ setLatLng: markerSetLatLng })),
    }),
  };
  return { ...api, default: api };
});

describe("MapPicker", () => {
  beforeEach(() => {
    clickListeners.length = 0;
    markerAddTo.mockReset();
    markerSetLatLng.mockReset();
    mapSetView.mockReset();
  });

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

  it("aplica coordenadas recebidas logo após a montagem e centraliza o mapa", async () => {
    const view = render(<MapPicker />);

    view.rerender(<MapPicker lat={-23.420999} lng={-51.933056} />);

    await waitFor(() => {
      expect(markerAddTo).toHaveBeenCalled();
    });

    expect(mapSetView).toHaveBeenCalledWith([-23.420999, -51.933056], 15, { animate: false });
  });
});
