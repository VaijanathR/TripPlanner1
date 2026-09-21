import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenStore } from "../auth/tokenStore";
import { api, ApiError, setUnauthorizedHandler } from "./client";

const respond = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const fetchMock = vi.fn();
const onUnauthorized = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(respond(200, { ok: true }));
  localStorage.clear();
  tokenStore.clear();
  setUnauthorizedHandler(onUnauthorized);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

const sentHeaders = () => fetchMock.mock.calls[0][1].headers;

describe("api client: sending the login token", () => {
  it("sends no Authorization header when there is no token", async () => {
    await api.get("/trips");

    expect(sentHeaders().Authorization).toBeUndefined();
    expect(sentHeaders()["Content-Type"]).toBe("application/json");
  });

  it("sends the stored token as a Bearer header on every request", async () => {
    tokenStore.set("tok-123");

    await api.get("/trips");
    await api.post("/trips", { name: "x" });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok-123");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer tok-123");
  });

  it("picks up a token stored after the client was created", async () => {
    await api.get("/trips");
    tokenStore.set("late-token");
    await api.get("/trips");

    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer late-token");
  });
});

describe("api client: expired sessions", () => {
  it("reports a 401 on a logged-in request to the session handler, and still throws", async () => {
    tokenStore.set("expired");
    fetchMock.mockResolvedValue(respond(401, { error: { code: "unauthenticated", message: "Authentication required" } }));

    await expect(api.get("/trips")).rejects.toMatchObject({ status: 401, code: "unauthenticated" });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does not treat wrong credentials at /auth/login as a dead session", async () => {
    tokenStore.set("some-old-token");
    fetchMock.mockResolvedValue(respond(401, { error: { code: "invalid_credentials", message: "Incorrect email or password" } }));

    await expect(api.post("/auth/login", { email: "a", password: "b" })).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("does not call the session handler for a 401 when nobody was logged in", async () => {
    fetchMock.mockResolvedValue(respond(401, { error: { code: "unauthenticated", message: "x" } }));

    await expect(api.get("/trips")).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("does not call the session handler for other errors or successes", async () => {
    tokenStore.set("tok");
    fetchMock.mockResolvedValueOnce(respond(404, { error: { code: "not_found", message: "Trip not found" } }));
    fetchMock.mockResolvedValueOnce(respond(500, null));
    fetchMock.mockResolvedValueOnce(respond(200, {}));

    await expect(api.get("/trips/1")).rejects.toMatchObject({ status: 404 });
    await expect(api.get("/trips")).rejects.toMatchObject({ status: 500 });
    await api.get("/trips");

    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe("api client: DELETE with a body", () => {
  it("sends no body for an ordinary DELETE", async () => {
    await api.del("/trips/1");

    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it("sends the JSON body when one is given (deleting your account carries a confirmation)", async () => {
    await api.del("/auth/me", { confirmation: "secret" });

    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ confirmation: "secret" });
  });

  it("does not treat a 403 on /auth/me as a dead session", async () => {
    tokenStore.set("tok-123");
    fetchMock.mockResolvedValue(respond(403, { error: { code: "confirmation_failed", message: "no" } }));

    await expect(api.del("/auth/me", { confirmation: "x" })).rejects.toMatchObject({ status: 403 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
