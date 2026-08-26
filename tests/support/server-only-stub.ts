/**
 * Stands in for `server-only` under Vitest.
 *
 * The real package throws on import outside a Server Component, which is
 * exactly what it is for — but it also makes any module carrying it
 * untestable in a plain Node test runner. Aliasing it here keeps the guard
 * fully in force in the build (where it catches a client component importing
 * a server module) while letting the unit tests reach the logic inside.
 *
 * Deliberately not solved by removing `server-only` from the modules: the
 * import is a real protection, and weakening production code to suit a test
 * runner is the wrong direction.
 */
export {};
