import type { File as BabelAST } from '@babel/types'
import { runtimePublicPath } from './serverPlugin'
import { Transform } from 'vite'

export const reactRefreshTransform: Transform = {
  test: ({ path, isBuild }) => {
    if (!/\.(t|j)sx?$/.test(path)) {
      return false
    }
    if (isBuild || process.env.NODE_ENV === 'production') {
      // do not transform for production builds
      return false
    }
    if (isDependency(path) && !path.endsWith('x')) {
      // do not transform if this is a dep and is not jsx/tsx
      return false
    }
    return true
  },

  transform: ({ code, path, isBuild }) => {
    const hasJsx = /(<\/)|(\/>)/.test(code)
    const isCommonJs = /exports|require\(/.test(code)
    const result = require('@babel/core').transformSync(code, {
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
        // require('@babel/plugin-syntax-export-default-from'),
        require('@babel/plugin-proposal-export-default-from'),
        require('@babel/plugin-proposal-export-namespace-from'),
        require('@babel/plugin-proposal-optional-chaining'),
        !isBuild && require('react-refresh/babel')
        // isCommonJs && require('babel-plugin-transform-commonjs-es2015-modules')
        /*!isBuild &&
          isCommonJs && [
            require('babel-plugin-transform-commonjs'),
            { synchronousImport: true }
          ]*/
      ].filter(Boolean),
      ast: false,
      sourceMaps: true,
      sourceFileName: path
    })

    if (path.includes('js/component/index.js')) {
      console.log('---------------')
      console.log('isCommonJs ', isCommonJs)
      console.log(result.code)
      console.log('---------------')
    }

    /*if (path.includes('public_v2/src/js/container/root.js')) {
      console.log('------------')
      console.log({ isBuild }, !isBuild && require('react-refresh/babel'))
      console.log(result.code)
      console.log('------------')
    }*/
    // 项目的入口 js 文件如果有用到 jsx 语法最好使用 .jsx 后缀
    if (!/\$RefreshReg\$\(/.test(result.code)) {
      if (isBuild || hasJsx) {
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

    ${isRefreshBoundary(result.ast) ? `import.meta.hot.accept();` : ``}
    if (!window.__vite_plugin_react_timeout) {
      window.__vite_plugin_react_timeout = setTimeout(() => {
        window.__vite_plugin_react_timeout = 0;
        RefreshRuntime.performReactRefresh();
      }, 30);
    }
  }`

    return {
      code: `${header}${result.code}${footer}`,
      map: result.map
    }
  }
}

function isDependency(path: string) {
  return path.startsWith(`/@modules/`) || path.includes('node_modules')
}

function isRefreshBoundary(ast: BabelAST) {
  // Every export must be a React component.
  return ast.program.body.every((node) => {
    if (node.type !== 'ExportNamedDeclaration') {
      return true
    }
    const { declaration, specifiers } = node
    if (declaration && declaration.type === 'VariableDeclaration') {
      return declaration.declarations.every(
        ({ id }) => id.type === 'Identifier' && isComponentishName(id.name)
      )
    }
    return specifiers.every(
      ({ exported }) =>
        exported.type === 'Identifier' && isComponentishName(exported.name)
    )
  })
}

function isComponentishName(name: string) {
  return typeof name === 'string' && name[0] >= 'A' && name[0] <= 'Z'
}
