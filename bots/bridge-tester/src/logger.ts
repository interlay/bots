import pino from "pino";
const logFn = (opts = {}) =>
  pino({
    level: process.env.LOG_LEVEL || "info",
    prettyPrint:
      (process.env.LOG_PRETTY_PRINT && process.env.LOG_PRETTY_PRINT === "1") ||
      false,
    ...opts,
  });
const logger = logFn({ name: "server" });
export default logger;
