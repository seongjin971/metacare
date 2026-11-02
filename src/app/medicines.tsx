import { Redirect } from 'expo-router';

// Keep older medication links pointing to the medication tab.
export default function LegacyMedicinesRoute() {
  return <Redirect href="/" />;
}
