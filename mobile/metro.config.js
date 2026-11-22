const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(__dirname);
config.watchFolders.push(path.resolve(__dirname, '../shared'));
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
const nodeOnlyCompilerModules = new Set(['perf_hooks', 'fs', 'path', 'os', 'crypto', 'source-map-support', 'inspector']);
config.resolver.resolveRequest = (context, request, platform) => {
  if (request === 'typescript') return { type: 'sourceFile', filePath: require.resolve('typescript') };
  if (context.originModulePath === require.resolve('typescript') && nodeOnlyCompilerModules.has(request)) return { type: 'empty' };
  return context.resolveRequest(context, request, platform);
};
module.exports = config;
