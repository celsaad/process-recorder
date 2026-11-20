// vitest-axe 0.1 only augments the legacy `Vi` namespace; register its matcher types for Vitest 5.
import type { AxeMatchers } from "vitest-axe/matchers";

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- the merge must repeat Vitest's own signature
  interface Assertion<T = any> extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- same, for asymmetric matchers
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
