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

function entry(input, output) {
  return { ...shared, input, output: { ...shared.output, file: output } }
}

const config = [
  entry('src/http/index.js', 'http/dist/index.js'),
  entry('src/base64-decode/index.js', 'base64-decode/dist/index.js')
]

export default config
