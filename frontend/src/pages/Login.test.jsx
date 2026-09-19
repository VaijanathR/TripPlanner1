import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import Login from "./Login";

vi.mock("../auth/useAuth", () => ({ useAuth: vi.fn() }));
// The real button loads Google's script; here it just hands back a credential.
vi.mock("../components/GoogleSignInButton", () => ({
  default: ({ onCredential }) => <button onClick={() => onCredential("google-cred")}>google-stub</button>,
}));

const auth = { status: "anon", login: vi.fn(), register: vi.fn(), loginWithGoogle: vi.fn() };

function renderLogin(entry = "/login") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<p>HOME PAGE</p>} />
        <Route path="/trips/:id" element={<p>EDITOR PAGE</p>} />
      </Routes>
    </MemoryRouter>
  );
}

const fill = (email, password) => {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
};
const submitForm = () => fireEvent.submit(screen.getByLabelText("Email").closest("form"));

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ ...auth, status: "anon" });
});

describe("Login: logging in", () => {
  it("shows the log-in form by default", () => {
    renderLogin();

    expect(screen.getByRole("tab", { name: "Log in" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("logs in with the entered credentials and goes to the trip list", async () => {
    auth.login.mockResolvedValue();
    renderLogin();

    fill("alice@example.com", "correct-horse");
    submitForm();

    await waitFor(() => expect(auth.login).toHaveBeenCalledWith("alice@example.com", "correct-horse"));
    expect(await screen.findByText("HOME PAGE")).toBeInTheDocument();
  });

  it("returns the user to the page they were trying to reach", async () => {
    auth.login.mockResolvedValue();
    renderLogin({ pathname: "/login", state: { from: "/trips/5" } });

    fill("alice@example.com", "correct-horse");
    submitForm();

    expect(await screen.findByText("EDITOR PAGE")).toBeInTheDocument();
  });

  it("shows the error, keeps what was typed, and stays on the page when login fails", async () => {
    auth.login.mockRejectedValue(new ApiError(401, "invalid_credentials", "Incorrect email or password"));
    renderLogin();

    fill("alice@example.com", "wrong-password");
    submitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password");
    expect(screen.queryByText("HOME PAGE")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("alice@example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("wrong-password");
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("disables the form while the request is in flight", () => {
    auth.login.mockReturnValue(new Promise(() => {}));
    renderLogin();

    fill("alice@example.com", "correct-horse");
    submitForm();

    expect(screen.getByRole("button", { name: "Please wait…" })).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
  });

  it("sends an already logged-in visitor straight past the login page", () => {
    useAuth.mockReturnValue({ ...auth, status: "authed" });

    renderLogin();

    expect(screen.getByText("HOME PAGE")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });
});

describe("Login: too many attempts", () => {
  const tooMany = () => new ApiError(429, "too_many_attempts", "Too many attempts. Try again in 12 minutes.");

  it("shows the server's 'try again in N minutes' message and keeps the entered email", async () => {
    auth.login.mockRejectedValue(tooMany());
    renderLogin();

    fill("alice@example.com", "wrong-password");
    submitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Try again in 12 minutes.");
    expect(screen.getByLabelText("Email")).toHaveValue("alice@example.com");
    expect(screen.queryByText("HOME PAGE")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("shows the same message when sign-up is refused", async () => {
    auth.register.mockRejectedValue(tooMany());
    renderLogin();

    fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
    fill("new@example.com", "long-enough-password");
    submitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 12 minutes.");
    expect(screen.getByLabelText("Email")).toHaveValue("new@example.com");
  });

  it("shows the same message when Google sign-in is refused", async () => {
    auth.loginWithGoogle.mockRejectedValue(tooMany());
    renderLogin();

    fireEvent.click(screen.getByText("google-stub"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 12 minutes.");
  });
});

describe("Login: creating an account", () => {
  const openRegister = () => fireEvent.click(screen.getByRole("tab", { name: "Create account" }));

  it("switches to registration and creates the account", async () => {
    auth.register.mockResolvedValue();
    renderLogin();

    openRegister();
    expect(screen.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
    fill("new@example.com", "long-enough-password");
    submitForm();

    await waitFor(() => expect(auth.register).toHaveBeenCalledWith("new@example.com", "long-enough-password"));
    expect(auth.login).not.toHaveBeenCalled();
    expect(await screen.findByText("HOME PAGE")).toBeInTheDocument();
  });

  it("rejects a too-short password before sending anything", () => {
    renderLogin();

    openRegister();
    fill("new@example.com", "short");
    submitForm();

    expect(screen.getByRole("alert")).toHaveTextContent("at least 8 characters");
    expect(auth.register).not.toHaveBeenCalled();
  });

  it("does not apply the length rule to logging in (old passwords must still work)", async () => {
    auth.login.mockResolvedValue();
    renderLogin();

    fill("alice@example.com", "short");
    submitForm();

    await waitFor(() => expect(auth.login).toHaveBeenCalledWith("alice@example.com", "short"));
  });

  it("tells the user when the email is already registered", async () => {
    auth.register.mockRejectedValue(new ApiError(409, "email_taken", "An account with this email already exists"));
    renderLogin();

    openRegister();
    fill("taken@example.com", "long-enough-password");
    submitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent("An account with this email already exists");
  });

  it("shows a server validation message without the technical prefix", async () => {
    auth.register.mockRejectedValue(
      new ApiError(422, "validation_error", "Invalid request", { email: "Value error, must be a valid email address" })
    );
    renderLogin();

    openRegister();
    fill("bad@example.com", "long-enough-password");
    submitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent(/^must be a valid email address$/);
  });

  it("clears a previous error when switching between log in and create account", async () => {
    auth.login.mockRejectedValue(new ApiError(401, "invalid_credentials", "Incorrect email or password"));
    renderLogin();
    fill("alice@example.com", "wrong-password");
    submitForm();
    await screen.findByRole("alert");

    openRegister();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Login: Google", () => {
  it("logs in with the credential Google returns and goes to the trip list", async () => {
    auth.loginWithGoogle.mockResolvedValue();
    renderLogin();

    fireEvent.click(screen.getByText("google-stub"));

    await waitFor(() => expect(auth.loginWithGoogle).toHaveBeenCalledWith("google-cred"));
    expect(await screen.findByText("HOME PAGE")).toBeInTheDocument();
  });

  it("shows why Google sign-in failed and stays on the page", async () => {
    auth.loginWithGoogle.mockRejectedValue(
      new ApiError(503, "google_unavailable", "Google sign-in is temporarily unavailable")
    );
    renderLogin();

    fireEvent.click(screen.getByText("google-stub"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Google sign-in is temporarily unavailable");
    expect(screen.queryByText("HOME PAGE")).not.toBeInTheDocument();
  });
});

