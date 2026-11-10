import "server-only";
import { createVisionProvider, readServerEnv } from "@/server/config";
import { handleIdentify, LocalRateLimiter } from "@/server/vision/identify-handler";

const env = readServerEnv();
const limiter = new LocalRateLimiter(env.VISION_MAX_REQUESTS_PER_MINUTE);

export const maxDuration = 60;

export async function POST(request: Request) {
  return handleIdentify(request, {
    env,
    provider: createVisionProvider(env),
    limiter,
    // Owner session verification arrives in Phase 2; until then real providers stay locked.
    isOwnerAuthenticated: () => false,
  });
}
