import AsyncStorage from '@react-native-async-storage/async-storage';
let identity: Promise<string> | undefined;
export const trackingSourceId = () => identity ??= (async () => {
  const key = '@eunice_tracking_installation';
  const saved = await AsyncStorage.getItem(key);
  if (saved) return saved;
  const id = `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await AsyncStorage.setItem(key, id);
  return id;
})();
