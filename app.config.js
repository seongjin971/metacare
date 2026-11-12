module.exports = ({ config }) => {
  // Expo serves this folder in Metro and copies it into every unified web export.
  process.env.EXPO_PUBLIC_FOLDER = 'caregiver/public';
  // Caregiver alerts use FCM on Android. EAS provides google-services.json as a file environment variable.
  const firebaseFile = process.env.METACARE_GOOGLE_SERVICES_FILE;
  return {
    ...config,
    android: { ...config.android, ...(firebaseFile && { googleServicesFile: firebaseFile }) },
  };
};
