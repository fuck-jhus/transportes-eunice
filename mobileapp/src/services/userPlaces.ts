import AsyncStorage from '@react-native-async-storage/async-storage';

export const placeStorageKey = (userId: number | undefined, name: string) => `@eunice_places_${userId ?? 'guest'}_${name}`;
export const clearUserPlaces = async (userId: number) => {
  const keys = await AsyncStorage.getAllKeys();
  const prefix = `@eunice_places_${userId}_`;
  await AsyncStorage.multiRemove(keys.filter(key => key.startsWith(prefix) || key.startsWith(`@eunice_telemetry_queue_${userId}_`)
    || key === `@eunice_navigation_v1_${userId}` || key === `@pilot_privacy_mode_${userId}`));
};
// Legacy device-wide locations have no established owner; never migrate them to a new account.
export const retireLegacyPlaces = async () => {
  const keys = ['@recent_destinations_history', '@saved_favorite_places', '@pilot_recent_trip_starts', '@pilot_privacy_mode'];
  const values = await Promise.all(keys.map(async key => [key, await AsyncStorage.getItem(key)] as const));
  const retained = Object.fromEntries(values.filter(([, value]) => value != null));
  if (Object.keys(retained).length) {
    // Recoverable archive: these device-wide records cannot be assigned safely.
    await AsyncStorage.setItem('@eunice_unowned_places_archive_v1', JSON.stringify(retained));
    await AsyncStorage.multiRemove(keys);
  }
};
