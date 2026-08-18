/**
 * Time port. Domain logic never reads the wall clock directly; callers
 * inject a Clock so every instant is reproducible in tests.
 */
export interface Clock {
  now(): Date;
}
