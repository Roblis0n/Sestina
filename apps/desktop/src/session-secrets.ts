import type { SecretBackend } from "@sestina/core";
/** Ephemeral mode is selected by an explicit native user choice, never automatically. */
export function withSessionSecrets(persistent: SecretBackend) {
  const values = new Map<string, string>();
  let ephemeral = false;
  const get = async (ref: string) =>
    ephemeral ? values.get(ref) : persistent.get(ref);
  const backend: SecretBackend = {
    health: async () =>
      ephemeral
        ? {
            available: true,
            backend: "none",
            reason:
              "Credentials are available only for this application session.",
          }
        : persistent.health(),
    get,
    set: async (ref, value) => {
      if (ephemeral) values.set(ref, value);
      else await persistent.set(ref, value);
    },
    delete: async (ref) => {
      if (ephemeral) values.delete(ref);
      else await persistent.delete(ref);
    },
    describe: async (ref) => ({ configured: (await get(ref)) !== undefined }),
  };
  return {
    backend,
    persistent,
    sessionOnly: () => ephemeral,
    enable: () => {
      ephemeral = true;
    },
    clear: () => {
      values.clear();
      ephemeral = false;
    },
  };
}
