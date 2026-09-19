import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GoogleSignInButton from "./GoogleSignInButton";

const initialize = vi.fn();
const renderButton = vi.fn();
const fakeGoogle = () => ({ accounts: { id: { initialize, renderButton } } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-123.apps.googleusercontent.com");
  document.head.querySelectorAll('script[src*="gsi/client"]').forEach((s) => s.remove());
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.google;
});

// The two script-loading tests must run first, in this order: the module keeps
// the loaded-script promise between renders, so once Google has "loaded" once
// a later failure could not be simulated.
describe("GoogleSignInButton: loading Google's script", () => {
  it("shows a fallback message, and leaves email login usable, when the script fails to load", async () => {
    render(<GoogleSignInButton onCredential={vi.fn()} />);
    const script = document.head.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    expect(script).not.toBeNull();

    await act(async () => script.onerror());

    expect(screen.getByText(/Google sign-in couldn't load/)).toBeInTheDocument();
    expect(initialize).not.toHaveBeenCalled();
  });

  it("initialises Google once the script has loaded", async () => {
    render(<GoogleSignInButton onCredential={vi.fn()} />);
    const script = document.head.querySelector('script[src="https://accounts.google.com/gsi/client"]');

    window.google = fakeGoogle();
    await act(async () => script.onload());

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(renderButton).toHaveBeenCalledTimes(1);
  });
});

describe("GoogleSignInButton", () => {
  it("renders nothing, and never loads Google, when no client id is configured", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");

    const { container } = render(<GoogleSignInButton onCredential={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(document.head.querySelector('script[src*="gsi/client"]')).toBeNull();
    expect(initialize).not.toHaveBeenCalled();
  });

  it("initialises Google with the configured client id and renders its button", async () => {
    window.google = fakeGoogle();

    await act(async () => {
      render(<GoogleSignInButton onCredential={vi.fn()} />);
    });

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "client-123.apps.googleusercontent.com" })
    );
    expect(renderButton).toHaveBeenCalledWith(expect.any(HTMLElement), expect.any(Object));
  });

  it("passes the credential Google returns to the app", async () => {
    window.google = fakeGoogle();
    const onCredential = vi.fn();
    await act(async () => {
      render(<GoogleSignInButton onCredential={onCredential} />);
    });

    initialize.mock.calls[0][0].callback({ credential: "id-token-abc" });

    expect(onCredential).toHaveBeenCalledWith("id-token-abc");
  });

  it("uses the latest onCredential handler without re-initialising Google", async () => {
    window.google = fakeGoogle();
    const first = vi.fn();
    const second = vi.fn();
    let view;
    await act(async () => {
      view = render(<GoogleSignInButton onCredential={first} />);
    });

    await act(async () => view.rerender(<GoogleSignInButton onCredential={second} />));
    initialize.mock.calls[0][0].callback({ credential: "c" });

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("c");
  });
});
