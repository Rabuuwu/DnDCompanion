function corsOptions(origins = process.env.CORS_ORIGINS || '') {
  const allowed = new Set([
    'https://localhost',
    'capacitor://localhost',
    ...String(origins)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ]);
  return {
    exposedHeaders: ['X-Has-More', 'X-Next-Offset', 'X-Next-Cursor', 'X-Request-Id'],
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) return callback(null, true);
      return callback(new Error('origin_not_allowed'));
    },
  };
}

module.exports = { corsOptions };
