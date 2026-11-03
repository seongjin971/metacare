module.exports = ({ config }) => {
  // Keep the original Expo Go SecureStore scope for previously paired previews.
  // Standalone and development builds use the linked EAS project for push delivery.
  if (process.argv.includes('--go')) {
    const { eas: _eas, ...extra } = config.extra ?? {};
    return { ...config, extra };
  }
  const googleServicesFile = process.env.CAREGIVER_GOOGLE_SERVICES_FILE;
  const projectId = process.env.CAREGIVER_EAS_PROJECT_ID || config.extra?.eas?.projectId;
  return {
    ...config,
    android: { ...config.android, ...(googleServicesFile && { googleServicesFile }) },
    extra: { ...config.extra, ...(projectId && { eas: { ...config.extra?.eas, projectId } }) },
  };
};
