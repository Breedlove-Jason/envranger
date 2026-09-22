// Place this file in the project root. Import only from Node.js or a build config.
// Install envRanger from GitHub first; see docs/guide.md.
import { loadEnv as loadScopedEnv } from 'envranger/loader';

export const requiredBackend = Object.freeze([
  'PORT', 'MONGODB_URI', 'NODE_ENV', 'CLOUDINARY_API_SECRET',
  'CLOUDINARY_API_KEY', 'CLOUDINARY_CLOUD_NAME', 'UNSPLASH_ACCESS_KEY',
  'MAPBOX_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
]);

export default function loadEnv(options = {}) {
  const scope = options.scope ?? 'backend';
  return loadScopedEnv({
    root: new URL('./', import.meta.url),
    scope,
    required: scope === 'backend' ? requiredBackend : undefined,
    populate: scope === 'backend',
    ...options,
  });
}
