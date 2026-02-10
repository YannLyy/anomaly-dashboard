export function requireAuth(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  next();
}

export function injectUser(req, res, next) {
  res.locals.me = req.session?.user || null;
  next();
}
