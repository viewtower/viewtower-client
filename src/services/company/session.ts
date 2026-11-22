import { deleteSettings, getSetting, setSetting } from "../../storage/tables/settings";
import { markAllActivitySynced } from "./activity";
import { post, storeTokens, type Tokens } from "./api";

export async function login(email: string, password: string, server?: string): Promise<void> {
  if (server) setSetting("server_url", server);
  const tokens = await post<Tokens>("/client/login", { email, password }, false);
  // Before the new tokens exist: calls logged so far (any earlier user's) are never sent with them.
  markAllActivitySynced();
  storeTokens(tokens, email);
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
