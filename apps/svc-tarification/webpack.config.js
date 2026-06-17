const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  resolve: {
    // Résout les libs workspace (@creche-planner/*) vers leur SOURCE TypeScript
    // (condition d'export `@creche-planner/source`), comme le typecheck — évite de
    // tirer le `dist` compilé dans le programme ts-loader.
    conditionNames: [
      '@creche-planner/source',
      'import',
      'require',
      'node',
      'default',
    ],
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: [
        './src/assets',
        // Migrations SQL Drizzle embarquées : MigrationService les applique au boot
        // en résolvant `dist/database/migrations` relativement à __dirname.
        {
          glob: '**/*',
          input: './src/database/migrations',
          output: 'database/migrations',
        },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
    }),
  ],
};
