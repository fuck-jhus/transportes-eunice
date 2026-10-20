export const arrivalEligible = (input: { distanceMeters: number; accuracy: number | null; timestamp?: number | null;
  matched: boolean; routeRemainingMeters: number; now?: number }) => {
  const age = (input.now ?? Date.now()) - (input.timestamp ?? 0);
  return age >= 0 && age <= 15_000 && input.distanceMeters <= 50 && (input.accuracy ?? 999) <= 25
    && input.matched && input.routeRemainingMeters <= 80;
};
