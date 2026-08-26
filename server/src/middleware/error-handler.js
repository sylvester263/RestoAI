/**
 * Global error handler middleware.
 * Catches errors from all routes and returns a consistent JSON response.
 */
export function errorHandler(err, _req, res, _next) {
  console.error('[error]', err.message || err);

  const status = err.status || 500;
  res.status(status).json({
    error: {
      message: err.expose ? err.message : 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}
