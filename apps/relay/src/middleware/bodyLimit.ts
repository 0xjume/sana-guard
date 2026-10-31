import { bodyLimit as honoBodyLimit } from "hono/body-limit";

export const MAX_BODY_SIZE = 16 * 1024;

/** Caps the bytes actually read, including chunked bodies with no Content-Length. */
export const bodyLimit = honoBodyLimit({
  maxSize: MAX_BODY_SIZE,
  onError: (c) => c.json({ error: "Request body too large" }, 413),
});
