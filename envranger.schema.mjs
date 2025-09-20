import { z } from "zod";

// Example Zod schema for your env.
// Edit freely; unknown keys default to string via .catchall(z.string()).
export default z.object({
  // DATABASE_URL: z.string().url(),
  // NEXT_PUBLIC_APP_URL: z.string().url(),
  // STRIPE_SECRET_KEY: z.string().min(10),
}).catchall(z.string());