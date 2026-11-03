const { rateLimit } = require('express-rate-limit');

// Explicit opt-out for isolated integration suites; never disabled in production.
const skip = () => process.env.NODE_ENV === 'test' && process.env.DISABLE_TEST_RATE_LIMITS === 'true';
const defaults = { skip, standardHeaders: 'draft-8', legacyHeaders: false };
const globalLimiter = rateLimit({
  ...defaults,
  windowMs: 15 * 60_000,
  limit: 1200,
  message: { error: 'too_many_requests' },
});
const accountReadLimiter = rateLimit({
  ...defaults,
  windowMs: 15 * 60_000,
  limit: 900,
  keyGenerator: (req) => String(req.user.id),
  message: { error: 'too_many_requests' },
});
const accountMutationLimiter = rateLimit({
  ...defaults,
  windowMs: 15 * 60_000,
  limit: 120,
  keyGenerator: (req) => String(req.user.id),
  message: { error: 'too_many_requests' },
});

function accountLimiter(req, res, next) {
  const limiter = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? accountReadLimiter : accountMutationLimiter;
  return limiter(req, res, next);
}

module.exports = { globalLimiter, accountLimiter, skipTestLimits: skip };
