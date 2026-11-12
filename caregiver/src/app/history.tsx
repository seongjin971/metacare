import React from 'react';
import { Redirect, useLocalSearchParams, usePathname } from 'expo-router';
import { isCalendarDate } from '../../../src/calendar';

/** Records moved into the medication tab. Older alerts and links that open here land on that day. */
export default function HistoryRedirect() {
  const params = useLocalSearchParams<{ date?: string }>();
  const home = usePathname().replace(/\/history$/, '') || '/';
  return <Redirect href={isCalendarDate(params.date) ? `${home}?date=${params.date}` : home} />;
}
