module.exports = ({ config }) => {
  // Keep the original Expo Go SecureStore scope for previously paired previews.
  if (process.argv.includes('--go')) {
    const { eas: _eas, ...extra } = config.extra ?? {};
    return { ...config, extra };
  }
  return config;
};
