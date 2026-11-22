import { deleteSettings, getSetting, setSetting } from "../../storage/tables/settings";
import { markAllActivitySynced } from "./activity";
import { post, storeTokens, type Tokens } from "./api";

export async function login(email: string, password: string, server?: string): Promise<void> {
  const previous = getSetting("server_url");
  if (server) setSetting("server_url", server);
  try {
    const tokens = await post<Tokens>("/client/login", { email, password }, false);
    // Before the new tokens exist: calls logged so far (any earlier user's) are never sent with them.
    markAllActivitySynced();
    storeTokens(tokens, email);
  } catch (err) {
    // Keep the old server when the new one fails (a typo would otherwise break every later sync).
    if (server && previous === undefined) deleteSettings("server_url");
    else if (server) setSetting("server_url", previous!);
    throw err;
  }
}

/** Ends the company session: tokens and company state go; the last synced rules stay as local, editable rules. */
export function logout(): void {
  markAllActivitySynced(); // unsent calls of this user never go to the next one
  deleteSettings("auth:");
  deleteSettings("company:");
}

/** Logged in: the company controls this client's rules and settings. */
export function managed(): boolean {
  return getSetting("auth:refresh_token") !== undefined;
}
