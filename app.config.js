module.exports = ({ config }) => {
  // Expo serves this folder in Metro and copies it into every unified web export.
  process.env.EXPO_PUBLIC_FOLDER = 'caregiver/public';
  return config;
};
