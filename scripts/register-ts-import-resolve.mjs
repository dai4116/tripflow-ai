// Registers a Node ESM resolve hook (see ts-import-resolve-hook.mjs) so
// `npm test`'s raw `node --experimental-strip-types` run can execute api/
// source unmodified — see that hook file for why this exists.
import { register } from 'node:module'

register('./ts-import-resolve-hook.mjs', import.meta.url)
