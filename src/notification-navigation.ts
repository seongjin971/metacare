import { useEffect, useRef } from 'react';
import { router, useRootNavigationState } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { resolveNotificationRoute } from './notification-routes';
import { isPatientReminder } from './reminder-plan';

/** Mount once in the root layout. Notification payloads cannot open external URLs. */
export function useNotificationNavigation(): void {
  const navigationState = useRootNavigationState();
  const lastHandled = useRef<string | null>(null);

  useEffect(() => {
    // The cold-start response stays in native storage until the navigator mounts.
    if (!navigationState?.key) return;

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const notification = response.notification;
      const key = `${notification.request.identifier}:${notification.date}:${response.actionIdentifier}`;
      if (lastHandled.current === key) return;

      const url = resolveNotificationRoute(notification.request.content.data?.url);
      if (!isPatientReminder(notification.request.identifier) || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER || url === null) {
        Notifications.clearLastNotificationResponse();
        return;
      }

      lastHandled.current = key;
      // A fresh reminder also returns an already-open medication calendar to today.
      if (url === '/') router.push({ pathname: '/', params: { reminder: key } });
      else router.push(url);
      Notifications.clearLastNotificationResponse();
    };

    // Subscribe before reading the launch response to avoid losing a concurrent tap.
    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    const response = Notifications.getLastNotificationResponse();
    if (response) handleResponse(response);

    return () => subscription.remove();
  }, [navigationState?.key]);
}
