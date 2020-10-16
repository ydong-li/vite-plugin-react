import { runtimePublicPath } from './serverPlugin'
import { Transform } from 'vite'

export const reactRefreshTransform: Transform = {
  test: ({ path, isBuild }) => {
    if (!/\.(t|j)sx?$/.test(path)) {
      return false
    }
    // pre-bundling dependencies from node_modules
    if (
      isBuild &&
      process.env.NODE_ENV === 'development' &&
      (path.startsWith(`/@modules/`) || path.includes('node_modules')) &&
      !path.endsWith('x')
    ) {
      return true
    }
    if (isBuild || process.env.NODE_ENV === 'production') {
      // do not transform for production builds
      return false
    }
    if (
      (path.startsWith(`/@modules/`) || path.includes('node_modules')) &&
      !path.endsWith('x')
    ) {
      // do not transform if this is a dep and is not jsx/tsx
      return false
    }
    return true
  },

  transform: ({ code, path, isBuild }) => {
    const hasJsx = /(<\/)|(\/>)/.test(code)
    const result = require('@babel/core').transformSync(code, {
      presets: [hasJsx && require('@babel/preset-react')].filter(Boolean),
      plugins: [
        [
          require('@babel/plugin-proposal-decorators'),
          {
            legacy: true
          }
        ],
        [
          require('@babel/plugin-proposal-class-properties'),
          {
            loose: false
          }
        ],
        !isBuild && require('react-refresh/babel')
      ].filter(Boolean),
      ast: false,
      sourceMaps: true,
      sourceFileName: path
    })

    // 项目的入口 js 文件如果有用到 jsx 语法最好使用 .jsx 后缀
    if (!/\$RefreshReg\$\(/.test(result.code)) {
      if (isBuild) {
        return result.code
      }
      // no component detected in the file
      return code
    }

    const header = `
  import RefreshRuntime from "${runtimePublicPath}";

  let prevRefreshReg;
  let prevRefreshSig;

  if (!window.__vite_plugin_react_preamble_installed__) {
    throw new Error(
      "vite-plugin-react can't detect preamble. Something is wrong. See https://github.com/vitejs/vite-plugin-react/pull/11#discussion_r430879201"
    );
  }

  if (import.meta.hot) {
    prevRefreshReg = window.$RefreshReg$;
    prevRefreshSig = window.$RefreshSig$;
    window.$RefreshReg$ = (type, id) => {
      RefreshRuntime.register(type, ${JSON.stringify(path)} + " " + id)
    };
    window.$RefreshSig$ = RefreshRuntime.createSignatureFunctionForTransform;
  }`.replace(/[\n]+/gm, '')

    const footer = `
  if (import.meta.hot) {
    window.$RefreshReg$ = prevRefreshReg;
    window.$RefreshSig$ = prevRefreshSig;

    import.meta.hot.accept();
    RefreshRuntime.performReactRefresh();
  }`

    return {
      code: `${header}${result.code}${footer}`,
      map: result.map
    }
  }
}
