import type { NavigationPlace, NavigationRoute } from '../types/navigation';
import type { NavigationSessionStore } from './navigationSessionStore';

type FetchRoutes = (destination: NavigationPlace, origin: { lat: number; lng: number }, signal: AbortSignal) => Promise<NavigationRoute[]>;

// One request owner per signed-in user. Late responses must never replace a newer route.
export class RouteCalculationController {
  private generation = 0;
  private controller?: AbortController;
  private paused = false;
  constructor(private store: NavigationSessionStore, private fetchRoutes: FetchRoutes) {}
  cancel = () => { this.generation++; this.controller?.abort(); this.controller = undefined; };
  setPaused = (paused: boolean) => {
    this.paused = paused;
    if (paused) {
      this.cancel();
      if (this.store.getSnapshot().calculating) this.store.failCalculation('GPS pausado. Reanuda para calcular la ruta.');
    }
  };
  calculate = async (destination: NavigationPlace, origin: { lat: number; lng: number }) => {
    this.cancel();
    if (this.paused || !this.store.isLoaded()) return null;
    const generation = this.generation;
    const controller = new AbortController(); this.controller = controller;
    this.store.beginCalculation();
    const current = () => {
      const selected = this.store.getSnapshot().destination;
      return generation === this.generation && !controller.signal.aborted && !this.paused
        && selected?.id === destination.id && selected.lat === destination.lat && selected.lng === destination.lng;
    };
    try {
      const routes = await this.fetchRoutes(destination, origin, controller.signal);
      if (!current()) return null;
      this.store.finishCalculation(routes);
      return routes;
    } catch {
      if (current()) this.store.failCalculation(this.store.getSnapshot().routes.length
        ? 'No se pudo recalcular. Se conserva la ruta anterior; revisa la conexión y reintenta.'
        : 'No se pudo calcular una ruta vial. Revisa la conexión y vuelve a intentarlo.');
      return null;
    }
  };
}
