// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'

const shared = {
  output: {
    esModule: true,
    format: 'es',
    sourcemap: false
  },
  plugins: [commonjs(), nodeResolve({ preferBuiltins: true })]
}

const config = [
  {
    ...shared,
    input: 'src/hyperbolic/index.js',
    output: { ...shared.output, file: 'hyperbolic/dist/index.js' }
  },
  {
    ...shared,
    input: 'src/sxt/index.js',
    output: { ...shared.output, file: 'sxt/dist/index.js' }
  }
]

export default config
