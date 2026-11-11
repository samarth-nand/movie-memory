import "server-only";
import { parseEnv } from "./env.schema";

export const env = parseEnv(process.env);
