// Version simplifiée - Redis désactivé
export const getRedisClient = () => {
  console.log('⚠️ Redis is disabled in development mode');
  return null;
};

export const cacheGet = async (key: string): Promise<any> => {
  return null;
};

export const cacheSet = async (key: string, value: any, ttl: number = 300): Promise<void> => {
  return;
};

export const cacheDel = async (key: string): Promise<void> => {
  return;
};

export const isRedisAvailable = (): boolean => {
  return false;
};