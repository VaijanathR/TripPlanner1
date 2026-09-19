import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { destinationsApi } from "../api/destinations";
import { MAX_POLLS, useGuide } from "./useGuide";

vi.mock("../api/destinations", () => ({ destinationsApi: { guide: vi.fn() } }));

const guide = (status, extra = {}) => ({ status, photos: {}, places: { city: [], around: [] }, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useGuide", () => {
  it("does nothing for a trip with no destination", async () => {
    const { result } = renderHook(() => useGuide("1", null));

    expect(result.current.guide).toBeNull();
    expect(destinationsApi.guide).not.toHaveBeenCalled();
  });

  it("loads the guide once it is ready and stops asking", async () => {
    destinationsApi.guide.mockResolvedValue(guide("ready"));
    const { result } = renderHook(() => useGuide("1", 123, 5));

    await waitFor(() => expect(result.current.guide?.status).toBe("ready"));
    await new Promise((r) => setTimeout(r, 40));
    expect(destinationsApi.guide).toHaveBeenCalledTimes(1);
    expect(destinationsApi.guide).toHaveBeenCalledWith("1");
  });

  it("keeps polling while the guide is building, shows what has arrived, and stops when it is ready", async () => {
    destinationsApi.guide
      .mockResolvedValueOnce(guide("building", { sections: { photos: "ready" } }))
      .mockResolvedValueOnce(guide("building", { sections: { photos: "ready", places_city: "ready" } }))
      .mockResolvedValue(guide("ready"));
    const { result } = renderHook(() => useGuide("1", 123, 5));

    await waitFor(() => expect(result.current.guide?.status).toBe("ready"));
    await new Promise((r) => setTimeout(r, 40));
    expect(destinationsApi.guide).toHaveBeenCalledTimes(3);
  });

  it("gives up after a bounded number of polls rather than asking forever", async () => {
    destinationsApi.guide.mockResolvedValue(guide("building"));
    renderHook(() => useGuide("1", 123, 1));

    await waitFor(() => expect(destinationsApi.guide).toHaveBeenCalledTimes(MAX_POLLS + 1), { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 30));
    expect(destinationsApi.guide).toHaveBeenCalledTimes(MAX_POLLS + 1);
  }, 8000);

  it("stops polling when the component goes away", async () => {
    destinationsApi.guide.mockResolvedValue(guide("building"));
    const { unmount } = renderHook(() => useGuide("1", 123, 5));
    await waitFor(() => expect(destinationsApi.guide).toHaveBeenCalled());

    unmount();
    const callsAtUnmount = destinationsApi.guide.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));

    expect(destinationsApi.guide.mock.calls.length).toBe(callsAtUnmount);
  });

  it("reports an error and keeps the last guide it had", async () => {
    destinationsApi.guide.mockResolvedValueOnce(guide("building")).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useGuide("1", 123, 5));

    await waitFor(() => expect(result.current.error).toBe("offline"));
    expect(result.current.guide?.status).toBe("building");
  });

  it("retry clears the error and asks again", async () => {
    destinationsApi.guide.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(guide("ready"));
    const { result } = renderHook(() => useGuide("1", 123, 5));
    await waitFor(() => expect(result.current.error).toBe("offline"));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.guide?.status).toBe("ready"));
    expect(result.current.error).toBeNull();
  });

  it("loads again when the trip's destination changes", async () => {
    destinationsApi.guide.mockResolvedValue(guide("ready"));
    const { rerender } = renderHook(({ key }) => useGuide("1", key, 5), { initialProps: { key: 111 } });
    await waitFor(() => expect(destinationsApi.guide).toHaveBeenCalledTimes(1));

    rerender({ key: 222 });

    await waitFor(() => expect(destinationsApi.guide).toHaveBeenCalledTimes(2));
  });

  it("returns no guide once the destination is removed", async () => {
    destinationsApi.guide.mockResolvedValue(guide("ready"));
    const { result, rerender } = renderHook(({ key }) => useGuide("1", key, 5), { initialProps: { key: 111 } });
    await waitFor(() => expect(result.current.guide).not.toBeNull());

    rerender({ key: null });

    expect(result.current.guide).toBeNull();
  });
});
