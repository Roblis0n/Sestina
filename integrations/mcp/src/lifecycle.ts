export function createIdempotentShutdown(
  closeTransport: () => Promise<void>,
  closeCore: () => void,
  releaseInput: () => void,
): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => {
    closing ??= (async () => {
      try {
        await closeTransport();
      } finally {
        try {
          closeCore();
        } finally {
          releaseInput();
        }
      }
    })();
    return closing;
  };
}
