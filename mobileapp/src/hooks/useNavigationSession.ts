import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationSessionStore } from '../services/navigationSessionStore';
import { fetchNavigationRoutes } from '../services/navigationRoutes';
import { RouteCalculationController } from '../services/routeCalculationController';

export const useNavigationSession = (userId: number | undefined, paused: boolean) => {
  const store = useMemo(() => new NavigationSessionStore(AsyncStorage, userId), [userId]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const lastStore = useRef(store);
  const calculation = useMemo(() => new RouteCalculationController(store, fetchNavigationRoutes), [store]);
  useEffect(() => {
    if (lastStore.current !== store) { void lastStore.current.flush(); lastStore.current.dispose(); lastStore.current = store; }
    void store.hydrate();
    const sub = AppState.addEventListener('change', status => { if (status !== 'active') void store.flush(); });
    return () => { sub.remove(); void store.flush(); store.dispose(); calculation.cancel(); };
  }, [store, calculation]);
  useEffect(() => {
    calculation.setPaused(paused);
  }, [paused, calculation]);
  const clear = useCallback(() => { calculation.cancel(); void store.clear(); }, [store, calculation]);
  return useMemo(() => ({ state, ready: store.isLoaded(), geometry: store.getGeometry(), calculateRoutes: calculation.calculate, clear,
    bindTrip: store.bindTrip, setDestination: store.setDestination, setSelectedRouteIdx: store.selectRoute, setIsTripActive: store.setTripActive,
    setFollowUser: store.setFollowUser, setCamera: store.setCamera, updateFix: store.updateFix }), [state, store, calculation, clear]);
};
export type NavigationSessionHandle = ReturnType<typeof useNavigationSession>;
