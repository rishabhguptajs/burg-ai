import { parse } from 'node:url';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  username?: string;
  db?: number;
}

export function getRedisConfig(): RedisConfig {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    // Parse Redis URL (e.g., redis://username:password@host:port/db or rediss://...)
    try {
      const parsedUrl = parse(redisUrl);

      return {
        host: parsedUrl.hostname || 'localhost',
        port: parseInt(parsedUrl.port || '6379'),
        password: parsedUrl.auth?.split(':')[1], // Extract password from username:password
        username: parsedUrl.auth?.split(':')[0], // Extract username
        db: parsedUrl.pathname && parsedUrl.pathname !== '/' ? parseInt(parsedUrl.pathname.slice(1)) : undefined,
      };
    } catch (error) {
      console.warn('Failed to parse REDIS_URL, falling back to individual variables:', error);
    }
  }

  // Fallback to individual environment variables
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    username: process.env.REDIS_USERNAME,
    db: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB) : undefined,
  };
}
