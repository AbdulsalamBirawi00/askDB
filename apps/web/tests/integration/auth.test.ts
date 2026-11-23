import { eq, schema } from "@askdb/db";
import { afterAll, describe, expect, it } from "vitest";

import { GET as connectionGET, DELETE as connectionDELETE } from "@/app/api/connections/[id]/route";
import { GET as connectionsGET, POST as connectionsPOST } from "@/app/api/connections/route";
import { GET as meGET } from "@/app/api/me/route";
import { getDb } from "@/lib/db";

import { deleteCreatedUsers, insertConnection, request, signInGuest, signInUser } from "./helpers";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

afterAll(deleteCreatedUsers);

describe("sessions", () => {
  it("a guest sign-in creates a demo user with a working session", async () => {
    const guest = await signInGuest();
    const response = await meGET(request("/api/me", guest.cookie));
    expect(response.status).toBe(200);
    const { user } = await response.json();
    expect(user).toMatchObject({ id: guest.id, role: "demo", isGuest: true, email: null });
  });

  it("T1.4 an API request with an expired session gets 401", async () => {
    const user = await signInUser();
    expect((await meGET(request("/api/me", user.cookie))).status).toBe(200);

    await getDb()
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.sessions.userId, user.id));

    const response = await meGET(request("/api/me", user.cookie));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not signed in" });
  });

  it("401 without a cookie or with a forged one", async () => {
    expect((await meGET(request("/api/me"))).status).toBe(401);
    const forged = "better-auth.session_token=made-up-token.bad-signature";
    expect((await meGET(request("/api/me", forged))).status).toBe(401);
    expect((await connectionsGET(request("/api/connections", forged))).status).toBe(401);
  });
});

describe("connections: demo restrictions", () => {
  const body = JSON.stringify({ name: "Mine", url: "postgres://u:p@h/db" });
  const post = (cookie?: string) =>
    connectionsPOST(
      request("/api/connections", cookie, {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
      }),
    );

  it("T1.3 a demo user adding a DB connection gets 403 'Not available in demo mode'", async () => {
    const guest = await signInGuest();
    const response = await post(guest.cookie);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Not available in demo mode" });
  });

  it("a signed-out request is 401, and a regular user is not refused for being demo", async () => {
    expect((await post()).status).toBe(401);
    const user = await signInUser();
    expect((await post(user.cookie)).status).not.toBe(403);
  });

  it("rejects an invalid body with 400", async () => {
    const user = await signInUser();
    const response = await connectionsPOST(
      request("/api/connections", user.cookie, { method: "POST", body: "{not json" }),
    );
    expect(response.status).toBe(400);
  });
});

describe("connections: ownership (security)", () => {
  it("T1.5 user A asking for user B's connection by id gets 404, same as a missing id", async () => {
    const a = await signInUser();
    const b = await signInUser();
    const bConnection = await insertConnection(b.id);

    const forOther = await connectionGET(request(`/api/connections/x`, a.cookie), ctx(bConnection));
    const forMissing = await connectionGET(
      request(`/api/connections/x`, a.cookie),
      ctx("does-not-exist"),
    );
    expect(forOther.status).toBe(404);
    expect(forMissing.status).toBe(404);
    expect(await forOther.text()).toBe(await forMissing.text());

    // The owner still sees it, without the encrypted URL.
    const own = await connectionGET(request(`/api/connections/x`, b.cookie), ctx(bConnection));
    expect(own.status).toBe(200);
    const { connection } = await own.json();
    expect(connection).toMatchObject({ id: bConnection, name: "Shop DB", isDemo: false });
    expect(connection).not.toHaveProperty("encryptedUrl");
  });

  it("T1.5 user A cannot delete user B's connection (404, row kept)", async () => {
    const a = await signInUser();
    const b = await signInUser();
    const bConnection = await insertConnection(b.id);

    const response = await connectionDELETE(request("/x", a.cookie), ctx(bConnection));
    expect(response.status).toBe(404);
    const rows = await getDb()
      .select({ id: schema.connections.id })
      .from(schema.connections)
      .where(eq(schema.connections.id, bConnection));
    expect(rows).toHaveLength(1);

    expect((await connectionDELETE(request("/x", b.cookie), ctx(bConnection))).status).toBe(204);
  });

  it("T1.5 the list only contains the caller's connections", async () => {
    const a = await signInUser();
    const b = await signInUser();
    const aConnection = await insertConnection(a.id, "A's DB");
    await insertConnection(b.id, "B's DB");

    const { connections } = await (
      await connectionsGET(request("/api/connections", a.cookie))
    ).json();
    expect(connections.map((c: { id: string }) => c.id)).toEqual([aConnection]);
  });

  it("every ID route needs a session", async () => {
    expect((await connectionGET(request("/x"), ctx("any"))).status).toBe(401);
    expect((await connectionDELETE(request("/x"), ctx("any"))).status).toBe(401);
  });
});
