import { Context, Next } from "hono";

const MAX_BODY_SIZE = 16 * 1024; // 16 KB

export async function bodyLimit(c: Context, next: Next) {
  const contentLength = c.req.header("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return c.json({ error: "Request body too large" }, 413);
  }
  await next();
}
