import pino from "pino";

function createLogger() {
  const logLevel = process.env.LOG_LEVEL || "info";
  const nodeEnv = process.env.NODE_ENV || "development";

  return pino({
    level: logLevel,
    redact: {
      paths: [
        "*.privateKey",
        "*.RELAY_NEAR_PRIVATE_KEY",
        "req.headers.authorization",
      ],
      remove: true,
    },
    transport:
      nodeEnv === "development"
        ? {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
            },
          }
        : undefined,
  });
}

export const logger = createLogger();

export function createRequestLogger(requestId: string) {
  return logger.child({ requestId });
}
