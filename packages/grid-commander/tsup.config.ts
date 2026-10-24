import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', styles: 'src/themes/styles.css' },
  format: ['esm', 'cjs'],
  dts: { entry: { index: 'src/index.ts' } },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
});
