// api/*.ts's own relative imports of ./_lib/*.ts modules use a `.js`
// extension (e.g. `from './_lib/placesVerify.js'`) even though only the
// `.ts` source exists on disk — the standard TypeScript NodeNext convention,
// and the only form Vercel's own build resolves correctly at runtime (it
// compiles each file to `.js` without bundling, so the emitted import must
// already say `.js` to find its compiled sibling — confirmed live: leaving
// `.ts` in these specifiers 500'd every affected function in production with
// ERR_MODULE_NOT_FOUND, since /var/task never has a literal `placesVerify.ts`).
//
// Locally, though, `npm test` runs the raw `.ts` sources directly via
// `node --experimental-strip-types` with no compile step — and plain Node
// ESM resolution requires an exact extension match, so a `.js` specifier
// with no `.js` file on disk fails the same way. This hook bridges that gap
// for local test runs only: it's the standard "fall back from .js to .ts"
// resolution trick tools like tsx apply, reimplemented here in a few lines
// rather than adding a dependency for it.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && specifier.endsWith('.js')) {
      return nextResolve(`${specifier.slice(0, -'.js'.length)}.ts`, context)
    }
    throw error
  }
}
