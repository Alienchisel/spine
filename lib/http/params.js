// Validate a numeric URL parameter once per router, via router.param, instead
// of repeating `Number.isInteger(id) && id >= 1` in every handler (it was
// copied 50+ times). Positive integers only; anything else is a 400 with the
// router's message, before any handler runs. Handlers still read the value
// with Number(req.params.x).
export function positiveIdParam(message) {
  return (_req, res, next, value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) return res.status(400).json({ error: message });
    next();
  };
}
