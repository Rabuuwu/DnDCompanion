function getServerBindOptions(env = process.env) {
  const isPublicRuntime = env.RENDER === 'true' || env.NODE_ENV === 'production';
  return {
    port: Number(env.PORT || 3000),
    host: env.HOST || (isPublicRuntime ? '0.0.0.0' : '127.0.0.1'),
  };
}

module.exports = { getServerBindOptions };
