// Only parser errors have a public client-facing status. Database and application
// errors remain opaque, even when an exception contains a status property.
function errorResponse(error) {
  if (error?.type === 'entity.parse.failed') return { status: 400, error: 'invalid_json' };
  if (error?.type === 'entity.too.large') return { status: 413, error: 'payload_too_large' };
  if (error?.message === 'origin_not_allowed') return { status: 403, error: 'origin_not_allowed' };
  return { status: 500, error: 'server_error' };
}

function handleHttpError(err, req, res, next) {
  if (res.headersSent) return next(err);
  const response = errorResponse(err);
  if (response.status === 500) {
    // Error messages/stacks may contain SQL values, request bodies, or credentials.
    console.error({ event: 'request_failed', requestId: req.auditRequestId || null });
  }
  return res.status(response.status).json({ error: response.error });
}

module.exports = { errorResponse, handleHttpError };
