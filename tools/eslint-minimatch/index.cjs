// ESLint 9 and its plugins call the CommonJS export directly. Match v3's
// path handling on Windows while respecting explicit options from ESLint.
const match = require('minimatch-engine').defaults({
  allowWindowsEscape: process.platform !== 'win32',
  optimizationLevel: 0,
});

// import/no-internal-modules tests each configured pattern against import paths.
match.makeRe = (pattern, options) => {
  const matcher = new match.Minimatch(pattern, options);
  return matcher.comment || matcher.empty ? false : { test: value => matcher.match(value) };
};

module.exports = match;
