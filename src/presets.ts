
export type Preset = { name: string; description: string; keys: string[]; group?: string };

export const PRESETS: Preset[] = [
  {
    name: "Stripe",
    description: "Stripe keys for server and client",
    group: "payments",
    keys: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"]
  },
  {
    name: "S3",
    description: "AWS S3 access for uploads",
    group: "storage",
    keys: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET", "S3_REGION"]
  },
  {
    name: "Next Public",
    description: "Common Next.js public config",
    group: "next",
    keys: ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_ANALYTICS_ID"]
  },
  {
    name: "Postgres",
    description: "Database URL + pool sizing",
    group: "db",
    keys: ["DATABASE_URL", "PGPOOL_MIN", "PGPOOL_MAX"]
  }
];
