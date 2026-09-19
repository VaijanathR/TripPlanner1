import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShareLink from "./ShareLink";
import { sharingApi } from "../api/sharing";

vi.mock("../api/sharing", () => ({
  sharingApi: { create: vi.fn() },
}));

const writeText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  writeText.mockResolvedValue(undefined);
});

describe("ShareLink", () => {
  it("shows no link until one is requested", () => {
    render(<ShareLink tripId="1" />);

    expect(screen.getByRole("button", { name: "Get share link" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Share link")).not.toBeInTheDocument();
  });

  it("shows the full share URL and a Copy action once the link is created", async () => {
    sharingApi.create.mockResolvedValue({ share_token: "abc-123" });
    render(<ShareLink tripId="1" />);

    fireEvent.click(screen.getByRole("button", { name: "Get share link" }));

    const input = await screen.findByLabelText("Share link");
    expect(input).toHaveValue(`${window.location.origin}/share/abc-123`);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(sharingApi.create).toHaveBeenCalledWith("1");
  });

  it("copies the link to the clipboard and confirms", async () => {
    sharingApi.create.mockResolvedValue({ share_token: "abc-123" });
    render(<ShareLink tripId="1" />);
    fireEvent.click(screen.getByRole("button", { name: "Get share link" }));
    await screen.findByLabelText("Share link");

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByText("Copied!")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/share/abc-123`);
  });

  it("does not claim the link was copied when the clipboard is unavailable", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    sharingApi.create.mockResolvedValue({ share_token: "abc-123" });
    render(<ShareLink tripId="1" />);
    fireEvent.click(screen.getByRole("button", { name: "Get share link" }));
    await screen.findByLabelText("Share link");

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByText(/Couldn't copy automatically/)).toBeInTheDocument();
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
  });

  it("shows an inline error with Retry when creating the link fails, then recovers on Retry", async () => {
    sharingApi.create.mockRejectedValueOnce(new Error("server down"));
    render(<ShareLink tripId="1" />);

    fireEvent.click(screen.getByRole("button", { name: "Get share link" }));

    expect(await screen.findByText(/Couldn't create a share link: server down/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Share link")).not.toBeInTheDocument();

    sharingApi.create.mockResolvedValueOnce({ share_token: "second-try" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Share link")).toHaveValue(`${window.location.origin}/share/second-try`)
    );
    expect(screen.queryByText(/Couldn't create a share link/)).not.toBeInTheDocument();
  });

  it("disables the button while the request is in flight", async () => {
    sharingApi.create.mockReturnValue(new Promise(() => {}));
    render(<ShareLink tripId="1" />);

    fireEvent.click(screen.getByRole("button", { name: "Get share link" }));

    expect(await screen.findByRole("button", { name: "Getting link…" })).toBeDisabled();
  });
});
